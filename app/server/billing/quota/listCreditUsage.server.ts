import type { Prisma } from "../../../generated/prisma";
import prisma from "../../../db.server";
import type { CreditUsageSource } from "./recordCreditUsage.server";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

export type CreditUsageItem = {
  id: string;
  source: CreditUsageSource | string;
  credits: number;
  createdAt: string;
  target: string | null;
};

export type CreditUsageBySource = {
  v4_job: number;
  single: number;
  image: number;
};

export type ListCreditUsageResult = {
  usedCredits: number;
  periodStart: string | null;
  periodEnd: string | null;
  bySource: CreditUsageBySource;
  items: CreditUsageItem[];
  nextCursor: string | null;
};

const EMPTY_BY_SOURCE: CreditUsageBySource = {
  v4_job: 0,
  single: 0,
  image: 0,
};

function clampPageSize(value: number | undefined): number {
  if (!Number.isFinite(value) || !value || value < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.floor(value));
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}\t${id}`, "utf8").toString(
    "base64url",
  );
}

function decodeCursor(
  raw: string | undefined,
): { createdAt: Date; id: string } | null {
  if (!raw?.trim()) return null;
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const tab = decoded.indexOf("\t");
    if (tab <= 0) return null;
    const createdAt = new Date(decoded.slice(0, tab));
    const id = decoded.slice(tab + 1).trim();
    if (!id || Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

function extractTarget(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const rec = metadata as Record<string, unknown>;
  for (const key of ["target", "targetCode"] as const) {
    const value = rec[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function buildWhere(
  shop: string,
  periodStart: Date | null,
  cursor: { createdAt: Date; id: string } | null,
): Prisma.CreditUsageWhereInput {
  return {
    shop,
    ...(periodStart ? { createdAt: { gte: periodStart } } : {}),
    ...(cursor
      ? {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ],
        }
      : {}),
  };
}

async function loadPeriod(shop: string) {
  const [account, sub] = await Promise.all([
    prisma.account.findUnique({
      where: { shop },
      select: { usedCredits: true },
    }),
    prisma.appSubscription.findUnique({
      where: { shop },
      select: { currentPeriodStart: true, currentPeriodEnd: true },
    }),
  ]);
  return {
    usedCredits: Math.max(0, account?.usedCredits ?? 0),
    periodStart: sub?.currentPeriodStart ?? null,
    periodEnd: sub?.currentPeriodEnd ?? null,
  };
}

async function sumBySource(
  where: Prisma.CreditUsageWhereInput,
): Promise<CreditUsageBySource> {
  const grouped = await prisma.creditUsage.groupBy({
    by: ["source"],
    where,
    _sum: { credits: true },
  });
  const bySource = { ...EMPTY_BY_SOURCE };
  for (const row of grouped) {
    if (row.source === "v4_job" || row.source === "single" || row.source === "image") {
      bySource[row.source] = Math.max(0, row._sum.credits ?? 0);
    }
  }
  return bySource;
}

function toItem(row: {
  id: string;
  source: string;
  credits: number;
  createdAt: Date;
  metadata: unknown;
}): CreditUsageItem {
  return {
    id: row.id,
    source: row.source,
    credits: Math.max(0, row.credits),
    createdAt: row.createdAt.toISOString(),
    target: extractTarget(row.metadata),
  };
}

/** 本周期积分用量：账本 usedCredits + CreditUsage 分类汇总与明细分页。 */
export async function listCreditUsage(params: {
  shop: string;
  cursor?: string;
  pageSize?: number;
}): Promise<ListCreditUsageResult> {
  const pageSize = clampPageSize(params.pageSize);
  const cursor = decodeCursor(params.cursor);
  const period = await loadPeriod(params.shop);
  const where = buildWhere(params.shop, period.periodStart, cursor);
  const periodWhere = buildWhere(params.shop, period.periodStart, null);

  const [bySource, rows] = await Promise.all([
    cursor ? Promise.resolve(EMPTY_BY_SOURCE) : sumBySource(periodWhere),
    prisma.creditUsage.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: pageSize + 1,
      select: {
        id: true,
        source: true,
        credits: true,
        createdAt: true,
        metadata: true,
      },
    }),
  ]);

  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  const last = page[page.length - 1];
  return {
    usedCredits: period.usedCredits,
    periodStart: period.periodStart?.toISOString() ?? null,
    periodEnd: period.periodEnd?.toISOString() ?? null,
    bySource: cursor ? EMPTY_BY_SOURCE : bySource,
    items: page.map(toItem),
    nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}
