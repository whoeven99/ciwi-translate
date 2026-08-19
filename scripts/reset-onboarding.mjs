/**
 * 把「指定 shop」重置为可重新看到首次翻译新手引导（onboarding）的状态。
 *
 * 作用范围（默认）：
 *   1) Turso  ShopOnboarding           —— 删除该店行（status 回到 not_started）
 *   2) Cosmos translation_v4_jobs      —— 删除该店全部 v4 任务（否则入口判定为老用户）
 *   3) Turso  TranslateV4JobUsage      —— 删除该店任务用量快照
 *   4) Turso  ShopTargetLocale         —— 删除该店全部语言行（覆盖率 + 自动翻译开关）
 *   5) Turso  ShopTranslationSettings  —— 删除该店翻译配置（源语言 / targets / 总开关）
 *   6) Redis  tsf:items_count:{shop}:{locale} —— 按 Turso 该店 locale 列表直接 DEL
 *      （仅 RENDER_KV；不用 KEYS/SCAN 全库扫）
 *   7) Cosmos shop_scan_jobs           —— 删除该店全部 shop scan（否则 install 因
 *      hasActiveOrCompletedShopScan 命中历史 COMPLETED 被 skipped_existing，覆盖率不会重扫）
 *
 * 附加（--billing，更彻底，让 isNew=true / 恢复试用资格）：
 *   8) Turso  AccountPeriodUsage / BillingLog / AppSubscription / Account
 *
 * 安全设计：
 *   - 默认 dry-run，只打印将删除的条数，不落库；加 --write 才真正执行。
 *   - 必须显式 --shop，且所有操作都 WHERE shop = <shop> / partitionKey=<shop>。
 *   - 不打印任何密钥；只打印脱敏 host。
 *   - 不删 Blob `shop-profile/{shop}/latest-scan.json`（install 重扫会覆写计量段）。
 *
 * 用法：
 *   node scripts/reset-onboarding.mjs --shop=xxx.myshopify.com               （dry-run，默认测环境）
 *   node scripts/reset-onboarding.mjs --shop=xxx --env=.env.test --write
 *   node scripts/reset-onboarding.mjs --shop=xxx --env=.env.prod --write --confirm-prod
 *   node scripts/reset-onboarding.mjs --shop=xxx --env=.env.test --write --billing
 *
 * Turso 凭据：TURSO_DATABASE_URL / TURSO_AUTH_TOKEN（兼容旧键）
 * 默认叠测环境；写产须 --env=.env.prod --confirm-prod
 *
 * 依赖：@libsql/client、@azure/cosmos、ioredis（仓库已装）。
 */
import { createClient } from "@libsql/client";
import { CosmosClient } from "@azure/cosmos";
import Redis from "ioredis";
import {
  assertProdWriteAllowed,
  loadStackedEnv,
  resolveCosmos,
  resolveRedisUrl,
  resolveTurso,
} from "./lib/loadEnv.mjs";

// ---------- 参数解析 ----------
function parseArgs(argv) {
  const args = { _: [] };
  for (const raw of argv) {
    if (!raw.startsWith("--")) {
      args._.push(raw);
      continue;
    }
    const body = raw.slice(2);
    const eq = body.indexOf("=");
    if (eq === -1) args[body] = true;
    else args[body.slice(0, eq)] = body.slice(eq + 1);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const shop = String(args.shop || "").trim();
const write = Boolean(args.write);
const includeBilling = Boolean(args.billing);
const envOverlay = String(args.env || ".env.test").trim();

if (!shop) {
  console.error(
    "缺少 --shop。示例：node scripts/reset-onboarding.mjs --shop=xxx.myshopify.com --env=.env.test",
  );
  process.exit(1);
}

const { env, overlay } = loadStackedEnv({
  overlay: envOverlay,
  applyToProcess: true,
});
if (write) {
  assertProdWriteAllowed(process.argv.slice(2), overlay);
}

function maskHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return "(invalid-url)";
  }
}

const tursoResolved = resolveTurso(env);
if (!tursoResolved.url || !tursoResolved.authToken) {
  console.error(
    `缺少 Turso 凭据。请在 ${envOverlay} 配置 TURSO_DATABASE_URL / TURSO_AUTH_TOKEN。`,
  );
  process.exit(1);
}

