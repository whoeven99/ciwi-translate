// main.js
import * as API from "./ciwi-api.js";
import {
  setWithTTL,
  getWithTTL,
  setStorageItem,
} from "./ciwi-storage.js";
import {
  CiwiswitcherForm,
  updateDisplayText,
  syncCompactSwitcherLayout,
  ProductImgTranslate,
  CurrencySelectorTakeEffect,
  LanguageSelectorTakeEffect,
  HomeImageTranslate,
  CustomLiquidTextTranslate,
  CollectUntranslatedText,
  tryApplyCachedCurrencyConversion,
} from "./ciwi-ui.js";
import {
  getManualLocalizationPreference,
  updateLocalization,
} from "./ciwi-utils.js";
import { getCiwiPageContext } from "./ciwi-page.js";

const resolveCiwiRuntimeVersionInfo = () => {
  const scriptUrl = import.meta?.url || "";
  const versionMatch = scriptUrl.match(/\/(ciwi-translator-\d+)\//);
  return {
    scriptUrl,
    version: versionMatch?.[1] || "unknown",
  };
};

const logCiwiRuntimeVersion = (() => {
  let logged = false;
  return () => {
    const { version, scriptUrl } = resolveCiwiRuntimeVersionInfo();
    const runtimeInfo = { version, scriptUrl };

    window.__CIWI_RUNTIME__ = runtimeInfo;
    document.documentElement.dataset.ciwiVersion = version;
    document.documentElement.dataset.ciwiScriptUrl = scriptUrl;

    if (logged) return;
    logged = true;
    console.log("[ciwi] runtime version", runtimeInfo);
  };
})();

// 原 isLikelyBotByUA 逻辑（简化版）
function isLikelyBotByUA() {
  const ua = navigator.userAgent.toLowerCase();
  const botKeywords = [
    "bot",
    "spider",
    "crawl",
    "slurp",
    "bingpreview",
    "facebookexternalhit",
    "monitor",
    "headless",
    "wget",
    "curl",
    "python-requests",
  ];
  const matched = botKeywords.filter((k) => ua.includes(k));
  if (matched.length) return `ua 包含: ${matched.join(", ")}`;
  const error = [];
  if (navigator.webdriver) error.push("webdriver");
  if (!(navigator.languages && navigator.languages.length > 0))
    error.push("without languages");
  if (window.outerWidth === 0 || window.outerHeight === 0)
    error.push("window undefined");
  if (!window.__JS_EXECUTED__) error.push("js not executed");
  return error.length >= 2 ? error.join(",") : undefined;
}

// RTL 语言列表
const rtlLanguages = [
  "العربية",
  "فارسی",
  "اُردُو",
  "עברית",
  "ܣܘܪܝܝܐ",
  "پښتو",
  "دری",
  "کوردی",
  "ئۇيغۇرچە",
];
const CIWI_MANUAL_LOCALIZATION_QUERY_KEY = "ciwi_manual_localization";

function normalizeLocaleCode(locale) {
  return String(locale || "")
    .trim()
    .replace(/_/g, "-")
    .toLowerCase();
}

function resolveAvailableLanguage(locale, availableLanguages) {
  const normalized = normalizeLocaleCode(locale);
  if (!normalized || !Array.isArray(availableLanguages) || !availableLanguages.length) {
    return "";
  }

  const exactMatch = availableLanguages.find(
    (item) => normalizeLocaleCode(item) === normalized,
  );
  if (exactMatch) return exactMatch;

  const base = normalized.split("-")[0];
  return (
    availableLanguages.find((item) => {
      const current = normalizeLocaleCode(item);
      return current === base || current.split("-")[0] === base;
    }) || ""
  );
}

function detectRuntimeLanguage(ciwiBlock, availableLanguages) {
  const languageInput = ciwiBlock.querySelector('input[name="language_code"]');
  const languageSelect = ciwiBlock.querySelector(".language_selector_header");
  const signals = [
    window.Shopify?.locale,
    document.documentElement.lang,
    languageSelect?.value,
    languageInput?.value,
  ];

  for (const signal of signals) {
    const resolved = resolveAvailableLanguage(signal, availableLanguages);
    if (resolved) return resolved;
  }

  return "";
}

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

function isShopifyThemeEditorAppsContext() {
  const matchesEditorAppsContext = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return false;

    try {
      const url = new URL(raw, window.location.origin);
      return (
        url.pathname.includes("/editor") &&
        url.searchParams.get("context") === "apps" &&
        url.searchParams.has("previewPath")
      );
    } catch {
      return (
        raw.includes("/editor") &&
        raw.includes("context=apps") &&
        raw.includes("previewPath=")
      );
    }
  };

  return (
    matchesEditorAppsContext(window.location.href) ||
    matchesEditorAppsContext(document.referrer)
  );
}

