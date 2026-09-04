/** Ciwi Switcher app embed filename (no extension). */
export const CIWI_SWITCHER_EMBED_HANDLE = "ciwi_I18n_Switcher";

export type ThemeEmbedUiStatus = "active" | "inactive" | "unknown";

type ThemeExtensionActivation = {
  handle?: unknown;
  status?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getAppExtensionsFn(): (() => Promise<unknown>) | undefined {
  const app = (
    globalThis as {
      shopify?: { app?: { extensions?: () => Promise<unknown> } };
    }
  ).shopify?.app;
  const fn = app?.extensions;
  return typeof fn === "function" ? fn.bind(app) : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

/** Wait for App Bridge `shopify.app.extensions()`, then fetch. `null` = timeout or bad payload. */
export async function fetchThemeAppExtensions(
  timeoutMs = 8000,
): Promise<unknown[] | null> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const fn = getAppExtensionsFn();
    if (fn) {
      const result = await fn();
      return Array.isArray(result) ? result : null;
    }
    await sleep(100);
  }
  return null;
}

export function resolveThemeEmbedStatus(
  extensions: unknown,
  handle: string,
): ThemeEmbedUiStatus {
  if (!Array.isArray(extensions)) {
    return "unknown";
  }

  const needle = handle.trim().toLowerCase();
  if (!needle) {
    return "unknown";
  }

  for (const item of extensions) {
    if (!isRecord(item) || item.type !== "theme_app_extension") continue;
    const activations = Array.isArray(item.activations)
      ? (item.activations as ThemeExtensionActivation[])
      : [];
    for (const block of activations) {
      const blockHandle = String(block?.handle ?? "")
        .trim()
        .toLowerCase();
      if (blockHandle !== needle && !blockHandle.includes(needle)) continue;
      return block.status === "active" ? "active" : "inactive";
    }
  }

  return "inactive";
}

export function buildSwitcherThemeEditorUrl(
  shop: string,
  ciwiSwitcherId: string,
): string | null {
  const host = shop.trim();
  const appId = ciwiSwitcherId.trim();
  if (!host || !appId) return null;
  return `https://${host}/admin/themes/current/editor?context=apps&activateAppId=${encodeURIComponent(`${appId}/${CIWI_SWITCHER_EMBED_HANDLE}`)}`;
}
