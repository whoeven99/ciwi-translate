/** Maps our module names to Shopify's TranslatableResourceType enum values */
import { getShopAccessToken } from "./shopAccessToken.js";
import { shouldIncludeFieldV2 } from "@ciwi/translation-core/translation-filter";
import { noteShopifyThrottle } from "./shopifyConcurrency.js";
import { buildShopifyAdminGraphqlUrl } from "./shopifyAdminApiVersion.js";
import { isTooManyTranslationKeysMessage } from "./writebackUserErrors.js";

export const MODULE_TO_SHOPIFY_TYPE: Record<string, string> = {
  PRODUCT: "PRODUCT",
  PRODUCT_OPTION: "PRODUCT_OPTION",
  PRODUCT_OPTION_VALUE: "PRODUCT_OPTION_VALUE",
  COLLECTION: "COLLECTION",
  ONLINE_STORE_THEME: "ONLINE_STORE_THEME",
  ONLINE_STORE_THEME_APP_EMBED: "ONLINE_STORE_THEME_APP_EMBED",
  ONLINE_STORE_THEME_LOCALE_CONTENT: "ONLINE_STORE_THEME_LOCALE_CONTENT",
  ONLINE_STORE_THEME_JSON_TEMPLATE: "ONLINE_STORE_THEME_JSON_TEMPLATE",
  ONLINE_STORE_THEME_SECTION_GROUP: "ONLINE_STORE_THEME_SECTION_GROUP",
  ONLINE_STORE_THEME_SETTINGS_CATEGORY: "ONLINE_STORE_THEME_SETTINGS_CATEGORY",
  ONLINE_STORE_THEME_SETTINGS_DATA_SECTIONS: "ONLINE_STORE_THEME_SETTINGS_DATA_SECTIONS",
  MENU: "MENU",
  LINK: "LINK",
  DELIVERY_METHOD_DEFINITION: "DELIVERY_METHOD_DEFINITION",
  FILTER: "FILTER",
  METAFIELD: "METAFIELD",
  METAOBJECT: "METAOBJECT",
  PAYMENT_GATEWAY: "PAYMENT_GATEWAY",
  SELLING_PLAN: "SELLING_PLAN",
  SELLING_PLAN_GROUP: "SELLING_PLAN_GROUP",
  SHOP: "SHOP",
  ARTICLE: "ARTICLE",
  BLOG: "BLOG",
  PAGE: "PAGE",
  SHOP_POLICY: "SHOP_POLICY",
  EMAIL_TEMPLATE: "EMAIL_TEMPLATE",
  PACKING_SLIP_TEMPLATE: "PACKING_SLIP_TEMPLATE",
};

/** PRODUCT/ARTICLE/PAGE/COLLECTION 先拉 ID 再走 translatableResourcesByIds */
export const ID_BASED_MODULES = ["PRODUCT", "ARTICLE", "PAGE", "COLLECTION"] as const;

/** Init 阶段 Shopify Admin query 筛选（空 = 含未发布，与 PRODUCT 一致） */
export const ID_BASED_MODULE_QUERY: Record<string, string> = {
  PRODUCT: "",
  COLLECTION: "",
  PAGE: "",
  ARTICLE: "",
};

export type TranslatableField = {
  key: string;
  value: string;
  digest: string;
  /** Shopify translatableContent.type — required for METAFIELD JSON/LIST routing. */
  shopifyType?: string;
};

export type TranslatableResource = {
  resourceId: string;
  fields: TranslatableField[];
};

export type FetchTranslatableOptions = {
  targetLocale: string;
  isCover: boolean;
  isHandle: boolean;
  /** Called after each paginated API response — use to keep heartbeat alive on long fetches */
  onPage?: () => Promise<void>;
  /**
   * 若提供，跳过全店枚举，直接按这些 GID 拉取（试译单商品等）。
   * 仅对 ID-based module（如 PRODUCT）生效。
   */
  resourceIds?: string[];
};

export type TranslatableNode = {
  resourceId: string;
  translations: Array<{ key: string; value?: string | null; outdated?: boolean | null }>;
  translatableContent: Array<{
    key: string;
    value: string;
    digest: string;
    locale: string;
    type?: string | null;
  }>;
};

const FETCH_PAGE_SIZE = 50;
const ID_FETCH_PAGE_SIZE = 250;
const TRANSLATABLE_RESOURCES_BY_IDS_BATCH = 250;

