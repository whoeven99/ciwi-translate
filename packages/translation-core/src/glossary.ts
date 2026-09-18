import {
  hasTranslationCoreGlossaryLoader,
  loadTranslationCoreGlossaryRows,
} from "./runtime.js";
import { glossaryTargetMatchesLocale } from "./translateQuality.js";

/**
 * Per-shop glossary injected into the translation system prompt so wording
 * stays consistent.
 *
 * Source of truth: TSF Prisma/Turso `Glossary` table (迁移自旧 Java 术语表)。
 * 适用范围以 rangeCode 为准：DB 层 rangeCode == target / "ALL" / null；
 * 注入前对显式 rangeCode 再按语族匹配（ALL/null 不限）。
 *
 * 产出的行做了确定性排序，使系统提示词前缀字节稳定 → 命中 LLM 的 prompt 缓存。
 */

export type GlossaryTerm = {
  source: string;
  translations?: Record<string, string>;
  doNotTranslate?: boolean;
  note?: string;
};

/** A prompt line plus the source term it constrains, so callers can filter by relevance. */
export type GlossaryEntry = {
  term: string;
  line: string;
};

type CacheEntry = {
  entries: GlossaryEntry[];
  expiresAt: number;
};
const cache = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60_000;

/**
 * 返回某店 + target 语言的术语表条目（从 TSF Turso 读）。
 * 无术语表或 TSF 未配置时返回空数组。进程内缓存 5 分钟。永不抛错。
 */
export async function loadGlossaryEntries(
  shopName: string,
  target: string,
): Promise<GlossaryEntry[]> {
  const cacheKey = `${shopName}::${target}`;
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.entries;

  let entries: GlossaryEntry[] = [];
  try {
    if (hasTranslationCoreGlossaryLoader()) {
      const rows = await loadTranslationCoreGlossaryRows(shopName, target);
      const seen = new Set<string>();
      entries = rows
        .filter((r) => r.sourceText && r.targetText)
        .filter((r) =>
          glossaryTargetMatchesLocale(
            r.targetText!,
            r.sourceText!,
            target,
            r.rangeCode,
          ),
        )
        .map((r) => ({
          term: r.sourceText!,
          line: `- Translate "${r.sourceText}" as "${r.targetText}".`,
        }))
        .filter((entry) => {
          if (seen.has(entry.line)) return false;
          seen.add(entry.line);
          return true;
        })
        // 确定性排序，保持系统提示词字节稳定（利于 prompt 缓存）。
        .sort((a, b) => (a.line < b.line ? -1 : a.line > b.line ? 1 : 0));
    }
  } catch (err) {
    console.error(`[glossary] 读取 TSF 术语表失败 shop=${shopName}:`, err);
    entries = [];
  }

  cache.set(cacheKey, { entries, expiresAt: now + TTL_MS });
  return entries;
}

/** 整表指令行。预估等「不看具体文本」的场景用。 */
export async function loadGlossaryLines(shopName: string, target: string): Promise<string[]> {
  return (await loadGlossaryEntries(shopName, target)).map((e) => e.line);
}

/**
 * 只保留这批文本里真的出现过的术语。
 *
 * 术语表是整表塞进**每一个**批次的 system prompt 的，而一批通常只有一两千字符
 * 正文——术语一多，商户就在为一堆跟本批毫不相干的指令付 token。源文本里不含该
 * 术语时，这行指令不可能影响输出，删掉是语义无损的。
 *
 * 匹配用大小写不敏感的子串（宁可多留不可漏留），所以 "shoe" 仍能覆盖 "Shoes"。
 */
export function selectGlossaryLinesForTexts(
  entries: GlossaryEntry[],
  texts: string[],
): string[] {
  if (entries.length === 0) return [];
  const haystack = texts.join("\n").toLowerCase();
  if (!haystack) return [];
  return entries
    .filter((entry) => {
      const term = entry.term.trim().toLowerCase();
      return term.length > 0 && haystack.includes(term);
    })
    .map((entry) => entry.line);
}

/** @internal test helper to reset the in-memory cache. */
export function __clearGlossaryCache(): void {
  cache.clear();
}
