import { createHmac } from "node:crypto";

export const CREDIT_MIGRATION_TIMESTAMP_HEADER = "X-Credit-Migration-Timestamp";
export const CREDIT_MIGRATION_SIGNATURE_HEADER = "X-Credit-Migration-Signature";

/** 与 Spark `creditMigrationHmac.server.ts` 保持同一算法。 */
export function signCreditMigrationBody(
  secret: string,
  timestamp: string,
  rawBody: string,
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");
}
