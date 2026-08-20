/**
 * 过去 24 小时自动翻译（TsFrontend-Auto）每小时新建任务数。
 * 默认测环境；生产：--env=.env.prod
 * Usage: node worker/scripts/auto-tasks-24h-trend.mjs
 */
import { CosmosClient } from "@azure/cosmos";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadStackedEnv, resolveCosmos } from "../../scripts/lib/loadEnv.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const TZ = process.env.AUTO_TRANSLATE_SCHEDULE_TZ?.trim() || "Asia/Shanghai";
const AUTO = "TsFrontend-Auto";

function hourKeyInTz(iso, timeZone) {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const pick = (t) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${pick("year")}-${pick("month")}-${pick("day")} ${pick("hour")}:00`;
}

function buildLast24HourBuckets(now, timeZone) {
  const buckets = [];
  for (let i = 23; i >= 0; i--) {
    const t = new Date(now.getTime() - i * 60 * 60_000);
    buckets.push(hourKeyInTz(t.toISOString(), timeZone));
  }
  return [...new Set(buckets)];
}

const { env } = loadStackedEnv({ root });
const cosmos = resolveCosmos(env);
if (!cosmos.endpoint || !cosmos.key) {
  console.error("COSMOS env missing");
  process.exit(1);
}
const endpoint = cosmos.endpoint;
const key = cosmos.key;
const db = cosmos.databaseId;
const containerId = cosmos.containerId;

const now = new Date();
const since = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();

const client = new CosmosClient({ endpoint, key });
const container = client.database(db).container(containerId);

const { resources: jobs } = await container.items
  .query({
    query: `
      SELECT c.id, c.shopName, c.status, c.createdAt, c.taskSource, c.createdBy
      FROM c
      WHERE c.taskSource = @src AND c.createdAt >= @since
    `,
    parameters: [
      { name: "@src", value: AUTO },
      { name: "@since", value: since },
    ],
  })
  .fetchAll();

const bucketKeys = buildLast24HourBuckets(now, TZ);
const hourly = Object.fromEntries(bucketKeys.map((k) => [k, 0]));
const statusBreakdown = {};

for (const j of jobs) {
  const key = hourKeyInTz(j.createdAt, TZ);
  if (key in hourly) hourly[key]++;
  statusBreakdown[j.status] = (statusBreakdown[j.status] || 0) + 1;
}

const series = bucketKeys.map((hour) => ({
  hour,
  count: hourly[hour] ?? 0,
  label: hour.slice(5, 16).replace(" ", " "),
}));

const result = {
  generatedAt: now.toISOString(),
  timezone: TZ,
  since,
  taskSource: AUTO,
  note: "Cosmos 硬删即不存在；本统计仅含仍存活的自动任务",
  total: jobs.length,
  peakHour: series.reduce((a, b) => (b.count > a.count ? b : a), series[0]),
  statusBreakdown,
  hourly: series,
};

const outDir = resolve(__dirname, "out");
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, "auto-tasks-24h.json");
writeFileSync(outPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
