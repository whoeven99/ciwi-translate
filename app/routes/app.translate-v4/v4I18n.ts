import type { TFunction } from "i18next";
import type { TranslationJobProgressSummary } from "~/server/translateV4/progress.server";
import type { TranslationV4Status } from "~/server/translateV4/types";
import {
  resolveV4UserFacingMessageCode,
  v4UserFacingMessageI18nKey,
  V4_MESSAGE_CANCELLED,
  V4_MESSAGE_MANUAL_PAUSE,
  V4_MESSAGE_TASK_CLAIMED,
  V4_MESSAGE_TASK_NOT_FOUND,
  V4_MESSAGE_TASK_REQUEUED,
} from "~/shared/translateV4MessageTokens";
import { visibleStageIndex } from "./jobStageUtils";

export const V4_STAGE_KEYS = ["v4.stage.init", "v4.stage.translate", "v4.stage.writeback"] as const;

const V4_RAW_MESSAGE_KEY_MAP: Record<string, string> = {
  "目标语言不能为空": "v4.validation.selectTarget",
  "目标语言不能和源语言相同": "v4.validation.sameAsSource",
  "至少选择一个翻译模块": "v4.validation.selectModule",
  "该目标语言已有进行中的翻译任务": "v4.error.blockingTaskExists",
  "无权删除": "v4.error.deleteForbidden",
  "任务进行中，请先取消再删除": "v4.error.deleteWhileActive",
  "仅翻译阶段可暂停": "v4.error.pauseOnlyDuringTranslate",
  "任务仍在收尾，请稍后再继续": "v4.error.taskStillStopping",
  "任务已被其它 worker 接管": "v4.error.workerClaimed",
  "任务已不存在": "v4.error.taskMissing",
  "任务已重新排队": "v4.error.taskRequeued",
  [V4_MESSAGE_TASK_CLAIMED]: "v4.error.workerClaimed",
  [V4_MESSAGE_TASK_NOT_FOUND]: "v4.error.taskNotFound",
  [V4_MESSAGE_TASK_REQUEUED]: "v4.error.taskRequeued",
  [V4_MESSAGE_MANUAL_PAUSE]: "v4.status.PAUSED",
  [V4_MESSAGE_CANCELLED]: "v4.status.CANCELLED",
  "taskid required": "v4.error.taskIdRequired",
  "unknown action": "v4.error.unknownAction",
};

export function translateV4Message(value: string, t: TFunction): string {
  const trimmed = value.trim();
  const resumeMatch = /^cannot resume from status\s+(.+)$/i.exec(trimmed);
  if (resumeMatch) {
    const rawStatus = resumeMatch[1]?.trim().toUpperCase();
    const statusLabel = isTranslationV4Status(rawStatus)
      ? getV4StatusLabel(rawStatus, t)
      : rawStatus;
    return t("v4.error.cannotResumeFromStatus", { status: statusLabel });
  }

  const facingCode = resolveV4UserFacingMessageCode(trimmed);
  if (facingCode) {
    const noticeKey = v4UserFacingMessageI18nKey(facingCode);
    if (noticeKey) {
      const noticeTranslated = t(noticeKey);
      if (noticeTranslated !== noticeKey) return noticeTranslated;
    }
  }

  const mappedKey = V4_RAW_MESSAGE_KEY_MAP[trimmed] ?? V4_RAW_MESSAGE_KEY_MAP[trimmed.toLowerCase()];
  if (mappedKey) {
    return t(mappedKey);
  }

  const translated = t(trimmed);
  return translated === trimmed ? trimmed : translated;
}

export function formatV4Elapsed(ms: number, t: TFunction): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return t("v4.elapsed.seconds", { count: s });
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) {
    return rs
      ? t("v4.elapsed.minutesSeconds", { minutes: m, seconds: rs })
      : t("v4.elapsed.minutes", { count: m });
  }
  const h = Math.floor(m / 60);
  return t("v4.elapsed.hoursMinutes", { hours: h, minutes: m % 60 });
}

