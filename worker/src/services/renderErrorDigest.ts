import {
  countTranslationJobsCreatedBetween,
  type TranslationJobWindowStats,
} from "./cosmosV4.js";

const LOG = "[renderErrDigest]";

/** Render workspace owner（whoeven's Workspace）。可用 RENDER_OWNER_ID 覆盖。 */
const DEFAULT_RENDER_OWNER_ID = "tea-csovfmhu0jms738qrra0";

/** 仅 prod：TSF Web + TSF Worker。 */
const PROD_RENDER_SERVICES = [
  {
    id: "srv-csp2931u0jms738sfmc0",
    label: "TSF Web PROD",
    dashboardPath: "web",
  },
  {
    id: "srv-d8sqas4vikkc73f5nbog",
    label: "TSF Worker PROD",
    dashboardPath: "worker",
  },
] as const;

const DEFAULT_INTERVAL_MS = 60 * 60_000;
const DEFAULT_LOOKBACK_MS = 60 * 60_000;
const DEFAULT_INITIAL_DELAY_MS = 3 * 60_000;
/** 与 autoTranslate 错峰：默认北京时间每小时 :45。 */
const DEFAULT_SCHEDULE_TZ = "Asia/Shanghai";
const DEFAULT_SCHEDULE_MINUTE = 45;
const MAX_PAGES = 10;
const PAGE_LIMIT = 100;
const TOP_ERRORS = 8;
const MESSAGE_PREVIEW_LEN = 160;
/** Prisma/Turso 多行栈拼合后的展示上限（飞书单条仍受整报 3900 限制）。 */
const DB_ERROR_PREVIEW_LEN = 420;
/** 残缺 Prisma error 行回拉邻近日志的时间窗（ms）。 */
const PRISMA_CONTEXT_WINDOW_MS = 1_500;
/** 每个 digest 窗口最多回拉几次邻近日志，避免 Render API 限流。 */
const MAX_PRISMA_CONTEXT_ENRICH = 8;

/**
 * 已知噪音，不计入汇总。
 * - AbortError：Remix fetcher 替换等预期中断
 * - npm error *：Render 重新部署 SIGTERM 旧容器时的 npm 包装级联（非业务故障）
 * - /assets/* No route matches：发版后旧 tab 仍请求上一版 hash chunk
 */
const IGNORE_MESSAGE_PATTERNS: RegExp[] = [
  /AbortError/i,
  /^npm error\b/i,
  /No route matches URL\s+"\/assets\//i,
  /data:\s*'Error: No route matches URL\s+"\/assets\//i,
  /error: Error: No route matches URL\s+"\/assets\//i,
  // auto-liquid 并发竞态：另一请求已写入同键；采集路径现按幂等处理，历史日志仍过滤
  /UNIQUE constraint failed: LiquidRule\.shop, LiquidRule\.languageCode, LiquidRule\.beforeTranslation/i,
];

/**
 * Render 常把多行 Prisma/LibSQL 栈拆成多条日志，且只有中间那行
 * 「Error occurred during query execution:」带 level=error，
 * SqliteError.message 落在相邻非 error 行——需要回拉拼合。
 */
const INCOMPLETE_QUERY_EXECUTION_RE =
  /^Error occurred during query execution:?\s*$/i;
