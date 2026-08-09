import { updateV4Job, type V4JobSummaryDoc } from "./cosmos.server";
import {
  clearV4Control,
  getTranslateV4RedisClient,
  v4HintKey,
} from "./redis.server";
import type { TranslationV4MergedMetrics } from "./progress.server";
import {
  translateResourcesComplete,
  writebackNeedsRetry,
  writebackResourceTotal,
} from "./resumeStatus";
import { reconcileTranslateUnitMetrics } from "./metricsUtils";
import {
  isAutoV4TaskSource,
  type TranslationV4Job,
  type TranslationV4Metrics,
} from "./types";

/**
 * 翻译资源已全部完成，但 Cosmos 仍停在 TRANSLATING/TRANSLATE_QUEUED（常见于额度暂停→
 * 充值续跑后 worker 竞态或 stale-reset）。由 TSF 代为推进到写回队列。
 */
export async function escalateStuckTranslatingToWritebackIfNeeded(
  shopName: string,
  job: V4JobSummaryDoc,
  metrics: TranslationV4MergedMetrics,
): Promise<TranslationV4Job | null> {
  if (job.status !== "TRANSLATING" && job.status !== "TRANSLATE_QUEUED") {
    return null;
  }
  if (!translateResourcesComplete(metrics)) return null;
  if (
    metrics.pausePending ||
    metrics.controlAction === "pause" ||
    metrics.controlAction === "cancel"
  ) {
    return null;
  }

  const writebackTotal = writebackResourceTotal(metrics);
  if (!writebackNeedsRetry({ ...metrics, writebackTotal })) {
    return null;
  }

  const translateDone = metrics.translateDone;
  const units = reconcileTranslateUnitMetrics(metrics);
  const updated = await updateV4Job(shopName, job.id, {
    status: "WRITEBACK_QUEUED",
    claimedBy: null,
    pauseAfterWriteback: null,
    errorStage: null,
    errorMessage: null,
    metrics: {
      ...job.metrics,
      initTotal: metrics.initTotal,
      initDone: metrics.initDone,
      translateTotal: metrics.translateTotal,
      translateDone,
      translateFailed: metrics.translateFailed,
      translateFallback: metrics.translateFallback,
      translateUnitTotal: units.translateUnitTotal,
      translateUnitDone: units.translateUnitDone,
      writebackTotal,
      writebackDone: metrics.writebackDone,
      writebackFailed: metrics.writebackFailed,
      usedTokens: metrics.usedTokens,
    },
  });
  if (!updated) return null;

  await clearV4Control(job.id);

  try {
    const pool = isAutoV4TaskSource(job.taskSource) ? "auto" : "manual";
    await getTranslateV4RedisClient().lpush(
      v4HintKey("writeback", pool),
      JSON.stringify({ taskId: job.id, shopName }),
    );
  } catch {
    // non-fatal
  }

  console.log(
    `[translateV4] escalated stuck translate → WRITEBACK_QUEUED task=${job.id} translateDone=${translateDone} writeback=${metrics.writebackDone}/${writebackTotal}`,
  );
  return updated;
}

/** UI：状态仍为翻译态，但资源级翻译已完成且写回尚未结束。 */
export function isTranslateCompleteButWritebackPending(
  status: TranslationV4Job["status"],
  metrics: TranslationV4Metrics,
): boolean {
  if (status !== "TRANSLATING" && status !== "TRANSLATE_QUEUED") return false;
  if (!translateResourcesComplete(metrics)) return false;
  const writebackTotal = writebackResourceTotal(metrics);
  return writebackNeedsRetry({ ...metrics, writebackTotal });
}
