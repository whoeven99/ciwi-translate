import { createHash } from "node:crypto";

/** Stable digest for LiquidRule.beforeTranslation (hex sha256). */
export function liquidSourceDigest(beforeTranslation: string): string {
  return createHash("sha256")
    .update(String(beforeTranslation ?? ""), "utf8")
    .digest("hex");
}