function isShopifyThemePreviewContext(ciwiBlock) {
  const currentUrl = new URL(window.location.href);
  const params = currentUrl.searchParams;
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

  if (isShopifyThemeEditorAppsContext()) {
    return true;
  }

  if (
    hasAdminThemeEditorReferrer &&
    (hasShopifyEditorPreviewMarkers(window.location.href) ||
      hasShopifyEditorPreviewMarkers(referrer))
  ) {
    return true;
  }

  // 主题预览链接通常会带 preview_theme_id；部分预览链路还会附带 _ab/_fd/pb。
  if (params.has("preview_theme_id") || params.has("preview_token")) {
    return true;
  }

  // Shopify Admin 主题编辑器里，店铺预览通常运行在 iframe 中，
  // 当前 storefront URL 可能不带 preview_theme_id，但 referrer 会是 editor 地址。
  if (hasAdminThemeEditorReferrer) {
    return true;
  }

  return (
    params.has("_ab") &&
    params.has("_fd") &&
    params.has("pb")
  );
}

function buildPreviewCurrencyLabel(ciwiBlock, currencyCode) {
  if (!ciwiBlock || !currencyCode) return currencyCode || "";

  const selectedCountryCode =
    ciwiBlock.querySelector('input[name="country_code"]')?.value || "";
  const selectedCountryLink = selectedCountryCode
    ? ciwiBlock.querySelector(`ul[role="list"] a[data-value="${selectedCountryCode}"]`)
    : null;
  const linkText = selectedCountryLink?.textContent?.replace(/\s+/g, " ").trim() || "";
  const currencyPart = linkText.includes("|")
    ? linkText.split("|")[1]?.trim() || ""
    : linkText;

  const symbol = currencyPart
    .replace(currencyCode, "")
    .replace(/\s+/g, " ")
    .trim();

  return symbol ? `${currencyCode} (${symbol})` : currencyCode;
}

function renderPreviewCurrencySelector({ ciwiBlock, configData, enabled }) {
  if (!enabled || !ciwiBlock) return;

  const currencyCode =
    ciwiBlock.querySelector('input[name="currency_code"]')?.value || "";
  const currencyLabel = buildPreviewCurrencyLabel(ciwiBlock, currencyCode);
  const currencySelector = ciwiBlock.querySelector(
    "#currency-switcher-container",
  );
  const currencySelectorHeader = ciwiBlock.querySelector(
    ".currency_selector_header",
  );
  const currencySelectorWrapper = currencySelectorHeader?.closest(
    ".native-selector",
  );

  if (!currencySelector || !currencySelectorHeader) return;

  if (currencySelectorWrapper) {
    currencySelectorWrapper.style.backgroundColor = configData.backgroundColor;
    currencySelectorWrapper.style.border = `1px solid ${configData.optionBorderColor}`;
  }
  currencySelectorHeader.style.backgroundColor = "transparent";
  currencySelectorHeader.style.border = "none";
  currencySelector.style.display = "block";
  currencySelectorHeader.innerHTML = "";

  const optionItem = document.createElement("option");
  optionItem.value = currencyCode;
  optionItem.textContent = currencyLabel;
  optionItem.selected = true;
  currencySelectorHeader.appendChild(optionItem);
}

