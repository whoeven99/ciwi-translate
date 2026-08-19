/**
 * Worker abort / pause reason tokens.
 * Values MUST stay aligned with `app/shared/translateV4MessageTokens.ts`.
 */

export const V4_MESSAGE_MANUAL_PAUSE = "manually paused";
export const V4_MESSAGE_CANCELLED = "cancelled";
export const V4_MESSAGE_TASK_CLAIMED = "task claimed by another worker";
export const V4_MESSAGE_TASK_NOT_FOUND = "task not found";
export const V4_MESSAGE_TASK_REQUEUED = "task requeued";
export const V4_MESSAGE_PAUSED = "paused";

export const V4_MESSAGE_QUOTA_INSUFFICIENT = "QUOTA_INSUFFICIENT";
export const V4_MESSAGE_QUOTA_SERVICE_ERROR = "QUOTA_SERVICE_ERROR";
export const V4_MESSAGE_QUOTA_INSUFFICIENT_PARTIAL = "QUOTA_INSUFFICIENT_PARTIAL";
export const V4_MESSAGE_WRITEBACK_ALL_FAILED = "WRITEBACK_ALL_FAILED";
export const V4_MESSAGE_JOB_FAILED = "JOB_FAILED";
export const V4_MESSAGE_INIT_REQUEUING = "INIT_REQUEUING";

/**
 * 额度不足的旧自由文本（小写后子串匹配）。
 *
 * 必须与 `app/shared/translateV4MessageTokens.ts` 的 `QUOTA_INSUFFICIENT_PATTERNS`
 * 逐项一致。Worker 据此决定发「额度不足未完成」邮件；App 据此决定任务卡是否给补额度
 * 入口。两边少一项就会出现「收到额度不足邮件、卡上却没有补额度按钮」。改动时同时改两
 * 处，顺序保持一致以便肉眼 diff。
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

/** 是否为额度不足暂停原因（稳定码 + 旧中英文文案）。 */
export function isQuotaInsufficientMessage(
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

/** Worker 内部 abort 原因 —— 只打日志，不写 Cosmos / Redis pauseReason 商户字段。 */
export const INTERNAL_ABORT_REASONS = new Set([
  "任务已被其它 worker 接管",
  "任务已不存在",
  "任务已重新排队",
  "已暂停",
  V4_MESSAGE_TASK_CLAIMED,
  V4_MESSAGE_TASK_NOT_FOUND,
  V4_MESSAGE_TASK_REQUEUED,
  V4_MESSAGE_PAUSED,
]);

export function isInternalAbortReason(reason: string): boolean {
  return INTERNAL_ABORT_REASONS.has(reason);
}

/** 商户可见的暂停原因；内部原因返回 null。 */
export function userFacingPauseMessage(reason: string): string | null {
  if (isInternalAbortReason(reason)) return null;
  return reason;
}
