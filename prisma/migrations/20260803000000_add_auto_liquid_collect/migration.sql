-- AlterTable: mark LiquidRule origin (manual admin entry vs storefront auto-collected)
ALTER TABLE "LiquidRule" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual';

-- AlterTable: storefront auto-collect opt-in switch on SwitcherConfiguration
ALTER TABLE "SwitcherConfiguration" ADD COLUMN "autoLiquidCollect" BOOLEAN NOT NULL DEFAULT false;
