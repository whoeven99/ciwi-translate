import prisma from "../../../db.server";
import { ensureAccount } from "../account/ensureAccount.server";
import { appendBillingLog } from "../billingLog.server";
import { BILLING_LOG_EVENT } from "../types.server";

/** BillingLog.referenceId：店铺终身只发一次 Launch Credits。 */
export const LAUNCH_CREDITS_REFERENCE_ID = "launch_credits";

export const LAUNCH_CREDITS_BY_TIER = {
  basic: 4_000_000,
  pro: 8_000_000,
  premium: 16_000_000,
} as const;

export type LaunchCreditTier = keyof typeof LAUNCH_CREDITS_BY_TIER;

/**
 * planKey（如 basic-monthly / pro-annual）→ Launch 档位额度。
 * 未识别套餐返回 0（不发）。
 */
export function resolveLaunchCreditsForPlanKey(planKey: string): number {
  const key = planKey.trim().toLowerCase();
  if (key.startsWith("premium")) return LAUNCH_CREDITS_BY_TIER.premium;
  if (key.startsWith("pro")) return LAUNCH_CREDITS_BY_TIER.pro;
  if (key.startsWith("basic")) return LAUNCH_CREDITS_BY_TIER.basic;
  return 0;
}

export type GrantLaunchCreditsResult =
  | { granted: true; credits: number }
  | { granted: false; reason: "already_granted" | "not_lifetime_first" | "unknown_plan" };

/**
 * 店铺终身首次订阅激活后发放 Launch Credits → trialCredits。
 * 须在 SUBSCRIPTION_ACTIVATED 账本写入之后调用。
 * 幂等：BillingLog TRIAL_GRANTED + referenceId=launch_credits。
 */
export async function grantLaunchCreditsIfEligible(params: {
  shop: string;
  planKey: string;
}): Promise<GrantLaunchCreditsResult> {
  const { shop, planKey } = params;
  const credits = resolveLaunchCreditsForPlanKey(planKey);
  if (credits <= 0) {
    return { granted: false, reason: "unknown_plan" };
  }

  await ensureAccount(shop);

  const prior = await prisma.billingLog.findFirst({
    where: {
      shop,
      eventType: BILLING_LOG_EVENT.TRIAL_GRANTED,
      referenceId: LAUNCH_CREDITS_REFERENCE_ID,
    },
  });
  if (prior) {
    return { granted: false, reason: "already_granted" };
  }

  const activatedCount = await prisma.billingLog.count({
    where: { shop, eventType: BILLING_LOG_EVENT.SUBSCRIPTION_ACTIVATED },
  });
  if (activatedCount !== 1) {
    return { granted: false, reason: "not_lifetime_first" };
  }

  await prisma.account.update({
    where: { shop },
    data: { trialCredits: { increment: credits } },
  });

  await appendBillingLog({
    shop,
    eventType: BILLING_LOG_EVENT.TRIAL_GRANTED,
    planKey,
    referenceId: LAUNCH_CREDITS_REFERENCE_ID,
    creditsDelta: credits,
    metadata: {
      grantKind: "launch_credits",
      launchCredits: credits,
    },
  });

  return { granted: true, credits };
}
