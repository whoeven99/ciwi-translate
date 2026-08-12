// main.js
import * as API from "./ciwi-api.js";
import { useCacheThenRefresh, setWithTTL, getWithTTL } from "./ciwi-storage.js";
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
  renderLanguageFlags,
  ensureLanguageLocaleData,
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

async function ciwiOnload() {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem("ciwi_selected_language");
  }
  const blockId = document.querySelector('input[name="block_id"]')?.value;
  if (!blockId) return console.warn("blockId not found");
  const ciwiBlock = document.querySelector(`#shopify-block-${blockId}`);
  if (!ciwiBlock) return console.warn("ciwiBlock not found");
  const isInThemePreview = isShopifyThemePreviewContext(ciwiBlock);
  const shop = ciwiBlock.querySelector("#queryCiwiId");
  // 爬虫检测（仅拦截，不上报日志）
  const reason = isLikelyBotByUA();
  if (reason) {
    console.warn("⚠️ 疑似爬虫访问", reason);
    return;
  }

  // 按页面类型门控翻译请求，避免 cart/collection 等页面发起无关 API 调用
  const pageContext = getCiwiPageContext(ciwiBlock);

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

  // 主题 custom liquid 文本：全站需要。
  // 捕获替换 Promise，保证「先替换已有 DONE Liquid，替换完再采集」，
  // 避免把已译但尚未替换上屏的源文案又当残留采一遍。
  let customLiquidReplacePromise = Promise.resolve();
  if (!isInThemePreview) {
    customLiquidReplacePromise = Promise.resolve(
      CustomLiquidTextTranslate(blockId, shop, ciwiBlock),
    ).catch(() => {});
  }
  runStorefrontTranslationTasks();

  // 加载配置（缓存 + 后台刷新，保留“最多两次”语义）
  const configKey = `ciwi_switcher_config`;
  // 记录本次是否命中缓存：仅命中缓存时才在末尾后台刷新，
  // 避免首次访问（无缓存）背靠背发两次相同的 config 请求
  const hadConfigCache = !!getWithTTL(configKey);
  const fetchSwitcherConfig = await useCacheThenRefresh(
    configKey,
    async () => API.fetchSwitcherConfig({ shop: shop.value }),
    1000 * 60 * 60,
  );

  const configData = fetchSwitcherConfig?.success
    ? fetchSwitcherConfig?.response
    : null;

  // 自动抓取第三方未翻译文本（默认开；非预览）。浏览器空闲时执行，避免抢关键路径。
  const scheduleAutoLiquidCollect = () => {
    if (isInThemePreview) return;
    const currentLanguage = ciwiBlock.querySelector(
      'input[name="language_code"]',
    )?.value;
    const primaryLanguage = configData?.primaryLanguage;
    if (
      primaryLanguage &&
      currentLanguage &&
      normalizeLocaleCode(currentLanguage) === normalizeLocaleCode(primaryLanguage)
    ) {
      return;
    }
    const run = () =>
      CollectUntranslatedText(shop, ciwiBlock, { primaryLanguage });
    const schedule = () => {
      if ("requestIdleCallback" in window) {
        window.requestIdleCallback(run, { timeout: 4000 });
      } else {
        setTimeout(run, 2000);
      }
    };
    // 先等已有 Liquid 替换完成，再 idle 采集（替换失败也继续采集）。
    Promise.resolve(customLiquidReplacePromise).finally(schedule);
  };

  //获取当前语言和地区
  const languageValue = ciwiBlock.querySelector(
    'input[name="language_code"]',
  )?.value;
  const countryValue = ciwiBlock.querySelector(
    'input[name="country_code"]',
  )?.value;
  const currentUrl = new URL(window.location.href);
  const hasManualLocalizationQuery =
    currentUrl.searchParams.get(CIWI_MANUAL_LOCALIZATION_QUERY_KEY) === "1";
  //所有可用语言
  const availableLanguages = Array.from(
    ciwiBlock.querySelectorAll(".language_selector_header option"),
  ).map((opt) => opt.value);

  //所有可用地区
  const availableCountries = Array.from(
    ciwiBlock.querySelectorAll('ul[role="list"] a[data-value]'),
  ).map((link) => link.getAttribute("data-value"));

  const manualLocalizationPreference = getManualLocalizationPreference();
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

  if (hasManualLocalizationQuery && !isInThemePreview) {
    currentUrl.searchParams.delete(CIWI_MANUAL_LOCALIZATION_QUERY_KEY);
    window.history.replaceState(
      {},
      document.title,
      `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`,
    );
  }

  //浏览器语言
  let browserLanguage = navigator.language || navigator.userLanguage;

  // 如果语言包含 'q=xx' 或类似的内容，提取前面的部分
  browserLanguage = browserLanguage.split(";")[0];

  if (!browserLanguage.includes("zh")) {
    browserLanguage = browserLanguage.split("-")[0]; // 只保留语言部分
  }

  let detectedCountry = preferredCountry || countryValue;
  let detectedLanguage = preferredLanguage || browserLanguage;
  const shouldRunAutoLocalization =
    !isInThemePreview &&
    configData?.ipOpen &&
    !hasUserLocalizationData;

  // IP 定位：每次进入都重新请求，不使用 localStorage 缓存
  if (shouldRunAutoLocalization) {
    const iptokenValue = ciwiBlock.querySelector(
      'input[name="iptoken"]',
    )?.value;

    if (!iptokenValue) return;

    const IpData = await API.fetchUserCountryInfo(iptokenValue);
    if (IpData?.countryCode) {
      detectedCountry = IpData.countryCode;
    }
  }

  //判断语言是否可用
  detectedLanguage = availableLanguages.includes(detectedLanguage)
    ? detectedLanguage
    : languageValue;

  //判断地区是否可用
  detectedCountry = availableCountries.includes(detectedCountry)
    ? detectedCountry
    : countryValue;

  //判断是否在主题编辑器内
  const isInThemeEditor = document.documentElement.classList.contains(
    "shopify-design-mode",
  );

  //不在主题编辑器内
  if (!isInThemeEditor && shouldRunAutoLocalization) {
    //需要定位逻辑
    if (
      detectedCountry &&
      detectedLanguage &&
      (detectedCountry !== countryValue || detectedLanguage !== languageValue)
    ) {
      updateLocalization({
        country: detectedCountry || countryValue,
        language: detectedLanguage || languageValue,
      });
    }
  }

  // 初始化语言/货币选择器
  const isCurrencySelectorTakeEffect =
    configData.currencySelector ||
    (!configData.languageSelector && !configData.currencySelector);

  const isLanguageSelectorTakeEffect =
    configData.languageSelector ||
    (!configData.languageSelector && !configData.currencySelector);

  const activeSelectorCount =
    Number(Boolean(isLanguageSelectorTakeEffect)) +
    Number(Boolean(isCurrencySelectorTakeEffect));

  LanguageSelectorTakeEffect(
    isLanguageSelectorTakeEffect,
    configData,
    ciwiBlock,
  );

  // 国旗数据（24KB）按需加载：浏览器空闲时加载并渲染国旗；
  // 若用户在此之前先接触切换器，则立即加载（先于 idle）。两条路径都只渲染一次。
  if (isLanguageSelectorTakeEffect && configData?.includedFlag && !isInThemePreview) {
    const loadFlags = () =>
      ensureLanguageLocaleData().then(() =>
        renderLanguageFlags(configData, ciwiBlock),
      );
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(loadFlags, { timeout: 3000 });
    } else {
      setTimeout(loadFlags, 1200);
    }
    const mainBox = ciwiBlock.querySelector("#main-box");
    const languageSelect = ciwiBlock.querySelector(".language_selector_header");
    mainBox?.addEventListener("mouseenter", loadFlags, { once: true });
    languageSelect?.addEventListener("mouseenter", loadFlags, { once: true });
    languageSelect?.addEventListener("focus", loadFlags, { once: true });
  }

  if (isInThemePreview) {
    renderPreviewCurrencySelector({
      ciwiBlock,
      configData,
      enabled: isCurrencySelectorTakeEffect,
    });
  } else {
    CurrencySelectorTakeEffect(
      blockId,
      isCurrencySelectorTakeEffect,
      shop.value,
      configData,
      ciwiBlock,
    );
  }

  // UI 样式控制（top/bottom left/right）
  const switcher = ciwiBlock.querySelector("#ciwi-container");
  const mainBox = ciwiBlock.querySelector("#main-box");
  const selectedLanguageText = ciwiBlock.querySelector(
    "#translate-float-btn-text",
  );
  const translateFloatBtn = ciwiBlock.querySelector("#translate-float-btn");
  const translateFloatBtnIcon = ciwiBlock.querySelector(
    "#translate-float-btn-icon",
  );
  const selectorBox = ciwiBlock.querySelector("#selector-box");
  const selectorBackdrop = ciwiBlock.querySelector("#selector-backdrop");
  const closeButtonWrapper = ciwiBlock.querySelector(".close_button_wrapper");
  const shouldUseSidebarWidget =
    !configData.languageSelector && !configData.currencySelector;
  const isDirectSelectorMode = activeSelectorCount === 1 && !shouldUseSidebarWidget;
  const isTransparentMode = Boolean(configData?.isTransparent);
  const shouldHideForTransparentMode = isTransparentMode && !isInThemePreview;

  if (switcher) {
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

      // 四个方向处理（保持原始逻辑）
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
        translateFloatBtnText.style.backgroundColor =
          configData.backgroundColor;
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
  }

  // RTL 判断
  const selectedTextElement = ciwiBlock.querySelector(".language_selector_header");
  const currentLanguage = selectedTextElement?.selectedOptions?.[0]?.textContent?.trim();
  const isRtlLanguage = rtlLanguages.includes(currentLanguage);

  if (isRtlLanguage && selectedLanguageText) {
    selectorBox.style.right = "0";
  }

  syncCompactSwitcherLayout(ciwiBlock);

  if (isInThemePreview) {
    disableCiwiInteractionsInThemePreview(ciwiBlock);
    return;
  }

  // 仅在命中缓存时后台刷新 config（异步，不阻塞）；
  // 首次无缓存时 useCacheThenRefresh 已经拉取并缓存，无需再请求一次
  if (hadConfigCache) {
    API.fetchSwitcherConfig({ shop: shop.value })
      .then((fresh) => {
        if (fresh) {
          setWithTTL("ciwi_switcher_config", fresh);
        }
      })
      .catch(() => {});
  }

  if (isCurrencySelectorTakeEffect) {
    API.fetchCurrencies({ blockId, shop: shop.value })
      .then((fresh) => {
        if (fresh) {
          localStorage.setItem("ciwi_currency_data", JSON.stringify(fresh));
        }
      })
      .catch(() => {});
  }

  // 首次采集（当前语言）
  scheduleAutoLiquidCollect();

  let lastRuntimeLanguage = detectRuntimeLanguage(ciwiBlock, availableLanguages);

  const syncRuntimeLanguage = () => {
    const nextLanguage = detectRuntimeLanguage(ciwiBlock, availableLanguages);
    if (!nextLanguage) return;
    if (
      normalizeLocaleCode(nextLanguage) ===
      normalizeLocaleCode(lastRuntimeLanguage)
    ) {
      return;
    }

    lastRuntimeLanguage = nextLanguage;

    const languageInput = ciwiBlock.querySelector('input[name="language_code"]');
    const languageSelect = ciwiBlock.querySelector(".language_selector_header");
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
    runStorefrontTranslationTasks();
    // 语言切换：先替换新目标语言的自定义 Liquid，再采集（保持替换先于采集）。
    if (!isInThemePreview) {
      customLiquidReplacePromise = Promise.resolve(
        CustomLiquidTextTranslate(blockId, shop, ciwiBlock),
      ).catch(() => {});
    }
    scheduleAutoLiquidCollect();
  };

  const languageAttrObserver = new MutationObserver(syncRuntimeLanguage);
  languageAttrObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["lang"],
  });

  window.addEventListener("pageshow", syncRuntimeLanguage);
  window.addEventListener("popstate", syncRuntimeLanguage);
  window.setInterval(syncRuntimeLanguage, 1200);

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
