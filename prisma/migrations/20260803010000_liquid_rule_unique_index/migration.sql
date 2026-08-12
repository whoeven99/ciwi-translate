-- 去重历史数据：同 (shop, languageCode, beforeTranslation) 仅保留最早一行，
-- 否则下方唯一索引会因已有重复数据创建失败。
DELETE FROM "LiquidRule"
WHERE "id" NOT IN (
  SELECT MIN("id") FROM "LiquidRule"
  GROUP BY "shop", "languageCode", "beforeTranslation"
);

-- 唯一约束：同店 + 语言 + 原文 只允许一条（auto 采集与 manual 手填共用）。
-- 支撑 collect 侧 upsert：冲突时覆盖译文，不抛错。
CREATE UNIQUE INDEX "LiquidRule_shop_languageCode_beforeTranslation_key"
ON "LiquidRule"("shop", "languageCode", "beforeTranslation");