function renderStaticThemePreviewSwitcher({
  ciwiBlock,
  configData,
  isLanguageSelectorTakeEffect,
  isCurrencySelectorTakeEffect,
}) {
  if (!ciwiBlock || !configData) return;

  const switcher = ciwiBlock.querySelector("#ciwi-container");
  const mainBox = ciwiBlock.querySelector("#main-box");
  const selectorBox = ciwiBlock.querySelector("#selector-box");
  const selectorBackdrop = ciwiBlock.querySelector("#selector-backdrop");
  const translateFloatBtn = ciwiBlock.querySelector("#translate-float-btn");
  const closeButtonWrapper = ciwiBlock.querySelector(".close_button_wrapper");
  const mainArrowIcon = ciwiBlock.querySelector("#mainbox-arrow-icon");

  if (switcher) {
    switcher.classList.remove("sidebar-widget-container", "expanded");
    switcher.classList.remove("mobile-sidebar-widget");
    switcher.style.visibility = "visible";
    switcher.style.opacity = "1";
    switcher.style.pointerEvents = "none";
  }

  if (selectorBackdrop) {
    selectorBackdrop.classList.remove("mobile-sidebar-backdrop");
    selectorBackdrop.style.display = "none";
  }

  if (selectorBox) {
    selectorBox.dataset.mode = "overlay";
    selectorBox.dataset.layout = "floating";
    selectorBox.classList.remove(
      "direct-select-mode",
      "is-open",
      "mobile-sidebar-mode",
    );
    selectorBox.style.display = "none";
  }

  if (translateFloatBtn) {
    translateFloatBtn.style.display = "none";
  }

  if (closeButtonWrapper) {
    closeButtonWrapper.style.display = "none";
  }

  if (mainBox) {
    mainBox.style.display = "flex";
    mainBox.style.backgroundColor = configData.backgroundColor;
    mainBox.style.border = `1px solid ${configData.optionBorderColor}`;
    mainBox.style.pointerEvents = "none";
    mainBox.style.cursor = "default";
  }

  if (mainArrowIcon) {
    mainArrowIcon.style.transform = "rotate(0deg)";
    mainArrowIcon.style.opacity = "0.45";
  }

  updateDisplayText(
    isLanguageSelectorTakeEffect,
    isCurrencySelectorTakeEffect,
    ciwiBlock,
  );
}

function disableCiwiInteractionsInThemePreview(ciwiBlock) {
  if (!ciwiBlock) return;

  const switcher = ciwiBlock.querySelector("#ciwi-container");
  const selectorBackdrop = ciwiBlock.querySelector("#selector-backdrop");
  const mainBox = ciwiBlock.querySelector("#main-box");
  const floatButtonText = ciwiBlock.querySelector("#translate-float-btn-text");
  const languageSelect = ciwiBlock.querySelector(".language_selector_header");
  const currencySelect = ciwiBlock.querySelector(".currency_selector_header");

  if (switcher) {
    switcher.dataset.ciwiPreviewDisabled = "1";
  }
  if (selectorBackdrop) {
    selectorBackdrop.style.display = "none";
  }
  if (mainBox) {
    mainBox.style.pointerEvents = "none";
    mainBox.style.cursor = "default";
  }
  if (floatButtonText) {
    floatButtonText.style.pointerEvents = "none";
    floatButtonText.style.cursor = "default";
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
}

function scheduleAfterPaint(fn) {
  const run = () => {
    try {
      fn();
    } catch (error) {
      console.warn("[ciwi] afterPaint", error);
    }
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => requestAnimationFrame(run));
    return;
  }
  setTimeout(run, 0);
}

function scheduleIdle(fn, timeout = 2000) {
  const run = () => {
    try {
      fn();
    } catch (error) {
      console.warn("[ciwi] idle", error);
    }
  };
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    window.requestIdleCallback(run, { timeout });
    return;
  }
  setTimeout(run, 0);
}

function unwrapSwitcherConfig(payload) {
  if (!payload?.success || !payload.response) return null;
  return payload.response;
}

function getSelectorFlags(configData) {
  const isCurrencySelectorTakeEffect =
    configData.currencySelector ||
    (!configData.languageSelector && !configData.currencySelector);
  const isLanguageSelectorTakeEffect =
    configData.languageSelector ||
    (!configData.languageSelector && !configData.currencySelector);
  return {
    isCurrencySelectorTakeEffect,
    isLanguageSelectorTakeEffect,
    activeSelectorCount:
      Number(Boolean(isLanguageSelectorTakeEffect)) +
      Number(Boolean(isCurrencySelectorTakeEffect)),
  };
}

