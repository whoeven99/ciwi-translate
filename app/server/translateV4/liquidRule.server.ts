import prisma from "~/db.server";
import { invalidateStorefrontCache } from "~/server/storefront/cache.server";
import { liquidSourceDigest } from "./liquidDigest.server";

/** 对齐 Java UserLiquidDO，便于 Admin 页面迁移前后复用同一套渲染逻辑。 */
export type LiquidDoShape = {
  id: string;
  liquidBeforeTranslation: string;
  liquidAfterTranslation: string;
  languageCode: string | null;
  replacementMethod: boolean;
  source: string;
  status: string;
};

export type LiquidTableRow = {
  key: string;
  sourceText: string;
  targetText: string;
  replacementMethod: boolean;
  languageCode: string;
  source: string;
  status: string;
};

type LiquidRow = {
  id: string;
  shop: string;
  beforeTranslation: string;
  afterTranslation: string;
  languageCode: string | null;
  replacementMethod: boolean;
  source: string;
  status: string;
};

function toDo(row: LiquidRow): LiquidDoShape {
  return {
    id: row.id,
    liquidBeforeTranslation: row.beforeTranslation,
    liquidAfterTranslation: row.afterTranslation,
    languageCode: row.languageCode,
    replacementMethod: row.replacementMethod,
    source: row.source,
    status: row.status,
  };
}

export function toLiquidTableRow(item: LiquidDoShape): LiquidTableRow {
  return {
    key: item.id,
    sourceText: item.liquidBeforeTranslation,
    targetText: item.liquidAfterTranslation,
    replacementMethod: item.replacementMethod,
    languageCode: item.languageCode ?? "",
    source: item.source,
    status: item.status,
  };
}

const DEFAULT_LIST_PAGE_SIZE = 10;
const MAX_LIST_PAGE_SIZE = 50;
const MAX_QUERY_LENGTH = 200;

export type ListLiquidPageInput = {
  shop: string;
  languageCode: string;
  q?: string;
  page?: number;
  pageSize?: number;
};

export type ListLiquidPageResult = {
  rows: LiquidDoShape[];
  hasNext: boolean;
};

/** Prisma SQLite `contains` → LIKE '%q%' 且无 ESCAPE；去掉通配符以免放大匹配。 */
function neutralizeLikeWildcards(q: string): string {
  return q.replace(/[%_]/g, "");
}

export async function listLiquidPage(
  input: ListLiquidPageInput,
): Promise<ListLiquidPageResult> {
  const languageCode = input.languageCode.trim();
  const page = Math.max(1, Math.floor(Number(input.page) || 1));
  const pageSize = Math.min(
    MAX_LIST_PAGE_SIZE,
    Math.max(1, Math.floor(Number(input.pageSize) || DEFAULT_LIST_PAGE_SIZE)),
  );
  const q = neutralizeLikeWildcards(
    (input.q ?? "").trim().slice(0, MAX_QUERY_LENGTH),
  );

  const rows = await prisma.liquidRule.findMany({
    where: {
      shop: input.shop,
      languageCode,
      ...(q ? { beforeTranslation: { contains: q } } : {}),
    },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize + 1,
  });
  const hasNext = rows.length > pageSize;
  return {
    rows: rows.slice(0, pageSize).map(toDo),
    hasNext,
  };
}

export type LiquidInput = {
  sourceText: string;
  targetText: string;
  languageCode: string;
  replacementMethod?: boolean;
};

async function findDuplicate(
  shop: string,
  sourceText: string,
  languageCode: string,
  excludeId?: string,
): Promise<LiquidRow | null> {
  return prisma.liquidRule.findFirst({
    where: {
      shop,
      beforeTranslation: sourceText,
      languageCode,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
}

export async function createLiquidDo(
  shop: string,
  input: LiquidInput,
): Promise<LiquidDoShape | "duplicate"> {
  const dup = await findDuplicate(shop, input.sourceText, input.languageCode);
  if (dup) return "duplicate";

  const row = await prisma.liquidRule.create({
    data: {
      shop,
      beforeTranslation: input.sourceText,
      afterTranslation: input.targetText,
      languageCode: input.languageCode,
      replacementMethod: input.replacementMethod ?? false,
      source: "manual",
      status: "DONE",
      sourceDigest: liquidSourceDigest(input.sourceText),
      jobId: null,
    },
  });
  await invalidateStorefrontCache("liquid", shop);
  return toDo(row);
}

export async function updateLiquidDo(
  shop: string,
  id: string,
  input: LiquidInput,
): Promise<LiquidDoShape | null | "duplicate"> {
  const existing = await prisma.liquidRule.findFirst({ where: { id, shop } });
  if (!existing) return null;

  const dup = await findDuplicate(
    shop,
    input.sourceText,
    input.languageCode,
    id,
  );
  if (dup) return "duplicate";

  const row = await prisma.liquidRule.update({
    where: { id },
    data: {
      beforeTranslation: input.sourceText,
      afterTranslation: input.targetText,
      languageCode: input.languageCode,
      sourceDigest: liquidSourceDigest(input.sourceText),
      status: "DONE",
      jobId: null,
      ...(input.replacementMethod != null
        ? { replacementMethod: input.replacementMethod }
        : {}),
    },
  });
  await invalidateStorefrontCache("liquid", shop);
  return toDo(row);
}

export async function deleteLiquidDo(
  shop: string,
  ids: string[],
): Promise<string[]> {
  if (!ids.length) return [];
  const existing = await prisma.liquidRule.findMany({
    where: { shop, id: { in: ids } },
    select: { id: true },
  });
  const validIds = existing.map((r) => r.id);
  if (!validIds.length) return [];
  await prisma.liquidRule.deleteMany({
    where: { shop, id: { in: validIds } },
  });
  await invalidateStorefrontCache("liquid", shop);
  return validIds;
}

/** 对齐 Java updateLiquidReplacementMethod：切换精确/模糊替换。 */
export async function toggleLiquidReplacementMethod(
  shop: string,
  id: string,
): Promise<boolean | null> {
  const existing = await prisma.liquidRule.findFirst({ where: { id, shop } });
  if (!existing) return null;
  const next = !existing.replacementMethod;
  await prisma.liquidRule.update({
    where: { id },
    data: { replacementMethod: next },
  });
  await invalidateStorefrontCache("liquid", shop);
  return next;
}

/** 创建任务额度粗估：各目标语言 PENDING 原文总字符。 */
export async function sumPendingLiquidChars(
  shop: string,
  targets: string[],
): Promise<number> {
  const locales = [...new Set(targets.map((t) => t.trim()).filter(Boolean))];
  if (!locales.length) return 0;
  const rows = await prisma.liquidRule.findMany({
    where: {
      shop,
      languageCode: { in: locales },
      status: "PENDING",
    },
    select: { beforeTranslation: true },
  });
  return rows.reduce((sum, r) => sum + (r.beforeTranslation?.length ?? 0), 0);
}
