import type { TranslationJobProgressSummary } from "~/server/translateV4/progress.server";
import type {
  CreateTaskCreditsPurchaseContext,
  TranslateV4TaskCreditsPurchaseContext,
} from "~/utils/creditsPurchaseModal";

function clampNonNegativeInteger(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.ceil(value));
}

function estimateTaskRemainingCredits(
  job: TranslationJobProgressSummary,
): number | null {
  const totalResources = Math.max(
    Number(job.metrics.translateTotal) || 0,
    Number(job.metrics.initTotal) || 0,
  );
  const translatedResources = Math.max(Number(job.metrics.translateDone) || 0, 0);
  const translatedUnits = Math.max(Number(job.metrics.translateUnitDone) || 0, 0);
  const totalUnits = Math.max(Number(job.metrics.translateUnitTotal) || 0, 0);
  const usedCredits = Math.max(Math.round(job.usedTokens || 0), 0);
  const progressPercent = Math.max(Number(job.progressPercent) || 0, 0);

  if (totalResources <= 0) return null;
  if (translatedResources >= totalResources) return 0;
  if (usedCredits <= 0) return null;

  if (translatedResources > 0) {
    const estimatedTotalCredits = Math.ceil(
      (usedCredits * totalResources) / translatedResources,
    );
    return clampNonNegativeInteger(estimatedTotalCredits - usedCredits);
  }

  if (translatedUnits > 0 && totalUnits > 0) {
    const estimatedTotalCredits = Math.ceil(
      (usedCredits * totalUnits) / translatedUnits,
    );
    return clampNonNegativeInteger(estimatedTotalCredits - usedCredits);
  }

  if (progressPercent > 0) {
    const estimatedTotalCredits = Math.ceil(
      usedCredits / Math.min(progressPercent / 100, 1),
    );
    return clampNonNegativeInteger(estimatedTotalCredits - usedCredits);
  }

  return null;
}

export function buildTranslateV4TaskCreditsPurchaseContext(
  job: TranslationJobProgressSummary,
  currentRemainingCredits?: number | null,
): TranslateV4TaskCreditsPurchaseContext {
  const estimatedRemainingCredits = estimateTaskRemainingCredits(job);
  const normalizedRemaining =
    currentRemainingCredits == null
      ? null
      : clampNonNegativeInteger(currentRemainingCredits);
  const shortfallCredits =
    estimatedRemainingCredits == null
      ? null
      : clampNonNegativeInteger(
          estimatedRemainingCredits - (normalizedRemaining ?? 0),
        );

  return {
    kind: "translate_v4_task",
    taskId: job.taskId,
    source: job.source,
    target: job.target,
    estimatedRemainingCredits,
    currentRemainingCredits: normalizedRemaining,
    shortfallCredits,
  };
}

export function buildCreateTaskCreditsPurchaseContext(args: {
  estimatedCredits?: number | null;
  currentRemainingCredits?: number | null;
  targetsCount: number;
  modulesCount: number;
}): CreateTaskCreditsPurchaseContext {
  const estimatedCredits =
    args.estimatedCredits == null
      ? null
      : clampNonNegativeInteger(args.estimatedCredits);
  const normalizedRemaining =
    args.currentRemainingCredits == null
      ? null
      : clampNonNegativeInteger(args.currentRemainingCredits);
  const shortfallCredits =
    estimatedCredits == null
      ? null
      : clampNonNegativeInteger(estimatedCredits - (normalizedRemaining ?? 0));

  return {
    kind: "create_task",
    targetsCount: clampNonNegativeInteger(args.targetsCount),
    modulesCount: clampNonNegativeInteger(args.modulesCount),
    estimatedCredits,
    currentRemainingCredits: normalizedRemaining,
    shortfallCredits,
  };
}
