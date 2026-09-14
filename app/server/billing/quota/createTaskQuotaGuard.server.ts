import { getAccountQuota } from "./getAccountQuota.server";
import { CREATE_TASK_MIN_REQUIRED_CREDITS } from "~/lib/createTranslateQuotaGuard";

export type CreateTaskQuotaGuardResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

/** 建任务额度校验：Turso 账本 remaining >= 15000 才允许。 */
export async function evaluateCreateTaskQuotaGuard(
  shopName: string,
): Promise<CreateTaskQuotaGuardResult> {
  const quota = await getAccountQuota(shopName);
  if (!quota) {
    return {
      ok: false,
      status: 503,
      error: "v4.create.quotaUnavailable",
    };
  }
  // 直接读账本剩余，避免 normalize 把负数夹成 0 后掩盖真实透支状态。
  if (quota.remainingCredits >= CREATE_TASK_MIN_REQUIRED_CREDITS) {
    return { ok: true };
  }

  return {
    ok: false,
    status: 403,
    error: "v4.create.noCreditsPricing",
  };
}
