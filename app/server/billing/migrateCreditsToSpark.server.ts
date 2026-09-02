import { randomUUID } from "node:crypto";
import prisma from "../../db.server";
import { appendBillingLog } from "./billingLog.server";
import { scheduleCreditMigrationFeishuNotify } from "./creditMigrationFeishu.server";
import { getAccountQuota } from "./quota/getAccountQuota.server";
import {
  grantCreditsOnSpark,
  isSparkMigrationConfigured,
  rollbackCreditsOnSpark,
} from "./sparkCreditMigrationClient.server";
import { BILLING_LOG_EVENT } from "./types.server";

export type MigrateCreditsToSparkInput = {
  shop: string;
  all?: boolean;
  amount?: unknown;
  transferId?: unknown;
};

export type MigrateCreditsToSparkResult = {
  ok: boolean;
  errorCode?: string;
  transferId: string;
  amount: number;
  remainingBefore: number;
  remainingAfter: number;
  usedCreditsBefore?: number;
  usedCreditsAfter?: number;
  sparkPurchasedBefore?: number;
  sparkPurchasedAfter?: number;
  tsfPurchasedBefore?: number;
  tsfPurchasedAfter?: number;
  rolledBack?: boolean;
  alreadyApplied?: boolean;
};

export function resolveMigrateAmount(params: {
  remaining: number;
  all?: boolean;
  amount?: unknown;
}): { ok: true; amount: number } | { ok: false; errorCode: "INSUFFICIENT" | "INVALID_AMOUNT" } {
  const remaining = Math.max(0, Math.floor(params.remaining));
  if (remaining < 1) {
    return { ok: false, errorCode: "INSUFFICIENT" };
  }

  if (params.all) {
    return { ok: true, amount: remaining };
  }

  let requested: number | null = null;
  if (typeof params.amount === "number" && Number.isFinite(params.amount)) {
    requested = Math.trunc(params.amount);
  } else if (typeof params.amount === "string" && params.amount.trim()) {
    const n = Number(params.amount.trim());
    if (Number.isFinite(n)) requested = Math.trunc(n);
  }

  if (requested == null || requested < 1) {
    return { ok: false, errorCode: "INVALID_AMOUNT" };
  }
  if (requested > remaining) {
    return { ok: false, errorCode: "INSUFFICIENT" };
  }
  return { ok: true, amount: requested };
}

function parseTransferId(value: unknown): string {
  if (typeof value === "string" && value.trim() && value.trim().length <= 80) {
    return value.trim();
  }
  return `mig_${randomUUID()}`;
}

async function writeFailedLog(params: {
  shop: string;
  transferId: string;
  amount: number;
  usedCredits: number;
  errorCode: string;
  extra?: Record<string, unknown>;
}): Promise<void> {
  await appendBillingLog({
    shop: params.shop,
    eventType: BILLING_LOG_EVENT.CREDITS_MIGRATION_FAILED,
    referenceId: params.transferId,
    creditsDelta: 0,
    usedCredits: params.usedCredits,
    metadata: {
      source: "tsf_migration",
      status: "failed",
      errorCode: params.errorCode,
      amount: params.amount,
      ...params.extra,
    },
  });
}

