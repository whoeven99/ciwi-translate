import { getOfflineAccessTokenFromTsf } from "./tsfDb.js";

const LOG = "[shop-token]";

/**
 * Shopify Admin API 的唯一 token 来源：Turso Session 表中的 offline session。
 * 不接受 job 快照、调用方兜底值，也不做进程内缓存。
 */
export async function getShopAccessToken(shop: string): Promise<string> {
  const normalizedShop = shop.trim();
  if (!normalizedShop) {
    throw new Error(`${LOG} shop is required`);
  }

  const token = (await getOfflineAccessTokenFromTsf(normalizedShop))?.trim();
  if (!token) {
    throw new Error(
      `${LOG} no offline token in Turso Session for shop=${normalizedShop}`,
    );
  }
  return token;
}

/** 卸载 / Session 丢失等：重试或继续 poll 无意义。 */
export function isNoOfflineTokenError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes("no offline token in Turso Session") ||
    msg.includes("Turso Session 中缺少 offline token")
  );
}
