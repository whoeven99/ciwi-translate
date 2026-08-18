/**
 * 阶段4：Redis `tsf:items_count:{shop}:{locale}` → Turso ShopTargetLocale.coverage*
 *
 * 连接策略：
 *   1. 启动时建立 N 条 Redis 长连接，全部跑完才关（中途不主动断开）
 *   2. Worker 从共享队列取 (shop,locale)，本连接 HGETALL → 立刻写 Turso
 *   3. 边读边同步；不是「先全量进内存再写」，也不是每 key 新建 TLS
 *   4. OSSCluster MOVED：本 key 直接跳过，不重试、不重连
 *
 * 用法:
 *   node scripts/backfill-locale-coverage-from-redis.mjs --write
 *   node scripts/backfill-locale-coverage-from-redis.mjs --write --only-missing
 *   node scripts/backfill-locale-coverage-from-redis.mjs --write --shop=0ipqef-0y.myshopify.com
 *   node scripts/backfill-locale-coverage-from-redis.mjs --write --workers=8
 *   node scripts/backfill-locale-coverage-from-redis.mjs --env=.env.test --write
 *
 * 前置：migration `20260730000000_shop_target_locale_coverage`
 *   （测试：`npm run turso:migrate:test` / 生产：`npm run turso:migrate:prod`）。
 *
 * 凭据：`--env=` 指向的文件；Turso 认 TURSO_DATABASE_URL / TURSO_AUTH_TOKEN
 * （兼容 TSF_TURSO_* / TURSO_TEST_* / TURSO_PROD_*）；
 * Redis 认同文件 REDIS_URL_V4 / REDIS_URL（测试一般为 sparkredistest）。
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client/http";
import Redis from "ioredis";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const COVERAGE_MODULES = new Set([
  "PRODUCT",
  "COLLECTION",
  "PAGE",
  "ARTICLE",
  "BLOG",
  "FILTER",
  "METAOBJECT",
  "METAFIELD",
  "DELIVERY_METHOD_DEFINITION",
  "SHOP",
  "MENU",
  "LINK",
  "EMAIL_TEMPLATE",
  "PACKING_SLIP_TEMPLATE",
  "ONLINE_STORE_THEME_JSON_TEMPLATE",
  "ONLINE_STORE_THEME_SECTION_GROUP",
  "ONLINE_STORE_THEME_SETTINGS_CATEGORY",
  "ONLINE_STORE_THEME_SETTINGS_DATA_SECTIONS",
  "ONLINE_STORE_THEME_LOCALE_CONTENT",
]);

const TSF_WEB_SERVICE = "srv-csp2931u0jms738sfmc0";

function parseArgs(argv) {
  const out = {
    write: false,
    onlyMissing: false,
    writeEmpty: false,
    shop: null,
    envPath: resolve(ROOT, ".env.prod"),
    limit: 0,
    workers: 4,
    verbose: false,
  };
  for (const a of argv) {
    if (a === "--write") out.write = true;
    else if (a === "--dry-run") out.write = false;
    else if (a === "--only-missing") out.onlyMissing = true;
    else if (a === "--write-empty") out.writeEmpty = true;
    else if (a === "--verbose" || a === "-v") out.verbose = true;
    else if (a.startsWith("--shop=")) out.shop = a.slice("--shop=".length).trim();
    else if (a.startsWith("--env=")) out.envPath = resolve(ROOT, a.slice("--env=".length));
    else if (a.startsWith("--limit="))
      out.limit = Math.max(0, Number(a.slice("--limit=".length)) || 0);
    else if (a.startsWith("--workers="))
      out.workers = Math.max(1, Number(a.slice("--workers=".length)) || 4);
    else if (a.startsWith("--redis-pool="))
      out.workers = Math.max(1, Number(a.slice("--redis-pool=".length)) || 4);
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function loadEnvFile(path) {
  const env = {};
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return env;
  }
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    env[t.slice(0, i).trim()] = v;
  }
  return env;
}

function pickTurso(env) {
  const candidates = [
    ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN"],
    ["TSF_TURSO_DATABASE_URL", "TSF_TURSO_AUTH_TOKEN"],
    ["TURSO_TEST_DATABASE_URL", "TURSO_TEST_AUTH_TOKEN"],
    ["TURSO_PROD_DATABASE_URL", "TURSO_PROD_AUTH_TOKEN"],
  ];
  for (const [urlKey, tokenKey] of candidates) {
    const url = env[urlKey]?.trim();
    const authToken = env[tokenKey]?.trim();
    if (url && authToken) return { url, authToken, urlKey };
  }
  return { url: undefined, authToken: undefined, urlKey: "TURSO_DATABASE_URL" };
}

async function resolveRedisUrl(env) {
  const local =
    env.REDIS_URL_V4?.trim() ||
    env.REDIS_URL?.trim() ||
    process.env.REDIS_URL_V4?.trim() ||
    process.env.REDIS_URL?.trim();
  if (local) return { url: local, source: "env" };

  const token = process.env.RENDER_API_KEY?.trim();
  if (!token) return { url: null, source: null };

  const res = await fetch(
    `https://api.render.com/v1/services/${TSF_WEB_SERVICE}/env-vars?limit=100`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    throw new Error(`Render env-vars ${res.status}: ${await res.text()}`);
  }
  const rows = await res.json();
  for (const row of rows) {
    if (row?.envVar?.key === "REDIS_URL_V4" && row.envVar.value) {
      return { url: String(row.envVar.value).trim(), source: "render:REDIS_URL_V4" };
    }
  }
  for (const row of rows) {
    if (row?.envVar?.key === "REDIS_URL" && row.envVar.value) {
      return { url: String(row.envVar.value).trim(), source: "render:REDIS_URL" };
    }
  }
  return { url: null, source: null };
}

function isMovedError(err) {
  return /\bMOVED\b/i.test(String(err?.message || err || ""));
}

function createRedis(url) {
  const client = new Redis(url, {
    maxRetriesPerRequest: 1,
    connectTimeout: 12_000,
    lazyConnect: true,
    enableOfflineQueue: false,
    keepAlive: 10_000,
    enableReadyCheck: true,
  });
  client.on("error", () => {});
  return client;
}

async function openRedis(url) {
  const client = createRedis(url);
  await client.connect();
  return client;
}

async function closeRedis(client) {
  if (!client) return;
  try {
    await client.quit();
  } catch {
    try {
      client.disconnect(false);
    } catch {
      /* ignore */
    }
  }
}

