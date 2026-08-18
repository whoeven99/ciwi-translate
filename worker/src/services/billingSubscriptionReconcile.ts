/**
 * Reconcile TSF billing subscriptions against Shopify.
 *
 * Shopify is the source of truth for subscription status and period. This job
 * repairs local ACTIVE subscriptions that were renewed or cancelled in Shopify,
 * and also fills local records when a TSF shop has an offline token and an
 * ACTIVE Shopify subscription but no local AppSubscription row.
 */
import { randomUUID } from "node:crypto";
import {
  canSettleAtRenewal,
  settlePoolsAtRenewal,
} from "./accountBalance.js";
import {
  collectGrantedAnnualCreditCycleIndexes,
  decideAnnualCreditGrant,
  getAnnualCreditWindow,
} from "./annualCreditCycle.js";
import {
  getOfflineAccessTokenFromTsf,
  getTsfDb,
  getTsfAccountRemaining,
  hasTsfDbCredentials,
} from "./tsfDb.js";
import { fetchShopContact } from "./shopEmail.js";
import { sendSubscriptionRenewalEmail } from "./workerEmail.js";
import { notifyLifetimeFirstSubscribeFeishu } from "./lifecycleFeishuNotify.js";
import { grantLaunchCreditsIfEligible } from "./grantLaunchCredits.js";
import { buildShopifyAdminGraphqlUrl } from "./shopifyAdminApiVersion.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const PERIOD_END_TOLERANCE_MS = 12 * 60 * 60 * 1000;
const PERIOD_FIELD_TOLERANCE_MS = 1000;
const INTERVAL_DAYS: Record<string, number> = {
  MONTHLY: 30,
  ANNUAL: 365,
};

export type ReconcileAction =
  | "renewed"
  | "activated"
  | "cancelled"
  | "skipped"
  | "error";

export type ReconcileShopResult = {
  shop: string;
  action: ReconcileAction;
  reason?: string;
  localStatus?: string | null;
  shopifyStatus?: string | null;
  localPeriodEnd?: string | null;
  shopifyPeriodEnd?: string | null;
  localPlanKey?: string | null;
  shopifyPlanName?: string | null;
};

export type BillingReconcileOptions = {
  shop?: string;
  dryRun?: boolean;
  scanOrphans?: boolean;
  dueBefore?: Date;
};

export type BillingReconcileSummary = {
  scanned: number;
  renewed: number;
  activated: number;
  cancelled: number;
  skipped: number;
  errors: number;
  dryRun: boolean;
  details: ReconcileShopResult[];
};

type LocalSubscription = {
  shop: string;
  planKey: string;
  shopifySubscriptionId: string;
  billingInterval: string;
  status: string;
  creditsPerPeriod: number;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
};

type ShopifySubscriptionSnapshot = {
  id: string;
  name: string;
  status: string;
  currentPeriodEnd: Date | null;
  intervalRaw: string | null;
};

