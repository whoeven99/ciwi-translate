import { tmMGet, tmMGetByValue, tmSet, tmSetByValue } from "./translationMemory.js";
import { loadGlossaryLines } from "./glossary.js";
import {
  applyJsonSlotTranslations,
  extractJsonTextSlots,
  isListFormat,
  shouldTranslateMetafieldJson,
  tryParseJsonContainer,
  type JsonTextSlot,
  type JsonValue,
} from "./jsonExtractRules.js";
import { isHtmlContent } from "./htmlContent.js";
import {
  isLiquidTemplate,
  liquidHtmlNodePartsOf,
  reassembleLiquidHtmlTranslation,
  type LiquidHtmlNodePlan,
} from "./liquidHtmlTranslate.js";
import {
  hasPromptSentinelLeakage,
  isPassthroughLeafText,
  isTranslatableLeafText,
  looksLikeEmptySourceHallucination,
  looksLikeUntranslated,
  looksLikeWrongScriptLeak,
} from "./translateQuality.js";
import {
  effectiveTranslation,
  flattenHtmlNodeTranslations,
  hasHtmlPlaceholderLeak,
  htmlNodePartsOf,
  reassembleHtmlTranslation,
  roundtripHtmlForTest,
  sanitizeHtmlTextTranslation,
  type HtmlNodePlan,
} from "./htmlTranslate.js";
import { enforceTranslateResultLimits } from "./translationFieldLimits.js";
import {
  maskPlaceholders,
  placeholdersIntact,
  protectedLiteralsPreserved,
  restoreMaskedPlaceholders,
} from "./placeholderMask.js";
import {
  buildScriptConstraintLine,
  buildTargetLanguageBlock,
} from "./targetLanguagePrompt.js";
import { estimateDeepSeekCallCost } from "./deepseekPricing.js";
import {
  AzureContentPolicyError,
  classifyLlmError,
  isQuotaExhaustedError,
  LlmRateLimitError,
  LlmTimeoutError,
  QuotaExhaustedError,
  retryAfterMsFromResponse,
} from "./llmErrors.js";
import {
  invokeChatCompletion,
  resolveModel,
  sanitizeDeepSeekUserId,
  type ChatMessage,
} from "./deepseekClient.js";
import {
  callAzureOpenAIChat,
  isGptModel,
  resolveGptModel,
} from "./azureGptClient.js";
import { callGoogleTranslate } from "./googleTranslate.js";
import {
  getPool,
  responseHeadersToRecord,
} from "./llmKeyPool.js";
import {
  getShopQuotaState,
  refreshGateFromBudget,
  setShopQuotaCap,
} from "./quotaGate.js";

/** Google source chars → merchant credits (default 1.6, same ballpark as create-task estimate). */
export function googleCharsToCredits(chars: number): number {
  const k = Number(process.env.GOOGLE_CREDITS_PER_CHAR);
  const perChar = Number.isFinite(k) && k > 0 ? k : 1.6;
  return Math.max(0, Math.ceil(Math.max(0, chars) * perChar));
}

export function isGoogleUsageModel(model: string): boolean {
  const m = model.trim().toLowerCase();
  return m === "google-translate" || m.startsWith("google");
}

// ── Public API re-exports (keep App / Worker import surface stable) ───────────
export {
  estimateDeepSeekCallCost,
  resolveDeepSeekCnyPrices,
  isDeepSeekPeakHourBeijing,
  DEEPSEEK_CNY_PRICES,
  DEEPSEEK_PRICING_SOURCE,
} from "./deepseekPricing.js";
export type { DeepSeekCallCostEstimate, DeepSeekPriceTier } from "./deepseekPricing.js";

export {
  QuotaExhaustedError,
  isQuotaExhaustedError,
  LlmRateLimitError,
  LlmTimeoutError,
  AzureContentPolicyError,
  classifyLlmError,
  emptyErrorTally,
  retryAfterMsFromResponse,
} from "./llmErrors.js";
export type { LlmErrorKind, LlmErrorTally } from "./llmErrors.js";

export {
  sanitizeDeepSeekUserId,
  resolveModel,
  isDeepSeekModelId,
  MAX_POOL_CONCURRENCY,
  invokeChatCompletion,
  resolveDeepSeekAccountConcurrencyLimit,
  resolveDeepSeekPoolConcurrency,
} from "./deepseekClient.js";
export type { ChatMessage, LlmTransport } from "./deepseekClient.js";

export {
  gptConfigured,
  isGptModel,
  resolveGptModel,
  resolveGptChatSampling,
  buildGptChatRequestBody,
  callAzureOpenAIChat,
} from "./azureGptClient.js";
export type { GptChatSampling } from "./azureGptClient.js";

export {
  resetLlmPoolForTests,
  getLlmPoolStats,
  getLlmErrorBreakdown,
  recordLlmTerminalFallback,
  flushKeyStats,
  getPool,
  responseHeadersToRecord,
} from "./llmKeyPool.js";

export {
  setShopQuotaCap,
  syncShopQuotaBudget,
  __resetShopQuotaStateForTest,
  __getShopQuotaCommittedForTest,
  getShopQuotaState,
  refreshGateFromBudget,
} from "./quotaGate.js";

// ─── Engine router ──────────────────────────────────────────────────────────────
//
// Two engine *families*: "llm" and "google" (Google Translate).
// Within "llm": job aiModel gpt-* tries Azure GPT first; unresolved items then
// cascade to DeepSeek (when configured) before Google. Non-GPT jobs use DeepSeek
// only. Short plain packs LLM-first (Google last) unless
// TRANSLATE_SHORT_PACK_LLM_FIRST=false. Forced aiModel=google-translate skips LLM.

type Engine = "llm" | "google";

function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_TRANSLATE_API_KEY?.trim());
}

function llmConfigured(): boolean {
  return Boolean(
    process.env.DEEPSEEK_API_KEY?.trim() ||
      process.env.DEEPSEEK_API_KEYS?.trim(),
  );
}

/** Short plain JSON-pack path uses LLM first by default (rollback via env). */
function shortPackLlmFirst(): boolean {
  const v = process.env.TRANSLATE_SHORT_PACK_LLM_FIRST;
  if (v === undefined || v.trim() === "") return true;
  return /^(1|true|yes)$/i.test(v);
}

/** A single forced engine family, or null when auto-routing should apply. */
function forcedEngine(aiModel?: string): Engine | null {
  if (aiModel?.trim().toLowerCase() === "google-translate") return "google";
  return null;
}

// Plain fields at or above this length are treated as "rich" content.
const SHORT_PLAIN_THRESHOLD = 80;

function fieldTier(
  key: string,
  value: string,
  klass: "skip" | "html" | "liquid_html" | "json" | "list" | "plain",
): "trivial" | "rich" {
  if (isHandleFieldKey(key)) return "rich";
  if (klass === "html" || klass === "liquid_html" || klass === "json" || klass === "list") return "rich";
  if (key === "meta_description") return "rich";
  return value.length >= SHORT_PLAIN_THRESHOLD ? "rich" : "trivial";
}

type PoolSigOpts = { isHandle?: boolean; isShort?: boolean };

function poolSignature(order: Engine[], opts: boolean | PoolSigOpts = false): string {
  // Legacy callers passed `isHandle` as a boolean.
  const { isHandle, isShort } =
    typeof opts === "boolean" ? { isHandle: opts, isShort: false } : opts;
  const base = order.join(",");
  if (isHandle) return `${HANDLE_POOL_PREFIX}${base}`;
  if (isShort) return `${SHORT_POOL_PREFIX}${base}`;
  return base;
}

function parsePoolSignature(sig: string): {
  order: Engine[];
  isHandle: boolean;
  isShort: boolean;
} {
  if (sig.startsWith(HANDLE_POOL_PREFIX)) {
    return {
      isHandle: true,
      isShort: false,
      order: sig.slice(HANDLE_POOL_PREFIX.length).split(",") as Engine[],
    };
  }
  if (sig.startsWith(SHORT_POOL_PREFIX)) {
    return {
      isHandle: false,
      isShort: true,
      order: sig.slice(SHORT_POOL_PREFIX.length).split(",") as Engine[],
    };
  }
  return { isHandle: false, isShort: false, order: sig.split(",") as Engine[] };
}

/** Ordered engine candidates for a tier (primary first, then fallback). */
function engineOrderFor(tier: "trivial" | "rich", aiModel?: string): Engine[] {
  const forced = forcedEngine(aiModel);
  if (forced) return [forced];

  const g = googleConfigured();
  const l = llmConfigured();
  const order: Engine[] = [];
  // Short plain: LLM JSON-pack first (default); rich always LLM first.
  const llmFirst = tier === "rich" || shortPackLlmFirst();
  if (llmFirst) {
    if (l) order.push("llm");
    if (g) order.push("google");
  } else {
    if (g) order.push("google");
    if (l) order.push("llm");
  }
  // Always have at least one candidate.
  if (order.length === 0) order.push(l ? "llm" : "google");
  return order;
}

/** The model/label recorded for a chosen engine (used for TM cache + Cosmos). */
function engineModel(engine: Engine, aiModel: string): string {
  if (engine === "google") return "google-translate";
  if (isGptModel(aiModel)) return resolveGptModel(aiModel);
  return resolveModel(aiModel);
}

/**
 * The engine actually used for a job — real data for Cosmos. With routing on, it
 * reports "auto" plus the configured engines; when forced, the single engine.
 */
export function resolveEngine(aiModel: string): { provider: string; model: string } {
  const forced = forcedEngine(aiModel);
  if (forced === "google") return { provider: "google", model: "google-translate" };
  if (isGptModel(aiModel)) return { provider: "azure-openai", model: resolveGptModel(aiModel) };
  const model = resolveModel(aiModel);
  const parts: string[] = [];
  if (googleConfigured()) parts.push("google");
  if (llmConfigured()) parts.push(model);
  return { provider: "auto", model: parts.length ? `auto(${parts.join("+")})` : "none" };
}

export type TranslateItem = {
  key: string;
  value: string;
  digest: string;
  /** Shopify translatableContent.type from INIT blob. */
  shopifyType?: string;
};

/** One LLM/Google HTTP call's cost metadata (shared by all fields in the same batch). */
export type TranslationCallCost = {
  provider: "llm" | "google";
  model?: string;
  /** LLM only: correlates fields translated in the same request. */
  requestId?: string;
  /** Full prompt_tokens from the provider (includes cache hits). */
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  /**
   * DeepSeek `prompt_cache_hit_tokens` (or OpenAI-style cached_tokens).
   * Billed at cache-hit input rate — do not treat as full-price input.
   * Excluded from merchant usedTokens / credit deduction.
   */
  promptCacheHitTokens?: number;
  /**
   * DeepSeek `prompt_cache_miss_tokens` (or prompt_tokens − hit when derived).
   * Billed at cache-miss input rate.
   */
  promptCacheMissTokens?: number;
  /** Estimated provider CNY (元) from official DeepSeek 中文价目 × usage. */
  costCny?: number;
  /** Peak multiplier applied (1 or 2 when DEEPSEEK_PEAK_PRICING is on). */
  pricingPeakMultiplier?: number;
  /** Price card id / docs URL marker for reconciliation. */
  pricingSource?: string;
  /** Google: source char count for this text. */
  chars?: number;
  /** LLM only: how many items were sent in this request. */
  batchSize?: number;
};

/**
 * Tokens charged to the merchant (job usedTokens / credit deduct).
 * When DeepSeek reports cache hits, exclude them: miss + out only.
 * Without cache breakdown, keep provider total (in + out).
 */
export function billableLlmTokens(usage: {
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  promptCacheHitTokens?: number;
  promptCacheMissTokens?: number;
}): number {
  const hit = usage.promptCacheHitTokens;
  if (typeof hit === "number" && hit > 0) {
    const miss =
      typeof usage.promptCacheMissTokens === "number" && usage.promptCacheMissTokens >= 0
        ? usage.promptCacheMissTokens
        : typeof usage.inputTokens === "number"
          ? Math.max(0, usage.inputTokens - hit)
          : 0;
    const out =
      typeof usage.outputTokens === "number" && usage.outputTokens >= 0
        ? usage.outputTokens
        : 0;
    return Math.max(0, miss + out);
  }
  if (typeof usage.totalTokens === "number" && usage.totalTokens > 0) {
    return usage.totalTokens;
  }
  return Math.max(0, (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0));
}

/**
 * Per-field cost persisted on translate blob / Admin content viewer.
 * Multi-leaf fields (HTML/JSON) may aggregate into `calls` + totals.
 */
export type TranslationFieldCost =
  | TranslationCallCost
  | { provider: "cache" | "skip" }
  | {
      provider: "mixed" | "llm";
      calls: TranslationCallCost[];
      inputTokens?: number;
      outputTokens?: number;
      promptCacheHitTokens?: number;
      promptCacheMissTokens?: number;
      costCny?: number;
      chars?: number;
    };

export type TranslateResult = {
  key: string;
  translatedValue: string;
  digest: string;
  /** "translated" = produced by the engine; "fallback" = engine failed, original text returned. */
  status: "translated" | "fallback";
  /** Optional cost metadata for Admin / blob inspection. */
  cost?: TranslationFieldCost;
};

function isTranslationCallCost(c: TranslationFieldCost): c is TranslationCallCost {
  return (c.provider === "llm" || c.provider === "google") && !("calls" in c);
}

