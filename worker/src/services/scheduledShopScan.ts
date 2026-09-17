import { randomUUID } from "node:crypto";
import {
  currentSlotIndex,
  getAutoTranslateIntervalMs,
  getAutoTranslateScheduleTimezone,
  getAutoTranslateShardCooldownMs,
  getAutoTranslateSlotsPerDay,
  resolveNextClockAlignedScanAt,
  shopSlotIndex,
} from "./autoScanSchedule.js";
import {
  createShopScanJob,
  getLatestMetricsScanCreatedAt,
  hasActiveShopScan,
} from "./shopScanCosmos.js";
import { pushShopScanHint } from "./redisV4.js";
import {
  hasTsfDbCredentials,
  listScannableShops,
} from "./tsfDb.js";
import { isShopAutoCooldownElapsed } from "./cosmosV4.js";

/** 整店冷却默认 20h（与 auto 分槽冷却同量级；可用 SHOP_SCAN_SHARD_COOLDOWN_MS 覆盖）。 */
const SHOP_SCAN_SHARD_COOLDOWN_MS_DEFAULT = 20 * 60 * 60_000;
/** scheduled shop scan 默认每小时 :30（与 auto 的 :00 错开）。 */
export const SHOP_SCAN_SCHEDULE_MINUTE_DEFAULT = 30;

export function isShopScanScheduleEnabled(): boolean {
  const raw = process.env.SHOP_SCAN_SCHEDULE_ENABLED?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") {
    return false;
  }
  return true;
}

/** 每小时触发分钟（0–59）；默认 30，可用 SHOP_SCAN_SCHEDULE_MINUTE 覆盖。 */
export function getShopScanScheduleMinute(): number {
  const n = Number(process.env.SHOP_SCAN_SCHEDULE_MINUTE);
  if (!Number.isFinite(n) || n < 0 || n > 59) {
    return SHOP_SCAN_SCHEDULE_MINUTE_DEFAULT;
  }
  return Math.floor(n);
}

export function getShopScanShardCooldownMs(): number {
  const n = Number(process.env.SHOP_SCAN_SHARD_COOLDOWN_MS);
  if (n > 0) return n;
  // 未单独配置时与 auto 分槽冷却对齐，避免两套默认值漂移。
  return getAutoTranslateShardCooldownMs() || SHOP_SCAN_SHARD_COOLDOWN_MS_DEFAULT;
}

