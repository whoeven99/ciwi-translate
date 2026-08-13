import { hostname } from "os";
import {
  claimJob,
  updateJob,
  heartbeat,
  getJob,
  withStageTiming,
  countShopWritingBackJobs,
  findWritebackQueuedJobsForShop,
  type TranslationV4Job,
} from "../services/cosmosV4.js";
import { pushHint, setProgress } from "../services/redisV4.js";
import { claimNextJobWithFairScheduling } from "../services/fairStageClaim.js";
import { blobRead, blobWrite } from "../services/blobV4.js";
import { iterateTranslatedItemsForModule } from "../services/translateBlobIO.js";
import { registerTranslations, type TranslationInput } from "../services/shopifyFetch.js";
import { filterWritebackFields } from "../services/writebackFields.js";
import {
  CUSTOM_LIQUID_MODULE,
  completeLiquidRuleWriteback,
  jobModulesWithLiquid,
  releaseLiquidRulesForJob,
} from "../services/customLiquid.js";
import { runShopifyAdaptive, getShopifyCap } from "../services/shopifyConcurrency.js";
import type { HintPayload } from "../services/redisV4.js";
import { isShuttingDown } from "../shutdown.js";
import { finalizeJobAfterWriteback } from "../services/finalizeJobAfterWriteback.js";
import { recordJobUsageSnapshot } from "../services/recordJobUsageSnapshot.js";
import {
  stagePoolKindForJob,
  stageSlots,
  type StagePoolKind,
} from "../services/stagePool.js";
import { V4_MESSAGE_JOB_FAILED } from "../services/userFacingMessages.js";

/**
 * Scale-out safe: hostname + pid is unique across containers even when every
 * container's Node process starts at pid 1.
 */
const WORKER_ID = `writeback-${process.env.HOSTNAME ?? hostname()}-${process.pid}`;

const HEARTBEAT_THROTTLE_MS = 30_000;

/** Max stale/busy hints to drain per tick before falling back to Cosmos scan. */
const WRITEBACK_HINT_DRAIN_MAX = Math.max(
  1,
  Number(process.env.WRITEBACK_HINT_DRAIN_MAX) || 32,
);
const WRITEBACK_CLAIM_SCAN_BATCH = Math.max(
  10,
  Number(process.env.WRITEBACK_CLAIM_SCAN_BATCH) || 50,
);
const WRITEBACK_CLAIM_SCAN_MAX_BATCHES = Math.max(
  1,
  Number(process.env.WRITEBACK_CLAIM_SCAN_MAX_BATCHES) || 5,
);

export async function runWritebackWorker(): Promise<void> {
  if (isShuttingDown()) return;
  if (!stageSlots.anyCapacity("writeback")) return;

  let claimed: TranslationV4Job | null = null;
  let poolKind: StagePoolKind | null = null;
  let slotHeld = false;
  try {
    claimed = await claimNextJob();
    if (!claimed) return;

    poolKind = stagePoolKindForJob(claimed);
    if (!stageSlots.tryAcquire("writeback", poolKind)) {
      await updateJob(claimed.shopName, claimed.id, {
        status: "WRITEBACK_QUEUED",
        claimedBy: null,
      });
      await pushHint(
        "writeback",
        { taskId: claimed.id, shopName: claimed.shopName },
        poolKind,
      );
      return;
    }
    slotHeld = true;

    console.log(
      `[writeback] processing job=${claimed.id} pool=${poolKind} (${stageSlots.formatActive("writeback")})`,
    );
    await processWritebackJob(claimed).catch((e) => {
      console.error(`[writeback] job ${claimed!.id} failed`, e);
    });
  } catch (e) {
    if (claimed) console.error(`[writeback] job ${claimed.id} failed`, e);
    else console.error("[writeback] claim failed", e);
  } finally {
    if (poolKind && slotHeld) {
      stageSlots.release("writeback", poolKind);
      if (!isShuttingDown() && stageSlots.anyCapacity("writeback")) {
        void runWritebackWorker().catch((e) =>
          console.error("[writeback] wake on slot free failed", e),
        );
      }
    }
  }
}

async function wakeNextWritebackForShop(shopName: string): Promise<void> {
  if ((await countShopWritingBackJobs(shopName)) > 0) return;
  const [next] = await findWritebackQueuedJobsForShop(shopName, 1);
  if (!next) return;
  await pushHint(
    "writeback",
    { taskId: next.id, shopName },
    stagePoolKindForJob(next),
  );
  void runWritebackWorker().catch((e) =>
    console.error(`[writeback] wake next failed shop=${shopName}`, e),
  );
  console.log(
    `[writeback] shop=${shopName} slot free → queued next job=${next.id} ${next.source}->${next.target}`,
  );
}