/** Merge leaf-level costs onto a Shopify field (dedupe LLM by requestId; sum Google chars). */
export function mergeLeafCosts(
  costs: Array<TranslationFieldCost | undefined>,
): TranslationFieldCost | undefined {
  const items = costs.filter((c): c is TranslationFieldCost => c != null);
  if (items.length === 0) return undefined;
  if (items.length === 1) return items[0];

  const llmByKey = new Map<string, TranslationCallCost>();
  let googleChars = 0;
  let googleCount = 0;
  let cacheCount = 0;
  let skipCount = 0;

  const addLlm = (call: TranslationCallCost) => {
    const key =
      call.requestId?.trim() ||
      `anon:${call.model ?? ""}:${call.inputTokens ?? ""}:${call.outputTokens ?? ""}:${call.totalTokens ?? ""}:${call.batchSize ?? ""}`;
    if (!llmByKey.has(key)) llmByKey.set(key, call);
  };

  for (const c of items) {
    if (c.provider === "cache") {
      cacheCount++;
      continue;
    }
    if (c.provider === "skip") {
      skipCount++;
      continue;
    }
    if (isTranslationCallCost(c)) {
      if (c.provider === "google") {
        googleCount++;
        googleChars += c.chars ?? 0;
      } else {
        addLlm(c);
      }
      continue;
    }
    // Aggregated multi-leaf shape (`provider: "llm" | "mixed"` + calls).
    if ("calls" in c) {
      for (const call of c.calls) {
        if (call.provider === "llm") addLlm(call);
        else if (call.provider === "google") {
          googleCount++;
          googleChars += call.chars ?? 0;
        }
      }
      if (typeof c.chars === "number" && c.chars > 0) {
        googleCount++;
        googleChars += c.chars;
      }
    }
  }

  const llmCalls = [...llmByKey.values()];
  const hasLlm = llmCalls.length > 0;
  const hasGoogle = googleCount > 0;

  if (!hasLlm && !hasGoogle) {
    if (cacheCount > 0) return { provider: "cache" };
    if (skipCount > 0) return { provider: "skip" };
    return undefined;
  }
  if (hasLlm && !hasGoogle && llmCalls.length === 1 && cacheCount === 0 && skipCount === 0) {
    return llmCalls[0]!;
  }
  if (hasGoogle && !hasLlm && cacheCount === 0 && skipCount === 0) {
    return { provider: "google", model: "google-translate", chars: googleChars };
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let promptCacheHitTokens = 0;
  let promptCacheMissTokens = 0;
  let costCny = 0;
  for (const c of llmCalls) {
    inputTokens += c.inputTokens ?? 0;
    outputTokens += c.outputTokens ?? 0;
    promptCacheHitTokens += c.promptCacheHitTokens ?? 0;
    promptCacheMissTokens += c.promptCacheMissTokens ?? 0;
    costCny += c.costCny ?? 0;
  }
  if (!hasLlm && hasGoogle) {
    return { provider: "google", model: "google-translate", chars: googleChars };
  }
  return {
    provider: hasGoogle ? "mixed" : "llm",
    calls: llmCalls,
    inputTokens: inputTokens > 0 ? inputTokens : undefined,
    outputTokens: outputTokens > 0 ? outputTokens : undefined,
    promptCacheHitTokens: promptCacheHitTokens > 0 ? promptCacheHitTokens : undefined,
    promptCacheMissTokens: promptCacheMissTokens > 0 ? promptCacheMissTokens : undefined,
    costCny: costCny > 0 ? Math.round(costCny * 1e8) / 1e8 : undefined,
    chars: googleChars > 0 ? googleChars : undefined,
  };
}

// ─── Field classification ──────────────────────────────────────────────────────

/** Pool signature prefix for handle/slug texts (hyphen→space preprocessed). */
const HANDLE_POOL_PREFIX = "@handle@";
/** Pool signature prefix for short plain JSON-pack batches (keeps limits separate from rich). */
const SHORT_POOL_PREFIX = "@short@";

export function isHandleFieldKey(key: string): boolean {
  return key.trim().toLowerCase() === "handle";
}

/** Align with SpringBackend StringUtils.replaceHyphensWithSpaces before handle LLM. */
export function prepareHandleSourceText(value: string): string {
  return value.replace(/-/g, " ");
}

/**
 * Returns true if `text` appears to already be written in the target language,
 * meaning it does not need translation.
 *
 * Strategy:
 *  - For English target: if source is a non-Latin script language AND the text
 *    contains no source-script characters, it is almost certainly already in
 *    English → skip.  (A zh-CN store's product titled "Standard" is English.)
 *  - For other targets with a distinctive script (zh, ja, ko, ar, ru, pl, de …):
 *    skip only when the text has ≥2 target-script chars after stripping
 *    punctuation/whitespace and their share of meaningful content exceeds 70%.
 *  - Conservative fall-through: return false (always translate) for unknown
 *    combinations to avoid accidentally suppressing content.
 *
 * This correctly handles the common case of a zh-CN store that has mostly
 * English product data and is being translated to:
 *   • en  → English content is the target, skip it (saves ~94% of LLM calls)
 *   • pl  → English content still needs translation to Polish, don't skip
 */
/** Latin letter runs (2+) — signals English/other Latin content still needing translation. */
const LATIN_WORD_RE = /[a-zA-Z]{2,}/;
const HIRAGANA_KATAKANA_RE = /[ぁ-ゖァ-ヶ]/u;
const HANGUL_RE = /[가-힣ᄀ-ᇿ]/u;
const CJK_HAN_RE = /[一-鿿㐀-䶿]/u;
/** 去掉无效字符后：目标文字符 ≥2 且占比 >70% 才算已在目标语。 */
const TARGET_SCRIPT_MIN_CHARS = 2;
const TARGET_SCRIPT_MIN_RATIO = 0.7;

const CYRILLIC_RE = /[Ѐ-ӿ]/u;
const ARABIC_RE = /[؀-ۿ]/u;
const THAI_RE = /[฀-๿]/u;
const DEVANAGARI_RE = /[ऀ-ॿ]/u;
const POLISH_DIACRITIC_RE = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/u;
const GERMAN_DIACRITIC_RE = /[äöüÄÖÜß]/u;
const FRENCH_DIACRITIC_RE = /[àâçèéêëîïôùûüœÀÂÇÈÉÊËÎÏÔÙÛÜŒ]/u;
const IBERIAN_DIACRITIC_RE = /[áéíóúüñÁÉÍÓÚÜÑãõÃÕ]/u;
const CZECH_SLOVAK_DIACRITIC_RE = /[áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/u;
const HUNGARIAN_DIACRITIC_RE = /[áéíóöőúüűÁÉÍÓÖŐÚÜŰ]/u;
const TURKISH_DIACRITIC_RE = /[çğışöüÇĞİŞÖÜ]/u;
const VIETNAMESE_DIACRITIC_RE = /[àáâãèéêìíòóôõùúýăđơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/u;

function langPrefix(locale: string): string {
  return locale.toLowerCase().split(/[-_]/)[0] || "";
}

/**
 * All script-detection regexes above are module-level consts without the "g"
 * flag, so this always hit the `new RegExp(re.source, flags)` branch — i.e. a
 * fresh RegExp was compiled from source on every call, and this runs once per
 * field per script check inside meetsScriptThreshold (hot path: "already in
 * target language" skip-check, evaluated per field). Cache the global-flag
 * clone per source RegExp object instead of rebuilding it every call.
 */
const globalRegexCache = new WeakMap<RegExp, RegExp>();
function countRegexMatches(text: string, re: RegExp): number {
  let globalRe = globalRegexCache.get(re);
  if (!globalRe) {
    const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
    globalRe = re.flags.includes("g") ? re : new RegExp(re.source, flags);
    globalRegexCache.set(re, globalRe);
  }
  return [...text.matchAll(globalRe)].length;
}

function countMeaningfulChars(text: string): number {
  return text.match(/\p{L}|\p{N}/gu)?.length ?? 0;
}

/** 去掉标点/空白后，目标文字符 ≥2 且占有效字符比例 >70%。 */
function meetsScriptThreshold(text: string, ...patterns: RegExp[]): boolean {
  let count = 0;
  for (const re of patterns) {
    count += countRegexMatches(text, re);
  }
  if (count < TARGET_SCRIPT_MIN_CHARS) return false;

  const meaningful = countMeaningfulChars(text);
  if (meaningful === 0) return false;
  return count / meaningful > TARGET_SCRIPT_MIN_RATIO;
}

function hasAnyScriptMatch(text: string, ...patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(text));
}

function scriptPatternsForLang(lang: string): RegExp[] | undefined {
  switch (lang) {
    case "zh": return [CJK_HAN_RE];
    case "ja": return [HIRAGANA_KATAKANA_RE, CJK_HAN_RE];
    case "ko": return [HANGUL_RE];
    case "ar": return [ARABIC_RE];
    case "ru": case "uk": case "bg": return [CYRILLIC_RE];
    case "th": return [THAI_RE];
    case "hi": case "mr": case "ne": return [DEVANAGARI_RE];
    case "pl": return [POLISH_DIACRITIC_RE];
    case "de": return [GERMAN_DIACRITIC_RE];
    case "fr": return [FRENCH_DIACRITIC_RE];
    case "es": case "pt": return [IBERIAN_DIACRITIC_RE];
    case "cs": case "sk": return [CZECH_SLOVAK_DIACRITIC_RE];
    case "hu": return [HUNGARIAN_DIACRITIC_RE];
    case "tr": return [TURKISH_DIACRITIC_RE];
    case "vi": return [VIETNAMESE_DIACRITIC_RE];
    default: return undefined;
  }
}

/** 同源书写体系、不同语言互译时不能仅靠共享字符判定已完成。 */
function isCrossScriptFamilyPair(
  source: string,
  target: string,
  langs: readonly string[],
): boolean {
  const sl = langPrefix(source);
  const tl = langPrefix(target);
  const set = new Set(langs);
  return set.has(sl) && set.has(tl) && sl !== tl;
}

/** zh / ja / ko 互译时，共享汉字不能单独当作「已在目标语」。 */
function isCrossCjkPair(source: string, target: string): boolean {
  return isCrossScriptFamilyPair(source, target, ["zh", "ja", "ko"]);
}

function hasLatinWords(text: string): boolean {
  return LATIN_WORD_RE.test(text);
}

function hasTargetScriptChars(text: string, targetLang: string): boolean {
  const patterns = scriptPatternsForLang(targetLang);
  if (!patterns) return false;
  return meetsScriptThreshold(text, ...patterns);
}

export function alreadyInTarget(text: string, source: string, target: string): boolean {
  const tl = langPrefix(target);
  const sl = langPrefix(source);

  // ── English target ──────────────────────────────────────────────────────────
  // If source is a CJK / non-Latin language and text has no source-script chars,
  // the content is already in a Latin-script language (overwhelmingly English).
  if (tl === "en") {
    return !containsSourceScript(text, source);
  }

  // Mixed target-script + Latin (e.g. "测试：Home Work: A Memoir…") is NOT done.
  if (hasLatinWords(text) && hasTargetScriptChars(text, tl)) {
    return false;
  }

  // ── Cross-CJK (e.g. zh→ja) ─────────────────────────────────────────────────
  // 汉字/假名/谚文不能混用同一套 regex；否则中文原文会被 ja 的「一-鿿」误判为已翻译。
  if (isCrossCjkPair(source, target)) {
    switch (tl) {
      case "ja":
        return meetsScriptThreshold(text, HIRAGANA_KATAKANA_RE);
      case "ko":
        return meetsScriptThreshold(text, HANGUL_RE);
      case "zh":
        return (
          sl === "zh" &&
          meetsScriptThreshold(text, CJK_HAN_RE) &&
          !hasAnyScriptMatch(text, HIRAGANA_KATAKANA_RE, HANGUL_RE)
        );
      default:
        return false;
    }
  }

  // 西里尔 / 天城文 / 相近拉丁变音语系：共享字符不能跨语言 skip。
  if (isCrossScriptFamilyPair(source, target, ["ru", "uk", "bg"])) return false;
  if (isCrossScriptFamilyPair(source, target, ["hi", "mr", "ne"])) return false;
  if (isCrossScriptFamilyPair(source, target, ["cs", "sk"])) return false;
  if (isCrossScriptFamilyPair(source, target, ["es", "pt"])) return false;

  return hasTargetScriptChars(text, tl);
}

/**
 * Returns true if `text` contains at least one character from the source
 * language's script. Used internally by alreadyInTarget.
 */
export function containsSourceScript(text: string, source: string): boolean {
  const patterns = scriptPatternsForLang(langPrefix(source));
  if (!patterns) return true; // unknown source locale → conservative, always translate
  return hasAnyScriptMatch(text, ...patterns);
}

function isHtml(value: string): boolean {
  return isHtmlContent(value);
}

export function classifyField(
  key: string,
  value?: string,
  shopifyType?: string,
): "skip" | "html" | "liquid_html" | "json" | "list" | "plain" {
  if (value !== undefined) {
    if (shopifyType === "LIST_SINGLE_LINE_TEXT_FIELD" && isListFormat(value)) {
      return "list";
    }
    if (tryParseJsonContainer(value) !== undefined) {
      return shouldTranslateMetafieldJson(value, shopifyType) ? "json" : "skip";
    }
  }
  // Liquid block tags ({% … %}) must use liquid_html even without HTML markup —
  // e.g. EMAIL_TEMPLATE title is plain text + Liquid; plain path lets the LLM
  // reorder ⟦n⟧ placeholders and break if/endif nesting on writeback.
  if (value !== undefined && isLiquidTemplate(value)) {
    return "liquid_html";
  }
  if (value !== undefined && isHtml(value)) {
    return "html";
  }
  return "plain";
}

function countJsonRuleUnits(value: string): number {
  const root = tryParseJsonContainer(value);
  if (root === undefined) return 0;
  const slots = extractJsonTextSlots(root);
  let units = 0;
  for (const slot of slots) {
    if (slot.isHtml) {
      units += htmlNodePartsOf(slot.text).nodeParts.reduce((n, parts) => n + parts.length, 0);
    } else {
      units += 1;
    }
  }
  return units;
}

function countListUnits(value: string): number {
  try {
    const list = JSON.parse(value) as Array<string | null>;
    if (!Array.isArray(list)) return 0;
    let units = 0;
    for (const el of list) {
      if (!el) continue;
      if (isHtml(el)) {
        units += htmlNodePartsOf(el).nodeParts.reduce((n, parts) => n + parts.length, 0);
      } else {
        units += 1;
      }
    }
    return units;
  } catch {
    return 0;
  }
}

/**
 * Number of translation units (nodes) a field expands into: HTML → text-node
 * count, plain → split-part count, skip → 0. Used for node-level progress so the
 * total computed at init matches what translate processes.
 */
export function countFieldUnits(key: string, value: string, shopifyType?: string): number {
  const klass = classifyField(key, value, shopifyType);
  if (klass === "skip") return 0;
  if (klass === "html")
    return htmlNodePartsOf(value).nodeParts.reduce((n, parts) => n + parts.length, 0);
  if (klass === "liquid_html")
    return liquidHtmlNodePartsOf(value).plan.nodeParts.reduce((n, parts) => n + parts.length, 0);
  if (klass === "json") {
    const units = countJsonRuleUnits(value);
    if (units > 0) return units;
    return 0;
  }
  if (klass === "list") return countListUnits(value);
  return splitPlainText(value).length;
}

// ─── Constants ────────────────────────────────────────────────────────────────

// Max total chars sent to the translation API in one request.
// Override via TRANSLATE_MAX_CHARS_PER_BATCH env var (default 3000).
//
// Smaller batches trade a few extra requests (cheap — DeepSeek/OpenAI prompt
// caching makes the repeated system prompt nearly free) for much lower per-request
// latency and far better fan-out: a big field's many units split into several
// short parallel requests instead of one ~40s monolith. Combined with the high
// chunk concurrency in translateWorker, this collapses the "few large slow
// requests" tail that otherwise dominates the back half of a job.
const MAX_CHARS_PER_BATCH = Math.max(
  500,
  Number(process.env.TRANSLATE_MAX_CHARS_PER_BATCH) || 3_000,
);
/** Max items per LLM request — avoids 80+ key payloads that routinely hit the timeout. */
const MAX_ITEMS_PER_BATCH = Math.max(
  1,
  Number(process.env.TRANSLATE_MAX_ITEMS_PER_BATCH) || 25,
);
/** Rich (HTML/JSON/LLM-first) pools use smaller batches — fewer keys per request, less idle-timeout tail. */
const RICH_MAX_CHARS_PER_BATCH = Math.max(
  500,
  Number(process.env.TRANSLATE_RICH_MAX_CHARS_PER_BATCH) || 1_500,
);
const RICH_MAX_ITEMS_PER_BATCH = Math.max(
  1,
  Number(process.env.TRANSLATE_RICH_MAX_ITEMS_PER_BATCH) || 8,
);
/** Short plain JSON-pack pools: more items per request (many tiny titles/labels). */
const SHORT_JSON_MAX_CHARS_PER_BATCH = Math.max(
  500,
  Number(process.env.TRANSLATE_SHORT_JSON_MAX_CHARS) || 3_000,
);
const SHORT_JSON_MAX_ITEMS_PER_BATCH = Math.max(
  1,
  Number(process.env.TRANSLATE_SHORT_JSON_MAX_ITEMS) || 40,
);

/**
 * Batch size for a pool. Short plain JSON packs use dedicated higher item caps;
 * rich LLM-first pools stay small; legacy Google-first uses the general cap.
 */
export function resolveBatchLimits(
  order: Engine[],
  opts?: { isShort?: boolean },
): {
  maxChars: number;
  maxItems: number;
} {
  if (opts?.isShort) {
    return {
      maxChars: SHORT_JSON_MAX_CHARS_PER_BATCH,
      maxItems: SHORT_JSON_MAX_ITEMS_PER_BATCH,
    };
  }
  if (order[0] === "llm") {
    return { maxChars: RICH_MAX_CHARS_PER_BATCH, maxItems: RICH_MAX_ITEMS_PER_BATCH };
  }
  return { maxChars: MAX_CHARS_PER_BATCH, maxItems: MAX_ITEMS_PER_BATCH };
}
// ── LLM timeouts (defaults tuned lenient for diagnosis — override via env in prod) ──
// Total wall-clock hard cap: base + per-item scaling, capped at MAX.
const LLM_TIMEOUT_BASE_MS = Math.max(
  60_000,
  Number(process.env.TRANSLATE_LLM_TIMEOUT_MS) || 300_000,
);
const LLM_TIMEOUT_PER_ITEM_MS = Math.max(
  500,
  Number(process.env.TRANSLATE_LLM_TIMEOUT_PER_ITEM_MS) || 5_000,
);
const LLM_TIMEOUT_MAX_MS = Math.max(
  LLM_TIMEOUT_BASE_MS,
  Number(process.env.TRANSLATE_LLM_TIMEOUT_MAX_MS) || 600_000,
);
/** On timeout, re-chunk a large batch straight to this size (skip the slow cascade). */
const TIMEOUT_RESPLIT_SIZE = Math.max(
  1,
  Number(process.env.TRANSLATE_TIMEOUT_RESPLIT_SIZE) || 3,
);
/** First-token timeouts: same-batch retries before re-chunking (queue drain). */
const FIRST_TOKEN_DRAIN_RETRIES = Math.max(
  0,
  Number(process.env.TRANSLATE_FIRST_TOKEN_DRAIN_RETRIES) || 3,
);
/** Drain delay before a first-token same-batch retry (lets the server queue clear). */
const FIRST_TOKEN_DRAIN_MS = Math.max(
  0,
  Number(process.env.TRANSLATE_FIRST_TOKEN_DRAIN_MS) || 5_000,
);
/** Base backoff between single-item leaf retries (grows linearly per attempt). */
const LEAF_RETRY_BACKOFF_MS = Math.max(
  0,
  Number(process.env.TRANSLATE_LEAF_RETRY_BACKOFF_MS) || 2_000,
);

/** Scale timeout with batch size so large (but capped) batches get more wall clock. */
export function llmTimeoutMsForBatch(itemCount: number): number {
  const n = Math.max(1, itemCount);
  return Math.min(
    LLM_TIMEOUT_MAX_MS,
    LLM_TIMEOUT_BASE_MS + Math.max(0, n - 1) * LLM_TIMEOUT_PER_ITEM_MS,
  );
}
// Batch fan-out: all batches within a resource pool are launched simultaneously.
// The pool's AdaptiveSemaphore is the only concurrency gate — no separate knob needed.

// Plain text / HTML text nodes longer than this get split before translation.
const LONG_TEXT_THRESHOLD = Math.max(
  500,
  Number(process.env.TRANSLATE_LONG_TEXT_THRESHOLD) || 3_000,
);
const LONG_TEXT_CHUNK_CHARS = Math.max(
  400,
  Number(process.env.TRANSLATE_LONG_TEXT_CHUNK_CHARS) || 2_500,
);

// ─── Concurrency helper ───────────────────────────────────────────────────────

/**
 * Run `fn` over `items` with at most `concurrency` tasks in-flight at a time.
 * Preserves ordering in the returned array. Exported so translateWorker can
 * reuse it for chunk-level parallelism.
 */
export async function pAll<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  if (concurrency <= 1) return Promise.all(items.map((item, i) => fn(item, i)));
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export { htmlNodePartsOf as htmlNodePartsOfForTest, roundtripHtmlForTest };
export { looksLikeUntranslated, looksLikeWrongScriptLeak } from "./translateQuality.js";

// ─── JSON rule extraction ─────────────────────────────────────────────────────
//
// Metafield JSON uses configured path/type rules (Java JsonTranslateStrategyService)
// via jsonExtractRules.ts — not heuristic DFS over all string leaves.

// ─── Plain text splitting ─────────────────────────────────────────────────────

/**
 * Splits a long plain-text string into chunks at natural boundaries
 * (paragraphs → sentences → words). Parts can be joined with "" after translation.
 */
function splitPlainText(text: string): string[] {
  if (text.length <= LONG_TEXT_THRESHOLD) return [text];

  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > LONG_TEXT_CHUNK_CHARS) {
    let splitIdx = -1;

    const paraIdx = remaining.lastIndexOf("\n\n", LONG_TEXT_CHUNK_CHARS);
    if (paraIdx >= LONG_TEXT_CHUNK_CHARS * 0.4) splitIdx = paraIdx + 2;

    if (splitIdx < 0) {
      const sentIdx = remaining.lastIndexOf(". ", LONG_TEXT_CHUNK_CHARS);
      if (sentIdx >= LONG_TEXT_CHUNK_CHARS * 0.4) splitIdx = sentIdx + 2;
    }

    if (splitIdx <= 0) {
      const wordIdx = remaining.lastIndexOf(" ", LONG_TEXT_CHUNK_CHARS);
      splitIdx = wordIdx > 0 ? wordIdx : LONG_TEXT_CHUNK_CHARS;
    }

    parts.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }

  if (remaining.length > 0) parts.push(remaining);
  return parts;
}

// ─── Char-based batching ──────────────────────────────────────────────────────

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function batchByChars(
  items: TranslateItem[],
  maxChars: number,
  maxItems = MAX_ITEMS_PER_BATCH,
): TranslateItem[][] {
  const batches: TranslateItem[][] = [];
  let current: TranslateItem[] = [];
  let currentChars = 0;

  for (const item of items) {
    const len = item.value.length;
    if (
      current.length > 0 &&
      (currentChars + len > maxChars || current.length >= maxItems)
    ) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(item);
    currentChars += len;
  }

  if (current.length > 0) batches.push(current);
  return batches;
}

// ─── Google Translate engine ──────────────────────────────────────────────────

const GOOGLE_LOG_TEXT_MAX = 2000;

function truncateForGoogleLog(text: string): string {
  if (text.length <= GOOGLE_LOG_TEXT_MAX) return text;
  return `${text.slice(0, GOOGLE_LOG_TEXT_MAX)}…(${text.length} chars)`;
}

function describeGoogleRouteReason(
  order: Engine[],
  aiModel: string,
  opts: { llmAttempted: boolean; totalItems: number; missingCount: number },
): { reason: string; detail: Record<string, unknown> } {
  const forced = forcedEngine(aiModel);
  if (forced === "google") {
    return {
      reason: "forced_google_model",
      detail: { aiModel, message: "job aiModel=google-translate" },
    };
  }
  const googleIdx = order.indexOf("google");
  const llmIdx = order.indexOf("llm");
  if (googleIdx < 0) {
    return { reason: "unexpected", detail: { order } };
  }
  if (llmIdx < 0 || !llmConfigured()) {
    return {
      reason: "google_only_no_llm",
      detail: { llmConfigured: llmConfigured(), order },
    };
  }
  if (googleIdx === 0) {
    return {
      reason: "google_first_in_order",
      detail: {
        order,
        shortPackLlmFirst: shortPackLlmFirst(),
        hint: "TRANSLATE_SHORT_PACK_LLM_FIRST=false or trivial-tier routing puts Google before LLM",
      },
    };
  }
  if (opts.llmAttempted && opts.missingCount > 0) {
    const llmResolved = opts.totalItems - opts.missingCount;
    return {
      reason: "llm_fallback",
      detail: {
        order,
        llmResolved,
        missingCount: opts.missingCount,
        hint:
          "LLM (GPT then DeepSeek when gpt-* job) did not resolve all items; cascading to Google",
      },
    };
  }
  return { reason: "engine_order", detail: { order } };
}


// ─── Routed translation (engine-agnostic) ──────────────────────────────────────

/**
 * Translate a set of items trying each engine in `order` until resolved.
 * Placeholders are masked once up front and restored/verified at the end, so the
 * protection applies to every engine (LLM and Google alike). Returns a map of
 * key → { value, status }; items unresolved by all engines get status "fallback".
 */
type RoutedResult = {
  value: string;
  status: "translated" | "fallback";
  engine: Engine | null;
  tokens: number;
  cost?: TranslationFieldCost;
};

async function translateItemsRouted(
  items: TranslateItem[],
  source: string,
  target: string,
  aiModel: string,
  shopName: string,
  order: Engine[],
  promptKind: "default" | "handle" = "default",
  profileBlock = "",
  customPrompt = "",
  /** 仅管理页单条翻译：把 LLM 原始返回打到日志。 */
  logSingleTranslate = false,
): Promise<{
  results: Map<string, RoutedResult>;
  llmTokens: number;
  googleCredits: number;
  quotaStopped: boolean;
}> {
  // placeholdersByKey: variable tokens (string[]) extracted from each item's value.
  const placeholdersByKey = new Map<string, string[]>();
  const masked = items.map((it) => {
    const { masked: m, tokens } = maskPlaceholders(it.value);
    placeholdersByKey.set(it.key, tokens);
    return { key: it.key, value: m, digest: it.digest };
  });

  const collected = new Map<string, string>(); // masked translations
  const engineByKey = new Map<string, Engine>(); // which engine resolved each key
  const llmTokensByKey = new Map<string, number>(); // LLM API tokens charged per key (EngineUsage)
  const googleCreditsByKey = new Map<string, number>(); // merchant credits for Google (chars×k)
  const costByKey = new Map<string, TranslationFieldCost>();
  let systemPrompt: string | null = null;
  const tokenAccum = { value: 0 }; // accumulates LLM token usage across all retries
  let googleCreditsAccum = 0;
  let tokenAccumBaseline = 0; // tokens already attributed before current LLM engine pass
  let llmAttempted = false;
  let quotaStopped = false;

  for (const engine of order) {
    const missing = masked.filter((i) => !collected.has(i.key));
    if (missing.length === 0) break;
    if (quotaStopped) break;

    if (engine === "llm") {
      const useGpt = isGptModel(aiModel);
      const useDeepSeek = llmConfigured();
      // GPT jobs need Azure key; DeepSeek jobs need DEEPSEEK_* keys. Either is enough to enter.
      if (!useGpt && !useDeepSeek) continue;
      llmAttempted = true;
      if (systemPrompt === null) {
        const glossary = await loadGlossaryLines(shopName, target);
        systemPrompt =
          promptKind === "handle"
            ? buildHandleSystemPrompt(target, glossary, profileBlock, customPrompt)
            : buildSystemPrompt(target, glossary, profileBlock, customPrompt);
        if (logSingleTranslate) {
          console.log("[single] prompt", {
            shopName,
            source,
            target,
            promptKind,
            hasProfileBlock: profileBlock.length > 0,
            customPrompt,
            prompt: systemPrompt,
          });
        }
      }
      tokenAccumBaseline = tokenAccum.value;
      try {
        if (useGpt) {
          quotaStopped = await gatherTranslations(
            missing,
            aiModel,
            systemPrompt,
            collected,
            tokenAccum,
            costByKey,
            shopName,
            FIRST_TOKEN_DRAIN_RETRIES,
            logSingleTranslate,
          );
          // GPT exhausted its own retries; try DeepSeek before cascading to Google.
          const stillMissing = missing.filter((i) => !collected.has(i.key));
          if (!quotaStopped && stillMissing.length > 0 && useDeepSeek) {
            const fallbackModel = resolveModel();
            console.warn(
              `[llm] GPT left ${stillMissing.length}/${missing.length} unresolved; ` +
                `falling back to DeepSeek (${fallbackModel})`,
            );
            quotaStopped = await gatherTranslations(
              stillMissing,
              fallbackModel,
              systemPrompt,
              collected,
              tokenAccum,
              costByKey,
              shopName,
              FIRST_TOKEN_DRAIN_RETRIES,
              logSingleTranslate,
            );
          }
        } else {
          quotaStopped = await gatherTranslations(
            missing,
            aiModel,
            systemPrompt,
            collected,
            tokenAccum,
            costByKey,
            shopName,
            FIRST_TOKEN_DRAIN_RETRIES,
            logSingleTranslate,
          );
        }
      } catch (e) {
        // Real engine failures only (quota soft-stop no longer throws).
        console.warn(`[route] llm engine error`, e);
      }
      // Attribute newly-resolved keys to the LLM; distribute tokens evenly across keys
      // for EngineUsage tally (billing still uses whole-batch llmTokens via onProgress).
      const newlyResolved = missing.filter((i) => collected.has(i.key) && !engineByKey.has(i.key));
      const passTokens = Math.max(0, tokenAccum.value - tokenAccumBaseline);
      const tokensEach = newlyResolved.length > 0 ? Math.ceil(passTokens / newlyResolved.length) : 0;
      for (const i of newlyResolved) {
        engineByKey.set(i.key, "llm");
        llmTokensByKey.set(i.key, tokensEach);
      }
      // Budget exhausted: wait out in-flight LLM (already done in gather) and do NOT
      // open Google as a free escape hatch.
      if (quotaStopped) break;
    } else {
      if (!googleConfigured()) continue;
      const { reason, detail } = describeGoogleRouteReason(order, aiModel, {
        llmAttempted,
        totalItems: items.length,
        missingCount: missing.length,
      });
      for (const batch of batchByChars(missing, MAX_CHARS_PER_BATCH)) {
        const batchChars = batch.reduce((n, b) => n + b.value.length, 0);
        const batchCredits = googleCharsToCredits(batchChars);
        // Respect the same shop budget before spending Google credits.
        const state = getShopQuotaState(shopName);
        if (state.budgetCredits != null) {
          if (state.committedCredits + batchCredits > state.budgetCredits) {
            setShopQuotaCap(shopName, 0);
            quotaStopped = true;
            console.log(
              `[quota] stop Google shop=${shopName} credits=${batchCredits} ` +
                `committed=${state.committedCredits} budget=${state.budgetCredits}`,
            );
            break;
          }
          state.committedCredits += batchCredits;
          refreshGateFromBudget(state);
        }
        console.log("[google]", {
          shopName,
          source,
          target,
          aiModel,
          promptKind,
          reason,
          ...detail,
          engineOrder: order,
          llmAttempted,
          totalItems: items.length,
          missingCount: missing.length,
          batchSize: batch.length,
          batchChars,
          batchCredits,
          items: batch.map((b) => {
            const original = items.find((it) => it.key === b.key)?.value ?? b.value;
            return {
              key: b.key,
              digest: b.digest,
              chars: original.length,
              originalText: truncateForGoogleLog(original),
              maskedText: original !== b.value ? truncateForGoogleLog(b.value) : undefined,
            };
          }),
        });
        try {
          const out = await callGoogleTranslate(batch.map((b) => b.value), target, "text");
          let chargedChars = 0;
          batch.forEach((b, i) => {
            if (out[i] != null && !collected.has(b.key)) {
              collected.set(b.key, out[i]!);
              engineByKey.set(b.key, "google");
              const credits = googleCharsToCredits(b.value.length);
              googleCreditsByKey.set(b.key, credits);
              googleCreditsAccum += credits;
              chargedChars += b.value.length;
              costByKey.set(b.key, {
                provider: "google",
                model: "google-translate",
                chars: b.value.length,
              });
            }
          });
          // Release unused reserved credits when some items were skipped/failed.
          if (state.budgetCredits != null) {
            const actual = googleCharsToCredits(chargedChars);
            const unused = Math.max(0, batchCredits - actual);
            if (unused > 0) {
              state.committedCredits = Math.max(0, state.committedCredits - unused);
              refreshGateFromBudget(state);
            }
          }
        } catch (e) {
          if (state.budgetCredits != null && batchCredits > 0) {
            state.committedCredits = Math.max(0, state.committedCredits - batchCredits);
            refreshGateFromBudget(state);
          }
          console.warn(`[route] google engine error`, e);
          break; // stop this engine; remaining items cascade to the next
        }
      }
    }
  }

  const result = new Map<string, RoutedResult>();
  for (const it of items) {
    const raw = collected.get(it.key);
    const placeholders = placeholdersByKey.get(it.key) ?? [];
    if (raw === undefined || (it.value.trim() !== "" && raw.trim() === "")) {
      result.set(it.key, { value: it.value, status: "fallback", engine: null, tokens: 0 });
      continue;
    }
    const decoded = decodeQuoteEntities(raw);
    const restored = restoreMaskedPlaceholders(decoded, placeholders);
    if (placeholders.length > 0) {
      const tokensOk =
        (placeholders.every((t) => restored.includes(t)) ||
          placeholdersIntact(restored, placeholders)) &&
        protectedLiteralsPreserved(placeholders, restored);
      if (!tokensOk) {
        console.warn(`[route] placeholder corrupted for key=${it.key}, using original`);
        result.set(it.key, { value: it.value, status: "fallback", engine: null, tokens: 0 });
        continue;
      }
    }
    if (hasPromptSentinelLeakage(restored)) {
      console.warn(`[route] sentinel leakage for key=${it.key}, using original`);
      result.set(it.key, { value: it.value, status: "fallback", engine: null, tokens: 0 });
      continue;
    }
    if (looksLikeEmptySourceHallucination(it.value, restored)) {
      console.warn(`[route] empty-source hallucination for key=${it.key}, using original`);
      result.set(it.key, { value: it.value, status: "fallback", engine: null, tokens: 0 });
      continue;
    }
    const finalValue = sanitizeHtmlTextTranslation(it.value, restored);
    if (looksLikeUntranslated(it.value, finalValue, target)) {
      console.warn(`[route] untranslated echo for key=${it.key}, marking fallback`);
      result.set(it.key, { value: it.value, status: "fallback", engine: null, tokens: 0 });
      continue;
    }
    if (looksLikeWrongScriptLeak(it.value, finalValue, target)) {
      console.warn(`[route] wrong-script leak for key=${it.key}, marking fallback`);
      result.set(it.key, { value: it.value, status: "fallback", engine: null, tokens: 0 });
      continue;
    }
    const eng = engineByKey.get(it.key) ?? null;
    result.set(it.key, {
      value: finalValue,
      status: "translated",
      engine: eng,
      // LLM: raw API tokens; Google: merchant credits (chars×k) stored in the same field for engineUsage.
      tokens:
        eng === "google"
          ? (googleCreditsByKey.get(it.key) ?? 0)
          : (llmTokensByKey.get(it.key) ?? 0),
      cost: costByKey.get(it.key),
    });
  }
  return {
    results: result,
    llmTokens: tokenAccum.value,
    googleCredits: googleCreditsAccum,
    quotaStopped,
  };
}

/** Re-translate pool units that fell back or echoed source, one item per request. */
async function retryPoolFallbacks(
  translated: Map<string, Map<string, RoutedResult>>,
  pools: Map<string, Map<string, number>>,
  source: string,
  target: string,
  aiModel: string,
  shopName: string,
  shouldAbort: () => boolean | Promise<boolean>,
  profileBlock = "",
  customPrompt = "",
  onLeafTranslated?: (text: string, result: RoutedResult, poolPrimaryModel: string) => void,
  logSingleTranslate = false,
  usage?: EngineUsage,
  onProgress?: (
    doneUnitsDelta: number,
    tokensDelta: number,
    googleCreditsDelta?: number,
  ) => Promise<void>,
): Promise<{ retried: number; quotaStopped: boolean }> {
  let retried = 0;
  let quotaStopped = false;
  for (const [sig, occ] of pools) {
    if (quotaStopped) break;
    const { order } = parsePoolSignature(sig);
    const poolPrimaryModel = engineModel(order[0]!, aiModel);
    const tmap = translated.get(sig)!;
    const needsRetry: string[] = [];
    for (const text of occ.keys()) {
      const r = tmap.get(text);
      if (!r || r.status === "fallback") {
        needsRetry.push(text);
      } else if (looksLikeUntranslated(text, r.value, target)) {
        needsRetry.push(text);
      } else if (looksLikeWrongScriptLeak(text, r.value, target)) {
        needsRetry.push(text);
      }
    }
    for (const text of needsRetry) {
      if (quotaStopped || (await shouldAbort())) break;
      const { isHandle, order: poolOrder } = parsePoolSignature(sig);
      const routed = await translateItemsRouted(
        [{ key: "0", value: text, digest: "" }],
        source,
        target,
        aiModel,
        shopName,
        poolOrder,
        isHandle ? "handle" : "default",
        profileBlock,
        customPrompt,
        logSingleTranslate,
      );
      if (routed.quotaStopped) {
        quotaStopped = true;
        break;
      }
      const r = routed.results.get("0");
      if (r?.status === "translated" && !looksLikeUntranslated(text, r.value, target) && !looksLikeWrongScriptLeak(text, r.value, target)) {
        tmap.set(text, r);
        retried++;
        if (r.engine && usage) {
          const model = engineModel(r.engine, aiModel);
          const acc = (usage[model] ??= { units: 0, chars: 0, tokens: 0 });
          acc.units += 1;
          acc.chars += text.length;
          acc.tokens += r.tokens;
        }
        if (onProgress) {
          await onProgress(1, routed.llmTokens, routed.googleCredits);
        }
        if (onLeafTranslated) onLeafTranslated(text, r, poolPrimaryModel);
      }
    }
  }
  return { retried, quotaStopped };
}

// Retries for a single (un-splittable) item that fails transiently.
const LEAF_RETRIES = Math.max(
  1,
  Number(process.env.TRANSLATE_LEAF_RETRIES) || 5,
);

/**
 * Pull the JSON object out of a model response that may be wrapped in markdown
 * fences or surrounded by prose. Still throws downstream if the inner text is
 * genuinely malformed.
 */
function extractJsonObject(raw: string): string {
  let s = raw.trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) s = fence[1].trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  return s;
}

