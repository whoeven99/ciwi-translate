// ui.js
import {
  fetchCurrencies,
  GetProductImageData,
  fetchAutoRate,
  GetShopImageData,
  ParseLiquidDataByShopNameAndLanguage,
  ReadTranslatedText,
  CollectLiquidStrings,
} from "./ciwi-api.js";
import {
  asCacheableTranslationResponse,
  buildTranslationCacheKey,
  CIWI_EMPTY_TRANSLATION_TTL_MS,
  CIWI_TRANSLATION_TTL_MS,
  resolveStorefrontProductId,
} from "./ciwi-page.js";
import { useCacheThenRefresh } from "./ciwi-storage.js";
import {
  CIWI_MONEY_SELECTOR,
  isPriceRelatedElement,
  persistManualLocalizationPreference,
  shouldTrackMoneyNode,
  transformPrices,
} from "./ciwi-utils.js";

/**
 * Skip hidden nodes during translation without forcing style recalc on every walker step.
 */
const isElementHiddenForTranslation = (element) => {
  if (!element || !(element instanceof Element)) return false;
  if (typeof element.checkVisibility === "function") {
    return !element.checkVisibility({ checkOpacity: false });
  }
  return element.offsetParent === null && element !== document.body;
};

// 文本翻译共享工具（CustomLiquidTextTranslate / PageFlyTextTranslate 共用）

// 不应替换文本内容的标签
const skipTags = new Set([
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

const normalizeHtmlWhitespaceEntities = (text) =>
  String(text ?? "")
    .replace(/&(nbsp|#160|#xa0|#xA0|#8239|#x202f);?/g, " ")
    .replace(/[\u00A0\u202F]/g, " ");

// 去除首尾空白与成对的外层引号，并统一 HTML 空白实体格式
const normalizeText = (text) =>
  normalizeHtmlWhitespaceEntities(text)
    .trim()
    .replace(/^["“”]+|["“”]+$/g, "");

const normalizeCollapsedText = (text) => normalizeText(text).replace(/\s+/g, " ").trim();

const shouldFlexibleWhitespaceMatch = (text) =>
  /[\n\r]/.test(text || "") || /\s{2,}/.test(text || "") || /[.!?]\S/.test(text || "");

const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeSentenceSpacing = (text) =>
  String(text ?? "").replace(/([.!?])(?=[^\s.!?])/g, "$1 ");

const getSentenceAwareCollapsedText = (text) =>
  normalizeCollapsedText(normalizeSentenceSpacing(text));

const getFlexibleMatchKey = (text) =>
  shouldFlexibleWhitespaceMatch(text)
    ? getSentenceAwareCollapsedText(text)
    : normalizeText(text);

const getNodeMatchKeys = (text) => ({
  strict: normalizeText(text),
  collapsed: getSentenceAwareCollapsedText(text),
});

const buildFlexibleWhitespacePattern = (text) => {
  const collapsed = getSentenceAwareCollapsedText(text);
  if (!collapsed) return "";

  return collapsed
    .split(" ")
    .map((part) => escapeRegExp(part))
    .join("[\\s\\u00A0\\u202F]*");
};

const createPreparedTextEntry = (before, after) => {
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

const normalizePageFlyTranslationEntries = (response) => {
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
const hasOuterQuote = (text) => /^["“”]/.test(text) && /["“”]$/.test(text);
const CIWI_MANUAL_LOCALIZATION_QUERY_KEY = "ciwi_manual_localization";

const clampNumber = (value, min, max) => Math.min(Math.max(value, min), max);
let activePriceObserver = null;

function isTruthyPreviewFlag(value) {
  return value === true || value === "true" || value === "1" || value === 1;
}

function hasShopifyVisualPreviewSource(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;

  try {
    const url = new URL(raw, window.location.origin);
    const source = url.searchParams.get("source");
    return (
      source === "visualPreview" ||
      source === "visualPreviewInitialLoad"
    );
  } catch {
    return (
      raw.includes("source=visualPreview") ||
      raw.includes("source=visualPreviewInitialLoad")
    );
  }
}

function hasShopifyEditorPreviewMarkers(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;

  try {
    const url = new URL(raw, window.location.origin);
    return url.searchParams.has("oseid") || url.searchParams.has("osectx");
  } catch {
    return raw.includes("oseid=") || raw.includes("osectx=");
  }
}

function isAdminThemeEditorUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;

  return (
    raw.includes("admin.shopify.com/store/") &&
    raw.includes("/themes/") &&
    raw.includes("/editor")
  );
}

function isThemePreviewDisabledForCiwi(ciwiBlock) {
  const params = new URL(window.location.href).searchParams;
  const referrer = String(document.referrer || "");
  const hasAdminThemeEditorReferrer = isAdminThemeEditorUrl(referrer);
  const requestDesignMode = ciwiBlock?.querySelector(
    'input[name="ciwi_request_design_mode"]',
  )?.value;
  const requestVisualPreviewMode = ciwiBlock?.querySelector(
    'input[name="ciwi_request_visual_preview_mode"]',
  )?.value;

  if (
    isTruthyPreviewFlag(requestDesignMode) ||
    isTruthyPreviewFlag(requestVisualPreviewMode)
  ) {
    return true;
  }

  if (document.documentElement.classList.contains("shopify-design-mode")) {
    return true;
  }

  if (window.Shopify?.designMode === true) {
    return true;
  }

  if (window.Shopify?.visualPreviewMode === true) {
    return true;
  }

  if (
    hasShopifyVisualPreviewSource(window.location.href) ||
    hasShopifyVisualPreviewSource(referrer)
  ) {
    return true;
  }

  if (
    hasAdminThemeEditorReferrer &&
    (hasShopifyEditorPreviewMarkers(window.location.href) ||
      hasShopifyEditorPreviewMarkers(referrer))
  ) {
    return true;
  }

  if (params.has("preview_theme_id") || params.has("preview_token")) {
    return true;
  }

  if (hasAdminThemeEditorReferrer) {
    return true;
  }

  return params.has("_ab") && params.has("_fd") && params.has("pb");
}

function measureTextWidth(referenceElement, text) {
  if (!referenceElement || !text) return 0;

  const measurement = document.createElement("span");
  const computedStyle = window.getComputedStyle(referenceElement);

  measurement.textContent = text;
  measurement.style.position = "fixed";
  measurement.style.left = "-9999px";
  measurement.style.top = "-9999px";
  measurement.style.visibility = "hidden";
  measurement.style.pointerEvents = "none";
  measurement.style.whiteSpace = "nowrap";
  measurement.style.fontFamily = computedStyle.fontFamily;
  measurement.style.fontSize = computedStyle.fontSize;
  measurement.style.fontWeight = computedStyle.fontWeight;
  measurement.style.fontStyle = computedStyle.fontStyle;
  measurement.style.letterSpacing = computedStyle.letterSpacing;
  measurement.style.lineHeight = computedStyle.lineHeight;
  measurement.style.textTransform = computedStyle.textTransform;

  document.body.appendChild(measurement);
  const width = Math.ceil(measurement.getBoundingClientRect().width);
  measurement.remove();

  return width;
}

export function syncCompactSwitcherLayout(ciwiBlock) {
  if (!ciwiBlock) return;

  if (
    typeof document !== "undefined" &&
    document.fonts &&
    document.fonts.status !== "loaded" &&
    ciwiBlock.dataset.ciwiFontsReadyHooked !== "1"
  ) {
    ciwiBlock.dataset.ciwiFontsReadyHooked = "1";
    document.fonts.ready
      .then(() => syncCompactSwitcherLayout(ciwiBlock))
      .catch(() => {});
  }

  if (
    typeof window !== "undefined" &&
    ciwiBlock.dataset.ciwiWindowLoadLayoutHooked !== "1"
  ) {
    ciwiBlock.dataset.ciwiWindowLoadLayoutHooked = "1";
    window.addEventListener("load", () => syncCompactSwitcherLayout(ciwiBlock), {
      once: true,
      passive: true,
    });
  }

  const mainBox = ciwiBlock.querySelector("#main-box");
  const selectorBox = ciwiBlock.querySelector("#selector-box");
  const displayTextElement = ciwiBlock.querySelector("#display-text");
  const mainBoxFlag = ciwiBlock.querySelector("#main-language-flag");
  const floatButton = ciwiBlock.querySelector("#translate-float-btn");
  const floatButtonText = ciwiBlock.querySelector("#translate-float-btn-text");
  const floatButtonIcon = ciwiBlock.querySelector("#translate-float-btn-icon");
  const languageSelectorFlag = ciwiBlock.querySelector("#language-selector-flag");
  const languageSelect = ciwiBlock.querySelector(".language_selector_header");
  const currencySelect = ciwiBlock.querySelector(".currency_selector_header");
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const maxInlineWidth = clampNumber(viewportWidth - 24, 156, 260);
  const hasUsableFlag = (img) => {
    if (!(img instanceof HTMLImageElement)) return false;
    if (img.hidden) return false;
    const src = img.currentSrc || img.src || "";
    if (!src || src.startsWith("data:image/gif")) return false;
    if (window.getComputedStyle(img).display === "none") return false;
    return true;
  };

  if (mainBox && displayTextElement) {
    const label = displayTextElement.textContent?.trim() || "";
    const textWidth = measureTextWidth(displayTextElement, label);
    const reserveMainFlag = languageSelectorFlag?.dataset?.enabled === "true";
    const hasMainFlag = hasUsableFlag(mainBoxFlag) || reserveMainFlag;
    const triggerWidth = clampNumber(
      textWidth + (hasMainFlag ? 78 : 48),
      108,
      maxInlineWidth,
    );

    if (mainBox.style.display !== "none") {
      mainBox.style.width = `${triggerWidth}px`;
    }

    if (selectorBox && selectorBox.dataset.mode === "overlay") {
      selectorBox.style.width = `${triggerWidth}px`;
    }
  }

  if (selectorBox?.dataset.mode === "direct") {
    const activeSelect =
      languageSelect &&
      languageSelect.closest("#language-switcher-container")?.style.display === "block"
        ? languageSelect
        : currencySelect;
    const activeLabel = activeSelect?.selectedOptions?.[0]?.textContent?.trim() || "";
    const hasLanguageFlag = hasUsableFlag(languageSelectorFlag);
    const directWidthBase = hasLanguageFlag ? 76 : 46;
    const directMinWidth = hasLanguageFlag ? 124 : 104;
    const directWidth = clampNumber(
      measureTextWidth(activeSelect, activeLabel) + directWidthBase,
      directMinWidth,
      maxInlineWidth,
    );

    selectorBox.style.width = `${directWidth}px`;
  }

  if (floatButton && floatButtonText && floatButton.style.display !== "none") {
    const floatLabel = floatButtonText.textContent?.trim() || "";
    const textWidth = measureTextWidth(floatButtonText, floatLabel);
    const hasFloatFlag = Boolean(
      floatButtonIcon && !floatButtonIcon.hidden && floatButtonIcon.src,
    );
    const floatHeight = clampNumber(
      textWidth + (hasFloatFlag ? 56 : 34),
      84,
      180,
    );

    floatButton.style.height = `${floatHeight}px`;
  }
}

/**
 * 渲染货币选项
 */
export function renderCurrencyOptions({
  currencySelect,
  currencyData,
  selectedCurrencyCode,
  fallbackCurrencyCode,
}) {
  if (!currencySelect) return;

  const normalizedOptions = Array.isArray(currencyData) ? [...currencyData] : [];
  const knownCurrencyCodes = new Set(
    normalizedOptions
      .map((currency) => currency?.currencyCode)
      .filter(Boolean),
  );
  const fallbackCode = fallbackCurrencyCode || selectedCurrencyCode || "";

  if (fallbackCode && !knownCurrencyCodes.has(fallbackCode)) {
    normalizedOptions.unshift({
      currencyCode: fallbackCode,
      symbol: "",
      exchangeRate: null,
      primaryStatus: false,
    });
  }

  currencySelect.innerHTML = "";
  normalizedOptions.forEach((currency) => {
    const optionItem = document.createElement("option");
    optionItem.value = currency?.currencyCode || "";
    optionItem.textContent = currency?.symbol
      ? `${currency?.currencyCode} (${currency?.symbol})`
      : `${currency?.currencyCode}`;
    optionItem.selected = currency?.currencyCode === selectedCurrencyCode;
    currencySelect.appendChild(optionItem);
  });
}

async function refreshSelectedCurrency({ blockId, shop, ciwiBlock }) {
  if (!ciwiBlock || !shop) return;

  let currencyData = [];
  const localStorageCurrencyDataJSON =
    typeof localStorage !== "undefined"
      ? localStorage.getItem("ciwi_currency_data")
      : null;

  if (localStorageCurrencyDataJSON) {
    try {
      currencyData = JSON.parse(localStorageCurrencyDataJSON);
    } catch {
      currencyData = [];
    }
  }

  if (!Array.isArray(currencyData) || !currencyData.length) {
    currencyData = await fetchCurrencies({ blockId, shop });
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("ciwi_currency_data", JSON.stringify(currencyData));
    }
  }

  await initializeCurrency({
    blockId,
    currencyData,
    shop,
    ciwiBlock,
    marketCurrencyOpen: false,
  });
}

function syncCurrencySelectionState({
  ciwiBlock,
  currencySelect,
  selectedCurrencyCode,
  persist = true,
}) {
  const nextCode = String(selectedCurrencyCode || "").trim();
  const currencyInput = ciwiBlock?.querySelector('input[name="currency_code"]');
  if (currencySelect && nextCode && currencySelect.value !== nextCode) {
    currencySelect.value = nextCode;
  }
  if (currencyInput && currencyInput.value !== nextCode) {
    currencyInput.value = nextCode;
    currencyInput.setAttribute("value", nextCode);
  }
  if (persist && typeof localStorage !== "undefined" && nextCode) {
    localStorage.setItem("ciwi_selected_currency", nextCode);
  }

  const languageSelectorContainer = ciwiBlock?.querySelector(
    "#language-switcher-container",
  );
  const currencySelectorContainer = ciwiBlock?.querySelector(
    "#currency-switcher-container",
  );
  updateDisplayText(
    languageSelectorContainer?.style.display === "block",
    currencySelectorContainer?.style.display === "block",
    ciwiBlock,
  );
}

/**
 * 初始化货币选择器
 */
export async function initializeCurrency({
  currencyData,
  shop,
  ciwiBlock,
  marketCurrencyOpen = true,
}) {
  const pageCurrencyCode = ciwiBlock.querySelector(
    'input[name="currency_code"]',
  )?.value;
  const baseCurrencyCode =
    ciwiBlock.dataset.ciwiBaseCurrencyCode ||
    pageCurrencyCode ||
    "";
  if (!ciwiBlock.dataset.ciwiBaseCurrencyCode && baseCurrencyCode) {
    ciwiBlock.dataset.ciwiBaseCurrencyCode = baseCurrencyCode;
  }
  const persistedCurrencyCode =
    typeof localStorage !== "undefined"
      ? localStorage.getItem("ciwi_selected_currency")
      : "";
  const selectedCurrencyCode =
    marketCurrencyOpen || !persistedCurrencyCode
      ? pageCurrencyCode
      : persistedCurrencyCode;
  const moneyFormat = ciwiBlock.querySelector("#queryMoneyFormat").value;

  let selectedCurrency = currencyData?.find(
    (item) => item?.currencyCode == selectedCurrencyCode,
  );
  if (!selectedCurrency && pageCurrencyCode) {
    selectedCurrency = currencyData?.find(
      (item) => item?.currencyCode == pageCurrencyCode,
    );
  }
  const effectiveSelectedCurrencyCode =
    selectedCurrency?.currencyCode || pageCurrencyCode || selectedCurrencyCode;

  if (
    !selectedCurrency &&
    persistedCurrencyCode &&
    pageCurrencyCode &&
    persistedCurrencyCode !== pageCurrencyCode &&
    typeof localStorage !== "undefined"
  ) {
    localStorage.setItem("ciwi_selected_currency", pageCurrencyCode);
    localStorage.removeItem("ciwi_selected_currency_rate");
  }
  // 获取新的选择器元素
  const customSelector = ciwiBlock.querySelector(
    "#currency-switcher-container",
  );
  const currencySelect = customSelector?.querySelector(".currency_selector_header");

  renderCurrencyOptions({
    currencySelect,
    currencyData,
    selectedCurrencyCode: effectiveSelectedCurrencyCode,
    fallbackCurrencyCode: pageCurrencyCode,
  });

  syncCurrencySelectionState({
    ciwiBlock,
    currencySelect,
    selectedCurrencyCode: effectiveSelectedCurrencyCode,
    persist: !marketCurrencyOpen,
  });

  if (activePriceObserver) {
    activePriceObserver.disconnect();
    activePriceObserver = null;
  }

  if (
    !selectedCurrency ||
    effectiveSelectedCurrencyCode === baseCurrencyCode
  ) {
    syncCurrencySelectionState({
      ciwiBlock,
      currencySelect,
      selectedCurrencyCode: baseCurrencyCode,
    });
    transformPrices({ rate: 1, moneyFormat, selectedCurrency: null });
    return;
  }

  let rate = 1;
  if (
    selectedCurrency?.exchangeRate == "Auto" ||
    selectedCurrency?.exchangeRate == null
  ) {
    const localRateJSON =
      typeof localStorage !== "undefined"
        ? localStorage.getItem("ciwi_selected_currency_rate")
        : null;
    const localRate = localRateJSON ? JSON.parse(localRateJSON) : null;
    if (
      localRate &&
      localRate?.currencyCode == effectiveSelectedCurrencyCode &&
      localRate?.fromCurrencyCode == baseCurrencyCode
    ) {
      rate = localRate?.exchangeRate;
    } else {
      const autoRate = await fetchAutoRate({
        shop: shop,
        currencyCode: selectedCurrency.currencyCode,
        fromCurrencyCode: baseCurrencyCode,
      });
      if (typeof autoRate == "number") {
        rate = autoRate;
      } else {
        syncCurrencySelectionState({
          ciwiBlock,
          currencySelect,
          selectedCurrencyCode: baseCurrencyCode,
        });
        if (typeof localStorage !== "undefined") {
          localStorage.removeItem("ciwi_selected_currency_rate");
        }
        transformPrices({ rate: 1, moneyFormat, selectedCurrency: null });
        return;
      }
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(
          "ciwi_selected_currency_rate",
          JSON.stringify({
            currencyCode: selectedCurrency.currencyCode,
            fromCurrencyCode: baseCurrencyCode,
            exchangeRate: rate,
          }),
        );
      }
    }
  } else {
    rate = Number(selectedCurrency.exchangeRate);
    if (!Number.isFinite(rate)) {
      syncCurrencySelectionState({
        ciwiBlock,
        currencySelect,
        selectedCurrencyCode: baseCurrencyCode,
      });
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem("ciwi_selected_currency_rate");
      }
      transformPrices({ rate: 1, moneyFormat, selectedCurrency: null });
      return;
    }
  }
  // 转换现有价格并开始观察整个文档 body
  // （initPriceObserver 内部会先执行一次全量转换，避免这里重复扫描整个文档）
  initPriceObserver({ rate, moneyFormat, selectedCurrency });
}

/**
 * 观察 DOM 变化，动态处理新价格
 */
export function initPriceObserver({ rate, moneyFormat, selectedCurrency }) {
  const moneySelector = CIWI_MONEY_SELECTOR;
  if (activePriceObserver) {
    activePriceObserver.disconnect();
  }
  const observer = new MutationObserver((mutationsList) => {
    // 只收集本次新增的 .ciwi-money 节点做增量转换，
    // 避免每次 DOM 变化都重扫整个文档的全部价格。
    const pending = new Set();
    for (const mutation of mutationsList) {
      if (mutation.type !== "childList") continue;
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType !== 1) return;
        const add = (el) => {
          if (!(el instanceof Element)) return;
          if (!el.classList.contains("ciwi-money")) {
            if (!shouldTrackMoneyNode(el)) return;
            el.classList.add("ciwi-money");
          }
          pending.add(el);
        };

        if (node.matches?.(moneySelector)) add(node);
        node.querySelectorAll?.(moneySelector).forEach((el) => add(el));
      });
    }
    if (pending.size > 0) {
      transformPrices({ rate, moneyFormat, selectedCurrency, nodes: pending });
    }
  });

  // 初始执行一次（全量）
  transformPrices({ rate, moneyFormat, selectedCurrency });

  // 开始观察
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
  activePriceObserver = observer;
}