/** 单次 tick 最多入队数（0 = 不限制）。 */
export function getShopScanMaxEnqueuePerTick(): number {
  const n = Number(process.env.SHOP_SCAN_MAX_ENQUEUE_PER_TICK);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * 当前小时槽位为 S 时，scheduled scan 处理上一小时 auto 槽的店：
 * shopSlotIndex === (S - 1 + slots) % slots
 */
export function scheduledShopScanTargetSlot(
  currentSlot: number,
  slotsPerDay: number,
): number {
  const slots = Math.max(1, Math.floor(slotsPerDay));
  return (currentSlot - 1 + slots) % slots;
}

function buildScanId(shop: string): string {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `${shop}-${stamp}-${randomUUID().slice(0, 8)}`;
}

async function enqueueScheduledShopScan(shop: string): Promise<string> {
  const scanId = buildScanId(shop);
  const blobPrefix = `shop-profile/${shop}`;
  await createShopScanJob({
    scanId,
    shopName: shop,
    trigger: "scheduled",
    blobPrefix,
  });
  await pushShopScanHint({ scanId, shopName: shop });
  return scanId;
}

export type ScheduledShopScanOptions = {
  /** 强制使用该「当前」槽位（诊断用；目标店槽仍为 current-1）。 */
  currentSlotIndex?: number;
  scanAt?: Date;
};

/**
 * 定时计量 shop scan：与自动翻译同一套 24 槽 / 时区，槽位延后 1 小时；
 * 触发分钟独立（默认 :30，auto 默认 :00）。
 *
 * - 每小时 :30 tick（SHOP_SCAN_SCHEDULE_MINUTE，默认 30）。
 * - 当前槽 S 只入队 shopSlotIndex === (S-1)%slots 的店。
 * - trigger=scheduled → worker 只跑 contentSize + coverage。
 * - 整店冷却默认 ~20h，每店约每天一轮。
 */
export async function runScheduledShopScan(
  options: ScheduledShopScanOptions = {},
): Promise<void> {
  if (!isShopScanScheduleEnabled()) {
    console.log("[scheduledShopScan] 未启用（SHOP_SCAN_SCHEDULE_ENABLED=false）");
    return;
  }
  if (!hasTsfDbCredentials()) {
    console.log("[scheduledShopScan] TSF Turso 未配置（TURSO_DATABASE_URL / TURSO_AUTH_TOKEN），跳过");
    return;
  }
  if (
    !process.env.COSMOS_ENDPOINT?.trim() ||
    !process.env.COSMOS_KEY?.trim()
  ) {
    console.log("[scheduledShopScan] Cosmos 未配置，跳过");
    return;
  }

  const slotsPerDay = getAutoTranslateSlotsPerDay();
  const scanAt = options.scanAt ?? new Date();
  const curSlot =
    options.currentSlotIndex ?? currentSlotIndex(scanAt, slotsPerDay);
  const targetSlot = scheduledShopScanTargetSlot(curSlot, slotsPerDay);
  const cooldownMs = getShopScanShardCooldownMs();
  const maxEnqueue = getShopScanMaxEnqueuePerTick();

  const shops = await listScannableShops();
  if (shops.length === 0) {
    console.log("[scheduledShopScan] 无可扫店（Account + offline token）");
    return;
  }

  let enqueued = 0;
  let skippedSlot = 0;
  let skippedActive = 0;
  let skippedCooldown = 0;
  let cappedOut = false;

  for (const shop of shops) {
    if (maxEnqueue > 0 && enqueued >= maxEnqueue) {
      cappedOut = true;
      break;
    }

    if (shopSlotIndex(shop, slotsPerDay) !== targetSlot) {
      skippedSlot++;
      continue;
    }

    if (await hasActiveShopScan(shop)) {
      skippedActive++;
      continue;
    }

    const lastAt = await getLatestMetricsScanCreatedAt(shop);
    if (!isShopAutoCooldownElapsed(lastAt, cooldownMs)) {
      skippedCooldown++;
      continue;
    }

    try {
      const scanId = await enqueueScheduledShopScan(shop);
      enqueued++;
      console.log(
        `[scheduledShopScan] 入队 scanId=${scanId} shop=${shop} trigger=scheduled`,
      );
    } catch (err) {
      console.error(`[scheduledShopScan] 入队失败 shop=${shop}`, err);
    }
  }

  console.log(
    `[scheduledShopScan] 完成：店=${shops.length}` +
      ` 当前槽=${curSlot}/${slotsPerDay} 目标槽(auto-1)=${targetSlot}` +
      ` 入队=${enqueued}` +
      ` 跳过(非本槽)=${skippedSlot}` +
      ` 跳过(进行中)=${skippedActive}` +
      ` 跳过(冷却<${cooldownMs / 3600_000}h)=${skippedCooldown}` +
      (cappedOut ? ` [达单次上限 ${maxEnqueue}，剩余顺延下轮]` : "") +
      ` 下次≈${resolveNextClockAlignedScanAt(
        new Date(),
        getAutoTranslateIntervalMs(),
        getAutoTranslateScheduleTimezone(),
        getShopScanScheduleMinute(),
      ).toISOString()}`,
  );
}

/** Scheduler 对齐入口（默认每小时 :30）。 */
export async function runScheduledShopScanTick(): Promise<void> {
  await runScheduledShopScan();
}