const PRISMA_STACK_HINT_RE =
  /PrismaClient\w*Error|Invalid `prisma\.|ConnectorError\(|SQLITE_[A-Z_]+/i;

type RenderLogEntry = {
  id?: string;
  message?: string;
  timestamp?: string;
  labels?: Array<{ name: string; value: string }>;
};

type RenderLogsResponse = {
  hasMore?: boolean;
  logs?: RenderLogEntry[];
  nextStartTime?: string;
  nextEndTime?: string;
};

type ErrorBucket = {
  count: number;
  sample: string;
  sampleAt: string;
};

export function getRenderErrorDigestIntervalMs(): number {
  const n = Number(process.env.RENDER_ERROR_DIGEST_INTERVAL_MS);
  return n > 0 ? n : DEFAULT_INTERVAL_MS;
}

export function getRenderErrorDigestLookbackMs(): number {
  const n = Number(process.env.RENDER_ERROR_DIGEST_LOOKBACK_MS);
  return n > 0 ? n : DEFAULT_LOOKBACK_MS;
}

export function getRenderErrorDigestInitialDelayMs(): number {
  const n = Number(process.env.RENDER_ERROR_DIGEST_INITIAL_DELAY_MS);
  return n >= 0 ? n : DEFAULT_INITIAL_DELAY_MS;
}

/** digest 时钟对齐时区（默认 Asia/Shanghai，与 autoTranslate 同一套）。 */
export function getRenderErrorDigestScheduleTimezone(): string {
  return (
    process.env.RENDER_ERROR_DIGEST_TZ?.trim() || DEFAULT_SCHEDULE_TZ
  );
}

/** digest 每小时触发的分钟（默认 45，避开整点后管线高峰）。 */
export function getRenderErrorDigestScheduleMinute(): number {
  const n = Number(process.env.RENDER_ERROR_DIGEST_SCHEDULE_MINUTE);
  if (!Number.isFinite(n) || n < 0 || n > 59) {
    return DEFAULT_SCHEDULE_MINUTE;
  }
  return Math.floor(n);
}

export function isRenderErrorDigestEnabled(): boolean {
  const raw = process.env.RENDER_ERROR_DIGEST_ENABLED?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") {
    return false;
  }
  return Boolean(
    process.env.RENDER_API_KEY?.trim() &&
      process.env.FEISHU_WEBHOOK_URL_RENDER_DIGEST?.trim(),
  );
}

function resolveRenderOwnerId(): string {
  return process.env.RENDER_OWNER_ID?.trim() || DEFAULT_RENDER_OWNER_ID;
}

function resolveServiceLabel(resourceId: string): string {
  const hit = PROD_RENDER_SERVICES.find((s) => s.id === resourceId);
  return hit?.label ?? resourceId;
}

function labelValue(
  entry: RenderLogEntry,
  name: string,
): string | undefined {
  return entry.labels?.find((l) => l.name === name)?.value;
}

function normalizeErrorMessage(message: string): string {
  const sqlite = extractSqliteErrorMessage(message);
  const base = sqlite
    ? `${sqlite} ${message}`
    : message;
  return base
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "<ts>")
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, "<uuid>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MESSAGE_PREVIEW_LEN);
}

function shouldIgnoreMessage(message: string): boolean {
  return IGNORE_MESSAGE_PATTERNS.some((re) => re.test(message));
}

/** 从 Prisma/LibSQL 多行文本中抽出 SqliteError.message（含 capacity exceeded）。 */
export function extractSqliteErrorMessage(text: string): string | null {
  const someMsg = text.match(/message:\s*Some\("((?:\\.|[^"\\])*)"\)/);
  if (someMsg?.[1]) {
    return someMsg[1].replace(/\\"/g, '"').trim();
  }
  const sqliteLine = text.match(/SQLITE_[A-Z_]+:\s*[^\n)"']+/);
  if (sqliteLine?.[0]) return sqliteLine[0].trim();
  const capacity = text.match(
    /Server database capacity temporarily exceeded[^"\n]*/i,
  );
  if (capacity?.[0]) return capacity[0].trim();
  return null;
}

function needsPrismaContextEnrichment(message: string): boolean {
  if (INCOMPLETE_QUERY_EXECUTION_RE.test(message.trim())) return true;
  if (extractSqliteErrorMessage(message)) return false;
  // 只有 Prisma 头、没有 SqliteError 正文时也回拉
  return (
    /PrismaClient\w*Error/i.test(message) ||
    /Invalid `prisma\./i.test(message)
  ) && message.length < 280;
}