/**
 * 更新mainBox内容
 */
export function updateDisplayText(lang, cur, ciwiBlock) {
  let selectedLanguageText = "";
  let selectedCurrencyText = "";
  if (lang) {
    const languageSelect = ciwiBlock.querySelector(".language_selector_header");
    selectedLanguageText =
      languageSelect?.selectedOptions?.[0]?.textContent?.trim() || "";
  }

  if (cur) {
    const currencySelect = ciwiBlock.querySelector(".currency_selector_header");
    selectedCurrencyText =
      currencySelect?.value ||
      ciwiBlock.querySelector('input[name="currency_code"]')?.value ||
      "";
  }

  const displayTextElement = ciwiBlock.querySelector("#display-text");

  if (displayTextElement) {
    const label =
      selectedLanguageText && selectedCurrencyText
        ? `${selectedLanguageText} / ${selectedCurrencyText}`
        : selectedLanguageText || selectedCurrencyText || "";

    const mainBox = ciwiBlock.querySelector("#main-box");
    const selectorBox = ciwiBlock.querySelector("#selector-box");
    const mainBoxFlag = ciwiBlock.querySelector("#main-language-flag");
    const languageSelectorFlag = ciwiBlock.querySelector("#language-selector-flag");
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const maxInlineWidth = clampNumber(viewportWidth - 24, 156, 260);
    const hasUsableFlag = (img) => {
      if (!(img instanceof HTMLImageElement)) return false;
      if (img.hidden) return false;
      const src = img.currentSrc || img.src || "";
      if (!src || src.startsWith("data:image/gif")) return false;
      if (window.getComputedStyle(img).display === "none") return false;
      return true;
    };
    const reserveMainFlag = languageSelectorFlag?.dataset?.enabled === "true";
    const hasMainFlag = hasUsableFlag(mainBoxFlag) || reserveMainFlag;
    const triggerWidth = clampNumber(
      measureTextWidth(displayTextElement, label) + (hasMainFlag ? 78 : 48),
      108,
      maxInlineWidth,
    );

    if (mainBox?.style.display !== "none") {
      mainBox.style.width = `${triggerWidth}px`;
    }
    if (selectorBox && selectorBox.dataset.mode === "overlay") {
      selectorBox.style.width = `${triggerWidth}px`;
    }

    displayTextElement.textContent = label;
  }

  syncCompactSwitcherLayout(ciwiBlock);
}