let running = false;

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function toSqlDate(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

function mapInterval(raw?: string | null): string {
  if (!raw) return "MONTHLY";
  const v = raw.trim().toUpperCase();
  if (v === "EVERY_30_DAYS" || v === "MONTHLY") return "MONTHLY";
  if (v === "ANNUAL" || v === "YEARLY") return "ANNUAL";
  return "MONTHLY";
}

function isRenewal(
  previous: LocalSubscription,
  nextPeriodEnd: Date | null,
): boolean {
  if (!previous.currentPeriodEnd || !nextPeriodEnd) return false;
  if (previous.status !== "ACTIVE") return false;
  const delta = nextPeriodEnd.getTime() - previous.currentPeriodEnd.getTime();
  return delta > PERIOD_END_TOLERANCE_MS;
}

function datesDiffer(
  local: Date | null,
  remote: Date,
  toleranceMs = PERIOD_FIELD_TOLERANCE_MS,
): boolean {
  if (!local) return true;
  return Math.abs(local.getTime() - remote.getTime()) > toleranceMs;
}

async function shopifyGraphql<T>(
  shop: string,
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T | null> {
  try {
    const resp = await fetch(buildShopifyAdminGraphqlUrl(shop), {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
    const body = (await resp.json()) as { data?: T; errors?: unknown };
    if (body.errors) {
      console.warn(`[billingReconcile] GraphQL errors shop=${shop}:`, body.errors);
      return null;
    }
    return body.data ?? null;
  } catch (err) {
    console.error(`[billingReconcile] GraphQL failed shop=${shop}:`, err);
    return null;
  }
}

function parseShopifySubscription(node: {
  id?: string;
  name?: string;
  status?: string;
  currentPeriodEnd?: string | null;
  lineItems?: Array<{
    plan?: { pricingDetails?: { interval?: string } };
  }>;
} | null): ShopifySubscriptionSnapshot | null {
  if (!node?.id || !node.status) return null;
  const intervalRaw =
    node.lineItems?.find((li) => li?.plan?.pricingDetails?.interval)?.plan
      ?.pricingDetails?.interval ?? null;
  return {
    id: node.id,
    name: node.name ?? "",
    status: node.status,
    currentPeriodEnd: parseDate(node.currentPeriodEnd),
    intervalRaw,
  };
}

async function fetchShopifyActiveSubscription(
  shop: string,
  accessToken: string,
): Promise<ShopifySubscriptionSnapshot | null> {
  const active = await shopifyGraphql<{
    currentAppInstallation: {
      activeSubscriptions: Array<{
        id: string;
        name: string;
        status: string;
        currentPeriodEnd: string;
        lineItems: Array<{ plan: { pricingDetails: { interval?: string } } }>;
      }>;
    };
  }>(
    shop,
    accessToken,
    `query ActiveAppSubscriptions {
      currentAppInstallation {
        activeSubscriptions {
          id name status currentPeriodEnd
          lineItems {
            plan {
              pricingDetails {
                __typename
                ... on AppRecurringPricing { interval }
              }
            }
          }
        }
      }
    }`,
  );
  return parseShopifySubscription(
    active?.currentAppInstallation?.activeSubscriptions?.[0] ?? null,
  );
}

async function fetchShopifySubscription(
  shop: string,
  accessToken: string,
  gid: string,
): Promise<ShopifySubscriptionSnapshot | null> {
  const byId = await shopifyGraphql<{
    node: {
      id: string;
      name: string;
      status: string;
      currentPeriodEnd: string | null;
      lineItems: Array<{ plan: { pricingDetails: { interval?: string } } }>;
    } | null;
  }>(
    shop,
    accessToken,
    `query AppSubscriptionById($id: ID!) {
      node(id: $id) {
        ... on AppSubscription {
          id name status currentPeriodEnd
          lineItems {
            plan {
              pricingDetails {
                __typename
                ... on AppRecurringPricing { interval }
              }
            }
          }
        }
      }
    }`,
    { id: gid },
  );
  const byIdSub = parseShopifySubscription(byId?.node ?? null);
  if (byIdSub?.status === "ACTIVE") return byIdSub;

  const activeSub = await fetchShopifyActiveSubscription(shop, accessToken);
  return activeSub ?? byIdSub;
}

async function findPlanCredits(
  shopifyPlanName: string,
  billingInterval: string,
): Promise<{ planKey: string; credits: number } | null> {
  const rs = await getTsfDb().execute({
    sql: `SELECT planKey, credits FROM PlanCatalog
          WHERE kind = 'SUBSCRIPTION'
            AND shopifyPlanName = ?
            AND billingInterval = ?
            AND enabled = 1
          LIMIT 1`,
    args: [shopifyPlanName, billingInterval],
  });
  const row = rs.rows[0];
  if (!row) return null;
  return {
    planKey: String(row.planKey),
    credits: Number(row.credits) || 0,
  };
}

async function ensureAccount(shop: string): Promise<void> {
  const now = new Date().toISOString();
  await getTsfDb().execute({
    sql: `INSERT INTO Account (
            shop, subscriptionCredits, purchasedCredits, trialCredits,
            usedCredits, createdAt, updatedAt
          ) VALUES (?, 0, 0, 0, 0, ?, ?)
          ON CONFLICT(shop) DO NOTHING`,
    args: [shop, now, now],
  });
}

async function archivePeriodAndRenew(params: {
  shop: string;
  local: LocalSubscription;
  account: {
    subscriptionCredits: number;
    purchasedCredits: number;
    trialCredits: number;
    usedCredits: number;
  };
  next: {
    planKey: string;
    creditsPerPeriod: number;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
  };
}): Promise<void> {
  const { shop, local, account, next } = params;
  const db = getTsfDb();
  const now = new Date().toISOString();

  if (local.currentPeriodStart && local.currentPeriodEnd) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO AccountPeriodUsage (
              id, shop, appSubscriptionId, planKey, periodStart, periodEnd,
              usedCredits, subscriptionCreditsAllocated,
              purchasedCreditsRemaining, trialCreditsRemaining, archivedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        randomUUID(),
        shop,
        local.shopifySubscriptionId,
        local.planKey,
        toSqlDate(local.currentPeriodStart),
        toSqlDate(local.currentPeriodEnd),
        account.usedCredits,
        local.creditsPerPeriod,
        account.purchasedCredits,
        account.trialCredits,
        now,
      ],
    });
  }

  await db.execute({
    sql: `INSERT INTO BillingLog (
            id, shop, eventType, planKey, referenceId, creditsDelta, usedCredits, metadata, createdAt
          ) VALUES (?, ?, 'SUBSCRIPTION_RENEWED', ?, ?, ?, ?, ?, ?)`,
    args: [
      randomUUID(),
      shop,
      local.planKey,
      local.shopifySubscriptionId,
      next.creditsPerPeriod,
      account.usedCredits,
      JSON.stringify({
        grantKind: "shopify_period",
        billingPeriodEnd: next.currentPeriodEnd.toISOString(),
        previousPeriodEnd: local.currentPeriodEnd?.toISOString() ?? null,
        nextPeriodEnd: next.currentPeriodEnd.toISOString(),
        source: "worker_reconcile",
      }),
      now,
    ],
  });

  const settled = canSettleAtRenewal(account)
    ? settlePoolsAtRenewal(account)
    : {
        subscriptionCredits: account.subscriptionCredits,
        purchasedCredits: account.purchasedCredits,
        trialCredits: account.trialCredits,
      };

  await db.execute({
    sql: `UPDATE AppSubscription SET
            planKey = ?, creditsPerPeriod = ?,
            currentPeriodStart = ?, currentPeriodEnd = ?,
            status = 'ACTIVE', updatedAt = ?
          WHERE shop = ?`,
    args: [
      next.planKey,
      next.creditsPerPeriod,
      toSqlDate(next.currentPeriodStart),
      toSqlDate(next.currentPeriodEnd),
      now,
      shop,
    ],
  });

  await db.execute({
    sql: `UPDATE Account SET
            usedCredits = 0,
            subscriptionCredits = ?,
            purchasedCredits = ?,
            trialCredits = ?,
            updatedAt = ?
          WHERE shop = ?`,
    args: [
      next.creditsPerPeriod,
      settled.purchasedCredits,
      settled.trialCredits,
      now,
      shop,
    ],
  });
}

async function cancelLocalSubscription(
  shop: string,
  local: LocalSubscription,
  status: string,
): Promise<void> {
  const db = getTsfDb();
  const now = new Date().toISOString();
  const acc = await db.execute({
    sql: `SELECT subscriptionCredits FROM Account WHERE shop = ? LIMIT 1`,
    args: [shop],
  });
  const previous = Math.max(0, Number(acc.rows[0]?.subscriptionCredits ?? 0));
  const removed = Math.min(previous, Math.max(0, local.creditsPerPeriod));

  await db.execute({
    sql: `INSERT INTO BillingLog (
            id, shop, eventType, planKey, referenceId, creditsDelta, usedCredits, metadata, createdAt
          ) VALUES (?, ?, 'SUBSCRIPTION_CANCELLED', ?, ?, ?, NULL, ?, ?)`,
    args: [
      randomUUID(),
      shop,
      local.planKey,
      local.shopifySubscriptionId,
      -removed,
      JSON.stringify({
        status,
        previousSubscriptionCredits: previous,
        cancelledAt: now,
        source: "worker_reconcile",
      }),
      now,
    ],
  });

  await db.execute({
    sql: `UPDATE Account SET subscriptionCredits = ?, updatedAt = ? WHERE shop = ?`,
    args: [previous - removed, now, shop],
  });
  await db.execute({
    sql: `DELETE FROM AccountPeriodUsage WHERE appSubscriptionId = ?`,
    args: [local.shopifySubscriptionId],
  });
  await db.execute({
    sql: `DELETE FROM AppSubscription WHERE shop = ?`,
    args: [shop],
  });
}

async function activateOrReplaceSubscription(params: {
  shop: string;
  shopifySub: ShopifySubscriptionSnapshot;
  planKey: string;
  billingInterval: string;
  creditsPerPeriod: number;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
}): Promise<void> {
  const {
    shop,
    shopifySub,
    planKey,
    billingInterval,
    creditsPerPeriod,
    currentPeriodStart,
    currentPeriodEnd,
  } = params;
  const db = getTsfDb();
  const now = new Date().toISOString();

  await ensureAccount(shop);
  await db.execute({
    sql: `INSERT INTO AppSubscription (
            shop, planKey, shopifySubscriptionId, billingInterval, status,
            creditsPerPeriod, trialEndsAt, currentPeriodStart, currentPeriodEnd,
            cancelledAt, rawPayload, createdAt, updatedAt
          ) VALUES (?, ?, ?, ?, 'ACTIVE', ?, NULL, ?, ?, NULL, ?, ?, ?)
          ON CONFLICT(shop) DO UPDATE SET
            planKey = excluded.planKey,
            shopifySubscriptionId = excluded.shopifySubscriptionId,
            billingInterval = excluded.billingInterval,
            status = 'ACTIVE',
            creditsPerPeriod = excluded.creditsPerPeriod,
            currentPeriodStart = excluded.currentPeriodStart,
            currentPeriodEnd = excluded.currentPeriodEnd,
            cancelledAt = NULL,
            rawPayload = excluded.rawPayload,
            updatedAt = excluded.updatedAt`,
    args: [
      shop,
      planKey,
      shopifySub.id,
      billingInterval,
      creditsPerPeriod,
      toSqlDate(currentPeriodStart),
      toSqlDate(currentPeriodEnd),
      JSON.stringify({ source: "worker_reconcile", name: shopifySub.name }),
      now,
      now,
    ],
  });

  await db.execute({
    sql: `UPDATE Account SET subscriptionCredits = ?, updatedAt = ? WHERE shop = ?`,
    args: [creditsPerPeriod, now, shop],
  });

  const prior = await db.execute({
    sql: `SELECT id FROM BillingLog
          WHERE shop = ? AND eventType = 'SUBSCRIPTION_ACTIVATED' AND referenceId = ?
          LIMIT 1`,
    args: [shop, shopifySub.id],
  });
  if (!prior.rows[0]) {
    await db.execute({
      sql: `INSERT INTO BillingLog (
              id, shop, eventType, planKey, referenceId, creditsDelta, usedCredits, metadata, createdAt
            ) VALUES (?, ?, 'SUBSCRIPTION_ACTIVATED', ?, ?, ?, NULL, ?, ?)`,
      args: [
        randomUUID(),
        shop,
        planKey,
        shopifySub.id,
        creditsPerPeriod,
        JSON.stringify({
          billingInterval,
          billingPeriodEnd: currentPeriodEnd.toISOString(),
          grantKind: "shopify_period",
          source: "worker_reconcile",
        }),
        now,
      ],
    });
    const launch = await grantLaunchCreditsIfEligible({ shop, planKey });
    if (launch.granted) {
      console.info(
        `[billing reconcile] launch credits granted shop=${shop} planKey=${planKey} credits=${launch.credits}`,
      );
    }
    void notifyLifetimeFirstSubscribeFeishu(shop).catch((err) => {
      console.error(
        `[billing reconcile] first-subscribe feishu failed shop=${shop}`,
        err,
      );
    });
  }
}

/** 仅同步 Shopify 账期字段，不改额度（用于修脏 currentPeriodStart 等）。 */
async function syncLocalPeriodFields(params: {
  shop: string;
  shopifySubscriptionId: string;
  billingInterval: string;
  planKey: string;
  creditsPerPeriod: number;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
}): Promise<void> {
  const now = new Date().toISOString();
  await getTsfDb().execute({
    sql: `UPDATE AppSubscription SET
            shopifySubscriptionId = ?,
            billingInterval = ?,
            planKey = ?,
            creditsPerPeriod = ?,
            currentPeriodStart = ?,
            currentPeriodEnd = ?,
            status = 'ACTIVE',
            updatedAt = ?
          WHERE shop = ?`,
    args: [
      params.shopifySubscriptionId,
      params.billingInterval,
      params.planKey,
      params.creditsPerPeriod,
      toSqlDate(params.currentPeriodStart),
      toSqlDate(params.currentPeriodEnd),
      now,
      params.shop,
    ],
  });
}

/**
 * 年付 30 天额度发放：结算池 + 写 RENEWED + 重置 subscriptionCredits。
 * 不改 AppSubscription.currentPeriodEnd（保持 Shopify 年账期真值）。
 */
async function grantAnnualCreditCycle(params: {
  shop: string;
  local: LocalSubscription;
  account: {
    subscriptionCredits: number;
    purchasedCredits: number;
    trialCredits: number;
    usedCredits: number;
  };
  planKey: string;
  creditsPerPeriod: number;
  billingPeriodEnd: Date;
  creditCycleIndex: number;
}): Promise<void> {
  const {
    shop,
    local,
    account,
    planKey,
    creditsPerPeriod,
    billingPeriodEnd,
    creditCycleIndex,
  } = params;
  const db = getTsfDb();
  const now = new Date().toISOString();
  const window = getAnnualCreditWindow(billingPeriodEnd, creditCycleIndex);
  const prevWindow = getAnnualCreditWindow(
    billingPeriodEnd,
    Math.max(0, creditCycleIndex - 1),
  );

  if (creditCycleIndex > 0) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO AccountPeriodUsage (
              id, shop, appSubscriptionId, planKey, periodStart, periodEnd,
              usedCredits, subscriptionCreditsAllocated,
              purchasedCreditsRemaining, trialCreditsRemaining, archivedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        randomUUID(),
        shop,
        local.shopifySubscriptionId,
        local.planKey,
        toSqlDate(prevWindow.start),
        toSqlDate(prevWindow.end),
        account.usedCredits,
        local.creditsPerPeriod,
        account.purchasedCredits,
        account.trialCredits,
        now,
      ],
    });
  }

  await db.execute({
    sql: `INSERT INTO BillingLog (
            id, shop, eventType, planKey, referenceId, creditsDelta, usedCredits, metadata, createdAt
          ) VALUES (?, ?, 'SUBSCRIPTION_RENEWED', ?, ?, ?, ?, ?, ?)`,
    args: [
      randomUUID(),
      shop,
      planKey,
      local.shopifySubscriptionId,
      creditsPerPeriod,
      account.usedCredits,
      JSON.stringify({
        grantKind: "annual_credit_cycle",
        creditCycleIndex,
        billingPeriodEnd: billingPeriodEnd.toISOString(),
        previousPeriodEnd: billingPeriodEnd.toISOString(),
        nextPeriodEnd: billingPeriodEnd.toISOString(),
        creditWindowStart: window.start.toISOString(),
        creditWindowEnd: window.end.toISOString(),
        source: "worker_reconcile",
      }),
      now,
    ],
  });

  const settled = canSettleAtRenewal(account)
    ? settlePoolsAtRenewal(account)
    : {
        subscriptionCredits: account.subscriptionCredits,
        purchasedCredits: account.purchasedCredits,
        trialCredits: account.trialCredits,
      };

  await db.execute({
    sql: `UPDATE Account SET
            usedCredits = 0,
            subscriptionCredits = ?,
            purchasedCredits = ?,
            trialCredits = ?,
            updatedAt = ?
          WHERE shop = ?`,
    args: [
      creditsPerPeriod,
      settled.purchasedCredits,
      settled.trialCredits,
      now,
      shop,
    ],
  });
}

