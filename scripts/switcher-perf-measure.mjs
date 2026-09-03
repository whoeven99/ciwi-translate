#!/usr/bin/env node
/**
 * Switcher 店面性能采集 / 对比（优化前后）。
 *
 * 用本机 Chrome CDP，不改扩展默认行为。
 * 产物：scripts/tmp/switcher-perf/{label}/{run}.json（gitignore）
 *
 *   node scripts/switcher-perf-measure.mjs --label before --runs 5
 *   node scripts/switcher-perf-measure.mjs --label after --runs 5
 *   node scripts/switcher-perf-measure.mjs --compare
 */

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_ROOT = path.join(REPO_ROOT, "scripts", "tmp", "switcher-perf");
const DEFAULT_URL =
  "https://ciwishop.myshopify.com/zh-hans/products/diving-mens-long-sleeved-swimsuit-surfing-suit?variant=45347912515607";
const DEFAULT_REQUIRE_LOCALES = ["zh-hans", "zh-cn"];
const PASSWORD = "123456";
const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

const PROBE_SOURCE = `(() => {
  const perf = {
    longTasks: [],
    lcpMs: null,
    navStart: Date.now(),
  };
  try { localStorage.setItem("ciwi_debug_liquid_translate", "0"); } catch {}
  try { localStorage.setItem("ciwi_selected_language", "zh-CN"); } catch {}
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.entryType === "longtask") {
          perf.longTasks.push({
            startMs: Math.round(e.startTime),
            durMs: Math.round(e.duration),
          });
        }
        if (e.entryType === "largest-contentful-paint") {
          perf.lcpMs = Math.round(e.startTime);
        }
      }
    });
    po.observe({ type: "longtask", buffered: true });
    po.observe({ type: "largest-contentful-paint", buffered: true });
  } catch {}
  window.__ciwiPerf = perf;
})();`;

function parseArgs(argv) {
  const out = {
    label: "",
    url: DEFAULT_URL,
    runs: 5,
    start: 1,
    waitMs: 10000,
    port: 9223,
    compare: false,
    beforeDir: "",
    afterDir: "",
    requireLocale: DEFAULT_REQUIRE_LOCALES,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--label":
        out.label = String(next() || "").trim();
        break;
      case "--url":
        out.url = String(next() || "").trim();
        break;
      case "--runs":
        out.runs = Math.max(1, Number(next()) || 5);
        break;
      case "--start":
        out.start = Math.max(1, Number(next()) || 1);
        break;
      case "--wait-ms":
        out.waitMs = Math.max(1000, Number(next()) || 10000);
        break;
      case "--port":
        out.port = Number(next()) || 9223;
        break;
      case "--require-locale":
        out.requireLocale = String(next() || "")
          .split(/[,|]/)
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
        break;
      case "--compare":
        out.compare = true;
        break;
      case "--before":
        out.beforeDir = String(next() || "").trim();
        break;
      case "--after":
        out.afterDir = String(next() || "").trim();
        break;
      case "-h":
      case "--help":
        out.help = true;
        break;
      default:
        throw new Error(`Unknown flag: ${a}`);
    }
  }
  return out;
}

function findChrome() {
  const hit = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!hit) throw new Error("Chrome / Edge not found");
  return hit;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

function summarizeRun(raw) {
  const long = Array.isArray(raw.longTasks) ? raw.longTasks : [];
  const in2s = long.filter((t) => t.startMs < 2000);
  const in5s = long.filter((t) => t.startMs < 5000);
  const maxLong = in2s.reduce((m, t) => Math.max(m, t.durMs || 0), 0);
  const maxLong5 = in5s.reduce((m, t) => Math.max(m, t.durMs || 0), 0);
  const tbt = in2s.reduce((s, t) => s + Math.max(0, (t.durMs || 0) - 50), 0);
  const tbt5 = in5s.reduce((s, t) => s + Math.max(0, (t.durMs || 0) - 50), 0);
  const scan = raw.autoLiquidScan || {};
  return {
    lcpMs: raw.lcpMs ?? null,
    maxLongTask0to2sMs: maxLong || 0,
    maxLongTask0to5sMs: maxLong5 || 0,
    longTaskCount0to2s: in2s.length,
    longTaskCount0to5s: in5s.length,
    tbt0to2sMs: tbt,
    tbt0to5sMs: tbt5,
    collectStartMs: raw.collectStartMs ?? null,
    collectElapsedMs: scan.elapsedMs ?? null,
    collectNodes: scan.nodes ?? null,
    hasCountdownGate: Boolean(raw.hasCountdownGate),
    locale: raw.locale || "",
    path: raw.path || "",
    jsHeapUsedKb: raw.jsHeapUsedKb ?? null,
    jsHeapTotalKb: raw.jsHeapTotalKb ?? null,
    domNodes: raw.domNodes ?? null,
    jsEventListeners: raw.jsEventListeners ?? null,
  };
}

