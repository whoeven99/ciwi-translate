// 分池额度计算纯函数（无 IO）。可被主 app 与 worker 复用。
// 分池模型对标 Spark：可用 = 订阅 + 加量包 + 试用；周期内消费只累加 usedCredits。

/** 续费结算扣减顺序：试用 → 订阅周期 → 加量包（先耗易失的池）。 */
export const CREDIT_POOL_DEDUCTION_ORDER = [
  "trialCredits",
  "subscriptionCredits",
  "purchasedCredits",
] as const;

export type CreditPoolBalances = {
  subscriptionCredits: number;
  purchasedCredits: number;
  trialCredits: number;
};

export type AccountBalanceFields = CreditPoolBalances & {
  usedCredits: number;
};

export type InstallTrialExpiryFields = {
  trialCredits: number;
  usedCredits: number;
  trialCreditsExpiresAt: Date | null;
};

export type InstallTrialExpirySettlement = {
  trialCredits: number;
  usedCredits: number;
  settled: boolean;
  leftover: number;
  consumed: number;
};

/**
 * 安装赠送到期结算（纯函数，与写库 SQL 同口径）：
 * 试用优先抵 used；剩余试用清零；已用完则只从 used 剔除赠送部分。
 * expiresAt=null 视为永不过期。leftover = 作废的未用试用（写 BillingLog 用）。
 */
export function settleExpiredInstallTrialCredits(
  account: InstallTrialExpiryFields,
  now: Date = new Date(),
): InstallTrialExpirySettlement {
  const expiresAt = account.trialCreditsExpiresAt;
  if (!expiresAt || now.getTime() < expiresAt.getTime()) {
    return {
      trialCredits: account.trialCredits,
      usedCredits: account.usedCredits,
      settled: false,
      leftover: 0,
      consumed: 0,
    };
  }
  if (account.trialCredits <= 0) {
    return {
      trialCredits: 0,
      usedCredits: account.usedCredits,
      settled: false,
      leftover: 0,
      consumed: 0,
    };
  }
  const consumed = Math.min(
    Math.max(0, account.usedCredits),
    account.trialCredits,
  );
  return {
    trialCredits: 0,
    usedCredits: account.usedCredits - consumed,
    settled: true,
    leftover: account.trialCredits - consumed,
    consumed,
  };
}

/** 三池额度之和（不减 used）。 */
export function getTotalCredits(pools: CreditPoolBalances): number {
  return (
    pools.subscriptionCredits + pools.purchasedCredits + pools.trialCredits
  );
}

/** 剩余可用（下限 0）。 */
export function getRemainingCredits(account: AccountBalanceFields): number {
  return Math.max(0, getTotalCredits(account) - account.usedCredits);
}

/** 已用超出订阅 + 试用后，占用购买池的部分。 */
export function getPurchasedCreditsConsumedByUsage(
  account: AccountBalanceFields,
): number {
  const used = Math.max(0, Math.floor(account.usedCredits));
  const subscription = Math.max(0, Math.floor(account.subscriptionCredits));
  const trial = Math.max(0, Math.floor(account.trialCredits));
  return Math.max(0, used - subscription - trial);
}

/**
 * 可迁移到 Spark 的购买积分：
 * purchasedCredits − max(0, usedCredits − subscriptionCredits − trialCredits)。
 * 已用先覆盖订阅和试用；超出部分占用购买池，占用掉的不能迁。
 */
export function getMigratablePurchasedCredits(
  account: AccountBalanceFields,
): number {
  const purchased = Math.max(0, Math.floor(account.purchasedCredits));
  return Math.max(0, purchased - getPurchasedCreditsConsumedByUsage(account));
}

/** 是否还有额度（gate 用）。 */
export function hasCreditQuota(account: AccountBalanceFields): boolean {
  return account.usedCredits < getTotalCredits(account);
}

/** 从各池按顺序扣减 amount，返回各池扣减后余额。 */
export function deductFromPools(
  pools: CreditPoolBalances,
  amount: number,
): CreditPoolBalances {
  let remaining = Math.max(0, Math.floor(amount));
  const next: CreditPoolBalances = { ...pools };

  for (const key of CREDIT_POOL_DEDUCTION_ORDER) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Math.max(0, next[key]));
    next[key] -= take;
    remaining -= take;
  }

  return next;
}

/** 本周期 usedCredits 未超过三池之和时才可做续费结算。 */
export function canSettleAtRenewal(account: AccountBalanceFields): boolean {
  if (account.usedCredits <= 0) return false;
  return account.usedCredits <= getTotalCredits(account);
}

/** 续费时按本周期 usedCredits 结算三池真实剩余（仅续费逻辑调用）。 */
export function settlePoolsAtRenewal(
  account: AccountBalanceFields,
): CreditPoolBalances {
  return deductFromPools(
    {
      subscriptionCredits: account.subscriptionCredits,
      purchasedCredits: account.purchasedCredits,
      trialCredits: account.trialCredits,
    },
    account.usedCredits,
  );
}