async function loadGrantLogsForSubscription(
  shop: string,
  shopifySubscriptionId: string,
): Promise<Array<{ eventType: string; metadata: unknown }>> {
  const rs = await getTsfDb().execute({
    sql: `SELECT eventType, metadata FROM BillingLog
          WHERE shop = ?
            AND referenceId = ?
            AND eventType IN ('SUBSCRIPTION_ACTIVATED','SUBSCRIPTION_RENEWED')
          ORDER BY createdAt ASC`,
    args: [shop, shopifySubscriptionId],
  });
  return rs.rows.map((row) => ({
    eventType: String(row.eventType),
    metadata: row.metadata,
  }));
}

/**
 * 迁移/空洞场景写入 baseline（creditsDelta=0），
 * 标记「当前窗口及以前默认已在旧服务发放」，以便下一窗口能正常触发。
 * 若该 creditCycleIndex 已有记录则不再写入。
 */
async function ensureAnnualMigrationBaseline(params: {
  shop: string;
  shopifySubscriptionId: string;
  planKey: string;
  billingPeriodEnd: Date;
  creditCycleIndex: number;
  existingGrantLogs: Array<{ eventType: string; metadata: unknown }>;
}): Promise<void> {
  const {
    shop,
    shopifySubscriptionId,
    planKey,
    billingPeriodEnd,
    creditCycleIndex,
    existingGrantLogs,
  } = params;
  const already = collectGrantedAnnualCreditCycleIndexes(
    existingGrantLogs,
    billingPeriodEnd,
  );
  if (already.includes(creditCycleIndex)) return;

  const window = getAnnualCreditWindow(billingPeriodEnd, creditCycleIndex);
  const now = new Date().toISOString();
  await getTsfDb().execute({
    sql: `INSERT INTO BillingLog (
            id, shop, eventType, planKey, referenceId, creditsDelta, usedCredits, metadata, createdAt
          ) VALUES (?, ?, 'SUBSCRIPTION_RENEWED', ?, ?, ?, ?, ?, ?)`,
    args: [
      randomUUID(),
      shop,
      planKey,
      shopifySubscriptionId,
      0,
      null,
      JSON.stringify({
        grantKind: "migration_assumed",
        creditCycleIndex,
        billingPeriodEnd: billingPeriodEnd.toISOString(),
        creditWindowStart: window.start.toISOString(),
        creditWindowEnd: window.end.toISOString(),
        source: "worker_reconcile",
        note: "Assume prior annual credit grants already issued elsewhere; no catch-up",
      }),
      now,
    ],
  });
}

