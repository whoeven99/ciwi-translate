export const CREATE_TASK_INSUFFICIENT_CREDITS_I18N_KEY =
  "v4.create.insufficientCredits";
export const CREATE_TASK_MIN_REQUIRED_CREDITS = 15_000;

type TranslateFn = (
  key: string,
  options?: Record<string, unknown>,
) => string;

/** 客户端建任务 gate：与 evaluateCreateTaskQuotaGuard 对齐，remaining >= 15000 才放行。 */
export function shouldBlockCreateTaskByCredits(args: {
  remainingCredits: number | null;
  /** @deprecated 已忽略；服务端始终按 remaining 校验。 */
  strictQuotaGate?: boolean;
  /** @deprecated 已忽略。 */
  hasPaidPlan?: boolean;
  /** @deprecated 已忽略。 */
  isInFreePlanTime?: boolean;
}): boolean {
  if (args.remainingCredits == null) return false;
  return args.remainingCredits < CREATE_TASK_MIN_REQUIRED_CREDITS;
}

/** remaining < 15000 时提示并返回 true，调用方应中止打开确认弹窗 / 建任务。 */
export function notifyIfCreateTaskBlockedByCredits(args: {
  remainingCredits: number | null;
  t: TranslateFn;
  notify: (message: string) => void;
}): boolean {
  if (!shouldBlockCreateTaskByCredits({ remainingCredits: args.remainingCredits })) {
    return false;
  }
  args.notify(args.t(CREATE_TASK_INSUFFICIENT_CREDITS_I18N_KEY));
  return true;
}
