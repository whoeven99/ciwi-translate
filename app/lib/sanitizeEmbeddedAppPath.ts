/** Shopify Admin / App Bridge sometimes appends the nav icon as `&icon=data:image...` with no `?`, so Remix treats it as pathname and 404s. */

const ICON_JUNK = "&icon=data:image";
const ICON_JUNK_ENCODED = "%26icon=data:image";

function junkIndex(pathname: string): number {
  const raw = pathname.indexOf(ICON_JUNK);
  if (raw >= 0) return raw;
  return pathname.indexOf(ICON_JUNK_ENCODED);
}

/** Returns the path without the junk suffix, or null if nothing to strip. */
export function sanitizeEmbeddedAppPath(pathname: string): string | null {
  const idx = junkIndex(pathname);
  if (idx <= 0) return null;
  const cleaned = pathname.slice(0, idx);
  if (!cleaned.startsWith("/") || cleaned.includes("&")) return null;
  return cleaned;
}

/** Path + search + hash for `location.replace`. `href` may be path-only. */
export function sanitizeEmbeddedAppHref(href: string): string | null {
  let url: URL;
  try {
    url = href.startsWith("http://") || href.startsWith("https://")
      ? new URL(href)
      : new URL(href, "http://ciwi.invalid");
  } catch {
    return null;
  }
  const cleaned = sanitizeEmbeddedAppPath(url.pathname);
  if (!cleaned) return null;
  url.pathname = cleaned;
  return `${url.pathname}${url.search}${url.hash}`;
}
