/**
 * Worker 侧 Basic 首付赠送（对齐 App grantBasicFirstPayBonus.server.ts）。
 * 首次付费且当时是 Basic：1.5M purchasedCredits + 1M trialCredits（30 天）。
 */

import { randomUUID } from "node:crypto";
import { getTsfDb } from "./tsfDb.js";

export const LAUNCH_CREDITS_REFERENCE_ID = "launch_credits";
export const BASIC_FIRST_PAY_BONUS_REFERENCE_ID = "basic_first_pay_bonus";
export const BASIC_FIRST_PAY_PERMANENT_CREDITS = 1_500_000;
export const BASIC_FIRST_PAY_EXPIRING_CREDITS = 1_000_000;
export const BASIC_FIRST_PAY_TTL_DAYS = 30;

export type GrantBasicFirstPayBonusResult =
  | { granted: true; permanentCredits: number; expiringCredits: number }
  | {
      granted: false;
      reason: "already_granted" | "not_basic" | "in_trial";
    };

export function isBasicPlanKey(planKey: string): boolean {
  return planKey.trim().toLowerCase().startsWith("basic");
}

export function isInTrialPeriod(
  trialEndsAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  return trialEndsAt != null && trialEndsAt.getTime() > now.getTime();
}

export function basicFirstPayBonusExpiresAt(from: Date = new Date()): Date {
  return new Date(
    from.getTime() + BASIC_FIRST_PAY_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
}

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

  const db = getTsfDb();
  const nowIso = now.toISOString();

  const prior = await db.execute({
    sql: `SELECT id FROM BillingLog
          WHERE shop = ? AND eventType = 'TRIAL_GRANTED'
            AND referenceId IN (?, ?)
          LIMIT 1`,
    args: [shop, BASIC_FIRST_PAY_BONUS_REFERENCE_ID, LAUNCH_CREDITS_REFERENCE_ID],
  });
  if (prior.rows[0]) {
    return { granted: false, reason: "already_granted" };
  }

  const expiresAt = basicFirstPayBonusExpiresAt(now);
  await db.execute({
    sql: `UPDATE Account
          SET purchasedCredits = purchasedCredits + ?,
              trialCredits = trialCredits + ?,
              trialCreditsExpiresAt = ?,
              updatedAt = ?
          WHERE shop = ?`,
    args: [
      BASIC_FIRST_PAY_PERMANENT_CREDITS,
      BASIC_FIRST_PAY_EXPIRING_CREDITS,
      expiresAt.toISOString(),
      nowIso,
      shop,
    ],
  });

  await db.execute({
    sql: `INSERT INTO BillingLog (
            id, shop, eventType, planKey, referenceId, creditsDelta, usedCredits, metadata, createdAt
          ) VALUES (?, ?, 'TRIAL_GRANTED', ?, ?, ?, NULL, ?, ?)`,
    args: [
      randomUUID(),
      shop,
      planKey,
      BASIC_FIRST_PAY_BONUS_REFERENCE_ID,
      BASIC_FIRST_PAY_PERMANENT_CREDITS + BASIC_FIRST_PAY_EXPIRING_CREDITS,
      JSON.stringify({
        grantKind: "basic_first_pay_bonus",
        permanentCredits: BASIC_FIRST_PAY_PERMANENT_CREDITS,
        expiringCredits: BASIC_FIRST_PAY_EXPIRING_CREDITS,
        trialCreditsExpiresAt: expiresAt.toISOString(),
        source: "worker_reconcile",
      }),
      nowIso,
    ],
  });

  return {
    granted: true,
    permanentCredits: BASIC_FIRST_PAY_PERMANENT_CREDITS,
    expiringCredits: BASIC_FIRST_PAY_EXPIRING_CREDITS,
  };
}