export async function migrateCreditsToSpark(
  input: MigrateCreditsToSparkInput,
): Promise<MigrateCreditsToSparkResult> {
  const shop = input.shop.trim();
  const transferId = parseTransferId(input.transferId);
  const quota = await getAccountQuota(shop);
  const remainingBefore = quota?.remainingCredits ?? 0;
  const usedBefore = quota?.usedCredits ?? 0;
  const purchasedBefore = quota?.purchasedCredits ?? 0;

  const fail = async (
    errorCode: string,
    extra?: Partial<MigrateCreditsToSparkResult>,
  ): Promise<MigrateCreditsToSparkResult> => {
    const amount = extra?.amount ?? 0;
    await writeFailedLog({
      shop,
      transferId,
      amount,
      usedCredits: usedBefore,
      errorCode,
      extra: extra?.rolledBack ? { rolledBack: true } : undefined,
    });
    scheduleCreditMigrationFeishuNotify({
      shop,
      amount,
      transferId,
      ok: false,
      errorCode,
      rolledBack: extra?.rolledBack,
      tsfUsedBefore: usedBefore,
      tsfUsedAfter: usedBefore,
      tsfPurchasedBefore: purchasedBefore,
      tsfPurchasedAfter: extra?.tsfPurchasedAfter ?? purchasedBefore,
      sparkPurchasedBefore: extra?.sparkPurchasedBefore,
      sparkPurchasedAfter: extra?.sparkPurchasedAfter,
    });
    return {
      ok: false,
      errorCode,
      transferId,
      amount,
      remainingBefore,
      remainingAfter: remainingBefore,
      usedCreditsBefore: usedBefore,
      usedCreditsAfter: usedBefore,
      ...extra,
    };
  };

  if (!quota) {
    scheduleCreditMigrationFeishuNotify({
      shop,
      amount: 0,
      transferId,
      ok: false,
      errorCode: "ACCOUNT_NOT_FOUND",
    });
    return {
      ok: false,
      errorCode: "ACCOUNT_NOT_FOUND",
      transferId,
      amount: 0,
      remainingBefore: 0,
      remainingAfter: 0,
    };
  }

  const migratable = quota.migratablePurchasedCredits;
  const resolved = resolveMigrateAmount({
    remaining: migratable,
    all: input.all === true,
    amount: input.amount,
  });
  if (!resolved.ok) {
    const attempted =
      input.all === true
        ? migratable
        : typeof input.amount === "number" && Number.isFinite(input.amount)
          ? Math.max(0, Math.trunc(input.amount))
          : migratable;
    return fail(resolved.errorCode, { amount: attempted });
  }
  const amount = resolved.amount;

  const existingOut = await prisma.billingLog.findFirst({
    where: {
      shop,
      eventType: BILLING_LOG_EVENT.CREDITS_MIGRATED_OUT,
      referenceId: transferId,
    },
  });
  if (existingOut) {
    return {
      ok: true,
      alreadyApplied: true,
      transferId,
      amount: Math.abs(existingOut.creditsDelta ?? amount),
      remainingBefore,
      remainingAfter: remainingBefore,
      usedCreditsBefore: usedBefore,
      usedCreditsAfter: usedBefore,
    };
  }

  if (!isSparkMigrationConfigured()) {
    return fail("NOT_CONFIGURED", { amount });
  }

  const grant = await grantCreditsOnSpark({ shop, amount, transferId });
  if (!grant.ok) {
    return fail(grant.errorCode, {
      amount,
    });
  }

  try {
    await prisma.account.update({
      where: { shop },
      data: { purchasedCredits: { decrement: amount } },
    });
    const after = await getAccountQuota(shop);
    const usedAfter = after?.usedCredits ?? usedBefore;
    const purchasedAfter = after?.purchasedCredits ?? Math.max(0, purchasedBefore - amount);
    const remainingAfter = after?.remainingCredits ?? Math.max(0, remainingBefore - amount);

    await appendBillingLog({
      shop,
      eventType: BILLING_LOG_EVENT.CREDITS_MIGRATED_OUT,
      referenceId: transferId,
      creditsDelta: -amount,
      usedCredits: usedAfter,
      metadata: {
        source: "tsf_migration",
        status: "ok",
        amount,
        migratableBefore: migratable,
        purchasedCreditsBefore: purchasedBefore,
        purchasedCreditsAfter: purchasedAfter,
        purchasedConsumedByUsage: quota.purchasedConsumedByUsage,
        subscriptionCredits: quota.subscriptionCredits,
        trialCredits: quota.trialCredits,
        sparkPurchasedBefore: grant.purchasedBefore,
        sparkPurchasedAfter: grant.purchasedAfter,
      },
    });

    scheduleCreditMigrationFeishuNotify({
      shop,
      amount,
      transferId,
      ok: true,
      tsfUsedBefore: usedBefore,
      tsfUsedAfter: usedAfter,
      tsfPurchasedBefore: purchasedBefore,
      tsfPurchasedAfter: purchasedAfter,
      sparkPurchasedBefore: grant.purchasedBefore,
      sparkPurchasedAfter: grant.purchasedAfter,
    });

    return {
      ok: true,
      alreadyApplied: grant.alreadyApplied,
      transferId,
      amount,
      remainingBefore,
      remainingAfter,
      usedCreditsBefore: usedBefore,
      usedCreditsAfter: usedAfter,
      tsfPurchasedBefore: purchasedBefore,
      tsfPurchasedAfter: purchasedAfter,
      sparkPurchasedBefore: grant.purchasedBefore,
      sparkPurchasedAfter: grant.purchasedAfter,
    };
  } catch (error) {
    console.error(
      `[credit-migration] deduct failed shop=${shop} transferId=${transferId}`,
      error,
    );
    const rollback = await rollbackCreditsOnSpark({ shop, transferId });
    return fail("DEDUCT_FAILED", {
      amount,
      rolledBack: rollback.ok,
      sparkPurchasedBefore: grant.purchasedBefore,
      sparkPurchasedAfter: rollback.ok ? rollback.purchasedAfter : grant.purchasedAfter,
    });
  }
}
