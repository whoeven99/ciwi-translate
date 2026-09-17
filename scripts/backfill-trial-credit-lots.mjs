/**
 * 存量试用额度拆回安装笔 / 首订笔。
 *
 * 默认 dry-run。迁移 `20260916000000_account_trial_credit_lots` 已做粗分；
 * 本脚本补漏（两笔都是 0 但仍有 trialCredits），并把「两笔都发过、剩余全记在一笔」
 * 按 FIFO 再拆（安装 20 万先耗）。
 *
 * 用法：
 *   node scripts/backfill-trial-credit-lots.mjs
 *   node scripts/backfill-trial-credit-lots.mjs --env=.env.test --write
 *   node scripts/backfill-trial-credit-lots.mjs --shop=xxx.myshopify.com --write
 *   node scripts/backfill-trial-credit-lots.mjs --only-missing --write
 *   node scripts/backfill-trial-credit-lots.mjs --env=.env.prod --write --confirm-prod
 *
 * Turso：TURSO_DATABASE_URL / TURSO_AUTH_TOKEN（兼容旧键）。不打印密钥。
 */
import { createClient } from "@libsql/client/http";
import {
  assertProdWriteAllowed,
  loadStackedEnv,
  resolveTurso,
} from "./lib/loadEnv.mjs";
import {
  BONUS_GRANT_REF,
  INSTALL_GRANT_REF,
  LAUNCH_GRANT_REF,
  planTrialCreditLotBackfill,
} from "./lib/trialCreditLots.mjs";

function parseArgs(argv) {
  const out = {
    write: false,
    onlyMissing: false,
    shop: "",
    envOverlay: ".env.test",
    limit: 0,
  };
  for (const a of argv) {
    if (a === "--write") out.write = true;
    else if (a === "--dry-run") out.write = false;
    else if (a === "--only-missing") out.onlyMissing = true;
    else if (a.startsWith("--shop=")) out.shop = a.slice("--shop=".length).trim();
    else if (a.startsWith("--env=")) out.envOverlay = a.slice("--env=".length).trim();
    else if (a.startsWith("--limit=")) {
      out.limit = Math.max(0, Number(a.slice("--limit=".length)) || 0);
    }
  }
  return out;
}

function isoOrNull(raw) {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw.toISOString();
  const parsed = new Date(String(raw));
  return Number.isNaN(parsed.getTime()) ? String(raw) : parsed.toISOString();
}

const args = parseArgs(process.argv.slice(2));
const { env, overlay, files } = loadStackedEnv({
  overlay: args.envOverlay,
  applyToProcess: true,
});
if (args.write) assertProdWriteAllowed(process.argv.slice(2), overlay);

const turso = resolveTurso(env);
if (!turso.url || !turso.authToken) {
  console.error("缺少 TURSO_DATABASE_URL / TURSO_AUTH_TOKEN");
  process.exit(1);
}

const db = createClient({ url: turso.url, authToken: turso.authToken });
const nowIso = new Date().toISOString();

const accountSql = args.shop
  ? `SELECT shop, trialCredits, trialInstallCredits, trialInstallExpiresAt,
            trialBonusCredits, trialBonusExpiresAt, trialCreditsExpiresAt
     FROM Account WHERE deletedAt IS NULL AND trialCredits > 0 AND shop = ?`
  : `SELECT shop, trialCredits, trialInstallCredits, trialInstallExpiresAt,
            trialBonusCredits, trialBonusExpiresAt, trialCreditsExpiresAt
     FROM Account WHERE deletedAt IS NULL AND trialCredits > 0`;
let accounts;
try {
  accounts = await db.execute({
    sql: accountSql,
    args: args.shop ? [args.shop] : [],
  });
} catch (err) {
  const msg = String(err?.message || err);
  if (/no such column: trialInstallCredits/i.test(msg)) {
    console.error(
      "Account 还没有分笔列。请先跑 npm run turso:migrate:test（写产则 turso:migrate:prod）。",
    );
    process.exit(1);
  }
  throw err;
}

