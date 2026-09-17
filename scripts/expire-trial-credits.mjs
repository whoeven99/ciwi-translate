/**
 * 触发试用额度过期结算（与 Worker `expireInstallTrialJob` / `tsfDb.expireInstallTrialCreditsIfDue` 同口径）。
 *
 * 默认 dry-run，只打印 Account 分笔与将要结算的 leftover / used 变化。
 *
 * 用法：
 *   node scripts/expire-trial-credits.mjs --shop=xxx.myshopify.com
 *   node scripts/expire-trial-credits.mjs --shop=xxx --backdate=install
 *   node scripts/expire-trial-credits.mjs --shop=xxx --backdate=install --write
 *   node scripts/expire-trial-credits.mjs --shop=xxx --backdate=install --mark-due --write
 *   node scripts/expire-trial-credits.mjs --scan
 *   node scripts/expire-trial-credits.mjs --scan --write
 *   node scripts/expire-trial-credits.mjs --shop=xxx --env=.env.prod --write --confirm-prod
 *
 * `--backdate=install|bonus|both`：把对应笔当成已到期（默认 expiresAt=now-1s）。
 * `--write` 默认立刻结算（不必把过去时间写进库）。
 * `--mark-due --write`：只改 `*ExpiresAt`，留给 Worker 小时扫描去结算。
 * `--scan`：列出已到期店（Worker 同 SQL，默认最多 200），可加 `--write` 逐店结算。
 * `--backdate` 必须带 `--shop`（禁止全库改到期时间）。
 *
 * Turso：TURSO_DATABASE_URL / TURSO_AUTH_TOKEN（兼容旧键）。不打印密钥。
 * 写产须 `--env=.env.prod --confirm-prod`。
 */
import { randomUUID } from "node:crypto";
import { createClient } from "@libsql/client/http";
import {
  assertProdWriteAllowed,
  loadStackedEnv,
  resolveTurso,
} from "./lib/loadEnv.mjs";
import {
  applyBackdate,
  earliestTrialLotExpiresAt,
  parseDbDate,
  remainingCredits,
  settleExpiredInstallTrialCredits,
} from "./lib/expireTrialCredits.mjs";

const BACKDATE_LOTS = new Set(["install", "bonus", "both"]);
const ACCOUNT_SELECT = `SELECT shop, deletedAt,
       subscriptionCredits, purchasedCredits, trialCredits, usedCredits,
       trialInstallCredits, trialInstallExpiresAt,
       trialBonusCredits, trialBonusExpiresAt, trialCreditsExpiresAt
FROM Account WHERE shop = ? LIMIT 1`;

function parseArgs(argv) {
  const out = {
    write: false,
    scan: false,
    shop: "",
    envOverlay: ".env.test",
    backdate: "",
    markDue: false,
    expiresAt: "",
    limit: 200,
  };
  for (const a of argv) {
    if (a === "--write") out.write = true;
    else if (a === "--dry-run") out.write = false;
    else if (a === "--scan") out.scan = true;
    else if (a === "--mark-due") out.markDue = true;
    else if (a.startsWith("--shop=")) out.shop = a.slice("--shop=".length).trim();
    else if (a.startsWith("--env=")) out.envOverlay = a.slice("--env=".length).trim();
    else if (a.startsWith("--backdate=")) {
      out.backdate = a.slice("--backdate=".length).trim();
    } else if (a.startsWith("--expires-at=")) {
      out.expiresAt = a.slice("--expires-at=".length).trim();
    } else if (a.startsWith("--limit=")) {
      out.limit = Math.max(1, Math.min(2000, Number(a.slice("--limit=".length)) || 200));
    }
  }
  return out;
}

function usage() {
  return [
    "缺少 --shop 或 --scan。",
    "示例：",
    "  node scripts/expire-trial-credits.mjs --shop=xxx.myshopify.com",
    "  node scripts/expire-trial-credits.mjs --shop=xxx --backdate=install --write",
    "  node scripts/expire-trial-credits.mjs --shop=xxx --backdate=install --mark-due --write",
    "  node scripts/expire-trial-credits.mjs --scan",
  ].join("\n");
}

