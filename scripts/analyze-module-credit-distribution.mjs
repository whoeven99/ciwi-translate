/**
 * 随机抽样商店，分析 v4 翻译积分按模块 / 手动自动 / input-output 分布。
 *
 * 只读；查产：node scripts/analyze-module-credit-distribution.mjs --env=.env.prod
 *
 * 输出：scripts/tmp/module-credit-analysis/report.json + report.md
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CosmosClient } from "@azure/cosmos";
import { BlobServiceClient } from "@azure/storage-blob";
import { createClient } from "@libsql/client";
import {
  loadStackedEnv,
  resolveCosmos,
  resolveTurso,
  REPO_ROOT,
} from "./lib/loadEnv.mjs";

const root = REPO_ROOT;
const { env } = loadStackedEnv({ root });
const cosmosCfg = resolveCosmos(env);
const tursoCfg = resolveTurso(env);

const argv = process.argv.slice(2);
const SHOP_COUNT = Number(argv.find((a) => a.startsWith("--shops="))?.split("=")[1]) || 20;
const DAYS = Number(argv.find((a) => a.startsWith("--days="))?.split("=")[1]) || 90;
const SEED = argv.find((a) => a.startsWith("--seed="))?.split("=")[1] || "ciwi-module-credit-2026-09";
const JOBS_PER_SHOP_BLOB = Number(
  argv.find((a) => a.startsWith("--blob-jobs="))?.split("=")[1] || 2,
);

const GOOGLE_CREDITS_PER_CHAR = 1.6;
const AUTO_SOURCE = "TsFrontend-Auto";

/** 模块分层：必要 / 主题 / 增值 */
const MODULE_TIER = {
  PRODUCT: "core",
  PRODUCT_OPTION: "core",
  PRODUCT_OPTION_VALUE: "core",
  COLLECTION: "core",
  PAGE: "core",
  ARTICLE: "core",
  BLOG: "core",
  MENU: "core",
  SHOP: "core",
  SHOP_POLICY: "core",
  DELIVERY_METHOD_DEFINITION: "core",
  ONLINE_STORE_THEME_JSON_TEMPLATE: "theme",
  ONLINE_STORE_THEME_SECTION_GROUP: "theme",
  ONLINE_STORE_THEME_SETTINGS_DATA_SECTIONS: "theme",
  ONLINE_STORE_THEME_LOCALE_CONTENT: "theme",
  ONLINE_STORE_THEME_SETTINGS_CATEGORY: "theme",
  ONLINE_STORE_THEME_APP_EMBED: "theme",
  METAFIELD: "value_add",
  METAOBJECT: "value_add",
  LINK: "value_add",
  FILTER: "value_add",
  PAYMENT_GATEWAY: "value_add",
  SELLING_PLAN: "value_add",
  SELLING_PLAN_GROUP: "value_add",
  EMAIL_TEMPLATE: "value_add",
  PACKING_SLIP_TEMPLATE: "value_add",
  CUSTOM_LIQUID: "value_add",
};

function tierOf(module) {
  return MODULE_TIER[module] ?? "value_add";
}

function isAuto(taskSource) {
  return taskSource === AUTO_SOURCE;
}

function billableLlmTokens(usage) {
  const hit = usage.promptCacheHitTokens;
  if (typeof hit === "number" && hit > 0) {
    const miss =
      typeof usage.promptCacheMissTokens === "number" && usage.promptCacheMissTokens >= 0
        ? usage.promptCacheMissTokens
        : typeof usage.inputTokens === "number"
          ? Math.max(0, usage.inputTokens - hit)
          : 0;
    const out =
      typeof usage.outputTokens === "number" && usage.outputTokens >= 0
        ? usage.outputTokens
        : 0;
    return Math.max(0, miss + out);
  }
  if (typeof usage.totalTokens === "number" && usage.totalTokens > 0) {
    return usage.totalTokens;
  }
  return Math.max(0, (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0));
}