function loadLabelDir(dir) {
  const abs = path.isAbsolute(dir) ? dir : path.join(OUT_ROOT, dir);
  if (!existsSync(abs)) throw new Error(`missing dir: ${abs}`);
  const files = readdirSync(abs).filter((f) => f.endsWith(".json") && f !== "summary.json");
  const rows = files.map((f) => {
    const raw = JSON.parse(readFileSync(path.join(abs, f), "utf8"));
    return summarizeRun(raw.metrics || raw);
  });
  if (!rows.length) throw new Error(`no runs in ${abs}`);
  return rows;
}

function metricCol(rows, key) {
  return rows.map((r) => r[key]).filter((v) => typeof v === "number" && Number.isFinite(v));
}

function printCompare(beforeRows, afterRows) {
  const keys = [
    ["lcpMs", "LCP"],
    ["maxLongTask0to2sMs", "0–2s 最长 long task"],
    ["maxLongTask0to5sMs", "0–5s 最长 long task"],
    ["tbt0to2sMs", "0–2s TBT 近似"],
    ["tbt0to5sMs", "0–5s TBT 近似"],
    ["longTaskCount0to2s", "0–2s long task 数"],
    ["longTaskCount0to5s", "0–5s long task 数"],
    ["collectStartMs", "采集启动"],
    ["collectElapsedMs", "采集 elapsedMs"],
    ["jsHeapUsedKb", "JS 堆 used KB"],
    ["jsHeapTotalKb", "JS 堆 total KB"],
    ["domNodes", "DOM 节点数"],
    ["jsEventListeners", "JS 监听器数"],
  ];
  console.log(`runs  before=${beforeRows.length}  after=${afterRows.length}`);
  console.log(
    [
      "metric".padEnd(22),
      "before p50".padStart(12),
      "before p90".padStart(12),
      "after p50".padStart(12),
      "after p90".padStart(12),
      "p50 Δ".padStart(10),
    ].join(" "),
  );
  for (const [key, label] of keys) {
    const b = metricCol(beforeRows, key).sort((a, c) => a - c);
    const a = metricCol(afterRows, key).sort((x, y) => x - y);
    const bp50 = percentile(b, 50);
    const bp90 = percentile(b, 90);
    const ap50 = percentile(a, 50);
    const ap90 = percentile(a, 90);
    const delta = bp50 != null && ap50 != null ? ap50 - bp50 : null;
    const fmt = (n) => (n == null ? "—".padStart(12) : String(n).padStart(12));
    console.log(
      [
        label.padEnd(22),
        fmt(bp50),
        fmt(bp90),
        fmt(ap50),
        fmt(ap90),
        delta == null ? "—".padStart(10) : String(delta).padStart(10),
      ].join(" "),
    );
  }
}

