import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BONUS_GRANT_REF,
  INSTALL_GRANT_REF,
  planTrialCreditLotBackfill,
} from "./trialCreditLots.mjs";

function account(partial) {
  return {
    trialCredits: 0,
    trialInstallCredits: 0,
    trialInstallExpiresAt: null,
    trialBonusCredits: 0,
    trialBonusExpiresAt: null,
    trialCreditsExpiresAt: null,
    ...partial,
  };
}

describe("planTrialCreditLotBackfill", () => {
  const expires = "2026-10-16T08:22:06.000Z";

  it("skips empty trial", () => {
    assert.equal(planTrialCreditLotBackfill(account({}), []), null);
  });

  it("fills missing lots onto install when there is no bonus grant", () => {
    const planned = planTrialCreditLotBackfill(
      account({ trialCredits: 200_000, trialCreditsExpiresAt: expires }),
      [INSTALL_GRANT_REF],
    );
    assert.equal(planned?.reason, "install_lot");
    assert.equal(planned?.trialInstallCredits, 200_000);
    assert.equal(planned?.trialInstallExpiresAt, expires);
    assert.equal(planned?.trialBonusCredits, 0);
    assert.equal(planned?.trialBonusExpiresAt, null);
  });

  it("keeps launch credits on the install lot with null expiry", () => {
    const planned = planTrialCreditLotBackfill(
      account({ trialCredits: 4_000_000 }),
      ["launch_credits"],
    );
    assert.equal(planned?.reason, "install_lot");
    assert.equal(planned?.trialInstallCredits, 4_000_000);
    assert.equal(planned?.trialInstallExpiresAt, null);
    assert.equal(planned?.trialCreditsExpiresAt, null);
  });

  it("fills missing lots onto bonus when only bonus was granted", () => {
    const planned = planTrialCreditLotBackfill(
      account({ trialCredits: 1_000_000, trialCreditsExpiresAt: expires }),
      [BONUS_GRANT_REF],
    );
    assert.equal(planned?.reason, "bonus_lot");
    assert.equal(planned?.trialBonusCredits, 1_000_000);
    assert.equal(planned?.trialInstallCredits, 0);
  });

  it("splits unused mixed remaining 1.2M into 200k + 1M", () => {
    const planned = planTrialCreditLotBackfill(
      account({ trialCredits: 1_200_000, trialCreditsExpiresAt: expires }),
      [INSTALL_GRANT_REF, BONUS_GRANT_REF],
    );
    assert.equal(planned?.reason, "split_mixed");
    assert.equal(planned?.trialInstallCredits, 200_000);
    assert.equal(planned?.trialBonusCredits, 1_000_000);
    assert.equal(planned?.trialInstallExpiresAt, expires);
    assert.equal(planned?.trialBonusExpiresAt, expires);
  });

  it("attributes FIFO usage to install when splitting mixed remaining", () => {
    const planned = planTrialCreditLotBackfill(
      account({
        trialCredits: 1_150_000,
        trialBonusCredits: 1_150_000,
        trialBonusExpiresAt: expires,
        trialCreditsExpiresAt: expires,
      }),
      [INSTALL_GRANT_REF, BONUS_GRANT_REF],
    );
    assert.equal(planned?.reason, "split_mixed");
    assert.equal(planned?.trialInstallCredits, 150_000);
    assert.equal(planned?.trialBonusCredits, 1_000_000);
  });

  it("puts leftover only on bonus after install was fully used", () => {
    const planned = planTrialCreditLotBackfill(
      account({ trialCredits: 1_000_000, trialCreditsExpiresAt: expires }),
      [INSTALL_GRANT_REF, BONUS_GRANT_REF],
    );
    assert.equal(planned?.reason, "split_mixed");
    assert.equal(planned?.trialInstallCredits, 0);
    assert.equal(planned?.trialInstallExpiresAt, null);
    assert.equal(planned?.trialBonusCredits, 1_000_000);
    assert.equal(planned?.trialBonusExpiresAt, expires);
  });

  it("skips shops whose lots already add up", () => {
    assert.equal(
      planTrialCreditLotBackfill(
        account({
          trialCredits: 1_200_000,
          trialInstallCredits: 200_000,
          trialInstallExpiresAt: expires,
          trialBonusCredits: 1_000_000,
          trialBonusExpiresAt: expires,
          trialCreditsExpiresAt: expires,
        }),
        [INSTALL_GRANT_REF, BONUS_GRANT_REF],
      ),
      null,
    );
  });

  it("skips inconsistent lot sums instead of guessing", () => {
    assert.equal(
      planTrialCreditLotBackfill(
        account({
          trialCredits: 1_000_000,
          trialInstallCredits: 100_000,
          trialBonusCredits: 100_000,
        }),
        [INSTALL_GRANT_REF, BONUS_GRANT_REF],
      ),
      null,
    );
  });

  it("only-missing skips already filled mixed-unbalanced rows", () => {
    assert.equal(
      planTrialCreditLotBackfill(
        account({
          trialCredits: 1_200_000,
          trialBonusCredits: 1_200_000,
          trialBonusExpiresAt: expires,
          trialCreditsExpiresAt: expires,
        }),
        [INSTALL_GRANT_REF, BONUS_GRANT_REF],
        { onlyMissing: true },
      ),
      null,
    );
  });
});
