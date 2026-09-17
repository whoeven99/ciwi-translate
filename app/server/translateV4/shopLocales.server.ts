import { queryShopLanguages } from "~/api/admin";

export type ShopLocaleRow = {
  locale: string;
  name: string;
  primary: boolean;
  published: boolean;
};

export type LoadedShopLocales = {
  rows: ShopLocaleRow[];
  primaryLocale: string;
  localeOptions: Array<{
    value: string;
    label: string;
    primary: boolean;
    published: boolean;
  }>;
};

// 店铺语言列表变动不频繁，但每次进首页都打一次 Shopify GraphQL（~200-400ms，
// 在同步 SSR 的关键路径上）。加 45s 内存缓存，绝大多数进入直接命中。
const CACHE_TTL_MS = 45_000;
const localesCache = new Map<string, { value: LoadedShopLocales; expiresAt: number }>();
/** 缓存未命中时合并同店并发请求，避免 SSR 多入口各打一次 Shopify GraphQL。 */
const localesInFlight = new Map<string, Promise<LoadedShopLocales>>();

/** 语言增删后调用（语言页），清掉缓存让下次读最新值。 */
export function invalidateShopLocalesCache(shop: string): void {
  localesCache.delete(shop);
}

/** 只读内存缓存，未命中不打 Shopify。定价整页加载用这个避免挡住 TTFB。 */
export function getCachedShopLocales(shop: string): LoadedShopLocales | null {
  const cached = localesCache.get(shop);
  if (!cached || cached.expiresAt <= Date.now()) return null;
  return cached.value;
}

/** 与语言页 `queryShopLanguages` 同源，保证 v4 目标语言列表一致。 */
export async function loadShopLocalesForTranslation(args: {
  shop: string;
  accessToken: string;
}): Promise<LoadedShopLocales> {
  const now = Date.now();
  const cached = localesCache.get(args.shop);
  if (cached && cached.expiresAt > now) return cached.value;

  const pending = localesInFlight.get(args.shop);
  if (pending) return pending;

  const loadingPromise = (async () => {
    const raw = await queryShopLanguages(args);
    const rows: ShopLocaleRow[] = Array.isArray(raw)
      ? raw
          .filter((r) => r?.locale)
          .map((r) => ({
            locale: String(r.locale),
            name: String(r.name ?? r.locale),
            primary: Boolean(r.primary),
            published: Boolean(r.published),
          }))
      : [];

    const primaryLocale = rows.find((r) => r.primary)?.locale ?? "en";
    const localeOptions = rows.map((r) => ({
      value: r.locale,
      label: `${r.name} (${r.locale})`,
      primary: r.primary,
      published: r.published,
    }));

    const result = { rows, primaryLocale, localeOptions };
    localesCache.set(args.shop, {
      value: result,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return result;
  })();

  localesInFlight.set(args.shop, loadingPromise);
  try {
    return await loadingPromise;
  } finally {
    localesInFlight.delete(args.shop);
  }
}

export async function resolveShopPrimaryLocale(args: {
  shop: string;
  accessToken: string;
}): Promise<string | null> {
  const loaded = await loadShopLocalesForTranslation(args);
  return loaded.rows.find((row) => row.primary)?.locale ?? null;
}
