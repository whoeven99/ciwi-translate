/**
 * Worker 侧 Launch Credits 发放（对齐 App grantLaunchCredits.server.ts）。
 * 店铺终身首次 SUBSCRIPTION_ACTIVATED 后写入 trialCredits；TRIAL_GRANTED 幂等。
 */

import { randomUUID } from "node:crypto";
import { getTsfDb } from "./tsfDb.js";

export const LAUNCH_CREDITS_REFERENCE_ID = "launch_credits";

export const LAUNCH_CREDITS_BY_TIER = {
  basic: 4_000_000,
  pro: 8_000_000,
  premium: 16_000_000,
} as const;

export function resolveLaunchCreditsForPlanKey(planKey: string): number {
  const key = planKey.trim().toLowerCase();
  if (key.startsWith("premium")) return LAUNCH_CREDITS_BY_TIER.premium;
  if (key.startsWith("pro")) return LAUNCH_CREDITS_BY_TIER.pro;
  if (key.startsWith("basic")) return LAUNCH_CREDITS_BY_TIER.basic;
  return 0;
}

export type GrantLaunchCreditsResult =
  | { granted: true; credits: number }
  | {
      granted: false;
      reason: "already_granted" | "not_lifetime_first" | "unknown_plan";
    };

/**
 * 须在 SUBSCRIPTION_ACTIVATED 写入之后调用。
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

  const db = getTsfDb();
  const now = new Date().toISOString();

  const prior = await db.execute({
    sql: `SELECT id FROM BillingLog
          WHERE shop = ? AND eventType = 'TRIAL_GRANTED' AND referenceId = ?
          LIMIT 1`,
    args: [shop, LAUNCH_CREDITS_REFERENCE_ID],
  });
  if (prior.rows[0]) {
    return { granted: false, reason: "already_granted" };
  }

  const countRes = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM BillingLog
          WHERE shop = ? AND eventType = 'SUBSCRIPTION_ACTIVATED'`,
    args: [shop],
  });
  const activatedCount = Number(countRes.rows[0]?.n ?? 0);
  if (activatedCount !== 1) {
    return { granted: false, reason: "not_lifetime_first" };
  }

  await db.execute({
    sql: `UPDATE Account
          SET trialCredits = trialCredits + ?, updatedAt = ?
          WHERE shop = ?`,
    args: [credits, now, shop],
  });

  await db.execute({
    sql: `INSERT INTO BillingLog (
            id, shop, eventType, planKey, referenceId, creditsDelta, usedCredits, metadata, createdAt
          ) VALUES (?, ?, 'TRIAL_GRANTED', ?, ?, ?, NULL, ?, ?)`,
    args: [
      randomUUID(),
      shop,
      planKey,
      LAUNCH_CREDITS_REFERENCE_ID,
      credits,
      JSON.stringify({
        grantKind: "launch_credits",
        launchCredits: credits,
        source: "worker_reconcile",
      }),
      now,
    ],
  });

  return { granted: true, credits };
}
