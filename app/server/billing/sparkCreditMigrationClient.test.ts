import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSparkCreditMigrationEnabled } from "./sparkCreditMigrationClient.server";

describe("isSparkCreditMigrationEnabled", () => {
  it("defaults to off when unset or blank", () => {
    assert.equal(isSparkCreditMigrationEnabled({}), false);
    assert.equal(
      isSparkCreditMigrationEnabled({ SPARK_CREDIT_MIGRATION_ENABLED: "  " }),
      false,
    );
  });

  it("turns on only for true/1/on/yes", () => {
    assert.equal(
      isSparkCreditMigrationEnabled({ SPARK_CREDIT_MIGRATION_ENABLED: "true" }),
      true,
    );
    assert.equal(
      isSparkCreditMigrationEnabled({ SPARK_CREDIT_MIGRATION_ENABLED: "1" }),
      true,
    );
    assert.equal(
      isSparkCreditMigrationEnabled({ SPARK_CREDIT_MIGRATION_ENABLED: "ON" }),
      true,
    );
    assert.equal(
      isSparkCreditMigrationEnabled({ SPARK_CREDIT_MIGRATION_ENABLED: "yes" }),
      true,
    );
  });

  it("stays off for false and unknown values", () => {
    assert.equal(
      isSparkCreditMigrationEnabled({ SPARK_CREDIT_MIGRATION_ENABLED: "false" }),
      false,
    );
    assert.equal(
      isSparkCreditMigrationEnabled({ SPARK_CREDIT_MIGRATION_ENABLED: "maybe" }),
      false,
    );
  });
});
