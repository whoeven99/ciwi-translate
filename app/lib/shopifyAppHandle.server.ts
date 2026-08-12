import { normalizeEnvValue } from "~/config/runtimeEnv.server";
import {
  SHOPIFY_BILLING_RETURN_URL_MAX_LENGTH,
  sanitizeBillingReturnPath,
} from "~/utils/billingReturn";

/** Partners app handle by API key (see shopify.app.*.toml). */
const APP_HANDLE_BY_API_KEY: Record<string, string> = {
  dec512b68e658e4f21588e3d4de0e748: "ciwi-test",
  fb9fc15cbec02bd735e2a5b491cf8409: "ciwi-translator",
};

/** Shopify Admin embedded return URL segment: /apps/{handle}/... */
export function resolveShopifyAppHandle(): string {
  const explicit =
    normalizeEnvValue(process.env.SHOPIFY_APP_HANDLE) ||
    normalizeEnvValue(process.env.HANDLE);
  if (explicit) return explicit;

  const apiKey = normalizeEnvValue(process.env.SHOPIFY_API_KEY);
  return APP_HANDLE_BY_API_KEY[apiKey] ?? "ciwi-translator";
}

export function buildShopifyEmbeddedAppReturnUrl(
  shop: string,
  appPath: string,
): URL {
  const storeHandle = shop.split(".")[0];
  const handle = resolveShopifyAppHandle();
  const normalizedPath = sanitizeBillingReturnPath(appPath);
  const url = new URL(
    `https://admin.shopify.com/store/${storeHandle}/apps/${handle}${normalizedPath}`,
  );

  if (url.href.length > SHOPIFY_BILLING_RETURN_URL_MAX_LENGTH) {
    const minimalPath = normalizedPath.split("?")[0] ?? "/app/pricing";
    const fallback = new URL(
      `https://admin.shopify.com/store/${storeHandle}/apps/${handle}${minimalPath}?ciwiBillingReturn=1`,
    );
    if (fallback.href.length <= SHOPIFY_BILLING_RETURN_URL_MAX_LENGTH) {
      return fallback;
    }
    console.warn(
      `[billing] returnUrl still exceeds ${SHOPIFY_BILLING_RETURN_URL_MAX_LENGTH} chars shop=${shop} len=${fallback.href.length}`,
    );
  }

  return url;
}