function snapshotAccount(row) {
  return {
    shop: String(row.shop ?? ""),
    deletedAt: row.deletedAt ?? null,
    subscriptionCredits: Number(row.subscriptionCredits ?? 0),
    purchasedCredits: Number(row.purchasedCredits ?? 0),
    trialCredits: Number(row.trialCredits ?? 0),
    usedCredits: Number(row.usedCredits ?? 0),
    trialInstallCredits: Number(row.trialInstallCredits ?? 0),
    trialInstallExpiresAt: parseDbDate(row.trialInstallExpiresAt),
    trialBonusCredits: Number(row.trialBonusCredits ?? 0),
    trialBonusExpiresAt: parseDbDate(row.trialBonusExpiresAt),
    trialCreditsExpiresAt: parseDbDate(row.trialCreditsExpiresAt),
  };
}

function publicAccount(account) {
  return {
    shop: account.shop,
    remaining: remainingCredits(account),
    subscriptionCredits: account.subscriptionCredits,
    purchasedCredits: account.purchasedCredits,
    trialCredits: account.trialCredits,
    usedCredits: account.usedCredits,
    trialInstallCredits: account.trialInstallCredits,
    trialInstallExpiresAt: account.trialInstallExpiresAt?.toISOString() ?? null,
    trialBonusCredits: account.trialBonusCredits,
    trialBonusExpiresAt: account.trialBonusExpiresAt?.toISOString() ?? null,
    trialCreditsExpiresAt: account.trialCreditsExpiresAt?.toISOString() ?? null,
  };
}

function settleHint(account, now) {
  const dueInstall =
    account.trialInstallCredits > 0 &&
    account.trialInstallExpiresAt &&
    now.getTime() >= account.trialInstallExpiresAt.getTime();
  const dueBonus =
    account.trialBonusCredits > 0 &&
    account.trialBonusExpiresAt &&
    now.getTime() >= account.trialBonusExpiresAt.getTime();
  if (dueInstall || dueBonus) return null;
  if (account.trialInstallCredits <= 0 && account.trialBonusCredits <= 0) {
    return "两笔试用剩余都是 0，结算会 no-op。";
  }
  if (!account.trialInstallExpiresAt && !account.trialBonusExpiresAt) {
    return "expiresAt 为空视为永不过期（Launch 存量）。用 --backdate=install|bonus|both 先改到期时间。";
  }
  return "尚未到期。用 --backdate=install|bonus|both 把对应笔改到过去后再 --write。";
}

function expireLogInsert(shop, lot, settled, nowIso) {
  return {
    sql: `INSERT INTO BillingLog (
            id, shop, eventType, planKey, referenceId, creditsDelta, usedCredits, metadata, createdAt
          )
          SELECT ?, ?, 'TRIAL_EXPIRED', NULL, ?, ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM Account
            WHERE shop = ?
              AND deletedAt IS NULL
              AND usedCredits = ?
              AND trialCredits = ?
              AND trialInstallCredits = ?
              AND trialBonusCredits = ?
          )
          AND NOT EXISTS (
            SELECT 1 FROM BillingLog
            WHERE shop = ? AND eventType = 'TRIAL_EXPIRED' AND referenceId = ?
          )`,
    args: [
      randomUUID(),
      shop,
      lot.referenceId,
      -lot.leftover,
      settled.usedCredits,
      JSON.stringify({
        grantKind: lot.grantKind,
        leftover: lot.leftover,
        consumed: lot.consumed,
        trialCreditsExpiresAt: lot.expiresAt,
        lot: lot.kind,
        source: "script",
      }),
      nowIso,
      shop,
      settled.usedCredits,
      settled.trialCredits,
      settled.trialInstallCredits,
      settled.trialBonusCredits,
      shop,
      lot.referenceId,
    ],
  };
}

function settleUpdateStatement(shop, before, settled, nowIso) {
  const legacyExpiresAt = earliestTrialLotExpiresAt(
    settled.trialInstallCredits,
    settled.trialInstallExpiresAt,
    settled.trialBonusCredits,
    settled.trialBonusExpiresAt,
  );
  return {
    sql: `UPDATE Account
          SET usedCredits = ?,
              trialCredits = ?,
              trialInstallCredits = ?,
              trialInstallExpiresAt = ?,
              trialBonusCredits = ?,
              trialBonusExpiresAt = ?,
              trialCreditsExpiresAt = ?,
              updatedAt = ?
          WHERE shop = ?
            AND deletedAt IS NULL
            AND usedCredits = ?
            AND trialInstallCredits = ?
            AND trialBonusCredits = ?`,
    args: [
      settled.usedCredits,
      settled.trialCredits,
      settled.trialInstallCredits,
      settled.trialInstallExpiresAt?.toISOString() ?? null,
      settled.trialBonusCredits,
      settled.trialBonusExpiresAt?.toISOString() ?? null,
      legacyExpiresAt?.toISOString() ?? null,
      nowIso,
      shop,
      before.usedCredits,
      before.trialInstallCredits,
      before.trialBonusCredits,
    ],
  };
}

