import Redis from "ioredis";
import { isProductionNodeEnv } from "~/config/nodeEnv.server";
import {
  getRenderKvUrl,
  warnIfMigrationEnvIncomplete,
} from "@ciwi/translation-core/redis-dual-client";

/**
 * TsFrontend 专用 Redis 客户端。
 * 只连 `RENDER_KV`；未配置时回退 `REDIS_URL*`（本地脚本应急，生产勿用）。
 */
let singleton: Redis | undefined;

function resolveRedisConnectionName(kind: "primary" | "secondary"): string {
  const override = process.env.REDIS_CONNECTION_NAME?.trim();
  const base = override
    ? override
    : isProductionNodeEnv()
      ? "tsf-web-prod"
      : "tsf-web-test";
  return kind === "secondary" ? `${base}-render-kv` : base;
}

function redisClientOptions(kind: "primary" | "secondary" = "primary") {
  return {
    maxRetriesPerRequest: 2,
    connectTimeout: 10_000,
    connectionName: resolveRedisConnectionName(kind),
  } as const;
}

function createPrimaryRedis(): Redis {
  const url =
    process.env.REDIS_URL_V4?.trim() ||
    process.env.REDIS_URL?.trim();
  if (url) {
    return new Redis(url, redisClientOptions("primary"));
  }

  const host = process.env.REDIS_HOSTNAME_V4?.trim();
  const password = process.env.REDIS_PASSWORD_V4?.trim();

  if (!host || !password) {
    throw new Error(
      "Redis(V4) 未配置：请设置 REDIS_URL_V4，或 REDIS_HOSTNAME_V4 与 REDIS_PASSWORD_V4",
    );
  }

  const port = Number(process.env.REDIS_PORT_V4?.trim() || "6380");
  const useTls = process.env.REDIS_TLS_V4 !== "false";

  return new Redis({
    host,
    port,
    password,
    tls: useTls ? {} : undefined,
    ...redisClientOptions("primary"),
  });
}

export function getTranslateV4RedisClient(): Redis {
  if (singleton) return singleton;

  warnIfMigrationEnvIncomplete();

  const kvUrl = getRenderKvUrl();
  if (kvUrl) {
    console.info("[redis] RENDER_KV only");
    singleton = new Redis(kvUrl, redisClientOptions("secondary"));
    return singleton;
  }

  console.warn("[redis] RENDER_KV missing; falling back to REDIS_URL*");
  singleton = createPrimaryRedis();
  return singleton;
}

/** worker 各阶段的 hint 队列 key（manual/auto 分池，与 worker redisV4 一致）。 */
export type V4HintPool = "manual" | "auto";
export type V4HintStage = "init" | "translate" | "writeback" | "verify";

export function v4HintKey(
  stage: V4HintStage,
  pool: V4HintPool = "manual",
): string {
  if (stage === "verify") return "translate:v4:hint:verify";
  return `translate:v4:hint:${stage}:${pool}`;
}

/** worker 实时写入的进度 hash key。 */
export function v4ProgressKey(taskId: string): string {
  return `translate:v4:progress:${taskId}`;
}

/** 店铺画像扫描 hint 队列 key（与 worker redisV4.SHOP_SCAN_HINT_KEY 一致）。 */
export const SHOP_SCAN_HINT_KEY = "tsf:shop_scan:hints";

/** 触发端 push 一条扫描 hint，唤醒 shopScanWorker 立即处理。best-effort。 */
export async function pushShopScanHint(payload: {
  scanId: string;
  shopName: string;
}): Promise<void> {
  try {
    await getTranslateV4RedisClient().lpush(
      SHOP_SCAN_HINT_KEY,
      JSON.stringify(payload),
    );
  } catch {
    // best-effort：hint 只做立即唤醒，兜底靠 worker 轮询 Cosmos
  }
}

/** 运行时控制键：worker 在阶段中途读取后优雅暂停/取消。 */
export function v4ControlKey(taskId: string): string {
  return `translate:v4:control:${taskId}`;
}

export async function setV4Control(
  taskId: string,
  action: "pause" | "cancel",
): Promise<void> {
  try {
    await getTranslateV4RedisClient().set(v4ControlKey(taskId), action, "EX", 24 * 3600);
  } catch {
    // 尽力而为；即便失败，阶段结束后仍会依据 Cosmos 状态停止
  }
}

/** 删除任务时清掉该任务在 Redis 的进度键 + 控制键。best-effort。 */
export async function clearV4TaskRedis(taskId: string): Promise<void> {
  try {
    await getTranslateV4RedisClient().del(v4ProgressKey(taskId), v4ControlKey(taskId));
  } catch {
    // non-fatal
  }
}

export async function clearV4Control(taskId: string): Promise<void> {
  try {
    await getTranslateV4RedisClient().del(v4ControlKey(taskId));
  } catch {
    // non-fatal
  }
}

export type V4ControlAction = "pause" | "cancel";

/** 读取 worker 尚未消费的外部控制指令。 */
export async function readV4Control(
  taskId: string,
): Promise<V4ControlAction | null> {
  try {
    const v = await getTranslateV4RedisClient().get(v4ControlKey(taskId));
    return v === "pause" || v === "cancel" ? v : null;
  } catch {
    return null;
  }
}

const V4_PROGRESS_TTL_SEC = 7 * 24 * 3600;

/**
 * 用户点击暂停/取消后立刻写入 progress hash，让 UI 在 worker 轮询控制键之前
 * 就能显示「正在暂停…」（与 worker 的 persistAbortSoon 语义一致）。
 */
export async function setV4PausePending(
  taskId: string,
  reason: string,
): Promise<void> {
  try {
    const key = v4ProgressKey(taskId);
    await getTranslateV4RedisClient()
      .multi()
      .hset(
        key,
        "pausePending",
        "1",
        "pauseReason",
        reason,
        "pauseRequestedAt",
        String(Date.now()),
      )
      .expire(key, V4_PROGRESS_TTL_SEC)
      .exec();
  } catch {
    // best-effort
  }
}

export async function clearV4PausePending(taskId: string): Promise<void> {
  try {
    await getTranslateV4RedisClient().hdel(
      v4ProgressKey(taskId),
      "pausePending",
      "pauseReason",
      "pauseRequestedAt",
    );
  } catch {
    // non-fatal
  }
}
