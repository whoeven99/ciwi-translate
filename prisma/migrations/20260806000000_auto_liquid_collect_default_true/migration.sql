-- Default on for existing rows. Turso/LibSQL (SQLite) cannot change column DEFAULT via ALTER.
-- Schema @default(true) and switcher save paths force true for new config rows.
-- Merchant UI toggle removed. Ops kill-switch: AUTO_LIQUID_COLLECT_ENABLED.
UPDATE "SwitcherConfiguration"
SET "autoLiquidCollect" = true
WHERE "autoLiquidCollect" = false;
