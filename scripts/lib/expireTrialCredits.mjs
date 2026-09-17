/**
 * 试用额度过期结算纯函数（无 IO）。
 * 口径必须与 `app/server/billing/accountBalance.server.ts`
 * `settleExpiredInstallTrialCredits` / `earliestTrialLotExpiresAt` 保持一致。
 */

export const TRIAL_LOT_REFERENCE_ID = {
  install: "install_credits",
  bonus: "basic_first_pay_bonus",
};

export const TRIAL_LOT_GRANT_KIND = {
  install: "install_credits_expired",
  bonus: "basic_first_pay_bonus_expired",
  bonusRevoked: "basic_first_pay_bonus_revoked",
};

export function parseDbDate(raw) {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const ms = raw > 1e12 ? raw : raw * 1000;
    const parsed = new Date(ms);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(String(raw));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function remainingCredits(account) {
  return Math.max(
    0,
    Number(account.subscriptionCredits ?? 0) +
      Number(account.purchasedCredits ?? 0) +
      Number(account.trialCredits ?? 0) -
      Number(account.usedCredits ?? 0),
  );
}

function isDueTrialLot(credits, expiresAt, now) {
  if (credits <= 0 || !expiresAt) return false;
  return now.getTime() >= expiresAt.getTime();
}

function shouldExpireTrialLot(kind, credits, expiresAt, now, forceLots) {
  if (credits <= 0) return false;
  if (forceLots?.includes(kind)) return true;
  return isDueTrialLot(credits, expiresAt, now);
}

function trialLotResult(kind, consumed, leftover, expiresAt, grantKind) {
  return {
    kind,
    consumed,
    leftover,
    referenceId: TRIAL_LOT_REFERENCE_ID[kind],
    grantKind: grantKind ?? TRIAL_LOT_GRANT_KIND[kind],
    expiresAt: expiresAt?.toISOString() ?? null,
  };
}

/** 仍有效试用笔里最早的到期时间；都过期/无到期则 null。 */
export function earliestTrialLotExpiresAt(
  installCredits,
  installExpiresAt,
  bonusCredits,
  bonusExpiresAt,
) {
  const dates = [];
  if (installCredits > 0 && installExpiresAt) dates.push(installExpiresAt);
  if (bonusCredits > 0 && bonusExpiresAt) dates.push(bonusExpiresAt);
  if (dates.length === 0) return null;
  return dates.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));
}

/**
 * 试用赠送到期结算：安装笔 / 首订笔 FIFO。
 * 到期只清该笔 leftover，只从 used 剥该笔已用量。expiresAt=null 永不过期。
 * options.forceLots 可立刻清指定笔（离开 Basic 收回 100 万）。
 */
export function settleExpiredInstallTrialCredits(
  account,
  now = new Date(),
  options,
) {
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
  const lots = [];
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

export function applyBackdate(account, lot, expiresAt) {
  const next = {
    trialInstallCredits: Math.max(0, Number(account.trialInstallCredits) || 0),
    trialInstallExpiresAt: account.trialInstallExpiresAt,
    trialBonusCredits: Math.max(0, Number(account.trialBonusCredits) || 0),
    trialBonusExpiresAt: account.trialBonusExpiresAt,
  };
  if (lot === "install" || lot === "both") {
    next.trialInstallExpiresAt = expiresAt;
  }
  if (lot === "bonus" || lot === "both") {
    next.trialBonusExpiresAt = expiresAt;
  }
  next.trialCreditsExpiresAt = earliestTrialLotExpiresAt(
    next.trialInstallCredits,
    next.trialInstallExpiresAt,
    next.trialBonusCredits,
    next.trialBonusExpiresAt,
  );
  return next;
}