class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.consoleEvents = [];
    this.networkUrls = [];
    this.loadWaiters = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
        return;
      }
      if (msg.method === "Page.loadEventFired") {
        this.loadWaiters.splice(0).forEach((fn) => fn());
      }
      if (msg.method === "Runtime.consoleAPICalled") {
        this.consoleEvents.push(msg.params);
      }
      if (msg.method === "Network.requestWillBeSent") {
        const url = String(msg.params?.request?.url || "");
        if (url.includes("liquid/collect")) {
          this.networkUrls.push({
            url,
            startMs: msg.params?.wallTime ? Math.round(msg.params.wallTime * 1000) : Date.now(),
          });
        }
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout ${method}`));
      }, 30000);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      this.ws.send(JSON.stringify(payload));
    });
  }

  waitForLoad(timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("load timeout")), timeoutMs);
      this.loadWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  async evaluate(expression) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res?.exceptionDetails) {
      throw new Error(res.exceptionDetails.text || "evaluate failed");
    }
    return res?.result?.value;
  }
}

function parseSetCookie(header) {
  const first = String(header || "").split(";")[0];
  const eq = first.indexOf("=");
  if (eq <= 0) return null;
  return { name: first.slice(0, eq).trim(), value: first.slice(eq + 1).trim() };
}

async function fetchStorefrontCookies(origin) {
  const passwordUrl = `${origin}/password`;
  const get = await fetch(passwordUrl, { redirect: "manual" });
  const html = await get.text();
  const token = html.match(/name="authenticity_token"[^>]*value="([^"]+)"/)?.[1] || "";
  const body = new URLSearchParams({
    password: PASSWORD,
    form_type: "storefront_password",
    utf8: "✓",
  });
  if (token) body.set("authenticity_token", token);
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const post = await fetch(passwordUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
        redirect: "manual",
      });
      const raw = typeof post.headers.getSetCookie === "function"
        ? post.headers.getSetCookie()
        : [post.headers.get("set-cookie")].filter(Boolean);
      const cookies = raw.map(parseSetCookie).filter(Boolean);
      if (!cookies.length) {
        throw new Error(`password POST got ${post.status} but no cookies`);
      }
      return { cookies, status: post.status, location: post.headers.get("location") || "" };
    } catch (err) {
      lastErr = err;
      await sleep(800 * attempt);
    }
  }
  throw lastErr || new Error("password fetch failed");
}

async function waitForJson(url, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {}
    await sleep(250);
  }
  throw new Error(`CDP not ready: ${url}`);
}

function localeMatches(actual, required) {
  const value = String(actual || "").trim().toLowerCase().replace(/_/g, "-");
  if (!value) return false;
  return required.some((want) => {
    if (value === want) return true;
    if (value.startsWith(`${want}-`) || value.includes(`/${want}`)) return true;
    if (want.startsWith("zh") && (value.startsWith("zh-hans") || value.startsWith("zh-cn"))) {
      return true;
    }
    return false;
  });
}

function isRequiredLocale(snapshot, required) {
  return [snapshot?.locale, snapshot?.htmlLang, snapshot?.languageCode, snapshot?.path].some((s) =>
    localeMatches(s, required),
  );
}

async function readLocaleSnapshot(cdp) {
  return cdp.evaluate(`({
    locale: window.Shopify?.locale || "",
    htmlLang: document.documentElement.lang || "",
    languageCode: document.querySelector('input[name="language_code"]')?.value || "",
    path: location.pathname,
  })`);
}

async function switchToZhHans(cdp, url) {
  const targetPath = `${new URL(url).pathname}${new URL(url).search}`;
  await cdp.evaluate(`(() => {
    try { localStorage.setItem("ciwi_selected_language", "zh-CN"); } catch {}
    const country = document.querySelector('input[name="country_code"]')?.value
      || window.Shopify?.country
      || "CN";
    const body = new URLSearchParams({
      _method: "PUT",
      country_code: country,
      language_code: "zh-CN",
      return_to: ${JSON.stringify(targetPath)},
    });
    return fetch("/localization", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      credentials: "same-origin",
      redirect: "manual",
    }).then((res) => ({ status: res.status }));
  })()`);
}

async function collectMemory(cdp) {
  await cdp.send("Performance.enable").catch(() => {});
  let heap = {};
  let metricMap = {};
  try {
    heap = (await cdp.send("Runtime.getHeapUsage")) || {};
  } catch {}
  try {
    const res = await cdp.send("Performance.getMetrics");
    metricMap = Object.fromEntries(
      (res?.metrics || []).map((m) => [m.name, m.value]),
    );
  } catch {}
  const pageMem = await cdp.evaluate(`({
    usedJSHeapSize: performance.memory?.usedJSHeapSize || 0,
    totalJSHeapSize: performance.memory?.totalJSHeapSize || 0,
    nodeCount: document.getElementsByTagName("*").length,
  })`);
  const usedBytes = heap.usedSize || metricMap.JSHeapUsedSize || pageMem.usedJSHeapSize || 0;
  const totalBytes = heap.totalSize || metricMap.JSHeapTotalSize || pageMem.totalJSHeapSize || 0;
  return {
    jsHeapUsedKb: Math.round(usedBytes / 1024),
    jsHeapTotalKb: Math.round(totalBytes / 1024),
    domNodes: Number(metricMap.Nodes || pageMem.nodeCount || 0),
    jsEventListeners: Number(metricMap.JSEventListeners || 0),
  };
}

function parseAutoLiquidScan(consoleEvents) {
  for (const ev of consoleEvents) {
    const args = (ev.args || []).map((a) => a.value ?? a.description ?? "");
    const text = args.join(" ");
    if (!text.includes("[ciwi-auto-liquid]") || !text.includes("scan")) continue;
    const obj = ev.args?.find((a) => a.type === "object" && a.preview)?.preview;
    const props = Object.fromEntries(
      (obj?.properties || []).map((p) => [p.name, p.value]),
    );
    return {
      elapsedMs: Number(props.elapsedMs) || null,
      nodes: Number(props.nodes) || null,
      candidateCount: Number(props.candidateCount) || null,
    };
  }
  return null;
}

function parseCollectStart(consoleEvents, navStart) {
  for (const ev of consoleEvents) {
    const args = (ev.args || []).map((a) => String(a.value ?? ""));
    const text = args.join(" ");
    if (!text.includes("[ciwi-auto-liquid]")) continue;
    if (!text.includes("start") && !text.includes("scan_roots")) continue;
    const ts = ev.timestamp ? ev.timestamp * 1000 : null;
    if (ts && navStart) return Math.round(ts - navStart);
  }
  return null;
}

async function measureOnce({ chromePath, url, waitMs, port, profileDir, requireLocale }) {
  if (existsSync(profileDir)) {
    rmSync(profileDir, { recursive: true, force: true });
  }
  mkdirSync(profileDir, { recursive: true });

  const child = spawn(
    chromePath,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-sync",
      "about:blank",
    ],
    { stdio: "ignore", windowsHide: true },
  );

  try {
    await waitForJson(`http://127.0.0.1:${port}/json/version`);
    const targets = await waitForJson(`http://127.0.0.1:${port}/json/list`);
    const page = (Array.isArray(targets) ? targets : []).find(
      (t) => t.type === "page" && t.webSocketDebuggerUrl,
    );
    if (!page) throw new Error("no page target");
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve);
      ws.addEventListener("error", () => reject(new Error("CDP ws error")));
    });
    const cdp = new CdpClient(ws);

    const origin = new URL(url).origin;
    const unlocked = await fetchStorefrontCookies(origin);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    for (const cookie of unlocked.cookies) {
      await cdp.send("Network.setCookie", {
        name: cookie.name,
        value: cookie.value,
        domain: new URL(url).hostname,
        path: "/",
        secure: true,
      });
    }
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: PROBE_SOURCE,
    });
    const loaded = cdp.waitForLoad(20000).catch(() => null);
    await cdp.send("Page.navigate", { url });
    await loaded;
    await sleep(800);
    const landed = await cdp.evaluate(`({
      path: location.pathname,
      href: location.href,
    })`);
    if (String(landed?.path || "").includes("/password")) {
      throw new Error(`still on password after cookie inject: ${landed?.href}`);
    }

    const required = Array.isArray(requireLocale) && requireLocale.length
      ? requireLocale
      : DEFAULT_REQUIRE_LOCALES;
    let snapshot = await readLocaleSnapshot(cdp);
    if (!isRequiredLocale(snapshot, required)) {
      await switchToZhHans(cdp, url);
      cdp.consoleEvents.length = 0;
      cdp.networkUrls.length = 0;
      const reloaded = cdp.waitForLoad(20000).catch(() => null);
      await cdp.send("Page.navigate", { url });
      await reloaded;
      await sleep(1000);
      snapshot = await readLocaleSnapshot(cdp);
      if (!isRequiredLocale(snapshot, required)) {
        throw new Error(`locale still ${snapshot?.locale || snapshot?.path}, wanted zh-hans`);
      }
    }

    await sleep(waitMs);
    const metrics = await cdp.evaluate(`({
      ...(window.__ciwiPerf || {}),
      hasCountdownGate: typeof window.__ciwi_countdown_first_rescan_promise__ !== "undefined",
      locale: window.Shopify?.locale || document.documentElement.lang || "",
      path: location.pathname,
      href: location.href,
      hasSwitcher: Boolean(document.querySelector("ciwiswitcher-form, #ciwi-container, #main-box")),
      languageCode: document.querySelector('input[name="language_code"]')?.value || "",
      languageOptions: Array.from(
        document.querySelectorAll(".language_selector_header option, .option-item[data-type='language']"),
      ).map((el) => el.value || el.getAttribute("data-value") || el.textContent?.trim()).filter(Boolean),
    })`);
    Object.assign(metrics, await collectMemory(cdp));
    const navStart = metrics?.navStart || Date.now() - waitMs;
    metrics.autoLiquidScan = parseAutoLiquidScan(cdp.consoleEvents);
    metrics.collectStartMs = parseCollectStart(cdp.consoleEvents, navStart);
    if (!metrics.collectStartMs && cdp.networkUrls[0]) {
      metrics.collectStartMs = Math.max(0, cdp.networkUrls[0].startMs - navStart);
    }
    ws.close();
    return metrics;
  } finally {
    child.kill();
    await sleep(400);
  }
}

