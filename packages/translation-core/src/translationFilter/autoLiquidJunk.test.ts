import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  looksLikeAutoLiquidJunk,
  looksLikeProductModelCode,
} from "./autoLiquidJunk.js";
import { translationRuleJudgment } from "./judgeTranslateUtils.js";

describe("looksLikeAutoLiquidJunk", () => {
  it("rejects review widget and price junk", () => {
    assert.equal(looksLikeAutoLiquidJunk("2747 reviews"), true);
    assert.equal(looksLikeAutoLiquidJunk("5 stars: 3 (100%)"), true);
    assert.equal(looksLikeAutoLiquidJunk("★ Reviews"), true);
    assert.equal(looksLikeAutoLiquidJunk("¥43,700 JPY"), true);
    assert.equal(looksLikeAutoLiquidJunk("SKU： MFP0009"), true);
    assert.equal(looksLikeAutoLiquidJunk("NAV0022"), true);
    assert.equal(looksLikeAutoLiquidJunk("2024 and later"), true);
    assert.equal(looksLikeAutoLiquidJunk("20%OFF"), true);
    assert.equal(looksLikeAutoLiquidJunk("EUR €"), true);
  });

  it("rejects product / vehicle model codes", () => {
    assert.equal(looksLikeProductModelCode("R NineT"), true);
    assert.equal(looksLikeProductModelCode("AIO-5 Play"), true);
    assert.equal(looksLikeProductModelCode("CGOS"), true);
    assert.equal(looksLikeProductModelCode("F900 R"), true);
    assert.equal(looksLikeProductModelCode("S1000 RR"), true);
    assert.equal(looksLikeAutoLiquidJunk("R NineT"), true);
  });

  it("rejects A–E: brand/platform, person, spec/sku, size, locale label", () => {
    // A brand / platform / payment
    assert.equal(looksLikeAutoLiquidJunk("Facebook"), true);
    assert.equal(looksLikeAutoLiquidJunk("Instagram"), true);
    assert.equal(looksLikeAutoLiquidJunk("CarPlay"), true);
    assert.equal(looksLikeAutoLiquidJunk("PayPal"), true);
    assert.equal(looksLikeAutoLiquidJunk("Visa"), true);
    assert.equal(looksLikeAutoLiquidJunk("BMW"), true);
    // B person / handle
    assert.equal(looksLikeAutoLiquidJunk("Mark H."), true);
    assert.equal(looksLikeAutoLiquidJunk("R. A."), true);
    assert.equal(looksLikeAutoLiquidJunk("Anonymous"), true);
    assert.equal(looksLikeAutoLiquidJunk("@RiderNav-Global"), true);
    // C spec / coupon / EU size / model-ish
    assert.equal(looksLikeAutoLiquidJunk("161*90.5*22mm"), true);
    assert.equal(looksLikeAutoLiquidJunk("180 g"), true);
    assert.equal(looksLikeAutoLiquidJunk("EU 42"), true);
    assert.equal(looksLikeAutoLiquidJunk("FRANKSAFFAIR12"), true);
    assert.equal(looksLikeAutoLiquidJunk("SMT 890"), true);
    assert.equal(looksLikeAutoLiquidJunk("CGOS 2"), true);
    assert.equal(looksLikeAutoLiquidJunk("6 Likes"), true);
    assert.equal(looksLikeAutoLiquidJunk(", BMW"), true);
    // D size codes
    assert.equal(looksLikeAutoLiquidJunk("XL"), true);
    assert.equal(looksLikeAutoLiquidJunk("XXL"), true);
    // E locale switcher labels
    assert.equal(looksLikeAutoLiquidJunk("English"), true);
    assert.equal(looksLikeAutoLiquidJunk("Deutsch"), true);
    assert.equal(looksLikeAutoLiquidJunk("Italiano"), true);
    assert.equal(looksLikeAutoLiquidJunk("Nederlands"), true);
  });

  it("keeps real storefront copy (incl. short UI worth translating)", () => {
    assert.equal(looksLikeAutoLiquidJunk("Add to cart"), false);
    assert.equal(looksLikeAutoLiquidJunk("Buying Guide"), false);
    assert.equal(looksLikeAutoLiquidJunk("Money-back guarantee"), false);
    assert.equal(looksLikeAutoLiquidJunk("Let customers speak for us"), false);
    assert.equal(looksLikeAutoLiquidJunk("Checkout"), false);
    assert.equal(looksLikeAutoLiquidJunk("Cart"), false);
    assert.equal(looksLikeAutoLiquidJunk("Accessories"), false);
    // F: short UI — intentionally NOT junk
    assert.equal(looksLikeAutoLiquidJunk("FAQ"), false);
    assert.equal(looksLikeAutoLiquidJunk("Price"), false);
    assert.equal(looksLikeAutoLiquidJunk("Shop"), false);
    assert.equal(looksLikeAutoLiquidJunk("Support"), false);
    assert.equal(looksLikeAutoLiquidJunk("Sort by"), false);
    assert.equal(looksLikeAutoLiquidJunk("Color"), false);
    assert.equal(looksLikeAutoLiquidJunk("Email"), false);
  });

  it("is wired into translationRuleJudgment for liquid collect", () => {
    assert.equal(translationRuleJudgment("liquid", "2747 reviews"), false);
    assert.equal(translationRuleJudgment("liquid", "R NineT"), false);
    assert.equal(translationRuleJudgment("liquid", "Facebook"), false);
    assert.equal(translationRuleJudgment("liquid", "Buying Guide"), true);
    assert.equal(translationRuleJudgment("liquid", "FAQ"), true);
  });
});
