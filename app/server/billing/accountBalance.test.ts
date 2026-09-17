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
  const expired = new Date("2026-08-01T00:00:00.000Z");
  const now = new Date("2026-09-14T00:00:00.000Z");

  it("does not settle before expiry", () => {
    const result = settleExpiredInstallTrialCredits(
      {
        trialCredits: 200_000,
        usedCredits: 50_000,
        trialCreditsExpiresAt: new Date("2026-10-01T00:00:00.000Z"),
      },
      now,
    );
    assert.deepEqual(result, {
      trialCredits: 200_000,
      usedCredits: 50_000,
      settled: false,
      leftover: 0,
      consumed: 0,
    });
  });

  it("does not settle legacy launch credits with no expiry", () => {
    const result = settleExpiredInstallTrialCredits(
      {
        trialCredits: 4_000_000,
        usedCredits: 10_000,
        trialCreditsExpiresAt: null,
      },
      now,
    );
    assert.equal(result.settled, false);
    assert.equal(result.trialCredits, 4_000_000);
  });

  it("clears leftover trial and removes gift usage from used", () => {
    const result = settleExpiredInstallTrialCredits(
      {
        trialCredits: 200_000,
        usedCredits: 50_000,
        trialCreditsExpiresAt: expired,
      },
      now,
    );
    assert.deepEqual(result, {
      trialCredits: 0,
      usedCredits: 0,
      settled: true,
      leftover: 150_000,
      consumed: 50_000,
    });
  });

  it("when gift is fully used, only peels gift off used and keeps paid usage", () => {
    const result = settleExpiredInstallTrialCredits(
      {
        trialCredits: 200_000,
        usedCredits: 250_000,
        trialCreditsExpiresAt: expired,
      },
      now,
    );
    assert.deepEqual(result, {
      trialCredits: 0,
      usedCredits: 50_000,
      settled: true,
      leftover: 0,
      consumed: 200_000,
    });
  });
});