async function loadExpiredLogs(db, shop) {
  const rs = await db.execute({
    sql: `SELECT referenceId, creditsDelta, createdAt
          FROM BillingLog
          WHERE shop = ? AND eventType = 'TRIAL_EXPIRED'
          ORDER BY createdAt ASC`,
    args: [shop],
  });
  return rs.rows.map((row) => ({
    referenceId: row.referenceId ?? null,
    creditsDelta: Number(row.creditsDelta ?? 0),
    createdAt: String(row.createdAt ?? ""),
  }));
}

async function loadAccount(db, shop) {
  const rs = await db.execute({ sql: ACCOUNT_SELECT, args: [shop] });
  const row = rs.rows[0];
  return row ? snapshotAccount(row) : null;
}

async function listDueShops(db, nowIso, limit) {
  const rs = await db.execute({
    sql: `SELECT shop FROM Account
          WHERE deletedAt IS NULL
            AND (
              (
                trialInstallCredits > 0
                AND trialInstallExpiresAt IS NOT NULL
                AND trialInstallExpiresAt <= ?
              )
              OR (
                trialBonusCredits > 0
                AND trialBonusExpiresAt IS NOT NULL
                AND trialBonusExpiresAt <= ?
              )
            )
          ORDER BY trialCreditsExpiresAt ASC
          LIMIT ?`,
    args: [nowIso, nowIso, limit],
  });
  return rs.rows.map((row) => String(row.shop ?? "")).filter(Boolean);
}

function planShop(account, now, backdateLot, backdateAt, markDue) {
  const afterBackdate = backdateLot
    ? { ...account, ...applyBackdate(account, backdateLot, backdateAt) }
    : account;
  const settled = settleExpiredInstallTrialCredits(afterBackdate, now);
  const afterSettle = {
    ...afterBackdate,
    trialCredits: settled.trialCredits,
    usedCredits: settled.usedCredits,
    trialInstallCredits: settled.trialInstallCredits,
    trialInstallExpiresAt: settled.trialInstallExpiresAt,
    trialBonusCredits: settled.trialBonusCredits,
    trialBonusExpiresAt: settled.trialBonusExpiresAt,
    trialCreditsExpiresAt: earliestTrialLotExpiresAt(
      settled.trialInstallCredits,
      settled.trialInstallExpiresAt,
      settled.trialBonusCredits,
      settled.trialBonusExpiresAt,
    ),
  };
  const after = markDue ? afterBackdate : afterSettle;
  return {
    shop: account.shop,
    mode: markDue ? "mark-due" : "settle",
    hint: markDue
      ? "只改到期时间，不结算。Worker 小时扫描或下次扣费/续费会结算。"
      : settled.settled
        ? null
        : settleHint(afterBackdate, now),
    backdate: backdateLot
      ? {
          lot: backdateLot,
          expiresAt: backdateAt.toISOString(),
        }
      : null,
    before: publicAccount(account),
    afterBackdate: backdateLot ? publicAccount(afterBackdate) : undefined,
    settled: markDue ? false : settled.settled,
    lots: markDue ? [] : settled.lots,
    after: publicAccount(after),
  };
}

function backdateUpdateStatement(account, next, nowIso) {
  return {
    sql: `UPDATE Account
          SET trialInstallExpiresAt = ?,
              trialBonusExpiresAt = ?,
              trialCreditsExpiresAt = ?,
              updatedAt = ?
          WHERE shop = ?
            AND deletedAt IS NULL
            AND usedCredits = ?
            AND trialInstallCredits = ?
            AND trialBonusCredits = ?`,
    args: [
      next.trialInstallExpiresAt?.toISOString() ?? null,
      next.trialBonusExpiresAt?.toISOString() ?? null,
      next.trialCreditsExpiresAt?.toISOString() ?? null,
      nowIso,
      account.shop,
      account.usedCredits,
      account.trialInstallCredits,
      account.trialBonusCredits,
    ],
  };
}

