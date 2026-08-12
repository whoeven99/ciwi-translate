/** Shared TTL for storefront translation/image payloads (matches switcher config). */
export const CIWI_TRANSLATION_TTL_MS = 1000 * 60 * 60;

/** 负缓存 TTL：无 LiquidRule 等空结果用更短窗口，便于商户稍后写入后较快生效。 */
export const CIWI_EMPTY_TRANSLATION_TTL_MS = 1000 * 60 * 10;

export function buildTranslationCacheKey(prefix, parts) {
  return `ciwi_${prefix}:${parts.filter(Boolean).join(":")}`;
}

function normalizeProductId(value) {
  if (value == null) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  const gidMatch = raw.match(/\/Product\/(\d+)/);
  if (gidMatch?.[1]) return gidMatch[1];
  const digitsMatch = raw.match(/\d+/);
  return digitsMatch?.[0] || "";
}

export function resolveStorefrontProductId(ciwiBlock) {
  const readInput = (name) =>
    ciwiBlock?.querySelector(`input[name="${name}"]`)?.value?.trim() || "";

  const candidates = [
    readInput("product_id"),
    window.ShopifyAnalytics?.meta?.product?.id,
    window.meta?.product?.id,
    window.Shopify?.Analytics?.meta?.product?.id,
    window.Shopify?.analytics?.meta?.product?.id,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeProductId(candidate);
    if (normalized) return normalized;
  }

  return "";
}

/**
 * Resolve storefront page context from Liquid hidden inputs with Shopify global fallbacks.
 */
export function getCiwiPageContext(ciwiBlock) {
  const readInput = (name) =>
    ciwiBlock?.querySelector(`input[name="${name}"]`)?.value?.trim() || "";

  const pageType =
    readInput("page_type") ||
    window.Shopify?.Analytics?.meta?.page?.pageType ||
    window.Shopify?.theme?.pageType ||
    "";

  const templateName =
    readInput("template_name") ||
    window.Shopify?.theme?.template ||
    "";

  const productId = resolveStorefrontProductId(ciwiBlock);

  const isProductPage =
    pageType === "product" ||
    templateName === "product" ||
    Boolean(productId);

  const isHomePage =
    pageType === "index" ||
    templateName === "index";

  const hasPageFly = Boolean(
    document.querySelector('[data-pf-type], .__pf') ||
      document.querySelector(
        '[id*="pagefly"], [class*="pagefly"], [class*="PageFly"]',
      ),
  );

  return {
    pageType,
    templateName,
    productId,
    isProductPage,
    isHomePage,
    hasPageFly,
  };
}

/** Normalize API payloads so useCacheThenRefresh/setWithTTL can persist them. */
export function asCacheableTranslationResponse(data) {
  if (!data || data.success === false) return data;
  if (data.success === true) return data;
  if (data.response !== undefined) return { success: true, ...data };
  return data;
}
