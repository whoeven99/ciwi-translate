/**
 * 年付额度周期纯函数：只从 Shopify/本地 currentPeriodEnd 对齐，禁止用 createdAt。
 *
 * App 与 Worker 的**唯一来源**（曾经是两份 286 行副本靠注释维持一致）。纯函数、零依赖，
 * 账本读写留在各自的 IO 层（App `billing/subscription/*`、Worker `billingSubscriptionReconcile`）。
 *
 * 发放策略（禁止历史追补）：
 * - 看当前时间落在哪个 30 天窗口（creditCycleIndex）
 * - 仅当该窗恰好是 TSF 水位的下一窗（maxGranted+1）时发放一次
 * - 无 TSF 周期记录或水位空洞过大 → 默认旧服务已发到当前窗；调用方写 migration_assumed baseline
 */

export const DAY_MS = 24 * 60 * 60 * 1000;
export const CREDIT_CYCLE_DAYS = 30;
export const ANNUAL_BILLING_DAYS = 365;
export const CREDIT_CYCLE_MS = CREDIT_CYCLE_DAYS * DAY_MS;
export const ANNUAL_BILLING_MS = ANNUAL_BILLING_DAYS * DAY_MS;
export const MAX_ANNUAL_CREDIT_GRANTS = 12;

export type AnnualYearWindow = {
  yearStart: Date;
  yearEnd: Date;
};

export type BillingGrantLogLike = {
  eventType: string;
  metadata?: unknown;
};

export function getAnnualYearWindow(currentPeriodEnd: Date): AnnualYearWindow {
  return {
    yearEnd: currentPeriodEnd,
    yearStart: new Date(currentPeriodEnd.getTime() - ANNUAL_BILLING_MS),
  };
}

export function getAnnualCreditCycleIndex(
  now: Date | number,
  currentPeriodEnd: Date,
): number {
  const { yearStart, yearEnd } = getAnnualYearWindow(currentPeriodEnd);
  const ts = typeof now === "number" ? now : now.getTime();
  const clamped = Math.min(Math.max(ts, yearStart.getTime()), yearEnd.getTime() - 1);
  const elapsed = Math.max(0, clamped - yearStart.getTime());
  return Math.min(
    MAX_ANNUAL_CREDIT_GRANTS - 1,
    Math.floor(elapsed / CREDIT_CYCLE_MS),
  );
}

export function getAnnualCreditWindow(
  currentPeriodEnd: Date,
  cycleIndex: number,
): { start: Date; end: Date } {
  const { yearStart } = getAnnualYearWindow(currentPeriodEnd);
  const idx = Math.max(
    0,
    Math.min(MAX_ANNUAL_CREDIT_GRANTS - 1, Math.floor(cycleIndex)),
  );
  return {
    start: new Date(yearStart.getTime() + idx * CREDIT_CYCLE_MS),
    end: new Date(yearStart.getTime() + (idx + 1) * CREDIT_CYCLE_MS),
  };
}

function parseMetadata(raw: unknown): Record<string, unknown> {
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

function samePeriodEndIso(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) {
    return a === b;
  }
  return Math.abs(da.getTime() - db.getTime()) < 2000;
}

function clampCycleIndex(raw: number): number {
  return Math.max(0, Math.min(MAX_ANNUAL_CREDIT_GRANTS - 1, Math.floor(raw)));
}

function readCreditCycleIndex(meta: Record<string, unknown>): number | null {
  const raw = meta.creditCycleIndex;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return clampCycleIndex(raw);
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) return clampCycleIndex(n);
  }
  return null;
}

/**
 * 收集本 Shopify 年账期内已由 TSF 记录的额度窗口索引。
 * - 需 metadata.billingPeriodEnd 对齐 currentPeriodEnd
 * - 有 creditCycleIndex 则记该索引；ACTIVATED 无索引时视为 cycle 0（首次 Shopify 账期发放）
 * - 无 billingPeriodEnd 的 legacy 迁移 ACTIVATED 不计入（由 decide 默认「已发放」）
 */
export function collectGrantedAnnualCreditCycleIndexes(
  logs: BillingGrantLogLike[],
  currentPeriodEnd: Date,
): number[] {
  const periodEndIso = currentPeriodEnd.toISOString();
  const indexes = new Set<number>();

  for (const log of logs) {
    const eventType = String(log.eventType || "");
    if (
      eventType !== "SUBSCRIPTION_ACTIVATED" &&
      eventType !== "SUBSCRIPTION_RENEWED"
    ) {
      continue;
    }
    const meta = parseMetadata(log.metadata);
    const billingPeriodEnd = meta.billingPeriodEnd;
    if (typeof billingPeriodEnd !== "string" || !billingPeriodEnd) {
      continue;
    }
    if (!samePeriodEndIso(billingPeriodEnd, periodEndIso)) {
      continue;
    }

    const idx = readCreditCycleIndex(meta);
    if (idx != null) {
      indexes.add(idx);
      continue;
    }
    if (eventType === "SUBSCRIPTION_ACTIVATED") {
      indexes.add(0);
    }
  }

  return [...indexes].sort((a, b) => a - b);
}

