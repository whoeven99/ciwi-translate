-- AlterTable: install-gift trial credits expire after 30 days
ALTER TABLE "Account" ADD COLUMN "trialCreditsExpiresAt" DATETIME;
