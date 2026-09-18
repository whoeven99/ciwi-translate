/**
 * Translation-memory hit accounting for one `translateResources` call.
 *
 * TM reads happen in three tiers and each one that misses turns into billable
 * LLM/Google characters, so hit rate is the cheapest lever on translation cost.
 * Nothing here touches Redis or the translation result — it only counts, and
 * `formatTmStatsLine` emits a single greppable line that
 * `scripts/tm-hit-rate.mjs` aggregates from Render logs.
 */

/** TM read tiers, in the order `translateResources` consults them. */
export type TmTier = "fieldDigest" | "fieldValue" | "leafValue";

export type TmTierStats = {
  lookups: number;
  hits: number;
  /** Source chars resolved from cache — chars we did not pay an engine for. */
  hitChars: number;
};

export type TmChunkStats = {
  fieldDigest: TmTierStats;
  fieldValue: TmTierStats;
  leafValue: TmTierStats;
  /** Unique source chars handed to a translation engine after all TM tiers missed. */
  engineChars: number;
  /**
   * Batches dispatched to an engine. Every one re-sends the whole system prompt,
   * so `engineChars / llmRequests` is the content each prompt had to carry —
   * when that drops near the prompt's own size, the merchant is mostly paying
   * for the prompt.
   */
  llmRequests: number;
};

export type TmStatsContext = {
  shopName: string;
  source: string;
  target: string;
  aiModel: string;
  /** True when the caller disabled TM reads (custom prompt / forced retranslate). */
  cacheDisabled: boolean;
};

const LOG_PREFIX = "[tm]";

function emptyTier(): TmTierStats {
  return { lookups: 0, hits: 0, hitChars: 0 };
}

export function createTmChunkStats(): TmChunkStats {
  return {
    fieldDigest: emptyTier(),
    fieldValue: emptyTier(),
    leafValue: emptyTier(),
    engineChars: 0,
    llmRequests: 0,
  };
}

/** Records one TM read. `chars` is the source length, counted only on a hit. */
export function noteTmLookup(
  stats: TmChunkStats,
  tier: TmTier,
  hit: boolean,
  chars: number,
): void {
  const bucket = stats[tier];
  bucket.lookups += 1;
  if (!hit) return;
  bucket.hits += 1;
  bucket.hitChars += Math.max(0, chars);
}

export function noteTmEngineChars(stats: TmChunkStats, chars: number): void {
  stats.engineChars += Math.max(0, chars);
}

export function noteTmEngineRequests(stats: TmChunkStats, requests: number): void {
  stats.llmRequests += Math.max(0, requests);
}

function ratio(hit: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((hit / total) * 1000) / 1000;
}

export type TmStatsSummary = {
  lookups: number;
  hits: number;
  /** Hits ÷ lookups across all three tiers. */
  hitRate: number;
  hitChars: number;
  engineChars: number;
  /** Cached chars ÷ (cached + engine) chars — the cost-relevant rate. */
  charHitRate: number;
  llmRequests: number;
  /** Source chars carried per request; low values mean prompt-dominated spend. */
  charsPerRequest: number;
  tiers: Record<TmTier, TmTierStats & { hitRate: number }>;
};

export function summarizeTmChunk(stats: TmChunkStats): TmStatsSummary {
  const tiers = ["fieldDigest", "fieldValue", "leafValue"] as const;
  const lookups = tiers.reduce((n, tier) => n + stats[tier].lookups, 0);
  const hits = tiers.reduce((n, tier) => n + stats[tier].hits, 0);
  const hitChars = tiers.reduce((n, tier) => n + stats[tier].hitChars, 0);
  return {
    lookups,
    hits,
    hitRate: ratio(hits, lookups),
    hitChars,
    engineChars: stats.engineChars,
    charHitRate: ratio(hitChars, hitChars + stats.engineChars),
    llmRequests: stats.llmRequests,
    charsPerRequest:
      stats.llmRequests > 0 ? Math.round(stats.engineChars / stats.llmRequests) : 0,
    tiers: {
      fieldDigest: { ...stats.fieldDigest, hitRate: ratio(stats.fieldDigest.hits, stats.fieldDigest.lookups) },
      fieldValue: { ...stats.fieldValue, hitRate: ratio(stats.fieldValue.hits, stats.fieldValue.lookups) },
      leafValue: { ...stats.leafValue, hitRate: ratio(stats.leafValue.hits, stats.leafValue.lookups) },
    },
  };
}

/**
 * One-line JSON summary, or null when the chunk did nothing worth reporting
 * (no lookups and no engine traffic) so idle chunks do not flood the logs.
 */
export function formatTmStatsLine(
  stats: TmChunkStats,
  context: TmStatsContext,
): string | null {
  const summary = summarizeTmChunk(stats);
  if (summary.lookups === 0 && summary.engineChars === 0 && summary.llmRequests === 0) {
    return null;
  }
  return `${LOG_PREFIX} ${JSON.stringify({
    shop: context.shopName,
    source: context.source,
    target: context.target,
    aiModel: context.aiModel,
    cacheDisabled: context.cacheDisabled || undefined,
    lookups: summary.lookups,
    hits: summary.hits,
    hitRate: summary.hitRate,
    hitChars: summary.hitChars,
    engineChars: summary.engineChars,
    charHitRate: summary.charHitRate,
    llmRequests: summary.llmRequests,
    charsPerRequest: summary.charsPerRequest,
    tiers: summary.tiers,
  })}`;
}

export { LOG_PREFIX as TM_STATS_LOG_PREFIX };
