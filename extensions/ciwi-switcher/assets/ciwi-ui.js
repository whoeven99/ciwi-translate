// ui.js — switcher chrome / currency / language (heavy liquid/picture/collect are separate modules)
import { fetchCurrencies, fetchAutoRate } from "./ciwi-api.js";
import {
  getStorageItem,
  setStorageItem,
  removeStorageItem,
} from "./ciwi-storage.js";
import {
  buildLocalizationReturnTo,
  CIWI_MONEY_SELECTOR,
  ensureCurrencyFormatConfig,
  persistManualLocalizationPreference,
  shouldTrackMoneyNode,
  transformPrices,
} from "./ciwi-utils.js";

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
  const localStorageCurrencyDataJSON = getCurrencyDataCache(shop);

  if (localStorageCurrencyDataJSON) {
    try {
      currencyData = JSON.parse(localStorageCurrencyDataJSON);
    } catch {
      currencyData = [];
    }
  }

  if (!Array.isArray(currencyData) || !currencyData.length) {
    currencyData = await fetchCurrencies({ blockId, shop });
    setCurrencyDataCache(shop, currencyData);
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
  const storageScope = getSwitcherStorageScope(ciwiBlock);
  const currencyInput = ciwiBlock?.querySelector('input[name="currency_code"]');
  if (currencySelect && nextCode && currencySelect.value !== nextCode) {
    currencySelect.value = nextCode;
  }
  if (currencyInput && currencyInput.value !== nextCode) {
    currencyInput.value = nextCode;
    currencyInput.setAttribute("value", nextCode);
  }
  if (persist && nextCode) {
    setSelectedCurrencyCache(storageScope, nextCode);
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
  await ensureCurrencyFormatConfig();
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
  const persistedCurrencyCode = getSelectedCurrencyCache(shop) || "";

  // 检测 Shopify 市场货币是否变化：商户/用户通过主题原生选择器切换市场时，
  // pageCurrencyCode（{{ localization.country.currency.iso_code }}）会变。
  // 此时放弃旧的手动选择、跟随新市场；否则一直沿用旧手动值导致「切市场货币不跟随」。
  const lastMarketCurrencyCode = getMarketCurrencyCache(shop) || "";
  const marketChanged =
    Boolean(pageCurrencyCode) &&
    Boolean(lastMarketCurrencyCode) &&
    lastMarketCurrencyCode !== pageCurrencyCode;
  if (pageCurrencyCode) {
    setMarketCurrencyCache(shop, pageCurrencyCode);
  }
  if (marketChanged) {
    clearSelectedCurrencyCache(shop);
    clearSelectedCurrencyRateCache(shop);
  }

  // 手动选择优先：只要存在未随市场切换而失效的手动选择，就尊重手动值；
  // 否则跟随当前市场货币。marketCurrencyOpen 不再强制覆盖用户手动选择，
  // 避免「手动切 USD 一秒后被改回市场货币」。
  const effectivePersistedCurrencyCode = marketChanged ? "" : persistedCurrencyCode;
  const selectedCurrencyCode = effectivePersistedCurrencyCode || pageCurrencyCode;
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
    persistedCurrencyCode !== pageCurrencyCode
  ) {
    setSelectedCurrencyCache(shop, pageCurrencyCode);
    clearSelectedCurrencyRateCache(shop);
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
      getSelectedCurrencyRateCache(shop);
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
        clearSelectedCurrencyRateCache(shop);
        transformPrices({ rate: 1, moneyFormat, selectedCurrency: null });
        return;
      }
      setSelectedCurrencyRateCache(shop, {
        currencyCode: selectedCurrency.currencyCode,
        fromCurrencyCode: baseCurrencyCode,
        exchangeRate: rate,
      });
    }
  } else {
    rate = Number(selectedCurrency.exchangeRate);
    if (!Number.isFinite(rate)) {
      syncCurrencySelectionState({
        ciwiBlock,
        currencySelect,
        selectedCurrencyCode: baseCurrencyCode,
      });
      clearSelectedCurrencyRateCache(shop);
      transformPrices({ rate: 1, moneyFormat, selectedCurrency: null });
      return;
    }
  }
  // 转换现有价格并开始观察整个文档 body
  // （initPriceObserver 内部会先执行一次全量转换，避免这里重复扫描整个文档）
  initPriceObserver({ rate, moneyFormat, selectedCurrency });
}

/**
 * 仅在本地已有货币列表 + 汇率缓存时立刻换价，不挡主线程等待网络。
 * 无缓存返回 false，交给后续 CurrencySelectorTakeEffect 再拉。
 */
