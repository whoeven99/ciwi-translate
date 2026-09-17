import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  earliestTrialLotExpiresAt,
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

function trialLots(
  partial: Partial<Parameters<typeof settleExpiredInstallTrialCredits>[0]>,
): Parameters<typeof settleExpiredInstallTrialCredits>[0] {
  return {
    usedCredits: 0,
    trialInstallCredits: 0,
    trialInstallExpiresAt: null,
    trialBonusCredits: 0,
    trialBonusExpiresAt: null,
    ...partial,
  };
}

describe("settleExpiredInstallTrialCredits", () => {
  const expired = new Date("2026-08-01T00:00:00.000Z");
  const laterExpired = new Date("2026-09-01T00:00:00.000Z");
  const now = new Date("2026-09-14T00:00:00.000Z");
  const future = new Date("2026-10-01T00:00:00.000Z");

  it("does not settle when lot expiresAt is null", () => {
    const settled = settleExpiredInstallTrialCredits(
      trialLots({ trialBonusCredits: 1_000_000, usedCredits: 100 }),
      now,
    );
    assert.equal(settled.settled, false);
    assert.equal(settled.trialCredits, 1_000_000);
    assert.equal(settled.usedCredits, 100);
    assert.equal(settled.lots.length, 0);
  });

  it("does not settle before expiry", () => {
    const result = settleExpiredInstallTrialCredits(
      trialLots({
        trialInstallCredits: 200_000,
        trialInstallExpiresAt: future,
        usedCredits: 50_000,
      }),
      now,
    );
    assert.equal(result.settled, false);
    assert.equal(result.trialInstallCredits, 200_000);
    assert.equal(result.usedCredits, 50_000);
    assert.equal(result.lots.length, 0);
  });

  it("does not settle legacy launch credits with no expiry", () => {
    const result = settleExpiredInstallTrialCredits(
      trialLots({
        trialInstallCredits: 4_000_000,
        usedCredits: 10_000,
      }),
      now,
    );
    assert.equal(result.settled, false);
    assert.equal(result.trialCredits, 4_000_000);
  });

  it("clears leftover unused install gift and removes gift usage from used", () => {
    const result = settleExpiredInstallTrialCredits(
      trialLots({
        trialInstallCredits: 200_000,
        trialInstallExpiresAt: expired,
        usedCredits: 50_000,
      }),
      now,
    );
    assert.equal(result.settled, true);
    assert.equal(result.trialInstallCredits, 0);
    assert.equal(result.trialInstallExpiresAt, null);
    assert.equal(result.usedCredits, 0);
    assert.equal(result.lots.length, 1);
    assert.equal(result.lots[0]?.kind, "install");
    assert.equal(result.lots[0]?.consumed, 50_000);
    assert.equal(result.lots[0]?.leftover, 150_000);
  });

  it("when install gift is fully used, only peels gift off used and keeps paid usage", () => {
    const result = settleExpiredInstallTrialCredits(
      trialLots({
        trialInstallCredits: 200_000,
        trialInstallExpiresAt: expired,
        usedCredits: 250_000,
      }),
      now,
    );
    assert.equal(result.trialCredits, 0);
    assert.equal(result.usedCredits, 50_000);
    assert.equal(result.lots[0]?.consumed, 200_000);
    assert.equal(result.lots[0]?.leftover, 0);
  });

  it("zeros leftover unused basic first-pay trial", () => {
    const settled = settleExpiredInstallTrialCredits(
      trialLots({
        trialBonusCredits: 1_000_000,
        trialBonusExpiresAt: expired,
        usedCredits: 200_000,
      }),
      now,
    );
    assert.equal(settled.settled, true);
    assert.equal(settled.trialBonusCredits, 0);
    assert.equal(settled.usedCredits, 0);
    assert.equal(settled.lots[0]?.kind, "bonus");
    assert.equal(settled.lots[0]?.consumed, 200_000);
    assert.equal(settled.lots[0]?.leftover, 800_000);
  });

  it("subtracts fully consumed basic first-pay trial from used and keeps overflow", () => {
    const settled = settleExpiredInstallTrialCredits(
      trialLots({
        trialBonusCredits: 1_000_000,
        trialBonusExpiresAt: expired,
        usedCredits: 1_500_000,
      }),
      now,
    );
    assert.equal(settled.trialCredits, 0);
    assert.equal(settled.usedCredits, 500_000);
    assert.equal(settled.lots[0]?.consumed, 1_000_000);
  });

  it("expires only the due install lot and keeps a later bonus lot", () => {
    const result = settleExpiredInstallTrialCredits(
      trialLots({
        trialInstallCredits: 200_000,
        trialInstallExpiresAt: expired,
        trialBonusCredits: 1_000_000,
        trialBonusExpiresAt: future,
        usedCredits: 50_000,
      }),
      now,
    );
    assert.equal(result.settled, true);
    assert.equal(result.trialInstallCredits, 0);
    assert.equal(result.trialBonusCredits, 1_000_000);
    assert.equal(result.usedCredits, 0);
    assert.equal(result.lots.length, 1);
    assert.equal(result.lots[0]?.kind, "install");
    assert.equal(result.lots[0]?.consumed, 50_000);
  });

  it("expires only the due bonus lot without peeling install usage", () => {
    const result = settleExpiredInstallTrialCredits(
      trialLots({
        trialInstallCredits: 200_000,
        trialInstallExpiresAt: future,
        trialBonusCredits: 1_000_000,
        trialBonusExpiresAt: expired,
        usedCredits: 50_000,
      }),
      now,
    );
    assert.equal(result.trialInstallCredits, 200_000);
    assert.equal(result.trialBonusCredits, 0);
    assert.equal(result.usedCredits, 50_000);
    assert.equal(result.lots.length, 1);
    assert.equal(result.lots[0]?.kind, "bonus");
    assert.equal(result.lots[0]?.consumed, 0);
    assert.equal(result.lots[0]?.leftover, 1_000_000);
  });

  it("expires both lots in grant order and writes two lot results", () => {
    const result = settleExpiredInstallTrialCredits(
      trialLots({
        trialInstallCredits: 200_000,
        trialInstallExpiresAt: expired,
        trialBonusCredits: 1_000_000,
        trialBonusExpiresAt: laterExpired,
        usedCredits: 300_000,
      }),
      now,
    );
    assert.equal(result.trialCredits, 0);
    assert.equal(result.usedCredits, 0);
    assert.equal(result.lots.length, 2);
    assert.equal(result.lots[0]?.kind, "install");
    assert.equal(result.lots[0]?.consumed, 200_000);
    assert.equal(result.lots[1]?.kind, "bonus");
    assert.equal(result.lots[1]?.consumed, 100_000);
    assert.equal(result.lots[1]?.leftover, 900_000);
  });

  it("forceLots bonus revokes leftover before expiry and keeps install lot", () => {
    const result = settleExpiredInstallTrialCredits(
      trialLots({
        trialInstallCredits: 200_000,
        trialInstallExpiresAt: future,
        trialBonusCredits: 1_000_000,
        trialBonusExpiresAt: future,
        usedCredits: 50_000,
      }),
      now,
      { forceLots: ["bonus"] },
    );
    assert.equal(result.settled, true);
    assert.equal(result.trialInstallCredits, 200_000);
    assert.equal(result.trialBonusCredits, 0);
    assert.equal(result.usedCredits, 50_000);
    assert.equal(result.lots.length, 1);
    assert.equal(result.lots[0]?.kind, "bonus");
    assert.equal(result.lots[0]?.consumed, 0);
    assert.equal(result.lots[0]?.leftover, 1_000_000);
    assert.equal(result.lots[0]?.grantKind, "basic_first_pay_bonus_revoked");
  });

  it("forceLots bonus peels FIFO bonus usage and does not charge paid pools", () => {
    const result = settleExpiredInstallTrialCredits(
      trialLots({
        trialInstallCredits: 200_000,
        trialInstallExpiresAt: future,
        trialBonusCredits: 1_000_000,
        trialBonusExpiresAt: future,
        usedCredits: 300_000,
      }),
      now,
      { forceLots: ["bonus"] },
    );
    assert.equal(result.trialInstallCredits, 200_000);
    assert.equal(result.trialBonusCredits, 0);
    assert.equal(result.usedCredits, 200_000);
    assert.equal(result.lots[0]?.consumed, 100_000);
    assert.equal(result.lots[0]?.leftover, 900_000);
  });

  it("forceLots bonus still revokes when expiresAt is null", () => {
    const result = settleExpiredInstallTrialCredits(
      trialLots({
        trialBonusCredits: 1_000_000,
        usedCredits: 0,
      }),
      now,
      { forceLots: ["bonus"] },
    );
    assert.equal(result.settled, true);
    assert.equal(result.trialBonusCredits, 0);
    assert.equal(result.lots[0]?.grantKind, "basic_first_pay_bonus_revoked");
  });

  it("forceLots bonus is a no-op when bonus remaining is 0", () => {
    const result = settleExpiredInstallTrialCredits(
      trialLots({
        trialInstallCredits: 200_000,
        trialInstallExpiresAt: future,
        usedCredits: 10_000,
      }),
      now,
      { forceLots: ["bonus"] },
    );
    assert.equal(result.settled, false);
    assert.equal(result.trialInstallCredits, 200_000);
    assert.equal(result.usedCredits, 10_000);
  });
});

describe("earliestTrialLotExpiresAt", () => {
  const installAt = new Date("2026-08-01T00:00:00.000Z");
  const bonusAt = new Date("2026-09-01T00:00:00.000Z");

  it("returns the earlier remaining lot expiry", () => {
    const earliest = earliestTrialLotExpiresAt(
      200_000,
      installAt,
      1_000_000,
      bonusAt,
    );
    assert.equal(earliest?.toISOString(), installAt.toISOString());
  });

  it("ignores a lot with zero remaining or null expiry", () => {
    assert.equal(
      earliestTrialLotExpiresAt(0, installAt, 1_000_000, bonusAt)?.toISOString(),
      bonusAt.toISOString(),
    );
    assert.equal(
      earliestTrialLotExpiresAt(200_000, null, 1_000_000, bonusAt)?.toISOString(),
      bonusAt.toISOString(),
    );
    assert.equal(earliestTrialLotExpiresAt(0, null, 0, null), null);
  });
});
