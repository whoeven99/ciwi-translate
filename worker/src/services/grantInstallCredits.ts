/**
 * 安装赠送 20 万试用积分（30 天到期写库结算）。
 * 对齐 App grantInstallCredits.server.ts；Worker 仅在新建 Account 时发放。
 * 到期写库结算见 tsfDb.expireInstallTrialCreditsIfDue。
 */

import { randomUUID } from "node:crypto";
import { getTsfDb } from "./tsfDb.js";

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

export async function grantInstallCreditsIfEligible(
  shop: string,
): Promise<GrantInstallCreditsResult> {
  const db = getTsfDb();
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = installCreditsExpiresAt(now).toISOString();

  const prior = await db.execute({
    sql: `SELECT id FROM BillingLog
          WHERE shop = ? AND eventType = 'TRIAL_GRANTED' AND referenceId = ?
          LIMIT 1`,
    args: [shop, INSTALL_CREDITS_REFERENCE_ID],
  });
  if (prior.rows[0]) {
    return { granted: false, reason: "already_granted" };
  }

  const updated = await db.execute({
    sql: `UPDATE Account
          SET trialCredits = trialCredits + ?,
              trialInstallCredits = trialInstallCredits + ?,
              trialInstallExpiresAt = ?,
              trialCreditsExpiresAt = CASE
                WHEN trialBonusCredits > 0
                 AND trialBonusExpiresAt IS NOT NULL
                 AND trialBonusExpiresAt < ? THEN trialBonusExpiresAt
                ELSE ?
              END,
              updatedAt = ?
          WHERE shop = ?
            AND deletedAt IS NULL
            AND trialInstallExpiresAt IS NULL`,
    args: [INSTALL_CREDITS, INSTALL_CREDITS, expiresAt, expiresAt, expiresAt, nowIso, shop],
  });
  if (!updated.rowsAffected) {
    return { granted: false, reason: "already_granted" };
  }

  await db.execute({
    sql: `INSERT INTO BillingLog (
            id, shop, eventType, planKey, referenceId, creditsDelta, usedCredits, metadata, createdAt
          ) VALUES (?, ?, 'TRIAL_GRANTED', NULL, ?, ?, NULL, ?, ?)`,
    args: [
      randomUUID(),
      shop,
      INSTALL_CREDITS_REFERENCE_ID,
      INSTALL_CREDITS,
      JSON.stringify({
        grantKind: "install_credits",
        installCredits: INSTALL_CREDITS,
        trialCreditsExpiresAt: expiresAt,
        source: "worker",
      }),
      nowIso,
    ],
  });

  return { granted: true, credits: INSTALL_CREDITS };
}
