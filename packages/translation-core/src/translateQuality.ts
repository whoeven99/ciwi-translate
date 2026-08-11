/** Translation output quality checks — shared by worker batch and TSF single translate. */

/** Set `TRANSLATE_QUALITY_GATE=false` to skip echo / wrong-script / hallucination / sentinel gates. */
export function isTranslateQualityGateEnabled(): boolean {
  return process.env.TRANSLATE_QUALITY_GATE !== "false";
}

const LATIN_WORD_RE = /[a-zA-Z]{2,}/;
const CJK_RE = /[一-鿿㐀-䶿]/u;

function hasLatinWords(text: string): boolean {
  return LATIN_WORD_RE.test(text);
}

function hasCjk(text: string): boolean {
  return CJK_RE.test(text);
}

function targetLangCode(target: string): string {
  return target.toLowerCase().split(/[-_]/)[0] ?? target.toLowerCase();
}

function hasTargetScriptChars(text: string, targetLang: string): boolean {
  switch (targetLang) {
    case "zh":
      return /[一-鿿㐀-䶿]/u.test(text);
    case "ja":
      return /[ぁ-ゖァ-ヶ一-鿿]/u.test(text);
    case "ko":
      return /[가-힣ᄀ-ᇿ]/u.test(text);
    case "ar":
      return /[؀-ۿ]/u.test(text);
    case "ru":
    case "uk":
    case "bg":
      return /[Ѐ-ӿ]/u.test(text);
    case "th":
      return /[฀-๿]/u.test(text);
    case "hi":
    case "mr":
    case "ne":
      return /[ऀ-ॿ]/u.test(text);
    default:
      return false;
  }
}

/**
 * Structural leaves that must be kept byte-for-byte and never sent to an LLM.
 * Includes htmlTranslate's <br> placeholder ⟦BR⟧ and the ascii lookalike [BR].
 */
const PASSTHROUGH_LEAF_RE = /^(?:\u27E6BR\u27E7|\[BR\])$/i;

/** True for line-break / structure tokens that should bypass translation engines. */
export function isPassthroughLeafText(text: string): boolean {
  return PASSTHROUGH_LEAF_RE.test(text.trim());
}

export function isTranslatableLeafText(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (isPassthroughLeafText(t)) return false;
  return true;
}

export function looksLikeUntranslated(
  source: string,
  translated: string,
  target: string,
): boolean {
  if (!isTranslateQualityGateEnabled()) return false;
  const tl = targetLangCode(target);
  if (tl === "en") return false;

  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const src = norm(source);
  const tr = norm(translated);
  if (!src || !tr) return false;
  // Preserving structural tokens (e.g. ⟦BR⟧ / [BR]) is correct, not an echo failure.
  if (isPassthroughLeafText(src)) return false;

  if (src === tr && hasLatinWords(src)) return true;

  if (["zh", "ja", "ko"].includes(tl) && src.length > 40 && hasLatinWords(src)) {
    const latinChars = src.match(/[a-zA-Z]/g)?.length ?? 0;
    if (latinChars / src.length > 0.45 && !hasTargetScriptChars(tr, tl)) {
      return true;
    }
  }
  return false;
}

/** CJK leaked into a non-CJK target when the source leaf had none. */
export function looksLikeWrongScriptLeak(
  source: string,
  translated: string,
  target: string,
): boolean {
  if (!isTranslateQualityGateEnabled()) return false;
  const tl = targetLangCode(target);
  if (["zh", "ja", "ko"].includes(tl)) return false;
  return hasCjk(translated) && !hasCjk(source);
}

/** LLM invented content for an empty source leaf (e.g. empty description → "S3"). */
export function looksLikeEmptySourceHallucination(source: string, translated: string): boolean {
  if (!isTranslateQualityGateEnabled()) return false;
  if (source.trim() !== "") return false;
  return translated.trim() !== "";
}

/** Model echoed the prompt's "number" wording instead of preserving ⟦N⟧ sentinels. */
export function hasPromptSentinelLeakage(text: string): boolean {
  if (!isTranslateQualityGateEnabled()) return false;
  return /\[number\]/i.test(text);
}

/**
 * Glossary applicability is driven only by rangeCode:
 * - null / empty / "ALL" → applies to any target (DB already scoped the load)
 * - explicit locale (e.g. zh-CN) → only when target shares the same language family
 *
 * targetText / sourceText are unused; kept for call-site compatibility.
 */
export function glossaryTargetMatchesLocale(
  _targetText: string,
  _sourceText: string,
  target: string,
  rangeCode?: string | null,
): boolean {
  if (!rangeCode?.trim() || rangeCode.toUpperCase() === "ALL") return true;
  return targetLangCode(rangeCode) === targetLangCode(target);
}
