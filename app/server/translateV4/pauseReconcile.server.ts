import { updateV4Job, type V4JobSummaryDoc } from "./cosmos.server";
import {
  clearV4Control,
  clearV4PausePending,
} from "./redis.server";
import type { TranslationV4MergedMetrics } from "./progress.server";
import { reconcileTranslateUnitMetrics } from "./metricsUtils";
import { EMPTY_V4_METRICS, type TranslationV4Job } from "./types";
import { sanitizeV4UserErrorMessage } from "./userFacingMessages.server";
import { V4_MESSAGE_MANUAL_PAUSE } from "~/shared/translateV4MessageTokens";

/** worker 未能在该时长内收尾暂停 → TSF 直接落 PAUSED（不再先写回）。 */
const STUCK_PAUSE_ESCALATE_MS = 120_000;

/**
 * 暂停后 worker 应直接 PAUSED，但若卡在 LLM 长尾，控制键会一直 pending。
 * 超时后由 TSF 代为落盘 PAUSED，避免任务长期停在 TRANSLATING。
 */
export async function escalateStuckPauseIfNeeded(
  shopName: string,
  job: V4JobSummaryDoc,
  metrics: TranslationV4MergedMetrics,
): Promise<TranslationV4Job | null> {
  const jobMetrics = job.metrics ?? EMPTY_V4_METRICS;
  if (job.status !== "TRANSLATING") return null;

  const pauseRequested =
    metrics.pausePending || metrics.controlAction === "pause";
  if (!pauseRequested) return null;

  const requestedAt =
    Number(metrics.pauseRequestedAt) ||
    (metrics.controlAction === "pause" || metrics.pausePending
      ? Date.now() - STUCK_PAUSE_ESCALATE_MS - 1
      : 0);
  if (!requestedAt || Date.now() - requestedAt < STUCK_PAUSE_ESCALATE_MS) {
    return null;
  }

  const translateDone = Math.max(
    metrics.translateDone,
    Number(jobMetrics.translateDone) || 0,
  );
  const units = reconcileTranslateUnitMetrics({
    translateDone,
    translateTotal: metrics.translateTotal,
    translateUnitDone: metrics.translateUnitDone,
    translateUnitTotal: metrics.translateUnitTotal,
    initTotal: metrics.initTotal,
  });

  const updated = await updateV4Job(shopName, job.id, {
    status: "PAUSED",
    claimedBy: null,
    pauseAfterWriteback: null,
    errorMessage:
      sanitizeV4UserErrorMessage(metrics.pauseReason) ?? V4_MESSAGE_MANUAL_PAUSE,
    errorStage: "TRANSLATE",
    metrics: {
      ...jobMetrics,
      initTotal: metrics.initTotal,
      initDone: metrics.initDone,
      translateTotal: metrics.translateTotal,
      translateDone,
      translateFailed: metrics.translateFailed,
      translateFallback: metrics.translateFallback,
      translateUnitTotal: units.translateUnitTotal,
      translateUnitDone: units.translateUnitDone,
      usedTokens: metrics.usedTokens,
    },
  });
  if (!updated) return null;

  await clearV4Control(job.id);
  await clearV4PausePending(job.id);

  console.log(
    `[translateV4] escalated stuck pause → PAUSED task=${job.id} translateDone=${translateDone}`,
  );
  return updated;
}
