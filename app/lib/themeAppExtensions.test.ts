import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CIWI_SWITCHER_EMBED_HANDLE,
  buildSwitcherThemeEditorUrl,
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

  it("returns unknown for a malformed payload", () => {
    assert.equal(resolveThemeEmbedStatus(null, CIWI_SWITCHER_EMBED_HANDLE), "unknown");
    assert.equal(resolveThemeEmbedStatus({}, CIWI_SWITCHER_EMBED_HANDLE), "unknown");
  });
});

describe("buildSwitcherThemeEditorUrl", () => {
  it("builds the theme-editor deep link", () => {
    assert.equal(
      buildSwitcherThemeEditorUrl("demo.myshopify.com", "123456"),
      `https://demo.myshopify.com/admin/themes/current/editor?context=apps&activateAppId=${encodeURIComponent("123456/ciwi_I18n_Switcher")}`,
    );
  });

  it("returns null when shop or app id is blank", () => {
    assert.equal(buildSwitcherThemeEditorUrl("", "123"), null);
    assert.equal(buildSwitcherThemeEditorUrl("demo.myshopify.com", "  "), null);
  });
});