async function tryClaimWritebackJob(
  shopName: string,
  taskId: string,
): Promise<TranslationV4Job | null> {
  if ((await countShopWritingBackJobs(shopName)) > 0) {
    return null;
  }
  const job = await claimJob(
    shopName,
    taskId,
    "WRITEBACK_QUEUED",
    "WRITING_BACK",
    WORKER_ID,
  );
  if (!job) return null;
  const active = await countShopWritingBackJobs(shopName);
  if (active > 1) {
    await updateJob(shopName, job.id, { status: "WRITEBACK_QUEUED", claimedBy: null });
    console.log(
      `[writeback] yield duplicate claim job=${job.id} shop=${shopName} (${active} WRITING_BACK)`,
    );
    return null;
  }
  return job;
}

async function isShopWritebackBusy(shopName: string): Promise<boolean> {
  return (await countShopWritingBackJobs(shopName)) > 0;
}

async function isStaleWritebackHint(hint: HintPayload): Promise<boolean> {
  const job = await getJob(hint.shopName, hint.taskId);
  if (!job) return true;
  return job.status !== "WRITEBACK_QUEUED";
}

async function claimNextJob(): Promise<TranslationV4Job | null> {
  return claimNextJobWithFairScheduling({
    stage: "writeback",
    hintKey: "writeback",
    drainMax: WRITEBACK_HINT_DRAIN_MAX,
    queuedStatus: "WRITEBACK_QUEUED",
    logTag: "writeback",
    scanBatch: WRITEBACK_CLAIM_SCAN_BATCH,
    scanMaxBatches: WRITEBACK_CLAIM_SCAN_MAX_BATCHES,
    isStaleHint: isStaleWritebackHint,
    isShopBusy: isShopWritebackBusy,
    tryClaimJob: tryClaimWritebackJob,
  });
}

type TranslatedItem = {
  resourceId: string;
  translations: Array<{
    key: string;
    originalValue: string;
    translatedValue: string;
    digest: string;
  }>;
};

type FailedResource = {
  resourceId: string;
  translations: TranslationInput[];
  userErrors?: Array<{ field: string; message: string }>;
};

async function persistWritebackCheckpoint(
  jobId: string,
  progressPath: string,
  writtenSet: Set<string>,
  writebackDone: number,
  writebackFailed: number,
  writebackTotal: number,
  currentModule?: string,
): Promise<void> {
  await blobWrite(progressPath, { written: [...writtenSet] });
  await setProgress(jobId, {
    writebackDone,
    writebackFailed,
    writebackTotal,
    ...(currentModule ? { currentModule } : {}),
  });
}