export function formatV4JobStartTime(createdAt: string, locale?: string): string | null {
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatV4PlanType(planType: string | null, t: TFunction): string {
  if (!planType) return t("v4.plan.notSubscribed");

  const normalized = planType.trim().toLowerCase();
  if (normalized === "free") return t("v4.plan.free");
  if (normalized === "basic") return t("v4.plan.basic");
  if (normalized === "pro" || normalized === "professional") return t("v4.plan.pro");
  if (normalized === "enterprise" || normalized === "unlimited") return t("v4.plan.enterprise");
  return planType;
}

export function getV4ModuleLabel(moduleKey: string, t: TFunction): string {
  const labels: Record<string, string> = {
    products: t("Products"),
    collection: t("Collections"),
    article: t("Articles"),
    blog_titles: t("Blog titles"),
    pages: t("Pages"),
    filters: t("Filters"),
    metaobjects: t("Metaobjects"),
    metadata: t("Metafield"),
    policies: t("Policies"),
    navigation: t("Navigation"),
    shop: t("Shop"),
    theme: t("Theme"),
    notifications: t("Email"),
    delivery: t("Delivery"),
    shipping: t("Shipping"),
    handle: "Handle(URL)",
    CUSTOM_LIQUID: t("v4.module.CUSTOM_LIQUID"),
  };
  return labels[moduleKey] ?? moduleKey;
}

export function getV4AiModelLabel(value: string, t: TFunction): string {
  if (value === "deepseek-v4-flash") return t("v4.createTask.modelRecommended");
  return value;
}

export function getV4StatusLabel(
  status: TranslationV4Status,
  t: TFunction,
  metrics?: TranslationJobProgressSummary["metrics"],
  _errorMessage?: string | null,
): string {
  if (status === "TRANSLATE_QUEUED" && metrics) {
    const started =
      metrics.translateDone > 0 ||
      metrics.translateUnitDone > 0 ||
      metrics.translateTotal > 0;
    if (started) return t("v4.status.translateResumeQueued");
  }
  if (status === "WRITEBACK_QUEUED" && metrics && metrics.writebackDone > 0) {
    return t("v4.status.writebackResumeQueued");
  }

  const key = `v4.status.${status}` as const;
  const translated = t(key);
  return translated === key ? status : translated;
}

export function getV4JobStatusLabel(
  job: TranslationJobProgressSummary,
  t: TFunction,
  translateSlotBusy = false,
): string {
  if (job.isStopping) {
    return t("v4.status.stopping");
  }
  if (job.status === "TRANSLATE_QUEUED" && translateSlotBusy) {
    return t("v4.tasks.queuedForTranslate");
  }
  return getV4StatusLabel(job.status, t, job.metrics, job.errorMessage);
}

export function getV4VisibleStageLabel(
  job: TranslationJobProgressSummary,
  t: TFunction,
): string {
  const idx = visibleStageIndex(job.status, job.errorStage, job.metrics);
  return t(V4_STAGE_KEYS[idx] ?? "v4.tasks.waiting");
}

export function formatV4LastAutoUpdateDisplay(
  lastAutoUpdateAt: string | null,
  t: TFunction,
  nowMs = Date.now(),
): string | null {
  if (!lastAutoUpdateAt) return null;
  const ts = new Date(lastAutoUpdateAt).getTime();
  if (Number.isNaN(ts)) return null;

  if (nowMs - ts < 60_000) return t("v4.auto.lastUpdateJustNow");
  return t("v4.auto.lastUpdate", { time: formatScheduleTime(lastAutoUpdateAt, nowMs) });
}

export function formatV4NextAutoUpdateDisplay(
  nextAutoUpdateAt: string | null,
  t: TFunction,
  nowMs = Date.now(),
): string | null {
  if (!nextAutoUpdateAt) return null;
  const ts = new Date(nextAutoUpdateAt).getTime();
  if (Number.isNaN(ts)) return null;

  if (ts <= nowMs + 60_000) return t("v4.auto.nextScanSoon");
  return t("v4.auto.nextScan", { time: formatScheduleTime(nextAutoUpdateAt, nowMs) });
}

function formatScheduleTime(at: string, nowMs: number): string {
  const t = new Date(at).getTime();
  const sameDay = new Date(t).toDateString() === new Date(nowMs).toDateString();
  const time = new Date(t).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  if (sameDay) return time;
  const date = new Date(t).toLocaleDateString(undefined, {
    month: "numeric",
    day: "numeric",
  });
  return `${date} ${time}`;
}

export function formatV4CreateTasksMessage(
  result: {
    created: { target: string; jobId: string }[];
    failed: { target: string; error: string }[];
    validationError?: string;
  },
  t: TFunction,
  localeRegionCode: (locale: string) => string,
): string {
  if (result.validationError) {
    return translateV4Message(result.validationError, t);
  }
  if (result.created.length === 0) {
    const first = result.failed[0];
    if (!first) return t("v4.create.failed");
    return `${localeRegionCode(first.target)}: ${translateV4Message(first.error, t)}`;
  }
  if (result.failed.length === 0) {
    return result.created.length === 1
      ? t("v4.create.taskQueued")
      : t("v4.create.tasksQueued", { count: result.created.length });
  }
  return t("v4.create.partialSuccess", {
    created: result.created.length,
    failed: result.failed.length,
  });
}

function isTranslationV4Status(value: string): value is TranslationV4Status {
  return [
    "CREATED",
    "INIT_QUEUED",
    "INITIALIZING",
    "INIT_DONE",
    "TRANSLATE_QUEUED",
    "TRANSLATING",
    "TRANSLATE_DONE",
    "WRITEBACK_QUEUED",
    "WRITING_BACK",
    "VERIFY_QUEUED",
    "VERIFYING",
    "COMPLETED",
    "FAILED",
    "PAUSED",
    "CANCELLED",
  ].includes(value);
}