const tursoUrl = tursoResolved.url;
const tursoToken = tursoResolved.authToken;
const usedUrlKey = tursoResolved.urlKey;
const turso = createClient({ url: tursoUrl, authToken: tursoToken });

// ---------- Cosmos（v4 jobs + shop_scan_jobs，同 endpoint/key/db）----------
const cosmosResolved = resolveCosmos(env);
const cosmosEndpoint = cosmosResolved.endpoint || "";
const cosmosKey = cosmosResolved.key || "";
const cosmosDbId = cosmosResolved.databaseId;
const cosmosJobsContainerId = cosmosResolved.containerId;
const cosmosShopScanContainerId = (
  env.COSMOS_SHOP_SCAN_CONTAINER || "shop_scan_jobs"
).trim();

let cosmosJobsContainer = null;
let cosmosShopScanContainer = null;
if (cosmosEndpoint && cosmosKey) {
  const cosmosDb = new CosmosClient({
    endpoint: cosmosEndpoint,
    key: cosmosKey,
  }).database(cosmosDbId);
  cosmosJobsContainer = cosmosDb.container(cosmosJobsContainerId);
  cosmosShopScanContainer = cosmosDb.container(cosmosShopScanContainerId);
}

// ---------- Redis（覆盖率明细：仅 RENDER_KV；不再连 REDIS_URL / REDIS_URL_V4）----------
function redisLabel(url, key) {
  if (!url) return null;
  return { key, host: maskHost(url) };
}

const redisTargets = [];
const { url: renderKvUrl, source: redisSource } = resolveRedisUrl(env);
if (renderKvUrl) {
  redisTargets.push({ key: redisSource || "RENDER_KV", url: renderKvUrl });
}

// ---------- 执行 ----------
const MODE = write ? "WRITE" : "DRY-RUN";
console.log("===== reset-onboarding =====");
console.log(
  JSON.stringify(
    {
      mode: MODE,
      shop,
      env: overlay,
      tursoKey: usedUrlKey,
      tursoHost: maskHost(tursoUrl),
      cosmosJobs: cosmosJobsContainer
        ? `${cosmosDbId}/${cosmosJobsContainerId}`
        : "(未配置 COSMOS，跳过 v4 任务删除)",
      cosmosShopScan: cosmosShopScanContainer
        ? `${cosmosDbId}/${cosmosShopScanContainerId}`
        : "(未配置 COSMOS，跳过 shop_scan 删除)",
      redis: redisTargets.length
        ? redisTargets.map((r) => redisLabel(r.url, r.key))
        : "(未配置 RENDER_KV，跳过 items_count)",
      includeBilling,
    },
    null,
    2,
  ),
);

async function tursoCount(table) {
  try {
    const rs = await turso.execute({
      sql: `SELECT COUNT(*) AS n FROM "${table}" WHERE shop = ?`,
      args: [shop],
    });
    return Number(rs.rows?.[0]?.n ?? 0);
  } catch (err) {
    console.warn(`  [warn] 统计 ${table} 失败：${err?.message || err}`);
    return 0;
  }
}

async function tursoDelete(table) {
  const before = await tursoCount(table);
  if (!write) {
    console.log(`  [dry] Turso ${table}: 将删除 ${before} 行`);
    return;
  }
  try {
    await turso.execute({
      sql: `DELETE FROM "${table}" WHERE shop = ?`,
      args: [shop],
    });
    console.log(`  [ok ] Turso ${table}: 已删除 ${before} 行`);
  } catch (err) {
    console.error(`  [err] Turso ${table} 删除失败：${err?.message || err}`);
  }
}

