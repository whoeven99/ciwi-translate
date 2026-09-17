-- 安装试用 / 首订试用分笔到期。
ALTER TABLE "Account" ADD COLUMN "trialInstallCredits" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Account" ADD COLUMN "trialInstallExpiresAt" DATETIME;
ALTER TABLE "Account" ADD COLUMN "trialBonusCredits" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Account" ADD COLUMN "trialBonusExpiresAt" DATETIME;

-- 已拿过 Basic 首付赠送：剩余试用记到首订笔（兼容旧的单一到期时间）。
UPDATE "Account"
SET
  "trialBonusCredits" = "trialCredits",
  "trialBonusExpiresAt" = "trialCreditsExpiresAt"
WHERE "trialCredits" > 0
  AND "shop" IN (
    SELECT "shop" FROM "BillingLog"
    WHERE "eventType" = 'TRIAL_GRANTED'
      AND "referenceId" = 'basic_first_pay_bonus'
  );

-- 其余剩余试用（安装赠送或存量 Launch）记到安装笔。
UPDATE "Account"
SET
  "trialInstallCredits" = "trialCredits",
  "trialInstallExpiresAt" = "trialCreditsExpiresAt"
WHERE "trialCredits" > 0
  AND "trialBonusCredits" = 0;