/**
 * Max serialized init-chunk JSON size (matches blobWrite compact JSON).
 * Default 2 MiB — sweet spot for Azure Blob vs too-many tiny files.
 * Override with TRANSLATION_MAX_CHUNK_BYTES.
 */
const MAX_CHUNK_BYTES = Math.max(
  64 * 1024,
  Number(process.env.TRANSLATION_MAX_CHUNK_BYTES?.trim()) || 2 * 1024 * 1024,
);

/**
 * Minimum remaining Shopify GraphQL bucket points before we proactively wait
 * for the bucket to recover.  Shopify's leaky bucket: capacity 1000 (Plus: 2000),
 * restore rate 50 pts/s.  Set SHOPIFY_BUCKET_FLOOR=0 to disable.
 */
const SHOPIFY_BUCKET_FLOOR = Math.max(
  0,
  Number(process.env.SHOPIFY_BUCKET_FLOOR?.trim()) || 200,
);

type ShopifyThrottleStatus = {
  maximumAvailable: number;
  currentlyAvailable: number;
  restoreRate: number; // points per second
};

const TRANSLATABLE_RESOURCES_QUERY = `
query GetTranslatableResources(
  $resourceType: TranslatableResourceType!
  $first: Int!
  $locale: String!
  $after: String
) {
  translatableResources(resourceType: $resourceType, first: $first, after: $after) {
    edges {
      node {
        resourceId
        translations(locale: $locale) {
          key
          value
          outdated
        }
        translatableContent {
          key
          value
          digest
          locale
          type
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}`;

const TRANSLATABLE_RESOURCES_BY_IDS_QUERY = `
query GetTranslatableResourcesByIds($resourceIds: [ID!]!, $first: Int, $after: String, $locale: String!) {
  translatableResourcesByIds(resourceIds: $resourceIds, first: $first, after: $after) {
    nodes {
      resourceId
      translations(locale: $locale) {
        key
        value
        outdated
      }
      translatableContent {
        key
        value
        digest
        locale
        type
      }
    }
    pageInfo {
      endCursor
      hasNextPage
    }
  }
}`;

const PRODUCTS_IDS_QUERY = `
query GetProducts($query: String, $first: Int, $after: String) {
  products(first: $first, after: $after, query: $query) {
    edges { node { id } }
    pageInfo { endCursor hasNextPage }
  }
}`;

const ARTICLES_IDS_QUERY = `
query GetArticles($query: String, $first: Int, $after: String) {
  articles(first: $first, after: $after, query: $query) {
    edges { node { id } }
    pageInfo { endCursor hasNextPage }
  }
}`;

const PAGES_IDS_QUERY = `
query GetPages($query: String, $first: Int, $after: String) {
  pages(first: $first, after: $after, query: $query) {
    edges { node { id } }
    pageInfo { endCursor hasNextPage }
  }
}`;

const COLLECTIONS_IDS_QUERY = `
query GetCollections($query: String, $first: Int, $after: String) {
  collections(first: $first, after: $after, query: $query) {
    edges { node { id } }
    pageInfo { endCursor hasNextPage }
  }
}`;

const TRANSLATIONS_REGISTER_MUTATION = `
mutation RegisterTranslations($resourceId: ID!, $translations: [TranslationInput!]!) {
  translationsRegister(resourceId: $resourceId, translations: $translations) {
    translations {
      locale
      key
      value
    }
    userErrors {
      field
      message
    }
  }
}`;

const TRANSLATABLE_RESOURCE_BY_ID_QUERY = `
query GetTranslatableResourceById($resourceId: ID!, $locale: String!) {
  translatableResource(resourceId: $resourceId) {
    resourceId
    translations(locale: $locale) {
      key
      value
      outdated
    }
  }
}`;

/**
 * Shopify GraphQL input arrays are capped (community/docs: 250 items).
 * Per-resource field counts can also hit TOO_MANY_KEYS_FOR_RESOURCE — batch conservatively;
 * registerTranslations() will auto-split on "Too many translation keys" down to 1 key.
 */
export const WRITEBACK_TRANSLATIONS_BATCH = Math.min(
  250,
  Math.max(1, Number(process.env.WRITEBACK_TRANSLATIONS_BATCH) || 100),
);

const MODULE_ID_QUERY: Record<string, { gql: string; connectionKey: string }> = {
  PRODUCT: { gql: PRODUCTS_IDS_QUERY, connectionKey: "products" },
  ARTICLE: { gql: ARTICLES_IDS_QUERY, connectionKey: "articles" },
  PAGE: { gql: PAGES_IDS_QUERY, connectionKey: "pages" },
  COLLECTION: { gql: COLLECTIONS_IDS_QUERY, connectionKey: "collections" },
};

