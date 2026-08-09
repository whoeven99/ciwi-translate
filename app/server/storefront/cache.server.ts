import { createHash } from "node:crypto";
import { getTranslateV4RedisClient } from "~/server/translateV4/redis.server";
import type { BaseResponse } from "./response.server";

/**
 * 店面 App Proxy 读路径的 Redis 缓存。
 *
 * 背景：storefront 的 switcher / currency / liquid / picture 读取原本每个访客请求
 * 都直查 Turso，流量突发时 Turso 网关返回 502（见 libsqlFetch.server.ts）。
 * 这些数据都是「商户改了才变、访客读爆了」的配置型数据，适合短 TTL 缓存。
 *
 * 只用于 storefront 读路径。admin 页面仍直查库，避免商户看到自己刚改的旧值。
 *
 * 失效采用 per-(kind, shop) 版本号：失效只需 INCR 一次，旧 key 自然不再被拼出，
 * 由 TTL 回收。生产环境不允许用 KEYS/SCAN 去批量删 key。
 */

export type StorefrontCacheKind = "switcher" | "currency" | "liquid" | "picture";

const KEY_PREFIX = "tsf:sf";
const TTL_SECONDS = 300;
/** 版本号必须比数据 TTL 活得久，否则版本回绕可能命中残留 key。 */
const VERSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_KEY_PART_LENGTH = 96;

function tryGetRedis() {
  try {
    return getTranslateV4RedisClient();
  } catch (err) {
    console.warn("[sf-cache] Redis 不可用，回源直查:", err);
    return null;
  }
}

/** imageId 之类的外部输入可能很长，超限则用摘要，保证 key 长度可控。 */
function normalizeKeyPart(part: string): string {
  const safe = part.replace(/\s+/g, "_");
  if (safe.length <= MAX_KEY_PART_LENGTH) return safe;
  return createHash("sha1").update(safe).digest("base64url");
}

function versionKey(kind: StorefrontCacheKind, shop: string): string {
  return `${KEY_PREFIX}:ver:${kind}:${shop}`;
}

function dataKey(
  kind: StorefrontCacheKind,
  shop: string,
  version: string,
  extra: string[],
): string {
  const tail = extra.map(normalizeKeyPart).join(":");
  const base = `${KEY_PREFIX}:${kind}:${shop}:v${version}`;
  return tail ? `${base}:${tail}` : base;
}

/**
 * 读缓存，miss 时回源并写回。只缓存 `success: true` 的结果。
 * Redis 任何异常都静默降级为直查库；`load()` 自身的异常照常抛出。
 */
export async function readThroughStorefrontCache<T>(
  kind: StorefrontCacheKind,
  shop: string,
  extra: string[],
  load: () => Promise<BaseResponse<T>>,
): Promise<BaseResponse<T>> {
  const redis = tryGetRedis();
  if (!redis) return load();

  let key: string | null = null;
  try {
    const version = (await redis.get(versionKey(kind, shop))) ?? "0";
    key = dataKey(kind, shop, version, extra);
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached) as BaseResponse<T>;
  } catch (err) {
    console.warn(`[sf-cache] 读失败 kind=${kind} shop=${shop}:`, err);
    return load();
  }

  const result = await load();
  if (result.success) {
    try {
      await redis.set(key, JSON.stringify(result), "EX", TTL_SECONDS);
    } catch (err) {
      console.warn(`[sf-cache] 写失败 kind=${kind} shop=${shop}:`, err);
    }
  }
  return result;
}

/**
 * 商户在 admin 改动后主动失效，让店面立即拿到新值（不必等 TTL）。
 * 失败只记日志：TTL 仍会在 5 分钟内收敛。
 */
export async function invalidateStorefrontCache(
  kind: StorefrontCacheKind,
  shop: string,
): Promise<void> {
  const redis = tryGetRedis();
  if (!redis) return;
  const key = versionKey(kind, shop);
  try {
    // sole RENDER_KV：原生 ioredis 有 incr；不必走 pipeline（双写代理也从未支持 incr）。
    await redis.incr(key);
    await redis.expire(key, VERSION_TTL_SECONDS);
  } catch (err) {
    console.warn(`[sf-cache] 失效失败 kind=${kind} shop=${shop}:`, err);
  }
}