/**
 * 启用货币选择器
 */
export async function CurrencySelectorTakeEffect(
  blockId,
  isCurrencySelectorTakeEffect,
  shop,
  data,
  ciwiBlock,
) {
  if (!isCurrencySelectorTakeEffect) return;

  const localStorageCurrencyDataJSON =
    localStorage.getItem("ciwi_currency_data");
  let currencyData = [];

  if (localStorageCurrencyDataJSON) {
    try {
      currencyData = JSON.parse(localStorageCurrencyDataJSON);
    } catch {
      currencyData = [];
    }
  }
  if (!Array.isArray(currencyData) || !currencyData.length) {
    currencyData = await fetchCurrencies({ blockId, shop });
    localStorage.setItem("ciwi_currency_data", JSON.stringify(currencyData));
  }

  const currencySelector = ciwiBlock.querySelector(
    "#currency-switcher-container",
  );
  const currencySelectorHeader = ciwiBlock.querySelector(
    ".currency_selector_header",
  );
  const currencySelectorWrapper = currencySelectorHeader?.closest(".native-selector");

  if (currencySelectorWrapper) {
    currencySelectorWrapper.style.backgroundColor = data.backgroundColor;
    currencySelectorWrapper.style.border = `1px solid ${data.optionBorderColor}`;
  }
  currencySelectorHeader.style.backgroundColor = "transparent";
  currencySelectorHeader.style.border = "none";
  currencySelector.style.display = "block";

  initializeCurrency({
    blockId,
    currencyData,
    shop,
    ciwiBlock,
    marketCurrencyOpen: data?.marketCurrencyOpen !== false,
  });
}

/**
 * 启用语言选择器
 */
export async function LanguageSelectorTakeEffect(
  isLanguageSelectorTakeEffect,
  data,
  ciwiBlock,
) {
  if (!isLanguageSelectorTakeEffect) {
    return;
  }
  const languageSelector = ciwiBlock.querySelector(
    "#language-switcher-container",
  );
  languageSelector.style.display = "block";
  const languageSelectorHeader = ciwiBlock.querySelector(
    ".language_selector_header",
  );
  const languageSelectorWrapper = languageSelectorHeader?.closest(".native-selector");
  if (languageSelectorWrapper) {
    languageSelectorWrapper.style.backgroundColor = data.backgroundColor;
    languageSelectorWrapper.style.border = `1px solid ${data.optionBorderColor}`;
  }
  languageSelectorHeader.style.backgroundColor = "transparent";
  languageSelectorHeader.style.border = "none";
  const languageSelectorSelectedOption = ciwiBlock.querySelector(
    ".options-container[data-type='language']",
  );
  if (languageSelectorSelectedOption) {
    languageSelectorSelectedOption.style.backgroundColor = data.backgroundColor;
    languageSelectorSelectedOption.style.border = `1px solid ${data.optionBorderColor}`;
  }
  const selectorFlag = ciwiBlock.querySelector("#language-selector-flag");
  if (selectorFlag) {
    selectorFlag.dataset.enabled = data?.includedFlag ? "true" : "false";
  }
  syncMarketFlags(data, ciwiBlock);
}

function buildCountryFlagUrl(countryCode) {
  const normalizedCountryCode = String(countryCode || "")
    .trim()
    .toUpperCase();
  if (!normalizedCountryCode) return "";

  return `https://img.bogdatech.com/app/${normalizedCountryCode}.webp`;
}

function getCurrentMarketFlagUrl(ciwiBlock) {
  const countryCode = ciwiBlock?.querySelector('input[name="country_code"]')?.value;
  return buildCountryFlagUrl(countryCode);
}

export function updateLanguageSelectorFlag(ciwiBlock, flagUrl) {
  const selectorFlag = ciwiBlock.querySelector("#language-selector-flag");
  const languageSelect = ciwiBlock.querySelector(".language_selector_header");
  if (!selectorFlag || !languageSelect) return;

  if (selectorFlag.dataset.enabled !== "true") {
    selectorFlag.hidden = true;
    languageSelect.style.paddingLeft = "12px";
    return;
  }

  if (flagUrl) {
    selectorFlag.addEventListener(
      "load",
      () => syncCompactSwitcherLayout(ciwiBlock),
      { once: true },
    );
    selectorFlag.src = flagUrl;
    selectorFlag.hidden = false;
    languageSelect.style.paddingLeft = "40px";
  } else {
    selectorFlag.hidden = true;
    languageSelect.style.paddingLeft = "12px";
  }
}

export function syncMarketFlags(data, ciwiBlock) {
  const mainLanguageFlag = ciwiBlock.querySelector("#main-language-flag");
  const translateFloatBtnIcon = ciwiBlock.querySelector(
    "#translate-float-btn-icon",
  );
  const flagUrl = data?.includedFlag ? getCurrentMarketFlagUrl(ciwiBlock) : "";

  updateLanguageSelectorFlag(ciwiBlock, flagUrl);

  if (mainLanguageFlag) {
    if (flagUrl && (data.languageSelector || data.currencySelector)) {
      mainLanguageFlag.addEventListener(
        "load",
        () => syncCompactSwitcherLayout(ciwiBlock),
        { once: true },
      );
      mainLanguageFlag.src = flagUrl;
      mainLanguageFlag.hidden = false;
    } else {
      mainLanguageFlag.hidden = true;
    }
  }
  if (translateFloatBtnIcon) {
    if (flagUrl && !data.languageSelector && !data.currencySelector) {
      translateFloatBtnIcon.src = flagUrl;
      translateFloatBtnIcon.hidden = false;
    } else {
      translateFloatBtnIcon.hidden = true;
    }
  }
  const mainBoxText = ciwiBlock.querySelector(".main_box_text");
  const mainBox = ciwiBlock.querySelector("#main-box");
  if (mainBox) {
    mainBox.classList.toggle(
      "has-flag",
      Boolean(mainBoxText && mainLanguageFlag && !mainLanguageFlag.hidden && flagUrl),
    );
  }

  syncCompactSwitcherLayout(ciwiBlock);
}

// 保存所有我们替换过的 img 以及“替换后的最终值”
const monitoredImages = new WeakMap();

export function monitorImage(img, finalSrc, finalSrcset, finalAlt) {
  // 如果已经在监控，就先断开之前的观察
  if (monitoredImages.has(img)) {
    const old = monitoredImages.get(img);
    old?.observer.disconnect();
  }

  // 创建新的 MutationObserver
  const observer = new MutationObserver(() => {
    // 只要有人篡改了 src/srcset/alt，则立即恢复
    if (img.src !== finalSrc && finalSrc) img.src = finalSrc;
    if (img.srcset !== finalSrcset && finalSrcset) img.srcset = finalSrcset;
    if (img.alt !== finalAlt && finalAlt) img.alt = finalAlt;
  });

  // 监听属性变化
  observer.observe(img, {
    attributes: true,
    attributeFilter: ["src", "srcset", "alt"],
  });

  // 保存监控信息
  monitoredImages.set(img, {
    finalSrc,
    finalSrcset,
    finalAlt,
    observer,
  });
}

function unmonitorImage(img) {
  const monitored = monitoredImages.get(img);
  monitored?.observer.disconnect();
  monitoredImages.delete(img);
}

function rememberOriginalPictureSources(img) {
  if (!(img instanceof HTMLImageElement)) return;
  const picture = img.closest("picture");
  picture?.querySelectorAll("source").forEach((source) => {
    if ("ciwiOriginalSrcset" in source.dataset) return;
    source.dataset.ciwiOriginalSrcset =
      source.getAttribute("srcset") || source.srcset || "";
  });
}

function restoreOriginalPictureSources(img) {
  if (!(img instanceof HTMLImageElement)) return;
  const picture = img.closest("picture");
  picture?.querySelectorAll("source").forEach((source) => {
    if (!("ciwiOriginalSrcset" in source.dataset)) return;
    const originalSrcset = source.dataset.ciwiOriginalSrcset || "";
    if (originalSrcset) {
      source.srcset = originalSrcset;
      source.setAttribute("srcset", originalSrcset);
    } else {
      source.srcset = "";
      source.removeAttribute("srcset");
    }
  });
}

function rememberOriginalImageState(img) {
  if (!(img instanceof HTMLImageElement)) return;

  if (!("ciwiOriginalSrc" in img.dataset)) {
    img.dataset.ciwiOriginalSrc =
      img.getAttribute("src") || img.currentSrc || img.src || "";
  }
  if (!("ciwiOriginalSrcset" in img.dataset)) {
    img.dataset.ciwiOriginalSrcset =
      img.getAttribute("srcset") || img.srcset || "";
  }
  if (!("ciwiOriginalAlt" in img.dataset)) {
    img.dataset.ciwiOriginalAlt = img.getAttribute("alt") || img.alt || "";
  }

  rememberOriginalPictureSources(img);
}

function restoreOriginalImageState(img) {
  if (!(img instanceof HTMLImageElement)) return;
  if (
    !("ciwiOriginalSrc" in img.dataset) &&
    !("ciwiOriginalSrcset" in img.dataset) &&
    !("ciwiOriginalAlt" in img.dataset)
  ) {
    return;
  }

  unmonitorImage(img);

  if ("ciwiOriginalSrc" in img.dataset) {
    const originalSrc = img.dataset.ciwiOriginalSrc || "";
    if (originalSrc) {
      img.src = originalSrc;
      img.setAttribute("src", originalSrc);
    } else {
      img.removeAttribute("src");
    }
  }

  if ("ciwiOriginalSrcset" in img.dataset) {
    const originalSrcset = img.dataset.ciwiOriginalSrcset || "";
    if (originalSrcset) {
      img.srcset = originalSrcset;
      img.setAttribute("srcset", originalSrcset);
    } else {
      img.srcset = "";
      img.removeAttribute("srcset");
    }
  }

  if ("ciwiOriginalAlt" in img.dataset) {
    const originalAlt = img.dataset.ciwiOriginalAlt || "";
    img.alt = originalAlt;
    img.setAttribute("alt", originalAlt);
  }

  restoreOriginalPictureSources(img);
}

function restoreTranslatedImages() {
  document.querySelectorAll("img").forEach((img) => {
    restoreOriginalImageState(img);
  });
}

function getImageMatchCandidates(img) {
  if (!(img instanceof HTMLImageElement)) return [];

  const candidates = [
    img.currentSrc,
    img.src,
    img.getAttribute("src"),
    img.srcset,
    img.getAttribute("srcset"),
    img.getAttribute("data-src"),
    img.getAttribute("data-srcset"),
  ].filter(Boolean);

  return [...new Set(candidates)];
}

function normalizeImageCandidate(url) {
  if (!url) return null;

  const raw = String(url).trim();
  if (!raw) return null;

  const candidate = raw.split(",")[0]?.trim().split(/\s+/)[0]?.trim();
  if (!candidate) return null;

  try {
    return new URL(candidate, window.location.origin).pathname;
  } catch {
    const withoutQuery = candidate.split("?")[0]?.split("#")[0]?.trim();
    return withoutQuery || null;
  }
}