export function tryApplyCachedCurrencyConversion({
  shop,
  ciwiBlock,
  marketCurrencyOpen = true,
}) {
  if (!shop || !ciwiBlock) return false;
  const raw = getCurrencyDataCache(shop);
  if (!raw) return false;
  let currencyData;
  try {
    currencyData = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!Array.isArray(currencyData) || !currencyData.length) return false;
  if (!getSelectedCurrencyRateCache(shop)) return false;
  initializeCurrency({
    currencyData,
    shop,
    ciwiBlock,
    marketCurrencyOpen,
  }).catch(() => {});
  return true;
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

  const localStorageCurrencyDataJSON = getCurrencyDataCache(shop);
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
    setCurrencyDataCache(shop, currencyData);
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

function normalizeCountryCode(countryCode) {
  return String(countryCode || "")
    .trim()
    .toUpperCase();
}

function buildFlagEmoji(countryCode) {
  const normalizedCountryCode = normalizeCountryCode(countryCode);
  if (!/^[A-Z]{2}$/.test(normalizedCountryCode)) {
    return "🏳";
  }

  return Array.from(normalizedCountryCode)
    .map((char) => String.fromCodePoint(127397 + char.charCodeAt(0)))
    .join("");
}

function buildInlineFlagDataUrl(countryCode) {
  const emoji = buildFlagEmoji(countryCode);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="40" viewBox="0 0 60 40"><rect width="60" height="40" rx="4" fill="white"/><text x="30" y="26" text-anchor="middle" font-size="22">${emoji}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function buildCountryFlagUrl(countryCode) {
  const normalizedCountryCode = normalizeCountryCode(countryCode);
  if (!normalizedCountryCode) return "";

  return `https://img.bogdatech.com/app/${normalizedCountryCode}.webp`;
}

function getCurrentMarketCountryCode(ciwiBlock) {
  return normalizeCountryCode(
    ciwiBlock?.querySelector('input[name="country_code"]')?.value,
  );
}

function setFlagImageSource(flagImage, countryCode, onLoad) {
  if (!(flagImage instanceof HTMLImageElement)) return;

  const normalizedCountryCode = normalizeCountryCode(countryCode);
  if (!normalizedCountryCode) {
    flagImage.hidden = true;
    return;
  }

  const fallbackUrl = buildInlineFlagDataUrl(normalizedCountryCode);
  const remoteUrl = buildCountryFlagUrl(normalizedCountryCode);

  flagImage.alt = `${normalizedCountryCode} flag`;
  flagImage.dataset.flagCountry = normalizedCountryCode;
  flagImage.dataset.flagFallbackApplied = "0";
  flagImage.onerror = () => {
    if (flagImage.dataset.flagFallbackApplied === "1") return;
    flagImage.dataset.flagFallbackApplied = "1";
    flagImage.src = fallbackUrl;
  };
  if (typeof onLoad === "function") {
    flagImage.addEventListener("load", onLoad, { once: true });
  }
  flagImage.src = remoteUrl || fallbackUrl;
  flagImage.hidden = false;
}

export function updateLanguageSelectorFlag(ciwiBlock, countryCode) {
  const selectorFlag = ciwiBlock.querySelector("#language-selector-flag");
  const languageSelect = ciwiBlock.querySelector(".language_selector_header");
  if (!selectorFlag || !languageSelect) return;

  if (selectorFlag.dataset.enabled !== "true") {
    selectorFlag.hidden = true;
    languageSelect.style.paddingLeft = "12px";
    return;
  }

  if (countryCode) {
    setFlagImageSource(
      selectorFlag,
      countryCode,
      () => syncCompactSwitcherLayout(ciwiBlock),
    );
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
  const marketCountryCode = data?.includedFlag
    ? getCurrentMarketCountryCode(ciwiBlock)
    : "";

  updateLanguageSelectorFlag(ciwiBlock, marketCountryCode);

  if (mainLanguageFlag) {
    if (marketCountryCode && (data.languageSelector || data.currencySelector)) {
      setFlagImageSource(
        mainLanguageFlag,
        marketCountryCode,
        () => syncCompactSwitcherLayout(ciwiBlock),
      );
    } else {
      mainLanguageFlag.hidden = true;
    }
  }
  if (translateFloatBtnIcon) {
    if (marketCountryCode && !data.languageSelector && !data.currencySelector) {
      setFlagImageSource(translateFloatBtnIcon, marketCountryCode);
    } else {
      translateFloatBtnIcon.hidden = true;
    }
  }
  const mainBoxText = ciwiBlock.querySelector(".main_box_text");
  const mainBox = ciwiBlock.querySelector("#main-box");
  if (mainBox) {
    mainBox.classList.toggle(
      "has-flag",
      Boolean(
        mainBoxText &&
          mainLanguageFlag &&
          !mainLanguageFlag.hidden &&
          marketCountryCode,
      ),
    );
  }

  syncCompactSwitcherLayout(ciwiBlock);
}

// 保存所有我们替换过的 img 以及“替换后的最终值”

export class CiwiswitcherForm extends HTMLElement {
  constructor() {
    super();
    this.elements = {}; // 空对象，等 connectedCallback 再赋值
    this.data = null;
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
    this.data = ciwiBlock.__ciwiConfigData || this.data;
    // 初始化所有事件监听
    this.initializeEventListeners();

    const storageScope = getSwitcherStorageScope(ciwiBlock);
    const shouldRestoreOpen =
      !this.isDirectSelectorMode() &&
      !this.isSidebarWidgetMode() &&
      getSwitcherPanelOpenCache(storageScope) === "1";

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
    setSwitcherPanelOpenCache(getSwitcherStorageScope(this.elements.ciwiBlock), "1");
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
    setSwitcherPanelOpenCache(getSwitcherStorageScope(this.elements.ciwiBlock), "0");

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
      setSelectedCurrencyCache(
        getSwitcherStorageScope(this.elements.ciwiBlock),
        value,
      );
      // 手动选货币也算「用户已本地化」，否则 ipOpen 会在下次加载按 IP 改市场，
      // 把货币回落成市场默认值（如 EUR），覆盖用户手动选的 CNY。
      persistManualLocalizationPreference({
        country: this.elements.countryInput?.value,
        language: this.elements.languageInput?.value,
        shop: this.elements.ciwiBlock.querySelector("#queryCiwiId")?.value,
      });
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
      let returnToInput = form.querySelector('input[name="return_to"]');
      if (!returnToInput) {
        returnToInput = document.createElement("input");
        returnToInput.type = "hidden";
        returnToInput.name = "return_to";
        form.appendChild(returnToInput);
      }
      returnToInput.value = buildLocalizationReturnTo({
        currentLanguage: this.elements.languageInput?.defaultValue,
        language: this.elements.languageInput?.value,
        markManual: true,
      });
      persistManualLocalizationPreference({
        country: this.elements.countryInput?.value,
        language: this.elements.languageInput?.value,
        shop: this.elements.ciwiBlock.querySelector("#queryCiwiId")?.value,
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

function getSwitcherStorageScope(shopOrCiwiBlock) {
  if (typeof shopOrCiwiBlock === "string") return shopOrCiwiBlock;
  return (
    shopOrCiwiBlock?.querySelector?.("#queryCiwiId")?.value ||
    shopOrCiwiBlock?.querySelector?.('input[name="shopName"]')?.value ||
    ""
  );
}

function getCurrencyDataCache(shop) {
  return getStorageItem("ciwi_currency_data", {
    scope: shop,
    legacyKeys: ["ciwi_currency_data"],
  });
}

function setCurrencyDataCache(shop, currencyData) {
  setStorageItem("ciwi_currency_data", JSON.stringify(currencyData), {
    scope: shop,
  });
}

function getSelectedCurrencyCache(shop) {
  return getStorageItem("ciwi_selected_currency", {
    scope: shop,
    legacyKeys: ["ciwi_selected_currency"],
  });
}

function setSelectedCurrencyCache(shop, currencyCode) {
  setStorageItem("ciwi_selected_currency", currencyCode, {
    scope: shop,
  });
}

function clearSelectedCurrencyCache(shop) {
  removeStorageItem("ciwi_selected_currency", {
    scope: shop,
    legacyKeys: ["ciwi_selected_currency"],
  });
}

function getMarketCurrencyCache(shop) {
  return getStorageItem("ciwi_market_currency", {
    scope: shop,
    legacyKeys: ["ciwi_market_currency"],
  });
}

function setMarketCurrencyCache(shop, currencyCode) {
  setStorageItem("ciwi_market_currency", currencyCode, {
    scope: shop,
  });
}

function getSelectedCurrencyRateCache(shop) {
  return getStorageItem("ciwi_selected_currency_rate", {
    scope: shop,
    legacyKeys: ["ciwi_selected_currency_rate"],
  });
}

function setSelectedCurrencyRateCache(shop, payload) {
  setStorageItem("ciwi_selected_currency_rate", JSON.stringify(payload), {
    scope: shop,
  });
}

function clearSelectedCurrencyRateCache(shop) {
  removeStorageItem("ciwi_selected_currency_rate", {
    scope: shop,
    legacyKeys: ["ciwi_selected_currency_rate"],
  });
}

function getSwitcherPanelOpenCache(shop) {
  return getStorageItem("ciwi_switcher_panel_open", {
    scope: shop,
    legacyKeys: ["ciwi_switcher_panel_open"],
  });
}

function setSwitcherPanelOpenCache(shop, value) {
  setStorageItem("ciwi_switcher_panel_open", value, {
    scope: shop,
  });
}
