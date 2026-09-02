import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getMigratablePurchasedCredits,
  getPurchasedCreditsConsumedByUsage,
} from "./accountBalance.server";

describe("getPurchasedCreditsConsumedByUsage", () => {
  it("is 0 while used is covered by subscription + trial", () => {
    assert.equal(
      getPurchasedCreditsConsumedByUsage({
        subscriptionCredits: 4000,
        purchasedCredits: 5000,
        trialCredits: 1000,
        usedCredits: 2000,
      }),
      0,
    );
  });

  it("is used − subscription − trial when usage overflows into purchased", () => {
    assert.equal(
      getPurchasedCreditsConsumedByUsage({
        subscriptionCredits: 100,
        purchasedCredits: 500,
        trialCredits: 0,
        usedCredits: 200,
      }),
      100,
    );
  });
});

describe("getMigratablePurchasedCredits", () => {
  it("is all purchased when used has not reached the purchased pool", () => {
    assert.equal(
      getMigratablePurchasedCredits({
        subscriptionCredits: 4000,
        purchasedCredits: 5000,
        trialCredits: 1000,
        usedCredits: 2000,
      }),
      5000,
    );
  });

  it("subtracts only the overflow into purchased", () => {
    assert.equal(
      getMigratablePurchasedCredits({
        subscriptionCredits: 100,
        purchasedCredits: 500,
        trialCredits: 0,
        usedCredits: 200,
      }),
      400,
    );
  });

  it("is zero when usage has consumed the whole purchased pool", () => {
    assert.equal(
      getMigratablePurchasedCredits({
        subscriptionCredits: 4000,
        purchasedCredits: 500,
        trialCredits: 1000,
        usedCredits: 5500,
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
