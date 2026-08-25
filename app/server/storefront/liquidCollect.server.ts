import { looksLikeHtmlMarkupFragment, translationRuleJudgment } from "@ciwi/translation-core/translation-filter";
import prisma from "~/db.server";
import { getOfflineSessionAccessToken } from "~/server/shop/offlineSessionToken.server";
import { resolveShopPrimaryLocale } from "~/server/translateV4/shopLocales.server";
import { getTranslateV4RedisClient } from "~/server/translateV4/redis.server";
import { liquidSourceDigest } from "~/server/translateV4/liquidDigest.server";

/**
 * 店面自动抓取：switcher 把页面上未翻译的第三方文本回传，
 * 服务端过滤 / 去重 / 背压后只写入 LiquidRule(status=PENDING, source=auto)。
 * 真正翻译走 v4 任务勾选「自定义 Liquid」→ Worker CUSTOM_LIQUID 管线。
 */

const MAX_TEXT_LEN = 200;
const MIN_TEXT_LEN = 2;
/** 单次请求最多新插入多少条 PENDING（与店面 AUTO_LIQUID_POST_CHUNK 对齐）。 */
const MAX_PER_REQUEST = 100;
/**
 * 每店每日新增 PENDING 上限（跨实例，Redis 计数）。
 * 默认 0 = 不限日帽；需要背压时设 AUTO_LIQUID_DAILY_CAP=100 等。
 * 总量仍受 AUTO_LIQUID_TOTAL_CAP 约束。
 */
const DAILY_CAP = Number(process.env.AUTO_LIQUID_DAILY_CAP || 0);
const DAILY_CAP_TTL_SEC = 60 * 60 * 25;
/** 每店 auto 行总量上限（含 PENDING/DONE）；到顶停止新增。 */
const TOTAL_CAP = Number(process.env.AUTO_LIQUID_TOTAL_CAP || 50_000);
const PRIMARY_LOCALE_TTL_SEC = 60 * 60;
/**
 * Redis 已知指纹集 TTL（安全网）：集合是 Turso PENDING 的镜像，
 * writeback 转 DONE 时由 Worker 立即 SREM；TTL 仅用于自愈漂移（如保留清理删行）。
 */
const KNOWN_TTL_SEC = 30 * 24 * 60 * 60;
/** 总量计数缓存 TTL：过期后从 Turso 重新播种，纠正漂移。 */
const TOTAL_CACHE_TTL_SEC = 6 * 60 * 60;
/** 批级冷却：同一批文案短时内重复上报直接跳过。 */
const SEEN_BATCH_TTL_SEC = 5 * 60;

/** 已知指纹集 = 该店该语「Turso 中非 DONE（PENDING/TRANSLATING）」原文指纹镜像。 */
function knownDigestKey(shop: string, locale: string): string {
  return `tsf:auto_liquid:known:${shop}:${locale}`;
}
/** 每店 auto 行总量计数缓存（替代每请求 COUNT）。 */
function totalCountKey(shop: string): string {
  return `tsf:auto_liquid:total:${shop}`;
}
/** 批级冷却键（按候选集合指纹）。 */
function seenBatchKey(shop: string, locale: string, batchDigest: string): string {
  return `tsf:auto_liquid:seen:${shop}:${locale}:${batchDigest}`;
}

/** 取 Redis 客户端；不可用返回 null，调用方降级到纯 Turso 路径。 */
function safeRedis(): ReturnType<typeof getTranslateV4RedisClient> | null {
  try {
    return getTranslateV4RedisClient();
  } catch {
    return null;
  }
}

/** 读总量计数（Redis 命中直接返回；否则从 Turso 播种并写回）。 */
async function getCachedAutoTotal(
  shop: string,
  redis: ReturnType<typeof getTranslateV4RedisClient> | null,
): Promise<number> {
  if (redis) {
    try {
      const v = await redis.get(totalCountKey(shop));
      if (v != null) return Number(v) || 0;
    } catch {
      // ignore → 回退 Turso
    }
  }
  const n = await prisma.liquidRule.count({ where: { shop, source: "auto" } });
  if (redis) {
    try {
      await redis.set(totalCountKey(shop), String(n), "EX", TOTAL_CACHE_TTL_SEC);
    } catch {
      // ignore
    }
  }
  return n;
}