function aggregateCoverage(hash) {
  let translated = 0;
  let total = 0;
  let updatedAt = null;
  let saw = false;
  for (const [module, raw] of Object.entries(hash)) {
    if (!COVERAGE_MODULES.has(module)) continue;
    saw = true;
    try {
      const o = JSON.parse(raw);
      if (typeof o.translated === "number") translated += o.translated;
      if (typeof o.total === "number") total += o.total;
      if (
        typeof o.updatedAt === "string" &&
        o.updatedAt &&
        (!updatedAt || o.updatedAt > updatedAt)
      ) {
        updatedAt = o.updatedAt;
      }
    } catch {
      /* ignore */
    }
  }
  return {
    translated,
    total,
    updatedAt,
    empty: !saw || (translated === 0 && total === 0 && !updatedAt),
  };
}

function coveragePercentOf(translated, total) {
  if (total <= 0) return null;
  return Math.min(100, Math.round((translated / total) * 100));
}

function printHelp() {
  console.log(`Usage:
  node scripts/backfill-locale-coverage-from-redis.mjs [options]

  建连后保持长连接：队列取行 → HGETALL → 立刻写 Turso，全部结束才关连接。

Options:
  --dry-run           只统计，不写库（默认）
  --write             边读边写 Turso
  --only-missing      仅 coverageUpdatedAt 为空
  --write-empty       Redis 为空也写成 0
  --shop=<domain>
  --env=<path>        默认 .env.prod
  --limit=N
  --workers=N         长连接数=并发数（默认 4）
  --verbose / -v
`);
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const fileEnv = loadEnvFile(args.envPath);
const env = { ...fileEnv, ...process.env };
const turso = pickTurso(env);
if (!turso.url || !turso.authToken) {
  console.error("Missing Turso credentials in", args.envPath);
  process.exit(1);
}

const redisResolved = await resolveRedisUrl(env);
if (!redisResolved.url) {
  console.error(
    "Missing Redis URL（.env 的 REDIS_URL_V4/REDIS_URL，或设置 RENDER_API_KEY）",
  );
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      mode: args.write ? "WRITE" : "DRY_RUN",
      envPath: args.envPath,
      redisSource: redisResolved.source,
      redisHost: (() => {
        try {
          return new URL(redisResolved.url).host;
        } catch {
          return "(parse fail)";
        }
      })(),
      tursoHost: (() => {
        try {
          return new URL(turso.url).host;
        } catch {
          return "(parse fail)";
        }
      })(),
      shop: args.shop,
      onlyMissing: args.onlyMissing,
      writeEmpty: args.writeEmpty,
      workers: args.workers,
      limit: args.limit || null,
      strategy: "keep-alive: HGETALL → Turso; MOVED skip (no retry)",
    },
    null,
    2,
  ),
);

const db = createClient({ url: turso.url, authToken: turso.authToken });

try {
  await db.execute(
    "SELECT coverageTranslated, coverageTotal, coveragePercent, coverageUpdatedAt, coverageSource FROM ShopTargetLocale LIMIT 1",
  );
} catch (err) {
  console.error(
    "Turso 缺少 coverage* 列。请先执行 migration 20260730000000_shop_target_locale_coverage：",
    String(err.message || err),
  );
  process.exit(1);
}

