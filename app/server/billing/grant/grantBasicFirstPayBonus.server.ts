import prisma from "../../../db.server";
import { settleExpiredInstallTrialCredits } from "../accountBalance.server";
import { appendBillingLog } from "../billingLog.server";
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
  await prisma.account.update({
    where: { shop },
    data: {
      trialCredits: { increment: BASIC_FIRST_PAY_EXPIRING_CREDITS },
      trialCreditsExpiresAt: expiresAt,
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
 * 试用赠送到期后写库结算：试用优先抵 used，剩余试用清零，不碰订阅/加量包。
 * 无论 leftover 是否为 0 都写 BillingLog TRIAL_EXPIRED（creditsDelta = -leftover）。
 * 可重复调用。expiresAt=null 的存量 Launch Credits 不会被结算。
 */
export async function expireInstallTrialCreditsIfDue(
  shop: string,
  now: Date = new Date(),
): Promise<boolean> {
  const account = await prisma.account.findUnique({ where: { shop } });
  if (!account || account.deletedAt) return false;

  const settled = settleExpiredInstallTrialCredits(
    {
      trialCredits: account.trialCredits,
      usedCredits: account.usedCredits,
      trialCreditsExpiresAt: account.trialCreditsExpiresAt,
    },
    now,
  );
  if (!settled.settled) return false;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.account.updateMany({
      where: {
        shop,
        deletedAt: null,
        trialCredits: account.trialCredits,
        usedCredits: account.usedCredits,
        trialCreditsExpiresAt: account.trialCreditsExpiresAt,
      },
      data: {
        trialCredits: 0,
        usedCredits: settled.usedCredits,
      },
    });
    if (updated.count === 0) return false;

    const prior = await tx.billingLog.findFirst({
      where: {
        shop,
        eventType: BILLING_LOG_EVENT.TRIAL_EXPIRED,
        referenceId: BASIC_FIRST_PAY_BONUS_REFERENCE_ID,
      },
    });
    if (!prior) {
      await tx.billingLog.create({
        data: {
          shop,
          eventType: BILLING_LOG_EVENT.TRIAL_EXPIRED,
          referenceId: BASIC_FIRST_PAY_BONUS_REFERENCE_ID,
          creditsDelta: -settled.leftover,
          usedCredits: settled.usedCredits,
          metadata: {
            grantKind: "basic_first_pay_bonus_expired",
            leftover: settled.leftover,
            consumed: settled.consumed,
            trialCreditsExpiresAt:
              account.trialCreditsExpiresAt?.toISOString() ?? null,
          },
        },
      });
    }
    return true;
  });
}