export type CollectResult = {
  /** 本次新写入 PENDING 的条数。 */
  scheduled: number;
  /** 未启用 / 主语言 / 无候选时为 true，便于客户端停止上报。 */
  skipped: boolean;
  reason?: string;
};

function envBool(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw == null || raw === "") return defaultValue;
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") return false;
  if (raw === "1" || raw === "true" || raw === "on" || raw === "yes") return true;
  return defaultValue;
}

/**
 * 采集 shop 白名单：`AUTO_LIQUID_SHOP_ALLOWLIST=a.myshopify.com,b.myshopify.com`
 * - 未配置 / 空：全店可写（店面仍可全量上报）
 * - 已配置：仅名单内落库；名单外打详细日志后跳过
 */
function parseShopAllowlist(): string[] | null {
  const raw = process.env.AUTO_LIQUID_SHOP_ALLOWLIST?.trim();
  if (!raw) return null;
  const list = raw
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.length ? list : null;
}

function isShopAllowlisted(shop: string): boolean {
  const list = parseShopAllowlist();
  if (!list) return true;
  return list.includes(shop.trim().toLowerCase());
}

function normalize(text: string): string {
  return String(text || "").replace(/\s+/g, " ").trim();
}

const URL_RE = /^(https?:\/\/|www\.|\/|mailto:|tel:)/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** 纯数字 / 价格 / 日期 / 尺码配置等非人工文本。 */
const NON_HUMAN_RE = /^[\d\s.,:/#$€£¥%+\-–—()[\]{}|*·•]+$/;

/** 判断一段文本是否值得送去翻译（粗筛，成本/质量双重保护）。 */
function looksTranslatable(text: string): boolean {
  const t = normalize(text);
  if (t.length < MIN_TEXT_LEN || t.length > MAX_TEXT_LEN) return false;
  if (!/\p{L}/u.test(t)) return false;
  if (URL_RE.test(t) || EMAIL_RE.test(t)) return false;
  if (NON_HUMAN_RE.test(t)) return false;
  if (t.includes("{{") || t.includes("}}") || t.includes("{%")) return false;
  if (looksLikeHtmlMarkupFragment(t)) return false;
  if (!/\s/.test(t) && /^[a-z0-9_.-]+$/.test(t)) return false;
  return true;
}

function utcYmd(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

function autoLiquidDebugEnabled(): boolean {
  // 默认开细日志；出事可设 AUTO_LIQUID_DEBUG=false
  return envBool("AUTO_LIQUID_DEBUG", true);
}

/** 灰度外（配置了 allowlist 且店不在名单）请求量：Redis 日聚合 + 单行 Render 日志。 */
async function recordAllowlistDeny(
  shop: string,
  target: string,
  inCount: number,
): Promise<void> {
  console.log(
    `[auto-liquid] deny allowlist shop=${shop} target=${target} inCount=${inCount}`,
  );
  const redis = safeRedis();
  if (!redis) return;
  const day = utcYmd();
  const ttlSec = 60 * 60 * 24 * 8;
  try {
    await redis.incr(`tsf:auto_liquid:deny:req:${day}`);
    await redis.incrby(`tsf:auto_liquid:deny:texts:${day}`, Math.max(0, inCount));
    await redis.sadd(`tsf:auto_liquid:deny:shops:${day}`, shop);
    await redis.expire(`tsf:auto_liquid:deny:req:${day}`, ttlSec);
    await redis.expire(`tsf:auto_liquid:deny:texts:${day}`, ttlSec);
    await redis.expire(`tsf:auto_liquid:deny:shops:${day}`, ttlSec);
  } catch {
    // ignore
  }
}

function debugLog(step: string, extra?: Record<string, unknown>): void {
  if (!autoLiquidDebugEnabled()) return;
  console.log(`[auto-liquid] ${step}`, JSON.stringify(extra ?? {}));
}

/** 并发采集竞态：另一请求已插入同 (shop, locale, 原文) 行。 */
function isLiquidRuleUniqueConstraint(err: unknown): boolean {
  let cur: unknown = err;
  for (let depth = 0; depth < 4 && cur != null; depth++) {
    const msg = cur instanceof Error ? cur.message : String(cur);
    if (
      /UNIQUE constraint failed.*LiquidRule/i.test(msg) ||
      (/SQLITE_CONSTRAINT/i.test(msg) &&
        /LiquidRule\.(shop|languageCode|beforeTranslation)/i.test(msg))
    ) {
      return true;
    }
    cur =
      cur && typeof cur === "object" && "cause" in cur
        ? (cur as { cause?: unknown }).cause
        : undefined;
  }
  return false;
}

async function mirrorPendingDigestsToRedis(
  redis: ReturnType<typeof getTranslateV4RedisClient> | null,
  shop: string,
  target: string,
  texts: string[],
  insertedCount: number,
): Promise<void> {
  if (!redis || !texts.length) return;
  try {
    const digests = texts.map((t) => liquidSourceDigest(t));
    await redis.sadd(knownDigestKey(shop, target), ...digests);
    await redis.expire(knownDigestKey(shop, target), KNOWN_TTL_SEC);
    if (insertedCount > 0) {
      await redis.incrby(totalCountKey(shop), insertedCount);
      await redis.expire(totalCountKey(shop), TOTAL_CACHE_TTL_SEC);
    }
  } catch {
    // ignore（缓存尽力而为，权威在 Turso）
  }
}

function todayKey(shop: string): string {
  const ymd = utcYmd();
  return `tsf:auto_liquid:count:${shop}:${ymd}`;
}

function primaryLocaleCacheKey(shop: string): string {
  return `tsf:shop_primary_locale:${shop}`;
}

/** 预留本次可插入名额（Redis 原子 INCRBY + TTL），返回实际获批的条数。 */
async function reserveDailyBudget(shop: string, want: number): Promise<number> {
  if (want <= 0) return 0;
  if (!(DAILY_CAP > 0)) return want;
  try {
    const redis = getTranslateV4RedisClient();
    const key = todayKey(shop);
    const after = await redis.incrby(key, want);
    if (after === want) await redis.expire(key, DAILY_CAP_TTL_SEC);
    if (after <= DAILY_CAP) return want;
    const allowed = Math.max(0, want - (after - DAILY_CAP));
    if (allowed < want) await redis.decrby(key, want - allowed);
    return allowed;
  } catch (err) {
    console.error("[auto-liquid] daily budget reserve failed:", err);
    return want;
  }
}

async function resolvePrimaryLocaleCached(shop: string): Promise<string | null> {
  try {
    const redis = getTranslateV4RedisClient();
    const cached = await redis.get(primaryLocaleCacheKey(shop));
    if (cached) return cached;
  } catch {
    // ignore
  }

  const accessToken = await getOfflineSessionAccessToken(shop);
  if (!accessToken) return null;
  try {
    const primary = await resolveShopPrimaryLocale({ shop, accessToken });
    if (primary) {
      try {
        const redis = getTranslateV4RedisClient();
        await redis.set(primaryLocaleCacheKey(shop), primary, "EX", PRIMARY_LOCALE_TTL_SEC);
      } catch {
        // ignore
      }
    }
    return primary;
  } catch (err) {
    console.error("[auto-liquid] resolve primary locale failed:", err);
    return null;
  }
}

export async function collectAutoLiquidStrings(args: {
  shop: string;
  target: string;
  texts: string[];
  /** 可选请求上下文，用于白名单拒收时的诊断日志。 */
  meta?: {
    pathPrefix?: string;
    userAgent?: string;
  };
}): Promise<CollectResult> {
  const shop = args.shop.trim();
  const target = normalize(args.target);
  const rawTexts = Array.isArray(args.texts) ? args.texts : [];
  const inCount = rawTexts.length;

  if (!shop || !target) {
    debugLog("skip", { shop, target, reason: "no_target", inCount });
    return { scheduled: 0, skipped: true, reason: "no_target" };
  }

  // 0) 全局 kill-switch（默认开；出事设 AUTO_LIQUID_COLLECT_ENABLED=false）
  // 产品默认采集；不再读 SwitcherConfiguration.autoLiquidCollect 商户开关。
  if (!envBool("AUTO_LIQUID_COLLECT_ENABLED", true)) {
    debugLog("skip", { shop, target, reason: "disabled", inCount });
    return { scheduled: 0, skipped: true, reason: "disabled" };
  }

  // 0.5) shop 白名单：店面全量上报；名单外不落库，单行日志 + Redis 日聚合。
  const allowlist = parseShopAllowlist();
  if (allowlist && !isShopAllowlisted(shop)) {
    await recordAllowlistDeny(shop, target, inCount);
    return { scheduled: 0, skipped: true, reason: "shop_not_allowlisted" };
  }

  // 1) 主语言门控（Redis 缓存 1h，避免每会话打 Shopify）
  const primary = await resolvePrimaryLocaleCached(shop);
  if (primary && normalize(primary).toLowerCase() === target.toLowerCase()) {
    debugLog("skip", { shop, target, reason: "primary_locale", inCount, primary });
    return { scheduled: 0, skipped: true, reason: "primary_locale" };
  }

  // 2) 归一 + 去重 + 粗筛 + translation-core 值过滤（与 init 共用）+ 单次上限
  const seen = new Set<string>();
  const candidates: string[] = [];
  let filterRejected = 0;
  for (const raw of rawTexts) {
    const t = normalize(raw);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    if (!looksTranslatable(t)) {
      filterRejected += 1;
      continue;
    }
    // key 用 liquid：走通用值启发式，避免误触 key==="value" 的 JSON 特例
    if (!translationRuleJudgment("liquid", t)) {
      filterRejected += 1;
      continue;
    }
    candidates.push(t);
    if (candidates.length >= MAX_PER_REQUEST * 2) break;
  }
  if (!candidates.length) {
    debugLog("skip", {
      shop,
      target,
      reason: "no_candidate",
      inCount,
      primary,
      filterRejected,
    });
    return { scheduled: 0, skipped: true, reason: "no_candidate" };
  }
  debugLog("candidates", {
    shop,
    target,
    inCount,
    primary,
    candidateCount: candidates.length,
    filterRejected,
  });

  const redis = safeRedis();
  const digests = candidates.map((t) => liquidSourceDigest(t));

  // 3) 批级冷却：同一批文案短时内重复上报直接跳过（省去后续读写）。
  if (redis) {
    try {
      const batchDigest = liquidSourceDigest([...candidates].sort().join("\u0001"));
      const ok = await redis.set(
        seenBatchKey(shop, target, batchDigest),
        "1",
        "EX",
        SEEN_BATCH_TTL_SEC,
        "NX",
      );
      if (ok === null) {
        debugLog("skip", {
          shop,
          target,
          reason: "recently_seen",
          candidateCount: candidates.length,
        });
        return { scheduled: 0, skipped: false, reason: "recently_seen" };
      }
    } catch {
      // ignore → 继续
    }
  }

  // 4) Redis 已知指纹集过滤：命中即已在 Turso（非 DONE），跳过 → 减少 findMany。
  let unknown = candidates;
  if (redis && digests.length) {
    try {
      const flags = await redis.smismember(knownDigestKey(shop, target), ...digests);
      if (Array.isArray(flags) && flags.length === candidates.length) {
        unknown = candidates.filter((_, i) => !Number(flags[i]));
      }
    } catch {
      // ignore → unknown 保持全量，走 findMany 兜底
    }
  }
  if (!unknown.length) {
    debugLog("skip", { shop, target, reason: "all_known", via: "redis_known" });
    return { scheduled: 0, skipped: false, reason: "all_known" };
  }

  // 5) 权威去重：仅对 unknown 子集查 Turso（任意 status）。
  const existing = await prisma.liquidRule.findMany({
    where: { shop, languageCode: target, beforeTranslation: { in: unknown } },
    select: { beforeTranslation: true, status: true },
  });
  const existingSet = new Set(existing.map((r) => r.beforeTranslation));
  // 自愈：把已存在的「非 DONE」原文补进已知集（覆盖历史 PENDING 未镜像的情况）。
  if (redis) {
    const heal = existing
      .filter((r) => r.status !== "DONE")
      .map((r) => liquidSourceDigest(r.beforeTranslation));
    if (heal.length) {
      try {
        await redis.sadd(knownDigestKey(shop, target), ...heal);
        await redis.expire(knownDigestKey(shop, target), KNOWN_TTL_SEC);
      } catch {
        // ignore
      }
    }
  }
  const fresh = unknown
    .filter((t) => !existingSet.has(t))
    .slice(0, MAX_PER_REQUEST);
  if (!fresh.length) {
    debugLog("skip", {
      shop,
      target,
      reason: "all_known",
      via: "turso",
      unknownCount: unknown.length,
    });
    return { scheduled: 0, skipped: false, reason: "all_known" };
  }

  // 6) 总量上限（只限 source=auto，读 Redis 计数缓存，避免每请求 COUNT）
  const autoCount = await getCachedAutoTotal(shop, redis);
  if (autoCount >= TOTAL_CAP) {
    debugLog("skip", { shop, target, reason: "total_cap", autoCount, TOTAL_CAP });
    return { scheduled: 0, skipped: true, reason: "total_cap" };
  }
  const room = Math.max(0, TOTAL_CAP - autoCount);
  const withinTotal = fresh.slice(0, room);
  if (!withinTotal.length) {
    debugLog("skip", { shop, target, reason: "total_cap", autoCount, room });
    return { scheduled: 0, skipped: true, reason: "total_cap" };
  }

  // 7) 每日名额预留（采集只落 PENDING，不扣额度；翻译时再计费）
  const allowed = await reserveDailyBudget(shop, withinTotal.length);
  if (allowed <= 0) {
    debugLog("skip", { shop, target, reason: "daily_cap", want: withinTotal.length });
    return { scheduled: 0, skipped: true, reason: "daily_cap" };
  }
  const toInsert = withinTotal.slice(0, allowed);

  // 8) 批量插入 PENDING（不跑 LLM）
  // LibSQL/Prisma adapter 不支持 createMany({ skipDuplicates })，去重已在上方完成。
  try {
    const result = await prisma.liquidRule.createMany({
      data: toInsert.map((text) => ({
        shop,
        beforeTranslation: text,
        afterTranslation: "",
        languageCode: target,
        replacementMethod: false,
        source: "auto",
        status: "PENDING",
        sourceDigest: liquidSourceDigest(text),
        jobId: null,
      })),
    });
    await mirrorPendingDigestsToRedis(redis, shop, target, toInsert, result.count);
    console.log(
      `[auto-liquid] inserted shop=${shop} target=${target} scheduled=${result.count} inCount=${inCount}`,
    );
    return { scheduled: result.count, skipped: false };
  } catch (err) {
    if (isLiquidRuleUniqueConstraint(err)) {
      await mirrorPendingDigestsToRedis(redis, shop, target, toInsert, 0);
      debugLog("skip", {
        shop,
        target,
        reason: "duplicate_race",
        want: toInsert.length,
      });
      return { scheduled: 0, skipped: false, reason: "all_known" };
    }
    console.error("[auto-liquid] createMany PENDING failed:", err);
    return { scheduled: 0, skipped: true, reason: "write_failed" };
  }
}
