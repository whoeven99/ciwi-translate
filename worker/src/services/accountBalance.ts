// 分池额度计算纯函数（与 app/server/billing/accountBalance.server.ts 保持一致）。

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

export function getTotalCredits(pools: CreditPoolBalances): number {
  return (
    pools.subscriptionCredits + pools.purchasedCredits + pools.trialCredits
  );
}

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

export function canSettleAtRenewal(account: AccountBalanceFields): boolean {
  if (account.usedCredits <= 0) return false;
  return account.usedCredits <= getTotalCredits(account);
}

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