function formatDbErrorSample(stitched: string): string {
  const sqlite = extractSqliteErrorMessage(stitched);
  const compact = stitched.replace(/\s+/g, " ").trim();
  if (!sqlite) return compact.slice(0, DB_ERROR_PREVIEW_LEN);

  // 优先保留业务前缀（如 [storefront] liquid parse failed shop=...）+ SqliteError 全文
  const headMatch = compact.match(
    /^(\[[^\]]+\][^.]*?(?:failed|error)[^:]*:?\s*[^.]*?)(?:PrismaClient|Invalid `prisma\.|Error occurred|ConnectorError)/i,
  );
  const head = headMatch?.[1]?.trim();
  const sample = head ? `${head} ${sqlite}` : `${sqlite} | ${compact}`;
  return sample.slice(0, DB_ERROR_PREVIEW_LEN);
}

function stitchNearbyMessages(
  nearby: RenderLogEntry[],
  resourceId: string,
  centerMs: number,
): string | null {
  const parts: Array<{ t: number; text: string }> = [];
  for (const entry of nearby) {
    const rid = labelValue(entry, "resource");
    if (rid && rid !== resourceId) continue;
    const text = entry.message?.trim();
    if (!text) continue;
    const t = entry.timestamp ? Date.parse(entry.timestamp) : NaN;
    if (!Number.isFinite(t)) continue;
    if (Math.abs(t - centerMs) > PRISMA_CONTEXT_WINDOW_MS) continue;
    if (
      !PRISMA_STACK_HINT_RE.test(text) &&
      !INCOMPLETE_QUERY_EXECUTION_RE.test(text) &&
      !/\[storefront\].*(?:failed|error)/i.test(text) &&
      !/liquid parse failed/i.test(text)
    ) {
      continue;
    }
    parts.push({ t, text });
  }
  if (parts.length === 0) return null;
  parts.sort((a, b) => a.t - b.t);
  return parts.map((p) => p.text).join("\n");
}

function formatDigestTimeRange(start: Date, end: Date): string {
  const fmt = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${fmt.format(start)} ~ ${fmt.format(end)} (CST)`;
}

function buildLogsUrl(params: Record<string, string | string[]>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, item);
    } else {
      search.set(key, value);
    }
  }
  return `https://api.render.com/v1/logs?${search.toString()}`;
}

