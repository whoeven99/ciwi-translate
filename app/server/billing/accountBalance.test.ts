import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getMigratablePurchasedCredits,
  getPurchasedCreditsConsumedByUsage,
  settleExpiredInstallTrialCredits,
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

describe("settleExpiredInstallTrialCredits", () => {
  const expiresAt = new Date("2026-08-01T00:00:00.000Z");

  it("does not settle when expiresAt is null", () => {
    const settled = settleExpiredInstallTrialCredits(
      { trialCredits: 1_000_000, usedCredits: 100, trialCreditsExpiresAt: null },
      new Date("2026-09-01T00:00:00.000Z"),
    );
    assert.equal(settled.settled, false);
    assert.equal(settled.trialCredits, 1_000_000);
    assert.equal(settled.usedCredits, 100);
  });

  it("does not settle before expiry", () => {
    const settled = settleExpiredInstallTrialCredits(
      { trialCredits: 1_000_000, usedCredits: 100, trialCreditsExpiresAt: expiresAt },
      new Date("2026-07-31T00:00:00.000Z"),
    );
    assert.equal(settled.settled, false);
  });

  it("zeros leftover unused trial and leaves used unchanged", () => {
    const settled = settleExpiredInstallTrialCredits(
      { trialCredits: 1_000_000, usedCredits: 200_000, trialCreditsExpiresAt: expiresAt },
      new Date("2026-08-02T00:00:00.000Z"),
    );
    assert.equal(settled.settled, true);
    assert.equal(settled.trialCredits, 0);
    assert.equal(settled.usedCredits, 0);
    assert.equal(settled.consumed, 200_000);
    assert.equal(settled.leftover, 800_000);
  });

  it("subtracts fully consumed trial from used and keeps overflow", () => {
    const settled = settleExpiredInstallTrialCredits(
      { trialCredits: 1_000_000, usedCredits: 1_500_000, trialCreditsExpiresAt: expiresAt },
      new Date("2026-08-02T00:00:00.000Z"),
    );
    assert.equal(settled.settled, true);
    assert.equal(settled.trialCredits, 0);
    assert.equal(settled.usedCredits, 500_000);
    assert.equal(settled.consumed, 1_000_000);
    assert.equal(settled.leftover, 0);
  });
});