/** Transient Shopify/Cloudflare gateway errors — retry with short back-off before failing. */
const SHOPIFY_5XX_RETRY_STATUSES = new Set([502, 503, 504, 520, 522]);
const SHOPIFY_5XX_MAX_RETRIES = Math.max(
  0,
  Number(process.env.SHOPIFY_5XX_MAX_RETRIES?.trim()) || 2,
);

/**
 * Execute a Shopify Admin GraphQL request.
 *
 * Scale-out safe features:
 *  - 429 retry: respects the Retry-After header, up to MAX_RETRIES attempts.
 *    Multiple concurrent workers for the same shop share the same rate-limit
 *    bucket; back-off prevents thundering-herd amplification.
 *  - 502/503/504/520/522 retry: short exponential back-off (default 2 attempts).
 *  - Proactive throttle: reads extensions.cost.throttleStatus from every
 *    response and inserts a calculated sleep whenever the remaining bucket
 *    points drop below SHOPIFY_BUCKET_FLOOR.  This keeps parallel module
 *    fetching (init) and parallel resource writes (writeback) from exhausting
 *    the bucket before Shopify issues a 429.
 */
// ── Per-shop Shopify call stats (for QPS logging) ────────────────────────────

export type ShopifyCallStats = {
  calls: number;
  retries429: number;
  proactiveWaitMs: number;
  lastBucketAvailable: number | null;
  lastBucketMax: number | null;
};

const _shopifyStats = new Map<string, ShopifyCallStats>();

function _getOrInitStats(shopDomain: string): ShopifyCallStats {
  let s = _shopifyStats.get(shopDomain);
  if (!s) {
    s = { calls: 0, retries429: 0, proactiveWaitMs: 0, lastBucketAvailable: null, lastBucketMax: null };
    _shopifyStats.set(shopDomain, s);
  }
  return s;
}

/** Snapshot of Shopify call stats for a shop since last reset. */
export function getShopifyCallStats(shopDomain: string): ShopifyCallStats {
  const s = _shopifyStats.get(shopDomain);
  return s
    ? { ...s }
    : { calls: 0, retries429: 0, proactiveWaitMs: 0, lastBucketAvailable: null, lastBucketMax: null };
}

/** Reset call counters for a shop (keep bucket status). */
export function resetShopifyCallStats(shopDomain: string): void {
  const s = _shopifyStats.get(shopDomain);
  if (s) {
    s.calls = 0;
    s.retries429 = 0;
    s.proactiveWaitMs = 0;
  }
}

type ShopifyGraphqlOpts = {
  retries?: number;
  /** Remaining 502/503/504/520/522 retries for this request chain. */
  retries5xx?: number;
  /** 401 后已用同一 token 重试过一次 */
  tokenRetried?: boolean;
};

