import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolvePersistedJobCredits } from "./persistedJobCredits.ts";

const creditsFromChars = (chars: number): number => {
  if (chars <= 0) return 0;
  return Math.max(1, Math.ceil(chars * 1.6));
};

describe("resolvePersistedJobCredits", () => {
  it("returns null when no shopify modules and liquid is off", () => {
    assert.equal(
      resolvePersistedJobCredits({
        hasShopifyModules: false,
        includeLiquid: false,
        shopifyChars: 10_000,
        liquidChars: 100,
        creditsFromChars,
      }),
      null,
    );
  });

  it("uses liquid chars only for liquid-only jobs", () => {
    assert.equal(
      resolvePersistedJobCredits({
        hasShopifyModules: false,
        includeLiquid: true,
        shopifyChars: 10_000,
        liquidChars: 100,
        creditsFromChars,
      }),
      160,
    );
  });

  it("returns null when liquid-only has no pending chars", () => {
    assert.equal(
      resolvePersistedJobCredits({
        hasShopifyModules: false,
        includeLiquid: true,
        shopifyChars: 0,
        liquidChars: 0,
        creditsFromChars,
      }),
      null,
    );
  });

  it("adds shopify and liquid credits for mixed jobs", () => {
    assert.equal(
      resolvePersistedJobCredits({
        hasShopifyModules: true,
        includeLiquid: true,
        shopifyChars: 100,
        liquidChars: 100,
        creditsFromChars,
      }),
      320,
    );
  });
});
