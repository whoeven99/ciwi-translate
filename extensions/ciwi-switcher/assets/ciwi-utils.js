// utils.js
/**
 * 包含价格转换、解析和格式化的工具函数
 */
import { getStorageItem, setStorageItem, removeStorageItem } from "./ciwi-storage.js";

export function convertToNumberFromMoneyFormat(moneyFormat, formattedPrice) {
  let number = formattedPrice;
  switch (true) {
    case moneyFormat.includes("amount_with_comma_separator"):
      number = number.replace(/\./g, "").replace(",", ".");
      return parseFloat(number).toFixed(2);
    case moneyFormat.includes("amount_no_decimals_with_comma_separator"):
      return parseFloat(number.replace(/\./g, "").replace(",", "")).toFixed(2);
    case moneyFormat.includes("amount_with_apostrophe_separator"):
      number = number.replace(/'/g, "");
      return parseFloat(number).toFixed(2);
    case moneyFormat.includes("amount_no_decimals_with_space_separator"):
      return parseFloat(number.replace(/\s/g, "")).toFixed(2);
    case moneyFormat.includes("amount_with_space_separator"):
      number = number.replace(/\s/g, "").replace(",", ".");
      return parseFloat(number).toFixed(2);
    case moneyFormat.includes("amount_with_period_and_space_separator"):
      number = number.replace(/\s/g, "");
      return parseFloat(number).toFixed(2);
    case moneyFormat.includes("amount_no_decimals"):
      return parseFloat(number.replace(/,/g, "")).toFixed(2);
    case moneyFormat.includes("amount"):
      number = number.replace(/,/g, "");
      return parseFloat(number).toFixed(2);
    default:
      number = number.replace(/\./g, "").replace(",", ".");
      return parseFloat(number).toFixed(2);
  }
}

export function customRounding(number, rounding) {
  if (parseFloat(number) === 0 && rounding != "0") {
    return number;
  }
  const integerPart = Math.floor(number);
  switch (rounding) {
    case "":
      return number;
    case "0":
      return parseFloat(number).toFixed(0);
    case "1.00":
      return integerPart.toFixed(2);
    case "0.99":
      return integerPart + 0.99;
    case "0.95":
      return integerPart + 0.95;
    case "0.75":
      return integerPart + 0.75;
    case "0.5":
      return (integerPart + 0.5).toFixed(2);
    case "0.25":
      return integerPart + 0.25;
    default:
      return number;
  }
}

function formatWithComma(integerPart, decimalPart) {
  integerPart = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decimalPart ? `${integerPart}.${decimalPart}` : integerPart;
}
function formatWithCommaAndCommaDecimal(integerPart, decimalPart) {
  integerPart = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decimalPart ? `${integerPart},${decimalPart}` : integerPart;
}
function formatWithApostrophe(integerPart, decimalPart) {
  integerPart = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  return decimalPart ? `${integerPart}.${decimalPart}` : integerPart;
}
function formatWithSpace(integerPart, decimalPart) {
  integerPart = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return decimalPart ? `${integerPart},${decimalPart}` : integerPart;
}
function formatWithSpaceAndPeriod(integerPart, decimalPart) {
  integerPart = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return decimalPart ? `${integerPart}.${decimalPart}` : integerPart;
}

const CURRENCY_SYMBOL_RE = /[$€£¥₹₩₽₺₫₴₦₱₪₡₲₵]/;
const CURRENCY_CODE_RE = /\b[A-Z]{3}\b/;
const MONEY_FRAGMENT_RE =
  /(?:\b[A-Z]{3}\b\s*)?[$€£¥₹₩₽₺₫₴₦₱₪₡₲₵]?\s*\d[\d\s,.'’]*(?:[.,]\d+)?(?:\s*\b[A-Z]{3}\b)?/g;

const CIWI_MONEY_SELECTOR_PARTS = [
  ".ciwi-money",
  ".money",
  ".price",
  ".price-item",
  ".price__current",
  ".price__sale",
  ".price__regular",
  ".product-price",
  ".product__price",
  "[data-money]",
  "[data-price]",
  "[data-product-price]",
  "[data-regular-price]",
  "[data-sale-price]",
  "span.price",
  "sale-price",
  "compare-at-price",
  "unit-price",
];

export const CIWI_MONEY_SELECTOR = CIWI_MONEY_SELECTOR_PARTS.join(", ");
export const CIWI_PRICE_RELATED_SELECTOR = [
  ...CIWI_MONEY_SELECTOR_PARTS,
  "price-list",
].join(", ");

export function isLikelyMoneyText(text) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return false;
  if (!/\d/.test(value)) return false;
  if (value.includes("%")) return false;
  return CURRENCY_SYMBOL_RE.test(value) || CURRENCY_CODE_RE.test(value);
}

export function shouldTrackMoneyNode(node) {
  if (!(node instanceof Element)) return false;
  if (!isLikelyMoneyText(node.textContent || node.innerText || "")) return false;

  const nestedCandidate = node.querySelector(CIWI_MONEY_SELECTOR);
  if (!nestedCandidate) return true;

  return !isLikelyMoneyText(
    nestedCandidate.textContent || nestedCandidate.innerText || "",
  );
}

export function isPriceRelatedElement(node) {
  const element =
    node instanceof Element
      ? node
      : node instanceof Node
        ? node.parentElement
        : null;
  return Boolean(element?.closest(CIWI_PRICE_RELATED_SELECTOR));
}
function collectMoneyNodes(root) {
  const scope = root || document;
  const nodes = scope.querySelectorAll(CIWI_MONEY_SELECTOR);
  const list = [];
  nodes.forEach((node) => {
    if (!(node instanceof Element)) return;
    if (node.classList.contains("ciwi-money")) {
      list.push(node);
      return;
    }
    if (!shouldTrackMoneyNode(node)) return;
    node.classList.add("ciwi-money");
    list.push(node);
  });
  return list;
}

function normalizeMoneySourceText(text) {
  return String(text || "")
    .replace(/[\u00A0\u202F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMoneyFragment(text) {
  const normalized = normalizeMoneySourceText(text);
  if (!normalized) return "";

  const matches = normalized.match(MONEY_FRAGMENT_RE) || [];
  return (
    matches.find(
      (match) =>
        /\d/.test(match) &&
        (CURRENCY_SYMBOL_RE.test(match) || CURRENCY_CODE_RE.test(match)),
    ) || ""
  );
}

function escapeRegExp(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildConvertedPriceText(detectedPrice, selectedCurrency) {
  const currencyConfig = window.currencyFormatConfig
    ? window.currencyFormatConfig[selectedCurrency.currencyCode]
    : null;
  const symbol = selectedCurrency.symbol || "";
  const symbolPosition = currencyConfig
    ? currencyConfig.symbol_position
    : "front";

  if (symbolPosition === "back") {
    return `${detectedPrice}${symbol} ${selectedCurrency.currencyCode}`.trim();
  }

  return `${symbol}${detectedPrice} ${selectedCurrency.currencyCode}`.trim();
}

function replaceMoneyFragmentInOriginalHtml(node, originalHtml, originalText, nextText) {
  const moneyFragment = extractMoneyFragment(originalText);
  if (!moneyFragment) {
    node.textContent = nextText;
    return;
  }

  const template = document.createElement("template");
  template.innerHTML = originalHtml;
  const walker = document.createTreeWalker(
    template.content,
    NodeFilter.SHOW_TEXT,
  );

  let replaced = false;
  while (walker.nextNode()) {
    const textNode = walker.currentNode;
    const textValue = textNode.nodeValue || "";
    if (!extractMoneyFragment(textValue)) continue;

    const replacementRegex = new RegExp(escapeRegExp(moneyFragment).replace(/\s+/g, "\\s*"));
    if (!replacementRegex.test(normalizeMoneySourceText(textValue))) continue;

    textNode.nodeValue = normalizeMoneySourceText(textValue).replace(
      replacementRegex,
      nextText,
    );
    replaced = true;
    break;
  }

  if (replaced) {
    node.innerHTML = template.innerHTML;
    return;
  }

  node.textContent = normalizeMoneySourceText(originalText).replace(
    new RegExp(escapeRegExp(moneyFragment).replace(/\s+/g, "\\s*")),
    nextText,
  );
}

export function detectNumberFormat(moneyFormat, transformedPrice, rounding) {
  let number = transformedPrice.toString();
  let [integerPart, decimalPart = "00"] = number.split(".");
  // 将 decimalPart 固定为两位
  decimalPart = Number(`0.${decimalPart}`).toFixed(2).slice(2);
  // 当 rounding === "0" 时需要特殊处理（原逻辑保留）
  if (rounding == "0") {
    switch (moneyFormat) {
      case "amount":
      case "amount_no_decimals":
        return formatWithComma(integerPart, "");
      case "amount_with_comma_separator":
      case "amount_no_decimals_with_comma_separator":
        return formatWithCommaAndCommaDecimal(integerPart, "");
      case "amount_with_apostrophe_separator":
        return formatWithApostrophe(integerPart, "");
      case "amount_no_decimals_with_space_separator":
        return formatWithSpace(integerPart, "");
      case "amount_with_space_separator":
        return formatWithSpace(integerPart, "");
      case "amount_with_period_and_space_separator":
        return formatWithSpaceAndPeriod(integerPart, "");
      default:
        return transformedPrice;
    }
  } else {
    switch (moneyFormat) {
      case "amount":
        return formatWithComma(integerPart, decimalPart);
      case "amount_no_decimals":
        return formatWithComma(integerPart, "");
      case "amount_with_comma_separator":
        return formatWithCommaAndCommaDecimal(integerPart, decimalPart);
      case "amount_no_decimals_with_comma_separator":
        return formatWithCommaAndCommaDecimal(integerPart, "");
      case "amount_with_apostrophe_separator":
        return formatWithApostrophe(integerPart, decimalPart);
      case "amount_no_decimals_with_space_separator":
        return formatWithSpace(integerPart, "");
      case "amount_with_space_separator":
        return formatWithSpace(integerPart, decimalPart);
      case "amount_with_period_and_space_separator":
        return formatWithSpaceAndPeriod(integerPart, decimalPart);
      default:
        return transformedPrice;
    }
  }
}

/**
 * 转换单个 price DOM 节点（避免每次遍历全局 NodeList）
 */
export function transformSinglePriceNode(
  node,
  rate,
  moneyFormat,
  selectedCurrency,
) {
  if (!node || !node.innerText) return;
  if (!node.dataset.ciwiOriginalPriceHtml) {
    node.dataset.ciwiOriginalPriceHtml = node.innerHTML;
  }
  if (!node.dataset.ciwiOriginalPriceText) {
    node.dataset.ciwiOriginalPriceText = node.innerText;
  }

  if (!selectedCurrency) {
    node.innerHTML = node.dataset.ciwiOriginalPriceHtml;
    delete node.dataset.ciwiCurrencyCode;
    delete node.dataset.ciwiAppliedRate;
    return;
  }

  const priceText = node.dataset.ciwiOriginalPriceText || node.innerText;
  const moneyFragment = extractMoneyFragment(priceText);
  const formatted = moneyFragment
    .replace(/[^\d,.\s'’]/g, "")
    .replace(/’/g, "'")
    .trim();
  if (!formatted || rate === "Auto") return;
  if (
    node.dataset.ciwiCurrencyCode === selectedCurrency.currencyCode &&
    node.dataset.ciwiAppliedRate === String(rate)
  ) {
    return;
  }
  let number = convertToNumberFromMoneyFormat(moneyFormat, formatted);
  number = (number * rate).toFixed(2);
  const transformedPrice = customRounding(number, selectedCurrency.rounding);
  const detected = detectNumberFormat(
    moneyFormat,
    transformedPrice,
    selectedCurrency.rounding,
  );
  const nextText = buildConvertedPriceText(detected, selectedCurrency);

  replaceMoneyFragmentInOriginalHtml(
    node,
    node.dataset.ciwiOriginalPriceHtml || node.innerHTML,
    priceText,
    nextText,
  );
  node.dataset.ciwiCurrencyCode = selectedCurrency.currencyCode;
  node.dataset.ciwiAppliedRate = String(rate);
}

/**
 * 转换价格节点。默认扫描全文档的 .ciwi-money；
 * 传入 nodes（NodeList/Set/数组）时只转换这些节点，供 MutationObserver 增量调用。
 * transformSinglePriceNode 直接改写节点 innerHTML，自身已对已转换节点幂等。
 */
export function transformPrices({ rate, moneyFormat, selectedCurrency, nodes }) {
  const pricesDoc = nodes
    ? nodes
    : (() => {
        const tagged = document.querySelectorAll(".ciwi-money");
        if (tagged.length) return tagged;
        return collectMoneyNodes(document);
      })();

  pricesDoc.forEach((price) => {
    transformSinglePriceNode(price, rate, moneyFormat, selectedCurrency);
  });
}

/**
 * 跳转页面
 */
function normalizeLocaleCode(locale) {
  return String(locale || "")
    .trim()
    .replace(/_/g, "-")
    .toLowerCase();
}

function stripLeadingLocalePrefix(pathname, locales = []) {
  const path = String(pathname || "").trim() || "/";
  if (path === "/") return "/";

  const normalizedLocales = Array.from(
    new Set(
      locales
        .map((locale) => normalizeLocaleCode(locale))
        .filter(Boolean),
    ),
  ).sort((left, right) => right.length - left.length);

  for (const locale of normalizedLocales) {
    const prefix = `/${locale}`;
    if (path === prefix) return "/";
    if (path.startsWith(`${prefix}/`)) {
      return path.slice(prefix.length) || "/";
    }
  }

  return path;
}

export function buildLocalizationReturnTo({
  currentLanguage,
  language,
  markManual = false,
} = {}) {
  if (typeof window === "undefined") return "/";

  const currentUrl = new URL(window.location.href);
  const localeCandidates = [
    currentLanguage,
    window.Shopify?.locale,
    document.documentElement.lang,
  ];

  currentUrl.pathname = stripLeadingLocalePrefix(
    currentUrl.pathname,
    localeCandidates,
  );

  if (markManual) {
    currentUrl.searchParams.set("ciwi_manual_localization", "1");
  } else {
    currentUrl.searchParams.delete("ciwi_manual_localization");
  }

  return `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
}

export function updateLocalization({ country, language }) {
  const formId = crypto.randomUUID();
  const returnTo = buildLocalizationReturnTo({ language });
  const formHtml = `
    <form id="${formId}" action="/localization" method="POST" hidden>
      <input name="_method" value="PUT">
      <input name="country_code" value="${country}">
      <input name="language_code" value="${language}">
      <input name="return_to" value="${returnTo}">
    </form>
  `;
  document.body.insertAdjacentHTML("beforeend", formHtml);
  document.getElementById(formId).submit();
}

const CIWI_MANUAL_LOCALIZATION_KEY = "ciwi_manual_localization_preference";
const CIWI_MANUAL_LOCALIZATION_TTL_MS = 24 * 60 * 60 * 1000;

export function persistManualLocalizationPreference({ country, language, shop }) {
  if (!country && !language) return;

  try {
    setStorageItem(
      CIWI_MANUAL_LOCALIZATION_KEY,
      JSON.stringify({
        country: country || "",
        language: language || "",
        updatedAt: Date.now(),
      }),
      {
        scope: shop,
        legacyKeys: [CIWI_MANUAL_LOCALIZATION_KEY],
      },
    );
  } catch {}
}

export function getManualLocalizationPreference(shop) {
  try {
    const raw = getStorageItem(CIWI_MANUAL_LOCALIZATION_KEY, {
      scope: shop,
      legacyKeys: [CIWI_MANUAL_LOCALIZATION_KEY],
    });
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const updatedAt =
      typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0;

    if (!updatedAt || Date.now() - updatedAt > CIWI_MANUAL_LOCALIZATION_TTL_MS) {
      removeStorageItem(CIWI_MANUAL_LOCALIZATION_KEY, {
        scope: shop,
        legacyKeys: [CIWI_MANUAL_LOCALIZATION_KEY],
      });
      return null;
    }

    return {
      country: typeof parsed.country === "string" ? parsed.country : "",
      language: typeof parsed.language === "string" ? parsed.language : "",
    };
  } catch {
    return null;
  }
}
