import prisma from "../../../db.server";
import { settleExpiredInstallTrialCredits } from "../accountBalance.server";
import { appendBillingLog } from "../billingLog.server";
import { BILLING_LOG_EVENT } from "../types.server";

/** BillingLog.referenceId：店铺终身只发一次安装赠送。 */
export const INSTALL_CREDITS_REFERENCE_ID = "install_credits";
export const INSTALL_CREDITS = 200_000;
export const INSTALL_CREDITS_TTL_DAYS = 30;

export type GrantInstallCreditsResult =
  | { granted: true; credits: number }
  | { granted: false; reason: "already_granted" };

export function installCreditsExpiresAt(from: Date = new Date()): Date {
  return new Date(
    from.getTime() + INSTALL_CREDITS_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
}

/**
 * 终身首次建 Account 后发放安装赠送 → trialCredits，30 天后到期结算。
 * 幂等：BillingLog TRIAL_GRANTED + referenceId=install_credits；
 * 同时要求 trialCreditsExpiresAt IS NULL，避免并发双发。
 */
export async function grantInstallCreditsIfEligible(
  shop: string,
): Promise<GrantInstallCreditsResult> {
  const prior = await prisma.billingLog.findFirst({
    where: {
      shop,
      eventType: BILLING_LOG_EVENT.TRIAL_GRANTED,
      referenceId: INSTALL_CREDITS_REFERENCE_ID,
    },
  });
  if (prior) {
    return { granted: false, reason: "already_granted" };
  }

  const now = new Date();
  const expiresAt = installCreditsExpiresAt(now);
  const updated = await prisma.account.updateMany({
    where: {
      shop,
      deletedAt: null,
      trialCreditsExpiresAt: null,
    },
    data: {
      trialCredits: { increment: INSTALL_CREDITS },
      trialCreditsExpiresAt: expiresAt,
    },
  });
  if (updated.count === 0) {
    return { granted: false, reason: "already_granted" };
  }

  await appendBillingLog({
    shop,
    eventType: BILLING_LOG_EVENT.TRIAL_GRANTED,
    referenceId: INSTALL_CREDITS_REFERENCE_ID,
    creditsDelta: INSTALL_CREDITS,
    metadata: {
      grantKind: "install_credits",
      installCredits: INSTALL_CREDITS,
      trialCreditsExpiresAt: expiresAt.toISOString(),
    },
  });

  return { granted: true, credits: INSTALL_CREDITS };
}

/**
 * 安装赠送到期后写库结算：试用优先抵 used，剩余试用清零，不碰订阅/加量包。
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

  const settledNow = await prisma.$transaction(async (tx) => {
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
        referenceId: INSTALL_CREDITS_REFERENCE_ID,
      },
    });
    if (!prior) {
      await tx.billingLog.create({
        data: {
          shop,
          eventType: BILLING_LOG_EVENT.TRIAL_EXPIRED,
          referenceId: INSTALL_CREDITS_REFERENCE_ID,
          creditsDelta: -settled.leftover,
          usedCredits: settled.usedCredits,
          metadata: {
            grantKind: "install_credits_expired",
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

  return settledNow;
}
