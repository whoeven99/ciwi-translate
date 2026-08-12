/**
 * remix-serve 在加载应用后会调用 installGlobals()，用 @remix-run/web-fetch 覆盖 global.fetch。
 * @libsql/client 在首次查询时创建 HTTP 客户端并读取当时的 global.fetch，导致 Turso 请求报 Invalid URL。
 * 在模块加载时捕获原生 fetch，并把 libsql 传入的 Request 对象转成 URL 字符串再请求。
 */

/**
 * Turso 网关在容量紧张时用这些状态码拒绝请求，Prisma 会把它们包成
 * `transient: false` 直接抛给调用方（店面 App Proxy 因此冒 500）。
 *
 * 只对「看起来像只读 SQL」的请求重试：写入若已在网关后执行、响应却丢失，
 * 重试会重复扣费 / 写账 / 改状态。Hrana body 里出现 mutation 关键字则不重试。
 */
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const MAX_RETRY_ATTEMPTS = 2;

/** 任一命中即视为不可安全重放（含事务边界）。 */
const MUTATION_SQL_RE =
  /\b(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE|TRUNCATE|ATTACH|DETACH|VACUUM|REINDEX|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i;

/** 至少要像读查询，才允许对 5xx/429 重试。 */
const READISH_SQL_RE = /\b(SELECT|WITH|PRAGMA|EXPLAIN)\b/i;

function retryDelayMs(attempt: number): number {
  return 100 * 2 ** attempt + Math.floor(Math.random() * 100);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 只有能被再次发送的 body 才允许重试；stream 读一次就没了。 */
function isReplayableBody(body: BodyInit | null | undefined): boolean {
  if (body == null) return true;
  return (
    typeof body === "string" ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    body instanceof URLSearchParams
  );
}

function decodeBodyText(body: BodyInit | ArrayBuffer | null | undefined): string | null {
  if (body == null) return "";
  if (typeof body === "string") return body;
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  if (ArrayBuffer.isView(body)) {
    return new TextDecoder().decode(body as ArrayBufferView);
  }
  if (body instanceof URLSearchParams) return body.toString();
  return null;
}

/**
 * Hrana/LibSQL HTTP body 是 JSON，SQL 嵌在字段里。
 * 宁可漏重试，也不对疑似写/事务请求自动重放。
 */
export function isRetrySafeLibsqlBody(body: BodyInit | ArrayBuffer | null | undefined): boolean {
  const text = decodeBodyText(body);
  if (text == null) return false;
  if (!text) return true;
  if (MUTATION_SQL_RE.test(text)) return false;
  return READISH_SQL_RE.test(text);
}

async function fetchWithRetry(
  baseFetch: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  retrySafe: boolean,
): Promise<Response> {
  const replayable = isReplayableBody(init?.body);

  for (let attempt = 0; ; attempt++) {
    const response = await baseFetch(input, init);
    if (!RETRYABLE_STATUS.has(response.status)) return response;
    if (!retrySafe || !replayable || attempt >= MAX_RETRY_ATTEMPTS) return response;

    // 放弃这次的响应体，避免连接悬挂
    try {
      await response.body?.cancel();
    } catch {
      // ignore
    }
    console.warn(
      `[Turso] HTTP ${response.status}，第 ${attempt + 1}/${MAX_RETRY_ATTEMPTS} 次重试`,
    );
    await sleep(retryDelayMs(attempt));
  }
}

export function createLibsqlFetch(baseFetch: typeof fetch = globalThis.fetch): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    if (input instanceof Request) {
      // 缓冲成 ArrayBuffer 才能重放；原先直接转发 input.body（stream）无法重试。
      const body = input.body ? await input.arrayBuffer() : undefined;
      const retrySafe = isRetrySafeLibsqlBody(body);
      return fetchWithRetry(
        baseFetch,
        input.url,
        {
          method: input.method,
          headers: input.headers,
          body,
        },
        retrySafe,
      );
    }
    const retrySafe = isRetrySafeLibsqlBody(init?.body ?? null);
    return fetchWithRetry(baseFetch, input, init, retrySafe);
  };
}

/** 应用启动最早阶段捕获，早于 remix-serve 的 installGlobals()。 */
export const libsqlFetch = createLibsqlFetch();
