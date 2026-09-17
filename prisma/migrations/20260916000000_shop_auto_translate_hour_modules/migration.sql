-- AlterTable
ALTER TABLE "ShopTranslationSettings" ADD COLUMN "autoTranslateHour" INTEGER;
ALTER TABLE "ShopTranslationSettings" ADD COLUMN "autoTranslateModules" JSONB;