async function runMeasure(opts) {
  if (!opts.label) throw new Error("--label is required");
  const chromePath = findChrome();
  const labelDir = path.join(OUT_ROOT, opts.label);
  mkdirSync(labelDir, { recursive: true });
  const start = opts.start || 1;
  const end = start + opts.runs - 1;
  const summary = [];
  for (let i = start; i <= end; i++) {
    const profileDir = path.join(OUT_ROOT, `_chrome_${opts.label}_${i}`);
    process.stdout.write(`run ${i}/${end} ${opts.label} ... `);
    const metrics = await measureOnce({
      chromePath,
      url: opts.url,
      waitMs: opts.waitMs,
      port: opts.port + i,
      profileDir,
      requireLocale: opts.requireLocale,
    });
    const row = summarizeRun(metrics);
    summary.push(row);
    const file = path.join(labelDir, `run-${String(i).padStart(2, "0")}.json`);
    writeFileSync(
      file,
      JSON.stringify({ label: opts.label, url: opts.url, at: new Date().toISOString(), metrics, summary: row }, null, 2),
    );
    console.log(
      `lcp=${row.lcpMs} maxLong5=${row.maxLongTask0to5sMs} tbt5=${row.tbt0to5sMs} heap=${row.jsHeapUsedKb}KB nodes=${row.domNodes} locale=${row.locale} ${row.path}`,
    );
  }
  const allRows = readdirSync(labelDir)
    .filter((f) => /^run-\d+\.json$/.test(f))
    .sort()
    .map((f) => {
      const raw = JSON.parse(readFileSync(path.join(labelDir, f), "utf8"));
      return raw.summary || summarizeRun(raw.metrics || raw);
    });
  writeFileSync(path.join(labelDir, "summary.json"), JSON.stringify(allRows, null, 2));
  return labelDir;
}

function runCompare(opts) {
  const beforeDir = opts.beforeDir || "before";
  const afterDir = opts.afterDir || "after";
  printCompare(loadLabelDir(beforeDir), loadLabelDir(afterDir));
}

function usage() {
  return `Usage:
  node scripts/switcher-perf-measure.mjs --label before --runs 5
  node scripts/switcher-perf-measure.mjs --label after --runs 5
  node scripts/switcher-perf-measure.mjs --compare

Options:
  --url       Storefront URL (default: ciwishop product page)
  --wait-ms   Observe window after load (default 10000)
  --before / --after   Label dirs for --compare`;
}

const args = parseArgs(process.argv);
if (args.help) {
  console.log(usage());
  process.exit(0);
}
if (args.compare) {
  runCompare(args);
} else {
  runMeasure(args).catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
