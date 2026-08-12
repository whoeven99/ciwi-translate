import { buildShopifyAdminGraphqlUrl } from "../shopifyAdminApiVersion.js";

/**
 * 店铺画像扫描专用的 Shopify Admin GraphQL 调用器。
 *
 * 与翻译流水线的 shopifyFetch 解耦（那套私有且耦合并发控制），此处只做画像扫描
 * 需要的最小可靠性：429 / THROTTLED / 5xx 退避重试。所有扫描读操作走这里。
 */

const RETRY_5XX = new Set([502, 503, 504, 520]);

export class ShopScanThrottleError extends Error {}

export async function shopScanGraphql<T = unknown>(
  shop: string,
  accessToken: string,
  query: string,
  variables: Record<string, unknown> = {},
  retries = 4,
): Promise<T> {
  const url = buildShopifyAdminGraphqlUrl(shop);
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (resp.status === 429) {
    if (retries <= 0) {
      throw new ShopScanThrottleError(`Shopify 429 (retries exhausted) shop=${shop}`);
    }
    const retryAfter = Number(resp.headers.get("Retry-After") ?? "2");
    await sleep(Math.max(retryAfter * 1000, 1_000));
    return shopScanGraphql(shop, accessToken, query, variables, retries - 1);
  }

  if (RETRY_5XX.has(resp.status)) {
    if (retries <= 0) {
      throw new Error(`Shopify HTTP ${resp.status} shop=${shop}`);
    }
    await sleep(Math.min(8_000, 2_000 * (5 - retries)));
    return shopScanGraphql(shop, accessToken, query, variables, retries - 1);
  }

  if (!resp.ok) {
    throw new Error(`Shopify HTTP ${resp.status}: ${await resp.text()}`);
  }

  const json = (await resp.json()) as {
    data?: T;
    errors?: Array<{ message?: string; extensions?: { code?: string } }>;
  };

  if (json.errors?.length) {
    const throttled = json.errors.some((e) => e?.extensions?.code === "THROTTLED");
    if (throttled) {
      if (retries <= 0) {
        throw new ShopScanThrottleError(`Shopify THROTTLED (retries exhausted) shop=${shop}`);
      }
      await sleep(Math.max(2_000, (5 - retries) * 1_500));
      return shopScanGraphql(shop, accessToken, query, variables, retries - 1);
    }
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
  }

  return json.data as T;
}

/** 画像扫描可恢复错误（限流 / 网关抖动 / 网络）→ 让 worker 重新入队而非直接失败。 */
export function isRecoverableScanError(error: unknown): boolean {
  if (error instanceof ShopScanThrottleError) return true;
  const msg =
    error instanceof Error ? `${error.message}` : typeof error === "string" ? error : "";
  return (
    /THROTTLED|429|rate limit/i.test(msg) ||
    /HTTP 50[234]/i.test(msg) ||
    /ETIMEDOUT|ECONNRESET|EAI_AGAIN|fetch failed/i.test(msg) ||
    /shutdown:.*yielding for deploy/i.test(msg)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