function resultWithSnapshot(
  base: ReconcileShopResult,
  local?: LocalSubscription | null,
  shopifySub?: ShopifySubscriptionSnapshot | null,
): ReconcileShopResult {
  return {
    ...base,
    localStatus: local?.status ?? null,
    shopifyStatus: shopifySub?.status ?? null,
    localPeriodEnd: local?.currentPeriodEnd?.toISOString() ?? null,
    shopifyPeriodEnd: shopifySub?.currentPeriodEnd?.toISOString() ?? null,
    localPlanKey: local?.planKey ?? null,
    shopifyPlanName: shopifySub?.name ?? null,
  };
}

async function reconcileOneShop(
  shop: string,
  localInput: LocalSubscription,
  dryRun = false,
): Promise<ReconcileShopResult> {
  let local = localInput;
  const accessToken = await getOfflineAccessTokenFromTsf(shop);
  if (!accessToken) {
    return resultWithSnapshot(
      { shop, action: "skipped", reason: "no_offline_token" },
      local,
      null,
    );
  }

  const shopifySub = await fetchShopifySubscription(
    shop,
    accessToken,
    local.shopifySubscriptionId,
  );
  if (!shopifySub) {
    return resultWithSnapshot(
      { shop, action: "error", reason: "shopify_fetch_failed" },
      local,
      null,
    );
  }

  if (shopifySub.status === "CANCELLED" || shopifySub.status === "EXPIRED") {
    if (!dryRun) {
      await cancelLocalSubscription(shop, local, shopifySub.status);
    }
    return resultWithSnapshot({ shop, action: "cancelled" }, local, shopifySub);
  }

  if (shopifySub.status !== "ACTIVE") {
    return resultWithSnapshot(
      {
        shop,
        action: "skipped",
        reason: `shopify_status_${shopifySub.status}`,
      },
      local,
      shopifySub,
    );
  }

  const billingInterval = mapInterval(shopifySub.intervalRaw) || local.billingInterval;
  const plan =
    (await findPlanCredits(shopifySub.name, billingInterval)) ?? {
      planKey: local.planKey,
      credits: local.creditsPerPeriod,
    };

  // currentPeriodEnd = Shopify 下次扣款时间（月付/年付统一）；禁止用 createdAt 推算账期。
  const currentPeriodEnd =
    shopifySub.currentPeriodEnd ??
    local.currentPeriodEnd ??
    new Date(Date.now() + (INTERVAL_DAYS[billingInterval] ?? 30) * DAY_MS);
  const currentPeriodStart = new Date(
    currentPeriodEnd.getTime() - (INTERVAL_DAYS[billingInterval] ?? 30) * DAY_MS,
  );

  const sameSubscription = shopifySub.id === local.shopifySubscriptionId;
  const periodEndAdvanced = sameSubscription && isRenewal(local, currentPeriodEnd);
  const periodFieldsMismatch =
    !sameSubscription ||
    billingInterval !== local.billingInterval ||
    datesDiffer(local.currentPeriodEnd, currentPeriodEnd) ||
    datesDiffer(local.currentPeriodStart, currentPeriodStart);

  if (periodEndAdvanced) {
    const accRs = await getTsfDb().execute({
      sql: `SELECT subscriptionCredits, purchasedCredits, trialCredits, usedCredits
            FROM Account WHERE shop = ? LIMIT 1`,
      args: [shop],
    });
    const acc = accRs.rows[0];
    if (!acc) {
      return resultWithSnapshot(
        { shop, action: "error", reason: "no_account" },
        local,
        shopifySub,
      );
    }
    if (!dryRun) {
      await archivePeriodAndRenew({
        shop,
        local,
        account: {
          subscriptionCredits: Number(acc.subscriptionCredits ?? 0),
          purchasedCredits: Number(acc.purchasedCredits ?? 0),
          trialCredits: Number(acc.trialCredits ?? 0),
          usedCredits: Number(acc.usedCredits ?? 0),
        },
        next: {
          planKey: plan.planKey,
          creditsPerPeriod: plan.credits,
          currentPeriodStart,
          currentPeriodEnd,
        },
      });
    }
    return resultWithSnapshot(
      { shop, action: "renewed", reason: "shopify_period_advanced" },
      local,
      shopifySub,
    );
  }

  if (!sameSubscription) {
    if (!dryRun) {
      await activateOrReplaceSubscription({
        shop,
        shopifySub,
        planKey: plan.planKey,
        billingInterval,
        creditsPerPeriod: plan.credits,
        currentPeriodStart,
        currentPeriodEnd,
      });
    }
    return resultWithSnapshot({ shop, action: "activated" }, local, shopifySub);
  }

  if (periodFieldsMismatch) {
    if (!dryRun) {
      await syncLocalPeriodFields({
        shop,
        shopifySubscriptionId: shopifySub.id,
        billingInterval,
        planKey: plan.planKey,
        creditsPerPeriod: plan.credits,
        currentPeriodStart,
        currentPeriodEnd,
      });
    }
    local = {
      ...local,
      shopifySubscriptionId: shopifySub.id,
      billingInterval,
      planKey: plan.planKey,
      creditsPerPeriod: plan.credits,
      currentPeriodStart,
      currentPeriodEnd,
    };
  }

  if (billingInterval === "ANNUAL") {
    const grantLogs = await loadGrantLogsForSubscription(
      shop,
      local.shopifySubscriptionId,
    );
    const grantedCycleIndexes = collectGrantedAnnualCreditCycleIndexes(
      grantLogs,
      currentPeriodEnd,
    );
    const decision = decideAnnualCreditGrant({
      currentPeriodEnd,
      grantedCycleIndexes,
    });

    if (decision.action === "grant") {
      const accRs = await getTsfDb().execute({
        sql: `SELECT subscriptionCredits, purchasedCredits, trialCredits, usedCredits
              FROM Account WHERE shop = ? LIMIT 1`,
        args: [shop],
      });
      const acc = accRs.rows[0];
      if (!acc) {
        return resultWithSnapshot(
          { shop, action: "error", reason: "no_account" },
          local,
          shopifySub,
        );
      }
      if (!dryRun) {
        await grantAnnualCreditCycle({
          shop,
          local,
          account: {
            subscriptionCredits: Number(acc.subscriptionCredits ?? 0),
            purchasedCredits: Number(acc.purchasedCredits ?? 0),
            trialCredits: Number(acc.trialCredits ?? 0),
            usedCredits: Number(acc.usedCredits ?? 0),
          },
          planKey: plan.planKey,
          creditsPerPeriod: plan.credits,
          billingPeriodEnd: currentPeriodEnd,
          creditCycleIndex: decision.creditCycleIndex,
        });
      }
      return resultWithSnapshot(
        {
          shop,
          action: "renewed",
          reason: `annual_credit_cycle_${decision.creditCycleIndex}`,
        },
        local,
        shopifySub,
      );
    }

    // 迁移/空洞：写 baseline 标记当前窗已默认发放，下一窗才能按水位+1 触发。
    if (decision.reason === "migration_assumed_granted" && !dryRun) {
      await ensureAnnualMigrationBaseline({
        shop,
        shopifySubscriptionId: local.shopifySubscriptionId,
        planKey: plan.planKey,
        billingPeriodEnd: currentPeriodEnd,
        creditCycleIndex: decision.currentCycleIndex,
        existingGrantLogs: grantLogs,
      });
    }

    return resultWithSnapshot(
      {
        shop,
        action: "skipped",
        reason: decision.reason,
      },
      local,
      shopifySub,
    );
  }

  if (periodFieldsMismatch) {
    return resultWithSnapshot(
      { shop, action: "skipped", reason: "period_fields_synced" },
      local,
      shopifySub,
    );
  }

  return resultWithSnapshot(
    { shop, action: "skipped", reason: "already_synced" },
    local,
    shopifySub,
  );
}

