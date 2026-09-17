-- AlterTable: first-pay Basic bonus 100 万试用积分 30 天到期
ALTER TABLE "Account" ADD COLUMN "trialCreditsExpiresAt" DATETIME;

-- 积分补充包：100K $1.99 / 300K $2.99（priceAmount 记标价；实际扣费按套餐折扣）
INSERT OR IGNORE INTO "PlanCatalog" ("planKey","kind","billingInterval","displayName","credits","priceAmount","currencyCode","trialDays","shopifyPlanName","sortOrder","enabled","createdAt","updatedAt") VALUES
  ('pack-100k','ONE_TIME_PACK',NULL,'100K Credits',100000,'1.99','USD',NULL,'100K Credits',98,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('pack-300k','ONE_TIME_PACK',NULL,'300K Credits',300000,'2.99','USD',NULL,'300K Credits',99,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
