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

export const TRIAL_LOT_INSTALL = "install" as const;
export const TRIAL_LOT_BONUS = "bonus" as const;
export type TrialLotKind = typeof TRIAL_LOT_INSTALL | typeof TRIAL_LOT_BONUS;

export const TRIAL_LOT_REFERENCE_ID = {
  install: "install_credits",
  bonus: "basic_first_pay_bonus",
} as const;

export const TRIAL_LOT_GRANT_KIND = {
  install: "install_credits_expired",
  bonus: "basic_first_pay_bonus_expired",
  bonusRevoked: "basic_first_pay_bonus_revoked",
} as const;

export type InstallTrialExpiryFields = {
  usedCredits: number;
  trialInstallCredits: number;
  trialInstallExpiresAt: Date | null;
  trialBonusCredits: number;
  trialBonusExpiresAt: Date | null;
};

export type TrialLotSettlement = {
  kind: TrialLotKind;
  leftover: number;
  consumed: number;
  referenceId: (typeof TRIAL_LOT_REFERENCE_ID)[TrialLotKind];
  grantKind: (typeof TRIAL_LOT_GRANT_KIND)[keyof typeof TRIAL_LOT_GRANT_KIND];
  expiresAt: string | null;
};

export type SettleExpiredTrialOptions = {
  /** 立刻清指定笔（换计划收回 100 万），不等 expiresAt。 */
  forceLots?: readonly TrialLotKind[];
};

export type InstallTrialExpirySettlement = {
  trialInstallCredits: number;
  trialInstallExpiresAt: Date | null;
  trialBonusCredits: number;
  trialBonusExpiresAt: Date | null;
  trialCredits: number;
  usedCredits: number;
  settled: boolean;
  lots: TrialLotSettlement[];
};

function isDueTrialLot(
  credits: number,
  expiresAt: Date | null,
  now: Date,
): boolean {
  if (credits <= 0 || !expiresAt) return false;
  return now.getTime() >= expiresAt.getTime();
}

function shouldExpireTrialLot(
  kind: TrialLotKind,
  credits: number,
  expiresAt: Date | null,
  now: Date,
  forceLots?: readonly TrialLotKind[],
): boolean {
  if (credits <= 0) return false;
  if (forceLots?.includes(kind)) return true;
  return isDueTrialLot(credits, expiresAt, now);
}

function trialLotResult(
  kind: TrialLotKind,
  consumed: number,
  leftover: number,
  expiresAt: Date | null,
  grantKind: TrialLotSettlement["grantKind"] = TRIAL_LOT_GRANT_KIND[kind],
): TrialLotSettlement {
  return {
    kind,
    consumed,
    leftover,
    referenceId: TRIAL_LOT_REFERENCE_ID[kind],
    grantKind,
    expiresAt: expiresAt?.toISOString() ?? null,
  };
}

export function earliestTrialLotExpiresAt(
  installCredits: number,
  installExpiresAt: Date | null,
  bonusCredits: number,
  bonusExpiresAt: Date | null,
): Date | null {
  const dates: Date[] = [];
  if (installCredits > 0 && installExpiresAt) dates.push(installExpiresAt);
  if (bonusCredits > 0 && bonusExpiresAt) dates.push(bonusExpiresAt);
  if (dates.length === 0) return null;
  return dates.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));
}

/**
 * 试用赠送到期结算（与 App accountBalance.server.ts 同口径）。
 * 安装 / 首订分笔；FIFO 先安装后首订。expiresAt=null 永不过期。
 * forceLots 可立刻清指定笔（离开 Basic 收回 100 万）。
 */
export function settleExpiredInstallTrialCredits(
  account: InstallTrialExpiryFields,
  now: Date = new Date(),
  options?: SettleExpiredTrialOptions,
): InstallTrialExpirySettlement {
  const install = Math.max(0, account.trialInstallCredits);
  const bonus = Math.max(0, account.trialBonusCredits);
  const used = Math.max(0, account.usedCredits);
  const forceLots = options?.forceLots;
  const expireInstall = shouldExpireTrialLot(
    "install",
    install,
    account.trialInstallExpiresAt,
    now,
    forceLots,
  );
  const expireBonus = shouldExpireTrialLot(
    "bonus",
    bonus,
    account.trialBonusExpiresAt,
    now,
    forceLots,
  );
  if (!expireInstall && !expireBonus) {
    return {
      trialInstallCredits: install,
      trialInstallExpiresAt: account.trialInstallExpiresAt,
      trialBonusCredits: bonus,
      trialBonusExpiresAt: account.trialBonusExpiresAt,
      trialCredits: install + bonus,
      usedCredits: used,
      settled: false,
      lots: [],
    };
  }

  const usedTrial = Math.min(used, install + bonus);
  const attrInstall = Math.min(usedTrial, install);
  const attrBonus = usedTrial - attrInstall;
  const lots: TrialLotSettlement[] = [];
  let nextInstall = install;
  let nextInstallExp = account.trialInstallExpiresAt;
  let nextBonus = bonus;
  let nextBonusExp = account.trialBonusExpiresAt;
  let nextUsed = used;

  if (expireInstall) {
    lots.push(
      trialLotResult(
        "install",
        attrInstall,
        install - attrInstall,
        account.trialInstallExpiresAt,
      ),
    );
    nextUsed -= attrInstall;
    nextInstall = 0;
    nextInstallExp = null;
  }
  if (expireBonus) {
    lots.push(
      trialLotResult(
        "bonus",
        attrBonus,
        bonus - attrBonus,
        account.trialBonusExpiresAt,
        forceLots?.includes("bonus")
          ? TRIAL_LOT_GRANT_KIND.bonusRevoked
          : TRIAL_LOT_GRANT_KIND.bonus,
      ),
    );
    nextUsed -= attrBonus;
    nextBonus = 0;
    nextBonusExp = null;
  }

  return {
    trialInstallCredits: nextInstall,
    trialInstallExpiresAt: nextInstallExp,
    trialBonusCredits: nextBonus,
    trialBonusExpiresAt: nextBonusExp,
    trialCredits: nextInstall + nextBonus,
    usedCredits: nextUsed,
    settled: true,
    lots,
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
