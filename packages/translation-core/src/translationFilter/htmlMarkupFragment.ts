/**
 * Storefront TreeWalker leftovers: HTML/Liquid attribute tails, not human copy.
 * Example: `}" loading="lazy" width="1536" height="2048" />`
 */

const MEDIA_ATTR_RE =
  /\b(loading|srcset|decoding|fetchpriority)\s*=\s*["']/i;
const ATTR_PAIR_RE = /\b[\w:-]+\s*=\s*(["'])(?:(?!\1).)*\1/g;
const LEFTOVER_PREFIX_RE = /^[}\]"'`,;]+/;
const SELF_CLOSING_TAIL_RE = /\/\s*>\s*$/;
const ANY_ATTR_RE = /\b[\w:-]+\s*=\s*["']/;

export function looksLikeHtmlMarkupFragment(value: string): boolean {
  const t = String(value || "").trim();
  if (!t) return false;
  if (MEDIA_ATTR_RE.test(t)) return true;
  const pairs = t.match(ATTR_PAIR_RE);
  if (pairs && pairs.length >= 2) return true;
  if (LEFTOVER_PREFIX_RE.test(t) && ANY_ATTR_RE.test(t)) return true;
  if (SELF_CLOSING_TAIL_RE.test(t) && ANY_ATTR_RE.test(t)) return true;
  return false;
}
