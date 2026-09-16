import prisma from "../../../db.server";
import type { CreditUsageSource } from "./recordCreditUsage.server";

export type CreditUsageListItem = {
  id: string;
  source: CreditUsageSource | string;
  credits: number;
  createdAt: string;
  metadata: unknown;
};

export type ListCreditUsageParams = {
  shop: string;
  /** 每页条数，默认 20，上限 50。 */
  take?: number;
  /** 游标：上一页最后一条的 id；有则取 createdAt 更早的记录。 */
  cursor?: string | null;
};

export type ListCreditUsageResult = {
  items: CreditUsageListItem[];
  nextCursor: string | null;
};

const DEFAULT_TAKE = 20;
const MAX_TAKE = 50;

/**
 * 本店 CreditUsage 消费列表（新→旧）。cursor 为上一页末条 id。
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

  let cursorCreatedAt: Date | null = null;
  if (cursorId) {
    const cursorRow = await prisma.creditUsage.findFirst({
      where: { id: cursorId, shop },
      select: { createdAt: true },
    });
    cursorCreatedAt = cursorRow?.createdAt ?? null;
  }

  const rows = await prisma.creditUsage.findMany({
    where: {
      shop,
      ...(cursorCreatedAt
        ? {
            OR: [
              { createdAt: { lt: cursorCreatedAt } },
              { createdAt: cursorCreatedAt, id: { lt: cursorId! } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    select: {
      id: true,
      source: true,
      credits: true,
      createdAt: true,
      metadata: true,
    },
  });

  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const nextCursor = hasMore ? page[page.length - 1]?.id ?? null : null;

  return {
    items: page.map((row) => ({
      id: row.id,
      source: row.source,
      credits: row.credits,
      createdAt: row.createdAt.toISOString(),
      metadata: row.metadata ?? null,
    })),
    nextCursor,
  };
}
