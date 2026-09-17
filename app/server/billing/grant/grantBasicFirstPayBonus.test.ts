import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BASIC_FIRST_PAY_EXPIRING_CREDITS,
  BASIC_FIRST_PAY_PERMANENT_CREDITS,
  isBasicPlanKey,
  isInTrialPeriod,
} from "./basicFirstPayBonus";

describe("basic first-pay bonus amounts", () => {
  it("grants only the 1M 30-day trial pack, not a never-expire purchased pack", () => {
    assert.equal(BASIC_FIRST_PAY_PERMANENT_CREDITS, 0);
    assert.equal(BASIC_FIRST_PAY_EXPIRING_CREDITS, 1_000_000);
  });
});

describe("isBasicPlanKey", () => {
  it("matches monthly and annual Basic keys", () => {
    assert.equal(isBasicPlanKey("basic-monthly"), true);
    assert.equal(isBasicPlanKey("Basic-Annual"), true);
  });

  it("does not match Pro or Premium", () => {
    assert.equal(isBasicPlanKey("pro-monthly"), false);
    assert.equal(isBasicPlanKey("premium-annual"), false);
  });
});

describe("isInTrialPeriod", () => {
  const now = new Date("2026-09-15T00:00:00.000Z");

  it("is true while trialEndsAt is in the future", () => {
    assert.equal(
      isInTrialPeriod(new Date("2026-09-20T00:00:00.000Z"), now),
      true,
    );
  });

  it("is false when trial has ended or was never set", () => {
    assert.equal(
      isInTrialPeriod(new Date("2026-09-10T00:00:00.000Z"), now),
      false,
    );
    assert.equal(isInTrialPeriod(null, now), false);
  });
});
