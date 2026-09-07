import {
  ParseLiquidDataByShopNameAndLanguage,
  ReadTranslatedText,
} from "./ciwi-api.js";
import {
  asCacheableTranslationResponse,
  buildTranslationCacheKey,
  CIWI_EMPTY_TRANSLATION_TTL_MS,
  CIWI_TRANSLATION_TTL_MS,
} from "./ciwi-page.js";
import { getWithTTL, useCacheThenRefresh } from "./ciwi-storage.js";
import { isPriceRelatedElement } from "./ciwi-utils.js";
import {
  createPreparedTextEntry,
  getNodeMatchKeys,
  getSentenceAwareCollapsedText,
  hasOuterQuote,
  isElementHiddenForTranslation,
  normalizeCollapsedText,
  normalizeHtmlWhitespaceEntities,
  normalizePageFlyTranslationEntries,
  normalizeText,
  skipTags,
} from "./ciwi-text.js";

const LIQUID_REPLACE_SLICE_MS = 8;
const LIQUID_REPLACE_PUMP_GEN_KEY = "__ciwi_liquid_replace_pump_gen__";
const LIQUID_REPLACE_PUMP_ACTIVE_KEY = "__ciwi_liquid_replace_pump_active__";

const liquidReplaceNow = () =>
  typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();

const scheduleLiquidReplaceSlice = (fn) => {
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    window.requestIdleCallback(fn, { timeout: 1000 });
  } else {
    setTimeout(fn, 0);
  }
};

const runLiquidReplacePump = (nextWork, isAborted) =>
  new Promise((resolve) => {
    const pump = (deadline) => {
      if (isAborted()) {
        resolve();
        return;
      }
      const sliceStart = liquidReplaceNow();
      const exhausted = () => {
        if (
          deadline &&
          typeof deadline.timeRemaining === "function" &&
          deadline.timeRemaining() < 1
        ) {
          return true;
        }
        return liquidReplaceNow() - sliceStart >= LIQUID_REPLACE_SLICE_MS;
      };
      while (nextWork()) {
        if (isAborted()) {
          resolve();
          return;
        }
        if (exhausted()) {
          scheduleLiquidReplaceSlice(pump);
          return;
        }
      }
      resolve();
    };
    pump();
  });

/**
 * 根据数据库数据替换网页文本（安全版）
 */
