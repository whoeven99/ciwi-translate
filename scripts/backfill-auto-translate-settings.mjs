/**
 * 回填 ShopTranslationSettings.autoTranslateHour / autoTranslateModules。
 *
 * - hour null → 现有 hash 分槽小时（与 worker shopSlotIndex 一致）
 * - modules null → 当前 auto 默认可选 v2 模块集（不含 EMAIL / liquid）
 *
 * 用法:
 *   node scripts/backfill-auto-translate-settings.mjs
 *   node scripts/backfill-auto-translate-settings.mjs --write
 *   node scripts/backfill-auto-translate-settings.mjs --env=.env.test --write
 *   node scripts/backfill-auto-translate-settings.mjs --env=.env.prod --write --confirm-prod
 *   node scripts/backfill-auto-translate-settings.mjs --shop=xxx.myshopify.com --write
 */
import { createClient } from "@libsql/client/http";
import {
  loadStackedEnv,
  resolveTurso,
  assertProdWriteAllowed,
} from "./lib/loadEnv.mjs";

const DEFAULT_AUTO_V2_MODULES = [
  "products",
  "collection",
  "article",
  "blog_titles",
  "pages",
  "filters",
  "metaobjects",
  "metadata",
  "policies",
  "navigation",
  "shop",
  "theme",
  "delivery",
  "shipping",
];

function shopSlotIndex(shop, slotsPerDay = 24) {
  const slots = Math.max(1, Math.min(1440, Math.floor(slotsPerDay)));
  let hash = 0x811c9dc5;
  for (let i = 0; i < shop.length; i++) {
    hash ^= shop.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % slots;
}

function parseArgs(argv) {
  const out = {
    write: false,
    shop: null,
    envOverlay: ".env.test",
    limit: 0,
  };
  for (const a of argv) {
    if (a === "--write") out.write = true;
    else if (a === "--dry-run") out.write = false;
    else if (a.startsWith("--shop=")) out.shop = a.slice("--shop=".length).trim();
    else if (a.startsWith("--env=")) out.envOverlay = a.slice("--env=".length).trim();
    else if (a.startsWith("--limit="))
      out.limit = Math.max(0, Number(a.slice("--limit=".length)) || 0);
  }
  return out;
}

function maskShop(shop) {
  const s = String(shop || "");
  if (s.length <= 8) return "***";
  return `${s.slice(0, 4)}…${s.slice(-12)}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadStackedEnv(args.envOverlay);
  assertProdWriteAllowed(process.argv.slice(2), args.envOverlay);

  const turso = resolveTurso();
  if (!turso?.url) {
    console.error("Turso credentials missing (TURSO_DATABASE_URL / TURSO_AUTH_TOKEN)");
    process.exit(1);
  }

  const db = createClient({ url: turso.url, authToken: turso.authToken });
  const modulesJson = JSON.stringify(DEFAULT_AUTO_V2_MODULES);

  let sql = `SELECT shop, autoTranslateHour, autoTranslateModules
             FROM ShopTranslationSettings`;
  const binds = [];
  if (args.shop) {
    sql += ` WHERE shop = ?`;
    binds.push(args.shop);
  }
  sql += ` ORDER BY shop ASC`;
  if (args.limit > 0) sql += ` LIMIT ${args.limit}`;

  const rs = await db.execute({ sql, args: binds });
  let needHour = 0;
  let needModules = 0;
  let updated = 0;

  console.log(
    JSON.stringify(
      {
        mode: args.write ? "write" : "dry-run",
        env: args.envOverlay,
        rows: rs.rows.length,
        defaultModules: DEFAULT_AUTO_V2_MODULES.length,
      },
      null,
      2,
    ),
  );

  for (const row of rs.rows) {
    const shop = String(row.shop);
    const hourRaw = row.autoTranslateHour;
    const modulesRaw = row.autoTranslateModules;
    const hourMissing =
      hourRaw == null ||
      hourRaw === "" ||
      !Number.isInteger(Number(hourRaw)) ||
      Number(hourRaw) < 0 ||
      Number(hourRaw) > 23;
    const modulesMissing =
      modulesRaw == null ||
      modulesRaw === "" ||
      (typeof modulesRaw === "string" && modulesRaw.trim() === "null");

    if (!hourMissing && !modulesMissing) continue;

    const hour = hourMissing ? shopSlotIndex(shop) : Number(hourRaw);
    if (hourMissing) needHour++;
    if (modulesMissing) needModules++;

    console.log(
      `${maskShop(shop)} hour=${hourMissing ? `${hour}(fill)` : hour} modules=${modulesMissing ? "default" : "ok"}`,
    );

    if (!args.write) continue;

    await db.execute({
      sql: `UPDATE ShopTranslationSettings
            SET autoTranslateHour = COALESCE(autoTranslateHour, ?),
                autoTranslateModules = COALESCE(autoTranslateModules, ?),
                updatedAt = datetime('now')
            WHERE shop = ?`,
      args: [hour, modulesJson, shop],
    });
    updated++;
  }

  console.log(
    JSON.stringify(
      {
        needHour,
        needModules,
        updated,
        wrote: args.write,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
