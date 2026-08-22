// storage.js
/**
 * 简单 localStorage TTL 封装
 */

const CIWI_STORAGE_PREFIX = "ciwi:v2";

function normalizeStorageScope(scope) {
  return String(scope || "")
    .trim()
    .toLowerCase();
}

function resolveStorageKey(key, scope) {
  const normalizedScope = normalizeStorageScope(scope);
  if (!normalizedScope) return key;
  return `${CIWI_STORAGE_PREFIX}:${normalizedScope}:${key}`;
}

function getLocalStorage() {
  if (typeof localStorage === "undefined") return null;
  return localStorage;
}

export function getStorageItem(key, options = {}) {
  const storage = getLocalStorage();
  if (!storage) return null;

  const { scope, legacyKeys = [] } = options;
  const scopedKey = resolveStorageKey(key, scope);

  try {
    const scopedValue = storage.getItem(scopedKey);
    if (scopedValue != null) {
      return scopedValue;
    }

    const keysToMigrate = Array.from(new Set([key, ...legacyKeys]));
    for (const legacyKey of keysToMigrate) {
      const legacyValue = storage.getItem(legacyKey);
      if (legacyValue == null) continue;
      try {
        storage.setItem(scopedKey, legacyValue);
      } catch {}
      return legacyValue;
    }
  } catch (e) {
    console.warn("getStorageItem failed", e);
  }

  return null;
}

export function setStorageItem(key, value, options = {}) {
  const storage = getLocalStorage();
  if (!storage) return;

  try {
    storage.setItem(resolveStorageKey(key, options.scope), value);
  } catch (e) {
    console.warn("setStorageItem failed", e);
  }
}

export function removeStorageItem(key, options = {}) {
  const storage = getLocalStorage();
  if (!storage) return;

  const { scope, legacyKeys = [] } = options;

  try {
    storage.removeItem(resolveStorageKey(key, scope));
    Array.from(new Set(legacyKeys)).forEach((legacyKey) => {
      storage.removeItem(legacyKey);
    });
  } catch (e) {
    console.warn("removeStorageItem failed", e);
  }
}

export function setWithTTL(key, value, ttlMs = 1000 * 60 * 60, options = {}) {
  if (!value?.success) return;
  const payload = { ts: Date.now(), ttl: ttlMs, data: value };
  try {
    setStorageItem(key, JSON.stringify(payload), options);
  } catch (e) {
    console.warn("setWithTTL failed", e);
  }
}

export function getWithTTL(key, options = {}) {
  try {
    const raw = getStorageItem(key, options);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    if (Date.now() - obj.ts > (obj.ttl || 0)) {
      removeStorageItem(key, options);
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
    storageScope,
    legacyKeys = [],
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

  const storageOptions = { scope: storageScope, legacyKeys };
  const cached = getWithTTL(key, storageOptions);
  if (!cached) {
    const fresh = await fetcher();
    if (fresh !== null && fresh !== undefined) {
      setWithTTL(key, fresh, ttlFor(fresh), storageOptions);
    }
    return fresh;
  }

  const cachedResponse = cached?.response;
  const isCachedEmptyArray =
    Array.isArray(cachedResponse) && cachedResponse.length === 0;

  if (refetchWhenCachedEmpty && isCachedEmptyArray) {
    const fresh = await fetcher();
    if (fresh !== null && fresh !== undefined) {
      setWithTTL(key, fresh, ttlFor(fresh), storageOptions);
    }
    return fresh;
  }

  const cachedEmpty = isEmptyCacheableResponse(cached);
  if (refreshOnCacheHit && !(skipRefreshWhenEmpty && cachedEmpty)) {
    Promise.resolve()
      .then(fetcher)
      .then((fresh) => {
        if (fresh !== null && fresh !== undefined) {
          setWithTTL(key, fresh, ttlFor(fresh), storageOptions);
        }
      })
      .catch((error) => {
        console.warn(`useCacheThenRefresh background refresh failed for ${key}`, error);
      });
  }

  return cached;
}
