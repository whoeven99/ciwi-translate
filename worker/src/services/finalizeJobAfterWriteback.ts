import {
  getJob,
  updateJob,
  type TranslationV4Job,
  type StageTimings,
} from "./cosmosV4.js";
import {
  COVERAGE_SUMMARY_MODULES,
  sumCoverageSummaryModules,
  type ModuleCount,
} from "./coverageSummary.js";
import { setItemsCount } from "./redisV4.js";
import { computeModuleCount } from "./itemsCount.js";
import { recordJobUsageSnapshot } from "./recordJobUsageSnapshot.js";
import { upsertLocaleCoverage } from "./localeCoverageTsf.js";
import { getOfflineAccessTokenFromTsf } from "./tsfDb.js";
import {
  V4_MESSAGE_QUOTA_INSUFFICIENT_PARTIAL,
  V4_MESSAGE_WRITEBACK_ALL_FAILED,
} from "./userFacingMessages.js";
import {
  reconcileBenignWritebackFailures,
  type WritebackFailedResource,
} from "./writebackUserErrors.js";

export type FinalizeAfterWritebackInput = {
  writebackDone: number;
  writebackFailed: number;
  failedResources?: WritebackFailedResource[];
  metrics?: TranslationV4Job["metrics"];
  stageTimings?: StageTimings | null;
};

/**
 * `computeModuleCount` 没有自己的节流/退避（直接裸 fetch 分页），所以不能对
 * 10-20 个 module 做无限制的 Promise.all（会瞬时打爆 Shopify 该店的 GraphQL
 * cost bucket，换来更多 429）。用一个小的并发上限把「串行 10-20 次」换成
 * 「批量 N 路并行」，兼顾提速和不触发限流。
 */
const MODULE_COUNT_CONCURRENCY = 4;

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (true) {
        const i = cursor++;
        if (i >= items.length) return;
        results[i] = await fn(items[i], i);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

/** 写回结束后直接收尾：COMPLETED / PAUSED / FAILED（不再进入校验）。 */
export async function finalizeJobAfterWriteback(
  job: TranslationV4Job,
  input: FinalizeAfterWritebackInput,
): Promise<void> {
  const { shopName, id: jobId } = job;
  const latestJob = await getJob(shopName, jobId);

  const reconciled = reconcileBenignWritebackFailures(
    input.writebackDone,
    input.writebackFailed,
    input.failedResources,
  );
  if (reconciled.reconciled) {
    console.log(
      `[finalize] job=${jobId} benign writeback failures treated as success count=${input.writebackFailed}`,
    );
  }

  const writebackDone = reconciled.writebackDone;
  const writebackFailed = reconciled.writebackFailed;

  const mergedMetrics = {
    ...(latestJob?.metrics ?? job.metrics),
    ...(input.metrics ?? {}),
    writebackDone,
    writebackFailed,
  };

  const initTotal = mergedMetrics.initTotal ?? job.metrics?.initTotal ?? 0;
  const nothingToTranslate = initTotal === 0;
  const wroteAnything = nothingToTranslate || writebackDone > 0;

  const tTotal = mergedMetrics.translateTotal ?? 0;
  const tAttempted =
    (mergedMetrics.translateDone ?? 0) + (mergedMetrics.translateFailed ?? 0);
  const translateIncomplete = wroteAnything && tTotal > 0 && tAttempted < tTotal;
  const finalStatus = translateIncomplete
    ? "PAUSED"
    : wroteAnything
      ? "COMPLETED"
      : "FAILED";

  if (finalStatus === "COMPLETED") {
    const accessToken = await getOfflineAccessTokenFromTsf(shopName);
    if (!accessToken) {
      console.warn(
        `[finalize] skip items_count job=${jobId}: Turso Session 中缺少 offline token`,
      );
    }
    const moduleCounts = new Map<string, ModuleCount>();
    const modulesToCount = [
      ...new Set<string>([...job.modules, ...COVERAGE_SUMMARY_MODULES]),
    ];
    if (accessToken) {
      const results = await mapWithConcurrency(
        modulesToCount,
        MODULE_COUNT_CONCURRENCY,
        async (module) => {
          try {
            const count = await computeModuleCount(
              shopName,
              accessToken,
              module,
              job.target,
            );
            const stored = await setItemsCount(
              shopName,
              job.target,
              module,
              count,
            );
            if (stored) {
              console.log(
                `[finalize] items_count job=${jobId} ${module} ${count.translated}/${count.total} stored`,
              );
            } else {
              console.warn(
                `[finalize] items_count job=${jobId} ${module} ${count.translated}/${count.total} redis unavailable`,
              );
            }
            return { module, count };
          } catch (e) {
            console.error(
              `[finalize] items_count job=${jobId} ${module} failed:`,
              e,
            );
            return null;
          }
        },
      );
      for (const r of results) {
        if (r) moduleCounts.set(r.module, r.count);
      }
    }

    if (accessToken && moduleCounts.size > 0) {
      try {
        const summary = sumCoverageSummaryModules(moduleCounts);
        await upsertLocaleCoverage({
          shop: shopName,
          locale: job.target,
          translated: summary.translated,
          total: summary.total,
          source: "finalize",
        });
        console.log(
          `[finalize] turso coverage job=${jobId} ${job.target} ${summary.translated}/${summary.total}`,
        );
      } catch (e) {
        console.error(`[finalize] turso coverage job=${jobId} failed:`, e);
      }
    }
  }

  const stageTimings =
    input.stageTimings ?? latestJob?.stageTimings ?? job.stageTimings;

  await updateJob(shopName, jobId, {
    status: finalStatus,
    errorStage: translateIncomplete
      ? "TRANSLATE"
      : wroteAnything
        ? undefined
        : "WRITEBACK",
    errorMessage: translateIncomplete
      ? V4_MESSAGE_QUOTA_INSUFFICIENT_PARTIAL
      : wroteAnything
        ? nothingToTranslate
          ? null
          : undefined
        : V4_MESSAGE_WRITEBACK_ALL_FAILED,
    claimedBy: null,
    stageTimings,
    metrics: mergedMetrics,
  });

  await recordJobUsageSnapshot(
    {
      ...(latestJob ?? job),
      status: finalStatus,
      metrics: mergedMetrics,
      stageTimings,
      engineUsage: latestJob?.engineUsage ?? job.engineUsage,
    },
    finalStatus,
  );

  console.log(
    `[finalize] job=${jobId} status=${finalStatus} written=${writebackDone} failed=${writebackFailed}`,
  );
}
