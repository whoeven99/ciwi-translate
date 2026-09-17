import prisma from "../../../db.server";
import {
  earliestTrialLotExpiresAt,
  settleExpiredInstallTrialCredits,
  type InstallTrialExpiryFields,
  type SettleExpiredTrialOptions,
} from "../accountBalance.server";
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

function trialExpiryFieldsFromAccount(account: {
  usedCredits: number;
  trialInstallCredits: number;
  trialInstallExpiresAt: Date | null;
  trialBonusCredits: number;
  trialBonusExpiresAt: Date | null;
}): InstallTrialExpiryFields {
  return {
    usedCredits: account.usedCredits,
    trialInstallCredits: account.trialInstallCredits,
    trialInstallExpiresAt: account.trialInstallExpiresAt,
    trialBonusCredits: account.trialBonusCredits,
    trialBonusExpiresAt: account.trialBonusExpiresAt,
  };
}

/**
 * 终身首次建 Account 后发放安装赠送 → 安装试用笔，30 天后到期结算。
 * 幂等：BillingLog TRIAL_GRANTED + referenceId=install_credits。
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
      trialInstallExpiresAt: null,
    },
    data: {
      trialCredits: { increment: INSTALL_CREDITS },
      trialInstallCredits: { increment: INSTALL_CREDITS },
      trialInstallExpiresAt: expiresAt,
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
 * 试用赠送到期后写库结算（安装笔 / 首订笔分开）：
 * FIFO 先安装后首订；只清到期那一笔，不碰订阅/加量包。
 * 每笔各写 BillingLog TRIAL_EXPIRED（creditsDelta = -leftover）。可重复调用。
 */
export async function expireInstallTrialCreditsIfDue(
  shop: string,
  now: Date = new Date(),
  options?: SettleExpiredTrialOptions,
): Promise<boolean> {
  const account = await prisma.account.findUnique({ where: { shop } });
  if (!account || account.deletedAt) return false;

  const settled = settleExpiredInstallTrialCredits(
    trialExpiryFieldsFromAccount(account),
    now,
    options,
  );
  if (!settled.settled) return false;

  const legacyExpiresAt = earliestTrialLotExpiresAt(
    settled.trialInstallCredits,
    settled.trialInstallExpiresAt,
    settled.trialBonusCredits,
    settled.trialBonusExpiresAt,
  );

  const settledNow = await prisma.$transaction(async (tx) => {
    const updated = await tx.account.updateMany({
      where: {
        shop,
        deletedAt: null,
        usedCredits: account.usedCredits,
        trialInstallCredits: account.trialInstallCredits,
        trialBonusCredits: account.trialBonusCredits,
      },
      data: {
        trialCredits: settled.trialCredits,
        usedCredits: settled.usedCredits,
        trialInstallCredits: settled.trialInstallCredits,
        trialInstallExpiresAt: settled.trialInstallExpiresAt,
        trialBonusCredits: settled.trialBonusCredits,
        trialBonusExpiresAt: settled.trialBonusExpiresAt,
        trialCreditsExpiresAt: legacyExpiresAt,
      },
    });
    if (updated.count === 0) return false;

    for (const lot of settled.lots) {
      const prior = await tx.billingLog.findFirst({
        where: {
          shop,
          eventType: BILLING_LOG_EVENT.TRIAL_EXPIRED,
          referenceId: lot.referenceId,
        },
      });
      if (prior) continue;
      await tx.billingLog.create({
        data: {
          shop,
          eventType: BILLING_LOG_EVENT.TRIAL_EXPIRED,
          referenceId: lot.referenceId,
          creditsDelta: -lot.leftover,
          usedCredits: settled.usedCredits,
          metadata: {
            grantKind: lot.grantKind,
            leftover: lot.leftover,
            consumed: lot.consumed,
            trialCreditsExpiresAt: lot.expiresAt,
            lot: lot.kind,
          },
        },
      });
    }
    return true;
  });

  return settledNow;
}