async function processWritebackJob(job: TranslationV4Job): Promise<void> {
  const { shopName, id: jobId, target } = job;
  const shopDomain = job.shopName;
  const blobPrefix = job.blobPrefix || `tasks/v4/${shopName}/${jobId}`;
  const progressPath = `${blobPrefix}/writeback/progress.json`;
  const failedPath = `${blobPrefix}/writeback/failed.json`;
  const modules = jobModulesWithLiquid(job);

  // Load existing progress for resume support (idempotent re-entry after crash)
  const existingProgress = await blobRead<{ written: string[] }>(progressPath);
  const writtenSet = new Set<string>(existingProgress?.written ?? []);

  // JS is single-threaded: these counters are mutated synchronously between
  // await points — safe to share across pAll callbacks without a mutex.
  let writebackDone = writtenSet.size;
  let writebackFailed = 0;
  const writebackTotal = job.metrics.writebackTotal || job.metrics.translateDone;
  const failedResources: FailedResource[] = [];
  let lastHeartbeatAt = 0;
  const stageStartedAt = new Date().toISOString(); // ISO span start for stageTimings

  const maybeHeartbeat = async () => {
    const now = Date.now();
    if (now - lastHeartbeatAt > HEARTBEAT_THROTTLE_MS) {
      lastHeartbeatAt = now;
      await heartbeat(shopName, jobId);
    }
  };

  let shutdownYield = false;

  /** Custom Liquid → Turso LiquidRule（不经 Shopify），串行写一批。 */
  const writeLiquidBatch = async (items: TranslatedItem[]): Promise<void> => {
    for (const resource of items) {
      if (isShuttingDown()) {
        shutdownYield = true;
        return;
      }
      await maybeHeartbeat();
      const fields = filterWritebackFields(resource.translations, CUSTOM_LIQUID_MODULE);
      const field = fields.find((t) => t.key === "liquid") ?? fields[0];
      const translated = (field?.translatedValue ?? "").trim();
      if (!translated) {
        writtenSet.add(resource.resourceId);
        writebackDone++;
      } else {
        const ok = await completeLiquidRuleWriteback({
          shop: shopName,
          ruleId: resource.resourceId,
          afterTranslation: translated,
          jobId,
        });
        if (ok) {
          writtenSet.add(resource.resourceId);
          writebackDone++;
        } else {
          writebackFailed++;
          failedResources.push({
            resourceId: resource.resourceId,
            translations: [
              {
                locale: target,
                key: "liquid",
                value: translated,
                translatableContentDigest: field?.digest ?? "",
              },
            ],
          });
        }
      }
      if ((writebackDone + writebackFailed) % 20 === 0) {
        await blobWrite(progressPath, { written: [...writtenSet] });
      }
      await setProgress(jobId, {
        writebackDone,
        writebackFailed,
        writebackTotal,
        currentModule: CUSTOM_LIQUID_MODULE,
      });
    }
  };

  /** Shopify 写回一批，并发由 runShopifyAdaptive 按 429/cost 反馈自适应。 */
  const writeShopifyBatch = async (
    module: string,
    items: TranslatedItem[],
  ): Promise<void> => {
    await runShopifyAdaptive(shopDomain, items, async (resource) => {
      if (isShuttingDown()) {
        shutdownYield = true;
        return;
      }

      await maybeHeartbeat();

      const translations: TranslationInput[] = filterWritebackFields(
        resource.translations,
        module,
      ).map((t) => ({
        locale: target,
        key: t.key,
        value: t.translatedValue,
        translatableContentDigest: t.digest,
      }));

      // Nothing to write for this resource (all fields unchanged / empty)
      if (!translations.length) {
        writtenSet.add(resource.resourceId);
        writebackDone++;
        await setProgress(jobId, {
          writebackDone,
          writebackFailed,
          writebackTotal,
          currentModule: module,
        });
        return;
      }

      const result = await registerTranslations(
        shopDomain,
        resource.resourceId,
        translations,
      );

      if (result.success) {
        writtenSet.add(resource.resourceId);
        writebackDone++;
      } else {
        writebackFailed++;
        failedResources.push({
          resourceId: resource.resourceId,
          translations,
          userErrors: result.userErrors,
        });
        console.warn(
          `[writeback] resource ${resource.resourceId} errors:`,
          result.userErrors,
        );
      }

      if ((writebackDone + writebackFailed) % 20 === 0) {
        await blobWrite(progressPath, { written: [...writtenSet] });
      }

      await setProgress(jobId, {
        writebackDone,
        writebackFailed,
        writebackTotal,
        currentModule: module,
      });
    });
  };

  try {
    // ── Phase 1+2: 按 module 分批流式写回 ──────────────────────────────────────
    // 不再把全店译文一次读进内存（大店会顶到 OOM）：每批处理完即可释放。
    // 续跑时 writtenSet 里的资源在**下载前**就被 skipResourceId 挡掉，
    // 不会把已写回的译文内容重新拉一遍。
    await maybeHeartbeat();
    console.log(
      `[writeback] job=${jobId} start modules=${modules.length} done=${writebackDone}/${writebackTotal} concurrency=${getShopifyCap(shopDomain)}(adaptive)`,
    );

    let shopifyWritten = 0;
    let liquidWritten = 0;

    for (const module of modules) {
      if (isShuttingDown()) {
        shutdownYield = true;
        break;
      }
      await maybeHeartbeat();

      for await (const batch of iterateTranslatedItemsForModule(blobPrefix, module, {
        skipResourceId: (id) => writtenSet.has(id),
      })) {
        if (isShuttingDown()) {
          shutdownYield = true;
          break;
        }
        // 批与批之间可能有重复（legacy chunk 与 per-resource blob 重叠已在
        // generator 内去重，这里只挡本轮刚写过的）。
        const pending = batch.filter((r) => !writtenSet.has(r.resourceId));
        if (!pending.length) continue;

        if (module === CUSTOM_LIQUID_MODULE) {
          liquidWritten += pending.length;
          await writeLiquidBatch(pending);
        } else {
          shopifyWritten += pending.length;
          await writeShopifyBatch(module, pending);
        }
        if (shutdownYield) break;
      }
      if (shutdownYield) break;
    }

    console.log(
      `[writeback] job=${jobId} processed shopify=${shopifyWritten} liquid=${liquidWritten}`,
    );

    if (shutdownYield || isShuttingDown()) {
      await persistWritebackCheckpoint(
        jobId,
        progressPath,
        writtenSet,
        writebackDone,
        writebackFailed,
        writebackTotal,
      );
      console.log(
        `[writeback] job=${jobId} yielding for shutdown written=${writebackDone}/${writebackTotal}`,
      );
      return;
    }

    // ── Phase 3: Finalise ─────────────────────────────────────────────────────
    await blobWrite(progressPath, { written: [...writtenSet] });

    const latestJob = await getJob(shopName, jobId);
    const updatedMetrics = {
      ...(latestJob?.metrics ?? job.metrics),
      writebackDone,
      writebackFailed,
    };

    await blobWrite(failedPath, failedResources);

    const writebackTiming = withStageTiming(
      latestJob?.stageTimings ?? job.stageTimings,
      "WRITEBACK",
      stageStartedAt,
      new Date().toISOString(),
    );

    // 本次写回是「暂停/取消时先写回已翻译」触发的 → 写回完成后据意图收尾。
    const pauseIntent = latestJob?.pauseAfterWriteback ?? job.pauseAfterWriteback;
    if (pauseIntent === "pause" || pauseIntent === "cancel") {
      const terminalStatus = pauseIntent === "cancel" ? "CANCELLED" : "PAUSED";
      // 取消：未写完的 Liquid 回 PENDING；暂停：保留 TRANSLATING+jobId 供续跑
      if (pauseIntent === "cancel" && job.includeLiquid) {
        await releaseLiquidRulesForJob({ shop: shopName, jobId }).catch(() => 0);
      }
      await updateJob(shopName, jobId, {
        status: terminalStatus,
        claimedBy: null,
        // pause：errorStage=TRANSLATE，resume 时重新入队翻译续译剩余资源。
        errorStage: pauseIntent === "pause" ? "TRANSLATE" : null,
        errorMessage:
          pauseIntent === "pause"
            ? (latestJob?.errorMessage ?? job.errorMessage)
            : null,
        pauseAfterWriteback: null, // 消费意图
        stageTimings: writebackTiming,
        metrics: updatedMetrics,
      });
      await recordJobUsageSnapshot(
        {
          ...(latestJob ?? job),
          status: terminalStatus,
          metrics: updatedMetrics,
          stageTimings: writebackTiming,
          engineUsage: latestJob?.engineUsage ?? job.engineUsage,
        },
        terminalStatus,
      );
      console.log(
        `[writeback] done job=${jobId} written=${writebackDone} failed=${writebackFailed} → ${terminalStatus}（暂停/取消时已写回已翻译）`,
      );
      return;
    }

    await finalizeJobAfterWriteback(job, {
      writebackDone,
      writebackFailed,
      failedResources,
      metrics: updatedMetrics,
      stageTimings: writebackTiming,
    });
    if (job.includeLiquid) {
      await releaseLiquidRulesForJob({ shop: shopName, jobId }).catch(() => 0);
    }
    console.log(
      `[writeback] done job=${jobId} written=${writebackDone} failed=${writebackFailed} → finalized`,
    );
  } catch (e) {
    if (isShuttingDown()) {
      await persistWritebackCheckpoint(
        jobId,
        progressPath,
        writtenSet,
        writebackDone,
        writebackFailed,
        writebackTotal,
      ).catch(() => {});
      console.log(`[writeback] job=${jobId} yielding for shutdown (error path)`);
      return;
    }
    const detail = e instanceof Error ? e.message : String(e);
    const failTimings = withStageTiming(
      job.stageTimings,
      "WRITEBACK",
      stageStartedAt,
      new Date().toISOString(),
    );
    const latestFail = await getJob(shopName, jobId).catch(() => null);
    if (job.includeLiquid) {
      await releaseLiquidRulesForJob({ shop: shopName, jobId }).catch(() => 0);
    }
    await updateJob(shopName, jobId, {
      status: "FAILED",
      errorMessage: V4_MESSAGE_JOB_FAILED,
      errorStage: "WRITEBACK",
      claimedBy: null,
      pauseAfterWriteback: null, // 清掉暂停意图，避免下次写回被误判
      stageTimings: failTimings,
    });
    await recordJobUsageSnapshot(
      {
        ...(latestFail ?? job),
        status: "FAILED",
        stageTimings: failTimings,
      },
      "FAILED",
    );
    console.error(`[writeback] failed job=${jobId}`, detail, e);
  } finally {
    await wakeNextWritebackForShop(shopName).catch((e) => {
      console.warn(`[writeback] wakeNext failed shop=${shopName}`, e);
    });
  }
}