function startAutoLocalization({
  configData,
  ciwiBlock,
  shop,
  isInThemePreview,
}) {
  if (isInThemePreview || !configData || ciwiBlock.__ciwiAutoLocalizationStarted) {
    return;
  }
  ciwiBlock.__ciwiAutoLocalizationStarted = true;

  const languageValue = ciwiBlock.querySelector(
    'input[name="language_code"]',
  )?.value;
  const countryValue = ciwiBlock.querySelector(
    'input[name="country_code"]',
  )?.value;
  const currentUrl = new URL(window.location.href);
  const hasManualLocalizationQuery =
    currentUrl.searchParams.get(CIWI_MANUAL_LOCALIZATION_QUERY_KEY) === "1";
  const availableLanguages = Array.from(
    ciwiBlock.querySelectorAll(".language_selector_header option"),
  ).map((opt) => opt.value);
  const availableCountries = Array.from(
    ciwiBlock.querySelectorAll('ul[role="list"] a[data-value]'),
  ).map((link) => link.getAttribute("data-value"));

  const manualLocalizationPreference = getManualLocalizationPreference(
    shop.value,
  );
  const preferredLanguage = availableLanguages.includes(
    manualLocalizationPreference?.language,
  )
    ? manualLocalizationPreference?.language
    : "";
  const preferredCountry = availableCountries.includes(
    manualLocalizationPreference?.country,
  )
    ? manualLocalizationPreference?.country
    : "";
  const hasUserLocalizationData = Boolean(
    hasManualLocalizationQuery || preferredLanguage || preferredCountry,
  );

  if (hasManualLocalizationQuery) {
    currentUrl.searchParams.delete(CIWI_MANUAL_LOCALIZATION_QUERY_KEY);
    window.history.replaceState(
      {},
      document.title,
      `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`,
    );
  }

  const browserLanguageSignals = [
    ...(Array.isArray(navigator.languages) ? navigator.languages : []),
    navigator.language,
    navigator.userLanguage,
  ].filter(Boolean);
  const resolvedBrowserLanguage =
    browserLanguageSignals
      .map((locale) => resolveAvailableLanguage(locale, availableLanguages))
      .find(Boolean) || "";
  const runtimeLanguage = detectRuntimeLanguage(ciwiBlock, availableLanguages);

  let detectedCountry = preferredCountry || countryValue;
  let detectedLanguage =
    preferredLanguage || runtimeLanguage || languageValue;
  const ipLocalizedSessionKey = `ciwi_ip_localized:${shop?.value || ""}`;
  let ipAlreadyLocalizedThisSession = false;
  try {
    ipAlreadyLocalizedThisSession =
      sessionStorage.getItem(ipLocalizedSessionKey) === "1";
  } catch {}

  const shouldAutoMatchMarketByIP =
    Boolean(configData?.ipOpen) &&
    !hasUserLocalizationData &&
    !ipAlreadyLocalizedThisSession;
  const shouldAutoSwitchBrowserLanguage =
    Boolean(configData?.browserLanguageOpen) && !hasUserLocalizationData;
  const shouldRunAutoLocalization =
    shouldAutoMatchMarketByIP || shouldAutoSwitchBrowserLanguage;

  if (shouldAutoSwitchBrowserLanguage && resolvedBrowserLanguage) {
    detectedLanguage = resolvedBrowserLanguage;
  }

  const applyIfNeeded = (country, language) => {
    const nextLanguage = availableLanguages.includes(language)
      ? language
      : languageValue;
    const nextCountry = availableCountries.includes(country)
      ? country
      : countryValue;
    const isInThemeEditor = document.documentElement.classList.contains(
      "shopify-design-mode",
    );
    if (isInThemeEditor || !shouldRunAutoLocalization) return;
    if (
      nextCountry &&
      nextLanguage &&
      (nextCountry !== countryValue || nextLanguage !== languageValue)
    ) {
      updateLocalization({
        country: nextCountry || countryValue,
        language: nextLanguage || languageValue,
      });
    }
  };

  if (shouldAutoMatchMarketByIP) {
    try {
      sessionStorage.setItem(ipLocalizedSessionKey, "1");
    } catch {}
    const iptokenValue = ciwiBlock.querySelector(
      'input[name="iptoken"]',
    )?.value;
    if (!iptokenValue) {
      applyIfNeeded(detectedCountry, detectedLanguage);
      return;
    }
    API.fetchUserCountryInfo(iptokenValue)
      .then((IpData) => {
        if (IpData?.countryCode) detectedCountry = IpData.countryCode;
        applyIfNeeded(detectedCountry, detectedLanguage);
      })
      .catch(() => applyIfNeeded(detectedCountry, detectedLanguage));
    return;
  }

  applyIfNeeded(detectedCountry, detectedLanguage);
}