export async function CustomLiquidTextTranslate(
  blockId,
  shop,
  ciwiBlock,
  options = {},
) {
  const { allowNetwork = true } = options;
  const languageInput = ciwiBlock.querySelector('input[name="language_code"]');
  const language = languageInput?.value;
  if (!language) return;

  const cacheKey = buildTranslationCacheKey("liquid_translations", [
    shop.value,
    language,
  ]);
  let parseLiquidDataByShopNameAndLanguage;
  if (!allowNetwork) {
    parseLiquidDataByShopNameAndLanguage = getWithTTL(cacheKey);
    if (!parseLiquidDataByShopNameAndLanguage) return;
  } else {
    // 空规则：服务端已返回 success+{}，可写入 localStorage 负缓存；
    // 短 TTL + 跳过后台刷新，避免无 LiquidRule 店每次 pageview 打 App Proxy。
    parseLiquidDataByShopNameAndLanguage = await useCacheThenRefresh(
      cacheKey,
      async () =>
        asCacheableTranslationResponse(
          await ParseLiquidDataByShopNameAndLanguage({
            shopName: shop.value,
            languageCode: language,
          }),
        ),
      CIWI_TRANSLATION_TTL_MS,
      {
        skipRefreshWhenEmpty: true,
        emptyTtlMs: CIWI_EMPTY_TRANSLATION_TTL_MS,
      },
    );
  }

  const translations = parseLiquidDataByShopNameAndLanguage?.response || [];
  if (!translations || Object.keys(translations).length === 0) return;

  // 🧮 辅助函数（normalizeText / hasOuterQuote / skipTags 见模块顶部共享定义）
  // 将 translations 拆分成精准匹配和模糊匹配
  const entries = Object.entries(translations).map(
    ([before, [after, isExact]]) => ({
      before,
      after: normalizeHtmlWhitespaceEntities(after),
      isExact: Boolean(isExact),
    }),
  );

  const exactEntries = entries.filter((e) => e.isExact);
  // 长句先换，避免 Cable / Parking Monitoring 等短规则截断整句。
  // 稳定排序：同长度保留服务端 createdAt 降序（含旧缓存的插入序）。
  const fuzzyEntries = entries
    .filter((e) => !e.isExact)
    .sort((a, b) => String(b.before).length - String(a.before).length);

  const looksLikeHtml = (text) => /<\/?[a-z][\s\S]*>/i.test(text || "");

  const sourceNeedles = [];
  const addSourceNeedle = (value) => {
    const trimmed = String(value ?? "").trim();
    if (!trimmed) return;
    sourceNeedles.push(trimmed);
    const collapsed = normalizeCollapsedText(trimmed);
    if (collapsed && collapsed !== trimmed) sourceNeedles.push(collapsed);
    if (looksLikeHtml(trimmed)) {
      const stripped = normalizeCollapsedText(trimmed.replace(/<[^>]+>/g, " "));
      if (stripped) sourceNeedles.push(stripped);
    }
  };
  entries.forEach((entry) => addSourceNeedle(entry.before));

  const rootHasPendingSourceText = (root) => {
    if (!(root instanceof Node) || sourceNeedles.length === 0) return false;
    const raw = String(root.textContent || "");
    if (!raw) return false;
    const collapsed = normalizeCollapsedText(raw);
    return sourceNeedles.some(
      (needle) => raw.includes(needle) || collapsed.includes(needle),
    );
  };

  // 默认开；localStorage.ciwi_debug_liquid_translate=0 或 ?ciwiDebugLiquid=0 可关。
  const debugLiquidTranslate = (() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("ciwiDebugLiquid") === "0") return false;
      if (params.has("ciwiDebugLiquid")) return true;
      const flag = localStorage.getItem("ciwi_debug_liquid_translate");
      if (flag === "0" || flag === "false") return false;
      return true;
    } catch {
      return true;
    }
  })();

  const debugLog = (...args) => {
    if (!debugLiquidTranslate) return;
    console.log("[ciwi-liquid-translate]", ...args);
  };

  const summarize = (text, max = 240) => {
    const str = String(text ?? "");
    return str.length > max ? `${str.slice(0, max)}…(${str.length})` : str;
  };

  let debugReplaceTextCount = 0;

  const preserveBoundaryWhitespace = (original, replacement) => {
    const prefix = String(original ?? "").match(/^\s*/)?.[0] || "";
    const suffix = String(original ?? "").match(/\s*$/)?.[0] || "";
    return `${prefix}${String(replacement ?? "")}${suffix}`;
  };

  debugLog("init", {
    blockId,
    language,
    total: entries.length,
    exact: exactEntries.length,
    fuzzy: fuzzyEntries.length,
  });

  if (debugLiquidTranslate) {
    const htmlCount = entries.filter(({ before, after }) => {
      try {
        return looksLikeHtml(before) || looksLikeHtml(after);
      } catch {
        return false;
      }
    }).length;
    const maxBeforeLen = entries.reduce((max, e) => {
      const len = String(e?.before ?? "").length;
      return len > max ? len : max;
    }, 0);
    debugLog("entriesSample", {
      htmlCount,
      maxBeforeLen,
      sample: entries.slice(0, 20).map((e) => ({
        isExact: e.isExact,
        beforeLen: String(e.before ?? "").length,
        afterLen: String(e.after ?? "").length,
        before: summarize(e.before, 320),
        after: summarize(e.after, 160),
      })),
    });
  }

  const decodeHtmlEntities = (html) => {
    if (!html) return "";
    const textarea = document.createElement("textarea");
    textarea.innerHTML = normalizeHtmlWhitespaceEntities(html);
    return textarea.value;
  };

  const normalizeHtml = (html) => {
    const raw = normalizeText(decodeHtmlEntities(html));
    if (!raw) return "";
    const template = document.createElement("template");
    template.innerHTML = raw;
    const serialized =
      template.content.childElementCount === 1
        ? template.content.firstElementChild.outerHTML
        : template.innerHTML;
    return serialized.replace(/\s+/g, " ").replace(/>\s+</g, "><").trim();
  };

  const parseSingleRootElement = (html) => {
    const raw = normalizeText(decodeHtmlEntities(html));
    if (!raw) return null;
    const template = document.createElement("template");
    template.innerHTML = raw;
    if (template.content.childElementCount !== 1) return null;
    return template.content.firstElementChild;
  };

  const isCustomElementName = (tagName) => String(tagName || "").includes("-");

  const containsCustomElements = (node) => {
    if (!(node instanceof Element)) return false;
    if (isCustomElementName(node.tagName)) return true;
    return Array.from(node.querySelectorAll("*")).some((child) =>
      isCustomElementName(child.tagName),
    );
  };

  const makeHtmlJob = (entryList, root) => {
    if (!root?.isConnected) return null;
    const htmlEntries = entryList
      .filter(({ before, after }) => looksLikeHtml(before) || looksLikeHtml(after))
      .map(({ before, after }) => {
        const beforeEl = parseSingleRootElement(before);
        const afterEl = parseSingleRootElement(after);
        return {
          normalizedBefore: normalizeHtml(before),
          normalizedAfter: normalizeText(decodeHtmlEntities(after)).trim(),
          normalizedBeforeInner: beforeEl ? normalizeHtml(beforeEl.innerHTML) : "",
          beforeEl,
          afterEl,
          rawBefore: before,
          rawAfter: after,
          beforeTag: beforeEl?.nodeName || null,
          afterTag: afterEl?.nodeName || null,
          beforeText: beforeEl ? normalizeCollapsedText(beforeEl.textContent) : "",
          afterInner: afterEl ? normalizeText(afterEl.innerHTML) : "",
          beforeClasses: beforeEl
            ? Array.from(beforeEl.classList || []).filter(Boolean)
            : [],
          containsCustomElements:
            containsCustomElements(beforeEl) || containsCustomElements(afterEl),
        };
      })
      .filter(
        (e) =>
          e.normalizedBefore &&
          e.normalizedAfter &&
          !e.containsCustomElements,
      );

    if (htmlEntries.length === 0) return null;

    const htmlMap = new Map();
    const innerMap = new Map();
    const textCandidatesByKey = new Map();
    // 廉价预筛用的候选集合：任意 outer/inner/text 命中都要求
    //   node.nodeName === 某条 before 元素的标签名，且节点折叠文本 === 某条源文本。
    // hasEmptyBeforeTextCandidate 覆盖“含元素但无文本”(如仅图片)的内联条目这一例外。
    const candidateTags = new Set();
    const candidateTexts = new Set();
    let hasEmptyBeforeTextCandidate = false;
    htmlEntries.forEach((e) => {
      htmlMap.set(e.normalizedBefore, e);
      if (e.beforeTag) candidateTags.add(e.beforeTag);
      if (e.beforeText) candidateTexts.add(e.beforeText);
      else if (e.beforeEl) hasEmptyBeforeTextCandidate = true;
      if (e.beforeEl && e.afterEl && e.normalizedBeforeInner) {
        const innerKey = `${e.beforeEl.nodeName}\0${e.normalizedBeforeInner}`;
        if (!innerMap.has(innerKey)) innerMap.set(innerKey, e);
      }
      if (e.beforeEl && e.afterEl && e.beforeText) {
        const textKey = `${e.beforeEl.nodeName}\0${e.beforeText}`;
        const bucket = textCandidatesByKey.get(textKey);
        if (bucket) bucket.push(e);
        else textCandidatesByKey.set(textKey, [e]);
      }
    });

    const hitStats = new Map();
    htmlEntries.forEach((e) => {
      hitStats.set(e.normalizedBefore, { outer: 0, inner: 0, text: 0 });
    });

    debugLog("htmlEntries", {
      count: htmlEntries.length,
      sample: htmlEntries.slice(0, 5).map((e) => ({
        before: summarize(e.rawBefore),
        normalizedBefore: summarize(e.normalizedBefore),
        beforeTag: e.beforeEl?.nodeName || null,
        afterTag: e.afterEl?.nodeName || null,
      })),
    });

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(node) {
          const tag = node?.nodeName;
          if (skipTags.has(tag)) return NodeFilter.FILTER_REJECT;
          if (ciwiBlock && ciwiBlock.contains(node)) return NodeFilter.FILTER_REJECT;
          if (isPriceRelatedElement(node)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      },
    );

    const replacements = [];
    let seededRoot = false;
    let applying = false;
    let applyIndex = 0;
    let loggedSummary = false;

    const matchHtmlNode = (node) => {
      if (isElementHiddenForTranslation(node)) return;
      if (isPriceRelatedElement(node)) return;
      if (candidateTags.size > 0 && !candidateTags.has(node.nodeName)) return;
      const nodeText = normalizeCollapsedText(node.textContent);
      if (nodeText) {
        if (!candidateTexts.has(nodeText)) return;
      } else if (!hasEmptyBeforeTextCandidate) {
        return;
      }

      const normalizedOuter = normalizeHtml(node.outerHTML);
      if (!normalizedOuter) return;
      const entry = htmlMap.get(normalizedOuter);
      if (entry) {
        replacements.push({ type: "outer", node, html: entry.normalizedAfter });
        const stats = hitStats.get(entry.normalizedBefore);
        if (stats) stats.outer += 1;
        debugLog("match:outer", {
          tag: node.nodeName,
          before: summarize(entry.rawBefore),
          nodeOuter: summarize(node.outerHTML),
        });
        return;
      }

      const normalizedInner = normalizeHtml(node.innerHTML);
      if (normalizedInner) {
        const innerCandidate = innerMap.get(`${node.nodeName}\0${normalizedInner}`);
        if (innerCandidate) {
          replacements.push({
            type: "inner",
            node,
            html: innerCandidate.afterInner,
          });
          const stats = hitStats.get(innerCandidate.normalizedBefore);
          if (stats) stats.inner += 1;
          debugLog("match:inner", {
            tag: node.nodeName,
            before: summarize(innerCandidate.rawBefore),
            nodeInner: summarize(node.innerHTML),
          });
          return;
        }
      }

      if (!nodeText) return;
      const textCandidates = textCandidatesByKey.get(`${node.nodeName}\0${nodeText}`);
      if (!textCandidates) return;
      for (const candidate of textCandidates) {
        if (candidate.beforeClasses.length > 0) {
          const ok = candidate.beforeClasses.every((c) => node.classList?.contains(c));
          if (!ok) continue;
        }
        replacements.push({
          type: "inner",
          node,
          html: candidate.afterInner,
        });
        const stats = hitStats.get(candidate.normalizedBefore);
        if (stats) stats.text += 1;
        debugLog("match:text", {
          tag: node.nodeName,
          before: summarize(candidate.rawBefore),
          nodeOuter: summarize(node.outerHTML),
        });
        return;
      }
    };

    return {
      step() {
        if (!applying) {
          if (!seededRoot) {
            seededRoot = true;
            if (
              root instanceof Element &&
              !skipTags.has(root.nodeName) &&
              !(ciwiBlock && ciwiBlock.contains(root)) &&
              !isPriceRelatedElement(root)
            ) {
              matchHtmlNode(root);
              return true;
            }
          }
          if (walker.nextNode()) {
            matchHtmlNode(walker.currentNode);
            return true;
          }
          applying = true;
        }
        if (applyIndex < replacements.length) {
          const { type, node, html } = replacements[applyIndex];
          applyIndex += 1;
          if (type === "outer") node.outerHTML = html;
          else node.innerHTML = html;
          return true;
        }
        if (debugLiquidTranslate && !loggedSummary) {
          loggedSummary = true;
          const missed = [];
          hitStats.forEach((stats, key) => {
            if (stats.outer === 0 && stats.inner === 0) missed.push(key);
          });
          debugLog("htmlSummary", {
            replaced: replacements.length,
            missed: missed.length,
            missedSample: missed.slice(0, 5).map((k) => summarize(k)),
          });
        }
        return false;
      },
    };
  };

  const makeFuzzyJob = (entryList, root) => {
    if (!root?.isConnected) return null;
    const preparedEntries = [];
    entryList.forEach(({ before, after }) => {
      const prepared = createPreparedTextEntry(before, after);
      if (!prepared) return;
      preparedEntries.push(prepared);
    });
    if (preparedEntries.length === 0) return null;

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parentTag = node.parentNode?.nodeName;
          if (skipTags.has(parentTag)) return NodeFilter.FILTER_REJECT;
          if (isPriceRelatedElement(node)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      },
    );

    return {
      step() {
        if (!walker.nextNode()) return false;
        const node = walker.currentNode;
        if (isElementHiddenForTranslation(node.parentElement)) return true;
        if (isPriceRelatedElement(node)) return true;

        let original = node.nodeValue;
        let normalized = normalizeText(original);
        let collapsed = null;

        for (const entry of preparedEntries) {
          if (entry.flexibleWhitespace && collapsed === null) {
            collapsed = getSentenceAwareCollapsedText(normalized);
          }
          const matches = entry.flexibleWhitespace
            ? collapsed.includes(entry.collapsedBefore)
            : normalized.includes(entry.trimmedBefore);
          if (!matches) continue;

          const newValue = original.replace(entry.re, () => entry.afterRaw);
          const newValueWithWhitespace = preserveBoundaryWhitespace(original, newValue);
          const keepQuote = hasOuterQuote(original);
          if (debugLiquidTranslate && debugReplaceTextCount < 20) {
            debugReplaceTextCount += 1;
            debugLog("replace:text", {
              before: summarize(original, 200),
              after: summarize(newValueWithWhitespace, 200),
            });
          }
          node.nodeValue = keepQuote ? `"${newValueWithWhitespace}"` : newValueWithWhitespace;
          original = node.nodeValue;
          normalized = normalizeText(original);
          collapsed = null;
        }
        return true;
      },
    };
  };

  const makeExactJob = (entryList, root) => {
    if (!root?.isConnected) return null;
    const exactMap = new Map();
    entryList.forEach(({ before, after }) => {
      const prepared = createPreparedTextEntry(before, after);
      if (!prepared) return;
      exactMap.set(prepared.matchKey, {
        replacement: prepared.afterRaw,
        flexibleWhitespace: prepared.flexibleWhitespace,
      });
    });
    if (exactMap.size === 0) return null;

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parentTag = node.parentNode?.nodeName;
          if (skipTags.has(parentTag)) return NodeFilter.FILTER_REJECT;
          if (ciwiBlock && node.parentElement && ciwiBlock.contains(node.parentElement))
            return NodeFilter.FILTER_REJECT;
          if (isPriceRelatedElement(node)) return NodeFilter.FILTER_REJECT;
          const { strict: strictKey, collapsed: collapsedKey } = getNodeMatchKeys(
            node.nodeValue,
          );
          if (exactMap.has(strictKey)) return NodeFilter.FILTER_ACCEPT;
          return exactMap.has(collapsedKey)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      },
    );

    return {
      step() {
        if (!walker.nextNode()) return false;
        const node = walker.currentNode;
        if (isElementHiddenForTranslation(node.parentElement)) return true;
        if (isPriceRelatedElement(node)) return true;
        const original = node.nodeValue;
        const { strict: strictKey, collapsed: collapsedKey } = getNodeMatchKeys(original);
        const entry = exactMap.get(strictKey) || exactMap.get(collapsedKey);
        if (!entry) return true;
        const keepQuote = hasOuterQuote(original);
        const replacement = preserveBoundaryWhitespace(original, entry.replacement);
        if (debugLiquidTranslate && debugReplaceTextCount < 20) {
          debugReplaceTextCount += 1;
          debugLog("replace:text", {
            before: summarize(original, 200),
            after: summarize(replacement, 200),
          });
        }
        node.nodeValue = keepQuote ? `"${replacement}"` : replacement;
        return true;
      },
    };
  };

  const textLikeAttributeNames = new Set([
    "alt",
    "aria-label",
    "caption",
    "header-text",
    "label",
    "placeholder",
    "subtitle",
    "text",
    "title",
  ]);

  const blockedAttributeNames = new Set([
    "class",
    "content",
    "href",
    "id",
    "name",
    "rel",
    "role",
    "src",
    "srcset",
    "style",
    "target",
    "value",
  ]);

  const isTranslatableAttribute = (node, attribute) => {
    if (!node || !attribute) return false;
    const attrName = String(attribute.name || "").trim().toLowerCase();
    if (!attrName || blockedAttributeNames.has(attrName)) return false;
    if (attrName.startsWith("data-")) return false;
    if (attrName.startsWith("on")) return false;
    if (!String(attribute.value ?? "").trim()) return false;
    if (textLikeAttributeNames.has(attrName) || attrName.startsWith("aria-")) {
      return true;
    }

    // 允许 web component 上常见的 *-text / *-title / *-label 这类展示属性。
    return Boolean(
      node.tagName?.includes("-") &&
        /(?:^|[-_:])(text|title|label|caption|subtitle)$/i.test(attrName),
    );
  };

  const makeAttrJob = (exactEntryList, fuzzyEntryList, root) => {
    if (!root?.isConnected) return null;

    const exactMap = new Map();
    exactEntryList.forEach(({ before, after }) => {
      const prepared = createPreparedTextEntry(before, after);
      if (!prepared) return;
      exactMap.set(prepared.matchKey, { replacement: prepared.afterRaw });
    });

    const fuzzyPreparedEntries = [];
    fuzzyEntryList.forEach(({ before, after }) => {
      const prepared = createPreparedTextEntry(before, after);
      if (!prepared) return;
      fuzzyPreparedEntries.push(prepared);
    });

    if (exactMap.size === 0 && fuzzyPreparedEntries.length === 0) return null;

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(node) {
          const tag = node?.nodeName;
          if (skipTags.has(tag)) return NodeFilter.FILTER_REJECT;
          if (ciwiBlock && ciwiBlock.contains(node)) return NodeFilter.FILTER_REJECT;
          if (isPriceRelatedElement(node)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      },
    );

    let seededRoot = false;

    const processAttrNode = (node) => {
      if (!(node instanceof Element)) return;
      if (isElementHiddenForTranslation(node)) return;
      if (isPriceRelatedElement(node)) return;

      Array.from(node.attributes || []).forEach((attribute) => {
        if (!isTranslatableAttribute(node, attribute)) return;

        const original = attribute.value;
        const { strict: strictKey, collapsed: collapsedKey } = getNodeMatchKeys(original);
        const exactEntry = exactMap.get(strictKey) || exactMap.get(collapsedKey);
        if (exactEntry) {
          const replacement = preserveBoundaryWhitespace(
            original,
            exactEntry.replacement,
          );
          if (debugLiquidTranslate && debugReplaceTextCount < 20) {
            debugReplaceTextCount += 1;
            debugLog("replace:attribute", {
              tag: node.nodeName,
              attr: attribute.name,
              before: summarize(original, 200),
              after: summarize(replacement, 200),
            });
          }
          node.setAttribute(attribute.name, replacement);
          return;
        }

        let nextValue = original;
        let normalized = normalizeText(nextValue);
        let collapsed = null;

        for (const entry of fuzzyPreparedEntries) {
          if (entry.flexibleWhitespace && collapsed === null) {
            collapsed = getSentenceAwareCollapsedText(normalized);
          }
          const matches = entry.flexibleWhitespace
            ? collapsed.includes(entry.collapsedBefore)
            : normalized.includes(entry.trimmedBefore);
          if (!matches) continue;

          nextValue = preserveBoundaryWhitespace(
            nextValue,
            nextValue.replace(entry.re, () => entry.afterRaw),
          );
          normalized = normalizeText(nextValue);
          collapsed = null;
        }

        if (nextValue !== original) {
          if (debugLiquidTranslate && debugReplaceTextCount < 20) {
            debugReplaceTextCount += 1;
            debugLog("replace:attribute", {
              tag: node.nodeName,
              attr: attribute.name,
              before: summarize(original, 200),
              after: summarize(nextValue, 200),
            });
          }
          node.setAttribute(attribute.name, nextValue);
        }
      });
    };

    return {
      step() {
        if (!seededRoot) {
          seededRoot = true;
          if (
            root instanceof Element &&
            !skipTags.has(root.nodeName) &&
            !(ciwiBlock && ciwiBlock.contains(root)) &&
            !isPriceRelatedElement(root)
          ) {
            processAttrNode(root);
            return true;
          }
        }
        if (!walker.nextNode()) return false;
        processAttrNode(walker.currentNode);
        return true;
      },
    };
  };

  const hasHtmlEntries = (entryList) =>
    entryList.some(
      ({ before, after }) => looksLikeHtml(before) || looksLikeHtml(after),
    );

  const shouldSkipTranslationRoot = (node) => {
    if (!node?.isConnected) return true;
    if (node.nodeType === Node.ELEMENT_NODE && skipTags.has(node.nodeName)) return true;
    if (ciwiBlock && node instanceof Element && ciwiBlock.contains(node)) return true;
    if (isPriceRelatedElement(node)) return true;
    return false;
  };

  const pruneNestedRoots = (roots) => {
    return roots.filter(
      (root, index) =>
        !roots.some(
          (other, otherIndex) =>
            otherIndex !== index && other !== root && other.contains(root),
        ),
    );
  };

  // 增量补译只打 class 包含 countdown-timer 的容器（如 bx-countdown-timer）。
  const COUNTDOWN_TIMER_SELECTOR = '[class*="countdown-timer"]';

  const isCountdownTimerElement = (node) => {
    if (!(node instanceof Element) || typeof node.matches !== "function") return false;
    try {
      return node.matches(COUNTDOWN_TIMER_SELECTOR);
    } catch {
      return false;
    }
  };

  const closestCountdownTimerRoot = (node) => {
    const start = node instanceof Element ? node : node?.parentElement;
    if (!start || typeof start.closest !== "function") return null;
    try {
      return start.closest(COUNTDOWN_TIMER_SELECTOR);
    } catch {
      return null;
    }
  };

  const collectCountdownTimerRootsIn = (scope) => {
    if (!(scope instanceof Element)) return [];
    const roots = [];
    if (isCountdownTimerElement(scope) && !shouldSkipTranslationRoot(scope)) {
      roots.push(scope);
    }
    try {
      scope.querySelectorAll(COUNTDOWN_TIMER_SELECTOR).forEach((el) => {
        if (!shouldSkipTranslationRoot(el)) roots.push(el);
      });
    } catch {}
    return pruneNestedRoots(roots);
  };

  const collectMutationRoots = (mutations) => {
    const roots = [];
    const pushFromNode = (node) => {
      const closest = closestCountdownTimerRoot(node);
      if (closest && !shouldSkipTranslationRoot(closest)) {
        roots.push(closest);
        return;
      }
      if (node instanceof Element) {
        collectCountdownTimerRootsIn(node).forEach((nested) => roots.push(nested));
      }
    };
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        pushFromNode(mutation.target);
        continue;
      }
      if (mutation.type !== "childList") continue;
      for (const node of mutation.addedNodes) {
        pushFromNode(node);
      }
    }
    return pruneNestedRoots(roots);
  };

  const applyReplacementsToRoots = (roots = [document.body], options = {}) => {
    const sliced = options.sliced === true;
    const pumpGen = options.pumpGen;
    if (
      !sliced &&
      typeof window !== "undefined" &&
      window[LIQUID_REPLACE_PUMP_ACTIVE_KEY]
    ) {
      return;
    }

    const targets = pruneNestedRoots(
      roots.filter((root) => root?.isConnected && !shouldSkipTranslationRoot(root)),
    );
    if (targets.length === 0) return sliced ? Promise.resolve() : undefined;

    const scopes = [];
    const seenScopes = new Set();
    const pushScope = (scope) => {
      if (!scope?.isConnected || seenScopes.has(scope)) return;
      seenScopes.add(scope);
      scopes.push(scope);
    };

    const shadowJobs = [];
    for (const root of targets) {
      pushScope(root);
      if (root instanceof Element && root.shadowRoot) {
        pushScope(root.shadowRoot);
      }
      const shadowWalker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_ELEMENT,
        {
          acceptNode(node) {
            const tag = node?.nodeName;
            if (skipTags.has(tag)) return NodeFilter.FILTER_REJECT;
            if (ciwiBlock && ciwiBlock.contains(node)) return NodeFilter.FILTER_REJECT;
            if (isPriceRelatedElement(node)) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          },
        },
      );
      shadowJobs.push({
        step() {
          if (!shadowWalker.nextNode()) return false;
          if (shadowWalker.currentNode.shadowRoot) {
            pushScope(shadowWalker.currentNode.shadowRoot);
          }
          return true;
        },
      });
    }

    const buildReplaceJobs = () => {
      const jobs = [];
      for (const root of scopes) {
        if (hasHtmlEntries(exactEntries) || hasHtmlEntries(fuzzyEntries)) {
          jobs.push(makeHtmlJob(exactEntries, root));
          jobs.push(makeHtmlJob(fuzzyEntries, root));
        }
        jobs.push(makeAttrJob(exactEntries, fuzzyEntries, root));
        jobs.push(makeExactJob(exactEntries, root));
        jobs.push(makeFuzzyJob(fuzzyEntries, root));
      }
      return jobs.filter(Boolean);
    };

    const runJobsSync = (jobs) => {
      for (const job of jobs) {
        while (job.step()) {}
      }
    };

    if (!sliced) {
      runJobsSync(shadowJobs);
      runJobsSync(buildReplaceJobs());
      return;
    }

    if (typeof window !== "undefined") {
      window[LIQUID_REPLACE_PUMP_ACTIVE_KEY] = true;
    }

    let phase = "shadow";
    let jobIndex = 0;
    let replaceJobs = [];
    const nextWork = () => {
      if (phase === "shadow") {
        while (jobIndex < shadowJobs.length) {
          if (shadowJobs[jobIndex].step()) return true;
          jobIndex += 1;
        }
        replaceJobs = buildReplaceJobs();
        phase = "replace";
        jobIndex = 0;
      }
      while (jobIndex < replaceJobs.length) {
        if (replaceJobs[jobIndex].step()) return true;
        jobIndex += 1;
      }
      return false;
    };

    return runLiquidReplacePump(
      nextWork,
      () =>
        typeof window !== "undefined" &&
        pumpGen != null &&
        window[LIQUID_REPLACE_PUMP_GEN_KEY] !== pumpGen,
    ).finally(() => {
      if (
        typeof window !== "undefined" &&
        (pumpGen == null || window[LIQUID_REPLACE_PUMP_GEN_KEY] === pumpGen)
      ) {
        window[LIQUID_REPLACE_PUMP_ACTIVE_KEY] = false;
      }
    });
  };

  const delayedTimeoutsKey = "__ciwi_liquid_translate_delayed_timeouts__";
  const firstRescanPromiseKey = "__ciwi_countdown_first_rescan_promise__";
  const firstRescanResolveKey = "__ciwi_countdown_first_rescan_resolve__";
  const observerKey = "__ciwi_liquid_translate_observer__";
  const countdownObserversKey = "__ciwi_countdown_timer_observers__";

  if (typeof window !== "undefined") {
    const previousDelayed = window[delayedTimeoutsKey];
    if (Array.isArray(previousDelayed)) {
      previousDelayed.forEach((id) => clearTimeout(id));
    }
    window[delayedTimeoutsKey] = [];
    const previousFirstRescanResolve = window[firstRescanResolveKey];
    if (typeof previousFirstRescanResolve === "function") {
      try {
        previousFirstRescanResolve();
      } catch {}
    }
    const previousCountdownObservers = window[countdownObserversKey];
    if (Array.isArray(previousCountdownObservers)) {
      previousCountdownObservers.forEach((observer) => {
        try {
          observer.disconnect();
        } catch {}
      });
    }
    window[countdownObserversKey] = [];
  }

  const pumpGen =
    typeof window !== "undefined"
      ? (Number(window[LIQUID_REPLACE_PUMP_GEN_KEY]) || 0) + 1
      : 1;
  if (typeof window !== "undefined") {
    window[LIQUID_REPLACE_PUMP_GEN_KEY] = pumpGen;
  }
  await applyReplacementsToRoots([document.body], { sliced: true, pumpGen });
  if (
    typeof window !== "undefined" &&
    window[LIQUID_REPLACE_PUMP_GEN_KEY] !== pumpGen
  ) {
    return;
  }

  if (typeof window !== "undefined") {
    const countdownObserveOptions = {
      childList: true,
      subtree: true,
      characterData: true,
    };

    window[countdownObserversKey] = [];
    const observedCountdownTimerRoots = new WeakSet();
    const countdownObserverByRoot = new WeakMap();
    const applyingCountdownRoots = new WeakSet();
    const lastCountdownLabelKey = new WeakMap();

    const countdownLabelKey = (node) =>
      normalizeCollapsedText(
        String(node?.textContent || "").replace(/\d+/g, ""),
      );

    // 同步写回：MutationObserver 在绘制前触发。若再 setTimeout/rAF，英文会被先画出来造成闪烁。
    const applyCountdownTimerRootNow = (root, observer) => {
      if (!(root instanceof Element) || !root.isConnected) return;
      if (applyingCountdownRoots.has(root)) return;
      const labelKey = countdownLabelKey(root);
      const lastLabelKey = lastCountdownLabelKey.get(root);
      if (lastLabelKey !== undefined && lastLabelKey === labelKey) return;
      if (!rootHasPendingSourceText(root)) {
        lastCountdownLabelKey.set(root, labelKey);
        return;
      }
      applyingCountdownRoots.add(root);
      try {
        observer?.disconnect();
      } catch {}
      try {
        applyReplacementsToRoots([root]);
        lastCountdownLabelKey.set(root, countdownLabelKey(root));
      } finally {
        applyingCountdownRoots.delete(root);
        if (observer && root.isConnected) {
          try {
            observer.observe(root, countdownObserveOptions);
          } catch {}
        }
      }
    };

    const observeCountdownTimerRoot = (root) => {
      if (!(root instanceof Element) || shouldSkipTranslationRoot(root)) return null;
      if (!isCountdownTimerElement(root)) return null;
      const existing = countdownObserverByRoot.get(root);
      if (existing) return existing;
      if (observedCountdownTimerRoots.has(root)) return null;
      observedCountdownTimerRoots.add(root);

      const isTimerDigitText = (value) => /^\d{1,2}$/.test(String(value || "").trim());

      const isTimerDigitOnlyNode = (node) => {
        if (!node) return true;
        if (node.nodeType === Node.TEXT_NODE) return isTimerDigitText(node.nodeValue);
        if (node.nodeType !== Node.ELEMENT_NODE) return true;
        const text = String(node.textContent || "").trim();
        if (!text) return true;
        return /^\d{1,2}(?:\s+\d{1,2})*$/.test(text);
      };

      const mutationTouchesNonDigitText = (mutation) => {
        if (mutation.type === "characterData") {
          return !isTimerDigitText(mutation.target?.nodeValue);
        }
        if (mutation.type !== "childList") return true;
        for (const node of mutation.addedNodes) {
          if (!isTimerDigitOnlyNode(node)) return true;
        }
        for (const node of mutation.removedNodes) {
          if (!isTimerDigitOnlyNode(node)) return true;
        }
        return false;
      };

      let applyQueued = false;
      const observer = new MutationObserver((mutations) => {
        if (!root.isConnected || applyQueued) return;
        if (!mutations.some(mutationTouchesNonDigitText)) return;
        applyQueued = true;
        try {
          applyCountdownTimerRootNow(root, observer);
        } finally {
          applyQueued = false;
        }
      });
      observer.observe(root, countdownObserveOptions);
      countdownObserverByRoot.set(root, observer);
      window[countdownObserversKey].push(observer);
      return observer;
    };

    const onCountdownTimerRoot = (root) => {
      if (!root) return;
      if (
        countdownObserverByRoot.get(root) ||
        observedCountdownTimerRoots.has(root)
      ) {
        return;
      }
      const observer = observeCountdownTimerRoot(root);
      applyCountdownTimerRootNow(root, observer);
    };
    window.__ciwi_countdown_timer_on_root__ = onCountdownTimerRoot;

    let resolveFirstRescan = null;
    window[firstRescanPromiseKey] = new Promise((resolve) => {
      resolveFirstRescan = resolve;
    });
    window[firstRescanResolveKey] = () => {
      try {
        resolveFirstRescan?.();
      } catch {}
      resolveFirstRescan = null;
      window[firstRescanResolveKey] = null;
    };

    // 第三方 bundle（如 bx-offer）可能晚于首屏插入；首次全页替换后不立刻扫 countdown。
    // 500ms / 1.5s 再 querySelectorAll('[class*="countdown-timer"]')，只给新根补译并挂 Observer。
    const runDelayedCountdownRescan = (delayMs, { isFirstGate = false } = {}) => {
      try {
        if (document.body?.isConnected) {
          const onRoot = window.__ciwi_countdown_timer_on_root__;
          const roots = collectCountdownTimerRootsIn(document.body);
          if (typeof onRoot === "function") {
            roots.forEach((root) => onRoot(root));
          }
          debugLog("delayedReapply", {
            delayMs,
            rootsCount: roots.length,
            skipped: roots.length === 0,
            reason: roots.length === 0 ? "no_countdown_timer_roots" : undefined,
          });
        }
      } finally {
        if (isFirstGate && typeof window[firstRescanResolveKey] === "function") {
          window[firstRescanResolveKey]();
        }
      }
    };
    window[delayedTimeoutsKey] = [
      setTimeout(() => runDelayedCountdownRescan(500, { isFirstGate: true }), 500),
      setTimeout(() => runDelayedCountdownRescan(1500), 1500),
    ];

    if (!window[observerKey]) {
      const observer = new MutationObserver((mutations) => {
        const onRoot = window.__ciwi_countdown_timer_on_root__;
        if (typeof onRoot !== "function") return;
        for (const root of collectMutationRoots(mutations)) {
          onRoot(root);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          "alt",
          "aria-label",
          "caption",
          "header-text",
          "label",
          "placeholder",
          "subtitle",
          "text",
          "title",
        ],
      });
      window[observerKey] = observer;

      setTimeout(() => {
        try {
          observer.disconnect();
        } catch {}
        try {
          delete window[observerKey];
        } catch {
          window[observerKey] = null;
        }
      }, 15000);
    }
  }
}