function extractCostMetrics(cost) {
  if (!cost || cost.provider === "cache" || cost.provider === "skip") {
    return null;
  }
  if (cost.provider === "google") {
    const chars = Number(cost.chars) || 0;
    const billable = Math.ceil(chars * GOOGLE_CREDITS_PER_CHAR);
    return {
      provider: "google",
      inputTokens: 0,
      outputTokens: 0,
      cacheHit: 0,
      rawInput: 0,
      billable,
      chars,
      fields: 1,
    };
  }
  if (cost.calls && Array.isArray(cost.calls)) {
    let input = 0;
    let output = 0;
    let cacheHit = 0;
    let rawInput = 0;
    let billable = 0;
    for (const c of cost.calls) {
      if (c.provider === "google") {
        const chars = Number(c.chars) || 0;
        billable += Math.ceil(chars * GOOGLE_CREDITS_PER_CHAR);
        continue;
      }
      input += Number(c.promptCacheMissTokens ?? c.inputTokens) || 0;
      output += Number(c.outputTokens) || 0;
      cacheHit += Number(c.promptCacheHitTokens) || 0;
      rawInput += Number(c.inputTokens) || 0;
      billable += billableLlmTokens(c);
    }
    if (typeof cost.inputTokens === "number") {
      rawInput = cost.inputTokens;
      output = cost.outputTokens ?? output;
      cacheHit = cost.promptCacheHitTokens ?? cacheHit;
      input = cost.promptCacheMissTokens ?? input;
    }
    return {
      provider: "mixed",
      inputTokens: input,
      outputTokens: output,
      cacheHit,
      rawInput,
      billable: billable || billableLlmTokens(cost),
      chars: 0,
      fields: 1,
    };
  }
  if (cost.provider === "llm" || cost.provider === "mixed") {
    const input = Number(cost.promptCacheMissTokens ?? cost.inputTokens) || 0;
    const output = Number(cost.outputTokens) || 0;
    const cacheHit = Number(cost.promptCacheHitTokens) || 0;
    const rawInput = Number(cost.inputTokens) || 0;
    return {
      provider: cost.provider,
      inputTokens: input,
      outputTokens: output,
      cacheHit,
      rawInput,
      billable: billableLlmTokens(cost),
      chars: 0,
      fields: 1,
    };
  }
  return null;
}