function paintSwitcherChrome({
  ciwiBlock,
  configData,
  isInThemePreview,
  isLanguageSelectorTakeEffect,
  isCurrencySelectorTakeEffect,
  activeSelectorCount,
}) {
  const switcher = ciwiBlock.querySelector("#ciwi-container");
  const mainBox = ciwiBlock.querySelector("#main-box");
  const selectedLanguageText = ciwiBlock.querySelector(
    "#translate-float-btn-text",
  );
  const translateFloatBtn = ciwiBlock.querySelector("#translate-float-btn");
  const selectorBox = ciwiBlock.querySelector("#selector-box");
  const selectorBackdrop = ciwiBlock.querySelector("#selector-backdrop");
  const closeButtonWrapper = ciwiBlock.querySelector(".close_button_wrapper");
  const shouldUseSidebarWidget =
    !configData.languageSelector && !configData.currencySelector;
  const isDirectSelectorMode =
    activeSelectorCount === 1 && !shouldUseSidebarWidget;
  const isTransparentMode = Boolean(configData?.isTransparent);
  const shouldHideForTransparentMode = isTransparentMode && !isInThemePreview;

  if (!switcher) return;

  switcher.style.visibility = shouldHideForTransparentMode
    ? "hidden"
    : "visible";
  switcher.style.opacity = shouldHideForTransparentMode ? "0" : "1";
  switcher.style.pointerEvents = isTransparentMode ? "none" : "auto";
  if (selectorBackdrop) {
    selectorBackdrop.style.display = "none";
  }

  if (!shouldHideForTransparentMode) {
    const translateFloatBtnText = ciwiBlock.querySelector(
      "#translate-float-btn-text",
    );
    selectorBox.style.backgroundColor = configData.backgroundColor;
    switcher.style.color = configData.fontColor;
    translateFloatBtn.style.pointerEvents = "auto";

  switch (configData.selectorPosition) {
    case "top_left":
      switcher.style.top = configData.positionData + "%" || "10%";
      switcher.style.bottom = "auto";
      switcher.style.left = "0";
      switcher.style.right = "auto";
      translateFloatBtnText.style.borderRadius = "8px 8px 0 0";
      translateFloatBtn.style.justifyContent = "flex-end";
      translateFloatBtn.style.left = "0";
      translateFloatBtn.style.right = "auto";
      selectorBox.style.left = "0";
      selectorBox.style.right = "auto";
      selectorBox.style.top = "100%";
      selectorBox.style.bottom = "auto";
      break;
    case "bottom_left":
      switcher.style.bottom = configData.positionData + "%" || "10%";
      switcher.style.top = "auto";
      switcher.style.left = "0";
      switcher.style.right = "auto";
      translateFloatBtnText.style.borderRadius = "8px 8px 0 0";
      translateFloatBtn.style.justifyContent = "flex-end";
      translateFloatBtn.style.left = "0";
      translateFloatBtn.style.right = "auto";
      selectorBox.style.left = "0";
      selectorBox.style.right = "auto";
      selectorBox.style.bottom = "100%";
      selectorBox.style.top = "auto";
      break;
    case "top_right":
      switcher.style.top = configData.positionData + "%" || "10%";
      switcher.style.left = "auto";
      switcher.style.right = "0";
      switcher.style.bottom = "auto";
      translateFloatBtnText.style.borderRadius = "0 0 8px 8px";
      translateFloatBtn.style.justifyContent = "flex-start";
      translateFloatBtn.style.left = "auto";
      translateFloatBtn.style.right = "0";
      selectorBox.style.left = "auto";
      selectorBox.style.right = "0";
      selectorBox.style.top = "100%";
      selectorBox.style.bottom = "auto";
      break;
    case "bottom_right":
      switcher.style.bottom = configData.positionData + "%" || "10%";
      switcher.style.left = "auto";
      switcher.style.right = "0";
      switcher.style.top = "auto";
      translateFloatBtnText.style.borderRadius = "0 0 8px 8px";
      translateFloatBtn.style.justifyContent = "flex-start";
      translateFloatBtn.style.left = "auto";
      translateFloatBtn.style.right = "0";
      selectorBox.style.left = "auto";
      selectorBox.style.right = "0";
      selectorBox.style.bottom = "100%";
      selectorBox.style.top = "auto";
      break;
  }
  selectorBox.style.border = `1px solid ${configData.optionBorderColor}`;
  selectorBox.dataset.mode = isDirectSelectorMode ? "direct" : "overlay";
  selectorBox.dataset.layout = shouldUseSidebarWidget
    ? "sidebar-widget"
    : "floating";
  selectorBox.dataset.preferredPlacement =
    configData.selectorPosition?.startsWith("bottom") ? "up" : "down";
  selectorBox.classList.toggle("direct-select-mode", isDirectSelectorMode);
  switcher.classList.toggle("sidebar-widget-container", shouldUseSidebarWidget);
  selectorBox.classList.remove("mobile-sidebar-mode");
  switcher.classList.remove("mobile-sidebar-widget");
  if (selectorBackdrop) {
    selectorBackdrop.classList.remove("mobile-sidebar-backdrop");
    selectorBackdrop.style.display = "none";
  }
  if (closeButtonWrapper) {
    closeButtonWrapper.style.display = isDirectSelectorMode ? "none" : "flex";
  }

  if (isInThemePreview) {
    renderStaticThemePreviewSwitcher({
      ciwiBlock,
      configData,
      isLanguageSelectorTakeEffect,
      isCurrencySelectorTakeEffect,
    });
  } else if (isDirectSelectorMode) {
    selectorBox.style.removeProperty("width");
    selectorBox.style.border = "none";
    selectorBox.style.backgroundColor = "transparent";
    selectorBox.style.display = "flex";
    mainBox.style.display = "none";
    translateFloatBtn.style.display = "none";
  } else if (shouldUseSidebarWidget) {
    selectorBox.style.removeProperty("width");
    selectorBox.style.backgroundColor = configData.backgroundColor;
    selectorBox.style.display = "none";
    mainBox.style.display = "none";
    translateFloatBtnText.style.backgroundColor = configData.backgroundColor;
    translateFloatBtn.style.display = "flex";
  } else if (activeSelectorCount > 0) {
    selectorBox.style.backgroundColor = configData.backgroundColor;
    mainBox.style.backgroundColor = configData.backgroundColor;
    mainBox.style.border = `1px solid ${configData.optionBorderColor}`;
    updateDisplayText(
      configData.languageSelector,
      configData.currencySelector,
      ciwiBlock,
    );
    mainBox.style.display = "flex";
  } else {
    selectorBox.style.removeProperty("width");
    selectorBox.style.display = "none";
    mainBox.style.display = "none";
    translateFloatBtn.style.display = "none";
  }
  }

  const selectedTextElement = ciwiBlock.querySelector(
    ".language_selector_header",
  );
  const currentLanguage =
    selectedTextElement?.selectedOptions?.[0]?.textContent?.trim();
  if (rtlLanguages.includes(currentLanguage) && selectedLanguageText) {
    selectorBox.style.right = "0";
  }

  syncCompactSwitcherLayout(ciwiBlock);
}

