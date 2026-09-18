import prisma from "../../../db.server";
import type { CreditUsageSource } from "./recordCreditUsage.server";

export type CreditUsageListItem = {
  id: string;
  kind: "usage" | "billing";
  source: CreditUsageSource | string;
  eventType?: string | null;
  planKey?: string | null;
  creditsDelta: number;
  createdAt: string;
  metadata: unknown;
};

export type ListCreditUsageParams = {
  shop: string;
  /** 每页条数，默认 10，上限 100。 */
  take?: number;
  /** 游标：上一页最后一条的 id；有则取 createdAt 更早的记录。 */
  cursor?: string | null;
};

export type ListCreditUsageResult = {
  items: CreditUsageListItem[];
  nextCursor: string | null;
};

const DEFAULT_TAKE = 10;
const MAX_TAKE = 100;
const HISTORY_WINDOW = 100;

/**
 * 本店积分流水（新→旧）。
 * 合并 CreditUsage（消费）与 BillingLog（入账/到期/迁出），统一返回 signed creditsDelta。
 * 仅暴露最近 100 条；cursor 在这个窗口内分页。
 */
export async function listCreditUsage(
  params: ListCreditUsageParams,
): Promise<ListCreditUsageResult> {
  const shop = params.shop.trim();
  const take = Math.min(
    MAX_TAKE,
    Math.max(1, Math.floor(params.take ?? DEFAULT_TAKE)),
  );
  const cursorId = params.cursor?.trim() || null;

  const fetchTake = HISTORY_WINDOW;
  const [usageRows, billingRows] = await Promise.all([
    prisma.creditUsage.findMany({
      where: { shop },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: fetchTake,
      select: {
        id: true,
        source: true,
        credits: true,
        createdAt: true,
        metadata: true,
      },
    }),
    prisma.billingLog.findMany({
      where: {
        shop,
        creditsDelta: { not: null },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: fetchTake,
      select: {
        id: true,
        eventType: true,
        planKey: true,
        creditsDelta: true,
        createdAt: true,
        metadata: true,
      },
    }),
  ]);

  const mergedRows = [
    ...usageRows.map((row) => ({
      id: row.id,
      kind: "usage" as const,
      source: row.source,
      eventType: null,
      planKey: null,
      creditsDelta: -Math.max(0, Math.floor(row.credits)),
      createdAt: row.createdAt,
      metadata: row.metadata ?? null,
    })),
    ...billingRows
      .map((row) => ({
        id: row.id,
        kind: "billing" as const,
        source: row.eventType,
        eventType: row.eventType,
        planKey: row.planKey ?? null,
        creditsDelta: Math.floor(row.creditsDelta ?? 0),
        createdAt: row.createdAt,
        metadata: row.metadata ?? null,
      }))
      .filter((row) => row.creditsDelta !== 0),
  ].sort((a, b) => {
    const timeDiff = b.createdAt.getTime() - a.createdAt.getTime();
    if (timeDiff !== 0) return timeDiff;
    return b.id.localeCompare(a.id);
  });

  const historyWindow = mergedRows.slice(0, HISTORY_WINDOW);

  const startIndex = cursorId
    ? Math.max(
        0,
        historyWindow.findIndex((row) => row.id === cursorId) + 1,
      )
    : 0;
  const slice = historyWindow.slice(startIndex, startIndex + take + 1);
  const hasMore = slice.length > take;
  const page = hasMore ? slice.slice(0, take) : slice;
  const nextCursor = hasMore ? page[page.length - 1]?.id ?? null : null;

  return {
    items: page.map((row) => ({
      id: row.id,
      kind: row.kind,
      source: row.source,
      eventType: row.eventType,
      planKey: row.planKey,
      creditsDelta: row.creditsDelta,
      createdAt: row.createdAt.toISOString(),
      metadata: row.metadata ?? null,
    })),
    nextCursor,
  };
}
