/**
 * Auto Liquid collect junk: review widgets, prices, SKU tokens, fitment years, etc.
 * Keep aligned with extensions/ciwi-switcher/assets/ciwi-ui.js `looksLikeAutoLiquidJunk`.
 */

function normalize(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

/** Review / rating widget copy — not merchant translatable copy. */
function looksLikeReviewWidgetText(text: string): boolean {
  if (
    /\b(reviews?|ratings?|verified|stars?|sterren|stelle|étoiles?|estrellas?|bewertungen?)\b/i.test(
      text,
    )
  ) {
    return true;
  }
  if (/★/.test(text)) return true;
  if (/\d+\s*stars?\s*:/i.test(text)) return true;
  if (/\d+\s*[:：]\s*\d+/.test(text) && /%/.test(text)) return true;
  return false;
}

/** Real money amounts and explicit SKU labels. */
function looksLikePriceOrSkuLabel(text: string): boolean {
  if (/[$€£¥₹]\s*\d[\d,.'’]*/.test(text)) return true;
  if (/\d[\d,.'’]*\s*(JPY|EUR|USD|GBP|CNY|RMB)\b/i.test(text)) return true;
  if (/^SKU\s*[：:]/i.test(text)) return true;
  return false;
}

/** Motorcycle / parts fitment year strings (short compatibility lines). */
function looksLikeFitmentYearText(text: string): boolean {
  if (/\b(19|20)\d{2}\s+and\s+later\b/i.test(text)) return true;
  if (text.length <= 80 && /\b(19|20)\d{2}\s*[-–—]\s*(19|20)\d{2}\b/.test(text)) {
    return true;
  }
  return false;
}

function looksLikeSkuToken(text: string): boolean {
  if (/\s/.test(text)) return false;
  if (!/^[A-Z0-9]{4,12}$/i.test(text)) return false;
  return /\d/.test(text);
}

function looksLikePromoOrCurrencyLabel(text: string): boolean {
  if (/^\d+\s*%\s*OFF$/i.test(text)) return true;
  if (/^(EUR|USD|GBP|JPY|CNY|RMB)\s*[€$£¥]?$/i.test(text)) return true;
  return false;
}

export function looksLikeAutoLiquidJunk(value: string): boolean {
  const t = normalize(value);
  if (!t) return false;
  if (looksLikeReviewWidgetText(t)) return true;
  if (looksLikePriceOrSkuLabel(t)) return true;
  if (looksLikeFitmentYearText(t)) return true;
  if (looksLikeSkuToken(t)) return true;
  if (looksLikePromoOrCurrencyLabel(t)) return true;
  return false;
}
