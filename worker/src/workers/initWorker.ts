import { hostname } from "os";
import {
  claimJob,
  updateJob,
  heartbeat,
  getJob,
  withStageTiming,
  countShopInitializingJobs,
  findInitQueuedJobsForShop,
  TSF_AUTO_TASK_SOURCE,
  type TranslationV4Job,
} from "../services/cosmosV4.js";
import { pushHint, setProgress, type HintPayload } from "../services/redisV4.js";
import { claimNextJobWithFairScheduling } from "../services/fairStageClaim.js";
import { blobWrite } from "../services/blobV4.js";
import { purgeAutoJob } from "../services/autoJobCleanup.js";
import { runBulkInitModules } from "../services/shopifyBulkFetch.js";
import { countFieldUnits } from "../services/llmTranslate.js";
import {
  stagePoolKindForJob,
  stageSlots,
  type StagePoolKind,
} from "../services/stagePool.js";
import { isShuttingDown } from "../shutdown.js";
import { recordJobUsageSnapshot } from "../services/recordJobUsageSnapshot.js";
import {
  CUSTOM_LIQUID_MODULE,
  claimPendingLiquidRules,
  jobModulesWithLiquid,
  liquidRulesToInitChunk,
  releaseLiquidRulesForJob,
} from "../services/customLiquid.js";
import {
  V4_MESSAGE_INIT_REQUEUING,
  V4_MESSAGE_JOB_FAILED,
} from "../services/userFacingMessages.js";

/**
 * Scale-out safe: hostname + pid ensures uniqueness across containers that may
 * share the same pid (e.g. Node process always starts at pid 1 in Docker).
 */
const WORKER_ID = `init-${process.env.HOSTNAME ?? hostname()}-${process.pid}`;

/** Retained for bulk init chunking signature; chunking is byte-sized only. */
const CHUNK_SIZE = 0;
const HEARTBEAT_THROTTLE_MS = 30_000;

const INIT_MAX_REQUEUE = Math.max(0, Number(process.env.INIT_MAX_REQUEUE) || 5);

/**
 * 进程级 init 并发：自动与手动各占独立池（自动默认 3 店、手动默认 5 店）。
 * 跨店公平调度见 fairStageClaim.ts；同店 init 串行由 tryClaimInitJob 保证。
 */

/** Max stale/busy hints to drain per tick before falling back to Cosmos scan. */
const INIT_HINT_DRAIN_MAX = Math.max(1, Number(process.env.INIT_HINT_DRAIN_MAX) || 32);
const INIT_CLAIM_SCAN_BATCH = Math.max(
  10,
  Number(process.env.INIT_CLAIM_SCAN_BATCH) || 50,
);
const INIT_CLAIM_SCAN_MAX_BATCHES = Math.max(
  1,
  Number(process.env.INIT_CLAIM_SCAN_MAX_BATCHES) || 5,
);

function collectInitErrorStrings(error: unknown): string[] {
  const strings: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current != null && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      strings.push(current.message);
      const code = (current as NodeJS.ErrnoException).code;
      if (typeof code === "string") strings.push(code);
      if (current instanceof AggregateError) {
        for (const inner of current.errors) {
          strings.push(...collectInitErrorStrings(inner));
        }
      }
      current = current.cause;
    } else if (typeof current === "string") {
      strings.push(current);
      break;
    } else {
      strings.push(String(current));
      break;
    }
  }
  return strings;
}

function isRecoverableInitError(error: unknown): boolean {
  const text = collectInitErrorStrings(error).join("\n");
  return (
    /THROTTLED|429|rate limit/i.test(text) ||
    /HTTP.*502|HTTP.*503|HTTP.*504|HTTP.*522|SERVER_ERROR/i.test(text) ||
    /ETIMEDOUT|ECONNRESET/i.test(text)
  );
}

function initRequeueLabel(error: unknown): string {
  const text = collectInitErrorStrings(error).join("\n");
  if (/THROTTLED|429|rate limit/i.test(text)) return "限流";
  if (/HTTP.*502|HTTP.*503|HTTP.*504|HTTP.*522|SERVER_ERROR/i.test(text)) return "Shopify 暂时不可用";
  if (/ETIMEDOUT|ECONNRESET/i.test(text)) return "网络超时";
  return "暂时失败";
}