/**
 * LLMs sometimes HTML-escape quotes/apostrophes in their output (`won't` →
 * `won&#39;t`). In HTML text nodes and plain fields these characters are valid
 * literals, so the escaping is pure noise (and can double-escape on re-runs).
 * Decode ONLY quotes/apostrophes — never &amp;/&lt;/&gt;, which must stay escaped
 * to keep HTML well-formed.
 */
function decodeQuoteEntities(text: string): string {
  return text
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&#0*34;|&quot;/g, '"');
}

// ─── Placeholder masking ───────────────────────────────────────────────────────

/** @internal Exported for unit tests. */
export { maskPlaceholders as maskPlaceholdersForTest } from "./placeholderMask.js";

/** Reject translations that leak JSON structure into a plain text leaf. */
function sanitizeJsonSlotTranslation(original: string, translated: string): string {
  const t = sanitizeHtmlTextTranslation(original, translated);
  if (
    (/"type"\s*:|"children"\s*:|]\s*,\s*"type"/.test(t)) &&
    !/"type"\s*:/.test(original)
  ) {
    return original;
  }
  return t;
}

/**
 * Build the static system prompt. Everything here is stable for a given
 * (source, target, glossary) → it forms a byte-identical prefix across batches
 * so OpenAI automatic prompt caching applies. The variable payload goes in the
 * user message instead.
 */