async function fetchRenderLogsPage(params: {
  apiKey: string;
  ownerId: string;
  resourceIds: string[];
  startTime: string;
  endTime: string;
  level?: string;
  direction?: "backward" | "forward";
  maxPages?: number;
  limit?: number;
}): Promise<RenderLogEntry[]> {
  const collected: RenderLogEntry[] = [];
  let cursorStart = params.startTime;
  let cursorEnd = params.endTime;
  const maxPages = params.maxPages ?? MAX_PAGES;
  const limit = params.limit ?? PAGE_LIMIT;
  const direction = params.direction ?? "backward";

  for (let page = 0; page < maxPages; page++) {
    const url = buildLogsUrl({
      ownerId: params.ownerId,
      resource: params.resourceIds,
      startTime: cursorStart,
      endTime: cursorEnd,
      ...(params.level ? { level: params.level } : {}),
      type: "app",
      direction,
      limit: String(limit),
    });

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${params.apiKey}` },
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 400);
      throw new Error(`Render logs ${res.status}: ${body}`);
    }

    const body = (await res.json()) as RenderLogsResponse;
    const batch = body.logs ?? [];
    collected.push(...batch);

    if (!body.hasMore || batch.length === 0) break;
    if (!body.nextStartTime || !body.nextEndTime) break;
    cursorStart = body.nextStartTime;
    cursorEnd = body.nextEndTime;
  }

  return collected;
}

async function fetchRenderErrorLogs(
  apiKey: string,
  ownerId: string,
  resourceIds: string[],
  startTime: string,
  endTime: string,
): Promise<RenderLogEntry[]> {
  return fetchRenderLogsPage({
    apiKey,
    ownerId,
    resourceIds,
    startTime,
    endTime,
    level: "error",
  });
}

/**
 * 对残缺的 Prisma「query execution」error 行，回拉同资源邻近日志，
 * 把 SqliteError.message（如 capacity temporarily exceeded）拼进 message。
 */
async function enrichIncompletePrismaErrors(
  apiKey: string,
  ownerId: string,
  logs: RenderLogEntry[],
): Promise<RenderLogEntry[]> {
  const out = logs.slice();
  const seenWindows = new Set<string>();
  let enrichCount = 0;

  for (let i = 0; i < logs.length; i++) {
    const entry = logs[i];
    const message = entry.message?.trim() ?? "";
    if (!needsPrismaContextEnrichment(message)) continue;

    const resourceId = labelValue(entry, "resource");
    const ts = entry.timestamp;
    if (!resourceId || !ts) continue;

    const centerMs = Date.parse(ts);
    if (!Number.isFinite(centerMs)) continue;

    const windowKey = `${resourceId}::${new Date(centerMs).toISOString().slice(0, 19)}`;
    if (seenWindows.has(windowKey)) continue;
    seenWindows.add(windowKey);
    if (enrichCount >= MAX_PRISMA_CONTEXT_ENRICH) break;
    enrichCount++;

    try {
      const nearby = await fetchRenderLogsPage({
        apiKey,
        ownerId,
        resourceIds: [resourceId],
        startTime: new Date(centerMs - PRISMA_CONTEXT_WINDOW_MS).toISOString(),
        endTime: new Date(centerMs + PRISMA_CONTEXT_WINDOW_MS).toISOString(),
        // 不带 level：SqliteError 正文常落在非 error 行
        direction: "forward",
        maxPages: 1,
        limit: 50,
      });
      const stitched = stitchNearbyMessages(nearby, resourceId, centerMs);
      if (!stitched || !extractSqliteErrorMessage(stitched)) {
        // 即使没抽到 SqliteError，只要拼到更长上下文也写回
        if (stitched && stitched.length > message.length + 20) {
          out[i] = { ...entry, message: formatDbErrorSample(stitched) };
        }
        continue;
      }
      out[i] = { ...entry, message: formatDbErrorSample(stitched) };
    } catch (err) {
      console.warn(`${LOG} prisma context enrich failed`, err);
    }
  }

  if (enrichCount > 0) {
    console.info(`${LOG} prisma context enrich attempts=${enrichCount}`);
  }
  return out;
}

function aggregateErrors(logs: RenderLogEntry[]): Map<string, ErrorBucket> {
  const buckets = new Map<string, ErrorBucket>();

  for (const entry of logs) {
    const message = entry.message?.trim();
    if (!message || shouldIgnoreMessage(message)) continue;

    const resourceId = labelValue(entry, "resource") ?? "unknown";
    const serviceLabel = resolveServiceLabel(resourceId);
    const key = `${serviceLabel}::${normalizeErrorMessage(message)}`;
    const timestamp = entry.timestamp ?? new Date().toISOString();
    const existing = buckets.get(key);
    if (existing) {
      existing.count++;
      // 若后到的样本含 SqliteError 全文而当前 sample 没有，升级 sample
      if (
        extractSqliteErrorMessage(message) &&
        !extractSqliteErrorMessage(existing.sample)
      ) {
        existing.sample = message.slice(
          0,
          Math.max(MESSAGE_PREVIEW_LEN, DB_ERROR_PREVIEW_LEN),
        );
      }
      continue;
    }
    const previewLen = extractSqliteErrorMessage(message)
      ? DB_ERROR_PREVIEW_LEN
      : MESSAGE_PREVIEW_LEN;
    buckets.set(key, {
      count: 1,
      sample: message.slice(0, previewLen),
      sampleAt: timestamp,
    });
  }

  return buckets;
}

function buildFeishuReport(
  start: Date,
  end: Date,
  buckets: Map<string, ErrorBucket>,
  rawTotal: number,
  jobStats: TranslationJobWindowStats | null,
): string {
  const total = [...buckets.values()].reduce((sum, b) => sum + b.count, 0);
  const lines = [
    "【Render PROD 错误汇总】",
    `窗口：${formatDigestTimeRange(start, end)}`,
    `error 日志 ${rawTotal} 条，去重后 ${total} 条`,
    "",
    "翻译任务（按创建时间）：",
    ...(jobStats
      ? [
          `- 自动翻译：成功 ${jobStats.auto.completed} / 进行中 ${jobStats.auto.active} / 失败 ${jobStats.auto.failed} / 总数 ${jobStats.auto.total}`,
          `- 手动翻译：成功 ${jobStats.manual.completed} / 进行中 ${jobStats.manual.active} / 失败 ${jobStats.manual.failed} / 总数 ${jobStats.manual.total}`,
        ]
      : ["- Cosmos 统计暂不可用"]),
    "",
  ];

  const ranked = [...buckets.entries()].sort(
    (a, b) => b[1].count - a[1].count,
  );

  if (ranked.length === 0) {
    lines.push("（本窗口无 error 日志）");
    return lines.join("\n");
  }

  let shown = 0;
  for (const [key, bucket] of ranked) {
    if (shown >= TOP_ERRORS) break;
    const serviceLabel = key.split("::")[0] ?? "unknown";
    lines.push(`${shown + 1}. [${serviceLabel}] ×${bucket.count}`);
    lines.push(`   ${bucket.sample}`);
    shown++;
  }

  if (ranked.length > TOP_ERRORS) {
    lines.push("");
    lines.push(`… 另有 ${ranked.length - TOP_ERRORS} 类错误未展开`);
  }

  lines.push("");
  lines.push("Dashboard:");
  for (const svc of PROD_RENDER_SERVICES) {
    lines.push(
      `- ${svc.label}: https://dashboard.render.com/${svc.dashboardPath}/${svc.id}`,
    );
  }

  return lines.join("\n").slice(0, 3900);
}

