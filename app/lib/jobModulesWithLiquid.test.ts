import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CUSTOM_LIQUID_MODULE,
  jobModulesWithLiquid,
} from "./jobModulesWithLiquid.ts";

describe("jobModulesWithLiquid", () => {
  it("returns shopify modules unchanged when includeLiquid is off", () => {
    assert.deepEqual(
      jobModulesWithLiquid({ modules: ["PRODUCT"], includeLiquid: false }),
      ["PRODUCT"],
    );
  });

  it("appends CUSTOM_LIQUID for liquid-only jobs", () => {
    assert.deepEqual(jobModulesWithLiquid({ modules: [], includeLiquid: true }), [
      CUSTOM_LIQUID_MODULE,
    ]);
  });

  it("does not duplicate CUSTOM_LIQUID", () => {
    assert.deepEqual(
      jobModulesWithLiquid({
        modules: ["PRODUCT", CUSTOM_LIQUID_MODULE],
        includeLiquid: true,
      }),
      ["PRODUCT", CUSTOM_LIQUID_MODULE],
    );
  });
});
