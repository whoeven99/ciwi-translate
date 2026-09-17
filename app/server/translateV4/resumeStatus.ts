import type { TranslationV4Metrics, TranslationV4Status } from "./types";

/** 翻译是否尚未覆盖全部资源（如额度中途暂停只翻了一部分，仍有未触及资源）。 */
export function translateIncomplete(metrics: TranslationV4Metrics): boolean {
  const total = metrics.translateTotal ?? metrics.initTotal ?? 0;
  if (total <= 0) return false;
  const attempted = (metrics.translateDone ?? 0) + (metrics.translateFailed ?? 0);
  return attempted < total;
}

/** 全部资源均已翻译或标记失败（无剩余待译资源）。 */
export function translateResourcesComplete(metrics: TranslationV4Metrics): boolean {
  return !translateIncomplete(metrics) && (metrics.translateTotal ?? metrics.initTotal ?? 0) > 0;
}

/** 写回分母：优先 writebackTotal，否则在翻译已完成时用 translateDone。 */
export function writebackResourceTotal(metrics: TranslationV4Metrics): number {
  if (metrics.writebackTotal > 0) return metrics.writebackTotal;
  if (translateResourcesComplete(metrics) && metrics.translateDone > 0) {
    return metrics.translateDone;
  }
  return metrics.translateTotal || metrics.initTotal || 0;
}

/** 回写阶段是否仍有资源需要写入（含曾失败待重试的条目）。 */
export function writebackNeedsRetry(metrics: TranslationV4Metrics): boolean {
  const total = writebackResourceTotal(metrics);
  if (total <= 0) return false;
  const done = metrics.writebackDone ?? 0;
  const failed = metrics.writebackFailed ?? 0;
  if (done < total) return true;
  if (failed > 0) return true;
  return false;
}

/**
 * 从 PAUSED / FAILED 恢复时应进入的队列状态。
 * 回写未完成时优先 WRITEBACK。
 */
export function resolveResumeV4JobStatus(
  currentStatus: TranslationV4Status,
  errorStage: string | null,
  metrics: TranslationV4Metrics,
): TranslationV4Status | null {
  if (currentStatus !== "PAUSED" && currentStatus !== "FAILED") return null;

  const initTotal = metrics.initTotal ?? 0;
  const translateTotal = metrics.translateTotal ?? 0;
  const translateDone = metrics.translateDone ?? 0;
  // 从未初始化（或 metrics 丢失）：应回到 INIT，而不是 TRANSLATE（无 init blob 会空跑）。
  if (initTotal <= 0 && translateTotal <= 0 && translateDone <= 0) {
    if (errorStage === "WRITEBACK" && writebackNeedsRetry(metrics)) {
      return "WRITEBACK_QUEUED";
    }
    return "INIT_QUEUED";
  }

  // 翻译还没覆盖全部资源（如额度中途暂停）→ 优先回到翻译，补译剩余资源。
  // 必须在 writebackNeedsRetry 之前：否则会卡在写回循环（未翻译的资源永远写不出去）。
  if (translateIncomplete(metrics)) {
    return "TRANSLATE_QUEUED";
  }

  if (writebackNeedsRetry(metrics)) {
    return "WRITEBACK_QUEUED";
  }

  switch (errorStage) {
    case "TRANSLATE":
      return "TRANSLATE_QUEUED";
    case "WRITEBACK":
      return "WRITEBACK_QUEUED";
    case "VERIFY":
      return null;
    default:
      return "INIT_QUEUED";
  }
}

/** 当前状态所属的流水线阶段（暂停时记录，供 resume 回到正确队列）。 */
export function stageFromStatus(status: TranslationV4Status): string {
  if (["INIT_QUEUED", "INITIALIZING", "INIT_DONE"].includes(status)) return "INIT";
  if (["TRANSLATE_QUEUED", "TRANSLATING", "TRANSLATE_DONE"].includes(status)) return "TRANSLATE";
  if (["WRITEBACK_QUEUED", "WRITING_BACK"].includes(status)) return "WRITEBACK";
  if (["VERIFY_QUEUED", "VERIFYING"].includes(status)) return "WRITEBACK";
  return "INIT";
}