function mountSwitcherFromConfig({
  blockId,
  shop,
  ciwiBlock,
  configData,
  isInThemePreview,
}) {
  if (!configData || ciwiBlock.__ciwiSwitcherPainted) return;
  ciwiBlock.__ciwiSwitcherPainted = true;

  ciwiBlock.__ciwiConfigData = configData;
  document.querySelectorAll("ciwiswitcher-form").forEach((formElement) => {
    formElement.data = configData;
  });

  const flags = getSelectorFlags(configData);
  LanguageSelectorTakeEffect(
    flags.isLanguageSelectorTakeEffect,
    configData,
    ciwiBlock,
  );

  if (isInThemePreview) {
    renderPreviewCurrencySelector({
      ciwiBlock,
      configData,
      enabled: flags.isCurrencySelectorTakeEffect,
    });
  } else {
    CurrencySelectorTakeEffect(
      blockId,
      flags.isCurrencySelectorTakeEffect,
      shop.value,
      configData,
      ciwiBlock,
    );
  }

  paintSwitcherChrome({
    ciwiBlock,
    configData,
    isInThemePreview,
    ...flags,
  });

  if (isInThemePreview) {
    disableCiwiInteractionsInThemePreview(ciwiBlock);
  }
}

function ciwiOnload() {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem("ciwi_selected_language");
  }
  const blockId = document.querySelector('input[name="block_id"]')?.value;
  if (!blockId) return console.warn("blockId not found");
  const ciwiBlock = document.querySelector(`#shopify-block-${blockId}`);
  if (!ciwiBlock) return console.warn("ciwiBlock not found");
  const isInThemePreview = isShopifyThemePreviewContext(ciwiBlock);
  const shop = ciwiBlock.querySelector("#queryCiwiId");
  const reason = isLikelyBotByUA();
  if (reason) {
    console.warn("⚠️ 疑似爬虫访问", reason);
    return;
  }

  const pageContext = getCiwiPageContext(ciwiBlock);
  const configKey = "ciwi_switcher_config";
  const configTtlOptions = {
    scope: shop.value,
    legacyKeys: [configKey],
  };
  const cachedPayload = getWithTTL(configKey, configTtlOptions);
  let configData = unwrapSwitcherConfig(cachedPayload);

  let customLiquidReplacePromise = Promise.resolve();
  if (!isInThemePreview) {
    customLiquidReplacePromise = Promise.resolve(
      CustomLiquidTextTranslate(blockId, shop, ciwiBlock),
    ).catch(() => {});
  }

  if (!isInThemePreview && configData) {
    tryApplyCachedCurrencyConversion({
      shop: shop.value,
      ciwiBlock,
      marketCurrencyOpen: configData.marketCurrencyOpen !== false,
    });
  }

  const runStorefrontTranslationTasks = () => {
    if (isInThemePreview) return;
    const tasks = [];
    if (pageContext.isProductPage) {
      tasks.push(ProductImgTranslate(blockId, shop, ciwiBlock));
    }
    if (pageContext.isHomePage) {
      tasks.push(HomeImageTranslate(blockId));
    }
    if (tasks.length > 0) {
      Promise.allSettled(tasks).catch(() => {});
    }
  };

  const scheduleStorefrontTranslationTasks = () => {
    scheduleIdle(runStorefrontTranslationTasks, 2000);
  };

  const scheduleAutoLiquidCollect = () => {
    if (isInThemePreview) return;
    const currentLanguage = ciwiBlock.querySelector(
      'input[name="language_code"]',
    )?.value;
    const primaryLanguage = configData?.primaryLanguage;
    try {
      const dbg = localStorage.getItem("ciwi_debug_auto_liquid");
      if (dbg !== "0" && dbg !== "false") {
        console.log("[ciwi-auto-liquid] primary_language", {
          primaryLanguage: primaryLanguage || null,
          currentLanguage: currentLanguage || null,
          source: "switcher config → Shopify shop primary locale",
        });
      }
    } catch {
      console.log("[ciwi-auto-liquid] primary_language", {
        primaryLanguage: primaryLanguage || null,
        currentLanguage: currentLanguage || null,
      });
    }
    if (
      primaryLanguage &&
      currentLanguage &&
      normalizeLocaleCode(currentLanguage) ===
        normalizeLocaleCode(primaryLanguage)
    ) {
      return;
    }
    const run = () =>
      CollectUntranslatedText(shop, ciwiBlock, { primaryLanguage });
    const schedule = () => {
      if ("requestIdleCallback" in window) {
        window.requestIdleCallback(run, { timeout: 9000 });
      } else {
        setTimeout(run, 2000);
      }
    };
    Promise.resolve(customLiquidReplacePromise)
      .finally(() => {
        const countdownGate =
          typeof window !== "undefined" &&
          window.__ciwi_countdown_first_rescan_promise__
            ? window.__ciwi_countdown_first_rescan_promise__
            : Promise.resolve();
        return Promise.resolve(countdownGate).catch(() => {});
      })
      .finally(schedule);
  };

  const refreshConfigInBackground = () => {
    API.fetchSwitcherConfig({ shop: shop.value })
      .then((fresh) => {
        if (fresh) {
          setWithTTL(configKey, fresh, 1000 * 60 * 60, configTtlOptions);
        }
      })
      .catch(() => {});
  };

  const refreshCurrenciesInBackground = () => {
    if (!configData) return;
    const { isCurrencySelectorTakeEffect } = getSelectorFlags(configData);
    if (!isCurrencySelectorTakeEffect) return;
    API.fetchCurrencies({ blockId, shop: shop.value })
      .then((fresh) => {
        if (fresh) {
          setStorageItem("ciwi_currency_data", JSON.stringify(fresh), {
            scope: shop.value,
          });
        }
      })
      .catch(() => {});
  };

  const setupRuntimeLanguageSync = () => {
    if (isInThemePreview || ciwiBlock.__ciwiLanguageSyncStarted) return;
    ciwiBlock.__ciwiLanguageSyncStarted = true;
    const availableLanguages = Array.from(
      ciwiBlock.querySelectorAll(".language_selector_header option"),
    ).map((opt) => opt.value);
    let lastRuntimeLanguage = detectRuntimeLanguage(
      ciwiBlock,
      availableLanguages,
    );

    const syncRuntimeLanguage = () => {
      const nextLanguage = detectRuntimeLanguage(
        ciwiBlock,
        availableLanguages,
      );
      if (!nextLanguage) return;
      if (
        normalizeLocaleCode(nextLanguage) ===
        normalizeLocaleCode(lastRuntimeLanguage)
      ) {
        return;
      }

      lastRuntimeLanguage = nextLanguage;

      const languageInput = ciwiBlock.querySelector(
        'input[name="language_code"]',
      );
      const languageSelect = ciwiBlock.querySelector(
        ".language_selector_header",
      );
      if (languageInput) {
        languageInput.value = nextLanguage;
        languageInput.setAttribute("value", nextLanguage);
      }
      if (languageSelect && languageSelect.value !== nextLanguage) {
        languageSelect.value = nextLanguage;
      }

      updateDisplayText(
        configData.languageSelector,
        configData.currencySelector,
        ciwiBlock,
      );
      scheduleStorefrontTranslationTasks();
      customLiquidReplacePromise = Promise.resolve(
        CustomLiquidTextTranslate(blockId, shop, ciwiBlock),
      ).catch(() => {});
      scheduleAutoLiquidCollect();
    };

    const languageAttrObserver = new MutationObserver(syncRuntimeLanguage);
    languageAttrObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["lang"],
    });

    window.addEventListener("pageshow", syncRuntimeLanguage);
    window.addEventListener("popstate", syncRuntimeLanguage);
  };

  const mountWhenReady = ({ afterPaint }) => {
    const mount = () => {
      if (!configData) return;
      mountSwitcherFromConfig({
        blockId,
        shop,
        ciwiBlock,
        configData,
        isInThemePreview,
      });
      if (isInThemePreview) return;
      scheduleAutoLiquidCollect();
      setupRuntimeLanguageSync();
      scheduleIdle(refreshCurrenciesInBackground, 2000);
    };
    if (isInThemePreview || !afterPaint) {
      mount();
      return;
    }
    scheduleAfterPaint(mount);
  };

  startAutoLocalization({
    configData,
    ciwiBlock,
    shop,
    isInThemePreview,
  });

  if (configData) {
    mountWhenReady({ afterPaint: true });
  }

  if (!isInThemePreview) {
    scheduleStorefrontTranslationTasks();
  }

  if (configData) {
    if (!isInThemePreview) refreshConfigInBackground();
    return;
  }

  API.fetchSwitcherConfig({ shop: shop.value })
    .then((fresh) => {
      if (fresh) {
        setWithTTL(configKey, fresh, 1000 * 60 * 60, configTtlOptions);
      }
      configData = unwrapSwitcherConfig(fresh) || configData;
      if (!configData) return;
      startAutoLocalization({
        configData,
        ciwiBlock,
        shop,
        isInThemePreview,
      });
      mountWhenReady({ afterPaint: false });
    })
    .catch(() => {});
}

logCiwiRuntimeVersion();

if (!customElements.get("ciwiswitcher-form")) {
  customElements.define("ciwiswitcher-form", CiwiswitcherForm);
}

// 尽早初始化：DOM 就绪即可运行，无需等待整页所有图片/字体等资源（原 window load）。
// 三个数据脚本在 liquid 中改用 defer，保证在 DOMContentLoaded 前按序加载完，
// 因此此处运行时 window.countryCurMap 等已就绪。
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", ciwiOnload);
} else {
  ciwiOnload();
}