/** 在删表前收集该店 locale，供 Redis 按 key 精确 DEL（避免 SCAN 全库）。 */
async function listLocalesForItemsCount() {
  const locales = new Set();
  try {
    const rs = await turso.execute({
      sql: `SELECT locale FROM "ShopTargetLocale" WHERE shop = ?`,
      args: [shop],
    });
    for (const row of rs.rows ?? []) {
      const loc = String(row.locale ?? "").trim();
      if (loc) locales.add(loc);
    }
  } catch (err) {
    console.warn(
      `  [warn] 读取 ShopTargetLocale.locale 失败：${err?.message || err}`,
    );
  }
  try {
    const rs = await turso.execute({
      sql: `SELECT targets FROM "ShopTranslationSettings" WHERE shop = ?`,
      args: [shop],
    });
    const raw = rs.rows?.[0]?.targets;
    if (raw != null) {
      const parsed =
        typeof raw === "string" ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const loc = String(item ?? "").trim();
          if (loc) locales.add(loc);
        }
      }
    }
  } catch (err) {
    console.warn(
      `  [warn] 读取 ShopTranslationSettings.targets 失败：${err?.message || err}`,
    );
  }
  return [...locales].sort();
}

/** 按 shopName 分区删除 Cosmos 容器中的文档。 */
async function deleteCosmosByShop(container, label) {
  if (!container) {
    console.log(`  [skip] 未配置 Cosmos，跳过 ${label}`);
    return;
  }
  let docs = [];
  try {
    const { resources } = await container.items
      .query({
        query:
          "SELECT c.id, c.status, c.trigger FROM c WHERE c.shopName = @shop",
        parameters: [{ name: "@shop", value: shop }],
      })
      .fetchAll();
    docs = resources;
  } catch (err) {
    console.error(`  [err] Cosmos 查询 ${label} 失败：${err?.message || err}`);
    return;
  }

  if (!write) {
    console.log(`  [dry] Cosmos ${label}: 将删除 ${docs.length} 个文档`);
    for (const d of docs.slice(0, 10)) {
      const extra = d.trigger ? ` trigger=${d.trigger}` : "";
      console.log(`        - ${d.id} (${d.status}${extra})`);
    }
    if (docs.length > 10) {
      console.log(`        …以及另外 ${docs.length - 10} 个`);
    }
    return;
  }

  let done = 0;
  for (const d of docs) {
    try {
      await container.item(d.id, shop).delete();
      done += 1;
    } catch (err) {
      console.error(
        `  [err] 删除 ${label} ${d.id} 失败：${err?.message || err}`,
      );
    }
  }
  console.log(`  [ok ] Cosmos ${label}: 已删除 ${done}/${docs.length} 个文档`);
}

async function deleteCosmosJobs() {
  await deleteCosmosByShop(cosmosJobsContainer, "v4 jobs");
}

async function deleteCosmosShopScans() {
  await deleteCosmosByShop(cosmosShopScanContainer, "shop_scan_jobs");
}

/** 仅当没有已知 locale 时兜底：SCAN 该店 prefix（不用 KEYS）。 */
async function scanItemsCountKeys(client) {
  const pattern = `tsf:items_count:${shop}:*`;
  const keys = [];
  let cursor = "0";
  do {
    const [next, batch] = await client.scan(
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      500,
    );
    cursor = next;
    for (const k of batch) keys.push(k);
  } while (cursor !== "0");
  return keys;
}

/**
 * 按已知 locale 直接 DEL `tsf:items_count:{shop}:{locale}`（主路径，无全库 SCAN）。
 * locales 须在删除 ShopTargetLocale 之前收集；为空时才 SCAN 该店 prefix 兜底。
 */