/** Shared Admin GraphQL entry for init/writeback/bulk helpers. */
export async function shopifyGraphql(
  shopDomain: string,
  query: string,
  variables: Record<string, unknown>,
  opts: ShopifyGraphqlOpts = {},
): Promise<unknown> {
  const retries = opts.retries ?? 4;
  const retries5xx = opts.retries5xx ?? SHOPIFY_5XX_MAX_RETRIES;
  const accessToken = await getShopAccessToken(shopDomain);
  const url = buildShopifyAdminGraphqlUrl(shopDomain);
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  // ── 429: bucket exhausted ─────────────────────────────────────────────────
  if (resp.status === 429) {
    _getOrInitStats(shopDomain).retries429++;
    noteShopifyThrottle(shopDomain, null, true); // 乘性减并发
    if (retries <= 0) {
      throw new Error(`Shopify GraphQL 429: rate limited (retries exhausted)`);
    }
    const retryAfterSec = Number(resp.headers.get("Retry-After") ?? "2");
    const waitMs = Math.max(retryAfterSec * 1000, 1_000);
    console.warn(
      `[shopifyFetch] 429 on ${shopDomain} — waiting ${waitMs}ms (retries left: ${retries - 1})`,
    );
    await new Promise((r) => setTimeout(r, waitMs));
    return shopifyGraphql(shopDomain, query, variables, {
      ...opts,
      retries: retries - 1,
    });
  }

  if (resp.status === 401) {
    const body = await resp.text();
    if (!opts.tokenRetried) {
      console.warn(
        `[shopifyFetch] 401 on ${shopDomain} — reloading offline token from Turso Session`,
      );
      return shopifyGraphql(shopDomain, query, variables, {
        ...opts,
        tokenRetried: true,
      });
    }
    throw new Error(
      `Shopify GraphQL HTTP 401: ${body} (请重新打开 App 完成授权)`,
    );
  }

  // ── 502/503/504/520/522: transient Shopify/Cloudflare gateway errors ───────
  if (SHOPIFY_5XX_RETRY_STATUSES.has(resp.status)) {
    const body = await resp.text();
    if (retries5xx <= 0) {
      throw new Error(`Shopify GraphQL HTTP ${resp.status}: ${body}`);
    }
    const retryAfterSec = Number(resp.headers.get("Retry-After") ?? "0");
    const waitMs =
      retryAfterSec > 0
        ? Math.max(retryAfterSec * 1000, 1_000)
        : Math.min(8_000, 2_000 * (SHOPIFY_5XX_MAX_RETRIES - retries5xx + 1));
    console.warn(
      `[shopifyFetch] ${resp.status} on ${shopDomain} — waiting ${waitMs}ms (5xx retries left: ${retries5xx - 1})`,
    );
    await new Promise((r) => setTimeout(r, waitMs));
    return shopifyGraphql(shopDomain, query, variables, {
      ...opts,
      retries5xx: retries5xx - 1,
    });
  }

  if (!resp.ok) {
    throw new Error(`Shopify GraphQL HTTP ${resp.status}: ${await resp.text()}`);
  }

  const json = (await resp.json()) as {
    data?: unknown;
    errors?: unknown[];
    extensions?: { cost?: { throttleStatus?: ShopifyThrottleStatus } };
  };

  if (json.errors?.length) {
    const throttled = json.errors.some(
      (e) =>
        typeof e === "object" &&
        e !== null &&
        (e as { extensions?: { code?: string } }).extensions?.code === "THROTTLED",
    );
    if (throttled) {
      _getOrInitStats(shopDomain).retries429++;
      noteShopifyThrottle(shopDomain, json.extensions?.cost?.throttleStatus ?? null, true);
      if (retries > 0) {
        const throttle = json.extensions?.cost?.throttleStatus;
        const waitMs =
          throttle && throttle.restoreRate > 0
            ? Math.ceil(
                (Math.max(SHOPIFY_BUCKET_FLOOR, 100) / throttle.restoreRate) * 1_000,
              ) + 500
            : Math.max(2_000, (5 - retries) * 1_500);
        console.warn(
          `[shopifyFetch] THROTTLED on ${shopDomain} — waiting ${waitMs}ms (retries left: ${retries - 1})`,
        );
        await new Promise((r) => setTimeout(r, waitMs));
        return shopifyGraphql(shopDomain, query, variables, {
          ...opts,
          retries: retries - 1,
        });
      }
    }

    // SERVER_ERROR: Shopify 上游服务瞬时故障，短退避重试（复用 5xx 配额）
    const serverError = json.errors.some(
      (e) =>
        typeof e === "object" &&
        e !== null &&
        (e as { extensions?: { code?: string } }).extensions?.code === "SERVER_ERROR",
    );
    if (serverError && retries5xx > 0) {
      const waitMs = Math.min(8_000, 2_000 * (SHOPIFY_5XX_MAX_RETRIES - retries5xx + 1));
      console.warn(
        `[shopifyFetch] SERVER_ERROR on ${shopDomain} — waiting ${waitMs}ms (5xx retries left: ${retries5xx - 1})`,
      );
      await new Promise((r) => setTimeout(r, waitMs));
      return shopifyGraphql(shopDomain, query, variables, {
        ...opts,
        retries5xx: retries5xx - 1,
      });
    }

    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
  }

  // ── Record call + bucket status ─────────────────────────────────────────
  const stat = _getOrInitStats(shopDomain);
  stat.calls++;
  const throttle = json.extensions?.cost?.throttleStatus;
  if (throttle) {
    stat.lastBucketAvailable = throttle.currentlyAvailable;
    stat.lastBucketMax = throttle.maximumAvailable;
  }
  // 喂给自适应并发控制器：桶富余则加并发，紧张则减。
  noteShopifyThrottle(shopDomain, throttle, false);

  // ── Proactive throttle: sleep before the bucket runs dry ─────────────────
  if (throttle && SHOPIFY_BUCKET_FLOOR > 0 && throttle.currentlyAvailable < SHOPIFY_BUCKET_FLOOR) {
    const deficit = SHOPIFY_BUCKET_FLOOR - throttle.currentlyAvailable;
    // restoreRate is points/second; add 200 ms buffer for clock skew
    const waitMs = Math.ceil((deficit / throttle.restoreRate) * 1_000) + 200;
    stat.proactiveWaitMs += waitMs;
    await new Promise((r) => setTimeout(r, waitMs));
  }

  return json.data;
}