let sql = `
  SELECT shop, locale, coverageTranslated, coverageTotal, coveragePercent, coverageUpdatedAt
  FROM ShopTargetLocale
`;
const sqlArgs = [];
if (args.shop) {
  sql += " WHERE shop = ?";
  sqlArgs.push(args.shop);
}
sql += " ORDER BY shop ASC, locale ASC";

const rs = await db.execute({ sql, args: sqlArgs });
let rows = rs.rows.map((r) => ({
  shop: String(r.shop ?? ""),
  locale: String(r.locale ?? ""),
  coverageUpdatedAt: r.coverageUpdatedAt ?? null,
  coverageTranslated: Number(r.coverageTranslated ?? 0) || 0,
  coverageTotal: Number(r.coverageTotal ?? 0) || 0,
}));

if (args.onlyMissing) {
  rows = rows.filter((r) => r.coverageUpdatedAt == null || r.coverageUpdatedAt === "");
}
if (args.limit > 0) {
  rows = rows.slice(0, args.limit);
}

console.log(`queue=${rows.length}`);

const stats = {
  ok: 0,
  written: 0,
  skippedEmpty: 0,
  skippedUnchanged: 0,
  skippedMoved: 0,
  redisError: 0,
  tursoError: 0,
};

let nextIndex = 0;
let processed = 0;
const t0 = Date.now();

function takeRow() {
  const i = nextIndex++;
  return i < rows.length ? rows[i] : null;
}

async function processOne(redis, workerId, row) {
  const key = `tsf:items_count:${row.shop}:${row.locale}`;

  let hash;
  try {
    hash = await redis.hgetall(key);
  } catch (err) {
    if (isMovedError(err)) {
      stats.skippedMoved++;
      if (args.verbose) {
        console.warn(`[MOVED-skip] w${workerId} ${row.shop} ${row.locale}`);
      }
      return;
    }
    stats.redisError++;
    if (args.verbose) {
      console.warn(`[redis] w${workerId} ${row.shop} ${row.locale}: ${err.message || err}`);
    }
    return;
  }

  const agg = aggregateCoverage(hash && typeof hash === "object" ? hash : {});
  if (agg.empty && !args.writeEmpty) {
    stats.skippedEmpty++;
    if (args.verbose) {
      console.log(`[skip-empty] w${workerId} ${row.shop} ${row.locale}`);
    }
    return;
  }

  const percent = coveragePercentOf(agg.translated, agg.total);
  const same =
    row.coverageTranslated === agg.translated &&
    row.coverageTotal === agg.total &&
    row.coverageUpdatedAt != null;
  if (same && !args.writeEmpty) {
    stats.skippedUnchanged++;
    stats.ok++;
    if (args.verbose) {
      console.log(
        `[unchanged] w${workerId} ${row.shop} ${row.locale} ${agg.translated}/${agg.total}`,
      );
    }
    return;
  }

  if (args.verbose) {
    console.log(
      `[${args.write ? "write" : "dry"}] w${workerId} ${row.shop} ${row.locale} ${agg.translated}/${agg.total}`,
    );
  }

  if (args.write) {
    try {
      await db.execute({
        sql: `
          UPDATE ShopTargetLocale SET
            coverageTranslated = ?,
            coverageTotal = ?,
            coveragePercent = ?,
            coverageUpdatedAt = datetime('now'),
            coverageSource = 'redis_backfill',
            updatedAt = datetime('now')
          WHERE shop = ? AND locale = ?
        `,
        args: [agg.translated, agg.total, percent, row.shop, row.locale],
      });
      stats.written++;
      stats.ok++;
    } catch (err) {
      stats.tursoError++;
      console.error(`[turso] ${row.shop} ${row.locale}:`, err.message || err);
    }
  } else {
    stats.ok++;
  }
}

console.log(
  `[redis] open ${args.workers} keep-alive connections; stream queue → HGETALL → Turso…`,
);

const clients = [];
for (let w = 0; w < args.workers; w++) {
  clients.push(await openRedis(redisResolved.url));
}
console.log(
  `[redis] ${clients.length} connections ready (MOVED → skip, no retry)`,
);

try {
  await Promise.all(
    clients.map(async (redis, workerId) => {
      while (true) {
        const row = takeRow();
        if (!row) break;
        await processOne(redis, workerId, row);
        processed++;
        if (processed % 100 === 0 || processed === rows.length) {
          console.log(
            `[progress] ${processed}/${rows.length} written=${stats.written} empty=${stats.skippedEmpty} movedSkip=${stats.skippedMoved} ${((Date.now() - t0) / 1000).toFixed(1)}s`,
          );
        }
      }
    }),
  );
} finally {
  console.log("[redis] closing connections…");
  await Promise.all(clients.map((c) => closeRedis(c)));
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log("\n=== summary ===");
console.log(JSON.stringify({ ...stats, elapsedSec: Number(elapsed) }, null, 2));
if (!args.write) {
  console.log("\nDry-run only. Re-run with --write to apply.");
}

process.exit(stats.tursoError > 0 || stats.redisError > 0 ? 2 : 0);
