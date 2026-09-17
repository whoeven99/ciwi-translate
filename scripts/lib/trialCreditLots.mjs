/** 试用分笔回填纯函数（无 IO）。安装 20 万 / 首订 100 万，FIFO 先安装后首订。 */

export const INSTALL_TRIAL_CREDITS = 200_000;
export const BONUS_TRIAL_CREDITS = 1_000_000;
export const INSTALL_GRANT_REF = "install_credits";
export const BONUS_GRANT_REF = "basic_first_pay_bonus";
export const LAUNCH_GRANT_REF = "launch_credits";

const MIXED_GRANT_TOTAL = INSTALL_TRIAL_CREDITS + BONUS_TRIAL_CREDITS;

/**
 * @param {{
 *   trialCredits: number,
 *   trialInstallCredits: number,
 *   trialInstallExpiresAt: string | null,
 *   trialBonusCredits: number,
 *   trialBonusExpiresAt: string | null,
 *   trialCreditsExpiresAt: string | null,
 * }} account
 * @param {Iterable<string>} grants
 * @param {{ onlyMissing?: boolean }} [opts]
 * @returns {null | {
 *   reason: "install_lot" | "bonus_lot" | "split_mixed",
 *   trialInstallCredits: number,
 *   trialInstallExpiresAt: string | null,
 *   trialBonusCredits: number,
 *   trialBonusExpiresAt: string | null,
 *   trialCreditsExpiresAt: string | null,
 * }}
 */
export function planTrialCreditLotBackfill(account, grants, opts = {}) {
  const remaining = Math.max(0, Number(account.trialCredits) || 0);
  const install = Math.max(0, Number(account.trialInstallCredits) || 0);
  const bonus = Math.max(0, Number(account.trialBonusCredits) || 0);
  if (remaining <= 0) return null;

  const missing = install === 0 && bonus === 0;
  if (opts.onlyMissing && !missing) return null;

  const sumLots = install + bonus;
  if (sumLots > 0 && sumLots !== remaining) return null;

  const grantSet = grants instanceof Set ? grants : new Set(grants);
  const hasBonusGrant = grantSet.has(BONUS_GRANT_REF);
  const hasInstallGrant = grantSet.has(INSTALL_GRANT_REF);
  const canSplitMixed =
    hasBonusGrant && hasInstallGrant && remaining <= MIXED_GRANT_TOTAL;
  const mixedUnbalanced =
    canSplitMixed &&
    ((install === 0 && bonus === remaining) ||
      (bonus === 0 && install === remaining));

  let nextInstall = install;
  let nextBonus = bonus;
  /** @type {"install_lot" | "bonus_lot" | "split_mixed" | ""} */
  let reason = "";

  if (missing) {
    if (canSplitMixed) {
      const split = splitMixedRemaining(remaining);
      nextInstall = split.install;
      nextBonus = split.bonus;
      reason = "split_mixed";
    } else if (hasBonusGrant) {
      nextInstall = 0;
      nextBonus = remaining;
      reason = "bonus_lot";
    } else {
      nextInstall = remaining;
      nextBonus = 0;
      reason = "install_lot";
    }
  } else if (mixedUnbalanced) {
    const split = splitMixedRemaining(remaining);
    nextInstall = split.install;
    nextBonus = split.bonus;
    reason = "split_mixed";
  } else {
    return null;
  }

  const expiresAt =
    account.trialCreditsExpiresAt ||
    account.trialInstallExpiresAt ||
    account.trialBonusExpiresAt ||
    null;
  const nextInstallExp = nextInstall > 0 ? expiresAt : null;
  const nextBonusExp = nextBonus > 0 ? expiresAt : null;
  const nextLegacy = earliestLotExpiresAt(
    nextInstall,
    nextInstallExp,
    nextBonus,
    nextBonusExp,
  );

  if (
    nextInstall === install &&
    nextBonus === bonus &&
    nextInstallExp === (account.trialInstallExpiresAt || null) &&
    nextBonusExp === (account.trialBonusExpiresAt || null)
  ) {
    return null;
  }

  return {
    reason,
    trialInstallCredits: nextInstall,
    trialInstallExpiresAt: nextInstallExp,
    trialBonusCredits: nextBonus,
    trialBonusExpiresAt: nextBonusExp,
    trialCreditsExpiresAt: nextLegacy,
  };
}

function splitMixedRemaining(remaining) {
  const consumed = MIXED_GRANT_TOTAL - remaining;
  const install = Math.max(0, INSTALL_TRIAL_CREDITS - consumed);
  return { install, bonus: remaining - install };
}

function earliestLotExpiresAt(install, installExp, bonus, bonusExp) {
  const dates = [];
  if (install > 0 && installExp) dates.push(installExp);
  if (bonus > 0 && bonusExp) dates.push(bonusExp);
  if (dates.length === 0) return null;
  return dates.reduce((a, b) => (a <= b ? a : b));
}
