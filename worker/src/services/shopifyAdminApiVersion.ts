/**
 * Shopify Admin API 版本（Worker 侧单一来源）。
 * 与 app/lib/shopifyAdminApiVersion.ts 保持同值同规范化；升级时两边一起改。
 */
export const SHOPIFY_ADMIN_API_VERSION = "2026-07";

export function buildShopifyAdminGraphqlUrl(shopDomain: string): string {
  const shop = shopDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${shop}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`;
}
