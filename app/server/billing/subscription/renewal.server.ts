import type { Account, AppSubscription } from "../../../generated/prisma";
import prisma from "../../../db.server";
import {
  canSettleAtRenewal,
  settlePoolsAtRenewal,
} from "../accountBalance.server";
import { appendBillingLog } from "../billingLog.server";
import { grantBasicFirstPayBonusIfEligible } from "../grant/grantBasicFirstPayBonus.server";
import { APP_SUBSCRIPTION_STATUS, BILLING_LOG_EVENT } from "../types.server";

export type SubscriptionPeriodSnapshot = {
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  creditsPerPeriod: number;
  planKey: string;
};

/**
 * 续费：归档上一周期 → 写 Log → 刷新订阅池、清零 usedCredits。
 * 订阅池为「替换」语义（不结转）；加量包/试用池按本周期用量结算后结转。
 */
export async function archivePeriodAndRenew(params: {
  shop: string;
  subscription: AppSubscription;
  account: Account;
  next: SubscriptionPeriodSnapshot;
}): Promise<void> {
  const { shop, subscription, account, next } = params;

  const periodStart = subscription.currentPeriodStart;
  const periodEnd = subscription.currentPeriodEnd;

  if (periodStart && periodEnd) {
    await prisma.accountPeriodUsage.upsert({
      where: {
        appSubscriptionId_periodStart_periodEnd: {
          appSubscriptionId: subscription.shopifySubscriptionId,
          periodStart,
          periodEnd,
        },
      },
      create: {
        shop,
        appSubscriptionId: subscription.shopifySubscriptionId,
        planKey: subscription.planKey,
        periodStart,
        periodEnd,
        usedCredits: account.usedCredits,
        subscriptionCreditsAllocated: subscription.creditsPerPeriod,
        purchasedCreditsRemaining: account.purchasedCredits,
        trialCreditsRemaining: account.trialCredits,
      },
      update: {},
    });
  }

  await appendBillingLog({
    shop,
    eventType: BILLING_LOG_EVENT.SUBSCRIPTION_RENEWED,
    planKey: subscription.planKey,
    referenceId: subscription.shopifySubscriptionId,
    creditsDelta: next.creditsPerPeriod,
    usedCredits: account.usedCredits,
    metadata: {
      grantKind: "shopify_period",
      billingPeriodEnd: next.currentPeriodEnd?.toISOString() ?? null,
      previousPeriodEnd: periodEnd?.toISOString() ?? null,
      nextPeriodEnd: next.currentPeriodEnd?.toISOString() ?? null,
    },
  });

  const settled = canSettleAtRenewal(account)
    ? settlePoolsAtRenewal(account)
    : {
        subscriptionCredits: account.subscriptionCredits,
        purchasedCredits: account.purchasedCredits,
        trialCredits: account.trialCredits,
      };

  await prisma.$transaction([
    prisma.appSubscription.update({
      where: { shop },
      data: {
        planKey: next.planKey,
        creditsPerPeriod: next.creditsPerPeriod,
        currentPeriodStart: next.currentPeriodStart,
        currentPeriodEnd: next.currentPeriodEnd,
        status: APP_SUBSCRIPTION_STATUS.ACTIVE,
      },
    }),
    prisma.account.update({
      where: { shop },
      data: {
        usedCredits: 0,
        subscriptionCredits: next.creditsPerPeriod,
        purchasedCredits: settled.purchasedCredits,
        trialCredits: settled.trialCredits,
      },
    }),
  ]);

  const bonus = await grantBasicFirstPayBonusIfEligible({
    shop,
    planKey: next.planKey,
    trialEndsAt: subscription.trialEndsAt,
  });
  if (bonus.granted) {
    console.info(
      `[billing] basic first-pay bonus granted on renewal shop=${shop} planKey=${next.planKey} permanent=${bonus.permanentCredits} expiring=${bonus.expiringCredits}`,
    );
  }
}

/** 判定 webhook 是否为续费（同一订阅、状态 ACTIVE、周期末推后）。 */
export function isSubscriptionRenewal(
  previous: AppSubscription | null,
  nextPeriodEnd: Date | null,
): boolean {
  if (!previous?.currentPeriodEnd || !nextPeriodEnd) return false;
  if (previous.status !== APP_SUBSCRIPTION_STATUS.ACTIVE) return false;
  return nextPeriodEnd.getTime() > previous.currentPeriodEnd.getTime();
}
