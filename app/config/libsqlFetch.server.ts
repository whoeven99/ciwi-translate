/**
 * remix-serve 在加载应用后会调用 installGlobals()，用 @remix-run/web-fetch 覆盖 global.fetch。
 * @libsql/client 在首次查询时创建 HTTP 客户端并读取当时的 global.fetch，导致 Turso 请求报 Invalid URL。
 * 在模块加载时捕获原生 fetch，并把 libsql 传入的 Request 对象转成 URL 字符串再请求。
 */

/**
 * Turso 网关在容量紧张时用这些状态码拒绝请求，Prisma 会把它们包成
 * `transient: false` 直接抛给调用方（店面 App Proxy 因此冒 500）。
 * 重试的前提是请求尚未被 sqld 执行；若响应是在写入之后丢失的，重试会重复执行该写入。
 */
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const MAX_RETRY_ATTEMPTS = 2;

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

async function fetchWithRetry(
  baseFetch: typeof fetch,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const replayable = isReplayableBody(init?.body);

  for (let attempt = 0; ; attempt++) {
    const response = await baseFetch(input, init);
    if (!RETRYABLE_STATUS.has(response.status)) return response;
    if (!replayable || attempt >= MAX_RETRY_ATTEMPTS) return response;

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
      return fetchWithRetry(baseFetch, input.url, {
        method: input.method,
        headers: input.headers,
        body,
      });
    }
    return fetchWithRetry(baseFetch, input, init);
  };
}

/** 应用启动最早阶段捕获，早于 remix-serve 的 installGlobals()。 */
export const libsqlFetch = createLibsqlFetch();
