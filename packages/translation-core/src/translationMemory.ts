import { getTranslationCoreRedis as getRedis } from "./runtime.js";

/**
 * Translation Memory (TM) — a Redis-backed cache of past translations.
 *
 * Two tiers:
 * 1. Field digest TM (`tmGet` / `tmSet`): keyed by Shopify field digest, scoped
 *    per shop. Used for plain fields only (HTML/JSON/list skip this tier and
 *    cache leaf texts via the value TM instead).
 * 2. Value TM (`tmGetByValue` / `tmSetByValue`): keyed by source/target/model +
 *    (Shopify digest if present, else CRC-32 of the source text). Cross-shop
 *    reuse for identical leaf strings.
 *
 * Key id rule (VALUE_CACHE_THRESHOLD = 200 documents the product split):
 * - Prefer Shopify field digest when present (any length).
 * - Otherwise CRC-32 (8 hex chars) of the source text.
 *
 * TRANSLATION_TM_DISABLED=true: bypass cache reads (refresh / rebuild TM after
 * logic fixes) but still write successful translations back to Redis.
 * false (default): normal read + write.
 */

// Bump this when translation logic/prompt changes so stale cache is abandoned.
// v5: source language auto-detected (prompt no longer hardcodes source).
const TM_PREFIX = "tm:v5";
const DEFAULT_TTL_DAYS = 30;
// Values larger than this are almost always unique (long HTML), so caching them
// burns Redis memory for near-zero hit rate. Skip them.
const MAX_VALUE_BYTES = 8000;

/** Product rule threshold (chars): long vs short plain; both use digest ?? CRC-32. */
export const VALUE_CACHE_THRESHOLD = 200;

// Keys per MGET round-trip. Bounds the response payload for stores whose chunks
// expand into thousands of unique leaf texts.
const MGET_BATCH_SIZE = 500;

function ttlSeconds(): number {
  const days = Number(process.env.TRANSLATION_TM_TTL_DAYS?.trim() || DEFAULT_TTL_DAYS);
  return (Number.isFinite(days) && days > 0 ? days : DEFAULT_TTL_DAYS) * 24 * 3600;
}

function isReadDisabled(): boolean {
  return process.env.TRANSLATION_TM_DISABLED === "true";
}

export function tmKey(shopName: string, target: string, model: string, digest: string): string {
  return `${TM_PREFIX}:${shopName}:${target}:${model}:${digest}`;
}

/**
 * Read many keys in MGET batches, keeping the result aligned with `keys`.
 * Null entries in `keys` are skipped (they resolve to null). A failing batch
 * degrades to null for that batch rather than throwing — TM is best-effort.
 */
async function mgetAligned(keys: Array<string | null>): Promise<(string | null)[]> {
  const out: (string | null)[] = keys.map(() => null);
  const wanted: Array<{ key: string; at: number }> = [];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (key) wanted.push({ key, at: i });
  }
  if (wanted.length === 0) return out;

  const redis = getRedis();
  for (let start = 0; start < wanted.length; start += MGET_BATCH_SIZE) {
    const slice = wanted.slice(start, start + MGET_BATCH_SIZE);
    try {
      const values = await redis.mget(slice.map((w) => w.key));
      for (let i = 0; i < slice.length; i++) {
        out[slice[i]!.at] = values[i] ?? null;
      }
    } catch {
      // best-effort: leave this batch as misses
    }
  }
  return out;
}

/** Returns the cached translation for a field digest, or null on miss/disabled/error. */
export async function tmGet(
  shopName: string,
  target: string,
  model: string,
  digest: string,
): Promise<string | null> {
  if (isReadDisabled() || !digest) return null;
  try {
    return await getRedis().get(tmKey(shopName, target, model, digest));
  } catch {
    return null;
  }
}

/**
 * Batch variant of `tmGet`. Each entry carries its own model because the cache
 * model is resolved per field (engine order depends on the field tier). Entries
 * with a falsy digest resolve to null without hitting Redis. Result aligns with
 * `items` by index.
 */
