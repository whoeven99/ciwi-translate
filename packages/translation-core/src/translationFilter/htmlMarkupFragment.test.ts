import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { looksLikeHtmlMarkupFragment } from "./htmlMarkupFragment.js";
import { translationRuleJudgment } from "./judgeTranslateUtils.js";

describe("looksLikeHtmlMarkupFragment", () => {
  it("rejects img attribute tails from broken Liquid/HTML", () => {
    assert.equal(
      looksLikeHtmlMarkupFragment(
        '}" loading="lazy" width="1536" height="2048" />',
      ),
      true,
    );
    assert.equal(
      looksLikeHtmlMarkupFragment(
        `}" loading='lazy' width='1538' height='2048' />`,
      ),
      true,
    );
    assert.equal(
      looksLikeHtmlMarkupFragment('width="1365" height="2048" />'),
      true,
    );
    assert.equal(
      looksLikeHtmlMarkupFragment(
        'srcset="a.jpg 1x, b.jpg 2x" decoding="async"',
      ),
      true,
    );
  });

  it("keeps real storefront copy", () => {
    assert.equal(looksLikeHtmlMarkupFragment("Chigee in Actie: De Showcase."), false);
    assert.equal(looksLikeHtmlMarkupFragment("Vitrine"), false);
    assert.equal(looksLikeHtmlMarkupFragment("Showcase"), false);
    assert.equal(looksLikeHtmlMarkupFragment("Add to cart"), false);
    assert.equal(looksLikeHtmlMarkupFragment("Size = Large"), false);
  });

  it("is wired into translationRuleJudgment for liquid collect", () => {
    assert.equal(
      translationRuleJudgment(
        "liquid",
        '}" loading="lazy" width="1536" height="2048" />',
      ),
      false,
    );
    assert.equal(translationRuleJudgment("liquid", "Showcase"), true);
  });
});
