/** Ciwi Switcher app embed filename (no extension). */
export const CIWI_SWITCHER_EMBED_HANDLE = "ciwi_I18n_Switcher";

export type ThemeEmbedUiStatus = "active" | "inactive" | "unknown";
export type ThemeEmbedLoadStatus = ThemeEmbedUiStatus | "loading";

type ThemeExtensionActivation = {
  handle?: unknown;
  name?: unknown;
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
      const blockName = String(block?.name ?? "")
        .trim()
        .toLowerCase();
      const matchesHandle =
        blockHandle === needle || blockHandle.includes(needle);
      const lookingForSwitcher =
        needle === CIWI_SWITCHER_EMBED_HANDLE.toLowerCase() ||
        needle.includes("ciwi_i18n_switcher");
      const matchesSchemaName =
        lookingForSwitcher &&
        (blockHandle === "ciwi_switcher" ||
          blockName === "ciwi_switcher" ||
          blockName.replace(/\s+/g, "_") === "ciwi_switcher");
      if (!matchesHandle && !matchesSchemaName) continue;
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
  // Slash in activateAppId must stay literal (`{apiKey}/{handle}`). Encoding it
  // as %2F breaks the theme-editor deep link.
  return `https://${host}/admin/themes/current/editor?context=apps&activateAppId=${appId}/${CIWI_SWITCHER_EMBED_HANDLE}`;
}

/** Open the theme editor in the top Admin frame. `<a href>` / Polaris `url` stays in the app iframe and Chrome blocks Admin with X-Frame-Options. */
export function openSwitcherThemeEditor(url: string): boolean {
  const target = url.trim();
  if (typeof window === "undefined" || !target) return false;
  try {
    window.open(target, "_top");
    return true;
  } catch {
    try {
      window.top!.location.href = target;
      return true;
    } catch {
      return false;
    }
  }
}
