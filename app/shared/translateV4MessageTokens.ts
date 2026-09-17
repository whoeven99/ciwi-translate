/** Stable tokens stored in Cosmos / Redis (pauseReason, errorMessage). */

export const V4_MESSAGE_MANUAL_PAUSE = "manually paused";
export const V4_MESSAGE_CANCELLED = "cancelled";
export const V4_MESSAGE_TASK_CLAIMED = "task claimed by another worker";
export const V4_MESSAGE_TASK_NOT_FOUND = "task not found";
export const V4_MESSAGE_TASK_REQUEUED = "task requeued";

/** Worker / finalize merchant-facing reason codes (new writes). */
export const V4_MESSAGE_QUOTA_INSUFFICIENT = "QUOTA_INSUFFICIENT";
export const V4_MESSAGE_QUOTA_SERVICE_ERROR = "QUOTA_SERVICE_ERROR";
export const V4_MESSAGE_QUOTA_INSUFFICIENT_PARTIAL = "QUOTA_INSUFFICIENT_PARTIAL";
export const V4_MESSAGE_WRITEBACK_ALL_FAILED = "WRITEBACK_ALL_FAILED";
export const V4_MESSAGE_JOB_FAILED = "JOB_FAILED";
export const V4_MESSAGE_INIT_REQUEUING = "INIT_REQUEUING";

const KNOWN_USER_FACING_CODES = new Set([
  V4_MESSAGE_MANUAL_PAUSE,
  V4_MESSAGE_CANCELLED,
  V4_MESSAGE_QUOTA_INSUFFICIENT,
  V4_MESSAGE_QUOTA_SERVICE_ERROR,
  V4_MESSAGE_QUOTA_INSUFFICIENT_PARTIAL,
  V4_MESSAGE_WRITEBACK_ALL_FAILED,
  V4_MESSAGE_JOB_FAILED,
  V4_MESSAGE_INIT_REQUEUING,
]);

/** Exact legacy Chinese / English strings → stable code. */
const LEGACY_EXACT_TO_CODE: Record<string, string> = {
  "额度不足，已自动暂停": V4_MESSAGE_QUOTA_INSUFFICIENT,
  "额度服务异常，已自动暂停": V4_MESSAGE_QUOTA_SERVICE_ERROR,
  "额度不足，仅翻译并写回了部分资源，补充额度后点击「继续」可翻译剩余内容":
    V4_MESSAGE_QUOTA_INSUFFICIENT_PARTIAL,
  "写回未成功：全部资源均未写入 Shopify（请查看 worker 日志或写回详情）":
    V4_MESSAGE_WRITEBACK_ALL_FAILED,
  "已手动暂停": V4_MESSAGE_MANUAL_PAUSE,
  [V4_MESSAGE_MANUAL_PAUSE]: V4_MESSAGE_MANUAL_PAUSE,
  "v4.status.paused": V4_MESSAGE_MANUAL_PAUSE,
  "已取消": V4_MESSAGE_CANCELLED,
  [V4_MESSAGE_CANCELLED]: V4_MESSAGE_CANCELLED,
  "v4.status.cancelled": V4_MESSAGE_CANCELLED,
};

const LEGACY_MANUAL_PAUSE_MESSAGES = [
  "已手动暂停",
  V4_MESSAGE_MANUAL_PAUSE,
  "v4.status.paused",
];
const LEGACY_CANCELLED_MESSAGES = [
  "已取消",
  V4_MESSAGE_CANCELLED,
  "v4.status.cancelled",
];

export const V4_INTERNAL_USER_MESSAGES = new Set([
  "任务已被其它 worker 接管",
  "任务已不存在",
  "任务已重新排队",
  V4_MESSAGE_TASK_CLAIMED,
  V4_MESSAGE_TASK_NOT_FOUND,
  V4_MESSAGE_TASK_REQUEUED,
  "已暂停",
  "paused",
]);

export function normalizeV4MessageToken(message: string | null | undefined): string {
  return message?.trim().toLowerCase() || "";
}

export function isV4ManualPauseMessage(message: string | null | undefined): boolean {
  const normalized = normalizeV4MessageToken(message);
  return LEGACY_MANUAL_PAUSE_MESSAGES.includes(normalized);
}

export function isV4CancelledMessage(message: string | null | undefined): boolean {
  const normalized = normalizeV4MessageToken(message);
  return LEGACY_CANCELLED_MESSAGES.includes(normalized);
}

/**
 * 额度不足的旧自由文本（小写后子串匹配）。
 *
 * 必须与 `worker/src/services/userFacingMessages.ts` 的 `QUOTA_INSUFFICIENT_PATTERNS`
 * 逐项一致。Worker 是这些文案的写入方，并据此决定发「额度不足未完成」邮件；App 据此
 * 决定任务卡是否给补额度入口。两边少一项就会出现「收到额度不足邮件、卡上却没有补额度
 * 按钮」。改动时同时改两处，顺序保持一致以便肉眼 diff。
 */