const shops = accounts.rows.map((row) => String(row.shop ?? "")).filter(Boolean);
const GRANT_CHUNK = 200;
const grantMap = new Map();
for (let i = 0; i < shops.length; i += GRANT_CHUNK) {
  const chunk = shops.slice(i, i + GRANT_CHUNK);
  const placeholders = chunk.map(() => "?").join(",");
  const grants = await db.execute({
    sql: `SELECT shop, referenceId FROM BillingLog
          WHERE eventType = 'TRIAL_GRANTED'
            AND referenceId IN (?, ?, ?)
            AND shop IN (${placeholders})`,
    args: [INSTALL_GRANT_REF, BONUS_GRANT_REF, LAUNCH_GRANT_REF, ...chunk],
  });
  for (const row of grants.rows) {
    const shop = String(row.shop ?? "");
    const ref = String(row.referenceId ?? "");
    if (!shop || !ref) continue;
    const set = grantMap.get(shop) ?? new Set();
    set.add(ref);
    grantMap.set(shop, set);
  }
}

const planned = [];
for (const row of accounts.rows) {
  const shop = String(row.shop ?? "");
  if (!shop) continue;
  const current = {
    trialCredits: Number(row.trialCredits ?? 0),
    trialInstallCredits: Number(row.trialInstallCredits ?? 0),
    trialInstallExpiresAt: isoOrNull(row.trialInstallExpiresAt),
    trialBonusCredits: Number(row.trialBonusCredits ?? 0),
    trialBonusExpiresAt: isoOrNull(row.trialBonusExpiresAt),
    trialCreditsExpiresAt: isoOrNull(row.trialCreditsExpiresAt),
  };
  const next = planTrialCreditLotBackfill(current, grantMap.get(shop) ?? new Set(), {
    onlyMissing: args.onlyMissing,
  });
  if (!next) continue;
  planned.push({ shop, current, next });
}

const selected = args.limit > 0 ? planned.slice(0, args.limit) : planned;
const byReason = { install_lot: 0, bonus_lot: 0, split_mixed: 0 };
for (const row of selected) byReason[row.next.reason] += 1;

console.log(
  JSON.stringify({
    overlay,
    envFiles: files.map((f) => f.replace(/\\/g, "/").split("/").pop()),
    write: args.write,
    onlyMissing: args.onlyMissing,
    shop: args.shop || null,
    scanned: accounts.rows.length,
    planned: planned.length,
    selected: selected.length,
    byReason,
  }),
);

for (const row of selected) {
  console.log(
    `${row.shop} ${row.next.reason} trial=${row.current.trialCredits} ` +
      `install ${row.current.trialInstallCredits}->${row.next.trialInstallCredits} ` +
      `bonus ${row.current.trialBonusCredits}->${row.next.trialBonusCredits}`,
  );
}

if (!args.write) {
  console.log("dry-run；加 --write 才落库");
  process.exit(0);
}

let updated = 0;
let skipped = 0;
for (const row of selected) {
  const res = await db.execute({
    sql: `UPDATE Account
          SET trialInstallCredits = ?,
              trialInstallExpiresAt = ?,
              trialBonusCredits = ?,
              trialBonusExpiresAt = ?,
              trialCreditsExpiresAt = ?,
              updatedAt = ?
          WHERE shop = ?
            AND deletedAt IS NULL
            AND trialCredits = ?
            AND trialInstallCredits = ?
            AND trialBonusCredits = ?`,
    args: [
      row.next.trialInstallCredits,
      row.next.trialInstallExpiresAt,
      row.next.trialBonusCredits,
      row.next.trialBonusExpiresAt,
      row.next.trialCreditsExpiresAt,
      nowIso,
      row.shop,
      row.current.trialCredits,
      row.current.trialInstallCredits,
      row.current.trialBonusCredits,
    ],
  });
  if (Number(res.rowsAffected ?? 0) > 0) updated += 1;
  else skipped += 1;
}

console.log(JSON.stringify({ updated, skipped }));
