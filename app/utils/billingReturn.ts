const BILLING_RETURN_PARAM = "ciwiBillingReturn";
const BILLING_RETURN_KIND_PARAM = "ciwiBillingKind";
const BILLING_RETURN_PREV_TOTAL_PARAM = "ciwiBillingPrevTotal";

/** Shopify billing returnUrl max length (GraphQL Money / AppPurchase). */
export const SHOPIFY_BILLING_RETURN_URL_MAX_LENGTH = 255;

type BillingReturnKind = "credits" | "plan";

const BILLING_RETURN_BASE = "https://ciwi.local";

function resolveAppPathname(
  input: string | null | undefined,
  fallback = "/app/pricing",
): string {
  if (!input) return fallback;

  try {
    const url = new URL(input, BILLING_RETURN_BASE);
    if (!url.pathname.startsWith("/app/")) return fallback;
    return url.pathname;
  } catch {
    return fallback;
  }
}

/** App route only — omit embedded session query (host, id_token, …) from billing returnUrl. */
export function sanitizeBillingReturnPath(
  input: string | null | undefined,
  fallback = "/app/pricing",
) {
  const pathname = resolveAppPathname(input, fallback);
  if (!input) return fallback;

  try {
    const url = new URL(input, BILLING_RETURN_BASE);
    if (!url.pathname.startsWith("/app/")) return fallback;

    const out = new URL(pathname, BILLING_RETURN_BASE);
    for (const key of [
      BILLING_RETURN_PARAM,
      BILLING_RETURN_KIND_PARAM,
      BILLING_RETURN_PREV_TOTAL_PARAM,
    ] as const) {
      const value = url.searchParams.get(key);
      if (value != null && value !== "") {
        out.searchParams.set(key, value);
      }
    }
    return `${out.pathname}${out.search}`;
  } catch {
    return pathname;
  }
}

export function stripBillingReturnParams(path: string) {
  return resolveAppPathname(path, "/app/pricing");
}

export function buildBillingReturnPath(
  path: string,
  options?: {
    kind?: BillingReturnKind;
    previousTotalChars?: number;
  },
) {
  const url = new URL(stripBillingReturnParams(path), BILLING_RETURN_BASE);
  url.searchParams.set(BILLING_RETURN_PARAM, "1");
  url.searchParams.set(BILLING_RETURN_KIND_PARAM, options?.kind ?? "credits");
  if (typeof options?.previousTotalChars === "number") {
    url.searchParams.set(
      BILLING_RETURN_PREV_TOTAL_PARAM,
      String(options.previousTotalChars),
    );
  }
  return `${url.pathname}${url.search}`;
}

export function parseBillingReturn(search: string) {
  const params = new URLSearchParams(search);
  if (params.get(BILLING_RETURN_PARAM) !== "1") {
    return null;
  }

  const kind = params.get(BILLING_RETURN_KIND_PARAM);
  const previousTotalRaw = params.get(BILLING_RETURN_PREV_TOTAL_PARAM);
  const previousTotalChars =
    previousTotalRaw != null && previousTotalRaw !== ""
      ? Number(previousTotalRaw)
      : undefined;

  return {
    kind: kind === "plan" ? "plan" : "credits",
    previousTotalChars:
      typeof previousTotalChars === "number" &&
      Number.isFinite(previousTotalChars)
        ? previousTotalChars
        : undefined,
  } as const;
}