async function sendFeishuDigest(message: string): Promise<void> {
  const webhookUrl = process.env.FEISHU_WEBHOOK_URL_RENDER_DIGEST?.trim();
  if (!webhookUrl) {
    console.info(`${LOG} skipped reason=no_webhook`);
    return;
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      const waitMs = 3000 * attempt;
      console.warn(`${LOG} feishu retry ${attempt}/2 waiting ${waitMs}ms`);
      await new Promise((r) => setTimeout(r, waitMs));
    }

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        msg_type: "text",
        content: { text: message },
      }),
    });

    const text = await res.text();
    let body: { code?: number; msg?: string };
    try {
      body = JSON.parse(text) as { code?: number; msg?: string };
    } catch {
      body = { msg: text.slice(0, 200) };
    }

    if (res.ok && (body.code === undefined || body.code === 0)) return;

    // 11232 = frequency limited，等几秒重试通常能过
    if (body.code === 11232 && attempt < 2) continue;

    throw new Error(
      `Feishu webhook failed http=${res.status} body=${JSON.stringify(body).slice(0, 200)}`,
    );
  }
}

/** 拉取 prod Render app error 日志和翻译任务统计，汇总后发送飞书。 */
export async function runRenderErrorDigest(): Promise<void> {
  if (!isRenderErrorDigestEnabled()) {
    return;
  }

  const apiKey = process.env.RENDER_API_KEY?.trim();
  if (!apiKey) {
    console.info(`${LOG} skipped reason=no_render_api_key`);
    return;
  }

  const lookbackMs = getRenderErrorDigestLookbackMs();
  const end = new Date();
  const start = new Date(end.getTime() - lookbackMs);
  const ownerId = resolveRenderOwnerId();
  const resourceIds = PROD_RENDER_SERVICES.map((s) => s.id);

  console.info(
    `${LOG} start owner=${ownerId} window=${start.toISOString()}..${end.toISOString()}`,
  );

  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const [rawLogs, jobStats] = await Promise.all([
    fetchRenderErrorLogs(
      apiKey,
      ownerId,
      [...resourceIds],
      startIso,
      endIso,
    ),
    countTranslationJobsCreatedBetween(startIso, endIso).catch((err) => {
      console.warn(`${LOG} translation job stats unavailable`, err);
      return null;
    }),
  ]);

  const logs = await enrichIncompletePrismaErrors(
    apiKey,
    ownerId,
    rawLogs,
  );
  const buckets = aggregateErrors(logs);
  const errorCount = [...buckets.values()].reduce((sum, b) => sum + b.count, 0);

  const report = buildFeishuReport(start, end, buckets, logs.length, jobStats);
  await sendFeishuDigest(report);
  console.info(
    `${LOG} sent feishu errors=${errorCount} raw=${logs.length}` +
      (jobStats
        ? ` auto=✅${jobStats.auto.completed}🔄${jobStats.auto.active}❌${jobStats.auto.failed}/${jobStats.auto.total} manual=✅${jobStats.manual.completed}🔄${jobStats.manual.active}❌${jobStats.manual.failed}/${jobStats.manual.total}`
        : " jobStats=unavailable"),
  );
}