/**
 * 根据数据库数据替换 PageFly 页面文本（精准替换）
 */
export async function PageFlyTextTranslate(blockId, shop, ciwiBlock) {
  const languageInput = ciwiBlock.querySelector('input[name="language_code"]');
  const language = languageInput?.value;
  if (!language) return;

  const cacheKey = buildTranslationCacheKey("pagefly_translations", [
    shop.value,
    language,
  ]);
  const readTranslatedText = await useCacheThenRefresh(
    cacheKey,
    async () =>
      asCacheableTranslationResponse(
        await ReadTranslatedText({
          shopName: shop.value,
          languageCode: language,
        }),
      ),
    CIWI_TRANSLATION_TTL_MS,
  );

  const translations = normalizePageFlyTranslationEntries(readTranslatedText?.response);
  if (translations.length === 0) return;

  // normalizeText / hasOuterQuote / skipTags 见模块顶部共享定义

  // 原逻辑只支持“整节点完全等于 sourceText”的场景。
  // PageFly 富文本经常把多句文案塞进同一个文本节点，并夹带 <br> / &nbsp;，
  // 因此需要支持节点内子串替换，并让普通空格能匹配 NBSP 等空白字符。
  const exactMap = new Map();
  const preparedEntries = [];
  translations.forEach((item) => {
    const trimmedBefore = normalizeText(item?.sourceText);
    const trimmedAfter = normalizeText(item?.targetText);
    if (!trimmedBefore || !trimmedAfter) return;
    const prepared = createPreparedTextEntry(trimmedBefore, trimmedAfter);
    if (!prepared) return;
    if (!exactMap.has(prepared.matchKey)) exactMap.set(prepared.matchKey, trimmedAfter);
    preparedEntries.push({
      before: prepared.matchKey,
      after: trimmedAfter,
      flexibleWhitespace: prepared.flexibleWhitespace,
      re: prepared.re,
    });
  });
  if (exactMap.size === 0 || preparedEntries.length === 0) return;

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parentTag = node.parentNode?.nodeName;
      if (skipTags.has(parentTag)) return NodeFilter.FILTER_REJECT;
      const { strict: normalizedValue, collapsed: collapsedValue } = getNodeMatchKeys(
        node.nodeValue,
      );
      if (exactMap.has(normalizedValue) || exactMap.has(collapsedValue))
        return NodeFilter.FILTER_ACCEPT;
      return preparedEntries.some((entry) =>
        entry.flexibleWhitespace
          ? collapsedValue.includes(entry.before)
          : normalizedValue.includes(entry.before),
      )
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });

  const nodesToReplace = [];
  while (walker.nextNode()) nodesToReplace.push(walker.currentNode);

  // ✏ 精准替换 + 节点内子串替换
  nodesToReplace.forEach((node) => {
    if (isElementHiddenForTranslation(node.parentElement)) return;
    if (isPriceRelatedElement(node)) return;
    const original = node.nodeValue;
    const {
      strict: normalizedOriginal,
      collapsed: collapsedOriginal,
    } = getNodeMatchKeys(original);
    const exactAfter =
      exactMap.get(normalizedOriginal) || exactMap.get(collapsedOriginal);
    if (exactAfter) {
      const keepQuote = hasOuterQuote(original);
      node.nodeValue = keepQuote ? `"${exactAfter}"` : exactAfter;
      return;
    }

    let updatedValue = original;
    preparedEntries.forEach((entry) => {
      const {
        strict: normalizedUpdatedValue,
        collapsed: collapsedUpdatedValue,
      } = getNodeMatchKeys(updatedValue);
      if (
        entry.flexibleWhitespace
          ? !collapsedUpdatedValue.includes(entry.before)
          : !normalizedUpdatedValue.includes(entry.before)
      ) {
        return;
      }
      updatedValue = updatedValue.replace(entry.re, entry.after);
    });

    if (updatedValue !== original) {
      node.nodeValue = updatedValue;
    }
  });
}
