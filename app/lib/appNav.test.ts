import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  APP_NAV_HOME,
  APP_NAV_ITEMS,
  parentNavHrefFor,
} from "./appNav.ts";

describe("parentNavHrefFor", () => {
  it("highlights Manage Translation for nested resource pages", () => {
    assert.equal(
      parentNavHrefFor("/app/manage_translation/product"),
      APP_NAV_ITEMS.manageTranslation,
    );
    assert.equal(
      parentNavHrefFor("/app/manage_translation"),
      APP_NAV_ITEMS.manageTranslation,
    );
  });

  it("matches top-level nav items exactly", () => {
    assert.equal(parentNavHrefFor("/app/language"), APP_NAV_ITEMS.language);
    assert.equal(parentNavHrefFor("/app/pricing"), APP_NAV_ITEMS.pricing);
  });

  it("does not treat home or its sibling sub-pages as a visible nav item", () => {
    assert.equal(parentNavHrefFor(APP_NAV_HOME), null);
    assert.equal(parentNavHrefFor("/app/translate-v4-mvp-custom"), null);
    assert.equal(parentNavHrefFor("/app/translate-v4-history"), null);
    assert.equal(parentNavHrefFor("/app/onboarding"), null);
    assert.equal(parentNavHrefFor("/app"), null);
  });

  it("uses path-segment prefixes, not raw string startsWith", () => {
    assert.equal(parentNavHrefFor("/app/language-extra"), null);
    assert.equal(parentNavHrefFor("/app/manage_translation_old"), null);
  });
});
