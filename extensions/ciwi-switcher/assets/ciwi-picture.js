import { GetProductImageData, GetShopImageData } from "./ciwi-api.js";
import {
  asCacheableTranslationResponse,
  buildTranslationCacheKey,
  CIWI_TRANSLATION_TTL_MS,
  resolveStorefrontProductId,
} from "./ciwi-page.js";
import { useCacheThenRefresh } from "./ciwi-storage.js";

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
