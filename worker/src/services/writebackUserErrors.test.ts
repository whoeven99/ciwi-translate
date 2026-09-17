import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  areAllUserErrorsBenign,
  isBenignWritebackUserError,
  isTooManyTranslationKeysMessage,
  isValueLengthValidationMessage,
  reconcileBenignWritebackFailures,
  shouldTreatWritebackFailuresAsBenign,
} from "./writebackUserErrors.js";

describe("writebackUserErrors", () => {
  it("detects too many translation keys", () => {
    assert.equal(
      isTooManyTranslationKeysMessage("Too many translation keys for this resource"),
      true,
    );
    assert.equal(isTooManyTranslationKeysMessage("too_many_keys"), true);
  });

  it("detects value length validation", () => {
    assert.equal(
      isValueLengthValidationMessage(
        'Value fails validation on resource: ["Value has a maximum length of 20."]',
      ),
      true,
    );
    assert.equal(
      isValueLengthValidationMessage(
        'Value fails validation on resource: ["Value has a minimum length of 3."]',
      ),
      true,
    );
    assert.equal(
      isValueLengthValidationMessage("Value fails validation on resource: invalid enum"),
      false,
    );
  });

  it("treats only all-benign userErrors as benign resource", () => {
    const lengthOnly = [
      {
        field: ["translations", "0", "value"],
        message:
          'Value fails validation on resource: ["Value has a maximum length of 20."]',
      },
    ];
    assert.equal(areAllUserErrorsBenign(lengthOnly), true);
    assert.equal(
      areAllUserErrorsBenign([
        ...lengthOnly,
        { field: "digest", message: "Digest mismatch" },
      ]),
      false,
    );
    assert.equal(areAllUserErrorsBenign([]), false);
  });

  it("reconciles metrics when all failed resources are benign", () => {
    const failedResources = [
      {
        resourceId: "gid://shopify/Metafield/1",
        userErrors: [
          {
            field: ["translations", "0", "value"],
            message:
              'Value fails validation on resource: ["Value has a maximum length of 20."]',
          },
        ],
      },
      {
        resourceId: "gid://shopify/Metafield/2",
        userErrors: [
          {
            field: ["translations", "0", "value"],
            message:
              'Value fails validation on resource: ["Value has a maximum length of 20."]',
          },
        ],
      },
    ];
    assert.equal(shouldTreatWritebackFailuresAsBenign(2, failedResources), true);
    assert.deepEqual(
      reconcileBenignWritebackFailures(0, 2, failedResources),
      { writebackDone: 2, writebackFailed: 0, reconciled: true },
    );
  });

  it("does not reconcile mixed or missing userErrors", () => {
    assert.equal(
      shouldTreatWritebackFailuresAsBenign(1, [
        { resourceId: "a", userErrors: [{ field: "", message: "Digest mismatch" }] },
      ]),
      false,
    );
    assert.equal(
      shouldTreatWritebackFailuresAsBenign(1, [{ resourceId: "a" }]),
      false,
    );
    assert.equal(isBenignWritebackUserError("Digest mismatch"), false);
  });
});