async function reconcileShopWithoutLocal(
  shop: string,
  dryRun = false,
): Promise<ReconcileShopResult> {
  const accessToken = await getOfflineAccessTokenFromTsf(shop);
  if (!accessToken) {
    return resultWithSnapshot(
      { shop, action: "skipped", reason: "no_offline_token" },
      null,
      null,
    );
  }

  const shopifySub = await fetchShopifyActiveSubscription(shop, accessToken);
  if (!shopifySub) {
    return resultWithSnapshot(
      { shop, action: "skipped", reason: "no_active_subscription" },
      null,
      null,
    );
  }

  if (shopifySub.status !== "ACTIVE") {
    return resultWithSnapshot(
      {
        shop,
        action: "skipped",
        reason: `shopify_status_${shopifySub.status}`,
      },
      null,
      shopifySub,
    );
  }

  const billingInterval = mapInterval(shopifySub.intervalRaw);
  const plan = await findPlanCredits(shopifySub.name, billingInterval);
  if (!plan) {
    return resultWithSnapshot(
      {
        shop,
        action: "error",
        reason: `unknown_plan_${shopifySub.name}_${billingInterval}`,
      },
      null,
      shopifySub,
    );
  }

  const currentPeriodEnd =
    shopifySub.currentPeriodEnd ??
    new Date(Date.now() + (INTERVAL_DAYS[billingInterval] ?? 30) * DAY_MS);
  const currentPeriodStart = new Date(
    currentPeriodEnd.getTime() - (INTERVAL_DAYS[billingInterval] ?? 30) * DAY_MS,
  );

  if (!dryRun) {
    await activateOrReplaceSubscription({
      shop,
      shopifySub,
      planKey: plan.planKey,
      billingInterval,
      creditsPerPeriod: plan.credits,
      currentPeriodStart,
      currentPeriodEnd,
    });
  }

  return resultWithSnapshot({ shop, action: "activated" }, null, shopifySub);
}

