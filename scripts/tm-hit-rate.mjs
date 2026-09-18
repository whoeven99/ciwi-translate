/**
 * 翻译记忆（TM）命中率趋势 —— 从 Render 运行日志聚合 `[tm]` 单行。
 *
 * 数据来源：`packages/translation-core/src/llmTranslate.ts` 的 translateResources
 * 收尾调用 `formatTmStatsLine`（`tmStats.ts`），每个 chunk 输出一行 `[tm] {json}`。
 *
 * 看什么：`charHitRate` 是成本相关口径（缓存字符 ÷ 总字符）——它每涨一个点，
 * 就少一个点的 LLM 计费字符。`hitRate` 是按次数的口径，仅供对照。
 *
 * Usage:
 *   node scripts/tm-hit-rate.mjs                     # 默认测环境凭据、Worker、最近 24h
 *   node scripts/tm-hit-rate.mjs --hours=72
 *   node scripts/tm-hit-rate.mjs --shop=xxx.myshopify.com
 *   node scripts/tm-hit-rate.mjs --target=fr --env=.env.prod
 *   node scripts/tm-hit-rate.mjs --json
 *
 * 只读脚本：不写任何库，不打印密钥（仅打印脱敏后的 service / owner id）。
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadStackedEnv } from "./lib/loadEnv.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const DEFAULT_OWNER_ID = "tea-csovfmhu0jms738qrra0";
const DEFAULT_WORKER_SERVICE_ID = "srv-d8sqas4vikkc73f5nbog";
const LOG_PREFIX = "[tm] ";
const PAGE_LIMIT = 100;
const MAX_PAGES = 40;
const TIERS = ["fieldDigest", "fieldValue", "leafValue"];
const TIER_LABELS = {
  fieldDigest: "字段 digest",
  fieldValue: "字段 value",
  leafValue: "叶子 value",
};

function parseArgs(argv) {
  const args = {
    hours: 24,
    json: false,
    shop: null,
    target: null,
    service: null,
    env: null,
  };
  for (const raw of argv.slice(2)) {
    if (raw === "--json") {
      args.json = true;
      continue;
    }
    const match = raw.match(/^--([^=]+)=(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (key === "hours") args.hours = Math.max(1, Number(value) || 24);
    else if (key === "shop") args.shop = value;
    else if (key === "target") args.target = value;
    else if (key === "service") args.service = value;
    else if (key === "env") args.env = value;
  }
  return args;
}

function resolveConfig(args) {
  const { env: fileEnv } = loadStackedEnv({
    root,
    overlay: args.env || ".env.test",
    applyToProcess: false,
  });
  const apiKey = process.env.RENDER_API_KEY || fileEnv.RENDER_API_KEY;
  if (!apiKey) {
    throw new Error("缺少 RENDER_API_KEY（放在 .env，或 --env= 指向的文件栈里）");
  }
  return {
    apiKey,
    ownerId:
      process.env.RENDER_OWNER_ID || fileEnv.RENDER_OWNER_ID || DEFAULT_OWNER_ID,
    serviceId:
      args.service ||
      process.env.RENDER_WORKER_SERVICE_ID ||
      fileEnv.RENDER_WORKER_SERVICE_ID ||
      DEFAULT_WORKER_SERVICE_ID,
  };
}

async function fetchTmSamples({ apiKey, ownerId, serviceId }, hours) {
  const samples = [];
  let endTime = new Date().toISOString();
  const floor = new Date(Date.now() - hours * 3_600_000).toISOString();

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL("https://api.render.com/v1/logs");
    url.searchParams.set("ownerId", ownerId);
    url.searchParams.set("resource", serviceId);
    url.searchParams.set("type", "app");
    url.searchParams.set("text", LOG_PREFIX.trim());
    url.searchParams.set("startTime", floor);
    url.searchParams.set("endTime", endTime);
    url.searchParams.set("direction", "backward");
    url.searchParams.set("limit", String(PAGE_LIMIT));

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      throw new Error(`Render logs API ${res.status} ${res.statusText}`);
    }
    const body = await res.json();

    for (const log of body.logs ?? []) {
      const index = log.message?.indexOf(LOG_PREFIX);
      if (index == null || index < 0) continue;
      try {
        const parsed = JSON.parse(log.message.slice(index + LOG_PREFIX.length));
        samples.push({ ...parsed, timestamp: log.timestamp });
      } catch {
        // 日志被截断的行直接跳过。
      }
    }

    if (!body.hasMore || !body.nextEndTime) break;
    endTime = body.nextEndTime;
  }

  return samples;
}

function emptyTotals() {
  const tiers = {};
  for (const tier of TIERS) tiers[tier] = { lookups: 0, hits: 0, hitChars: 0 };
  return {
    chunks: 0,
    lookups: 0,
    hits: 0,
    hitChars: 0,
    engineChars: 0,
    llmRequests: 0,
    tiers,
  };
}

function accumulate(totals, sample) {
  totals.chunks += 1;
  totals.lookups += sample.lookups ?? 0;
  totals.hits += sample.hits ?? 0;
  totals.hitChars += sample.hitChars ?? 0;
  totals.engineChars += sample.engineChars ?? 0;
  totals.llmRequests += sample.llmRequests ?? 0;
  for (const tier of TIERS) {
    const src = sample.tiers?.[tier];
    if (!src) continue;
    totals.tiers[tier].lookups += src.lookups ?? 0;
    totals.tiers[tier].hits += src.hits ?? 0;
    totals.tiers[tier].hitChars += src.hitChars ?? 0;
  }
  return totals;
}

function pct(hit, total) {
  if (total <= 0) return "-";
  return `${((hit / total) * 100).toFixed(1)}%`;
}

function compactNumber(value) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function groupBy(samples, keyFn) {
  const groups = new Map();
  for (const sample of samples) {
    const key = keyFn(sample) || "unknown";
    if (!groups.has(key)) groups.set(key, emptyTotals());
    accumulate(groups.get(key), sample);
  }
  return groups;
}

function printGroup(title, groups, limit = 10) {
  const rows = [...groups.entries()]
    .sort((a, b) => b[1].engineChars + b[1].hitChars - (a[1].engineChars + a[1].hitChars))
    .slice(0, limit);

  console.log(`\n== ${title} ==`);
  for (const [key, totals] of rows) {
    const label = key.length > 38 ? `${key.slice(0, 35)}…` : key;
    const allChars = totals.hitChars + totals.engineChars;
    console.log(
      `${label.padEnd(40)} chunks=${String(totals.chunks).padStart(5)}  ` +
        `字符命中=${pct(totals.hitChars, allChars).padStart(6)}  ` +
        `计费字符=${compactNumber(totals.engineChars).padStart(7)}`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const config = resolveConfig(args);

  console.log(
    `[tm-hit-rate] service=${config.serviceId} owner=${config.ownerId} hours=${args.hours}` +
      (args.shop ? ` shop=${args.shop}` : "") +
      (args.target ? ` target=${args.target}` : ""),
  );

  const all = await fetchTmSamples(config, args.hours);
  const samples = all.filter(
    (sample) =>
      (!args.shop || sample.shop === args.shop) &&
      (!args.target || sample.target === args.target),
  );

  if (args.json) {
    console.log(JSON.stringify(samples, null, 2));
    return;
  }

  if (samples.length === 0) {
    console.log(
      "没有采到 [tm] 样本。确认目标环境已部署本次 translation-core 改动，且时间窗内跑过翻译任务。",
    );
    return;
  }

  const totals = samples.reduce(accumulate, emptyTotals());
  const allChars = totals.hitChars + totals.engineChars;

  console.log(`\n== 总览（${totals.chunks} 个 chunk）==`);
  console.log(`字符命中率（成本口径）   ${pct(totals.hitChars, allChars)}`);
  console.log(`次数命中率               ${pct(totals.hits, totals.lookups)}`);
  console.log(`缓存省下字符             ${compactNumber(totals.hitChars)}`);
  console.log(`送进引擎的计费字符       ${compactNumber(totals.engineChars)}`);
  console.log(`引擎请求数               ${totals.llmRequests}`);
  if (totals.llmRequests > 0) {
    const perReq = Math.round(totals.engineChars / totals.llmRequests);
    console.log(
      `每次请求携带正文         ${perReq} chars` +
        (perReq < 1200
          ? `  ← 偏低：system prompt 约 2.6k chars，正文越少 prompt 占比越高`
          : ""),
    );
  }

  console.log(`\n== 分层命中 ==`);
  for (const tier of TIERS) {
    const t = totals.tiers[tier];
    console.log(
      `${TIER_LABELS[tier].padEnd(14)} 查=${String(t.lookups).padStart(7)}  ` +
        `中=${String(t.hits).padStart(7)}  ` +
        `命中率=${pct(t.hits, t.lookups).padStart(6)}  ` +
        `省字符=${compactNumber(t.hitChars).padStart(7)}`,
    );
  }

  printGroup("目标语言", groupBy(samples, (s) => s.target));
  printGroup("店铺", groupBy(samples, (s) => s.shop));
  printGroup("AI 模型", groupBy(samples, (s) => s.aiModel));

  const disabled = samples.filter((s) => s.cacheDisabled).length;
  if (disabled > 0) {
    console.log(
      `\n注意：${disabled} 个 chunk 显式禁用了 TM 读（自定义提示词 / 手动重译），已计入计费字符但不计命中。`,
    );
  }
}

main().catch((error) => {
  console.error(`[tm-hit-rate] 失败：${error.message}`);
  process.exitCode = 1;
});
