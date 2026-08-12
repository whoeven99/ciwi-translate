import { createHash } from "node:crypto";
import { tsfExecute, hasTsfDbCredentials } from "./tsfDb.js";
import { getRedis } from "./redisV4.js";
import type { TranslationV4Job } from "./cosmosV4.js";

/**
 * 采集侧「已知指纹集」= Turso 中非 DONE 的原文指纹镜像（App liquidCollect 写入）。
 * key 必须与 App `knownDigestKey` 完全一致：`tsf:auto_liquid:known:{shop}:{locale}`。
 */
function autoLiquidKnownKey(shop: string, locale: string): string {
  return `tsf:auto_liquid:known:${shop}:${locale}`;
}

/** 行转 DONE 后从已知集移除对应指纹（不等 TTL，保持 Redis ≈ Turso PENDING）。 */
async function sremAutoLiquidKnown(
  shop: string,
  locale: string,
  digest: string,
): Promise<void> {
  if (!shop || !locale || !digest) return;
  try {
    await getRedis().srem(autoLiquidKnownKey(shop, locale), digest);
  } catch {
    // 尽力而为：失败靠 App 侧已知集 TTL 自愈，不影响写回。
  }
}

/** Virtual module: Turso LiquidRule pipeline (not a Shopify resource type). */
export const CUSTOM_LIQUID_MODULE = "CUSTOM_LIQUID";

export type PendingLiquidRule = {
  id: string;
  beforeTranslation: string;
};

export function jobModulesWithLiquid(job: Pick<TranslationV4Job, "modules" | "includeLiquid">): string[] {
  const modules = Array.isArray(job.modules) ? [...job.modules] : [];
  if (job.includeLiquid && !modules.includes(CUSTOM_LIQUID_MODULE)) {
    modules.push(CUSTOM_LIQUID_MODULE);
  }
  return modules;
}

function digestOf(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function fieldDigest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32);
}

/**
 * Claim PENDING LiquidRule rows for this job → TRANSLATING + jobId.
 * Returns claimed rows for init blob writing.
 */
export async function claimPendingLiquidRules(args: {
  shop: string;
  languageCode: string;
  jobId: string;
  limit?: number;
}): Promise<PendingLiquidRule[]> {
  if (!hasTsfDbCredentials()) return [];
  const limit = Math.max(1, Math.min(args.limit ?? 5000, 20_000));

  const pending = await tsfExecute({
    sql: `SELECT id, beforeTranslation FROM LiquidRule
          WHERE shop = ? AND languageCode = ? AND status = 'PENDING'
          ORDER BY createdAt ASC
          LIMIT ?`,
    args: [args.shop, args.languageCode, limit],
  });

  const rows: PendingLiquidRule[] = pending.rows.map((r) => ({
    id: String(r.id),
    beforeTranslation: String(r.beforeTranslation ?? ""),
  })).filter((r) => r.id && r.beforeTranslation);

  if (!rows.length) return [];

  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");
  await tsfExecute({
    sql: `UPDATE LiquidRule
          SET status = 'TRANSLATING', jobId = ?, updatedAt = datetime('now')
          WHERE shop = ? AND status = 'PENDING' AND id IN (${placeholders})`,
    args: [args.jobId, args.shop, ...ids],
  });

  // Re-read claimed (another job may have raced; only keep our jobId)
  const claimed = await tsfExecute({
    sql: `SELECT id, beforeTranslation FROM LiquidRule
          WHERE shop = ? AND jobId = ? AND status = 'TRANSLATING'`,
    args: [args.shop, args.jobId],
  });
  return claimed.rows.map((r) => ({
    id: String(r.id),
    beforeTranslation: String(r.beforeTranslation ?? ""),
  })).filter((r) => r.id && r.beforeTranslation);
}

export function liquidRulesToInitChunk(rules: PendingLiquidRule[]): Array<{
  resourceId: string;
  fields: Array<{
    key: string;
    value: string;
    digest: string;
    shopifyType: string;
  }>;
}> {
  return rules.map((r) => ({
    resourceId: r.id,
    fields: [
      {
        key: "liquid",
        value: r.beforeTranslation,
        digest: fieldDigest(r.beforeTranslation),
        shopifyType: "SINGLE_LINE_TEXT_FIELD",
      },
    ],
  }));
}

/** Write translated value → DONE; clear jobId. */
export async function completeLiquidRuleWriteback(args: {
  shop: string;
  ruleId: string;
  afterTranslation: string;
  jobId: string;
}): Promise<boolean> {
  if (!hasTsfDbCredentials()) return false;
  const after = String(args.afterTranslation ?? "").trim();
  if (!after) return false;
  const res = await tsfExecute({
    sql: `UPDATE LiquidRule
          SET afterTranslation = ?, status = 'DONE', jobId = NULL, updatedAt = datetime('now')
          WHERE shop = ? AND id = ? AND (jobId = ? OR jobId IS NULL)`,
    args: [after, args.shop, args.ruleId, args.jobId],
  });
  const ok = (res.rowsAffected ?? 0) > 0;
  if (ok) {
    // 转 DONE：从采集「已知指纹集」移除，保持 Redis ≈ Turso PENDING。
    try {
      const row = await tsfExecute({
        sql: `SELECT languageCode, beforeTranslation, sourceDigest
              FROM LiquidRule WHERE shop = ? AND id = ?`,
        args: [args.shop, args.ruleId],
      });
      const r = row.rows[0];
      if (r) {
        const locale = String(r.languageCode ?? "");
        const digest =
          String(r.sourceDigest ?? "") ||
          digestOf(String(r.beforeTranslation ?? ""));
        await sremAutoLiquidKnown(args.shop, locale, digest);
      }
    } catch {
      // 非致命：已知集 TTL 会自愈
    }
  }
  return ok;
}

/** Release TRANSLATING rows for this job back to PENDING (cancel / failed / unused). */
export async function releaseLiquidRulesForJob(args: {
  shop: string;
  jobId: string;
}): Promise<number> {
  if (!hasTsfDbCredentials()) return 0;
  const res = await tsfExecute({
    sql: `UPDATE LiquidRule
          SET status = 'PENDING', jobId = NULL, updatedAt = datetime('now')
          WHERE shop = ? AND jobId = ? AND status = 'TRANSLATING'`,
    args: [args.shop, args.jobId],
  });
  return res.rowsAffected ?? 0;
}

/** Ensure sourceDigest column filled when inserting from worker (unused; collect is App-side). */
export function liquidSourceDigest(beforeTranslation: string): string {
  return digestOf(beforeTranslation);
}
