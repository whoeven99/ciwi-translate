import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CIWI_SWITCHER_EMBED_HANDLE,
  buildSwitcherThemeEditorUrl,
  openSwitcherThemeEditor,
  resolveThemeEmbedStatus,
} from "./themeAppExtensions.ts";

const themeExtension = {
  handle: "ciwi-switcher",
  type: "theme_app_extension",
  activations: [
    {
      target: "body",
      handle: CIWI_SWITCHER_EMBED_HANDLE,
      name: "Ciwi_Switcher",
      status: "active",
      activations: [{ target: "theme", themeId: "gid://shopify/OnlineStoreTheme/1" }],
    },
  ],
};

describe("resolveThemeEmbedStatus", () => {
  it("returns active when the embed status is active", () => {
    assert.equal(
      resolveThemeEmbedStatus([themeExtension], CIWI_SWITCHER_EMBED_HANDLE),
      "active",
    );
  });

  it("returns inactive when the embed exists but is not active", () => {
    const available = {
      ...themeExtension,
      activations: [{ ...themeExtension.activations[0], status: "available" }],
    };
    assert.equal(
      resolveThemeEmbedStatus([available], CIWI_SWITCHER_EMBED_HANDLE),
      "inactive",
    );
  });

  it("returns inactive when the list is empty or the handle is missing", () => {
    assert.equal(resolveThemeEmbedStatus([], CIWI_SWITCHER_EMBED_HANDLE), "inactive");
    assert.equal(
      resolveThemeEmbedStatus([themeExtension], "other_block"),
      "inactive",
    );
  });

  it("returns active when Shopify reports the schema name Ciwi_Switcher", () => {
    const bySchemaName = {
      ...themeExtension,
      activations: [
        {
          ...themeExtension.activations[0],
          handle: "Ciwi_Switcher",
          name: "Ciwi_Switcher",
        },
      ],
    };
    assert.equal(
      resolveThemeEmbedStatus([bySchemaName], CIWI_SWITCHER_EMBED_HANDLE),
      "active",
    );
  });

  it("returns unknown for a malformed payload", () => {
    assert.equal(resolveThemeEmbedStatus(null, CIWI_SWITCHER_EMBED_HANDLE), "unknown");
    assert.equal(resolveThemeEmbedStatus({}, CIWI_SWITCHER_EMBED_HANDLE), "unknown");
  });
});

describe("buildSwitcherThemeEditorUrl", () => {
  it("builds the theme-editor deep link", () => {
    assert.equal(
      buildSwitcherThemeEditorUrl("demo.myshopify.com", "123456"),
      "https://demo.myshopify.com/admin/themes/current/editor?context=apps&activateAppId=123456/ciwi_I18n_Switcher",
    );
  });

  it("returns null when shop or app id is blank", () => {
    assert.equal(buildSwitcherThemeEditorUrl("", "123"), null);
    assert.equal(buildSwitcherThemeEditorUrl("demo.myshopify.com", "  "), null);
  });
});

describe("openSwitcherThemeEditor", () => {
  it("opens the theme editor in the top admin frame", () => {
    const url =
      "https://demo.myshopify.com/admin/themes/current/editor?context=apps&activateAppId=123456/ciwi_I18n_Switcher";
    const calls: unknown[][] = [];
    const previous = globalThis.window;
    globalThis.window = {
      open: (...args: unknown[]) => {
        calls.push(args);
        return {} as Window;
      },
    } as Window & typeof globalThis;

    try {
      assert.equal(openSwitcherThemeEditor(url), true);
      assert.deepEqual(calls, [[url, "_top"]]);
    } finally {
      globalThis.window = previous;
    }
  });

  it("returns false when the url is blank", () => {
    assert.equal(openSwitcherThemeEditor(""), false);
    assert.equal(openSwitcherThemeEditor("   "), false);
  });
});
