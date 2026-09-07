import { CollectLiquidStrings } from "./ciwi-api.js";
import { isPriceRelatedElement } from "./ciwi-utils.js";
import {
  isElementHiddenForTranslation,
  normalizeText,
  skipTags,
} from "./ciwi-text.js";

/** 与 app/server/storefront/liquidCollect.server.ts MAX_TEXT_LEN 保持同步。 */
const AUTO_LIQUID_MAX_LEN = 500;
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
            // 仅真正入库（scheduled>0）才记已报；all_known 等应允许下轮重试。
            if (res?.success && Number(body?.scheduled) > 0) {
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