function applySummaryCount(
  summary: Omit<BillingReconcileSummary, "details" | "dryRun">,
  result: ReconcileShopResult,
): void {
  switch (result.action) {
    case "renewed":
      summary.renewed++;
      break;
    case "activated":
      summary.activated++;
      break;
    case "cancelled":
      summary.cancelled++;
      break;
    case "skipped":
      summary.skipped++;
      break;
    case "error":
      summary.errors++;
      break;
    default: {
      const _exhaustive: never = result.action;
      void _exhaustive;
    }
  }
}

async function listLocalSubscriptions(params: {
  shopFilter?: string;
  dueBefore?: Date;
} = {}): Promise<LocalSubscription[]> {
  const db = getTsfDb();
  const where: string[] = [];
  const args: string[] = [];

  if (params.shopFilter) {
    where.push("lower(s.shop) = lower(?)");
    args.push(params.shopFilter);
  }
  if (params.dueBefore) {
    // 月付：Shopify currentPeriodEnd 到期；年付：始终纳入（额度窗由 periodEnd 推导，不写回 periodEnd）
    where.push("s.status = 'ACTIVE'");
    where.push(
      `(s.billingInterval = 'ANNUAL' OR (s.currentPeriodEnd IS NOT NULL AND s.currentPeriodEnd <= ?))`,
    );
    args.push(params.dueBefore.toISOString());
  }

  const rs = await db.execute({
    sql: `SELECT s.shop, s.planKey, s.shopifySubscriptionId, s.billingInterval, s.status,
                 s.creditsPerPeriod, s.currentPeriodStart, s.currentPeriodEnd
          FROM AppSubscription s
          JOIN Account a ON a.shop = s.shop AND a.deletedAt IS NULL
          ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
          ORDER BY s.shop ASC`,
    args,
  });
  return rs.rows.map((row) => ({
    shop: String(row.shop),
    planKey: String(row.planKey),
    shopifySubscriptionId: String(row.shopifySubscriptionId),
    billingInterval: String(row.billingInterval),
    status: String(row.status),
    creditsPerPeriod: Number(row.creditsPerPeriod) || 0,
    currentPeriodStart: parseDate(row.currentPeriodStart),
    currentPeriodEnd: parseDate(row.currentPeriodEnd),
  }));
}

