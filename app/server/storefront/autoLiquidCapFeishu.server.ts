import { sendFeishuTextMessage } from "~/server/feishu/sendFeishuTextMessage.server";
import { getTranslateV4RedisClient } from "~/server/translateV4/redis.server";

const LOG = "[auto-liquid:cap-feishu]";
/** 触顶通知去重：同一 shop 触顶期间只发一次；计数回落到上限以下时 DEL。 */
const CAP_FEISHU_KEY_PREFIX = "tsf:auto_liquid:cap_feishu:";
/** 安全网 TTL，防 key 泄漏长期占锁。 */
const CAP_FEISHU_TTL_SEC = 30 * 24 * 60 * 60;

export type AutoLiquidTotalCapFeishuParams = {
  shop: string;
  target: string;
  autoCount: number;
  totalCap: number;
};

function capFeishuKey(shop: string): string {
  return `${CAP_FEISHU_KEY_PREFIX}${shop}`;
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

export function buildAutoLiquidTotalCapFeishuMessage(
  params: AutoLiquidTotalCapFeishuParams,
): string {
  const lines = [
    "⚠️ 自定义 Liquid 采集达上限",
    "",
    `店铺: ${params.shop}`,
    `auto 总量: ${formatNumber(params.autoCount)} / 上限 ${formatNumber(params.totalCap)}`,
    `目标语: ${params.target}`,
    `时间: ${new Date().toISOString()}`,
    "说明: 店面采集已停止；可清理 junk、翻译写回 DONE，或调高 AUTO_LIQUID_TOTAL_CAP",
  ];
  return lines.join("\n");
}

function safeRedis(): ReturnType<typeof getTranslateV4RedisClient> | null {
  try {
    return getTranslateV4RedisClient();
  } catch {
    return null;
  }
}

/** 首次触顶 SET NX；Redis 不可用时仍尝试发（可能重复，优于完全漏报）。 */
async function claimAutoLiquidCapFeishuSlot(shop: string): Promise<boolean> {
  const redis = safeRedis();
  if (!redis) return true;
  try {
    const result = await redis.set(
      capFeishuKey(shop),
      "1",
      "EX",
      CAP_FEISHU_TTL_SEC,
      "NX",
    );
    return result === "OK";
  } catch (err) {
    console.warn(
      `${LOG} claim failed shop=${shop}; sending anyway`,
      err instanceof Error ? err.message : err,
    );
    return true;
  }
}

/** 计数低于上限时清锁，允许清理/写回后再次触顶时再通知。 */
export async function clearAutoLiquidCapFeishuSlotIfBelowCap(
  shop: string,
  autoCount: number,
  totalCap: number,
): Promise<void> {
  if (autoCount >= totalCap) return;
  const redis = safeRedis();
  if (!redis) return;
  try {
    await redis.del(capFeishuKey(shop));
  } catch {
    // ignore
  }
}

async function notifyAutoLiquidTotalCap(
  params: AutoLiquidTotalCapFeishuParams,
): Promise<void> {
  const claimed = await claimAutoLiquidCapFeishuSlot(params.shop);
  if (!claimed) {
    console.info(`${LOG} skip duplicate shop=${params.shop}`);
    return;
  }

  const result = await sendFeishuTextMessage(
    buildAutoLiquidTotalCapFeishuMessage(params),
  );
  if (!result.ok && !("skipped" in result && result.skipped)) {
    console.warn(`${LOG} send failed shop=${params.shop}`, result);
  }
}

/** 异步飞书；不阻塞 collect 响应。 */
export function scheduleAutoLiquidTotalCapFeishuNotify(
  params: AutoLiquidTotalCapFeishuParams,
): void {
  void notifyAutoLiquidTotalCap(params).catch((error) => {
    console.warn(`${LOG} unhandled shop=${params.shop}`, error);
  });
}
