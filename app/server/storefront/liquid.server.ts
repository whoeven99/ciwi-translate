import prisma from "~/db.server";
import { ok, type BaseResponse } from "./response.server";

/** 对应 Java parseLiquidDataByShopNameAndLanguage 的响应 response 形状：
 *  { "原文": ["译文", replacementMethod(bool)], ... }
 */
export type LiquidMap = Record<string, [string, boolean]>;

/**
 * 判断字符串是否为 JSON 对象/数组（Java 侧会跳过这类 before/after）。
 * 仅检查以 `{` 或 `[` 开头并能成功解析为 object/array 的情况。
 */
function isJsonObject(str: string): boolean {
  if (!str) return false;
  const s = str.trimStart();
  if (s[0] !== "{" && s[0] !== "[") return false;
  try {
    const parsed = JSON.parse(s);
    return typeof parsed === "object" && parsed !== null;
  } catch {
    return false;
  }
}

/** 从 TSF Prisma 读取 Liquid 规则（v4 默认路径）。 */
export async function parseLiquidTranslations(
  shop: string,
  languageCode: string,
): Promise<BaseResponse<LiquidMap>> {
  return readFromPrisma(shop, languageCode);
}

/** 从 Prisma LiquidRule 读取（仅 DONE + 非空译文，供店面 DOM 替换）。 */
async function readFromPrisma(
  shop: string,
  languageCode: string,
): Promise<BaseResponse<LiquidMap>> {
  const rules = await prisma.liquidRule.findMany({
    where: {
      shop,
      languageCode,
      status: "DONE",
      afterTranslation: { not: "" },
    },
    // 新规则在前；同长度时由下面的稳定按长度排序保留该次序。
    orderBy: { createdAt: "desc" },
    select: {
      beforeTranslation: true,
      afterTranslation: true,
      replacementMethod: true,
    },
  });

  // 模糊替换主序：原文长→短，避免短词（Cable）截断整句。
  const ordered = [...rules].sort(
    (a, b) => b.beforeTranslation.length - a.beforeTranslation.length,
  );

  const map: LiquidMap = {};
  for (const rule of ordered) {
    if (isJsonObject(rule.beforeTranslation) || isJsonObject(rule.afterTranslation)) {
      continue;
    }
    if (!rule.afterTranslation?.trim()) continue;
    map[rule.beforeTranslation] = [rule.afterTranslation, rule.replacementMethod];
  }

  // 空结果也返回 success + {}，便于店面 localStorage 负缓存。
  return ok(map);
}