function buildSystemPrompt(
  target: string,
  glossaryLines: string[],
  profileBlock = "",
  userInstruction = "",
): string {
  const glossaryBlock = glossaryLines.length
    ? `\nGlossary (apply consistently):\n${glossaryLines.join("\n")}\n`
    : "";
  const shopContextBlock = profileBlock ? `\n${profileBlock}\n` : "";
  const userInstructionBlock = userInstruction.trim()
    ? `\nAdditional user instructions for this translation (apply to tone, style, and word choice; they MUST NOT override any of the output-format, JSON structure, sentinel, or placeholder rules above):\n${userInstruction.trim()}\n`
    : "";
  const targetLangBlock = buildTargetLanguageBlock(target);
  return `You are a professional e-commerce translator.${shopContextBlock}
Detect the input language automatically and translate the content into "${target}".
Rules:
- Be accurate and natural for e-commerce
- Translate ALL content into "${target}", no matter what language the input is in (English, Chinese, Spanish, etc.)
- If a value is already entirely in "${target}", return it unchanged
${buildScriptConstraintLine(target)}
- Each value is a plain-text leaf extracted from HTML: never include HTML tags (<td>, <tr>, <table>, etc.) in translatedValue
- Any token wrapped in the corner brackets ⟦ … ⟧ is an opaque placeholder. Copy it byte-for-byte, INCLUDING the ⟦ and ⟧ brackets. Never translate it, change its inner text, add or remove spaces inside it, drop it, or rewrite the brackets as [ ], 【 】, ( ), or any other characters. This applies to numeric sentinels (⟦0⟧, ⟦1⟧, …), the line-break token ⟦BR⟧, and segment markers like ⟦HTML_SEG_0_1⟧
- Numeric sentinels ⟦0⟧, ⟦1⟧, … may represent URLs or site paths (e.g. /blogs/news/article) — preserve them verbatim
- ⟦HTML_SEG_x_y⟧ is a separator between two adjacent text fragments. Keep every such marker, and keep the surrounding fragments in their original order relative to the marker — do not move words from one side of a ⟦HTML_SEG_x_y⟧ marker to the other
- Output literal characters; do NOT HTML-escape. Use ' and " directly — never &#39; or &quot;
- Do NOT add or remove leading or trailing whitespace
- If the value is empty, return it unchanged
- If a field key is "title", translatedValue MUST be at most 255 characters; shorten naturally while preserving the core meaning
- You MUST return an entry for every key in the input
${targetLangBlock}
${glossaryBlock}${userInstructionBlock}
The user message is a JSON array of {"key","value"} objects to translate.
Return ONLY a JSON object {"translations":[{"key":"<key>","translatedValue":"<text>"}]}, no markdown.`;
}

