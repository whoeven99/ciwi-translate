import prisma from "../../../db.server";
import { BILLING_LOG_EVENT } from "../types.server";
import type { CreditUsageSource } from "./recordCreditUsage.server";

/** 消耗（CreditUsage）或入账（BillingLog）。credits 始终为正数。 */
export type CreditLedgerDirection = "in" | "out";

export type CreditUsageListItem = {
  id: string;
  direction: CreditLedgerDirection;
  source: CreditUsageSource | string;
  credits: number;
  createdAt: string;
  metadata: unknown;
};

export type ListCreditUsageParams = {
  shop: string;
  /** 每页条数，默认 20，上限 50。 */
  take?: number;
  /** 游标：上一页末条 `u:{id}` / `b:{id}`；有则取更早的记录。 */
  cursor?: string | null;
};

export type ListCreditUsageResult = {
  items: CreditUsageListItem[];
  nextCursor: string | null;
};

const DEFAULT_TAKE = 20;
const MAX_TAKE = 50;

const MERCHANT_INCOME_EVENTS = [
  BILLING_LOG_EVENT.TOKEN_PACK_PURCHASED,
  BILLING_LOG_EVENT.SUBSCRIPTION_ACTIVATED,
  BILLING_LOG_EVENT.SUBSCRIPTION_RENEWED,
  BILLING_LOG_EVENT.TRIAL_GRANTED,
] as const;

type LedgerKind = "u" | "b";

type CursorAnchor = {
  createdAt: Date;
  id: string;
};

type RawLedgerRow = {
  kind: LedgerKind;
  id: string;
  source: string;
  credits: number;
  createdAt: Date;
  metadata: unknown;
};

function parseLedgerCursor(cursor: string | null): {
  kind: LedgerKind;
  id: string;
} | null {
  const raw = cursor?.trim() || "";
  if (raw.startsWith("u:") && raw.length > 2) {
    return { kind: "u", id: raw.slice(2) };
  }
  if (raw.startsWith("b:") && raw.length > 2) {
    return { kind: "b", id: raw.slice(2) };
  }
  return null;
}

function encodeLedgerId(kind: LedgerKind, id: string): string {
  return `${kind}:${id}`;
}

function olderThanWhere(anchor: CursorAnchor) {
  return {
    OR: [
      { createdAt: { lt: anchor.createdAt } },
      { createdAt: anchor.createdAt, id: { lt: anchor.id } },
    ],
  };
}

function asMetadataRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

function billingMetadata(
  metadata: unknown,
  planKey: string | null,
): Record<string, unknown> | null {
  const record = asMetadataRecord(metadata);
  if (planKey) record.planKey = planKey;
  return Object.keys(record).length > 0 ? record : null;
}

function compareLedgerDesc(a: RawLedgerRow, b: RawLedgerRow): number {
  const byTime = b.createdAt.getTime() - a.createdAt.getTime();
  if (byTime !== 0) return byTime;
  if (a.id === b.id) return a.kind < b.kind ? 1 : a.kind > b.kind ? -1 : 0;
  return a.id < b.id ? 1 : -1;
}

function toListItem(row: RawLedgerRow): CreditUsageListItem {
  return {
    id: encodeLedgerId(row.kind, row.id),
    direction: row.kind === "b" ? "in" : "out",
    source: row.source,
    credits: row.credits,
    createdAt: row.createdAt.toISOString(),
    metadata: row.metadata ?? null,
  };
}

async function resolveCursorAnchor(
  shop: string,
  cursor: string | null,
): Promise<CursorAnchor | null> {
  const parsed = parseLedgerCursor(cursor);
  if (!parsed) return null;
  if (parsed.kind === "u") {
    const row = await prisma.creditUsage.findFirst({
      where: { id: parsed.id, shop },
      select: { createdAt: true, id: true },
    });
    return row;
  }
  const row = await prisma.billingLog.findFirst({
    where: { id: parsed.id, shop },
    select: { createdAt: true, id: true },
  });
  return row;
}

async function fetchUsageRows(
  shop: string,
  take: number,
  anchor: CursorAnchor | null,
): Promise<RawLedgerRow[]> {
  const rows = await prisma.creditUsage.findMany({
    where: {
      shop,
      ...(anchor ? olderThanWhere(anchor) : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    select: {
      id: true,
      source: true,
      credits: true,
      createdAt: true,
      metadata: true,
    },
  });
  return rows.map((row) => ({
    kind: "u" as const,
    id: row.id,
    source: row.source,
    credits: row.credits,
    createdAt: row.createdAt,
    metadata: row.metadata ?? null,
  }));
}

async function fetchIncomeRows(
  shop: string,
  take: number,
  anchor: CursorAnchor | null,
): Promise<RawLedgerRow[]> {
  const rows = await prisma.billingLog.findMany({
    where: {
      shop,
      eventType: { in: [...MERCHANT_INCOME_EVENTS] },
      creditsDelta: { gt: 0 },
      ...(anchor ? olderThanWhere(anchor) : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    select: {
      id: true,
      eventType: true,
      creditsDelta: true,
      createdAt: true,
      metadata: true,
      planKey: true,
    },
  });
  return rows.flatMap((row) => {
    const credits = Math.max(0, Math.floor(row.creditsDelta ?? 0));
    if (credits <= 0) return [];
    return [
      {
        kind: "b" as const,
        id: row.id,
        source: row.eventType,
        credits,
        createdAt: row.createdAt,
        metadata: billingMetadata(row.metadata, row.planKey),
      },
    ];
  });
}

/**
 * 本店积分明细（消耗 + 商户可感知入账，新→旧）。
 * cursor 为上一页末条 `u:{id}` / `b:{id}`。
 */
export async function listCreditUsage(
  params: ListCreditUsageParams,
): Promise<ListCreditUsageResult> {
  const shop = params.shop.trim();
  const take = Math.min(
    MAX_TAKE,
    Math.max(1, Math.floor(params.take ?? DEFAULT_TAKE)),
  );
  const cursorRaw = params.cursor?.trim() || null;
  const parsedCursor = parseLedgerCursor(cursorRaw);
  if (cursorRaw && !parsedCursor) {
    return { items: [], nextCursor: null };
  }

  const anchor = await resolveCursorAnchor(shop, cursorRaw);
  if (cursorRaw && !anchor) {
    return { items: [], nextCursor: null };
  }

  const [usageRows, incomeRows] = await Promise.all([
    fetchUsageRows(shop, take + 1, anchor),
    fetchIncomeRows(shop, take + 1, anchor),
  ]);

  const merged = [...usageRows, ...incomeRows].sort(compareLedgerDesc);
  const hasMore = merged.length > take;
  const page = hasMore ? merged.slice(0, take) : merged;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last ? encodeLedgerId(last.kind, last.id) : null;

  return {
    items: page.map(toListItem),
    nextCursor,
  };
}
