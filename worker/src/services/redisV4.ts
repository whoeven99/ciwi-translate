import IORedis from "ioredis";
import {
  getRenderKvUrl,
  isRenderKvSoleClientMode,
  warnIfMigrationEnvIncomplete,
  wrapRedisPair,
} from "./redisDualClient.js";

let _redis: IORedis | undefined;
let _lastRedisErrorLogAt = 0;
let _redisConnectionName: string | undefined;

function normalizeEnvValue(value: string | undefined): string {
  if (value == null) return "";
  let v = String(value).trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

function isProductionNodeEnv(): boolean {
  const env = normalizeEnvValue(process.env.NODE_ENV).toLowerCase();
  return env === "prod" || env === "production";
}

/** 默认 tsf-worker-prod / tsf-worker-test；可用 REDIS_CONNECTION_NAME 覆盖。 */
function resolveRedisConnectionName(kind: "primary" | "secondary" = "primary"): string {
  const override = process.env.REDIS_CONNECTION_NAME?.trim();
  const base = override
    ? override
    : isProductionNodeEnv()
      ? "tsf-worker-prod"
      : "tsf-worker-test";
  return kind === "secondary" ? `${base}-render-kv` : base;
}

const REDIS_COMMON_OPTIONS = {
  maxRetriesPerRequest: 2,
  connectTimeout: 10_000,
  retryStrategy: (times: number) => Math.min(times * 500, 5_000),
} as const;

function redisClientOptions(kind: "primary" | "secondary" = "primary") {
  const connectionName = resolveRedisConnectionName(kind);
  if (kind === "primary") _redisConnectionName = connectionName;
  return {
    ...REDIS_COMMON_OPTIONS,
    connectionName,
  };
}

function attachRedisListeners(redis: IORedis, label: string): void {
  redis.on("error", (err: Error) => {
    const now = Date.now();
    if (now - _lastRedisErrorLogAt < 60_000) return;
    _lastRedisErrorLogAt = now;
    console.error(`[redisV4] ${label} connection error: ${err.message}`);
  });
  redis.on("connect", () => {
    const kind = label === "secondary" ? "secondary" : "primary";
    console.info(`[redisV4] ${label} connected (${resolveRedisConnectionName(kind)})`);
  });
  redis.on("reconnecting", () => {
    const now = Date.now();
    if (now - _lastRedisErrorLogAt < 60_000) return;
    _lastRedisErrorLogAt = now;
    console.warn(`[redisV4] ${label} reconnecting…`);
  });
}

function createPrimaryRedis(): IORedis {
  const url =
    process.env.REDIS_URL?.trim() ||
    process.env.REDIS_URL_V4?.trim();
  if (url) {
    const redis = new IORedis(url, redisClientOptions("primary"));
    attachRedisListeners(redis, "primary");
    return redis;
  }

  const host =
    process.env.REDIS_HOSTNAME?.trim() ||
    process.env.REDIS_HOST?.trim() ||
    process.env.REDISCACHEHOSTNAME?.trim();
  const password =
    process.env.REDIS_PASSWORD?.trim() ||
    process.env.REDISCACHEKEY?.trim();

  if (!host || !password) {
    throw new Error("Redis not configured: set REDIS_URL or REDIS_HOSTNAME + REDIS_PASSWORD");
  }

  const port = Number(process.env.REDIS_PORT?.trim() || "6380");
  const useTls = process.env.REDIS_TLS !== "false";

  const redis = new IORedis({
    host,
    port,
    password,
    tls: useTls ? {} : undefined,
    ...redisClientOptions("primary"),
  });
  attachRedisListeners(redis, "primary");
  return redis;
}

/**
 * Sole mode（REDIS_DUAL_WRITE off + REDIS_CUTOVER=all）→ 只连 RENDER_KV。
 * 否则 Primary = REDIS_URL*；Secondary = RENDER_KV。见 redisDualClient.ts。
 */
export function getRedis(): IORedis {
  if (_redis) return _redis;

  warnIfMigrationEnvIncomplete();

  if (isRenderKvSoleClientMode()) {
    const kvUrl = getRenderKvUrl();
    if (!kvUrl) {
      throw new Error(
        "Redis sole mode (REDIS_CUTOVER=all, REDIS_DUAL_WRITE off) requires RENDER_KV",
      );
    }
    console.info("[redisV4] sole client mode: RENDER_KV only (skip REDIS_URL*)");
    const redis = new IORedis(kvUrl, redisClientOptions("secondary"));
    attachRedisListeners(redis, "render-kv");
    _redis = redis;
    return _redis;
  }

  const primary = createPrimaryRedis();
  const secondaryUrl = getRenderKvUrl();
  if (!secondaryUrl) {
    _redis = primary;
    return _redis;
  }

  const secondary = new IORedis(secondaryUrl, redisClientOptions("secondary"));
  attachRedisListeners(secondary, "secondary");
  _redis = wrapRedisPair(primary, secondary);
  return _redis;
}

/** 启动时探测 Redis 连通性（不阻塞 worker 调度）。 */
export async function pingRedis(): Promise<boolean> {
  try {
    const pong = await getRedis().ping();
    return pong === "PONG";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[redisV4] ping failed: ${message}`);
    return false;
  }
}

/** Pipeline stages that use auto/manual split hint queues. */
export type HintPipelineStage = "init" | "translate" | "writeback";

/** 与 stagePool 一致：手动与自动互不抢占；claim 时 manual 优先。 */
export type HintPool = "manual" | "auto";

/**
 * 分池 hint key：`translate:v4:hint:{stage}:{manual|auto}`。
 * 旧的无池后缀 key 仅作部署过渡期 drain，见 LEGACY_HINT_KEYS。
 */
export function hintKeyForPool(
  stage: HintPipelineStage,
  pool: HintPool,
): string {
  return `translate:v4:hint:${stage}:${pool}`;
}

/** 部署前遗留的混合队列（auto/manual 未拆分）。claim 时仍会 drain，再按 job 归入正确池。 */
export const LEGACY_HINT_KEYS: Record<HintPipelineStage, string> = {
  init: "translate:v4:hint:init",
  translate: "translate:v4:hint:translate",
  writeback: "translate:v4:hint:writeback",
};

/** @deprecated 使用 hintKeyForPool；保留给脚本/探测兼容。 */
export const HINT_KEYS = {
  init: hintKeyForPool("init", "manual"),
  translate: hintKeyForPool("translate", "manual"),
  writeback: hintKeyForPool("writeback", "manual"),
  verify: "translate:v4:hint:verify",
  analysis: "translate:v4:hint:analysis",
} as const;

export type HintPayload = { taskId: string; shopName: string };
export type AnalysisHintPayload = {
  shopName: string;
  sourceLanguage: string;
  modules: string[];
  target?: "profile" | "glossary" | "both";
};

/** Worker 自动任务 taskSource；与 cosmosV4.TSF_AUTO_TASK_SOURCE 保持一致。 */
const AUTO_TASK_SOURCE = "TsFrontend-Auto";

export function hintPoolFromTaskSource(
  taskSource: string | null | undefined,
): HintPool {
  return taskSource === AUTO_TASK_SOURCE ? "auto" : "manual";
}

async function lpopHint(key: string): Promise<HintPayload | null> {
  try {
    const raw = await getRedis().lpop(key);
    if (!raw) return null;
    return JSON.parse(raw) as HintPayload;
  } catch {
    return null;
  }
}

/** 从指定池弹出一条 hint。 */
export async function popHint(
  stage: HintPipelineStage,
  pool: HintPool,
): Promise<HintPayload | null> {
  return lpopHint(hintKeyForPool(stage, pool));
}

/** 弹出遗留混合队列中的一条（部署过渡期）。 */
export async function popLegacyHint(
  stage: HintPipelineStage,
): Promise<HintPayload | null> {
  return lpopHint(LEGACY_HINT_KEYS[stage]);
}

/**
 * 新任务入队尾（FIFO），LPOP 队头消费。
 * pool 必填：manual / auto 分队列，互不干扰。
 */
export async function pushHint(
  stage: HintPipelineStage,
  payload: HintPayload,
  pool: HintPool,
): Promise<void> {
  try {
    await getRedis().rpush(
      hintKeyForPool(stage, pool),
      JSON.stringify(payload),
    );
  } catch {
    // best-effort
  }
}

/** Re-queue at the same pool's tail so LPOP head can pick a different shop next tick. */
export async function requeueHintTail(
  stage: HintPipelineStage,
  payload: HintPayload,
  pool: HintPool,
): Promise<void> {
  try {
    await getRedis().rpush(
      hintKeyForPool(stage, pool),
      JSON.stringify(payload),
    );
  } catch {
    // best-effort
  }
}

// ── 店铺画像扫描（Shop Profile Scan）hint 队列 ─────────────────────────────────
// 与翻译 v4 pipeline 解耦，独立 key。触发端 push、shopScanWorker 消费；
// 兜底靠 worker 轮询 Cosmos shop_scan_jobs（CREATED/QUEUED），hint 只做「立即唤醒」。
export const SHOP_SCAN_HINT_KEY = "tsf:shop_scan:hints";

export type ShopScanHintPayload = { scanId: string; shopName: string };

export async function popShopScanHint(): Promise<ShopScanHintPayload | null> {
  try {
    const raw = await getRedis().lpop(SHOP_SCAN_HINT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ShopScanHintPayload;
  } catch {
    return null;
  }
}

export async function pushShopScanHint(payload: ShopScanHintPayload): Promise<void> {
  try {
    await getRedis().lpush(SHOP_SCAN_HINT_KEY, JSON.stringify(payload));
  } catch {
    // best-effort
  }
}

/** Re-queue at tail so LPOP head can pick a different shop's hint next tick. */
export async function requeueShopScanHintTail(
  payload: ShopScanHintPayload,
): Promise<void> {
  try {
    await getRedis().rpush(SHOP_SCAN_HINT_KEY, JSON.stringify(payload));
  } catch {
    // best-effort
  }
}

const PROGRESS_TTL = 7 * 24 * 3600; // 7 days in seconds

export function progressKey(taskId: string): string {
  return `translate:v4:progress:${taskId}`;
}

export const AUTO_SCAN_LAST_AT_KEY = "translate:v4:auto_scan:last_at";
export const AUTO_SCAN_LAST_SUCCESS_AT_KEY =
  "translate:v4:auto_scan:last_success_at";

export async function setAutoScanLastAt(at: string): Promise<void> {
  try {
    await getRedis().set(AUTO_SCAN_LAST_AT_KEY, at);
  } catch {
    // best-effort
  }
}

export async function getAutoScanLastSuccessAt(): Promise<string | null> {
  try {
    const v = await getRedis().get(AUTO_SCAN_LAST_SUCCESS_AT_KEY);
    return v?.trim() || null;
  } catch {
    return null;
  }
}

export async function setAutoScanLastSuccessAt(at: string): Promise<void> {
  try {
    await getRedis().set(AUTO_SCAN_LAST_SUCCESS_AT_KEY, at);
  } catch {
    // best-effort
  }
}

export async function clearTaskRedis(taskId: string): Promise<void> {
  try {
    await getRedis().del(progressKey(taskId), controlKey(taskId));
  } catch {
    // best-effort
  }
}

/**
 * 任务运行时的外部控制键。外部（TSF/Spark 前端、运营、或额度耗尽逻辑）写入
 * "pause" / "cancel"，worker 在阶段中途的检查点读取后优雅中断。
 */
export function controlKey(taskId: string): string {
  return `translate:v4:control:${taskId}`;
}

export type V4Control = "pause" | "cancel" | null;

/** 读取任务的外部控制指令（无则 null）。 */
export async function readControl(taskId: string): Promise<V4Control> {
  try {
    const v = await getRedis().get(controlKey(taskId));
    return v === "pause" || v === "cancel" ? v : null;
  } catch {
    return null;
  }
}

/** 设置外部控制指令（TTL 1 天，避免残留）。 */
export async function setControl(
  taskId: string,
  action: "pause" | "cancel",
): Promise<void> {
  try {
    await getRedis().set(controlKey(taskId), action, "EX", 24 * 3600);
  } catch {
    // best-effort
  }
}

/** 清除控制指令（resume / 任务收尾时调用）。 */
export async function clearControl(taskId: string): Promise<void> {
  try {
    await getRedis().del(controlKey(taskId));
  } catch {
    // best-effort
  }
}

export async function setProgress(
  taskId: string,
  fields: Record<string, string | number>,
): Promise<void> {
  try {
    const redis = getRedis();
    const key = progressKey(taskId);
    const flat: string[] = [];
    for (const [k, v] of Object.entries(fields)) {
      flat.push(k, String(v));
    }
    flat.push("updatedAt", Date.now().toString());
    await redis.hset(key, ...flat);
    await redis.expire(key, PROGRESS_TTL);
  } catch {
    // best-effort
  }
}

export async function getProgress(
  taskId: string,
): Promise<Record<string, string>> {
  try {
    return await getRedis().hgetall(progressKey(taskId)) ?? {};
  } catch {
    return {};
  }
}

/**
 * 汇总页统计缓存键。TSF 汇总页直接读此 hash（field=module，value=JSON）。
 * 由 worker 任务完成时写入，TSF 缺失时现算并回写。
 */
export function itemsCountKey(shopName: string, locale: string): string {
  return `tsf:items_count:${shopName}:${locale}`;
}

/** 写入某 module 的统计（total/translated），随 hash 续期 TTL。 */
export async function setItemsCount(
  shopName: string,
  locale: string,
  module: string,
  value: { total: number; translated: number },
): Promise<boolean> {
  try {
    const redis = getRedis();
    const key = itemsCountKey(shopName, locale);
    await redis.hset(
      key,
      module,
      JSON.stringify({ ...value, updatedAt: new Date().toISOString() }),
    );
    await redis.expire(key, PROGRESS_TTL);
    return true;
  } catch {
    return false;
  }
}

const EMAIL_SEND_LOCK_TTL_SEC = 120;

function emailSendLockKey(shopName: string, pool: "manual" | "auto"): string {
  return `translate:v4:email:send-lock:${pool}:${shopName}`;
}

/** 发信前短锁，避免部署/多实例下同一店重复发成功/部分完成邮件。 */
export async function tryAcquireEmailSendLock(
  shopName: string,
  pool: "manual" | "auto",
): Promise<boolean> {
  try {
    const redis = getRedis();
    const result = await redis.set(
      emailSendLockKey(shopName, pool),
      String(Date.now()),
      "EX",
      EMAIL_SEND_LOCK_TTL_SEC,
      "NX",
    );
    return result === "OK";
  } catch {
    return true;
  }
}

export async function releaseEmailSendLock(
  shopName: string,
  pool: "manual" | "auto",
): Promise<void> {
  try {
    const redis = getRedis();
    await redis.del(emailSendLockKey(shopName, pool));
  } catch {
    // ignore
  }
}

const EMAIL_PENDING_TTL_SEC = 7 * 24 * 60 * 60;

/**
 * 待发邮件的店铺标记，emailWorker 据此走快路径，免掉每轮跨分区 DISTINCT。
 *
 * 用 Hash（field=shopName, value=标记时刻）而不是 Set：双写客户端的 RedisLike
 * 已支持 hset/hgetall/hdel，不必为 Set 命令再补一套双写实现。
 */
function emailPendingKey(pool: "manual" | "auto"): string {
  return `translate:v4:email:pending:${pool}`;
}

/**
 * 标记该店有待发邮件的任务。
 * 全程 best-effort：标记漏写只会退化到低频 Cosmos 兜底扫描，不会丢邮件。
 */
export async function markEmailPendingShop(
  shopName: string,
  pool: "manual" | "auto",
): Promise<void> {
  try {
    const redis = getRedis();
    const key = emailPendingKey(pool);
    await redis.hset(key, shopName, String(Date.now()));
    await redis.expire(key, EMAIL_PENDING_TTL_SEC);
  } catch {
    // ignore
  }
}

/** 快路径候选店；Redis 不可用时返回空，由兜底扫描接管。 */
export async function getEmailPendingShops(
  pool: "manual" | "auto",
): Promise<string[]> {
  try {
    return Object.keys(await getRedis().hgetall(emailPendingKey(pool)));
  } catch {
    return [];
  }
}

/** 确认该店确实已无待发任务后再清除标记（宁可多留一轮，不可漏发）。 */
export async function clearEmailPendingShop(
  shopName: string,
  pool: "manual" | "auto",
): Promise<void> {
  try {
    await getRedis().hdel(emailPendingKey(pool), shopName);
  } catch {
    // ignore
  }
}