/** Handle/slug prompt — aligned with SpringBackend PromptUtils.buildDynamicHandlePrompt. */
function buildHandleSystemPrompt(
  target: string,
  glossaryLines: string[],
  profileBlock = "",
  userInstruction = "",
): string {
  const glossaryBlock = glossaryLines.length
    ? `\nGlossary (apply consistently):\n${glossaryLines.join("\n")}\n`
    : "";
  const shopContextBlock = profileBlock ? `\n${profileBlock}\n` : "";
  const userInstructionBlock = userInstruction.trim()
    ? `\nAdditional user instructions for this translation (apply to tone, style, and word choice; they MUST NOT override any of the output-format, JSON structure, sentinel, or placeholder rules above):\n${userInstruction.trim()}\n`
    : "";
  const targetLangBlock = buildTargetLanguageBlock(target);
  return `You are a professional e-commerce translator.${shopContextBlock}
Detect the input language automatically and translate product URL handle/slug text into "${target}".
Rules:
- Be accurate and natural for e-commerce URL slugs
- Translate ALL content into "${target}", no matter what language the input is in
- If a value is already entirely in "${target}", return it unchanged
- Preserve the exact letter casing from the source — do not capitalize words unless they are capitalized in the source
- Keep numbers, variables, and placeholders unchanged
- Do NOT output notes, annotations, explanations, corrections, or bilingual text
- Output literal characters; do NOT HTML-escape
- Do NOT add or remove leading or trailing whitespace
- You MUST return an entry for every key in the input
${targetLangBlock}
${glossaryBlock}${userInstructionBlock}
The user message is a JSON array of {"key","value"} objects to translate (hyphens may appear as spaces).
Return ONLY a JSON object {"translations":[{"key":"<key>","translatedValue":"<text>"}]}, no markdown.`;
}

/**
 * 粗估文本 token 数（无 tiktoken 依赖）：CJK ≈ 1 tok/字，其它 ≈ 4 chars/tok。
 * 用于单字段预估展示，不替代 API usage。
 */
export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x3000 && code <= 0x9fff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0xf900 && code <= 0xfaff)
    ) {
      cjk += 1;
    } else {
      other += 1;
    }
  }
  return Math.max(0, cjk + Math.ceil(other / 4));
}

/** 预估安全系数：略放大以避免实扣 > 预估导致透支。可用 TRANSLATE_QUOTA_ESTIMATE_SAFETY 覆盖。 */
function quotaEstimateSafety(): number {
  const v = Number(process.env.TRANSLATE_QUOTA_ESTIMATE_SAFETY);
  return Number.isFinite(v) && v >= 1 ? v : 1.2;
}

/**
 * 单批 LLM 调用的额度预估（credits，已含 multiplier × safety）。
 * system + user JSON 为 input；output 用「译文≈原文」的响应 JSON 代理。
 */
export function estimateLlmBatchCredits(
  systemPrompt: string,
  userPayloadJson: string,
  outputProxyJson: string,
  quotaMultiplier: number,
): number {
  const inputTokens =
    estimateTextTokens(systemPrompt) + estimateTextTokens(userPayloadJson);
  const outputTokens = estimateTextTokens(outputProxyJson);
  const mult =
    Number.isFinite(quotaMultiplier) && quotaMultiplier > 0 ? quotaMultiplier : 1;
  return Math.max(
    1,
    Math.ceil((inputTokens + outputTokens) * mult * quotaEstimateSafety()),
  );
}

export type SingleTranslateTokenEstimate = {
  /** 预估 LLM 原始 token（input+output，未乘额度系数）。 */
  estimatedTokens: number;
  inputTokens: number;
  outputTokens: number;
  systemPromptChars: number;
  userMessageChars: number;
};

/**
 * 按真实 system prompt + user JSON + 响应形状粗估单字段 LLM token。
 * glossary / profileBlock / customPrompt 与线上 buildSystemPrompt 一致。
 */
export function estimateSingleTranslateLlmTokens(args: {
  sourceText: string;
  target: string;
  fieldKey?: string;
  glossaryLines?: string[];
  profileBlock?: string;
  customPrompt?: string;
}): SingleTranslateTokenEstimate {
  const text = args.sourceText ?? "";
  const target = (args.target ?? "").trim() || "en";
  const fieldKey = args.fieldKey?.trim() || "value";
  const glossaryLines = args.glossaryLines ?? [];
  const profileBlock = args.profileBlock ?? "";
  const customPrompt = args.customPrompt ?? "";

  const valueForPrompt = isHandleFieldKey(fieldKey)
    ? prepareHandleSourceText(text)
    : text;
  const systemPrompt = isHandleFieldKey(fieldKey)
    ? buildHandleSystemPrompt(target, glossaryLines, profileBlock, customPrompt)
    : buildSystemPrompt(target, glossaryLines, profileBlock, customPrompt);
  const userMessage = JSON.stringify([{ key: "f0", value: valueForPrompt }]);
  // 响应 JSON 体积用「译文≈原文」代理，略偏上限。
  const outputProxy = JSON.stringify({
    translations: [{ key: "f0", translatedValue: valueForPrompt }],
  });

  const inputTokens =
    estimateTextTokens(systemPrompt) + estimateTextTokens(userMessage);
  const outputTokens = estimateTextTokens(outputProxy);
  return {
    estimatedTokens: inputTokens + outputTokens,
    inputTokens,
    outputTokens,
    systemPromptChars: systemPrompt.length,
    userMessageChars: userMessage.length,
  };
}

/**
 * One LLM round-trip. Uses opaque numeric IDs (f0, f1, …) in the payload so the
 * model cannot accidentally swap values based on semantic key names (P1 fix).
 * Returns a map from original keys → translated values, plus the token count.
 * Throws on unparseable JSON so the caller can retry.
 */
/**
 * One LLM round-trip via the adaptive key pool.
 *
 * Concurrency is gated by the pool's AdaptiveSemaphore, which auto-tunes
 * after every response based on X-RateLimit-* headers (Little's Law).
 * On 429 the slot is throttled, the semaphore cap drops, and
 * gatherTranslations' retry loop picks a fresh slot automatically.
 */
type LlmOnceResult = {
  map: Map<string, string>;
  tokens: number;
  cost: TranslationCallCost;
  /** Soft stop: do not throw; caller skips new LLM/Google and returns normally. */
  quotaStopped?: boolean;
};

const EMPTY_LLM_COST: TranslationCallCost = { provider: "llm" };

function buildLlmCallCost(args: {
  model: string;
  tokens: number;
  inputTokens?: number;
  outputTokens?: number;
  promptCacheHitTokens?: number;
  promptCacheMissTokens?: number;
  requestId?: string;
  batchSize: number;
}): TranslationCallCost {
  const cost: TranslationCallCost = {
    provider: "llm",
    model: args.model,
    batchSize: args.batchSize,
    totalTokens: args.tokens > 0 ? args.tokens : undefined,
  };
  if (args.requestId) cost.requestId = args.requestId;
  if (args.inputTokens !== undefined) cost.inputTokens = args.inputTokens;
  if (args.outputTokens !== undefined) cost.outputTokens = args.outputTokens;
  if (args.promptCacheHitTokens !== undefined) {
    cost.promptCacheHitTokens = args.promptCacheHitTokens;
  }
  if (args.promptCacheMissTokens !== undefined) {
    cost.promptCacheMissTokens = args.promptCacheMissTokens;
  }
  const money = estimateDeepSeekCallCost({
    model: args.model,
    promptCacheHitTokens: args.promptCacheHitTokens,
    promptCacheMissTokens: args.promptCacheMissTokens,
    inputTokens: args.inputTokens,
    outputTokens: args.outputTokens,
  });
  if (money) {
    cost.costCny = money.costCny;
    cost.pricingPeakMultiplier = money.peakMultiplier;
    cost.pricingSource = money.pricingSource;
  }
  return cost;
}

/** 解析 LLM 返回的 {translations:[{key,translatedValue}]} → 原 key → 译文 map。 */
function parseTranslationResult(
  raw: string,
  idToKey: Map<string, string>,
  cost: TranslationCallCost,
  tokens: number,
): LlmOnceResult {
  const obj = JSON.parse(extractJsonObject(raw)) as { translations?: unknown };
  const parsed = Array.isArray(obj.translations)
    ? (obj.translations as Array<{ key?: unknown; translatedValue?: unknown }>)
    : [];
  const map = new Map<string, string>();
  for (const r of parsed) {
    if (typeof r?.key === "string" && typeof r?.translatedValue === "string") {
      const origKey = idToKey.get(r.key);
      if (origKey !== undefined) map.set(origKey, r.translatedValue);
    }
  }
  return { map, tokens, cost };
}

async function callLLMOnce(
  items: TranslateItem[],
  aiModel: string,
  systemPrompt: string,
  shopName?: string,
  logSingleTranslate = false,
): Promise<LlmOnceResult> {
  // Opaque IDs prevent the model from confusing semantic key names with content.
  const idToKey = new Map(items.map((it, idx) => [`f${idx}`, it.key]));
  const payload = items.map((it, idx) => ({ key: `f${idx}`, value: it.value }));
  const userJson = JSON.stringify(payload);

  const state = shopName ? getShopQuotaState(shopName) : null;
  const quotaGate = state?.gate ?? null;
  let gateHeld = false;
  if (quotaGate) {
    gateHeld = await quotaGate.tryAcquire();
    if (!gateHeld) {
      return {
        map: new Map(),
        tokens: 0,
        cost: EMPTY_LLM_COST,
        quotaStopped: true,
      };
    }
  }

  /** 本批占坑预估；成功返回后换成实扣并清零；失败则在 finally 释放。 */
  let reservedEst = 0;
  const settleEstToActual = (billableTokens: number) => {
    if (!state || reservedEst <= 0) return;
    const actualCredits = Math.max(
      0,
      Math.ceil(billableTokens * state.quotaMultiplier),
    );
    state.committedCredits = Math.max(
      0,
      state.committedCredits - reservedEst + actualCredits,
    );
    reservedEst = 0;
    refreshGateFromBudget(state);
  };
  const releaseEst = () => {
    if (!state || reservedEst <= 0) return;
    state.committedCredits = Math.max(0, state.committedCredits - reservedEst);
    reservedEst = 0;
    refreshGateFromBudget(state);
  };

  try {
    // 额度预检：committed + 本批预估 ≤ budget 才发请求。
    if (state && state.budgetCredits != null) {
      const outputProxy = JSON.stringify({
        translations: payload.map((p) => ({
          key: p.key,
          translatedValue: p.value,
        })),
      });
      const est = estimateLlmBatchCredits(
        systemPrompt,
        userJson,
        outputProxy,
        state.quotaMultiplier,
      );
      if (state.committedCredits + est > state.budgetCredits) {
        // Soft stop: close the gate so sibling batches wait out in-flight LLM,
        // then return a normal signal (no throw / no error log).
        if (shopName) setShopQuotaCap(shopName, 0);
        console.log(
          `[quota] stop new LLM shop=${shopName ?? "?"} est=${est} ` +
            `committed=${state.committedCredits} budget=${state.budgetCredits}`,
        );
        return {
          map: new Map(),
          tokens: 0,
          cost: EMPTY_LLM_COST,
          quotaStopped: true,
        };
      }
      state.committedCredits += est;
      reservedEst = est;
      refreshGateFromBudget(state);
    }

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userJson },
    ];

    const logLlmReturn = (
      model: string,
      raw: string,
      tokens: number,
      requestId?: string,
    ) => {
      if (!logSingleTranslate) return;
      console.log("[single-llm] return", {
        shopName,
        model,
        source: payload,
        prompt: messages,
        raw,
        tokens,
        requestId,
      });
    };

    // GPT/Azure 引擎：aiModel 为 gpt-* 且配了 Gpt_ApiKey 时走这条，自成一路不进 DeepSeek 池。
    if (isGptModel(aiModel)) {
      const model = resolveGptModel(aiModel);
      const {
        raw,
        tokens,
        inputTokens,
        outputTokens,
        promptCacheHitTokens,
        promptCacheMissTokens,
        requestId,
      } = await callAzureOpenAIChat(model, messages, llmTimeoutMsForBatch(items.length));
      logLlmReturn(model, raw, tokens, requestId);
      const cost = buildLlmCallCost({
        model,
        tokens,
        inputTokens,
        outputTokens,
        promptCacheHitTokens,
        promptCacheMissTokens,
        requestId,
        batchSize: items.length,
      });
      const billable = billableLlmTokens(cost);
      const parsed = parseTranslationResult(raw, idToKey, cost, billable);
      settleEstToActual(billable);
      return parsed;
    }

    const acq = await getPool().acquire();
    const model = resolveModel(aiModel) || acq.model;
    const t0 = Date.now();

    try {
      const deepseekUserId =
        acq.transport.kind === "deepseek-fetch" && shopName
          ? sanitizeDeepSeekUserId(shopName)
          : undefined;
      const {
        content: raw,
        tokens,
        inputTokens,
        outputTokens,
        promptCacheHitTokens,
        promptCacheMissTokens,
        requestId,
        response,
        limitHints,
      } = await invokeChatCompletion(
        acq.transport,
        model,
        messages,
        llmTimeoutMsForBatch(items.length),
        getPool().firstTokenBudgetMs(),
        deepseekUserId,
      );

      const rawHeaders = responseHeadersToRecord(response);
      acq.onResponse(rawHeaders, Date.now() - t0, tokens, limitHints);
      logLlmReturn(model, raw, tokens, requestId);

      const cost = buildLlmCallCost({
        model,
        tokens,
        inputTokens,
        outputTokens,
        promptCacheHitTokens,
        promptCacheMissTokens,
        requestId,
        batchSize: items.length,
      });
      const billable = billableLlmTokens(cost);
      const parsed = parseTranslationResult(raw, idToKey, cost, billable);
      settleEstToActual(billable);
      return parsed;
    } catch (e: unknown) {
      if (e instanceof LlmRateLimitError) {
        acq.onThrottle(retryAfterMsFromResponse(e.response));
      } else {
        acq.onError(classifyLlmError(e));
      }
      throw e;
    } finally {
      acq.release();
    }
  } finally {
    // 失败 / 预检失败：释放未结算的预估占坑。
    releaseEst();
    if (gateHeld && quotaGate) quotaGate.release();
  }
}

/**
 * Translate a set of (already masked) items, writing results into `collected`.
 * On an unparseable/failed response the batch is split in half and retried, so a
 * single item that makes the model emit invalid JSON cannot poison the whole
 * batch. A lone failing item is retried a few times, then left for fallback.
 */
