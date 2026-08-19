/**
 * 过去 72 小时自动翻译任务趋势 — 每小时新建任务数 + 日环比
 * 默认测环境；生产：--env=.env.prod
 * Usage: node scripts/auto-tasks-72h-trend.mjs
 */
import { CosmosClient } from "@azure/cosmos";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadStackedEnv, resolveCosmos } from "./lib/loadEnv.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const TZ = process.env.AUTO_TRANSLATE_SCHEDULE_TZ?.trim() || "Asia/Shanghai";
const AUTO = "TsFrontend-Auto";
const HOURS = 96; // 4 days: Jul 7 00:00 ~ Jul 11 00:00 CST

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

function dayKeyInTz(iso, timeZone) {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const pick = (t) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

function buildHourBuckets(now, timeZone, hours) {
  const buckets = [];
  for (let i = hours - 1; i >= 0; i--) {
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

// Fixed range: Jul 7 00:00 ~ Jul 11 00:00 CST (4 full days)
const now = new Date("2026-07-11T00:00:00+08:00");
const since = new Date("2026-07-07T00:00:00+08:00").toISOString();

console.error(`Querying Cosmos from ${since} to ${now.toISOString()} ...`);

const client = new CosmosClient({ endpoint, key });
const container = client.database(db).container(containerId);

const { resources: jobs } = await container.items
  .query({
    query: `
      SELECT c.id, c.shopName, c.status, c.createdAt, c.taskSource
      FROM c
      WHERE c.taskSource = @src AND c.createdAt >= @since
    `,
    parameters: [
      { name: "@src", value: AUTO },
      { name: "@since", value: since },
    ],
  })
  .fetchAll();

console.error(`Found ${jobs.length} auto-translate jobs.`);

// --- Hourly buckets ---
const bucketKeys = buildHourBuckets(now, TZ, HOURS);
const hourly = Object.fromEntries(bucketKeys.map((k) => [k, 0]));
const hourlyShops = Object.fromEntries(bucketKeys.map((k) => [k, new Set()]));
const statusBreakdown = {};

for (const j of jobs) {
  const key = hourKeyInTz(j.createdAt, TZ);
  if (key in hourly) hourly[key]++;
  if (key in hourlyShops) hourlyShops[key].add(j.shopName);
  statusBreakdown[j.status] = (statusBreakdown[j.status] || 0) + 1;
}

// --- Hourly series ---
const hourlySeries = bucketKeys.map((hour) => ({
  hour,
  label: hour.slice(5, 16).replace(" ", " "),
  count: hourly[hour] ?? 0,
  shops: hourlyShops[hour]?.size ?? 0,
}));

// --- Daily aggregation + day-over-day ---
const daily = {};
for (const j of jobs) {
  const day = dayKeyInTz(j.createdAt, TZ);
  if (!daily[day]) daily[day] = { count: 0, shops: new Set() };
  daily[day].count++;
  daily[day].shops.add(j.shopName);
}

const dayKeys = Object.keys(daily).sort();
const dailySeries = [];
for (let i = 0; i < dayKeys.length; i++) {
  const day = dayKeys[i];
  const cur = { day, count: daily[day].count, shops: daily[day].shops.size };
  const prev = i > 0 ? dailySeries[i - 1] : null;
  let countChange = null;
  let countChangePct = null;
  if (prev) {
    countChange = cur.count - prev.count;
    countChangePct = prev.count > 0
      ? ((countChange / prev.count) * 100).toFixed(1)
      : null;
  }
  dailySeries.push({ ...cur, countChange, countChangePct });
}

// --- Output JSON ---
const result = {
  generatedAt: now.toISOString(),
  timezone: TZ,
  since,
  hours: HOURS,
  taskSource: AUTO,
  totalJobs: jobs.length,
  totalShops: new Set(jobs.map((j) => j.shopName)).size,
  peakHour: hourlySeries.reduce((a, b) => (b.count > a.count ? b : a), hourlySeries[0]),
  statusBreakdown,
  hourly: hourlySeries,
  daily: dailySeries,
};

const outDir = resolve(__dirname, "out");
mkdirSync(outDir, { recursive: true });
const jsonPath = resolve(outDir, "auto-tasks-7-10.json");
writeFileSync(jsonPath, JSON.stringify(result, null, 2));
console.error(`JSON saved to ${jsonPath}`);

// --- Generate standalone HTML chart ---
const chartDataJson = JSON.stringify(result);

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>自动翻译 72h 趋势</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
  .card { background: #fff; border-radius: 8px; padding: 20px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  h2 { margin: 0 0 8px 0; font-size: 16px; color: #333; }
  .summary { display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 8px; }
  .stat { text-align: center; }
  .stat .num { font-size: 28px; font-weight: 700; color: #1a73e8; }
  .stat .label { font-size: 12px; color: #666; }
  .chart-wrap { position: relative; height: 350px; }
  canvas { width: 100% !important; }
  .trend-up { color: #e74c3c; }
  .trend-down { color: #27ae60; }
</style>
</head>
<body>
<h1>📊 自动翻译 72 小时趋势</h1>
<p style="color:#666">时区: ${result.timezone} | 数据范围: ${result.since} → ${result.generatedAt} | 任务来源: ${result.taskSource}</p>

<div class="summary">
  <div class="stat"><div class="num">${result.totalJobs}</div><div class="label">72h 总任务数</div></div>
  <div class="stat"><div class="num">${result.totalShops}</div><div class="label">涉及店铺数</div></div>
  <div class="stat"><div class="num">${result.peakHour?.count ?? 0}</div><div class="label">峰值(每小时)</div></div>
  <div class="stat"><div class="num">${result.peakHour?.hour?.slice(11, 16) ?? '-'}</div><div class="label">峰值时段</div></div>
</div>

<div class="card">
  <h2>📈 每小时新建任务数</h2>
  <div class="chart-wrap"><canvas id="hourlyChart"></canvas></div>
</div>

<div class="card">
  <h2>📅 每日任务总量 &amp; 日环比变化</h2>
  <div class="chart-wrap"><canvas id="dailyChart"></canvas></div>
</div>

<div class="card">
  <h2>📋 状态分布</h2>
  <div class="chart-wrap" style="height:200px"><canvas id="statusChart"></canvas></div>
</div>

<script>
const data = ${chartDataJson};

// --- Hourly bar chart ---
new Chart(document.getElementById('hourlyChart'), {
  type: 'bar',
  data: {
    labels: data.hourly.map(h => h.label),
    datasets: [{
      label: '每小时任务数',
      data: data.hourly.map(h => h.count),
      backgroundColor: data.hourly.map((h, i) => {
        const d = data.daily.find(dd => h.hour.startsWith(dd.day));
        return d && d.countChange > 0 ? 'rgba(26,115,232,0.5)' : 'rgba(26,115,232,0.3)';
      }),
      borderColor: 'rgba(26,115,232,0.8)',
      borderWidth: 1,
    }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      tooltip: {
        callbacks: {
          afterLabel: ctx => '店铺数: ' + data.hourly[ctx.dataIndex].shops
        }
      }
    },
    scales: {
      y: { beginAtZero: true, title: { display: true, text: '任务数' } },
      x: { ticks: { maxTicksLimit: 36, maxRotation: 45 } }
    }
  }
});

// --- Daily bar + line chart ---
new Chart(document.getElementById('dailyChart'), {
  type: 'bar',
  data: {
    labels: data.daily.map(d => d.day.slice(5)),
    datasets: [
      {
        label: '任务数',
        data: data.daily.map(d => d.count),
        backgroundColor: 'rgba(26,115,232,0.5)',
        borderColor: 'rgba(26,115,232,0.8)',
        borderWidth: 1,
        yAxisID: 'y',
        order: 2,
      },
      {
        label: '日环比变化',
        data: data.daily.map(d => d.countChange ?? 0),
        type: 'line',
        borderColor: data.daily.map(d => (d.countChange ?? 0) >= 0 ? '#e74c3c' : '#27ae60'),
        backgroundColor: 'transparent',
        borderWidth: 2,
        pointRadius: 4,
        pointBackgroundColor: data.daily.map(d => (d.countChange ?? 0) >= 0 ? '#e74c3c' : '#27ae60'),
        yAxisID: 'y1',
        order: 1,
        tension: 0.3,
      }
    ]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      tooltip: {
        callbacks: {
          label: ctx => {
            if (ctx.datasetIndex === 1) {
              const d = data.daily[ctx.dataIndex];
              return '环比: ' + (d.countChange >= 0 ? '+' : '') + d.countChange + ' (' + (d.countChangePct ?? '-') + '%)';
            }
            return '任务数: ' + ctx.raw + ' (店铺: ' + data.daily[ctx.dataIndex].shops + ')';
          }
        }
      }
    },
    scales: {
      y: { beginAtZero: true, position: 'left', title: { display: true, text: '任务数' } },
      y1: { position: 'right', title: { display: true, text: '环比变化' }, grid: { drawOnChartArea: false } },
      x: { title: { display: true, text: '日期 (MM-DD)' } }
    }
  }
});

// --- Status pie ---
const statusLabels = Object.keys(data.statusBreakdown);
const statusColors = {
  COMPLETED: '#27ae60', TRANSLATING: '#1a73e8', WRITEBACK: '#f39c12',
  INIT_QUEUED: '#9b59b6', INITIALIZING: '#3498db', FAILED: '#e74c3c',
  CANCELED: '#95a5a6', PAUSED: '#e67e22'
};
new Chart(document.getElementById('statusChart'), {
  type: 'doughnut',
  data: {
    labels: statusLabels,
    datasets: [{
      data: statusLabels.map(k => data.statusBreakdown[k]),
      backgroundColor: statusLabels.map(k => statusColors[k] || '#bdc3c7'),
    }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'right' }
    }
  }
});
</script>
</body>
</html>`;

const htmlPath = resolve(outDir, "auto-tasks-7-10-chart.html");
writeFileSync(htmlPath, html);
console.error(`Chart saved to ${htmlPath}`);
console.log(`file:///${htmlPath.replace(/\\/g, "/")}`);