export async function tmMGet(
  shopName: string,
  target: string,
  items: Array<{ model: string; digest?: string | null }>,
): Promise<(string | null)[]> {
  if (isReadDisabled()) return items.map(() => null);
  return mgetAligned(
    items.map((it) =>
      it.digest ? tmKey(shopName, target, it.model, it.digest) : null,
    ),
  );
}

/** Stores a translation keyed by field digest. Best-effort; never throws. */
export async function tmSet(
  shopName: string,
  target: string,
  model: string,
  digest: string,
  value: string,
): Promise<void> {
  if (!digest || !value) return;
  if (Buffer.byteLength(value, "utf8") > MAX_VALUE_BYTES) return;
  try {
    await getRedis().set(tmKey(shopName, target, model, digest), value, "EX", ttlSeconds());
  } catch {
    // best-effort
  }
}

// ─── Value-based secondary TM cache ──────────────────────────────────────────
//
// Key id: Shopify field digest when present; otherwise CRC-32 (8 hex chars) of
// the source text. Full Redis key always includes source/target/model.
// HTML/JSON/list never use field-digest TM — only leaf texts via this tier.

const VALUE_TM_PREFIX = "tm:v5:val";

/** IEEE CRC-32 → 8-char lowercase hex (no deps). */
export function crc32Hex(text: string): string {
  let crc = 0xffffffff;
  const buf = Buffer.from(text, "utf8");
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]!;
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
}

/**
 * Prefer Shopify digest; otherwise CRC-32.
 * Long (>VALUE_CACHE_THRESHOLD) and short follow the same digest ?? CRC-32 rule.
 */
export function valueCacheKeyId(sourceText: string, digest?: string): string {
  const d = digest?.trim();
  if (d) return d;
  return crc32Hex(sourceText);
}

export function valueCacheKey(
  sourceText: string,
  source: string,
  target: string,
  model: string,
  digest?: string,
): string {
  return `${VALUE_TM_PREFIX}:${source}:${target}:${model}:${valueCacheKeyId(sourceText, digest)}`;
}

/**
 * Look up a translation by value-cache key (digest if present, else CRC-32).
 * Returns null on miss, disabled, or error.
 */
export async function tmGetByValue(
  sourceText: string,
  source: string,
  target: string,
  model: string,
  digest?: string,
): Promise<string | null> {
  if (isReadDisabled() || !sourceText) return null;
  try {
    return await getRedis().get(valueCacheKey(sourceText, source, target, model, digest));
  } catch {
    return null;
  }
}

/**
 * Batch variant of `tmGetByValue`. Each entry carries its own model for the same
 * reason as `tmMGet`. Result aligns with `items` by index; entries with an empty
 * `sourceText` resolve to null without hitting Redis.
 */
export async function tmMGetByValue(
  items: Array<{ sourceText: string; model: string; digest?: string }>,
  source: string,
  target: string,
): Promise<(string | null)[]> {
  if (isReadDisabled()) return items.map(() => null);
  return mgetAligned(
    items.map((it) =>
      it.sourceText
        ? valueCacheKey(it.sourceText, source, target, it.model, it.digest)
        : null,
    ),
  );
}

/**
 * Store a translation in the value TM. Best-effort; never throws.
 * Oversized payloads are skipped to protect Redis memory.
 */
export async function tmSetByValue(
  sourceText: string,
  source: string,
  target: string,
  model: string,
  translatedText: string,
  digest?: string,
): Promise<void> {
  if (!sourceText || !translatedText) return;
  if (Buffer.byteLength(translatedText, "utf8") > MAX_VALUE_BYTES) return;
  try {
    const key = valueCacheKey(sourceText, source, target, model, digest);
    await getRedis().set(key, translatedText, "EX", ttlSeconds());
  } catch {
    // best-effort
  }
}