async function completeEmptyInitJob(
  job: TranslationV4Job,
  jobId: string,
  shopName: string,
  blobPrefix: string,
  stageStartedAt: string,
  manifest: Record<string, { totalItems: number; chunks: number }>,
): Promise<void> {
  // 自动任务无增量：直接删记录，避免任务列表堆积 0 条 COMPLETED
  if (job.taskSource === TSF_AUTO_TASK_SOURCE) {
    await purgeAutoJob({ id: jobId, shopName, blobPrefix });
    console.log(
      `[init] done job=${jobId} totalItems=0 — 自动任务无增量，已删除记录`,
    );
    return;
  }

  await blobWrite(`${blobPrefix}/manifest.json`, {
    taskId: jobId,
    shopName,
    source: job.source,
    target: job.target,
    modules: manifest,
    createdAt: new Date().toISOString(),
    empty: true,
  });

  const emptyMetrics = {
    ...job.metrics,
    initTotal: 0,
    initDone: 0,
    translateTotal: 0,
    translateDone: 0,
    translateUnitTotal: 0,
    translateUnitDone: 0,
    writebackTotal: 0,
    writebackDone: 0,
    verifyTotal: 0,
    verifyDone: 0,
  };
  const emptyTimings = withStageTiming(
    job.stageTimings,
    "INIT",
    stageStartedAt,
    new Date().toISOString(),
  );
  await updateJob(shopName, jobId, {
    status: "COMPLETED",
    claimedBy: null,
    errorMessage: null,
    errorStage: null,
    stageTimings: emptyTimings,
    metrics: emptyMetrics,
  });

  await setProgress(jobId, {
    initTotal: 0,
    initDone: 0,
    translateUnitTotal: 0,
    translateUnitDone: 0,
    writebackTotal: 0,
    writebackDone: 0,
    verifyTotal: 0,
    verifyDone: 0,
    initModulesTotal: job.modules.length,
    initModulesDone: job.modules.length,
    initActiveModules: "[]",
    initPhase: "",
  });

  await recordJobUsageSnapshot(
    {
      ...job,
      status: "COMPLETED",
      metrics: emptyMetrics,
      stageTimings: emptyTimings,
    },
    "COMPLETED",
  );

  console.log(
    `[init] done job=${jobId} totalItems=0 — 无待翻译增量（可能已全部译完或非覆盖模式无 outdated/空译文 字段）→ COMPLETED`,
  );
}

export async function runInitWorker(): Promise<void> {
  if (!stageSlots.anyCapacity("init")) return;

  let claimed: TranslationV4Job | null = null;
  let poolKind: StagePoolKind | null = null;
  let slotHeld = false;
  try {
    claimed = await claimNextInitJob();
    if (!claimed) return;

    poolKind = stagePoolKindForJob(claimed);
    if (!stageSlots.tryAcquire("init", poolKind)) {
      await updateJob(claimed.shopName, claimed.id, {
        status: "INIT_QUEUED",
        claimedBy: null,
      });
      await pushHint(
        "init",
        { taskId: claimed.id, shopName: claimed.shopName },
        poolKind,
      );
      return;
    }
    slotHeld = true;

    console.log(
      `[init] processing job=${claimed.id} shop=${claimed.shopName} pool=${poolKind} (${stageSlots.formatActive("init")})`,
    );
    await processInitJob(claimed.id, claimed.shopName);
  } catch (e) {
    if (claimed) console.error(`[init] job ${claimed.id} failed`, e);
    else console.error("[init] claim failed", e);
  } finally {
    if (poolKind && slotHeld) {
      stageSlots.release("init", poolKind);
      if (stageSlots.anyCapacity("init")) {
        void runInitWorker().catch((e) =>
          console.error("[init] wake on slot free failed", e),
        );
      }
    }
  }
}

async function wakeNextInitForShop(shopName: string): Promise<void> {
  if ((await countShopInitializingJobs(shopName)) > 0) return;
  const [next] = await findInitQueuedJobsForShop(shopName, 1);
  if (!next) return;
  await pushHint("init", { taskId: next.id, shopName }, stagePoolKindForJob(next));
  void runInitWorker().catch((e) =>
    console.error(`[init] wake next failed shop=${shopName}`, e),
  );
  console.log(
    `[init] shop=${shopName} slot free → queued next job=${next.id} ${next.source}->${next.target}`,
  );
}

/**
 * 同 shop 同一时间只允许一个 INITIALIZING（不同 target 共享 Shopify rate-limit bucket）。
 * 返回 null 表示该 shop 已有 INIT 在跑，或 claim 失败。
 */