function seededShuffle(items, seed) {
  const arr = [...items];
  let h = createHash("sha256").update(seed).digest();
  for (let i = arr.length - 1; i > 0; i--) {
    h = createHash("sha256").update(h).update(String(i)).digest();
    const j = h[0] % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pct(n, d) {
  if (!d) return "0%";
  return `${((n / d) * 100).toFixed(1)}%`;
}

function sumInitChars(chunk) {
  let chars = 0;
  let fields = 0;
  for (const resource of chunk ?? []) {
    for (const f of resource.fields ?? []) {
      fields++;
      chars += String(f.value ?? "").length;
    }
  }
  return { chars, fields };
}

async function main() {
  if (!cosmosCfg.endpoint || !cosmosCfg.key) {
    console.error("缺少 Cosmos 凭据");
    process.exit(1);
  }

  const since = new Date(Date.now() - DAYS * 864e5).toISOString();
  const client = new CosmosClient({ endpoint: cosmosCfg.endpoint, key: cosmosCfg.key });
  const container = client.database(cosmosCfg.databaseId).container(cosmosCfg.containerId);

  console.log(`[1/5] Cosmos 拉取 ${DAYS} 天内终态任务…`);
  const terminalStatuses = ["COMPLETED", "FAILED", "PAUSED", "CANCELLED"];
  const { resources: jobs } = await container.items
    .query({
      query: `
        SELECT c.id, c.shopName, c.taskSource, c.modules, c.includeLiquid, c.status,
               c.metrics, c.engineUsage, c.createdAt, c.updatedAt, c.target, c.aiModel
        FROM c
        WHERE c.updatedAt >= @since
          AND (c.status IN ('COMPLETED','FAILED','PAUSED','CANCELLED'))
          AND (c.metrics.usedTokens > 0 OR IS_DEFINED(c.engineUsage))
      `,
      parameters: [{ name: "@since", value: since }],
    })
    .fetchAll();

  console.log(`  共 ${jobs.length} 条有消耗记录的任务`);

  const shopJobs = new Map();
  for (const j of jobs) {
    const shop = j.shopName;
    if (!shop) continue;
    const list = shopJobs.get(shop) ?? [];
    list.push(j);
    shopJobs.set(shop, list);
  }

  const eligibleShops = [...shopJobs.keys()].filter((s) => {
    const list = shopJobs.get(s);
    return list.some((j) => (j.metrics?.usedTokens ?? 0) > 0);
  });
  const pickedShops = seededShuffle(eligibleShops, SEED).slice(0, SHOP_COUNT);
  console.log(`[2/5] 随机抽取 ${pickedShops.length} 家商店（seed=${SEED}）`);

  // Blob client
  const blobConn = env.AZURE_BLOB_CONNECTION_STRING?.trim();
  const blobContainerName =
    env.AZURE_BLOB_TRANSLATION_CONTAINER?.trim() || "translation-content";
  let blobContainer = null;
  if (blobConn) {
    blobContainer = BlobServiceClient.fromConnectionString(blobConn).getContainerClient(
      blobContainerName,
    );
  } else {
    console.warn("  无 Blob 凭据，跳过模块级 input/output 深钻");
  }

  async function blobReadJson(path) {
    if (!blobContainer) return null;
    try {
      const client = blobContainer.getBlockBlobClient(path);
      if (!(await client.exists())) return null;
      const buf = await client.downloadToBuffer();
      return JSON.parse(buf.toString("utf8"));
    } catch {
      return null;
    }
  }

  async function listBlobPaths(prefix) {
    if (!blobContainer) return [];
    const paths = [];
    try {
      for await (const item of blobContainer.listBlobsFlat({ prefix })) {
        paths.push(item.name);
      }
    } catch {
      // ignore
    }
    return paths;
  }

  // Turso: shop size + account
  let turso = null;
  if (tursoCfg.url && tursoCfg.authToken) {
    turso = createClient({ url: tursoCfg.url, authToken: tursoCfg.authToken });
  }

  const shopProfiles = new Map();
  if (turso) {
    const placeholders = pickedShops.map(() => "?").join(",");
    try {
      const sizeRs = await turso.execute({
        sql: `SELECT shopName, dataBytes, sizeTier FROM ShopProfile WHERE shopName IN (${placeholders})`,
        args: pickedShops,
      });
      // ShopProfile might not have sizeTier - that's in Cosmos shop_profile
    } catch {
      // ShopProfile table may differ
    }

    try {
      const acctRs = await turso.execute({
        sql: `
          SELECT a.shopName,
                 a.subscriptionCredits, a.purchasedCredits, a.trialCredits, a.usedCredits,
                 ps.planName, ps.status AS subStatus
          FROM Account a
          LEFT JOIN AppSubscription ps ON ps.shopName = a.shopName AND ps.status = 'ACTIVE'
          WHERE a.shopName IN (${placeholders})
        `,
        args: pickedShops,
      });
      for (const row of acctRs.rows) {
        shopProfiles.set(String(row.shopName), {
          planName: row.planName ?? null,
          subStatus: row.subStatus ?? null,
          subscriptionCredits: Number(row.subscriptionCredits) || 0,
          purchasedCredits: Number(row.purchasedCredits) || 0,
          trialCredits: Number(row.trialCredits) || 0,
          usedCredits: Number(row.usedCredits) || 0,
        });
      }
    } catch (e) {
      console.warn("  Turso Account 查询失败:", e.message);
    }
  }

  // Cosmos shop size profile
  const sizeDbId = env.COSMOS_SHOP_DATABASE_ID?.trim() || "shop";
  const sizeContainerId = env.COSMOS_SHOP_PROFILE_CONTAINER?.trim() || "shop_profile";
  const sizeContainer = client.database(sizeDbId).container(sizeContainerId);
  const shopSize = new Map();
  for (const shop of pickedShops) {
    try {
      const { resource } = await sizeContainer.item(shop, shop).read();
      if (resource?.type === "size") {
        shopSize.set(shop, {
          dataBytes: resource.dataBytes ?? 0,
          sizeTier: resource.sizeTier ?? "未知",
          largestLanguage: resource.largestLanguage ?? null,
        });
      }
    } catch {
      // no profile
    }
  }

  const global = {
    manual: { jobs: 0, usedTokens: 0, sourceChars: 0 },
    auto: { jobs: 0, usedTokens: 0, sourceChars: 0 },
    moduleAllocated: {},
    moduleBlob: {},
    tierAllocated: { core: 0, theme: 0, value_add: 0 },
    tierBlob: { core: 0, theme: 0, value_add: 0 },
  };

  const shopReports = [];

  console.log("[3/5] 聚合任务级消耗 + init 按比例分摊…");
  for (const shop of pickedShops) {
    const list = (shopJobs.get(shop) ?? []).sort(
      (a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)),
    );
    const shopAgg = {
      shop,
      size: shopSize.get(shop) ?? null,
      account: shopProfiles.get(shop) ?? null,
      manual: { jobs: 0, usedTokens: 0 },
      auto: { jobs: 0, usedTokens: 0 },
      moduleAllocated: {},
      targets: new Set(),
    };

    for (const job of list) {
      const used = Math.max(0, Number(job.metrics?.usedTokens) || 0);
      const auto = isAuto(job.taskSource);
      const bucket = auto ? "auto" : "manual";
      global[bucket].jobs++;
      global[bucket].usedTokens += used;
      shopAgg[bucket].jobs++;
      shopAgg[bucket].usedTokens += used;
      if (job.target) shopAgg.targets.add(job.target);

      let sourceChars = 0;
      if (job.engineUsage) {
        for (const u of Object.values(job.engineUsage)) {
          sourceChars += Number(u?.chars) || 0;
        }
      }
      global[bucket].sourceChars += sourceChars;

      const modules = [...(job.modules ?? [])];
      if (job.includeLiquid) modules.push("CUSTOM_LIQUID");

      // init blob proportional allocation (only for COMPLETED with tokens)
      if (used > 0 && blobContainer && job.status === "COMPLETED") {
        const prefix = `tasks/v4/${shop}/${job.id}/init/`;
        const moduleChars = {};
        let totalChars = 0;
        for (const mod of modules) {
          const paths = (await listBlobPaths(`${prefix}${mod}/`)).filter((p) =>
            p.endsWith(".json"),
          );
          let chars = 0;
          for (const p of paths) {
            const chunk = await blobReadJson(p);
            chars += sumInitChars(chunk).chars;
          }
          if (chars > 0) {
            moduleChars[mod] = chars;
            totalChars += chars;
          }
        }
        if (totalChars > 0) {
          for (const [mod, chars] of Object.entries(moduleChars)) {
            const alloc = Math.round(used * (chars / totalChars));
            const g = (global.moduleAllocated[mod] ??= {
              manual: 0,
              auto: 0,
              total: 0,
              jobs: 0,
            });
            g[bucket] += alloc;
            g.total += alloc;
            g.jobs++;
            global.tierAllocated[tierOf(mod)] += alloc;

            const s = (shopAgg.moduleAllocated[mod] ??= { manual: 0, auto: 0, total: 0 });
            s[bucket] += alloc;
            s.total += alloc;
          }
        }
      }
    }

    shopReports.push(shopAgg);
  }

  console.log("[4/5] Blob translate 深钻 input/output（每店最多", JOBS_PER_SHOP_BLOB, "任务）…");
  for (const shop of pickedShops) {
    const list = (shopJobs.get(shop) ?? [])
      .filter((j) => j.status === "COMPLETED" && (j.metrics?.usedTokens ?? 0) > 0)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, JOBS_PER_SHOP_BLOB);

    for (const job of list) {
      const prefix = `tasks/v4/${shop}/${job.id}/translate/`;
      const paths = (await listBlobPaths(prefix)).filter((p) => p.endsWith(".json"));
      for (const p of paths) {
        const parts = p.split("/");
        const idx = parts.indexOf("translate");
        const mod = idx >= 0 && idx + 1 < parts.length ? parts[idx + 1] : null;
        if (!mod || mod === "fallbacks.json") continue;
        const chunk = await blobReadJson(p);
        if (!Array.isArray(chunk)) continue;
        for (const resource of chunk) {
          for (const t of resource.translations ?? []) {
            const m = extractCostMetrics(t.cost);
            if (!m) continue;
            const auto = isAuto(job.taskSource);
            const bucket = auto ? "auto" : "manual";
            const g = (global.moduleBlob[mod] ??= {
              manual: { billable: 0, input: 0, output: 0, cacheHit: 0, rawInput: 0, fields: 0 },
              auto: { billable: 0, input: 0, output: 0, cacheHit: 0, rawInput: 0, fields: 0 },
              googleChars: 0,
              llmFields: 0,
              googleFields: 0,
            });
            const b = g[bucket];
            b.billable += m.billable;
            b.input += m.inputTokens;
            b.output += m.outputTokens;
            b.cacheHit += m.cacheHit;
            b.rawInput += m.rawInput;
            b.fields += m.fields;
            if (m.provider === "google") {
              g.googleChars += m.chars;
              g.googleFields += 1;
            } else {
              g.llmFields += 1;
            }
            global.tierBlob[tierOf(mod)] += m.billable;
          }
        }
      }
    }
  }

  console.log("[5/5] 生成报告…");
  const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "tmp/module-credit-analysis");
  await mkdir(outDir, { recursive: true });

  const totalTokens = global.manual.usedTokens + global.auto.usedTokens;
  const moduleRows = Object.entries(global.moduleAllocated)
    .map(([mod, v]) => ({
      module: mod,
      tier: tierOf(mod),
      ...v,
      share: totalTokens ? v.total / totalTokens : 0,
    }))
    .sort((a, b) => b.total - a.total);

  const blobModules = Object.entries(global.moduleBlob).map(([mod, g]) => {
    const manual = g.manual;
    const auto = g.auto;
    const billable = manual.billable + auto.billable;
    const input = manual.input + auto.input;
    const output = manual.output + auto.output;
    const cacheHit = manual.cacheHit + auto.cacheHit;
    const rawInput = manual.rawInput + auto.rawInput;
    return {
      module: mod,
      tier: tierOf(mod),
      billable,
      input,
      output,
      cacheHit,
      rawInput,
      inOutRatio: output > 0 ? input / output : null,
      cacheHitShare: rawInput > 0 ? cacheHit / rawInput : 0,
      googleChars: g.googleChars,
      llmFields: g.llmFields,
      googleFields: g.googleFields,
      manualBillable: manual.billable,
      autoBillable: auto.billable,
    };
  }).sort((a, b) => b.billable - a.billable);

  const shopFairness = shopReports
    .map((s) => {
      const total = s.manual.usedTokens + s.auto.usedTokens;
      const acct = s.account;
      const remaining = acct
        ? acct.subscriptionCredits + acct.purchasedCredits + acct.trialCredits - acct.usedCredits
        : null;
      const dataBytes = s.size?.dataBytes ?? 0;
      const tokensPerMiB = dataBytes > 0 ? total / (dataBytes / (1024 * 1024)) : null;
      return {
        shop: s.shop,
        sizeTier: s.size?.sizeTier ?? "无扫描",
        dataBytes,
        planName: acct?.planName ?? "未知",
        remainingCredits: remaining,
        totalUsedTokens: total,
        manualShare: total ? s.manual.usedTokens / total : 0,
        autoShare: total ? s.auto.usedTokens / total : 0,
        jobCount: s.manual.jobs + s.auto.jobs,
        targetLocales: [...s.targets].length,
        tokensPerMiB,
        costIntensity:
          tokensPerMiB == null
            ? "unknown"
            : tokensPerMiB > 500_000
              ? "very_high"
              : tokensPerMiB > 200_000
                ? "high"
                : tokensPerMiB > 80_000
                  ? "medium"
                  : "low",
      };
    })
    .sort((a, b) => b.totalUsedTokens - a.totalUsedTokens);

  const report = {
    generatedAt: new Date().toISOString(),
    params: { SHOP_COUNT, DAYS, SEED, JOBS_PER_SHOP_BLOB, since },
    sampleShops: pickedShops,
    summary: {
      shopsSampled: pickedShops.length,
      jobsInWindow: jobs.length,
      totalUsedTokens: totalTokens,
      manual: { ...global.manual, share: totalTokens ? global.manual.usedTokens / totalTokens : 0 },
      auto: { ...global.auto, share: totalTokens ? global.auto.usedTokens / totalTokens : 0 },
      tierAllocated: global.tierAllocated,
      tierAllocatedShare: {
        core: totalTokens ? global.tierAllocated.core / totalTokens : 0,
        theme: totalTokens ? global.tierAllocated.theme / totalTokens : 0,
        value_add: totalTokens ? global.tierAllocated.value_add / totalTokens : 0,
      },
    },
    moduleAllocationTop: moduleRows.slice(0, 25),
    moduleBlobDeepDive: blobModules.slice(0, 25),
    shopFairness,
  };

  await writeFile(resolve(outDir, "report.json"), JSON.stringify(report, null, 2));

  const md = [];
  md.push("# 模块翻译积分消耗分布（随机 20 店抽样）");
  md.push("");
  md.push(`- 抽样窗口：近 ${DAYS} 天（since ${since}）`);
  md.push(`- 随机 seed：\`${SEED}\``);
  md.push(`- 样本商店数：${pickedShops.length}`);
  md.push(`- 窗口内任务数：${jobs.length}`);
  md.push("");
  md.push("## 1. 手动 vs 自动");
  md.push("");
  md.push(`| 类型 | 任务数 | 积分消耗 | 占比 | 源字符 |`);
  md.push(`| --- | ---: | ---: | ---: | ---: |`);
  md.push(
    `| 手动 | ${global.manual.jobs} | ${global.manual.usedTokens.toLocaleString()} | ${pct(global.manual.usedTokens, totalTokens)} | ${global.manual.sourceChars.toLocaleString()} |`,
  );
  md.push(
    `| 自动 | ${global.auto.jobs} | ${global.auto.usedTokens.toLocaleString()} | ${pct(global.auto.usedTokens, totalTokens)} | ${global.auto.sourceChars.toLocaleString()} |`,
  );
  md.push("");
  md.push("## 2. 模块分层（init 字符比例分摊 job.usedTokens）");
  md.push("");
  md.push(`| 层级 | 分摊积分 | 占比 |`);
  md.push(`| --- | ---: | ---: |`);
  for (const [tier, val] of Object.entries(global.tierAllocated)) {
    md.push(`| ${tier} | ${Math.round(val).toLocaleString()} | ${pct(val, totalTokens)} |`);
  }
  md.push("");
  md.push("### Top 模块（分摊）");
  md.push("");
  md.push(`| 模块 | 层级 | 手动 | 自动 | 合计 | 占比 |`);
  md.push(`| --- | --- | ---: | ---: | ---: | ---: |`);
  for (const r of moduleRows.slice(0, 15)) {
    md.push(
      `| ${r.module} | ${r.tier} | ${r.manual.toLocaleString()} | ${r.auto.toLocaleString()} | ${r.total.toLocaleString()} | ${pct(r.total, totalTokens)} |`,
    );
  }
  md.push("");
  md.push("## 3. Blob 深钻：input / output / cache（样本任务）");
  md.push("");
  if (blobModules.length === 0) {
    md.push("_无 Blob cost 数据（可能无凭据或旧任务未写 cost）_");
  } else {
    md.push(`| 模块 | 计费积分 | input(miss) | output | in/out | cache命中/rawInput | LLM字段 | Google字段 |`);
    md.push(`| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`);
    for (const r of blobModules.slice(0, 15)) {
      md.push(
        `| ${r.module} | ${Math.round(r.billable).toLocaleString()} | ${Math.round(r.input).toLocaleString()} | ${Math.round(r.output).toLocaleString()} | ${r.inOutRatio != null ? r.inOutRatio.toFixed(2) : "-"} | ${pct(r.cacheHit, r.rawInput)} | ${r.llmFields} | ${r.googleFields} |`,
      );
    }
  }
  md.push("");
  md.push("## 4. 商店成本承担 vs 体量 / 套餐");
  md.push("");
  md.push(`| 商店 | 体量 | 套餐 | 近${DAYS}天积分 | 手动占比 | 目标语数 | 积分/MiB源内容 | 强度 |`);
  md.push(`| --- | --- | --- | ---: | ---: | ---: | ---: | --- |`);
  for (const s of shopFairness) {
    const mib = s.dataBytes ? (s.dataBytes / (1024 * 1024)).toFixed(1) : "-";
    md.push(
      `| ${s.shop.replace(".myshopify.com", "")} | ${s.sizeTier} (${mib}MiB) | ${s.planName ?? "-"} | ${s.totalUsedTokens.toLocaleString()} | ${pct(s.manual.usedTokens ?? s.manualShare * s.totalUsedTokens, s.totalUsedTokens)} | ${s.targetLocales} | ${s.tokensPerMiB != null ? Math.round(s.tokensPerMiB).toLocaleString() : "-"} | ${s.costIntensity} |`,
    );
  }
  md.push("");
  md.push("## 5. 初步结论（供产品/定价参考）");
  md.push("");
  md.push("- **必要模块（core）**：PRODUCT/COLLECTION/PAGE/MENU 等，通常占分摊积分主体。");
  md.push("- **主题模块（theme）**：ONLINE_STORE_THEME_* 字符多、HTML 多，input 占比往往更高。");
  md.push("- **增值模块（value_add）**：METAFIELD/METAOBJECT/EMAIL_TEMPLATE/LINK 等，单店占比因行业差异大。");
  md.push("- **优化方向**：in/out 高 + cache 命中低的模块优先做 prompt 压缩、短字段 JSON pack、TM 命中；Google 兜底多的模块加强质量门控减少 fallback。");
  md.push("- **大店成本**：对比 `tokensPerMiB` 与 `sizeTier`；高强度店若仍在低档套餐，应通过模块白名单/并发/频率限制引导升级。");

  await writeFile(resolve(outDir, "report.md"), md.join("\n"));
  console.log(`\n完成 → ${outDir}/report.md`);
  console.log(`       ${outDir}/report.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