/** @deprecated 使用 collectGrantedAnnualCreditCycleIndexes；保留导出以免外部调用方断裂。 */
export function countGrantsForBillingPeriod(
  logs: BillingGrantLogLike[],
  currentPeriodEnd: Date,
): number {
  return collectGrantedAnnualCreditCycleIndexes(logs, currentPeriodEnd).length;
}

export function getExpectedAnnualGrants(
  now: Date | number,
  currentPeriodEnd: Date,
): number {
  const ts = typeof now === "number" ? now : now.getTime();
  if (ts >= currentPeriodEnd.getTime()) {
    return MAX_ANNUAL_CREDIT_GRANTS;
  }
  return Math.min(
    MAX_ANNUAL_CREDIT_GRANTS,
    getAnnualCreditCycleIndex(ts, currentPeriodEnd) + 1,
  );
}

/** 下次额度发放时刻；已覆盖窗口的下一窗起点。 */
export function getNextAnnualCreditGrantAt(
  currentPeriodEnd: Date,
  grantedCycleIndexes: number[],
): Date | null {
  const indexes = [
    ...new Set(
      grantedCycleIndexes
        .filter((i) => typeof i === "number" && Number.isFinite(i))
        .map((i) => clampCycleIndex(i)),
    ),
  ];
  const nextIndex = indexes.length === 0 ? 0 : Math.max(...indexes) + 1;
  if (nextIndex >= MAX_ANNUAL_CREDIT_GRANTS) return null;
  const { yearStart, yearEnd } = getAnnualYearWindow(currentPeriodEnd);
  const next = new Date(yearStart.getTime() + nextIndex * CREDIT_CYCLE_MS);
  if (next.getTime() >= yearEnd.getTime()) return null;
  return next;
}

export type AnnualCreditGrantDecision =
  | {
      action: "grant";
      creditCycleIndex: number;
      grantedCount: number;
      currentCycleIndex: number;
      expectedGrants: number;
    }
  | {
      action: "skip";
      reason:
        | "annual_grants_exhausted"
        | "not_due_yet"
        | "migration_assumed_granted";
      grantedCount: number;
      expectedGrants: number;
      currentCycleIndex: number;
    };

/**
 * 是否发放年付额度：
 * - 只发「已有 TSF 水位的下一窗」（maxGranted+1 === 当前窗）
 * - 无历史或与水位空洞过大 → 默认旧服务已发到当前窗（不追补）
 */
export function decideAnnualCreditGrant(params: {
  now?: Date | number;
  currentPeriodEnd: Date;
  grantedCycleIndexes: number[];
}): AnnualCreditGrantDecision {
  const now = params.now ?? Date.now();
  const ts = typeof now === "number" ? now : now.getTime();
  const currentCycleIndex = getAnnualCreditCycleIndex(ts, params.currentPeriodEnd);
  const expectedGrants = getExpectedAnnualGrants(ts, params.currentPeriodEnd);
  const grantedCycleIndexes = [
    ...new Set(
      params.grantedCycleIndexes
        .filter((i) => typeof i === "number" && Number.isFinite(i))
        .map((i) => clampCycleIndex(i)),
    ),
  ].sort((a, b) => a - b);
  const grantedCount = grantedCycleIndexes.length;

  if (grantedCycleIndexes.includes(currentCycleIndex)) {
    const exhausted =
      grantedCount >= MAX_ANNUAL_CREDIT_GRANTS ||
      (currentCycleIndex >= MAX_ANNUAL_CREDIT_GRANTS - 1 &&
        grantedCycleIndexes.includes(MAX_ANNUAL_CREDIT_GRANTS - 1));
    return {
      action: "skip",
      reason: exhausted ? "annual_grants_exhausted" : "not_due_yet",
      grantedCount,
      expectedGrants,
      currentCycleIndex,
    };
  }

  // 无 TSF 周期记录，或水位落后超过 1 窗：默认旧服务已发到当前窗，不追补。
  if (grantedCycleIndexes.length === 0) {
    return {
      action: "skip",
      reason: "migration_assumed_granted",
      grantedCount: 0,
      expectedGrants,
      currentCycleIndex,
    };
  }

  const maxGranted = Math.max(...grantedCycleIndexes);
  if (currentCycleIndex > maxGranted + 1) {
    return {
      action: "skip",
      reason: "migration_assumed_granted",
      grantedCount,
      expectedGrants,
      currentCycleIndex,
    };
  }

  // 恰好进入下一窗：只发当前窗一次。
  if (currentCycleIndex === maxGranted + 1) {
    return {
      action: "grant",
      creditCycleIndex: currentCycleIndex,
      grantedCount,
      currentCycleIndex,
      expectedGrants,
    };
  }

  return {
    action: "skip",
    reason: "not_due_yet",
    grantedCount,
    expectedGrants,
    currentCycleIndex,
  };
}
