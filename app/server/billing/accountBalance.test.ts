import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getMigratablePurchasedCredits } from "./accountBalance.server";

describe("getMigratablePurchasedCredits", () => {
  it("is total − subscription − trial − used", () => {
    assert.equal(
      getMigratablePurchasedCredits({
        subscriptionCredits: 4000,
        purchasedCredits: 5000,
        trialCredits: 1000,
        usedCredits: 2000,
      }),
      3000,
    );
  });

  it("is zero when used is at least purchased", () => {
    assert.equal(
      getMigratablePurchasedCredits({
        subscriptionCredits: 4000,
        purchasedCredits: 500,
        trialCredits: 1000,
        usedCredits: 500,
      }),
      0,
    );
    assert.equal(
      getMigratablePurchasedCredits({
        subscriptionCredits: 4000,
        purchasedCredits: 500,
        trialCredits: 1000,
        usedCredits: 800,
      }),
      0,
    );
  });

  it("does not use remaining total as the cap", () => {
    const account = {
      subscriptionCredits: 4000,
      purchasedCredits: 500,
      trialCredits: 1000,
      usedCredits: 0,
    };
    assert.equal(getMigratablePurchasedCredits(account), 500);
  });
});