function normalizeShopifyFilesPath(pathname) {
  if (!pathname) return null;

  const normalized = String(pathname).trim();
  if (!normalized) return null;

  const filesMarker = "/files/";
  const lastFilesIndex = normalized.lastIndexOf(filesMarker);
  if (lastFilesIndex >= 0) {
    const afterFiles = normalized.slice(lastFilesIndex + filesMarker.length).trim();
    return afterFiles || null;
  }

  return null;
}

function getShopifyImageMatchKey(url) {
  const normalized = normalizeImageCandidate(url);
  const filesPath = normalizeShopifyFilesPath(normalized);
  if (filesPath) return filesPath;
  if (normalized) return normalized;

  if (!url) return null;
  const base = String(url).split("/").pop() || "";
  return base.split("?")[0]?.trim() || null;
}

function findMatchedImageEntry(img, keyedEntries) {
  if (!(img instanceof HTMLImageElement) || !Array.isArray(keyedEntries)) {
    return null;
  }

  const candidates = getImageMatchCandidates(img);
  if (candidates.length === 0) return null;
  const normalizedCandidates = candidates
    .map((candidate) => getShopifyImageMatchKey(candidate))
    .filter(Boolean);

  return (
    keyedEntries.find(({ key }) =>
      normalizedCandidates.some((candidate) => candidate === key),
    ) || null
  );
}

function syncPictureSources(img, afterUrl) {
  if (!(img instanceof HTMLImageElement) || !afterUrl) return;

  const picture = img.closest("picture");
  picture?.querySelectorAll("source").forEach((source) => {
    source.srcset = afterUrl;
    source.setAttribute("srcset", afterUrl);
  });
}

function applyTranslatedImage(img, item) {
  if (!(img instanceof HTMLImageElement) || !item) return;

  rememberOriginalImageState(img);

  if (item.imageAfterUrl) {
    img.src = item.imageAfterUrl;
    img.setAttribute("src", item.imageAfterUrl);
    img.srcset = item.imageAfterUrl;
    img.setAttribute("srcset", item.imageAfterUrl);
    syncPictureSources(img, item.imageAfterUrl);
  }

  if (item.altAfterTranslation) {
    img.alt = item.altAfterTranslation;
    img.setAttribute("alt", item.altAfterTranslation);
  }

  monitorImage(
    img,
    item?.imageAfterUrl,
    item?.imageAfterUrl,
    item?.altAfterTranslation,
  );
}

function processAddedImageNode(node, keyedEntries) {
  if (!(node instanceof Element)) return;

  const imageNodes = node instanceof HTMLImageElement
    ? [node]
    : Array.from(node.querySelectorAll("img"));

  imageNodes.forEach((img) => {
    const matched = findMatchedImageEntry(img, keyedEntries);
    if (!matched?.item) return;
    applyTranslatedImage(img, matched.item);
  });
}

let _dynamicImageObserver = null;

/**
 * 把图片翻译响应预处理成 [{ key, item }]：
 * key 只从 imageBeforeUrl 解析一次，避免在图片×条目的双重循环里反复做 URL 规范化。
 * 传入 language 时只保留该语言的条目。
 */
function buildImageKeyEntries(response, language) {
  const entries = [];
  if (!Array.isArray(response)) return entries;
  for (const item of response) {
    if (language && item?.languageCode !== language) continue;
    const key = getShopifyImageMatchKey(item?.imageBeforeUrl);
    if (!key) continue;
    entries.push({ key, item });
  }
  return entries;
}

/**
 * 观察 DOM 变化，动态处理新图片
 */
export function initProductImgObserver({
  translateSourceArray = [],
  languageCode,
}) {
  if (!Array.isArray(translateSourceArray) || !languageCode) return;

  // 预计算一次 key 列表，观察回调里只做 includes 命中判断
  const keyedEntries = buildImageKeyEntries(translateSourceArray, languageCode);
  if (keyedEntries.length === 0) return;

  _dynamicImageObserver?.disconnect();

  // 只监控图片相关节点的变化
  const observer = new MutationObserver((mutationsList) => {
    for (const mutation of mutationsList) {
      if (mutation.type !== "childList" || mutation.addedNodes.length === 0)
        continue;

      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        processAddedImageNode(node, keyedEntries);
      });
    }
  });

  // 开始监听
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
  _dynamicImageObserver = observer;
}

/**
 * 根据数据库数据替换网页图片
 */
export async function ProductImgTranslate(blockId, shop, ciwiBlock) {
  const productId = resolveStorefrontProductId(ciwiBlock);
  if (!productId) return;

  const languageInput = ciwiBlock.querySelector('input[name="language_code"]');
  const language = languageInput?.value;
  if (!language) return;

  const cacheKey = buildTranslationCacheKey("product_images", [
    shop.value,
    productId,
    language,
  ]);
  let productImageData = await useCacheThenRefresh(
    cacheKey,
    async () =>
      asCacheableTranslationResponse(
        await GetProductImageData({
          blockId,
          shopName: shop.value,
          productId,
          languageCode: language,
        }),
      ),
    CIWI_TRANSLATION_TTL_MS,
    { refetchWhenCachedEmpty: true },
  );

  if (!productImageData?.response?.length) {
    const shopCacheKey = buildTranslationCacheKey("shop_images", [
      shop.value,
      language,
    ]);
    const shopImageData = await useCacheThenRefresh(
      shopCacheKey,
      async () =>
        asCacheableTranslationResponse(
          await GetShopImageData({
            shopName: shop.value,
            blockId,
            languageCode: language,
          }),
        ),
      CIWI_TRANSLATION_TTL_MS,
      { refetchWhenCachedEmpty: true },
    );

    if (shopImageData?.response?.length) {
      productImageData = shopImageData;
    }
  }

  restoreTranslatedImages();

  if (!productImageData?.response?.length) return;

  // 预计算 key 列表，避免对每张 img 都重新 split 整个 response
  const keyedEntries = buildImageKeyEntries(productImageData.response, language);
  if (keyedEntries.length === 0) return;

  const imageDomList = document.querySelectorAll("img");
  imageDomList.forEach((img) => {
    const matched = findMatchedImageEntry(img, keyedEntries);
    if (!matched?.item) return;
    applyTranslatedImage(img, matched.item);
  });

  initProductImgObserver({
    translateSourceArray: productImageData.response,
    languageCode: language,
  });
}

/**
 * 根据数据库数据替换网页文本（安全版）
 */
