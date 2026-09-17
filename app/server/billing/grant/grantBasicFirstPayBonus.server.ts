import prisma from "../../../db.server";
import { appendBillingLog } from "../billingLog.server";
import { earliestTrialLotExpiresAt } from "../accountBalance.server";
import { BILLING_LOG_EVENT } from "../types.server";
import {
  BASIC_FIRST_PAY_BONUS_REFERENCE_ID,
  BASIC_FIRST_PAY_EXPIRING_CREDITS,
  BASIC_FIRST_PAY_PERMANENT_CREDITS,
  LAUNCH_CREDITS_REFERENCE_ID,
  basicFirstPayBonusExpiresAt,
  isBasicPlanKey,
  isInTrialPeriod,
} from "./basicFirstPayBonus";
import { expireInstallTrialCreditsIfDue } from "./grantInstallCredits.server";

export {
  BASIC_FIRST_PAY_BONUS_REFERENCE_ID,
  BASIC_FIRST_PAY_EXPIRING_CREDITS,
  BASIC_FIRST_PAY_PERMANENT_CREDITS,
  BASIC_FIRST_PAY_TTL_DAYS,
  LAUNCH_CREDITS_REFERENCE_ID,
  basicFirstPayBonusExpiresAt,
  isBasicPlanKey,
  isInTrialPeriod,
} from "./basicFirstPayBonus";
export { expireInstallTrialCreditsIfDue } from "./grantInstallCredits.server";

export type GrantBasicFirstPayBonusResult =
  | { granted: true; permanentCredits: number; expiringCredits: number }
  | {
      granted: false;
      reason: "already_granted" | "not_basic" | "in_trial";
    };

/**
 * 店铺终身首次付费且当时是 Basic：只发 1M trialCredits（30 天到期）。
 * 不再加 purchasedCredits。试用中不发；Pro/Premium 不发。
 * 已拿过 Launch Credits 或本礼包则跳过；已发出的永久包不追回。
 */
export async function grantBasicFirstPayBonusIfEligible(params: {
  shop: string;
  planKey: string;
  trialEndsAt?: Date | null;
  now?: Date;
}): Promise<GrantBasicFirstPayBonusResult> {
  const { shop, planKey } = params;
  const now = params.now ?? new Date();
  if (isInTrialPeriod(params.trialEndsAt, now)) {
    return { granted: false, reason: "in_trial" };
  }
  if (!isBasicPlanKey(planKey)) {
    return { granted: false, reason: "not_basic" };
  }

  const prior = await prisma.billingLog.findFirst({
    where: {
      shop,
      eventType: BILLING_LOG_EVENT.TRIAL_GRANTED,
      referenceId: {
        in: [BASIC_FIRST_PAY_BONUS_REFERENCE_ID, LAUNCH_CREDITS_REFERENCE_ID],
      },
    },
  });
  if (prior) {
    return { granted: false, reason: "already_granted" };
  }

  const expiresAt = basicFirstPayBonusExpiresAt(now);
  const account = await prisma.account.findUnique({ where: { shop } });
  if (!account || account.deletedAt) {
    return { granted: false, reason: "already_granted" };
  }

  const bonusCredits =
    account.trialBonusCredits + BASIC_FIRST_PAY_EXPIRING_CREDITS;
  await prisma.account.update({
    where: { shop },
    data: {
      trialCredits: { increment: BASIC_FIRST_PAY_EXPIRING_CREDITS },
      trialBonusCredits: { increment: BASIC_FIRST_PAY_EXPIRING_CREDITS },
      trialBonusExpiresAt: expiresAt,
      trialCreditsExpiresAt: earliestTrialLotExpiresAt(
        account.trialInstallCredits,
        account.trialInstallExpiresAt,
        bonusCredits,
        expiresAt,
      ),
    },
  });

  await appendBillingLog({
    shop,
    eventType: BILLING_LOG_EVENT.TRIAL_GRANTED,
    planKey,
    referenceId: BASIC_FIRST_PAY_BONUS_REFERENCE_ID,
    creditsDelta:
      BASIC_FIRST_PAY_PERMANENT_CREDITS + BASIC_FIRST_PAY_EXPIRING_CREDITS,
    metadata: {
      grantKind: "basic_first_pay_bonus",
      permanentCredits: BASIC_FIRST_PAY_PERMANENT_CREDITS,
      expiringCredits: BASIC_FIRST_PAY_EXPIRING_CREDITS,
      trialCreditsExpiresAt: expiresAt.toISOString(),
    },
  });

  return {
    granted: true,
    permanentCredits: BASIC_FIRST_PAY_PERMANENT_CREDITS,
    expiringCredits: BASIC_FIRST_PAY_EXPIRING_CREDITS,
  };
}

/**
 * 立刻收回首订 100 万 leftover（FIFO 与到期结算相同）。
 * 取消变免费、以及离开 Basic 升档都走这里。
 */
export async function revokeBasicFirstPayBonusNow(
  shop: string,
  now: Date = new Date(),
): Promise<boolean> {
  return expireInstallTrialCreditsIfDue(shop, now, { forceLots: ["bonus"] });
}

/**
 * 新计划不是 Basic 时立刻收回首订 100 万 leftover。
 * Basic 月/年互转不收。
 */
export async function revokeBasicFirstPayBonusIfLeftBasic(
  shop: string,
  planKey: string,
  now: Date = new Date(),
): Promise<boolean> {
  if (isBasicPlanKey(planKey)) return false;
  return revokeBasicFirstPayBonusNow(shop, now);
}