async function deleteRedisItemsCount(locales) {
  if (redisTargets.length === 0) {
    console.log("  [skip] 未配置 RENDER_KV，跳过 items_count");
    return;
  }

  for (const redisTarget of redisTargets) {
    const client = new Redis(redisTarget.url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 12_000,
      lazyConnect: true,
      enableOfflineQueue: false,
      enableReadyCheck: true,
      commandTimeout: 15_000,
    });
    client.on("error", () => {});
    try {
      await client.connect();

      let keys = locales.map((locale) => `tsf:items_count:${shop}:${locale}`);
      let mode = "exact";
      if (keys.length === 0) {
        console.log(
          "  [info] 无已知 locale，回退 SCAN 该店 prefix（可能较慢）…",
        );
        keys = await scanItemsCountKeys(client);
        mode = "scan-fallback";
      }

      if (keys.length === 0) {
        console.log(
          `  [ok ] Redis ${redisTarget.key} (${maskHost(redisTarget.url)}): 无需删除（0 key）`,
        );
        continue;
      }

      if (!write) {
        if (mode === "exact") {
          const pipeline = client.pipeline();
          for (const k of keys) pipeline.exists(k);
          const results = await pipeline.exec();
          const existing = [];
          results?.forEach((entry, i) => {
            const [err, n] = entry ?? [];
            if (!err && Number(n) > 0) existing.push(keys[i]);
          });
          console.log(
            `  [dry] Redis ${redisTarget.key} (${maskHost(redisTarget.url)}): 精确候选 ${keys.length}，已存在 ${existing.length}`,
          );
          for (const k of existing.slice(0, 10)) console.log(`        - ${k}`);
          if (existing.length > 10) {
            console.log(`        …以及另外 ${existing.length - 10} 个`);
          }
        } else {
          console.log(
            `  [dry] Redis ${redisTarget.key} (${maskHost(redisTarget.url)}): SCAN 命中 ${keys.length}`,
          );
          for (const k of keys.slice(0, 10)) console.log(`        - ${k}`);
          if (keys.length > 10) {
            console.log(`        …以及另外 ${keys.length - 10} 个`);
          }
        }
      } else {
        const deleted = await client.del(...keys);
        console.log(
          `  [ok ] Redis ${redisTarget.key} (${maskHost(redisTarget.url)}): DEL ${deleted}/${keys.length}（${mode}）`,
        );
      }
    } catch (err) {
      console.error(
        `  [err] Redis ${redisTarget.key} items_count 失败：${err?.message || err}`,
      );
    } finally {
      try {
        await client.quit();
      } catch {
        try {
          client.disconnect(false);
        } catch {
          // ignore
        }
      }
    }
  }
}

async function main() {
  console.log("\n-- 步骤 1/6：重置 onboarding 状态 --");
  await tursoDelete("ShopOnboarding");

  console.log("\n-- 步骤 2/6：删除该店 v4 任务 --");
  await deleteCosmosJobs();
  await tursoDelete("TranslateV4JobUsage");

  // 先收集 locale，再删表，供 Redis 精确 DEL
  console.log("\n-- 步骤 3/6：删除语言相关（ShopTargetLocale / ShopTranslationSettings）--");
  const localesForRedis = await listLocalesForItemsCount();
  console.log(
    `  [info] 将用于 Redis DEL 的 locale 数=${localesForRedis.length}` +
      (localesForRedis.length
        ? ` (${localesForRedis.slice(0, 8).join(", ")}${localesForRedis.length > 8 ? ", …" : ""})`
        : ""),
  );
  await tursoDelete("ShopTargetLocale");
  await tursoDelete("ShopTranslationSettings");

  console.log("\n-- 步骤 4/6：删除 Redis 覆盖率缓存 items_count（按 locale 精确 DEL）--");
  await deleteRedisItemsCount(localesForRedis);

  console.log(
    "\n-- 步骤 5/6：删除 Cosmos shop_scan_jobs（否则 install 扫描会被 skipped_existing）--",
  );
  await deleteCosmosShopScans();

  if (includeBilling) {
    console.log("\n-- 步骤 6/6：清空账单（isNew=true / 恢复试用资格）--");
    // 子表 → 主表顺序删除
    await tursoDelete("AccountPeriodUsage");
    await tursoDelete("BillingLog");
    await tursoDelete("AppSubscription");
    await tursoDelete("Account");
  } else {
    console.log(
      "\n-- 步骤 6/6：跳过账单（未加 --billing）。若主 CTA 想显示「开试用」，请加 --billing --",
    );
  }

  console.log(
    `\n===== 完成（${MODE}）=====` +
      (write
        ? "\n下一步：在测试店重新打开 /app（或强制刷新），应重定向到 /app/onboarding。\ninstall shop scan 应能重新入队并后台重算全语言覆盖率（Shopify 侧语言本身不会被本脚本删除）。"
        : "\n这是 dry-run，未改动任何数据。确认无误后加 --write 执行。"),
  );
}

main()
  .catch((err) => {
    console.error("脚本异常：", err?.message || err);
    process.exit(1);
  })
  .finally(() => {
    try {
      turso.close?.();
    } catch {
      // ignore
    }
  });
