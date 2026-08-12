// storage.js
/**
 * 简单 localStorage TTL 封装
 */

export function setWithTTL(key, value, ttlMs = 1000 * 60 * 60) {
  if (!value?.success) return;
  const payload = { ts: Date.now(), ttl: ttlMs, data: value };
  try {
    localStorage.setItem(key, JSON.stringify(payload));
  } catch (e) {
    console.warn("setWithTTL failed", e);
  }
}

export function getWithTTL(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    if (Date.now() - obj.ts > (obj.ttl || 0)) {
      localStorage.removeItem(key);
      return null;
    }
    return obj.data;
  } catch (e) {
    console.warn("getWithTTL failed", e);
    return null;
  }
}

/** 空数组或空对象（LiquidMap {}）视为可负缓存的空响应。 */
function isEmptyCacheableResponse(data) {
  const response = data?.response;
  if (Array.isArray(response)) return response.length === 0;
  if (response && typeof response === "object") {
    return Object.keys(response).length === 0;
  }
  return false;
}

/**
 * useCacheThenRefresh:
 *  - 如果没有缓存 => await fetcher() 并保存，返回 fresh（与原第一次调用逻辑一致）
 *  - 如果有缓存 => 立即返回缓存，并在后台执行 fetcher() 来刷新缓存（这就保留了你说的“最多两次”的调用语义）
 *
 * @param {string} key
 * @param {() => Promise<any>} fetcher
 * @param {number} ttlMs
 * @param {object} [options]
 * @param {boolean} [options.refreshOnCacheHit=true] 命中缓存时是否后台刷新
 * @param {boolean} [options.refetchWhenCachedEmpty=false] 缓存为空数组时前台重拉
 * @param {boolean} [options.skipRefreshWhenEmpty=false] 缓存为空时跳过后台刷新（负缓存降 QPS）
 * @param {number} [options.emptyTtlMs] 空结果使用更短 TTL（默认与 ttlMs 相同）
 */
export async function useCacheThenRefresh(
  key,
  fetcher,
  ttlMs = 1000 * 60 * 60,
  options = {},
) {
  const {
    refreshOnCacheHit = true,
    refetchWhenCachedEmpty = false,
    skipRefreshWhenEmpty = false,
    emptyTtlMs,
  } = options;

  const ttlFor = (data) => {
    if (
      emptyTtlMs != null &&
      emptyTtlMs > 0 &&
      isEmptyCacheableResponse(data)
    ) {
      return emptyTtlMs;
    }
    return ttlMs;
  };

  const cached = getWithTTL(key);
  if (!cached) {
    const fresh = await fetcher();
    if (fresh !== null && fresh !== undefined) {
      setWithTTL(key, fresh, ttlFor(fresh));
    }
    return fresh;
  }

  const cachedResponse = cached?.response;
  const isCachedEmptyArray =
    Array.isArray(cachedResponse) && cachedResponse.length === 0;

  if (refetchWhenCachedEmpty && isCachedEmptyArray) {
    const fresh = await fetcher();
    if (fresh !== null && fresh !== undefined) {
      setWithTTL(key, fresh, ttlFor(fresh));
    }
    return fresh;
  }

  const cachedEmpty = isEmptyCacheableResponse(cached);
  if (refreshOnCacheHit && !(skipRefreshWhenEmpty && cachedEmpty)) {
    Promise.resolve()
      .then(fetcher)
      .then((fresh) => {
        if (fresh !== null && fresh !== undefined) {
          setWithTTL(key, fresh, ttlFor(fresh));
        }
      })
      .catch((error) => {
        console.warn(`useCacheThenRefresh background refresh failed for ${key}`, error);
      });
  }

  return cached;
}