async function tryClaimInitJob(
  shopName: string,
  taskId: string,
): Promise<TranslationV4Job | null> {
  if ((await countShopInitializingJobs(shopName)) > 0) {
    return null;
  }
  const job = await claimJob(
    shopName,
    taskId,
    "INIT_QUEUED",
    "INITIALIZING",
    WORKER_ID,
  );
  if (!job) return null;
  const active = await countShopInitializingJobs(shopName);
  if (active > 1) {
    await updateJob(shopName, job.id, { status: "INIT_QUEUED", claimedBy: null });
    console.log(
      `[init] yield duplicate claim job=${job.id} shop=${shopName} (${active} INITIALIZING)`,
    );
    return null;
  }
  return job;
}

async function isStaleInitHint(hint: HintPayload): Promise<boolean> {
  const job = await getJob(hint.shopName, hint.taskId);
  if (!job) return true;
  return job.status !== "INIT_QUEUED";
}

async function isShopInitBusy(shopName: string): Promise<boolean> {
  return (await countShopInitializingJobs(shopName)) > 0;
}

async function claimNextInitJob(): Promise<TranslationV4Job | null> {
  return claimNextJobWithFairScheduling({
    stage: "init",
    hintKey: "init",
    drainMax: INIT_HINT_DRAIN_MAX,
    queuedStatus: "INIT_QUEUED",
    logTag: "init",
    scanBatch: INIT_CLAIM_SCAN_BATCH,
    scanMaxBatches: INIT_CLAIM_SCAN_MAX_BATCHES,
    isStaleHint: isStaleInitHint,
    isShopBusy: isShopInitBusy,
    tryClaimJob: tryClaimInitJob,
  });
}