async function writeShop(db, account, now, opts) {
  const nowIso = now.toISOString();
  const current = opts.backdateLot
    ? { ...account, ...applyBackdate(account, opts.backdateLot, opts.backdateAt) }
    : account;

  if (opts.markDue) {
    if (!opts.backdateLot) {
      return { shop: account.shop, wrote: false, reason: "mark_due_needs_backdate" };
    }
    const res = await db.execute(backdateUpdateStatement(account, current, nowIso));
    return {
      shop: account.shop,
      wrote: Number(res.rowsAffected ?? 0) > 0,
      reason: Number(res.rowsAffected ?? 0) > 0 ? "marked_due" : "backdate_conflict",
    };
  }

  const settled = settleExpiredInstallTrialCredits(current, now);
  if (!settled.settled) {
    return {
      shop: account.shop,
      wrote: false,
      reason: "not_due",
      hint: settleHint(current, now),
    };
  }

  const results = await db.batch(
    [
      settleUpdateStatement(account.shop, account, settled, nowIso),
      ...settled.lots.map((lot) => expireLogInsert(account.shop, lot, settled, nowIso)),
    ],
    "write",
  );
  const updated = Number(results[0]?.rowsAffected ?? 0) > 0;
  return {
    shop: account.shop,
    wrote: updated,
    reason: updated ? "settled" : "settle_conflict",
    lots: settled.lots,
    logsInserted: results.slice(1).map((r) => Number(r.rowsAffected ?? 0)),
  };
}

const args = parseArgs(process.argv.slice(2));
if (!args.shop && !args.scan) {
  console.error(usage());
  process.exit(1);
}
if (args.backdate && !BACKDATE_LOTS.has(args.backdate)) {
  console.error("--backdate 必须是 install | bonus | both");
  process.exit(1);
}
if (args.backdate && !args.shop) {
  console.error("--backdate 必须带 --shop，禁止全库改到期时间。");
  process.exit(1);
}
if (args.markDue && !args.backdate) {
  console.error("--mark-due 必须带 --backdate=install|bonus|both。");
  process.exit(1);
}

const { env, overlay } = loadStackedEnv({
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
const now = new Date();
const backdateAt = args.expiresAt
  ? parseDbDate(args.expiresAt)
  : new Date(now.getTime() - 1000);
if (args.backdate && !backdateAt) {
  console.error("--expires-at 不是合法时间");
  process.exit(1);
}

try {
  console.log(
    JSON.stringify({
      overlay,
      write: args.write,
      markDue: args.markDue,
      tursoKey: turso.urlKey,
      now: now.toISOString(),
    }),
  );

  const shops = args.shop ? [args.shop] : await listDueShops(db, now.toISOString(), args.limit);
  if (!args.shop) {
    console.log(JSON.stringify({ scan: true, dueShops: shops.length, shops, truncated: shops.length >= args.limit }));
  }
  if (shops.length === 0) {
    console.log("没有到期店铺。");
    process.exit(0);
  }

  for (const shop of shops) {
    const account = await loadAccount(db, shop);
    if (!account) {
      console.log(JSON.stringify({ shop, error: "account_not_found" }));
      continue;
    }
    if (account.deletedAt) {
      console.log(JSON.stringify({ shop, error: "account_deleted" }));
      continue;
    }
    const expiredLogs = await loadExpiredLogs(db, shop);
    const plan = planShop(account, now, args.backdate || "", backdateAt, args.markDue);
    console.log(JSON.stringify({ ...plan, expiredLogs }, null, 2));

    if (!args.write) continue;
    const result = await writeShop(db, account, now, {
      backdateLot: args.backdate || "",
      backdateAt,
      markDue: args.markDue,
    });
    const after = await loadAccount(db, shop);
    console.log(
      JSON.stringify({
        writeResult: result,
        after: after ? publicAccount(after) : null,
      }, null, 2),
    );
  }

  if (!args.write) {
    console.log("dry-run；加 --write 才落库");
  }
} finally {
  db.close();
}