export async function CustomLiquidTextTranslate(blockId, shop, ciwiBlock) {
  const languageInput = ciwiBlock.querySelector('input[name="language_code"]');
  const language = languageInput?.value;
  if (!language) return;

  const cacheKey = buildTranslationCacheKey("liquid_translations", [
    shop.value,
    language,
  ]);
  // 空规则：服务端已返回 success+{}，可写入 localStorage 负缓存；
  // 短 TTL + 跳过后台刷新，避免无 LiquidRule 店每次 pageview 打 App Proxy。
  const parseLiquidDataByShopNameAndLanguage = await useCacheThenRefresh(
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
  const fuzzyEntries = entries.filter((e) => !e.isExact);

  const looksLikeHtml = (text) => /<\/?[a-z][\s\S]*>/i.test(text || "");

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

  const replaceHtmlExactEntries = (entryList, root = document.body) => {
    if (!root?.isConnected) return;
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

    if (htmlEntries.length === 0) return;

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

    const nodes = [];
    if (
      root instanceof Element &&
      !skipTags.has(root.nodeName) &&
      !(ciwiBlock && ciwiBlock.contains(root)) &&
      !isPriceRelatedElement(root)
    ) {
      nodes.push(root);
    }
    while (walker.nextNode()) nodes.push(walker.currentNode);

    const replacements = [];
    nodes.forEach((node) => {
      if (isElementHiddenForTranslation(node)) return;
      if (isPriceRelatedElement(node)) return;

      // 预筛 1：标签名。任意命中都要求 node.nodeName 等于某条 before 元素标签名。
      if (candidateTags.size > 0 && !candidateTags.has(node.nodeName)) return;

      // 预筛 2：折叠文本。有文本时必须命中某条源文本；无文本时仅放行“仅含元素”的条目。
      // 通过后才做昂贵的 normalizeHtml，避免对全页每个元素都重解析 HTML。
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

      // nodeText 已在循环开头算好（且必为非空才能走到这里时命中文本路径）
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
    });

    replacements.forEach(({ type, node, html }) => {
      if (type === "outer") node.outerHTML = html;
      else node.innerHTML = html;
    });

    if (debugLiquidTranslate) {
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
  };

  const replaceFuzzyEntriesFast = (entryList, root = document.body) => {
    if (!root?.isConnected) return;
    const preparedEntries = [];
    entryList.forEach(({ before, after }) => {
      const prepared = createPreparedTextEntry(before, after);
      if (!prepared) return;
      preparedEntries.push(prepared);
    });

    if (preparedEntries.length === 0) return;

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

    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    if (debugLiquidTranslate && entryList.length <= 50) {
      debugLog("textFuzzyFast", {
        entries: preparedEntries.length,
        nodes: nodes.length,
        root: root === document.body ? "body" : root.nodeName,
      });
    }

    nodes.forEach((node) => {
      if (isElementHiddenForTranslation(node.parentElement)) return;
      if (isPriceRelatedElement(node)) return;

      // 这些派生值只跟当前节点内容有关、与 entry 无关，因此每个节点只算一次；
      // collapsed 仅在遇到 flexibleWhitespace 的 entry 时按需计算。
      // 仅当本节点真正被替换后，才刷新缓存，保证多条 entry 命中同一节点时的级联替换行为不变。
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

        // 节点内容已变，刷新派生值供后续 entry 使用
        original = node.nodeValue;
        normalized = normalizeText(original);
        collapsed = null;
      }
    });
  };

  const replaceExactEntriesFast = (entryList, root = document.body) => {
    if (!root?.isConnected) return;
    const exactMap = new Map();
    entryList.forEach(({ before, after }) => {
      const prepared = createPreparedTextEntry(before, after);
      if (!prepared) return;
      exactMap.set(prepared.matchKey, {
        replacement: prepared.afterRaw,
        flexibleWhitespace: prepared.flexibleWhitespace,
      });
    });

    if (exactMap.size === 0) return;

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

    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    if (debugLiquidTranslate && entryList.length <= 50) {
      debugLog("textExactFast", {
        keys: exactMap.size,
        nodes: nodes.length,
        root: root === document.body ? "body" : root.nodeName,
      });
    }

    nodes.forEach((node) => {
      if (isElementHiddenForTranslation(node.parentElement)) return;
      if (isPriceRelatedElement(node)) return;
      const original = node.nodeValue;
      const { strict: strictKey, collapsed: collapsedKey } = getNodeMatchKeys(original);
      const entry = exactMap.get(strictKey) || exactMap.get(collapsedKey);
      if (!entry) return;
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
    });
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

  const replaceAttributeEntriesFast = (
    exactEntryList,
    fuzzyEntryList,
    root = document.body,
  ) => {
    if (!root?.isConnected) return;

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

    if (exactMap.size === 0 && fuzzyPreparedEntries.length === 0) return;

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

    const nodes = [];
    if (
      root instanceof Element &&
      !skipTags.has(root.nodeName) &&
      !(ciwiBlock && ciwiBlock.contains(root)) &&
      !isPriceRelatedElement(root)
    ) {
      nodes.push(root);
    }
    while (walker.nextNode()) nodes.push(walker.currentNode);

    nodes.forEach((node) => {
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
    });
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

  const collectMutationRoots = (mutations) => {
    const roots = [];
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        const target = mutation.target;
        if (target?.nodeType === Node.ELEMENT_NODE && !shouldSkipTranslationRoot(target)) {
          roots.push(target);
        }
        continue;
      }
      if (mutation.type !== "childList") continue;
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (!shouldSkipTranslationRoot(node)) roots.push(node);
        } else if (node.nodeType === Node.TEXT_NODE) {
          const parent = node.parentElement;
          if (parent && !shouldSkipTranslationRoot(parent)) roots.push(parent);
        }
      }
    }
    return roots;
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

  const applyReplacementsToRoots = (roots = [document.body]) => {
    const targets = pruneNestedRoots(
      roots.filter((root) => root?.isConnected && !shouldSkipTranslationRoot(root)),
    );
    if (targets.length === 0) return;

    const scopes = [];
    const seenScopes = new Set();
    const pushScope = (scope) => {
      if (!scope?.isConnected || seenScopes.has(scope)) return;
      seenScopes.add(scope);
      scopes.push(scope);
    };

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

      while (shadowWalker.nextNode()) {
        if (shadowWalker.currentNode.shadowRoot) {
          pushScope(shadowWalker.currentNode.shadowRoot);
        }
      }
    }

    for (const root of scopes) {
      if (hasHtmlEntries(exactEntries) || hasHtmlEntries(fuzzyEntries)) {
        replaceHtmlExactEntries(exactEntries, root);
        replaceHtmlExactEntries(fuzzyEntries, root);
      }
      replaceAttributeEntriesFast(exactEntries, fuzzyEntries, root);
      replaceExactEntriesFast(exactEntries, root);
      replaceFuzzyEntriesFast(fuzzyEntries, root);
    }
  };

  applyReplacementsToRoots();

  if (typeof window !== "undefined") {
    const observerKey = "__ciwi_liquid_translate_observer__";
    if (!window[observerKey]) {
      const pendingRoots = new Set();
      let scheduled = false;
      let lastRunAt = 0;

      const scheduleIncrementalRun = () => {
        if (scheduled) return;
        scheduled = true;

        const now = Date.now();
        const delay = now - lastRunAt < 200 ? 200 : 0;

        setTimeout(() => {
          requestAnimationFrame(() => {
            try {
              const roots = pruneNestedRoots([...pendingRoots]);
              pendingRoots.clear();
              if (roots.length > 0) {
                applyReplacementsToRoots(roots);
              }
            } finally {
              lastRunAt = Date.now();
              scheduled = false;
              if (pendingRoots.size > 0) scheduleIncrementalRun();
            }
          });
        }, delay);
      };

      const observer = new MutationObserver((mutations) => {
        for (const root of collectMutationRoots(mutations)) {
          pendingRoots.add(root);
        }
        if (pendingRoots.size === 0) return;
        scheduleIncrementalRun();
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

/**
 * 批量替换主页图片
 */
export async function HomeImageTranslate(blockId) {
  const shop = document.querySelector("#queryCiwiId")?.value;
  const language = document.querySelector('input[name="language_code"]')?.value;
  if (!shop || !language) {
    console.warn("⚠️ [HomeImageTranslate] missing shop or language", {
      shop,
      language,
    });
    return;
  }

  const cacheKey = buildTranslationCacheKey("shop_images", [shop, language]);
  const translatedImages = await useCacheThenRefresh(
    cacheKey,
    async () =>
      asCacheableTranslationResponse(
        await GetShopImageData({
          shopName: shop,
          blockId,
          languageCode: language,
        }),
      ),
    CIWI_TRANSLATION_TTL_MS,
    { refetchWhenCachedEmpty: true },
  );

  restoreTranslatedImages();

  if (!translatedImages?.response?.length) {
    return;
  }
  const keyedEntries = buildImageKeyEntries(translatedImages.response, language);
  if (keyedEntries.length === 0) {
    return;
  }

  document.querySelectorAll("img").forEach((img) => {
    const matched = findMatchedImageEntry(img, keyedEntries);
    if (!matched?.item) return;
    applyTranslatedImage(img, matched.item);
  });

  initProductImgObserver({
    translateSourceArray: translatedImages.response,
    languageCode: language,
  });
}

/**
 * Web Component：ciwiswitcher-form
 */
export class CiwiswitcherForm extends HTMLElement {
  constructor() {
    super();
    this.elements = {}; // 空对象，等 connectedCallback 再赋值
  }
  connectedCallback() {
    const blockId = this.querySelector('input[name="block_id"]')?.value;
    const ciwiBlock = blockId
      ? document.querySelector(`#shopify-block-${blockId}`)
      : null;
    // 第二个 <ciwiswitcher-form> 只含隐藏国家列表、没有 block_id，
    // 解析不到 ciwiBlock，无需绑定任何交互（否则会白挂一个全局 click 监听）。
    if (!ciwiBlock) return;
    if (isThemePreviewDisabledForCiwi(ciwiBlock)) {
      const ciwiContainer = this.querySelector("#ciwi-container");
      const mainBox = this.querySelector("#main-box");
      const translateFloatBtnText = this.querySelector("#translate-float-btn-text");
      const selectorBackdrop = this.querySelector("#selector-backdrop");
      const languageSelect = this.querySelector(".language_selector_header");
      const currencySelect = this.querySelector(".currency_selector_header");
      if (ciwiContainer) {
        ciwiContainer.dataset.ciwiPreviewDisabled = "1";
      }
      if (mainBox) {
        mainBox.style.pointerEvents = "none";
        mainBox.style.cursor = "default";
      }
      if (translateFloatBtnText) {
        translateFloatBtnText.style.pointerEvents = "none";
        translateFloatBtnText.style.cursor = "default";
      }
      if (selectorBackdrop) {
        selectorBackdrop.style.display = "none";
      }
      if (languageSelect) {
        languageSelect.tabIndex = -1;
        languageSelect.setAttribute("aria-disabled", "true");
        languageSelect.style.pointerEvents = "none";
        languageSelect.style.cursor = "default";
      }
      if (currencySelect) {
        currencySelect.tabIndex = -1;
        currencySelect.setAttribute("aria-disabled", "true");
        currencySelect.style.pointerEvents = "none";
        currencySelect.style.cursor = "default";
      }
      return;
    }

    this.elements = {
      ciwiBlock,
      ciwiContainer: this.querySelector("#ciwi-container"),
      selectorBox: this.querySelector("#selector-box"),
      selectorBackdrop: this.querySelector("#selector-backdrop"),
      languageInput: this.querySelector('input[name="language_code"]'),
      currencyInput: this.querySelector('input[name="currency_code"]'),
      countryInput: this.querySelector('input[name="country_code"]'),
      mainBox: this.querySelector("#main-box"),
      translateFloatBtn: this.querySelector("#translate-float-btn"),
      translateFloatBtnText: this.querySelector("#translate-float-btn-text"),
      languageSelect: this.querySelector(".language_selector_header"),
      currencySelect: this.querySelector(".currency_selector_header"),
      closeButton: this.querySelector(".selector_box_close_button"),
    };
    // 初始化所有事件监听
    this.initializeEventListeners();

    const shouldRestoreOpen =
      !this.isDirectSelectorMode() &&
      !this.isSidebarWidgetMode() &&
      typeof localStorage !== "undefined" &&
      localStorage.getItem("ciwi_switcher_panel_open") === "1";

    if (shouldRestoreOpen) {
      requestAnimationFrame(() => this.openSelectorPanel());
    }
  }
  initializeEventListeners() {
    // 阻止选择器框的点击事件冒泡
    this.elements.selectorBox?.addEventListener("click", (event) => {
      event.stopPropagation();
    });

    this.elements.mainBox?.addEventListener(
      "click",
      this.toggleSelector.bind(this),
    );

    this.elements.translateFloatBtnText?.addEventListener(
      "click",
      this.toggleSelector.bind(this),
    );

    this.elements.languageSelect?.addEventListener(
      "change",
      this.handleSelectChange.bind(this),
    );

    this.elements.currencySelect?.addEventListener(
      "change",
      this.handleSelectChange.bind(this),
    );

    this.elements.closeButton?.addEventListener(
      "click",
      this.handleCancelClick.bind(this),
    );

    this.elements.selectorBackdrop?.addEventListener(
      "click",
      this.handleCancelClick.bind(this),
    );

    window.addEventListener("resize", this.handleWindowResize.bind(this));

    // 点击外部关闭
    document.addEventListener("click", this.handleOutsideClick.bind(this));
  }

  handleWindowResize() {
    syncCompactSwitcherLayout(this.elements.ciwiBlock);
    if (this.elements.selectorBox?.classList.contains("is-open")) {
      this.updateSelectorPlacement();
    }
  }

  isDirectSelectorMode() {
    return this.elements.selectorBox?.dataset.mode === "direct";
  }

  isSidebarWidgetMode() {
    return this.elements.selectorBox?.dataset.layout === "sidebar-widget";
  }

  openSelectorPanel() {
    const box = this.elements.selectorBox;
    // 取消可能仍在等待的关闭隐藏定时器
    if (this._closeTimer) {
      clearTimeout(this._closeTimer);
      this._closeTimer = null;
    }
    box.style.display = "flex";
    if (this.isSidebarWidgetMode()) {
      this.elements.ciwiContainer?.classList.add("expanded");
    } else {
      this.updateSelectorPlacement();
    }
    // 先把元素切到 display:flex，等下一帧再加 is-open，确保淡入过渡能触发
    requestAnimationFrame(() => {
      requestAnimationFrame(() => box.classList.add("is-open"));
    });
    this.rotateArrow("#mainbox-arrow-icon", 180);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("ciwi_switcher_panel_open", "1");
    }
  }

  closeSelectorPanel() {
    const box = this.elements.selectorBox;
    if (this.isSidebarWidgetMode()) {
      this.elements.ciwiContainer?.classList.remove("expanded");
    }
    box.classList.remove("is-open");
    if (this.elements.selectorBackdrop) {
      this.elements.selectorBackdrop.style.display = "none";
    }
    this.rotateArrow("#mainbox-arrow-icon", 0);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("ciwi_switcher_panel_open", "0");
    }

    // direct 模式常驻显示，不隐藏
    if (this.isDirectSelectorMode()) {
      box.style.display = "flex";
      return;
    }
    // 等淡出过渡结束再 display:none；定时器兜底，避免 transitionend 偶发不触发
    if (this._closeTimer) clearTimeout(this._closeTimer);
    this._closeTimer = setTimeout(() => {
      box.style.display = "none";
      this._closeTimer = null;
    }, 220);
  }

  updateSelectorPlacement() {
    if (this.isDirectSelectorMode() || this.isSidebarWidgetMode()) return;

    const selectorBox = this.elements.selectorBox;
    const anchor =
      this.elements.mainBox?.style.display !== "none"
        ? this.elements.mainBox
        : this.elements.translateFloatBtn;

    if (!selectorBox || !anchor) return;

    const anchorRect = anchor.getBoundingClientRect();
    const selectorRect = selectorBox.getBoundingClientRect();
    const selectorHeight = selectorRect.height || selectorBox.scrollHeight || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const spaceAbove = anchorRect.top;
    const spaceBelow = viewportHeight - anchorRect.bottom;
    const preferredPlacement = selectorBox.dataset.preferredPlacement || "down";

    let placement = preferredPlacement;
    if (spaceBelow < selectorHeight && spaceAbove > spaceBelow) {
      placement = "up";
    } else if (spaceAbove < selectorHeight && spaceBelow >= spaceAbove) {
      placement = "down";
    }

    selectorBox.dataset.placement = placement;
    selectorBox.style.top = placement === "down" ? "100%" : "auto";
    selectorBox.style.bottom = placement === "up" ? "100%" : "auto";
  }

  async handleSelectChange(event) {
    const select = event.currentTarget;
    const value = select?.value;
    const selectorType = select?.dataset.type;
    const shouldClosePanel = !this.isDirectSelectorMode();
    const closePanelAfterSelection = () => {
      if (!shouldClosePanel) return;
      select?.blur?.();
      this.closeSelectorPanel();
      requestAnimationFrame(() => this.closeSelectorPanel());
    };

    if (selectorType === "language") {
      if (!value || this.elements.languageInput.value == value) return;
      this.elements.languageInput.value = value;
      syncMarketFlags(this.data, this.elements.ciwiBlock);
    } else if (selectorType === "currency") {
      if (!value || this.elements.currencyInput.value == value) return;
      this.elements.currencyInput.value = value;
      localStorage.setItem("ciwi_selected_currency", value);
      closePanelAfterSelection();
      event.preventDefault();

      const languageSelectorContainer = this.elements.ciwiBlock.querySelector(
        "#language-switcher-container",
      );
      const currencySelectorContainer = this.elements.ciwiBlock.querySelector(
        "#currency-switcher-container",
      );
      updateDisplayText(
        languageSelectorContainer?.style.display === "block",
        currencySelectorContainer?.style.display === "block",
        this.elements.ciwiBlock,
      );

      try {
        await refreshSelectedCurrency({
          blockId: this.querySelector('input[name="block_id"]')?.value,
          shop: this.elements.ciwiBlock.querySelector("#queryCiwiId")?.value,
          ciwiBlock: this.elements.ciwiBlock,
        });
      } finally {
        closePanelAfterSelection();
      }
      return;
    }

    closePanelAfterSelection();
    event.preventDefault();

    const languageSelectorContainer = this.elements.ciwiBlock.querySelector(
      "#language-switcher-container",
    );
    const currencySelectorContainer = this.elements.ciwiBlock.querySelector(
      "#currency-switcher-container",
    );
    updateDisplayText(
      languageSelectorContainer?.style.display === "block",
      currencySelectorContainer?.style.display === "block",
      this.elements.ciwiBlock,
    );
    const form = this.querySelector("form");

    if (form) {
      const returnToUrl = new URL(window.location.href);
      returnToUrl.searchParams.set(CIWI_MANUAL_LOCALIZATION_QUERY_KEY, "1");
      let returnToInput = form.querySelector('input[name="return_to"]');
      if (!returnToInput) {
        returnToInput = document.createElement("input");
        returnToInput.type = "hidden";
        returnToInput.name = "return_to";
        form.appendChild(returnToInput);
      }
      returnToInput.value =
        `${returnToUrl.pathname}${returnToUrl.search}${returnToUrl.hash}`;
      persistManualLocalizationPreference({
        country: this.elements.countryInput?.value,
        language: this.elements.languageInput?.value,
      });
      form.submit();
    }
  }

  handleCancelClick(event) {
    event.preventDefault();
    if (this.isDirectSelectorMode()) return;
    this.closeSelectorPanel();
  }

  handleOutsideClick(event) {
    if (this.isDirectSelectorMode()) return;
    if (
      this.elements.ciwiContainer &&
      !this.elements.ciwiContainer.contains(event.target)
    ) {
      if (this.elements.selectorBox) this.closeSelectorPanel();
    }
  }

  toggleSelector(event) {
    event.preventDefault();
    if (this.isDirectSelectorMode()) return;
    const ciwiBlock = this.elements.ciwiBlock;
    if (!ciwiBlock) {
      console.error("ciwiBlock not found");
      return;
    }

    // 以 is-open 类判断开合状态，避免与关闭时延迟 200ms 的 display:none 抢节奏
    const isOpen = this.elements.selectorBox.classList.contains("is-open");
    if (isOpen) {
      this.closeSelectorPanel();
    } else {
      this.openSelectorPanel();
    }
  }

  rotateArrow(elementId, degrees) {
    const arrow = this.elements.ciwiBlock.querySelector(elementId);
    if (arrow) {
      arrow.style.transform = `rotate(${degrees}deg)`;
      arrow.style.transformOrigin = "center center"; // 确保旋转中心点在图标中心
    }
  }

  closeAllSelectors() {
    return;
  }
}

// ============================================================
// 自动抓取店面第三方未翻译文本（switcher opt-in）
// 复用 skipTags / normalizeText / isElementHiddenForTranslation，
// 遍历可见文本节点，客户端去重后上报后端；后端异步翻译回填 LiquidRule。
// ============================================================

const AUTO_LIQUID_MAX_LEN = 200;
const AUTO_LIQUID_MIN_LEN = 2;
/** 单次 POST 分片大小（对齐服务端 MAX_PER_REQUEST）；候选本身不设条数上限。 */
const AUTO_LIQUID_POST_CHUNK = 100;
const AUTO_LIQUID_REPORTED_CAP = 1500; // 客户端已报指纹上限

// 性能护栏：最多遍历节点数；扫描按 idle 分片（单片时间上限），不因超时整页放弃。
const AUTO_LIQUID_MAX_NODES = 6000;
/** 单片主线程扫描上限（ms）；到点 yield，继续下一段 idle。 */
const AUTO_LIQUID_SLICE_MS = 8;
/** 同店同语采集防重入。 */
const autoLiquidCollectInFlight = new Set();

/** 店面采集日志默认开；localStorage.ciwi_debug_auto_liquid=0 可关。 */
function autoLiquidLog(...args) {
  try {
    const flag =
      typeof localStorage !== "undefined"
        ? localStorage.getItem("ciwi_debug_auto_liquid")
        : null;
    if (flag === "0" || flag === "false") return;
    console.log("[ciwi-auto-liquid]", ...args);
  } catch {
    // ignore
  }
}

function autoLiquidLocaleBase(locale) {
  return String(locale || "")
    .trim()
    .replace(/_/g, "-")
    .toLowerCase()
    .split("-")[0];
}

/**
 * 非拉丁脚本正则：命中即视为该语言脚本。
 * 拉丁系（en/fr/pt/es…）返回 null，改走字符/词启发式。
 */
function localeScriptRegex(locale) {
  const l = String(locale || "")
    .trim()
    .replace(/_/g, "-")
    .toLowerCase();
  if (l.startsWith("ja"))
    return /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
  if (l.startsWith("zh")) return /\p{Script=Han}/u;
  if (l.startsWith("ko")) return /\p{Script=Hangul}/u;
  if (l.startsWith("ar") || l.startsWith("fa") || l.startsWith("ur"))
    return /\p{Script=Arabic}/u;
  if (
    l.startsWith("ru") ||
    l.startsWith("uk") ||
    l.startsWith("bg") ||
    l.startsWith("sr")
  )
    return /\p{Script=Cyrillic}/u;
  if (l.startsWith("th")) return /\p{Script=Thai}/u;
  if (l.startsWith("he") || l.startsWith("iw")) return /\p{Script=Hebrew}/u;
  if (l.startsWith("el")) return /\p{Script=Greek}/u;
  if (l.startsWith("hi") || l.startsWith("mr") || l.startsWith("ne"))
    return /\p{Script=Devanagari}/u;
  return null;
}

/** 拉丁目标语特有变音/标点（相对英语 ASCII 可区分）。 */
const LATIN_DIACRITIC_RE = {
  pt: /[ãõáàâéêíóôúüçÃÕÁÀÂÉÊÍÓÔÚÜÇ]/,
  es: /[ñáéíóúü¿¡ÑÁÉÍÓÚÜ]/,
  fr: /[àâäéèêëïîôùûüçœæÀÂÄÉÈÊËÏÎÔÙÛÜÇŒÆ]/,
  de: /[äöüßÄÖÜ]/,
  it: /[àèéìíîòóùúÀÈÉÌÍÎÒÓÙÚ]/,
  nl: /[áéíóúäëïöüĳÁÉÍÓÚÄËÏÖÜ]/,
  pl: /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/,
  tr: /[çğıöşüÇĞİÖŞÜ]/,
  sv: /[åäöÅÄÖ]/,
  da: /[æøåÆØÅ]/,
  nb: /[æøåÆØÅ]/,
  nn: /[æøåÆØÅ]/,
  fi: /[äöåÄÖÅ]/,
  cs: /[áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/,
  hu: /[áéíóöőúüűÁÉÍÓÖŐÚÜŰ]/,
  ro: /[ăâîșţțĂÂÎȘŢȚ]/,
  vi: /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ]/,
};

/** 拉丁语常见功能词（无变音时的弱信号）。 */
const LATIN_WORD_HINT_RE = {
  en: /\b(the|and|for|with|your|you|this|that|are|was|from|have|has|not|but|all|can|will|review|reviews|product|products|add|cart|buy|shipping|free|write|verified|customer|customers|out of|stars?)\b/i,
  pt: /\b(para|com|uma|você|seu|sua|produto|produtos|avaliac|comprar|carrinho|frete|enviar|cliente|clientes|estrelas?)\b/i,
  es: /\b(para|con|una|usted|producto|productos|reseña|comprar|carrito|env[ií]o|cliente|clientes|estrellas?)\b/i,
  fr: /\b(pour|avec|une|vous|produit|produits|avis|acheter|panier|livraison|client|clients|étoiles?)\b/i,
  de: /\b(und|für|mit|ihre?|produkt|produkte|bewertung|kaufen|warenkorb|versand|kunde|kunden|sterne?)\b/i,
  it: /\b(per|con|una|voi|prodotto|prodotti|recensione|acquista|carrello|spedizione|cliente|clienti|stelle?)\b/i,
};

/**
 * 拉丁文本是否「像」某 locale（变音优先，其次词表）。
 */
function latinLooksLikeLocale(locale, text) {
  const base = autoLiquidLocaleBase(locale);
  if (!base || !text) return false;
  const dia = LATIN_DIACRITIC_RE[base];
  if (dia && dia.test(text)) return true;
  const words = LATIN_WORD_HINT_RE[base];
  if (words && words.test(text)) return true;
  return false;
}

/** 字母是否以 Basic Latin (A–Z) 为主（弱英文信号；有变音则否）。 */
function isMostlyBasicLatinLetters(text) {
  const letters = String(text || "").match(/\p{L}/gu) || [];
  if (letters.length < 2) return false;
  let basic = 0;
  for (const ch of letters) {
    if (/[A-Za-z]/.test(ch)) basic += 1;
  }
  return basic / letters.length >= 0.9;
}

/** 是否像「非主语言」的其它拉丁语（用于挡德/法等误采）。 */
function latinLooksLikeOtherLocale(primaryLocale, text) {
  const primaryBase = autoLiquidLocaleBase(primaryLocale) || "en";
  const bases = new Set([
    ...Object.keys(LATIN_DIACRITIC_RE),
    ...Object.keys(LATIN_WORD_HINT_RE),
  ]);
  for (const base of bases) {
    if (base === primaryBase) continue;
    if (latinLooksLikeLocale(base, text)) return true;
  }
  return false;
}

/**
 * 是否像店铺主语言（采集只收这类「未译源语」）。
 * - 脚本语言：含主语言脚本
 * - 拉丁主语言：变音/词表命中；英文另允许「高 ASCII 字母占比且不像其它拉丁语」
 */
function looksLikePrimaryLocale(primaryLocale, text) {
  if (!primaryLocale || !text) return false;
  const primaryRe = localeScriptRegex(primaryLocale);
  if (primaryRe) return primaryRe.test(text);

  if (latinLooksLikeLocale(primaryLocale, text)) return true;

  const base = autoLiquidLocaleBase(primaryLocale);
  // en（及未识别 base 当 en）：弱 ASCII 启发式，但其它拉丁语强信号优先否决
  if (!base || base === "en") {
    if (latinLooksLikeOtherLocale(primaryLocale || "en", text)) return false;
    return isMostlyBasicLatinLetters(text);
  }
  return false;
}

/**
 * 相对目标语 + 主语言判定：source | target | unknown
 * 只采「像主语言」且「不像目标语」；无 primary 时不猜（unknown，避免德文当英文）。
 */
function classifyAutoLiquidText(text, targetLocale, primaryLocale) {
  const targetRe = localeScriptRegex(targetLocale);

  // 已像目标语 → 跳过
  if (targetRe) {
    if (targetRe.test(text)) return "target";
  } else if (latinLooksLikeLocale(targetLocale, text)) {
    return "target";
  }

  if (!primaryLocale) return "unknown";

  // 像其它拉丁语（相对主语言）→ 不采
  if (
    !localeScriptRegex(primaryLocale) &&
    latinLooksLikeOtherLocale(primaryLocale, text)
  ) {
    return "unknown";
  }

  return looksLikePrimaryLocale(primaryLocale, text) ? "source" : "unknown";
}

function autoLiquidReportedKey(shopValue, language) {
  return `ciwi_auto_liquid_reported:${shopValue}:${language}`;
}

function loadAutoLiquidReported(key) {
  try {
    const raw = localStorage.getItem(key);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveAutoLiquidReported(key, set) {
  try {
    let arr = Array.from(set);
    if (arr.length > AUTO_LIQUID_REPORTED_CAP) {
      arr = arr.slice(arr.length - AUTO_LIQUID_REPORTED_CAP);
    }
    localStorage.setItem(key, JSON.stringify(arr));
  } catch {
    // 忽略 localStorage 配额错误
  }
}

function isAutoLiquidCandidate(text) {
  const t = normalizeText(text);
  if (t.length < AUTO_LIQUID_MIN_LEN || t.length > AUTO_LIQUID_MAX_LEN) return false;
  // 至少含一个字母（含 CJK / 各语言字母），过滤纯数字 / 符号
  if (!/\p{L}/u.test(t)) return false;
  if (looksLikeHtmlMarkupFragment(t)) return false;
  if (looksLikeAutoLiquidJunk(t)) return false;
  return true;
}

/**
 * 与 translation-core `looksLikeHtmlMarkupFragment` 对齐：拦 img/source 属性碎片。
 * 例：`}" loading="lazy" width="1536" height="2048" />`
 */
function looksLikeHtmlMarkupFragment(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (/\b(loading|srcset|decoding|fetchpriority)\s*=\s*["']/i.test(t)) return true;
  const attrs = t.match(/\b[\w:-]+\s*=\s*(["'])(?:(?!\1).)*\1/g);
  if (attrs && attrs.length >= 2) return true;
  if (/^[}\]"'`,;]+/.test(t) && /\b[\w:-]+\s*=\s*["']/.test(t)) return true;
  if (/\/\s*>\s*$/.test(t) && /\b[\w:-]+\s*=\s*["']/.test(t)) return true;
  return false;
}

/**
 * 与 translation-core `autoLiquidJunk.ts` 对齐：评价/价格/SKU/年款 + A–E
 *（品牌平台、人名、规格型号、尺码码、语言切换标签）。短 UI（FAQ/Price/Shop）不拦。
 */
function looksLikeAutoLiquidJunk(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (
    /\b(reviews?|ratings?|verified|stars?|sterren|stelle|étoiles?|estrellas?|bewertungen?)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (/★/.test(t)) return true;
  if (/\d+\s*stars?\s*:/i.test(t)) return true;
  if (/\d+\s*[:：]\s*\d+/.test(t) && /%/.test(t)) return true;
  if (/[$€£¥₹]\s*\d[\d,.'’]*/.test(t)) return true;
  if (/\d[\d,.'’]*\s*(JPY|EUR|USD|GBP|CNY|RMB)\b/i.test(t)) return true;
  if (/^SKU\s*[：:]/i.test(t)) return true;
  if (/\b(19|20)\d{2}\s+and\s+later\b/i.test(t)) return true;
  if (t.length <= 80 && /\b(19|20)\d{2}\s*[-–—]\s*(19|20)\d{2}\b/.test(t)) return true;
  if (!/\s/.test(t) && /^[A-Z0-9]{4,12}$/i.test(t) && /\d/.test(t)) return true;
  if (/^\d+\s*%\s*OFF$/i.test(t)) return true;
  if (/^(EUR|USD|GBP|JPY|CNY|RMB)\s*[€$£¥]?$/i.test(t)) return true;
  if (
    /^(USD|EUR|GBP|JPY|CNY|RMB|SGD|AUD|CAD|HKD|CHF|NZD|SEK|NOK|DKK|PLN|INR|KRW|TWD|THB|MYR|PHP|VND|IDR)\s*[$€£¥]?$/i.test(
      t,
    )
  ) {
    return true;
  }

  // A brand / platform / payment / vehicle brand (exact)
  if (
    /^(facebook|instagram|youtube|tiktok|pinterest|twitter|linkedin|whatsapp|spotify|audible|google|apple|carplay|hicar|carlife|cgplay|bluetooth|waze|paypal|visa|mastercard|bancontact|amex|maestro|klarna|apple pay|google pay|american express|ducati|yamaha|honda|suzuki|triumph|bmw|ktm|wifi|wi-fi)$/i.test(
      t,
    )
  ) {
    return true;
  }
  // E locale switcher labels (exact; keep FAQ/Shop/Price out)
  if (
    /^(english|deutsch|german|italiano|italian|nederlands|dutch|polski|polish|français|francais|french|español|espanol|spanish|português|portugues|portuguese|русский|russian|日本語|japanese|中文|简体中文|繁體中文|繁体中文|chinese|한국어|korean|العربية|arabic|svenska|swedish|dansk|danish|norsk|norwegian|suomi|finnish|čeština|cestina|czech|magyar|hungarian|română|romana|romanian|ελληνικά|greek|türkçe|turkce|turkish|ไทย|thai|українська|ukrainian|hrvatski|croatian|български|bulgarian|slovenčina|slovak|slovenščina|slovenian|hebrew|עברית|hindi|हिन्दी)$/i.test(
      t,
    )
  ) {
    return true;
  }
  // D size codes
  if (/^(XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|5XL)$/i.test(t)) return true;
  // B person / handle
  if (/^anonymous$/i.test(t)) return true;
  if (/^@[A-Za-z0-9._-]{2,40}$/.test(t)) return true;
  if (/^[A-Z][a-z]{1,20}\s+[A-Z]\.?$/.test(t)) return true;
  if (/^[A-Z]\.?\s+[A-Z]\.?$/.test(t)) return true;
  // C spec / coupon / EU size / dimensions
  if (/\d+(?:\.\d+)?\s*[*x×]\s*\d+/i.test(t)) return true;
  if (
    t.length <= 24 &&
    /^\d+(?:[.,]\d+)?\s*(mm|cm|m|kg|g|hz|mhz|ghz|fps|v|w|mah)\b/i.test(t)
  ) {
    return true;
  }
  if (/^EU\s*\d{2}$/i.test(t)) return true;
  if (/^[A-Z]{6,}\d{2,}$/.test(t)) return true;
  if (/^,\s*[A-Za-z0-9][A-Za-z0-9 ./-]{0,30}$/.test(t)) return true;
  if (/^\d+\s+likes?$/i.test(t)) return true;

  // Product / vehicle model codes (keep aligned with autoLiquidJunk.ts)
  if (/\b[A-Z]{2,}-\d+\b/i.test(t)) return true;
  if (/^[A-Z]*\d+[A-Z]*\s+[A-Z]{1,4}$/i.test(t)) return true;
  if (/^[A-Z]\d{3,4}(\s+[A-Z]{1,4})?$/i.test(t)) return true;
  if (/^[A-Z]\s+[A-Z][a-z]+[A-Z][a-zA-Z0-9]*$/.test(t)) return true;
  if (/^[A-Z]{1,6}(?:\s+[A-Z]{1,4})?\s+\d{1,4}[A-Z]?$/i.test(t)) return true;
  if (
    !/\s/.test(t) &&
    /^[A-Z0-9]{4,8}$/.test(t) &&
    /^[A-Z]{4,8}$/.test(t) &&
    !/^(CART|SHOP|SALE|FREE|APP|USB|GPS|FAQ|PDF|HTML|HTTP|WIFI)$/.test(t)
  ) {
    return true;
  }
  return false;
}

/** 评价 App 常见容器：采集时跳过整块 DOM。 */
const AUTO_LIQUID_REVIEW_ANCESTOR_SELECTOR = [
  '[class*="judgeme"]',
  '[class*="loox"]',
  '[class*="yotpo"]',
  '[class*="stamped"]',
  '[class*="review-widget"]',
  '[class*="product-reviews"]',
  '[class*="rating"]',
  '[id*="review"]',
].join(", ");

function isAutoLiquidReviewAncestor(element) {
  if (!element || typeof element.closest !== "function") return false;
  try {
    return Boolean(element.closest(AUTO_LIQUID_REVIEW_ANCESTOR_SELECTOR));
  } catch {
    return false;
  }
}

/**
 * 采集扫描根：主文档 body + open shadowRoot + 同源 iframe（含嵌套同源）。
 * 跨域 iframe / closed shadow 无法访问，自动跳过。
 */
function collectAutoLiquidScanRoots(ciwiBlock) {
  const roots = [];
  const seenRoots = new Set();
  const seenDocs = new Set();

  const pushRoot = (root) => {
    if (!root || seenRoots.has(root)) return;
    seenRoots.add(root);
    roots.push(root);
  };

  // 跨 iframe realm 时 `instanceof ShadowRoot` 可能失败，用 host 特征判断。
  const isShadowRootNode = (node) =>
    !!(
      node &&
      node.nodeType === Node.DOCUMENT_FRAGMENT_NODE &&
      node.host
    );

  const docOf = (node) => {
    try {
      if (!node) return document;
      if (node.nodeType === Node.DOCUMENT_NODE) return node;
      // ShadowRoot 无 createTreeWalker，必须用 host 所在 document
      if (isShadowRootNode(node)) {
        return node.ownerDocument || node.host?.ownerDocument || document;
      }
      return node.ownerDocument || document;
    } catch {
      return document;
    }
  };

  const addShadowsIn = (scope) => {
    if (!scope) return;
    pushRoot(scope);
    const walkerDoc = docOf(scope);

    try {
      if (scope.nodeType === Node.ELEMENT_NODE && scope.shadowRoot) {
        addShadowsIn(scope.shadowRoot);
      }
      const elWalker = walkerDoc.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT, {
        acceptNode(node) {
          if (!node || skipTags.has(node.nodeName)) return NodeFilter.FILTER_REJECT;
          try {
            if (ciwiBlock && ciwiBlock.contains(node)) return NodeFilter.FILTER_REJECT;
          } catch {
            // 跨文档 contains 可能抛错 → 不据此拒绝
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      while (elWalker.nextNode()) {
        const el = elWalker.currentNode;
        if (el?.shadowRoot) addShadowsIn(el.shadowRoot);
      }
    } catch {
      // ignore broken roots
    }
  };

  const addDocumentTree = (doc) => {
    if (!doc || seenDocs.has(doc)) return;
    seenDocs.add(doc);
    try {
      if (doc.body) addShadowsIn(doc.body);
    } catch {
      // ignore
    }
    let iframes = [];
    try {
      iframes = Array.from(doc.querySelectorAll("iframe"));
    } catch {
      return;
    }
    for (const iframe of iframes) {
      try {
        const idoc = iframe.contentDocument;
        if (idoc) addDocumentTree(idoc);
      } catch {
        // 跨域：读不到 contentDocument
      }
    }
  };

  try {
    addDocumentTree(document);
  } catch {
    if (document.body) pushRoot(document.body);
  }

  return roots;
}

function createAutoLiquidTextWalker(root, ciwiBlock) {
  let walkerDoc = document;
  try {
    if (
      root &&
      root.nodeType === Node.DOCUMENT_FRAGMENT_NODE &&
      root.host
    ) {
      walkerDoc = root.ownerDocument || root.host?.ownerDocument || document;
    } else if (root?.ownerDocument) {
      walkerDoc = root.ownerDocument;
    }
  } catch {
    walkerDoc = document;
  }

  return walkerDoc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (skipTags.has(parent.nodeName)) return NodeFilter.FILTER_REJECT;
      try {
        if (ciwiBlock && ciwiBlock.contains(parent)) return NodeFilter.FILTER_REJECT;
        if (typeof parent.closest === "function" && parent.closest("#ciwi-container")) {
          return NodeFilter.FILTER_REJECT;
        }
      } catch {
        // ignore
      }
      if (parent.isContentEditable) return NodeFilter.FILTER_REJECT;
      if (isElementHiddenForTranslation(parent)) return NodeFilter.FILTER_REJECT;
      if (isPriceRelatedElement(parent)) return NodeFilter.FILTER_REJECT;
      if (isAutoLiquidReviewAncestor(parent)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
}

/**
 * 抓取当前页面上未翻译文本并上报后端（默认开；主题预览 / 主语言页由调用方跳过）。
 * 门C：只上报仍像源语言的条目。客户端去重 + 指纹缓存；重活在后端；翻译业务过滤在入库侧。
 * 性能：外层 idle 调度 + TreeWalker 分片 yield；到节点上限用已扫候选上报，不因时间整页放弃。
 * @param {{ primaryLanguage?: string }} [options]
 */
export function CollectUntranslatedText(shop, ciwiBlock, options = {}) {
  let flightKey = "";
  try {
    const shopValue = shop?.value || shop;
    const language = ciwiBlock?.querySelector(
      'input[name="language_code"]',
    )?.value;
    const primaryLanguage = options?.primaryLanguage || "";
    autoLiquidLog("primary_language", {
      primaryLanguage: primaryLanguage || null,
      currentLanguage: language || null,
      source: "options.primaryLanguage ← switcher config (Shopify primary locale)",
    });
    autoLiquidLog("start", {
      shop: shopValue,
      language,
      primaryLanguage,
      href: typeof location !== "undefined" ? location.href : "",
    });
    if (!shopValue || !language) {
      autoLiquidLog("skip", { reason: "missing_shop_or_language", shopValue, language });
      return;
    }

    // 本会话已判定无需采集（未开启 / 主语言 / 未就绪）→ 直接跳过
    const sessionFlag = `ciwi_auto_liquid_off:${shopValue}:${language}`;
    try {
      if (sessionStorage.getItem(sessionFlag) === "1") {
        autoLiquidLog("skip", {
          reason: "session_off",
          sessionFlag,
          hint: "清 sessionStorage 该键后可重试",
        });
        return;
      }
    } catch {}

    flightKey = `${shopValue}:${language}`;
    if (autoLiquidCollectInFlight.has(flightKey)) {
      autoLiquidLog("skip", { reason: "in_flight", flightKey });
      return;
    }
    autoLiquidCollectInFlight.add(flightKey);

    if (!primaryLanguage) {
      autoLiquidLog("skip", {
        reason: "missing_primary_language",
        hint: "switcher config 未带 primaryLanguage（服务端从 Shopify 主 locale 解析）；本轮不采以免误收其它语",
      });
      autoLiquidCollectInFlight.delete(flightKey);
      return;
    }

    const targetScript = localeScriptRegex(language);
    autoLiquidLog("classify_mode", {
      language,
      primaryLanguage,
      targetHasScript: !!targetScript,
      mode: targetScript ? "script+primary" : "latin+primary",
      note: "只采像主语言且不像目标语的文本",
    });

    const reportedKey = autoLiquidReportedKey(shopValue, language);
    const reported = loadAutoLiquidReported(reportedKey);

    if (!document.body) {
      autoLiquidCollectInFlight.delete(flightKey);
      autoLiquidLog("skip", { reason: "no_body" });
      return;
    }

    const scanRoots = collectAutoLiquidScanRoots(ciwiBlock);
    if (!scanRoots.length) {
      autoLiquidCollectInFlight.delete(flightKey);
      autoLiquidLog("skip", { reason: "no_scan_roots" });
      return;
    }
    autoLiquidLog("scan_roots", {
      count: scanRoots.length,
      note: "body + open shadowRoot + same-origin iframe(s)",
    });

    const startedAt =
      typeof performance !== "undefined" && performance.now
        ? performance.now()
        : Date.now();
    const now = () =>
      typeof performance !== "undefined" && performance.now
        ? performance.now()
        : Date.now();

    const seen = new Set();
    const candidates = []; // 仍像源语言、未上报过的候选
    let sourceCount = 0;
    let targetCount = 0;
    let unknownCount = 0;
    let nodes = 0;
    let truncated = false;
    let rootIndex = 0;
    let walker = createAutoLiquidTextWalker(scanRoots[0], ciwiBlock);
    rootIndex = 1;

    const scheduleSlice = (fn) => {
      if (typeof window !== "undefined" && "requestIdleCallback" in window) {
        window.requestIdleCallback(fn, { timeout: 1000 });
      } else {
        setTimeout(fn, 0);
      }
    };

    const finishAndMaybePost = () => {
      autoLiquidCollectInFlight.delete(flightKey);
      const elapsedMs = Math.round(now() - startedAt);
      autoLiquidLog("scan", {
        nodes,
        uniqueTexts: seen.size,
        elapsedMs,
        truncated,
        truncateReason: truncated ? "max_nodes" : null,
        scanRoots: scanRoots.length,
        sourceCount,
        targetCount,
        unknownCount,
        candidateCount: candidates.length,
        sliceMs: AUTO_LIQUID_SLICE_MS,
        maxNodes: AUTO_LIQUID_MAX_NODES,
      });

      if (!candidates.length) {
        autoLiquidLog("skip", { reason: "no_candidates", sourceCount, truncated });
        return;
      }

      autoLiquidLog("post", {
        language,
        primaryLanguage,
        count: candidates.length,
        chunks: Math.ceil(candidates.length / AUTO_LIQUID_POST_CHUNK),
        chunkSize: AUTO_LIQUID_POST_CHUNK,
        truncated,
        texts: candidates.slice(0, 15).map((t) => t.slice(0, 80)),
      });

      // 分片上报；成功后再写入已报指纹（避免失败也被标已报）。
      const postChunks = async () => {
        for (let i = 0; i < candidates.length; i += AUTO_LIQUID_POST_CHUNK) {
          const chunk = candidates.slice(i, i + AUTO_LIQUID_POST_CHUNK);
          try {
            const res = await CollectLiquidStrings({
              shopName: shopValue,
              languageCode: language,
              texts: chunk,
            });
            const body = res?.response;
            autoLiquidLog("response", {
              success: res?.success,
              chunkIndex: Math.floor(i / AUTO_LIQUID_POST_CHUNK),
              chunkCount: chunk.length,
              scheduled: body?.scheduled,
              skipped: body?.skipped,
              reason: body?.reason,
              raw: body,
            });
            if (res?.success) {
              chunk.forEach((t) => reported.add(t));
              saveAutoLiquidReported(reportedKey, reported);
            }
            const reason = body?.reason;
            if (
              body?.skipped &&
              (reason === "disabled" ||
                reason === "primary_locale" ||
                reason === "total_cap" ||
                reason === "daily_cap" ||
                reason === "resource_not_ready")
            ) {
              try {
                sessionStorage.setItem(sessionFlag, "1");
              } catch {}
              autoLiquidLog("session_off_from_server", { reason, sessionFlag });
              break;
            }
          } catch (err) {
            autoLiquidLog("request_failed", {
              chunkIndex: Math.floor(i / AUTO_LIQUID_POST_CHUNK),
              err,
            });
            break;
          }
        }
      };
      postChunks();
    };

    const pump = (deadline) => {
      try {
        const sliceStart = now();
        const sliceExhausted = () => {
          if (
            deadline &&
            typeof deadline.timeRemaining === "function" &&
            deadline.timeRemaining() < 1
          ) {
            return true;
          }
          return now() - sliceStart >= AUTO_LIQUID_SLICE_MS;
        };

        while (!truncated) {
          if (!walker) {
            if (rootIndex >= scanRoots.length) break;
            walker = createAutoLiquidTextWalker(scanRoots[rootIndex], ciwiBlock);
            rootIndex += 1;
            continue;
          }

          if (!walker.nextNode()) {
            walker = null;
            continue;
          }

          nodes += 1;
          if (nodes > AUTO_LIQUID_MAX_NODES) {
            truncated = true;
            break;
          }

          const t = normalizeText(walker.currentNode.nodeValue || "");
          if (!isAutoLiquidCandidate(t)) {
            if (sliceExhausted()) {
              scheduleSlice(pump);
              return;
            }
            continue;
          }
          if (seen.has(t)) {
            if (sliceExhausted()) {
              scheduleSlice(pump);
              return;
            }
            continue;
          }
          seen.add(t);

          const cls = classifyAutoLiquidText(t, language, primaryLanguage);
          if (cls === "source") {
            sourceCount += 1;
            if (!reported.has(t)) {
              candidates.push(t);
            }
          } else if (cls === "target") {
            targetCount += 1;
          } else {
            unknownCount += 1;
          }

          if (sliceExhausted()) {
            scheduleSlice(pump);
            return;
          }
        }

        finishAndMaybePost();
      } catch (err) {
        autoLiquidCollectInFlight.delete(flightKey);
        console.error("[ciwi-auto-liquid] CollectUntranslatedText failed:", err);
      }
    };

    scheduleSlice(pump);
  } catch (err) {
    if (flightKey) autoLiquidCollectInFlight.delete(flightKey);
    console.error("[ciwi-auto-liquid] CollectUntranslatedText failed:", err);
  }
}