async function gatherTranslations(
  items: TranslateItem[],
  aiModel: string,
  systemPrompt: string,
  collected: Map<string, string>,
  tokenAccum: { value: number },
  costByKey: Map<string, TranslationFieldCost>,
  shopName?: string,
  firstTokenRetriesLeft = FIRST_TOKEN_DRAIN_RETRIES,
  logSingleTranslate = false,
): Promise<boolean> {
  const pend = items.filter((i) => !collected.has(i.key));
  if (pend.length === 0) return false;

  const applyLlmResult = (map: Map<string, string>, tokens: number, cost: TranslationCallCost) => {
    tokenAccum.value += tokens;
    let progressed = false;
    for (const [k, v] of map) {
      if (!collected.has(k)) {
        collected.set(k, v);
        costByKey.set(k, cost);
        progressed = true;
      }
    }
    return progressed;
  };

  // Proactively split before calling the API — avoids burning a full timeout on 80+ keys.
  if (pend.length > MAX_ITEMS_PER_BATCH) {
    const mid = Math.ceil(pend.length / 2);
    console.log(
      `[llm] batch of ${pend.length} items exceeds cap ${MAX_ITEMS_PER_BATCH}; splitting proactively`,
    );
    const a = await gatherTranslations(
      pend.slice(0, mid), aiModel, systemPrompt, collected, tokenAccum, costByKey, shopName,
      FIRST_TOKEN_DRAIN_RETRIES, logSingleTranslate,
    );
    const b = await gatherTranslations(
      pend.slice(mid), aiModel, systemPrompt, collected, tokenAccum, costByKey, shopName,
      FIRST_TOKEN_DRAIN_RETRIES, logSingleTranslate,
    );
    return a || b;
  }

  try {
    const once = await callLLMOnce(
      pend, aiModel, systemPrompt, shopName, logSingleTranslate,
    );
    if (once.quotaStopped) return true;
    const progressed = applyLlmResult(once.map, once.tokens, once.cost);
    const missing = pend.filter((i) => !collected.has(i.key));
    // Model parsed OK but dropped some keys → retry just those, but only while
    // making progress (avoids looping on a key the model refuses to return).
    if (missing.length > 0 && progressed && missing.length < pend.length) {
      return await gatherTranslations(
        missing, aiModel, systemPrompt, collected, tokenAccum, costByKey, shopName,
        FIRST_TOKEN_DRAIN_RETRIES, logSingleTranslate,
      );
    }
    return false;
  } catch (e) {
    // Legacy throw path from pool semaphore: treat as soft stop (no rethrow).
    if (isQuotaExhaustedError(e)) {
      if (shopName) setShopQuotaCap(shopName, 0);
      console.log(
        `[quota] stop new LLM shop=${shopName ?? "?"} (${e instanceof Error ? e.message : "QUOTA_EXHAUSTED"})`,
      );
      return true;
    }
    const msg = e instanceof Error ? e.message : String(e);
    const timeoutKind = e instanceof LlmTimeoutError ? e.kind : null;
    const isTimeout = timeoutKind !== null;
    if (e instanceof AzureContentPolicyError) {
      if (llmConfigured()) {
        const fallbackModel = resolveModel();
        console.warn(
          `[llm] Azure content policy rejected batch of ${pend.length}; ` +
            `falling back to DeepSeek (${fallbackModel})`,
        );
        return await gatherTranslations(
          pend,
          fallbackModel,
          systemPrompt,
          collected,
          tokenAccum,
          costByKey,
          shopName,
        );
      }
      console.warn(
        `[llm] Azure content policy rejected batch of ${pend.length}; ` +
          "DeepSeek unavailable, continuing to Google fallback",
      );
      return false;
    }
    if (pend.length > 1) {
      // First-token timeout = the request sat queued server-side before emitting
      // anything. Re-chunking into MORE requests makes the queue worse and re-sends
      // the same work as more calls. The congestion guard has already cut
      // concurrency on this timeout; wait a beat for the queue to drain, then retry
      // the SAME batch. Only fall through to re-chunk if it times out again.
      if (timeoutKind === "first-token" && firstTokenRetriesLeft > 0) {
        console.warn(
          `[llm] batch of ${pend.length} timed out waiting for first token; ` +
          `draining ${(FIRST_TOKEN_DRAIN_MS / 1_000).toFixed(1)}s then retrying same batch ` +
          `(${firstTokenRetriesLeft} retr${firstTokenRetriesLeft === 1 ? "y" : "ies"} left)`,
        );
        if (FIRST_TOKEN_DRAIN_MS > 0) {
          await new Promise((res) => setTimeout(res, FIRST_TOKEN_DRAIN_MS));
        }
        return await gatherTranslations(
          pend, aiModel, systemPrompt, collected, tokenAccum, costByKey, shopName,
          firstTokenRetriesLeft - 1, logSingleTranslate,
        );
      }
      // Timeout ≠ poison data. Halving a timed-out batch re-pays the base timeout
      // at every level (25→12→6→3…). Instead jump straight to small chunks so each
      // retry is fast. Parse errors keep the binary split (isolates the bad item).
      if (isTimeout && pend.length > TIMEOUT_RESPLIT_SIZE) {
        console.warn(
          `[llm] batch of ${pend.length} timed out (${msg}); re-chunking to ${TIMEOUT_RESPLIT_SIZE}`,
        );
        let stopped = false;
        for (const chunk of chunkArray(pend, TIMEOUT_RESPLIT_SIZE)) {
          if (await gatherTranslations(
            chunk, aiModel, systemPrompt, collected, tokenAccum, costByKey, shopName,
            FIRST_TOKEN_DRAIN_RETRIES, logSingleTranslate,
          )) {
            stopped = true;
            break;
          }
        }
        return stopped;
      }
      const mid = Math.ceil(pend.length / 2);
      console.warn(
        `[llm] batch of ${pend.length} ${isTimeout ? "timed out" : "unparseable"} (${msg}); splitting`,
      );
      const left = await gatherTranslations(
        pend.slice(0, mid), aiModel, systemPrompt, collected, tokenAccum, costByKey, shopName,
        FIRST_TOKEN_DRAIN_RETRIES, logSingleTranslate,
      );
      if (left) return true;
      return await gatherTranslations(
        pend.slice(mid), aiModel, systemPrompt, collected, tokenAccum, costByKey, shopName,
        FIRST_TOKEN_DRAIN_RETRIES, logSingleTranslate,
      );
    }
    // Single item: retry transient failures with backoff, then give up (→ fallback).
    for (let r = 0; r < LEAF_RETRIES; r++) {
      if (LEAF_RETRY_BACKOFF_MS > 0) {
        await new Promise((res) => setTimeout(res, LEAF_RETRY_BACKOFF_MS * (r + 1)));
      }
      try {
        const once = await callLLMOnce(
          pend, aiModel, systemPrompt, shopName, logSingleTranslate,
        );
        if (once.quotaStopped) return true;
        applyLlmResult(once.map, once.tokens, once.cost);
        if (collected.has(pend[0]!.key)) return false;
      } catch (retryErr) {
        if (isQuotaExhaustedError(retryErr)) {
          if (shopName) setShopQuotaCap(shopName, 0);
          return true;
        }
        // keep retrying up to the cap
      }
    }
    // Terminal: this field exhausted retries and will fall back to the original.
    // Recorded separately from per-attempt errors so telemetry can tell
    // "wasted attempts that recovered" from "user-visible fallbacks".
    getPool().recordTerminalFallback(1);
    console.warn(`[llm] item ${pend[0]!.key} failed after retries (${msg}); using original`);
    return false;
  }
}

// ─── Main exported functions ────────────────────────────────────────────────────

export type ResourceInput = { resourceId: string; fields: TranslateItem[]; module?: string };
export type ResourceResult = { resourceId: string; results: TranslateResult[] };
/** Per-engine-model tally of how much content each engine translated. */
export type EngineUsage = Record<string, { units: number; chars: number; tokens: number }>;
export type TranslateChunkResult = {
  resources: ResourceResult[];
  usage: EngineUsage;
  /**
   * Soft stop: shop credit budget exhausted. In-flight LLM calls were allowed to
   * finish; caller should pause the job after flushing actual charges — not an error.
   */
  quotaStopped?: boolean;
};

export function mergeEngineUsage(into: EngineUsage, from: EngineUsage): void {
  for (const [model, u] of Object.entries(from)) {
    const acc = (into[model] ??= { units: 0, chars: 0, tokens: 0 });
    acc.units += u.units;
    acc.chars += u.chars;
    acc.tokens += u.tokens;
  }
}

type JsonSlotPlan = JsonTextSlot & {
  htmlPlan?: HtmlNodePlan;
};

type ListElementPlan = {
  index: number;
  text: string;
  htmlPlan?: HtmlNodePlan;
};

// Reconstruction plan for a field whose translation spans one or more text units.
type FieldPlan = {
  resourceId: string;
  key: string;
  digest: string;
  order: Engine[];
  poolSig: string;
  cacheModel: string;
} & (
  | { kind: "plain"; parts: string[]; isHandle?: boolean }
  | { kind: "html"; htmlPlan: HtmlNodePlan }
  | { kind: "liquid_html"; htmlPlan: HtmlNodePlan; liquidTokens: string[] }
  | { kind: "json"; originalValue: string; root: JsonValue; slotPlans: JsonSlotPlan[] }
  | { kind: "list"; originalValue: string; elements: ListElementPlan[] }
);

function jsonPlanTexts(plan: Extract<FieldPlan, { kind: "json" }>): string[] {
  const texts: string[] = [];
  for (const slot of plan.slotPlans) {
    if (slot.htmlPlan) texts.push(...slot.htmlPlan.nodeParts.flat());
    else texts.push(slot.text);
  }
  return texts;
}

function listPlanTexts(plan: Extract<FieldPlan, { kind: "list" }>): string[] {
  const texts: string[] = [];
  for (const el of plan.elements) {
    if (el.htmlPlan) texts.push(...el.htmlPlan.nodeParts.flat());
    else texts.push(el.text);
  }
  return texts;
}

function htmlPlanTexts(plan: HtmlNodePlan): string[] {
  return plan.nodeParts.flat();
}

function lookupHtmlPart(
  poolSig: string,
  target: string,
  lookup: LookupFn,
  part: string,
): { value: string; fallback: boolean } {
  // Empty / BR placeholders never enter the LLM pool — keep as-is, not fallback.
  if (!part.trim() || isPassthroughLeafText(part)) {
    return { value: part, fallback: false };
  }
  const r = lookup(poolSig, part);
  if (!r || r.status === "fallback") {
    return { value: part, fallback: true };
  }
  if (
    looksLikeWrongScriptLeak(part, r.value, target) ||
    looksLikeEmptySourceHallucination(part, r.value) ||
    hasPromptSentinelLeakage(r.value)
  ) {
    return { value: part, fallback: true };
  }
  return {
    value: effectiveTranslation(part, sanitizeHtmlTextTranslation(part, r.value)),
    fallback: false,
  };
}

function flattenHtmlTranslationsFromLookup(
  htmlPlan: HtmlNodePlan,
  poolSig: string,
  target: string,
  lookup: LookupFn,
): { translations: string[]; anyFallback: boolean } {
  let anyFallback = false;
  const translations = flattenHtmlNodeTranslations(htmlPlan, (part) => {
    const { value, fallback } = lookupHtmlPart(poolSig, target, lookup, part);
    if (fallback) anyFallback = true;
    return value;
  });
  return { translations, anyFallback };
}

function reassembleHtmlFieldFromPlan(
  htmlPlan: HtmlNodePlan,
  poolSig: string,
  target: string,
  lookup: LookupFn,
): { value: string; anyFallback: boolean } {
  const { translations, anyFallback: flattenFallback } = flattenHtmlTranslationsFromLookup(
    htmlPlan,
    poolSig,
    target,
    lookup,
  );
  let anyFallback = flattenFallback;
  let value = reassembleHtmlTranslation(htmlPlan.template, translations);
  if (hasHtmlPlaceholderLeak(value)) {
    anyFallback = true;
    value = reassembleHtmlTranslation(htmlPlan.template, htmlPlan.texts);
  }
  if (hasPromptSentinelLeakage(value)) {
    anyFallback = true;
    value = reassembleHtmlTranslation(htmlPlan.template, htmlPlan.texts);
  }
  return { value, anyFallback };
}

function reassembleLiquidFieldFromPlan(
  htmlPlan: HtmlNodePlan,
  liquidTokens: string[],
  poolSig: string,
  target: string,
  lookup: LookupFn,
): { value: string; anyFallback: boolean } {
  const { translations, anyFallback: flattenFallback } = flattenHtmlTranslationsFromLookup(
    htmlPlan,
    poolSig,
    target,
    lookup,
  );
  let anyFallback = flattenFallback;
  let value = reassembleLiquidHtmlTranslation(htmlPlan.template, translations, liquidTokens);
  if (hasHtmlPlaceholderLeak(value)) {
    anyFallback = true;
    value = reassembleLiquidHtmlTranslation(htmlPlan.template, htmlPlan.texts, liquidTokens);
  }
  if (hasPromptSentinelLeakage(value)) {
    anyFallback = true;
    value = reassembleLiquidHtmlTranslation(htmlPlan.template, htmlPlan.texts, liquidTokens);
  }
  return { value, anyFallback };
}

type LookupFn = (poolSig: string, text: string) => RoutedResult | undefined;

function planTextsReady(plan: FieldPlan, lookup: LookupFn): boolean {
  const texts =
    plan.kind === "plain"
      ? plan.parts
      : plan.kind === "html"
        ? htmlPlanTexts(plan.htmlPlan)
        : plan.kind === "liquid_html"
          ? htmlPlanTexts(plan.htmlPlan)
        : plan.kind === "json"
          ? jsonPlanTexts(plan)
          : listPlanTexts(plan);
  return texts.every(
    (t) =>
      !t.trim() ||
      isPassthroughLeafText(t) ||
      lookup(plan.poolSig, t) !== undefined,
  );
}

function collectPlanLeafCosts(plan: FieldPlan, lookup: LookupFn): Array<TranslationFieldCost | undefined> {
  const texts =
    plan.kind === "plain"
      ? plan.parts
      : plan.kind === "html"
        ? htmlPlanTexts(plan.htmlPlan)
        : plan.kind === "liquid_html"
          ? htmlPlanTexts(plan.htmlPlan)
        : plan.kind === "json"
          ? jsonPlanTexts(plan)
          : listPlanTexts(plan);
  return texts.map((t) => lookup(plan.poolSig, t)?.cost);
}