function buildResourceQueryFilter(
  module: string,
  updatedAtAfter?: string,
): string | null {
  const base = ID_BASED_MODULE_QUERY[module] ?? "";
  let query = base.trim();

  if (updatedAtAfter) {
    const iso = updatedAtAfter;
    query = query ? `${query} AND updated_at:>'${iso}'` : `updated_at:>'${iso}'`;
  }

  return query || null;
}

export function mapNodeToResource(
  node: TranslatableNode,
  module: string,
  options: FetchTranslatableOptions,
): TranslatableResource | null {
  const translations = node.translations ?? [];

  const fields = node.translatableContent
    .filter((f) =>
      shouldIncludeFieldV2(
        { key: f.key, value: f.value, type: f.type },
        translations,
        {
          module,
          isCover: options.isCover,
          isHandle: options.isHandle,
        },
      ),
    )
    .map((f) => ({
      key: f.key,
      value: f.value,
      digest: f.digest,
      shopifyType: f.type ?? undefined,
    }));

  if (fields.length === 0) return null;
  return { resourceId: node.resourceId, fields };
}

export function resourceChars(r: TranslatableResource): number {
  return r.fields.reduce((sum, f) => sum + (f.value?.length ?? 0), 0);
}

/** UTF-8 byte length of one resource as compact JSON (same encoding as blobWrite). */
export function resourceBlobBytes(r: TranslatableResource): number {
  return Buffer.byteLength(JSON.stringify(r), "utf8");
}

/** Exact UTF-8 byte length of a chunk blob body (same encoding as blobWrite). */
export function chunkBlobBytes(resources: TranslatableResource[]): number {
  return Buffer.byteLength(JSON.stringify(resources), "utf8");
}

/** Default max init chunk file size in bytes (overridable via TRANSLATION_MAX_CHUNK_BYTES). */
export function getMaxChunkBytes(): number {
  return MAX_CHUNK_BYTES;
}

/**
 * Pack resources into chunks capped by serialized JSON file size only
 * (no per-chunk resource-count limit). Each resource is kept whole; a single
 * oversized resource gets its own chunk even if it exceeds the max.
 *
 * `chunkSize` is retained for call-site compatibility and ignored.
 *
 * Size uses the same compact JSON as blobWrite. Per-resource sums plus commas
 * approximate an array; confirm with exact stringify only when near the limit.
 */