async function listOrphanSessionShops(shopFilter?: string): Promise<string[]> {
  const db = getTsfDb();
  const sql = shopFilter
    ? `SELECT DISTINCT sess.shop AS shop
       FROM Session sess
       LEFT JOIN Account a ON a.shop = sess.shop
       WHERE sess.isOnline = 0
         AND sess.accessToken IS NOT NULL
         AND (a.shop IS NULL OR a.deletedAt IS NULL)
         AND lower(sess.shop) = lower(?)
         AND NOT EXISTS (
           SELECT 1 FROM AppSubscription s
           WHERE s.shop = sess.shop AND s.status = 'ACTIVE'
         )
       ORDER BY sess.shop ASC`
    : `SELECT DISTINCT sess.shop AS shop
       FROM Session sess
       LEFT JOIN Account a ON a.shop = sess.shop
       WHERE sess.isOnline = 0
         AND sess.accessToken IS NOT NULL
         AND (a.shop IS NULL OR a.deletedAt IS NULL)
         AND NOT EXISTS (
           SELECT 1 FROM AppSubscription s
           WHERE s.shop = sess.shop AND s.status = 'ACTIVE'
         )
       ORDER BY sess.shop ASC`;
  const rs = await db.execute({
    sql,
    args: shopFilter ? [shopFilter] : [],
  });
  return rs.rows.map((row) => String(row.shop));
}

export async function runBillingSubscriptionReconcileWithOptions(
  options: BillingReconcileOptions = {},
): Promise<BillingReconcileSummary> {
  const dryRun = options.dryRun ?? false;
  const scanOrphans = options.scanOrphans ?? false;
  const shopFilter = options.shop?.trim() || undefined;
  const dueBefore = options.dueBefore;

  if (!hasTsfDbCredentials()) {
    throw new Error("TSF Turso is not configured");
  }

  const summary: BillingReconcileSummary = {
    scanned: 0,
    renewed: 0,
    activated: 0,
    cancelled: 0,
    skipped: 0,
    errors: 0,
    dryRun,
    details: [],
  };

  const locals = await listLocalSubscriptions({ shopFilter, dueBefore });
  const orphanShops = scanOrphans
    ? await listOrphanSessionShops(shopFilter)
    : [];
  const orphanSet = new Set(orphanShops);
  summary.scanned = locals.length + orphanShops.length;

  for (const local of locals) {
    let result: ReconcileShopResult;
    try {
      result = await reconcileOneShop(local.shop, local, dryRun);
    } catch (err) {
      result = {
        shop: local.shop,
        action: "error",
        reason: err instanceof Error ? err.message : String(err),
        localStatus: local.status,
        localPeriodEnd: local.currentPeriodEnd?.toISOString() ?? null,
        localPlanKey: local.planKey,
      };
    }
    applySummaryCount(summary, result);
    summary.details.push(result);
    orphanSet.delete(local.shop);
  }

  for (const shop of orphanSet) {
    let result: ReconcileShopResult;
    try {
      result = await reconcileShopWithoutLocal(shop, dryRun);
    } catch (err) {
      result = {
        shop,
        action: "error",
        reason: err instanceof Error ? err.message : String(err),
      };
    }
    applySummaryCount(summary, result);
    summary.details.push(result);
  }

  return summary;
}

