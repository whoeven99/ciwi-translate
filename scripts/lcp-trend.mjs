/**
 * 首屏 LCP 归因趋势 —— 从 Render 运行日志聚合 `[perf][lcp]` 单行。
 *
 * 数据来源：`app/utils/lcpDiagnostics.ts`（客户端采集，sendBeacon → `/log`）
 * → `app/routes/log.tsx` 输出 `[perf][lcp] {json}`。
 *
 * Usage:
 *   node scripts/lcp-trend.mjs                      # 默认 prod、最近 24h
 *   node scripts/lcp-trend.mjs --hours=72
 *   node scripts/lcp-trend.mjs --route=/app         # 只看首页
 *   node scripts/lcp-trend.mjs --service=srv-xxx --env=.env.test
 *   node scripts/lcp-trend.mjs --json               # 输出原始样本，便于二次分析
 *
 * 只读脚本：不写任何库，不打印密钥（仅打印脱敏后的 service / owner id）。
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_OWNER_ID = "tea-csovfmhu0jms738qrra0";
const DEFAULT_WEB_SERVICE_ID = "srv-csp2931u0jms738sfmc0";
const LOG_PREFIX = "[perf][lcp] ";
const PAGE_LIMIT = 100;
const MAX_PAGES = 40;

function parseArgs(argv) {
  const args = { hours: 24, json: false, route: null, service: null, env: null };
  for (const raw of argv.slice(2)) {
    if (raw === "--json") {
      args.json = true;
      continue;
    }
    const match = raw.match(/^--([^=]+)=(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (key === "hours") args.hours = Math.max(1, Number(value) || 24);
    else if (key === "route") args.route = value;
    else if (key === "service") args.service = value;
    else if (key === "env") args.env = value;
  }
  return args;
}

function readEnvFile(fileName) {
  try {
    const text = readFileSync(resolve(__dirname, "..", fileName), "utf8");
    const env = {};
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index <= 0) continue;
      env[trimmed.slice(0, index).trim()] = trimmed
        .slice(index + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
    }
    return env;
  } catch {
    return {};
  }
}

function resolveConfig(args) {
  const fileEnv = readEnvFile(args.env || ".env");
  const apiKey = process.env.RENDER_API_KEY || fileEnv.RENDER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "缺少 RENDER_API_KEY（可放进环境变量，或用 --env=.env.prod 指定文件）",
    );
  }
  return {
    apiKey,
    ownerId:
      process.env.RENDER_OWNER_ID || fileEnv.RENDER_OWNER_ID || DEFAULT_OWNER_ID,
    serviceId:
      args.service ||
      process.env.RENDER_WEB_SERVICE_ID ||
      fileEnv.RENDER_WEB_SERVICE_ID ||
      DEFAULT_WEB_SERVICE_ID,
  };
}

async function fetchLcpSamples({ apiKey, ownerId, serviceId }, hours) {
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

function percentile(sorted, ratio) {
  if (sorted.length === 0) return null;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(ratio * sorted.length) - 1),
  );
  return sorted[index];
}

function summarizeMetric(values) {
  const sorted = values
    .filter((value) => typeof value === "number" && Number.isFinite(value))
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return {
    count: sorted.length,
    p50: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
    max: sorted[sorted.length - 1],
  };
}

function groupBy(samples, keyFn) {
  const groups = new Map();
  for (const sample of samples) {
    const key = keyFn(sample) ?? "unknown";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(sample);
  }
  return groups;
}

function formatMetricRow(label, summary) {
  if (!summary) return `${label.padEnd(22)} 无样本`;
  return (
    `${label.padEnd(22)} n=${String(summary.count).padStart(4)}  ` +
    `p50=${String(summary.p50).padStart(6)}  ` +
    `p75=${String(summary.p75).padStart(6)}  ` +
    `p90=${String(summary.p90).padStart(6)}  ` +
    `max=${String(summary.max).padStart(6)}`
  );
}

function printGroup(title, groups, limit = 8) {
  const rows = [...groups.entries()]
    .map(([key, items]) => ({
      key,
      count: items.length,
      lcp: summarizeMetric(items.map((item) => item.lcpMs)),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

  console.log(`\n== ${title} ==`);
  for (const row of rows) {
    const label = row.key.length > 60 ? `${row.key.slice(0, 57)}…` : row.key;
    console.log(
      `${label.padEnd(62)} n=${String(row.count).padStart(4)}  ` +
        `p50=${String(row.lcp?.p50 ?? "-").padStart(6)}  ` +
        `p75=${String(row.lcp?.p75 ?? "-").padStart(6)}`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const config = resolveConfig(args);

  console.log(
    `[lcp-trend] service=${config.serviceId} owner=${config.ownerId} hours=${args.hours}` +
      (args.route ? ` route=${args.route}` : ""),
  );

  const all = await fetchLcpSamples(config, args.hours);
  const samples = args.route
    ? all.filter((sample) => (sample.route ?? "").startsWith(args.route))
    : all;

  if (args.json) {
    console.log(JSON.stringify(samples, null, 2));
    return;
  }

  if (samples.length === 0) {
    console.log(
      "没有采到 [perf][lcp] 样本。确认目标环境已部署 lcpDiagnostics，且时间窗内有真实访问。",
    );
    return;
  }

  console.log(`\n== 阶段耗时（ms）${samples.length} 个样本 ==`);
  console.log(formatMetricRow("LCP", summarizeMetric(samples.map((s) => s.lcpMs))));
  console.log(formatMetricRow("FCP", summarizeMetric(samples.map((s) => s.fcpMs))));
  console.log(
    formatMetricRow("TTFB(文档首字节)", summarizeMetric(samples.map((s) => s.ttfbMs))),
  );
  console.log(
    formatMetricRow(
      "DOMContentLoaded",
      summarizeMetric(samples.map((s) => s.domContentLoadedMs)),
    ),
  );
  console.log(
    formatMetricRow(
      "最慢阻塞资源",
      summarizeMetric(samples.map((s) => s.slowestBlockingMs)),
    ),
  );

  printGroup(
    "冷加载 vs 热缓存",
    groupBy(samples, (s) =>
      s.coldLoad === true ? "cold（首次/缓存失效）" : s.coldLoad === false ? "warm（命中缓存）" : "unknown",
    ),
  );
  printGroup("LCP 元素", groupBy(samples, (s) => s.element));
  printGroup("路由", groupBy(samples, (s) => s.route?.split("?")[0]));
  printGroup("网络档位", groupBy(samples, (s) => s.effectiveType));
  printGroup("上报时机", groupBy(samples, (s) => s.reason));
}

main().catch((error) => {
  console.error(`[lcp-trend] 失败：${error.message}`);
  process.exitCode = 1;
});
