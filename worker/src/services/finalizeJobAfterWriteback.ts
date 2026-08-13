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
import { areAllUserErrorsTooManyTranslationKeys } from "./shopifyFetch.js";
import {
  V4_MESSAGE_QUOTA_INSUFFICIENT_PARTIAL,
  V4_MESSAGE_WRITEBACK_ALL_FAILED,
} from "./userFacingMessages.js";

export type WritebackFailedResource = {
  resourceId: string;
  userErrors?: Array<{ field: string; message: string }>;
};

export type FinalizeAfterWritebackInput = {
  writebackDone: number;
  writebackFailed: number;
  failedResources?: WritebackFailedResource[];
  metrics?: TranslationV4Job["metrics"];
  stageTimings?: StageTimings | null;
};

function shouldTreatWritebackFailuresAsKeyLimitSuccess(
  writebackFailed: number,
  failedResources: WritebackFailedResource[] | undefined,
): boolean {
  if (writebackFailed <= 0 || !failedResources?.length) return false;
  if (failedResources.length !== writebackFailed) return false;
  return failedResources.every((resource) =>
    areAllUserErrorsTooManyTranslationKeys(resource.userErrors ?? []),
  );
}

/** 写回结束后直接收尾：COMPLETED / PAUSED / FAILED（不再进入校验）。 */
export async function finalizeJobAfterWriteback(
  job: TranslationV4Job,
  input: FinalizeAfterWritebackInput,
): Promise<void> {
  const { shopName, id: jobId } = job;
  const latestJob = await getJob(shopName, jobId);

  let writebackDone = input.writebackDone;
  let writebackFailed = input.writebackFailed;
  if (
    shouldTreatWritebackFailuresAsKeyLimitSuccess(
      writebackFailed,
      input.failedResources,
    )
  ) {
    writebackDone += writebackFailed;
    writebackFailed = 0;
    console.log(
      `[finalize] job=${jobId} key-limit writeback failures treated as success count=${input.failedResources!.length}`,
    );
  }

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
    for (const module of modulesToCount) {
      if (!accessToken) break;
      try {
        const count = await computeModuleCount(
          shopName,
          accessToken,
          module,
          job.target,
        );
        moduleCounts.set(module, count);
        const stored = await setItemsCount(shopName, job.target, module, count);
        if (stored) {
          console.log(
            `[finalize] items_count job=${jobId} ${module} ${count.translated}/${count.total} stored`,
          );
        } else {
          console.warn(
            `[finalize] items_count job=${jobId} ${module} ${count.translated}/${count.total} redis unavailable`,
          );
        }
      } catch (e) {
        console.error(`[finalize] items_count job=${jobId} ${module} failed:`, e);
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