function parseBillingLogMetadata(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * 对最新 SUBSCRIPTION_RENEWED 日志做发信占位（幂等）。
 * 成功 claim 后才发信，避免 nearDue / 全量 / webhook 并发重复发。
 */
async function claimRenewalEmailSlot(
  logId: string,
  meta: Record<string, unknown>,
  source: string,
): Promise<boolean> {
  if (meta.renewalEmailSent === true) return false;
  const nextMeta = {
    ...meta,
    renewalEmailSent: true,
    renewalEmailClaimedAt: new Date().toISOString(),
    renewalEmailSource: source,
  };
  const upd = await getTsfDb().execute({
    sql: `UPDATE BillingLog
          SET metadata = ?
          WHERE id = ?
            AND (
              json_extract(metadata, '$.renewalEmailSent') IS NULL
              OR json_extract(metadata, '$.renewalEmailSent') = 0
            )`,
    args: [JSON.stringify(nextMeta), logId],
  });
  return Number(upd.rowsAffected ?? 0) > 0;
}

async function releaseRenewalEmailClaim(logId: string): Promise<void> {
  const db = getTsfDb();
  const rs = await db.execute({
    sql: `SELECT metadata FROM BillingLog WHERE id = ? LIMIT 1`,
    args: [logId],
  });
  const meta = parseBillingLogMetadata(rs.rows[0]?.metadata);
  if (meta.renewalEmailSent !== true) return;
  const rest = { ...meta };
  delete rest.renewalEmailSent;
  delete rest.renewalEmailClaimedAt;
  delete rest.renewalEmailSource;
  await db.execute({
    sql: `UPDATE BillingLog SET metadata = ? WHERE id = ?`,
    args: [JSON.stringify(rest), logId],
  });
}

/** Shopify 年/月账期推进才发续费邮件；年付 30 天额度窗发放不发。 */
function shouldSendReconcileRenewalEmail(result: ReconcileShopResult): boolean {
  if (result.action !== "renewed") return false;
  const reason = result.reason ?? "";
  if (reason.startsWith("annual_credit_cycle_")) return false;
  return true;
}

async function sendRenewalEmailForShop(
  shop: string,
  logTag = "[billingReconcile]",
): Promise<void> {
  const db = getTsfDb();
  const logRs = await db.execute({
    sql: `SELECT id, metadata FROM BillingLog
          WHERE shop = ? AND eventType = 'SUBSCRIPTION_RENEWED'
          ORDER BY createdAt DESC
          LIMIT 1`,
    args: [shop],
  });
  const logRow = logRs.rows[0];
  if (!logRow?.id) {
    console.log(`${logTag} renewal email skip shop=${shop} reason=no_renewal_log`);
    return;
  }
  const logId = String(logRow.id);
  const meta = parseBillingLogMetadata(logRow.metadata);
  if (meta.renewalEmailSent === true) {
    console.log(`${logTag} renewal email skip shop=${shop} reason=already_sent`);
    return;
  }

  const [subRow, contact, remaining] = await Promise.all([
    db.execute({
      sql: "SELECT creditsPerPeriod FROM AppSubscription WHERE shop = ? AND status = 'ACTIVE' LIMIT 1",
      args: [shop],
    }),
    fetchShopContact(shop).catch(() => null),
    getTsfAccountRemaining(shop),
  ]);

  const addedCredits = Number(subRow.rows[0]?.creditsPerPeriod ?? 0);
  if (addedCredits <= 0) {
    console.log(`${logTag} renewal email skip shop=${shop} reason=no_credits`);
    return;
  }
  if (!contact?.email) {
    console.log(`${logTag} renewal email skip shop=${shop} reason=no_contact_email`);
    return;
  }

  const source = logTag.includes("nearDue") ? "worker_near_due" : "worker_reconcile";
  const claimed = await claimRenewalEmailSlot(logId, meta, source);
  if (!claimed) {
    console.log(`${logTag} renewal email skip shop=${shop} reason=already_claimed`);
    return;
  }

  const ok = await sendSubscriptionRenewalEmail({
    to: contact.email,
    userName: contact.firstName || contact.email.split("@")[0] || shop,
    shopName: shop.split(".")[0],
    addedCredits,
    totalCredits: remaining ?? addedCredits,
  });

  if (!ok) {
    await releaseRenewalEmailClaim(logId).catch((err) =>
      console.warn(`${logTag} renewal email claim release failed shop=${shop}`, err),
    );
    console.warn(`${logTag} renewal email send returned false shop=${shop}`);
    return;
  }

  console.log(`${logTag} renewal email sent shop=${shop} credits=${addedCredits}`);
}

export async function runBillingSubscriptionReconcile(): Promise<void> {
  if (running) {
    console.warn("[billingReconcile] skip: already running");
    return;
  }
  if (!hasTsfDbCredentials()) {
    console.warn("[billingReconcile] skip: TSF Turso not configured");
    return;
  }

  running = true;
  const started = Date.now();
  try {
    const summary = await runBillingSubscriptionReconcileWithOptions({
      dryRun: false,
      scanOrphans: true,
    });

    for (const result of summary.details) {
      if (result.action === "renewed") {
        console.log(
          `[billingReconcile] renewed ${result.shop}${result.reason ? ` (${result.reason})` : ""}`,
        );
        if (shouldSendReconcileRenewalEmail(result)) {
          // 续费成功 → 异步发邮件（非阻断）；BillingLog.metadata.renewalEmailSent 幂等防重
          void sendRenewalEmailForShop(result.shop).catch((err) =>
            console.warn(
              `[billingReconcile] renewal email failed shop=${result.shop}`,
              err,
            ),
          );
        }
      } else if (result.action === "activated") {
        console.log(`[billingReconcile] activated ${result.shop}`);
      } else if (result.action === "cancelled") {
        console.log(`[billingReconcile] cancelled ${result.shop}`);
      } else if (result.action === "error") {
        console.warn(
          `[billingReconcile] error ${result.shop}: ${result.reason ?? ""}`,
        );
      }
    }

    console.log(
      `[billingReconcile] done scanned=${summary.scanned} renewed=${summary.renewed} activated=${summary.activated} cancelled=${summary.cancelled} skipped=${summary.skipped} errors=${summary.errors} (${Date.now() - started}ms)`,
    );
  } catch (err) {
    console.error("[billingReconcile] failed:", err);
  } finally {
    running = false;
  }
}

export async function runBillingSubscriptionNearDueReconcile(): Promise<void> {
  if (running) {
    console.warn("[billingReconcile:nearDue] skip: reconcile already running");
    return;
  }
  if (!hasTsfDbCredentials()) {
    console.warn("[billingReconcile:nearDue] skip: TSF Turso not configured");
    return;
  }

  const lookaheadMs = Math.max(
    0,
    Number(process.env.BILLING_SUBSCRIPTION_NEAR_DUE_LOOKAHEAD_MS) ||
      60 * 60_000,
  );
  const dueBefore = new Date(Date.now() + lookaheadMs);

  running = true;
  const started = Date.now();
  try {
    const summary = await runBillingSubscriptionReconcileWithOptions({
      dryRun: false,
      scanOrphans: false,
      dueBefore,
    });

    for (const result of summary.details) {
      if (result.action === "renewed") {
        console.log(
          `[billingReconcile:nearDue] renewed ${result.shop}${result.reason ? ` (${result.reason})` : ""}`,
        );
        if (shouldSendReconcileRenewalEmail(result)) {
          // 续费成功 → 异步发邮件（非阻断）；BillingLog.metadata.renewalEmailSent 幂等防重
          void sendRenewalEmailForShop(
            result.shop,
            "[billingReconcile:nearDue]",
          ).catch((err) =>
            console.warn(
              `[billingReconcile:nearDue] renewal email failed shop=${result.shop}`,
              err,
            ),
          );
        }
      } else if (result.action === "activated") {
        console.log(`[billingReconcile:nearDue] activated ${result.shop}`);
      } else if (result.action === "cancelled") {
        console.log(`[billingReconcile:nearDue] cancelled ${result.shop}`);
      } else if (result.action === "error") {
        console.warn(
          `[billingReconcile:nearDue] error ${result.shop}: ${result.reason ?? ""}`,
        );
      }
    }

    console.log(
      `[billingReconcile:nearDue] done dueBefore=${dueBefore.toISOString()} scanned=${summary.scanned} renewed=${summary.renewed} activated=${summary.activated} cancelled=${summary.cancelled} skipped=${summary.skipped} errors=${summary.errors} (${Date.now() - started}ms)`,
    );
  } catch (err) {
    console.error("[billingReconcile:nearDue] failed:", err);
  } finally {
    running = false;
  }
}