async function processInitJob(jobId: string, shopName: string): Promise<void> {
  const job = await getJob(shopName, jobId);
  if (!job) return;

  if (isShuttingDown()) {
    if (job.claimedBy === WORKER_ID) {
      await updateJob(shopName, jobId, {
        status: "INIT_QUEUED",
        claimedBy: null,
        errorStage: null,
        errorMessage: null,
      });
      await pushHint(
        "init",
        { taskId: jobId, shopName },
        stagePoolKindForJob(job),
      );
    }
    return;
  }

  if (job.status !== "INITIALIZING" || job.claimedBy !== WORKER_ID) {
    console.log(
      `[init] skip stale processInitJob job=${jobId} status=${job.status} claimedBy=${job.claimedBy ?? "null"}`,
    );
    return;
  }

  const shopDomain = job.shopName;
  const blobPrefix = `tasks/v4/${shopName}/${jobId}`;

  await updateJob(shopName, jobId, { blobPrefix });

  const stageStartedAt = new Date().toISOString(); // ISO span start for stageTimings
  const manifest: Record<string, { totalItems: number; chunks: number }> = {};
  // JS is single-threaded: these are mutated synchronously between await
  // points inside adaptive callbacks — safe without a mutex.
  let totalItems = 0;
  let totalUnits = 0;
  let lastHeartbeatAt = 0;
  const effectiveModules = jobModulesWithLiquid(job);
  const shopifyModules = job.modules.filter((m) => m !== CUSTOM_LIQUID_MODULE);
  const initModulesTotal = effectiveModules.length;
  let initModulesDone = 0;
  const activeModules = new Map<string, "querying" | "saving">();
  const completedModules: Array<{ module: string; items: number }> = [];
  const completedSet = new Set<string>();

  const flushInitActivity = async (
    extra: Record<string, string | number> = {},
  ) => {
    await setProgress(jobId, {
      initModulesTotal,
      initModulesDone,
      initActiveModules: JSON.stringify(
        [...activeModules.entries()].map(([module, phase]) => ({
          module,
          phase,
        })),
      ),
      initCompletedModules: JSON.stringify(completedModules),
      initDone: totalItems,
      ...extra,
    });
  };

  const setModulePhase = async (
    module: string,
    phase: "querying" | "saving",
  ) => {
    if (completedSet.has(module)) return;
    activeModules.set(module, phase);
    await flushInitActivity({ currentModule: module });
  };

  const completeModule = async (
    module: string,
    moduleItemCount: number,
    moduleChunkCount: number,
    moduleUnits: number,
  ) => {
    if (completedSet.has(module)) return;
    // Accumulate into shared totals. These += happen synchronously (no await
    // between read and write) so they are safe despite interleaved async work.
    if (moduleItemCount > 0 || moduleChunkCount > 0) {
      manifest[module] = {
        totalItems: moduleItemCount,
        chunks: moduleChunkCount,
      };
    }
    totalItems += moduleItemCount;
    totalUnits += moduleUnits;
    activeModules.delete(module);
    completedSet.add(module);
    initModulesDone += 1;
    completedModules.push({ module, items: moduleItemCount });
    await flushInitActivity({ currentModule: module, initPhase: "" });
    await throttledHeartbeat();
  };

  const throttledHeartbeat = async () => {
    const now = Date.now();
    // Synchronous guard update before the async heartbeat call prevents
    // concurrent module callbacks from triggering duplicate heartbeats.
    if (now - lastHeartbeatAt > HEARTBEAT_THROTTLE_MS) {
      lastHeartbeatAt = now;
      await heartbeat(shopName, jobId);
    }
  };

  await flushInitActivity({ initPhase: "" });

  try {
    console.log(
      `[init] job=${jobId} fetch=bulk modules=${shopifyModules.length} includeLiquid=${Boolean(job.includeLiquid)} shop=${shopDomain}`,
    );
    const bulkUnitsByModule = new Map<string, number>();
    if (shopifyModules.length > 0) {
      await runBulkInitModules({
        shopDomain,
        modules: shopifyModules,
        limitPerType: job.limitPerType,
        chunkSize: CHUNK_SIZE,
        options: {
          targetLocale: job.target,
          isCover: job.isCover,
          isHandle: job.isHandle,
        },
        onHeartbeat: throttledHeartbeat,
        isShutdown: isShuttingDown,
        writeChunk: async (module, chunkIndex, chunk) => {
          let units = bulkUnitsByModule.get(module) ?? 0;
          for (const r of chunk) {
            for (const f of r.fields) {
              units += countFieldUnits(f.key, f.value, f.shopifyType);
            }
          }
          bulkUnitsByModule.set(module, units);
          await blobWrite(
            `${blobPrefix}/init/${module}/chunk-${String(chunkIndex).padStart(5, "0")}.json`,
            chunk,
          );
        },
        onModuleStart: async (module) => {
          await setModulePhase(module, "querying");
        },
        onModulePhase: async (module, phase) => {
          await setModulePhase(module, phase);
        },
        onModuleComplete: async ({ module, totalItems: moduleItemCount, chunks }) => {
          if (moduleItemCount === 0) {
            console.log(`[init] module=${module} 0 items, skipping`);
            await completeModule(module, 0, 0, 0);
            return;
          }
          console.log(
            `[init] module=${module} items=${moduleItemCount} chunks=${chunks} fetch=bulk`,
          );
          const moduleUnits = bulkUnitsByModule.get(module) ?? 0;
          await completeModule(module, moduleItemCount, chunks, moduleUnits);
        },
      });
    }

    // Custom Liquid: claim PENDING Turso rows → virtual CUSTOM_LIQUID init blobs
    if (job.includeLiquid) {
      await setModulePhase(CUSTOM_LIQUID_MODULE, "querying");
      try {
        const rules = await claimPendingLiquidRules({
          shop: shopName,
          languageCode: job.target,
          jobId,
        });
        if (!rules.length) {
          console.log(`[init] module=${CUSTOM_LIQUID_MODULE} 0 pending rows`);
          await completeModule(CUSTOM_LIQUID_MODULE, 0, 0, 0);
        } else {
          await setModulePhase(CUSTOM_LIQUID_MODULE, "saving");
          const resources = liquidRulesToInitChunk(rules);
          const LIQUID_CHUNK_SIZE = 200;
          let chunkCount = 0;
          let moduleUnits = 0;
          for (let i = 0; i < resources.length; i += LIQUID_CHUNK_SIZE) {
            const chunk = resources.slice(i, i + LIQUID_CHUNK_SIZE);
            for (const r of chunk) {
              for (const f of r.fields) {
                moduleUnits += countFieldUnits(f.key, f.value, f.shopifyType);
              }
            }
            await blobWrite(
              `${blobPrefix}/init/${CUSTOM_LIQUID_MODULE}/chunk-${String(chunkCount).padStart(5, "0")}.json`,
              chunk,
            );
            chunkCount += 1;
          }
          console.log(
            `[init] module=${CUSTOM_LIQUID_MODULE} items=${resources.length} chunks=${chunkCount}`,
          );
          await completeModule(
            CUSTOM_LIQUID_MODULE,
            resources.length,
            chunkCount,
            moduleUnits,
          );
        }
      } catch (liquidErr) {
        console.error(`[init] CUSTOM_LIQUID failed job=${jobId}:`, liquidErr);
        await releaseLiquidRulesForJob({ shop: shopName, jobId }).catch(() => 0);
        throw liquidErr;
      }
    }

    // Ensure every selected module counts toward x/N even if a path skipped it.
    for (const module of effectiveModules) {
      if (!completedSet.has(module)) {
        await completeModule(module, 0, 0, 0);
      }
    }

    activeModules.clear();
    await flushInitActivity({ initPhase: "writing_manifest" });

    // ── Write manifest and advance status ────────────────────────────────────
    await blobWrite(`${blobPrefix}/manifest.json`, {
      taskId: jobId,
      shopName,
      source: job.source,
      target: job.target,
      modules: manifest,
      createdAt: new Date().toISOString(),
    });

    if (totalItems === 0) {
      await completeEmptyInitJob(job, jobId, shopName, blobPrefix, stageStartedAt, manifest);
      return;
    }

    await updateJob(shopName, jobId, {
      status: "TRANSLATE_QUEUED",
      claimedBy: null,
      stageTimings: withStageTiming(
        job.stageTimings,
        "INIT",
        stageStartedAt,
        new Date().toISOString(),
      ),
      metrics: {
        ...job.metrics,
        initTotal: totalItems,
        initDone: totalItems,
        translateTotal: totalItems,
        translateUnitTotal: totalUnits,
      },
    });

    await setProgress(jobId, {
      initTotal: totalItems,
      initDone: totalItems,
      translateUnitTotal: totalUnits,
      initModulesTotal,
      initModulesDone: initModulesTotal,
      initActiveModules: "[]",
      initCompletedModules: JSON.stringify(completedModules),
      initPhase: "",
    });

    await pushHint(
      "translate",
      { taskId: jobId, shopName },
      stagePoolKindForJob(job),
    );
    console.log(`[init] done job=${jobId} totalItems=${totalItems}`);
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    if (isShuttingDown() || /shutdown: init yielding/i.test(errorMessage)) {
      await updateJob(shopName, jobId, {
        status: "INIT_QUEUED",
        claimedBy: null,
        errorStage: null,
        errorMessage: null,
        stageTimings: withStageTiming(job.stageTimings, "INIT", stageStartedAt, new Date().toISOString()),
      });
      await pushHint(
        "init",
        { taskId: jobId, shopName },
        stagePoolKindForJob(job),
      );
      console.log(`[init] job=${jobId} yielding for shutdown → INIT_QUEUED`);
      return;
    }
    const initRequeues = job.metrics?.initRequeues ?? 0;
    if (isRecoverableInitError(e) && initRequeues < INIT_MAX_REQUEUE) {
      const next = initRequeues + 1;
      const reason = initRequeueLabel(e);
      await updateJob(shopName, jobId, {
        status: "INIT_QUEUED",
        claimedBy: null,
        errorStage: null,
        errorMessage: V4_MESSAGE_INIT_REQUEUING,
        metrics: { ...job.metrics, initRequeues: next },
        stageTimings: withStageTiming(job.stageTimings, "INIT", stageStartedAt, new Date().toISOString()),
      });
      const delayMs = Math.min(60_000, 3_000 * next);
      console.warn(
        `[init] recoverable (${reason}) job=${jobId} requeue in ${delayMs}ms (${next}/${INIT_MAX_REQUEUE})`,
      );
      setTimeout(() => {
        void pushHint("init", { taskId: jobId, shopName }, stagePoolKindForJob(job)).then(() =>
          runInitWorker().catch((err) =>
            console.error(`[init] requeue wake failed job=${jobId}`, err),
          ),
        );
      }, delayMs);
      return;
    }
    const detail = e instanceof Error ? e.message : String(e);
    await updateJob(shopName, jobId, {
      status: "FAILED",
      errorMessage: V4_MESSAGE_JOB_FAILED,
      errorStage: "INIT",
      claimedBy: null,
      stageTimings: withStageTiming(job.stageTimings, "INIT", stageStartedAt, new Date().toISOString()),
    });
    console.error(`[init] failed job=${jobId}`, detail, e);
  } finally {
    await wakeNextInitForShop(shopName).catch((e) => {
      console.warn(`[init] wakeNext failed shop=${shopName}`, e);
    });
  }
}