function reconstructPlan(
  plan: FieldPlan,
  rm: Map<string, TranslateResult>,
  lookup: LookupFn,
  tmWrites: Promise<void>[],
  shopName: string,
  target: string,
  source: string,
  skipCacheWrite = false,
): void {
  const fieldCost = () => mergeLeafCosts(collectPlanLeafCosts(plan, lookup));

  if (plan.kind === "plain") {
    const pieces = plan.parts.map((p) => {
      if (!p.trim() || isPassthroughLeafText(p)) {
        return { value: p, status: "translated" as const };
      }
      return lookup(plan.poolSig, p) ?? { value: p, status: "fallback" as const };
    });
    const value = pieces.map((p) => p.value).join("");
    const status = pieces.some((p) => p.status === "fallback") ? "fallback" : "translated";
    const originalValue = plan.parts.join("");
    rm.set(plan.key, {
      key: plan.key,
      translatedValue: value,
      digest: plan.digest,
      status,
      cost: fieldCost(),
    });
    // Plain: field digest TM + value TM (digest if present, else CRC-32).
    if (status === "translated" && !skipCacheWrite) {
      tmWrites.push(tmSet(shopName, target, plan.cacheModel, plan.digest, value));
      tmWrites.push(tmSetByValue(originalValue, source, target, plan.cacheModel, value, plan.digest));
    }
  } else if (plan.kind === "html") {
    const { value, anyFallback } = reassembleHtmlFieldFromPlan(
      plan.htmlPlan,
      plan.poolSig,
      target,
      lookup,
    );
    const status = anyFallback ? "fallback" : "translated";
    rm.set(plan.key, {
      key: plan.key,
      translatedValue: value,
      digest: plan.digest,
      status,
      cost: fieldCost(),
    });
    // HTML/JSON/list: no field-digest TM — leaf texts are cached via value TM after pool translate.
  } else if (plan.kind === "liquid_html") {
    const { value, anyFallback } = reassembleLiquidFieldFromPlan(
      plan.htmlPlan,
      plan.liquidTokens,
      plan.poolSig,
      target,
      lookup,
    );
    const liquidStatus = anyFallback ? "fallback" : "translated";
    rm.set(plan.key, {
      key: plan.key,
      translatedValue: value,
      digest: plan.digest,
      status: liquidStatus,
      cost: fieldCost(),
    });
  } else if (plan.kind === "json") {
    let anyFallback = false;
    const translatedSlots: string[] = [];
    for (let i = 0; i < plan.slotPlans.length; i++) {
      const slot = plan.slotPlans[i]!;
      if (slot.htmlPlan) {
        const { value: slotHtml, anyFallback: slotFallback } = reassembleHtmlFieldFromPlan(
          slot.htmlPlan,
          plan.poolSig,
          target,
          lookup,
        );
        if (slotFallback) anyFallback = true;
        translatedSlots[i] = sanitizeJsonSlotTranslation(slot.text, slotHtml);
        if (hasPromptSentinelLeakage(translatedSlots[i]!)) {
          anyFallback = true;
          translatedSlots[i] = slot.text;
        }
      } else if (!slot.text.trim() || isPassthroughLeafText(slot.text)) {
        translatedSlots[i] = slot.text;
      } else {
        const r = lookup(plan.poolSig, slot.text);
        if (!r || r.status === "fallback") {
          anyFallback = true;
          translatedSlots[i] = slot.text;
        } else if (
          looksLikeWrongScriptLeak(slot.text, r.value, target) ||
          looksLikeEmptySourceHallucination(slot.text, r.value) ||
          hasPromptSentinelLeakage(r.value)
        ) {
          anyFallback = true;
          translatedSlots[i] = slot.text;
        } else {
          translatedSlots[i] = sanitizeJsonSlotTranslation(slot.text, r.value.trim());
        }
      }
    }
    applyJsonSlotTranslations(plan.slotPlans, translatedSlots);
    const value = JSON.stringify(plan.root);
    const status = anyFallback ? "fallback" : "translated";
    rm.set(plan.key, {
      key: plan.key,
      translatedValue: value,
      digest: plan.digest,
      status,
      cost: fieldCost(),
    });
  } else {
    let anyFallback = false;
    const list = JSON.parse(plan.originalValue) as Array<string | null>;
    const result = [...list];
    for (const el of plan.elements) {
      if (el.htmlPlan) {
        const { value: elHtml, anyFallback: elFallback } = reassembleHtmlFieldFromPlan(
          el.htmlPlan,
          plan.poolSig,
          target,
          lookup,
        );
        if (elFallback) anyFallback = true;
        result[el.index] = elHtml;
      } else if (!el.text.trim() || isPassthroughLeafText(el.text)) {
        result[el.index] = el.text;
      } else {
        const r = lookup(plan.poolSig, el.text);
        if (!r || r.status === "fallback") {
          anyFallback = true;
          result[el.index] = el.text;
        } else {
          result[el.index] = r.value.trim();
        }
      }
    }
    const value = JSON.stringify(result);
    const status = anyFallback ? "fallback" : "translated";
    rm.set(plan.key, {
      key: plan.key,
      translatedValue: value,
      digest: plan.digest,
      status,
      cost: fieldCost(),
    });
  }
}

/**
 * Translate every field across a whole chunk of resources in one pass.
 *
 * Key optimizations over per-resource translation:
 *  - Cross-resource batching: identical-engine text units from all resources are
 *    translated together (fewer round-trips, better prompt-cache amortization).
 *  - Dedup: each unique (engine-order, text) is translated once and reused
 *    everywhere it occurs in the chunk.
 *
 * Engine selection: short plain packs into JSON batches (LLM first, Google
 * last); rich (HTML/JSON/long plain) stays LLM-first. GPT jobs cascade
 * Azure → DeepSeek → Google; other jobs DeepSeek → Google. Forced
 * aiModel=google-translate skips packing and uses Google only.
 * Placeholders are masked across all engines; TM cache keyed by tier model.
 * Pipeline for short plain: field/value TM → chunk dedupe → size-capped JSON
 * packs → translate → reconstruct.
 */
export type TranslatedResourceOutput = {
  resourceId: string;
  results: TranslateResult[];
};

export type TranslateResourcesOptions = {
  /** 店铺画像上下文：注入 system prompt，仅用于引导风格/术语。 */
  profileBlock?: string;
  /** 与 TSF `isHandle` 对齐：`false` 时 handle 原样跳过；默认 `true`（INIT 已过滤时 blob 里本就不含 handle）。 */
  translateHandle?: boolean;
  /**
   * 用户自定义提示词：描述本次翻译的方向/风格，注入 system prompt。
   * 非空时默认跳过 TM 缓存读写（避免命中旧缓存 / 污染共享缓存）。
   */
  customPrompt?: string;
  /** 跳过 TM 缓存读取，强制走翻译引擎。管理翻译页手动点击翻译时应为 true。 */
  skipCacheRead?: boolean;
  /** 跳过 TM 缓存写入。批量任务带 customPrompt 时默认为 true。 */
  skipCacheWrite?: boolean;
  /**
   * 管理页单条翻译专用：把每次 LLM 调用的原文 / prompt / raw 完整打到日志。
   * 批量 worker 路径不要开启。
   */
  logSingleTranslate?: boolean;
};

function logSingleTranslatePath(
  enabled: boolean,
  kind: "pipeline" | "skip" | "cache" | "bypass",
  details: Record<string, unknown>,
): void {
  if (!enabled) return;
  console.log(`[single] ${kind}`, details);
}