export const QUOTA_INSUFFICIENT_PATTERNS = [
  "额度不足",
  "积分不足",
  "额度已用完",
  "insufficient credits",
  "credits are insufficient",
  "out of credits",
  "translation credits have been used up",
  "translation word credits have been exhausted",
  "not enough translation credits",
  "out of translation credits",
] as const;

export function isV4QuotaInsufficientMessage(
  message: string | null | undefined,
): boolean {
  const trimmed = message?.trim();
  if (!trimmed) return false;
  if (
    trimmed === V4_MESSAGE_QUOTA_INSUFFICIENT ||
    trimmed === V4_MESSAGE_QUOTA_INSUFFICIENT_PARTIAL
  ) {
    return true;
  }
  const normalized = trimmed.toLowerCase();
  return QUOTA_INSUFFICIENT_PATTERNS.some((pattern) =>
    normalized.includes(pattern),
  );
}

export function isV4KnownUserFacingCode(message: string | null | undefined): boolean {
  const trimmed = message?.trim();
  return Boolean(trimmed && KNOWN_USER_FACING_CODES.has(trimmed));
}

export type ResolveV4UserFacingOptions = {
  /** Job summary path: unknown Exception text → JOB_FAILED. Default null (leave unmapped). */
  unknownAs?: "job_failed" | "null";
};

/**
 * Map raw Worker / legacy text → stable merchant-facing code.
 * Returns null for empty / internal ops messages.
 * Unknown free-text: JOB_FAILED only when `unknownAs: "job_failed"` (Cosmos job errors).
 */
export function resolveV4UserFacingMessageCode(
  message: string | null | undefined,
  options?: ResolveV4UserFacingOptions,
): string | null {
  const trimmed = message?.trim();
  if (!trimmed) return null;
  if (V4_INTERNAL_USER_MESSAGES.has(trimmed)) return null;
  if (/worker\s*接管/i.test(trimmed)) return null;

  if (KNOWN_USER_FACING_CODES.has(trimmed)) return trimmed;

  const exact = LEGACY_EXACT_TO_CODE[trimmed] ?? LEGACY_EXACT_TO_CODE[trimmed.toLowerCase()];
  if (exact) return exact;

  if (isV4ManualPauseMessage(trimmed)) return V4_MESSAGE_MANUAL_PAUSE;
  if (isV4CancelledMessage(trimmed)) return V4_MESSAGE_CANCELLED;

  if (/^INIT\s+.+/i.test(trimmed) && /已自动重试|requeu/i.test(trimmed)) {
    return V4_MESSAGE_INIT_REQUEUING;
  }

  if (
    trimmed.includes("额度服务异常") ||
    /quota\s*service/i.test(trimmed)
  ) {
    return V4_MESSAGE_QUOTA_SERVICE_ERROR;
  }

  if (
    trimmed.includes("写回未成功") ||
    /write-?back.*failed|failed.*write-?back/i.test(trimmed)
  ) {
    return V4_MESSAGE_WRITEBACK_ALL_FAILED;
  }

  // Partial before generic quota (both contain 额度不足).
  if (
    trimmed.includes("仅翻译并写回了部分") ||
    /partial.*quot|quot.*partial|some resources were translated/i.test(trimmed)
  ) {
    return V4_MESSAGE_QUOTA_INSUFFICIENT_PARTIAL;
  }

  if (isV4QuotaInsufficientMessage(trimmed)) {
    return V4_MESSAGE_QUOTA_INSUFFICIENT;
  }

  return options?.unknownAs === "job_failed" ? V4_MESSAGE_JOB_FAILED : null;
}

/** i18n key for a stable code (or null if not a known code). */
export function v4UserFacingMessageI18nKey(code: string): string | null {
  switch (code) {
    case V4_MESSAGE_QUOTA_INSUFFICIENT:
      return "v4.notice.quotaInsufficient";
    case V4_MESSAGE_QUOTA_SERVICE_ERROR:
      return "v4.notice.quotaServiceError";
    case V4_MESSAGE_QUOTA_INSUFFICIENT_PARTIAL:
      return "v4.notice.quotaInsufficientPartial";
    case V4_MESSAGE_WRITEBACK_ALL_FAILED:
      return "v4.notice.writebackAllFailed";
    case V4_MESSAGE_JOB_FAILED:
      return "v4.notice.jobFailed";
    case V4_MESSAGE_INIT_REQUEUING:
      return "v4.notice.initRequeuing";
    case V4_MESSAGE_MANUAL_PAUSE:
      return "v4.status.PAUSED";
    case V4_MESSAGE_CANCELLED:
      return "v4.status.CANCELLED";
    default:
      return null;
  }
}
