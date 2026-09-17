import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyBackdate,
  earliestTrialLotExpiresAt,
  remainingCredits,
  settleExpiredInstallTrialCredits,
} from "./expireTrialCredits.mjs";

function trialLots(partial) {
  return {
    usedCredits: 0,
    trialInstallCredits: 0,
    trialInstallExpiresAt: null,
    trialBonusCredits: 0,
    trialBonusExpiresAt: null,
    ...partial,
  };
}

describe("settleExpiredInstallTrialCredits (script copy)", () => {
  const expired = new Date("2026-08-01T00:00:00.000Z");
  const now = new Date("2026-09-14T00:00:00.000Z");
  const future = new Date("2026-10-01T00:00:00.000Z");

  it("does not settle before expiry or when expiresAt is null", () => {
    assert.equal(
      settleExpiredInstallTrialCredits(
        trialLots({
          trialInstallCredits: 200_000,
          trialInstallExpiresAt: future,
          usedCredits: 50_000,
        }),
        now,
      ).settled,
      false,
    );
    assert.equal(
      settleExpiredInstallTrialCredits(
        trialLots({ trialBonusCredits: 1_000_000, usedCredits: 100 }),
        now,
      ).settled,
      false,
    );
  });

  it("clears leftover unused install gift and peels gift usage off used", () => {
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
    assert.equal(result.lots[0]?.leftover, 150_000);
    assert.equal(result.lots[0]?.consumed, 50_000);
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
    assert.equal(result.trialInstallCredits, 0);
    assert.equal(result.trialBonusCredits, 1_000_000);
    assert.equal(result.usedCredits, 0);
    assert.equal(result.lots.length, 1);
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
    assert.equal(result.lots[0]?.grantKind, "basic_first_pay_bonus_revoked");
  });
});

describe("earliestTrialLotExpiresAt / applyBackdate", () => {
  const installAt = new Date("2026-08-01T00:00:00.000Z");
  const bonusAt = new Date("2026-09-01T00:00:00.000Z");
  const past = new Date("2020-01-01T00:00:00.000Z");

  it("returns the earlier remaining lot expiry", () => {
    assert.equal(
      earliestTrialLotExpiresAt(200_000, installAt, 1_000_000, bonusAt)?.toISOString(),
      installAt.toISOString(),
    );
    assert.equal(earliestTrialLotExpiresAt(0, installAt, 0, bonusAt), null);
  });

  it("backdates install without touching bonus", () => {
    const next = applyBackdate(
      {
        trialInstallCredits: 200_000,
        trialInstallExpiresAt: bonusAt,
        trialBonusCredits: 1_000_000,
        trialBonusExpiresAt: bonusAt,
      },
      "install",
      past,
    );
    assert.equal(next.trialInstallExpiresAt.toISOString(), past.toISOString());
    assert.equal(next.trialBonusExpiresAt.toISOString(), bonusAt.toISOString());
    assert.equal(next.trialCreditsExpiresAt.toISOString(), past.toISOString());
  });
});

describe("remainingCredits", () => {
  it("is pools minus used, floored at 0", () => {
    assert.equal(
      remainingCredits({
        subscriptionCredits: 100,
        purchasedCredits: 50,
        trialCredits: 200,
        usedCredits: 80,
      }),
      270,
    );
    assert.equal(
      remainingCredits({
        subscriptionCredits: 0,
        purchasedCredits: 0,
        trialCredits: 10,
        usedCredits: 80,
      }),
      0,
    );
  });
});