export function chunkResources(
  resources: TranslatableResource[],
  _chunkSize?: number,
  maxBytes: number = MAX_CHUNK_BYTES,
): TranslatableResource[][] {
  const chunks: TranslatableResource[][] = [];
  let current: TranslatableResource[] = [];
  let sumResourceBytes = 0;

  for (const r of resources) {
    const rBytes = resourceBlobBytes(r);
    if (current.length > 0) {
      // Compact array ≈ "[" + items.join(",") + "]"
      const estimate = sumResourceBytes + rBytes + current.length + 2;
      if (estimate > maxBytes && chunkBlobBytes(current.concat(r)) > maxBytes) {
        chunks.push(current);
        current = [];
        sumResourceBytes = 0;
      }
    }
    current.push(r);
    sumResourceBytes += rBytes;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** 按 config query 分页拉取资源 GID，最多 limit 条。 */
export async function fetchResourceIdsByQuery(
  shopDomain: string,
  module: string,
  limit: number,
  updatedAtAfter?: string,
  onPage?: () => Promise<void>,
): Promise<string[]> {
  const spec = MODULE_ID_QUERY[module];
  if (!spec) return [];

  const queryFilter = buildResourceQueryFilter(module, updatedAtAfter);
  const ids: string[] = [];
  let after: string | null = null;

  while (ids.length < limit) {
    const pageSize = Math.min(ID_FETCH_PAGE_SIZE, limit - ids.length);
    const variables: Record<string, unknown> = {
      first: pageSize,
      ...(queryFilter ? { query: queryFilter } : {}),
      ...(after ? { after } : {}),
    };

    const data = (await shopifyGraphql(
      shopDomain,
      spec.gql,
      variables,
    )) as Record<
      string,
      {
        edges: Array<{ node: { id: string } }>;
        pageInfo: { hasNextPage: boolean; endCursor: string };
      }
    >;

    const connection = data[spec.connectionKey];
    if (!connection?.edges?.length) break;

    for (const edge of connection.edges) {
      if (edge.node?.id) ids.push(edge.node.id);
      if (ids.length >= limit) break;
    }

    if (onPage) await onPage();
    if (!connection.pageInfo.hasNextPage || ids.length >= limit) break;
    after = connection.pageInfo.endCursor;
  }

  return ids.slice(0, limit);
}

async function fetchTranslatableResourcesByType(
  shopDomain: string,
  module: string,
  shopifyType: string,
  limitPerType: number,
  options: FetchTranslatableOptions,
): Promise<TranslatableResource[]> {
  const allResources: TranslatableResource[] = [];
  let cursor: string | null = null;
  let fetched = 0;

  while (fetched < limitPerType) {
    const remaining = limitPerType - fetched;
    const pageSize = Math.min(FETCH_PAGE_SIZE, remaining === Infinity ? FETCH_PAGE_SIZE : remaining);
    const variables: Record<string, unknown> = {
      resourceType: shopifyType,
      first: pageSize,
      locale: options.targetLocale,
      ...(cursor ? { after: cursor } : {}),
    };

    const data = (await shopifyGraphql(
      shopDomain,
      TRANSLATABLE_RESOURCES_QUERY,
      variables,
    )) as {
      translatableResources: {
        edges: Array<{ node: TranslatableNode }>;
        pageInfo: { hasNextPage: boolean; endCursor: string };
      };
    };

    const edges = data.translatableResources.edges;
    for (const edge of edges) {
      const resource = mapNodeToResource(edge.node, module, options);
      if (resource) allResources.push(resource);
    }

    fetched += edges.length;
    if (options.onPage) await options.onPage();
    if (!data.translatableResources.pageInfo.hasNextPage || edges.length === 0) break;
    cursor = data.translatableResources.pageInfo.endCursor;
  }

  return allResources;
}

async function fetchTranslatableResourcesByIds(
  shopDomain: string,
  module: string,
  resourceIds: string[],
  limitPerType: number,
  options: FetchTranslatableOptions,
): Promise<TranslatableResource[]> {
  const allResources: TranslatableResource[] = [];
  const ids = limitPerType === Number.MAX_SAFE_INTEGER ? resourceIds : resourceIds.slice(0, limitPerType);

  for (let offset = 0; offset < ids.length && allResources.length < limitPerType; offset += TRANSLATABLE_RESOURCES_BY_IDS_BATCH) {
    const batch = ids.slice(offset, offset + TRANSLATABLE_RESOURCES_BY_IDS_BATCH);
    let after: string | null = null;

    while (allResources.length < limitPerType) {
      const variables: Record<string, unknown> = {
        resourceIds: batch,
        first: TRANSLATABLE_RESOURCES_BY_IDS_BATCH,
        locale: options.targetLocale,
        ...(after ? { after } : {}),
      };

      const data = (await shopifyGraphql(
        shopDomain,
        TRANSLATABLE_RESOURCES_BY_IDS_QUERY,
        variables,
      )) as {
        translatableResourcesByIds: {
          nodes: TranslatableNode[];
          pageInfo: { hasNextPage: boolean; endCursor: string };
        };
      };

      const nodes = data.translatableResourcesByIds.nodes ?? [];
      for (const node of nodes) {
        if (allResources.length >= limitPerType) break;
        const resource = mapNodeToResource(node, module, options);
        if (resource) allResources.push(resource);
      }

      if (options.onPage) await options.onPage();
      if (
        !data.translatableResourcesByIds.pageInfo.hasNextPage ||
        nodes.length === 0 ||
        allResources.length >= limitPerType
      ) {
        break;
      }
      after = data.translatableResourcesByIds.pageInfo.endCursor;
    }
  }

  return limitPerType === Number.MAX_SAFE_INTEGER ? allResources : allResources.slice(0, limitPerType);
}

/** Fetch translatable resources for a module, filtered by isCover/isHandle rules. Returns chunked arrays. */
export async function fetchTranslatableResources(
  shopDomain: string,
  module: string,
  limitPerType: number,
  chunkSize: number,
  options: FetchTranslatableOptions,
  updatedAtAfter?: string,
): Promise<TranslatableResource[][]> {
  const shopifyType = MODULE_TO_SHOPIFY_TYPE[module];
  if (!shopifyType) {
    console.warn(`[shopifyFetch] unsupported module: ${module}`);
    return [];
  }

  let allResources: TranslatableResource[];

  if ((ID_BASED_MODULES as readonly string[]).includes(module)) {
    const resourceIds =
      options.resourceIds && options.resourceIds.length > 0
        ? options.resourceIds
        : await fetchResourceIdsByQuery(
            shopDomain,
            module,
            limitPerType,
            updatedAtAfter,
            options.onPage,
          );
    if (resourceIds.length === 0) return [];

    allResources = await fetchTranslatableResourcesByIds(
      shopDomain,
      module,
      resourceIds,
      limitPerType,
      options,
    );
  } else {
    allResources = await fetchTranslatableResourcesByType(
      shopDomain,
      module,
      shopifyType,
      limitPerType,
      options,
    );
  }

  return chunkResources(allResources, chunkSize);
}

export type TranslationInput = {
  key: string;
  value: string;
  translatableContentDigest: string;
  locale: string;
};

export type TranslationRegisterResult = {
  success: boolean;
  userErrors: Array<{ field: string; message: string }>;
  registeredKeys: string[];
};

/** Normalize values before comparing writeback vs read-back. */
export function translationValuesMatch(expected: string, actual: string): boolean {
  return expected.trim() === actual.trim();
}

async function registerTranslationsBatch(
  shopDomain: string,
  resourceId: string,
  translations: TranslationInput[],
): Promise<TranslationRegisterResult> {
  const data = (await shopifyGraphql(
    shopDomain,
    TRANSLATIONS_REGISTER_MUTATION,
    { resourceId, translations },
  )) as {
    translationsRegister: {
      translations: Array<{ key: string; value: string }>;
      userErrors: Array<{ field: string; message: string }>;
    };
  };
  const userErrors = data.translationsRegister.userErrors ?? [];
  const registeredKeys = (data.translationsRegister.translations ?? []).map((t) => t.key);
  return {
    success: userErrors.length === 0,
    userErrors,
    registeredKeys,
  };
}

const LOG_BATCH = "[writeback-batch]";

function isTooManyTranslationKeysError(
  userErrors: Array<{ field: string; message: string }>,
): boolean {
  return userErrors.some((err) => isTooManyTranslationKeysMessage(err.message));
}

function mergeTranslationRegisterResults(
  left: TranslationRegisterResult,
  right: TranslationRegisterResult,
): TranslationRegisterResult {
  return {
    success: left.success && right.success,
    userErrors: [...left.userErrors, ...right.userErrors],
    registeredKeys: [...left.registeredKeys, ...right.registeredKeys],
  };
}

/**
 * Register one chunk; on Shopify "Too many translation keys", bisect and retry
 * until batch size reaches 1.
 */
async function registerTranslationsChunkWithSplit(
  shopDomain: string,
  resourceId: string,
  translations: TranslationInput[],
): Promise<TranslationRegisterResult> {
  if (translations.length === 0) {
    return { success: true, userErrors: [], registeredKeys: [] };
  }

  const result = await registerTranslationsBatch(
    shopDomain,
    resourceId,
    translations,
  );

  if (result.success) return result;

  const canSplit =
    translations.length > 1 && isTooManyTranslationKeysError(result.userErrors);
  if (!canSplit) return result;

  const mid = Math.ceil(translations.length / 2);
  console.warn(
    `${LOG_BATCH} too many keys resource=${resourceId} split ${translations.length} → ${mid}+${translations.length - mid}`,
  );

  const left = await registerTranslationsChunkWithSplit(
    shopDomain,
    resourceId,
    translations.slice(0, mid),
  );
  const right = await registerTranslationsChunkWithSplit(
    shopDomain,
    resourceId,
    translations.slice(mid),
  );
  return mergeTranslationRegisterResults(left, right);
}

/**
 * Write translations back to a single Shopify resource.
 * Same resourceId accepts multiple fields in one mutation; large field lists are chunked.
 */
export async function registerTranslations(
  shopDomain: string,
  resourceId: string,
  translations: TranslationInput[],
): Promise<TranslationRegisterResult> {
  if (translations.length === 0) {
    return { success: true, userErrors: [], registeredKeys: [] };
  }

  const allErrors: Array<{ field: string; message: string }> = [];
  const allRegisteredKeys: string[] = [];

  try {
    for (let i = 0; i < translations.length; i += WRITEBACK_TRANSLATIONS_BATCH) {
      const batch = translations.slice(i, i + WRITEBACK_TRANSLATIONS_BATCH);
      const result = await registerTranslationsChunkWithSplit(
        shopDomain,
        resourceId,
        batch,
      );
      allErrors.push(...result.userErrors);
      allRegisteredKeys.push(...result.registeredKeys);
      if (!result.success) break;
    }

    const expectedKeys = new Set(translations.map((t) => t.key));
    const missingInResponse = [...expectedKeys].filter((k) => !allRegisteredKeys.includes(k));

    return {
      success: allErrors.length === 0 && missingInResponse.length === 0,
      userErrors:
        allErrors.length > 0
          ? allErrors
          : missingInResponse.length > 0
            ? [{
                field: "translations",
                message: `translationsRegister returned no rows for keys: ${missingInResponse.join(", ")}`,
              }]
            : [],
      registeredKeys: allRegisteredKeys,
    };
  } catch (e) {
    return {
      success: false,
      userErrors: [{ field: "", message: String(e) }],
      registeredKeys: allRegisteredKeys,
    };
  }
}

export type StoredTranslation = {
  key: string;
  value: string;
  outdated: boolean;
};

/** Read back translations already stored on Shopify for one resource + locale. */
export async function fetchResourceTranslations(
  shopDomain: string,
  resourceId: string,
  locale: string,
): Promise<StoredTranslation[]> {
  const data = (await shopifyGraphql(
    shopDomain,
    TRANSLATABLE_RESOURCE_BY_ID_QUERY,
    { resourceId, locale },
  )) as {
    translatableResource: {
      translations: Array<{ key: string; value: string; outdated?: boolean | null }>;
    } | null;
  };

  const rows = data.translatableResource?.translations ?? [];
  return rows.map((row) => ({
    key: row.key,
    value: row.value ?? "",
    outdated: Boolean(row.outdated),
  }));
}

export type TranslationMismatch = {
  key: string;
  expected: string;
  actual: string;
  outdated?: boolean;
};

const SHOP_PRIMARY_LOCALE_QUERY = `#graphql
  query WorkerShopPrimaryLocale {
    shopLocales {
      locale
      primary
    }
  }
`;

/** 读取店铺当前默认语言（Shopify 实时为准）。 */
export async function fetchShopPrimaryLocale(
  shopDomain: string,
): Promise<string | null> {
  const payload = (await shopifyGraphql(
    shopDomain,
    SHOP_PRIMARY_LOCALE_QUERY,
    {},
  )) as {
    data?: { shopLocales?: Array<{ locale: string; primary: boolean }> | null };
  };
  const rows = payload?.data?.shopLocales ?? [];
  return rows.find((r) => r.primary)?.locale?.trim() ?? null;
}

/** Compare expected writeback payload against Shopify read-back. */
export function diffResourceTranslations(
  expected: TranslationInput[],
  stored: StoredTranslation[],
): TranslationMismatch[] {
  const storedByKey = new Map(stored.map((row) => [row.key, row]));
  const mismatches: TranslationMismatch[] = [];

  for (const exp of expected) {
    const row = storedByKey.get(exp.key);
    if (!row) {
      mismatches.push({ key: exp.key, expected: exp.value, actual: "(missing)" });
      continue;
    }
    if (row.outdated) {
      mismatches.push({
        key: exp.key,
        expected: exp.value,
        actual: row.value,
        outdated: true,
      });
      continue;
    }
    if (!translationValuesMatch(exp.value, row.value)) {
      mismatches.push({ key: exp.key, expected: exp.value, actual: row.value });
    }
  }

  return mismatches;
}

/** @internal Vitest 用：构建 ID 模块 query filter */
export function buildInitModuleQueryFilterForTest(
  module: string,
  updatedAtAfter?: string,
): string | null {
  return buildResourceQueryFilter(module, updatedAtAfter);
}

/** @internal Vitest 用：判断是否 ID 模块 */
export function isIdBasedModuleForTest(module: string): boolean {
  return (ID_BASED_MODULES as readonly string[]).includes(module);
}

/** @internal Vitest 用：size-aware chunk 切分（按 Blob 字节，忽略 resource count） */
export function chunkResourcesForTest(
  resources: TranslatableResource[],
  chunkSize?: number,
  maxBytes?: number,
): TranslatableResource[][] {
  return chunkResources(resources, chunkSize, maxBytes);
}