export async function translateResources(
  resources: ResourceInput[],
  source: string,
  target: string,
  aiModel: string,
  shopName: string,
  onProgress?: (
    doneUnitsDelta: number,
    /** LLM raw API tokens (worker applies model multiplier). */
    tokensDelta: number,
    /** Google merchant credits already final (chars×GOOGLE_CREDITS_PER_CHAR). */
    googleCreditsDelta?: number,
  ) => Promise<void>,
  onResourceDone?: (resource: TranslatedResourceOutput) => Promise<void>,
  shouldAbort?: () => boolean | Promise<boolean>,
  options?: TranslateResourcesOptions,
): Promise<TranslateChunkResult> {
  const abortRequested = async (): Promise<boolean> =>
    shouldAbort ? Boolean(await shouldAbort()) : false;
  const translateHandle = options?.translateHandle !== false;
  const profileBlock = options?.profileBlock?.trim() ?? "";
  const customPrompt = options?.customPrompt?.trim() ?? "";
  const hasCustomPrompt = customPrompt.length > 0;
  // 带自定义提示词时默认禁用 TM 读写；手动翻译可显式 skipCacheRead 且仍写回缓存。
  const skipCacheRead = options?.skipCacheRead ?? hasCustomPrompt;
  const skipCacheWrite = options?.skipCacheWrite ?? hasCustomPrompt;
  const logSingleTranslate = options?.logSingleTranslate === true;

  if (logSingleTranslate) {
    logSingleTranslatePath(true, "pipeline", {
      shopName,
      source,
      target,
      hasProfileBlock: profileBlock.length > 0,
      skipCacheRead,
      skipCacheWrite,
      customPrompt,
      resourceCount: resources.length,
      fieldCount: resources.reduce((n, r) => n + r.fields.length, 0),
    });
  }

  const resultMaps = new Map<string, Map<string, TranslateResult>>();
  const plans: FieldPlan[] = [];
  // orderSig → (unique text → occurrence count across the chunk).
  const pools = new Map<string, Map<string, number>>();
  const addUnit = (
    order: Engine[],
    text: string,
    opts: PoolSigOpts = {},
  ) => {
    if (!isTranslatableLeafText(text)) return;
    const sig = poolSignature(order, opts);
    const occ = pools.get(sig) ?? pools.set(sig, new Map()).get(sig)!;
    occ.set(text, (occ.get(text) ?? 0) + 1);
  };

  // Units resolved without hitting an engine (cache hits) — credited immediately.
  let cacheUnits = 0;

  // Opt-in: skip fields that contain none of the source-language script.
  const skipNonSourceScript = /^(1|true|yes)$/i.test(
    process.env.TRANSLATE_SKIP_NON_SOURCE_SCRIPT ?? "",
  );

  // 1. Plan every field: resolve skip/cache directly; collect units to translate.
  //    TM lookups are fired in parallel across all fields to minimise Redis RTTs.
  for (const res of resources) {
    resultMaps.set(res.resourceId, new Map<string, TranslateResult>());
  }

  // 1a. Separate skip fields (no TM needed) from fields that need a cache check.
  type FieldWork = {
    resourceId: string;
    f: TranslateItem;
    klass: "html" | "liquid_html" | "json" | "list" | "plain";
    tier: "trivial" | "rich";
    order: Engine[];
    cacheModel: string;
  };
  const fieldWorks: FieldWork[] = [];

  for (const res of resources) {
    const rm = resultMaps.get(res.resourceId)!;
    for (const f of res.fields) {
      if (isHandleFieldKey(f.key) && !translateHandle) {
        logSingleTranslatePath(logSingleTranslate, "skip", {
          reason: "handle_disabled",
          fieldKey: f.key,
          original: f.value,
        });
        rm.set(f.key, {
          key: f.key,
          translatedValue: f.value,
          digest: f.digest,
          status: "translated",
          cost: { provider: "skip" },
        });
        continue;
      }
      const klass = classifyField(f.key, f.value, f.shopifyType);
      if (klass === "skip") {
        logSingleTranslatePath(logSingleTranslate, "skip", {
          reason: "classify_skip",
          fieldKey: f.key,
          original: f.value,
        });
        rm.set(f.key, {
          key: f.key,
          translatedValue: f.value,
          digest: f.digest,
          status: "translated",
          cost: { provider: "skip" },
        });
        continue;
      }
      const tier = fieldTier(f.key, f.value, klass);
      const order = engineOrderFor(tier, aiModel);
      const cacheModel = engineModel(order[0], aiModel);
      fieldWorks.push({ resourceId: res.resourceId, f, klass, tier, order, cacheModel });
    }
  }

  const tmWrites: Promise<void>[] = [];

  // 1b. Field-digest TM only for plain fields (HTML/JSON/list skip whole-field digest).
  //     Both plain tiers are prefetched in MGET batches here so step 1c never
  //     issues a per-field round-trip. The value tier is fetched for every plain
  //     field (not just digest misses) to keep this a single batched read; 1c
  //     still prefers the digest hit, so lookup order is unchanged.
  const cacheHits = skipCacheRead
    ? fieldWorks.map(() => null)
    : await tmMGet(
        shopName,
        target,
        fieldWorks.map(({ f, klass, cacheModel }) => ({
          model: cacheModel,
          digest: klass === "plain" ? f.digest : null,
        })),
      );

  // Value-tier prefetch for the same plain fields, aligned with `fieldWorks`.
  const valueCacheHits = skipCacheRead
    ? fieldWorks.map(() => null)
    : await tmMGetByValue(
        fieldWorks.map(({ f, klass, cacheModel }) => ({
          sourceText:
            klass === "plain"
              ? isHandleFieldKey(f.key)
                ? prepareHandleSourceText(f.value)
                : f.value
              : "",
          model: cacheModel,
          digest: f.digest,
        })),
        source,
        target,
      );

  // 1c. Process results: plain digest/value hit → credit; else plan + pool units.
  for (let wi = 0; wi < fieldWorks.length; wi++) {
    const { resourceId, f, klass, tier, order, cacheModel } = fieldWorks[wi];
    const rm = resultMaps.get(resourceId)!;
    if (!f.value.trim()) {
      logSingleTranslatePath(logSingleTranslate, "skip", {
        reason: "empty_value",
        fieldKey: f.key,
      });
      rm.set(f.key, {
        key: f.key,
        translatedValue: f.value,
        digest: f.digest,
        status: "translated",
        cost: { provider: "skip" },
      });
      continue;
    }
    const cached = cacheHits[wi];
    if (cached !== null) {
      logSingleTranslatePath(logSingleTranslate, "cache", {
        kind: "field_digest",
        fieldKey: f.key,
        original: f.value,
        translated: cached,
        cacheModel,
      });
      rm.set(f.key, {
        key: f.key,
        translatedValue: cached,
        digest: f.digest,
        status: "translated",
        cost: { provider: "cache" },
      });
      cacheUnits += countFieldUnits(f.key, f.value, f.shopifyType);
      continue;
    }

    // Plain secondary: value TM (Shopify digest if present, else CRC-32).
    if (!skipCacheRead && klass === "plain") {
      const cachedByValue = valueCacheHits[wi] ?? null;
      if (cachedByValue !== null) {
        logSingleTranslatePath(logSingleTranslate, "cache", {
          kind: "field_value",
          fieldKey: f.key,
          original: f.value,
          translated: cachedByValue,
          cacheModel,
        });
        rm.set(f.key, {
          key: f.key,
          translatedValue: cachedByValue,
          digest: f.digest,
          status: "translated",
          cost: { provider: "cache" },
        });
        tmWrites.push(tmSet(shopName, target, cacheModel, f.digest, cachedByValue));
        cacheUnits += countFieldUnits(f.key, f.value, f.shopifyType);
        continue;
      }
    } else if (logSingleTranslate && skipCacheRead) {
      logSingleTranslatePath(true, "cache", {
        action: "read_disabled",
        fieldKey: f.key,
        klass,
      });
    }

    const alreadyInTargetSkip = alreadyInTarget(f.value, source, target);
    const nonSourceScriptSkip =
      skipNonSourceScript && !containsSourceScript(f.value, source);
    if (alreadyInTargetSkip || nonSourceScriptSkip) {
      if (logSingleTranslate) {
        // 管理页手动点击：用户显式要求重译，不因「已在目标语」短路。
        logSingleTranslatePath(true, "bypass", {
          reason: alreadyInTargetSkip ? "already_in_target" : "non_source_script",
          fieldKey: f.key,
          original: f.value,
          source,
          target,
        });
      } else {
        rm.set(f.key, {
          key: f.key,
          translatedValue: f.value,
          digest: f.digest,
          status: "translated",
          cost: { provider: "skip" },
        });
        cacheUnits += countFieldUnits(f.key, f.value, f.shopifyType);
        continue;
      }
    }

    if (klass === "html") {
      const htmlPlan = htmlNodePartsOf(f.value);
      if (htmlPlan.nodeParts.length === 0) {
        rm.set(f.key, {
          key: f.key,
          translatedValue: f.value,
          digest: f.digest,
          status: "translated",
          cost: { provider: "skip" },
        });
        continue;
      }
      htmlPlan.nodeParts.forEach((parts) => parts.forEach((p) => addUnit(order, p)));
      plans.push({
        kind: "html",
        resourceId,
        key: f.key,
        digest: f.digest,
        order,
        poolSig: poolSignature(order),
        cacheModel,
        htmlPlan,
      });
    } else if (klass === "liquid_html") {
      const { plan: htmlPlan, liquidTokens } = liquidHtmlNodePartsOf(f.value);
      if (htmlPlan.nodeParts.length === 0) {
        rm.set(f.key, {
          key: f.key,
          translatedValue: f.value,
          digest: f.digest,
          status: "translated",
          cost: { provider: "skip" },
        });
        continue;
      }
      htmlPlan.nodeParts.forEach((parts) => parts.forEach((p) => addUnit(order, p)));
      plans.push({
        kind: "liquid_html",
        resourceId,
        key: f.key,
        digest: f.digest,
        order,
        poolSig: poolSignature(order),
        cacheModel,
        htmlPlan,
        liquidTokens,
      });
    } else if (klass === "json") {
      const root = tryParseJsonContainer(f.value);
      if (root === undefined) {
        const parts = splitPlainText(f.value);
        parts.forEach((p) => addUnit(order, p));
        plans.push({
          kind: "plain",
          resourceId,
          key: f.key,
          digest: f.digest,
          order,
          poolSig: poolSignature(order),
          cacheModel,
          parts,
        });
      } else {
        const slots = extractJsonTextSlots(root);
        if (slots.length === 0) {
          rm.set(f.key, {
            key: f.key,
            translatedValue: f.value,
            digest: f.digest,
            status: "translated",
            cost: { provider: "skip" },
          });
          continue;
        }
        const slotPlans: JsonSlotPlan[] = [];
        for (const slot of slots) {
          if (slot.isHtml) {
            const htmlPlan = htmlNodePartsOf(slot.text);
            if (htmlPlan.nodeParts.length === 0) {
              slotPlans.push({ ...slot });
              continue;
            }
            htmlPlan.nodeParts.forEach((parts) => parts.forEach((p) => addUnit(order, p)));
            slotPlans.push({ ...slot, htmlPlan });
          } else {
            addUnit(order, slot.text);
            slotPlans.push({ ...slot });
          }
        }
        plans.push({
          kind: "json",
          resourceId,
          key: f.key,
          digest: f.digest,
          order,
          poolSig: poolSignature(order),
          cacheModel,
          originalValue: f.value,
          root,
          slotPlans,
        });
      }
    } else if (klass === "list") {
      const list = JSON.parse(f.value) as Array<string | null>;
      const elements: ListElementPlan[] = [];
      for (let i = 0; i < list.length; i++) {
        const el = list[i];
        if (!el) continue;
        if (isHtml(el)) {
          const htmlPlan = htmlNodePartsOf(el);
          if (htmlPlan.nodeParts.length === 0) continue;
          htmlPlan.nodeParts.forEach((parts) => parts.forEach((p) => addUnit(order, p)));
          elements.push({ index: i, text: el, htmlPlan });
        } else {
          addUnit(order, el);
          elements.push({ index: i, text: el });
        }
      }
      if (elements.length === 0) {
        rm.set(f.key, {
          key: f.key,
          translatedValue: f.value,
          digest: f.digest,
          status: "translated",
          cost: { provider: "skip" },
        });
        continue;
      }
      plans.push({
        kind: "list",
        resourceId,
        key: f.key,
        digest: f.digest,
        order,
        poolSig: poolSignature(order),
        cacheModel,
        originalValue: f.value,
        elements,
      });
    } else {
      const isHandle = isHandleFieldKey(f.key);
      // Short plain (trivial) shares a dedicated pool so JSON-pack limits stay separate from rich.
      const isShort = !isHandle && tier === "trivial";
      const sourceText = isHandle ? prepareHandleSourceText(f.value) : f.value;
      const parts = splitPlainText(sourceText);
      const poolOpts: PoolSigOpts = { isHandle, isShort };
      const poolSig = poolSignature(order, poolOpts);
      parts.forEach((p) => addUnit(order, p, poolOpts));
      plans.push({
        kind: "plain",
        resourceId,
        key: f.key,
        digest: f.digest,
        order,
        poolSig,
        cacheModel,
        parts,
        isHandle,
      });
    }
  }

  // Credit cache hits immediately so the bar reflects them (0 LLM tokens for TM hits).
  if (cacheUnits > 0 && onProgress) await onProgress(cacheUnits, 0);

  const plansByResource = new Map<string, FieldPlan[]>();
  for (const plan of plans) {
    const list = plansByResource.get(plan.resourceId) ?? [];
    list.push(plan);
    plansByResource.set(plan.resourceId, list);
  }

  const reconstructedResources = new Set<string>();

  const buildResourceOutput = (res: ResourceInput): TranslatedResourceOutput => {
    const rm = resultMaps.get(res.resourceId)!;
    return {
      resourceId: res.resourceId,
      results: res.fields.map(
        (f) =>
          rm.get(f.key) ?? {
            key: f.key,
            translatedValue: f.value,
            digest: f.digest,
            status: "fallback" as const,
          },
      ),
    };
  };

  let finishLock: Promise<void> = Promise.resolve();
  const finishReadyResources = async (lookup: LookupFn): Promise<void> => {
    await (finishLock = finishLock.then(async () => {
      if (await abortRequested()) return;
      for (const res of resources) {
        if (reconstructedResources.has(res.resourceId)) continue;
        const resourcePlans = plansByResource.get(res.resourceId);
        if (!resourcePlans) {
          reconstructedResources.add(res.resourceId);
          if (onResourceDone) await onResourceDone(buildResourceOutput(res));
          continue;
        }
        if (!resourcePlans.every((plan) => planTextsReady(plan, lookup))) continue;
        const rm = resultMaps.get(res.resourceId)!;
        for (const plan of resourcePlans) {
          reconstructPlan(plan, rm, lookup, tmWrites, shopName, target, source, skipCacheWrite);
        }
        reconstructedResources.add(res.resourceId);
        if (onResourceDone) await onResourceDone(buildResourceOutput(res));
      }
    }));
  };

  // Resources fully resolved in step 1 (skip/cache only) count immediately.
  await finishReadyResources(() => undefined);

  // 2. Translate unique texts per engine order, in char-bounded batches.
  //    Before LLM: value-TM lookup per unique leaf (digest if any, else CRC-32).
  //    Hits go into translated map; misses go to batch. AdaptiveSemaphore throttles.
  const usage: EngineUsage = {};
  const translated = new Map<string, Map<string, RoutedResult>>();
  let quotaStopped = false;
  for (const [sig, occ] of pools) {
    if (quotaStopped || (await abortRequested())) break;
    const { order, isHandle, isShort } = parsePoolSignature(sig);
    const cacheModel = engineModel(order[0]!, aiModel);
    const allTexts = [...occ.keys()];
    const tmap = new Map<string, RoutedResult>();

    // 2a. Value-TM prefilter for every unique leaf in this pool (before JSON pack).
    if (!skipCacheRead) {
      const leafHits = await tmMGetByValue(
        allTexts.map((text) => ({ sourceText: text, model: cacheModel })),
        source,
        target,
      );
      let leafCacheUnits = 0;
      for (let i = 0; i < allTexts.length; i++) {
        const hit = leafHits[i];
        if (hit === null) continue;
        const text = allTexts[i]!;
        logSingleTranslatePath(logSingleTranslate, "cache", {
          kind: "leaf_value",
          original: text,
          translated: hit,
          cacheModel,
          poolSig: sig,
        });
        tmap.set(text, {
          value: hit,
          status: "translated",
          engine: null,
          tokens: 0,
          cost: { provider: "cache" },
        });
        leafCacheUnits += occ.get(text) ?? 1;
      }
      if (leafCacheUnits > 0 && onProgress) await onProgress(leafCacheUnits, 0, 0);
      if (tmap.size > 0) {
        translated.set(sig, tmap);
        const lookupHit: LookupFn = (poolSig, text) => translated.get(poolSig)?.get(text);
        await finishReadyResources(lookupHit);
      }
    }

    // Cache misses only: deduped unique texts → size-capped JSON packs.
    const texts = allTexts.filter((t) => !tmap.has(t));
    if (texts.length === 0) {
      translated.set(sig, tmap);
      continue;
    }

    const items: TranslateItem[] = texts.map((t, i) => ({ key: String(i), value: t, digest: "" }));
    const { maxChars, maxItems } = resolveBatchLimits(order, { isShort });
    const batches = batchByChars(items, maxChars, maxItems);
    // Wait for the whole batch wave (incl. in-flight LLM) before moving on.
    await Promise.all(batches.map(async (batch) => {
      if (await abortRequested()) return;
      const routed = await translateItemsRouted(
        batch,
        source,
        target,
        aiModel,
        shopName,
        order,
        isHandle ? "handle" : "default",
        profileBlock,
        customPrompt,
        logSingleTranslate,
      );
      if (routed.quotaStopped) quotaStopped = true;
      let batchUnits = 0;
      for (const [k, v] of routed.results) {
        const text = texts[Number(k)];
        if (text === undefined) continue;
        tmap.set(text, v);
        batchUnits += occ.get(text) ?? 1;
        if (v.status === "translated" && v.engine) {
          const model = engineModel(v.engine, aiModel);
          const acc = (usage[model] ??= { units: 0, chars: 0, tokens: 0 });
          acc.units += 1;
          acc.chars += text.length;
          acc.tokens += v.tokens;
          // Value TM keyed by pool primary model so step-2a reads match writes.
          if (!skipCacheWrite) {
            tmWrites.push(tmSetByValue(text, source, target, cacheModel, v.value));
          }
        }
      }
      translated.set(sig, tmap);
      if (onProgress) await onProgress(batchUnits, routed.llmTokens, routed.googleCredits);
      const lookup: LookupFn = (poolSig, text) => translated.get(poolSig)?.get(text);
      await finishReadyResources(lookup);
    }));
    translated.set(sig, tmap);
  }

  if (!quotaStopped && !(await abortRequested())) {
    const retry = await retryPoolFallbacks(
      translated,
      pools,
      source,
      target,
      aiModel,
      shopName,
      abortRequested,
      profileBlock,
      customPrompt,
      skipCacheWrite
        ? undefined
        : (text, r, poolPrimaryModel) => {
            tmWrites.push(tmSetByValue(text, source, target, poolPrimaryModel, r.value));
          },
      logSingleTranslate,
      usage,
      onProgress,
    );
    if (retry.quotaStopped) quotaStopped = true;
    if (retry.retried > 0) {
      console.log(`[llm] individually retried ${retry.retried} fallback/untranslated text unit(s)`);
      reconstructedResources.clear();
    }
  }

  const lookup: LookupFn = (poolSig, text) => translated.get(poolSig)?.get(text);
  await finishReadyResources(lookup);
  if (tmWrites.length > 0) await Promise.all(tmWrites);

  // 4. Assemble per-resource results aligned to input field order.
  const out = resources.map((res) => {
    const rm = resultMaps.get(res.resourceId)!;
    return {
      resourceId: res.resourceId,
      results: res.fields.map((f) =>
        enforceTranslateResultLimits(
          rm.get(f.key) ?? {
            key: f.key,
            translatedValue: f.value,
            digest: f.digest,
            status: "fallback" as const,
          },
          res.module,
        ),
      ),
    };
  });
  return { resources: out, usage, quotaStopped: quotaStopped || undefined };
}

/**
 * Translate all fields for a single resource. Thin wrapper over translateResources.
 */
export async function translateBatch(
  items: TranslateItem[],
  source: string,
  target: string,
  aiModel: string,
  shopName: string,
  options?: TranslateResourcesOptions,
): Promise<TranslateResult[]> {
  const { resources } = await translateResources(
    [{ resourceId: "__single__", fields: items }],
    source,
    target,
    aiModel,
    shopName,
    undefined,
    undefined,
    undefined,
    options,
  );
  return resources[0].results;
}
