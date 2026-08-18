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

  it("keeps real storefront copy", () => {
    assert.equal(looksLikeAutoLiquidJunk("Add to cart"), false);
    assert.equal(looksLikeAutoLiquidJunk("Buying Guide"), false);
    assert.equal(looksLikeAutoLiquidJunk("Money-back guarantee"), false);
    assert.equal(looksLikeAutoLiquidJunk("Let customers speak for us"), false);
    assert.equal(looksLikeAutoLiquidJunk("Checkout"), false);
    assert.equal(looksLikeAutoLiquidJunk("Cart"), false);
    assert.equal(looksLikeAutoLiquidJunk("Accessories"), false);
  });

  it("is wired into translationRuleJudgment for liquid collect", () => {
    assert.equal(translationRuleJudgment("liquid", "2747 reviews"), false);
    assert.equal(translationRuleJudgment("liquid", "R NineT"), false);
    assert.equal(translationRuleJudgment("liquid", "Buying Guide"), true);
  });
});
