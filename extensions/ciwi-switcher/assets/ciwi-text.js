// Shared text helpers for Custom Liquid / PageFly / auto-collect.
export const isElementHiddenForTranslation = (element) => {
  if (!element || !(element instanceof Element)) return false;
  if (typeof element.checkVisibility === "function") {
    return !element.checkVisibility({ checkOpacity: false });
  }
  return element.offsetParent === null && element !== document.body;
};

// 文本翻译共享工具（CustomLiquidTextTranslate / PageFlyTextTranslate 共用）

// 不应替换文本内容的标签
export const skipTags = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "CODE",
  "PRE",
  "TEXTAREA",
  "SVG",
  "META",
  "LINK",
  "TITLE",
]);

export const normalizeHtmlWhitespaceEntities = (text) =>
  String(text ?? "")
    .replace(/&(nbsp|#160|#xa0|#xA0|#8239|#x202f);?/g, " ")
    .replace(/[\u00A0\u202F]/g, " ");

// 去除首尾空白与成对的外层引号，并统一 HTML 空白实体格式
export const normalizeText = (text) =>
  normalizeHtmlWhitespaceEntities(text)
    .trim()
    .replace(/^["“”]+|["“”]+$/g, "");

export const normalizeCollapsedText = (text) => normalizeText(text).replace(/\s+/g, " ").trim();

export const shouldFlexibleWhitespaceMatch = (text) =>
  /[\n\r]/.test(text || "") || /\s{2,}/.test(text || "") || /[.!?]\S/.test(text || "");

export const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const normalizeSentenceSpacing = (text) =>
  String(text ?? "").replace(/([.!?])(?=[^\s.!?])/g, "$1 ");

export const getSentenceAwareCollapsedText = (text) =>
  normalizeCollapsedText(normalizeSentenceSpacing(text));

export const getFlexibleMatchKey = (text) =>
  shouldFlexibleWhitespaceMatch(text)
    ? getSentenceAwareCollapsedText(text)
    : normalizeText(text);

export const getNodeMatchKeys = (text) => ({
  strict: normalizeText(text),
  collapsed: getSentenceAwareCollapsedText(text),
});

export const buildFlexibleWhitespacePattern = (text) => {
  const collapsed = getSentenceAwareCollapsedText(text);
  if (!collapsed) return "";

  return collapsed
    .split(" ")
    .map((part) => escapeRegExp(part))
    .join("[\\s\\u00A0\\u202F]*");
};

export const createPreparedTextEntry = (before, after) => {
  const trimmedBefore = before?.trim();
  const afterRaw = String(after ?? "");
  if (!trimmedBefore || afterRaw.trim() === "") return null;

  const flexibleWhitespace = shouldFlexibleWhitespaceMatch(trimmedBefore);
  return {
    trimmedBefore,
    afterRaw,
    flexibleWhitespace,
    matchKey: getFlexibleMatchKey(trimmedBefore),
    collapsedBefore: flexibleWhitespace
      ? getSentenceAwareCollapsedText(trimmedBefore)
      : null,
    re: new RegExp(buildFlexibleWhitespacePattern(trimmedBefore), "g"),
  };
};

export const normalizePageFlyTranslationEntries = (response) => {
  if (Array.isArray(response)) return response;
  if (!response || typeof response !== "object") return [];

  return Object.entries(response).flatMap(([sourceText, rawValue]) => {
    if (!sourceText) return [];

    if (typeof rawValue === "string") {
      return [{ sourceText, targetText: rawValue }];
    }

    if (Array.isArray(rawValue)) {
      const [targetText] = rawValue;
      return typeof targetText === "string" && targetText
        ? [{ sourceText, targetText }]
        : [];
    }

    if (rawValue && typeof rawValue === "object") {
      const targetText =
        rawValue.targetText ?? rawValue.text ?? rawValue.translation ?? rawValue.value;
      return typeof targetText === "string" && targetText
        ? [{ sourceText, targetText }]
        : [];
    }

    return [];
  });
};

// 文本是否被一对外层引号包裹
export const hasOuterQuote = (text) => /^["“”]/.test(text) && /["“”]$/.test(text);
