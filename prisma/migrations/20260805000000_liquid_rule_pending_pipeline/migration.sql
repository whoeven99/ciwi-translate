-- LiquidRule: PENDING → TRANSLATING → DONE pipeline for third-party / custom liquid
ALTER TABLE "LiquidRule" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'DONE';
ALTER TABLE "LiquidRule" ADD COLUMN "sourceDigest" TEXT;
ALTER TABLE "LiquidRule" ADD COLUMN "jobId" TEXT;

CREATE INDEX "LiquidRule_shop_languageCode_status_idx" ON "LiquidRule"("shop", "languageCode", "status");
