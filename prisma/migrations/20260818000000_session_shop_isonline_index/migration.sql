-- Session has no index today, but every Shopify Admin API call (App + Worker)
-- resolves the offline token via `WHERE shop = ? AND isOnline = 0` with no
-- process-level cache (shopAccessToken.ts / offlineSessionToken.server.ts).
-- This is the hottest read path in the whole system and was doing a full
-- table scan. Add a composite index to cover it.
CREATE INDEX IF NOT EXISTS "Session_shop_isOnline_idx" ON "Session"("shop", "isOnline");
