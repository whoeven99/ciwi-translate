import { randomUUID } from "node:crypto";
import {
  createJob,
  getLatestAutoJobCreatedAtForShop,
  hasActiveJobForTarget,
  isShopAutoCooldownElapsed,
  TSF_AUTO_TASK_SOURCE,
} from "./cosmosV4.js";
import { pushHint } from "./redisV4.js";
import {
  hasTsfDbCredentials,
  listAutoTranslateShops,
  getOfflineAccessTokenFromTsf,
  syncShopPrimaryLocaleInTsf,
  hasTsfAccount,
} from "./tsfDb.js";
import { fetchShopPrimaryLocale } from "./shopifyFetch.js";
import { AUTO_TRANSLATE_V4_MODULES } from "./moduleCatalog.js";
import {
  getAutoScanLastSuccessAt,
  setAutoScanLastAt,
  setAutoScanLastSuccessAt,
} from "./redisV4.js";
import {
  currentSlotIndex,
  getAutoTranslateMaxCatchupScans,
  getAutoTranslateMaxNewJobsPerScan,
  getAutoTranslateShardCooldownMs,
  getAutoTranslateShopCooldownMs,
  getAutoTranslateSlotsPerDay,
  isAutoTranslateShardingEnabled,
  listMissedClockAlignedScanAt,
  shopSlotIndex,
  resolveNextClockAlignedScanAt,
} from "./autoScanSchedule.js";
import {
  getTsfRemainingWithRetry,
  quotaEnforceEnabled,
} from "./tsfQuota.js";

/** 自动任务模块（不含 EMAIL_TEMPLATE、ONLINE_STORE_THEME_LOCALE_CONTENT）。 */
const AUTO_MODULES = [...AUTO_TRANSLATE_V4_MODULES];

export type AutoTranslateScanMode = "scheduled" | "catchup";

export type AutoTranslateScanOptions = {
  /** 分槽扫描时强制处理该槽位（补偿漏跑时使用）。 */
  slotIndex?: number;
  mode?: AutoTranslateScanMode;
  /** 日志/诊断用：本轮应对齐的扫描时刻。 */
  scanAt?: Date;
};

/** v4 自动翻译默认模型（与 TSF 手动任务 DEFAULT_AI_MODEL 一致；失败级联 Google）。 */
function autoAiModel(): string {
  return process.env.AUTO_TRANSLATE_AI_MODEL?.trim() || "deepseek-v4-flash";
}

function logPrefix(mode: AutoTranslateScanMode): string {
  return mode === "catchup" ? "[autoTranslate:catchup]" : "[autoTranslate]";
}

/**
 * 扫描 TSF 库中「开启自动翻译」的店，为每个 shop+target 创建
 * 自动更新任务（isCover=false，增量、不覆盖已翻译）。
 *
 * - 全局 scheduler 每小时扫描一次（AUTO_TRANSLATE_INTERVAL_MS，默认 1h）。
 * - 分槽打散（AUTO_TRANSLATE_SHARDING，默认开）：每个店按稳定 hash 固定到一天中
 *   的某个槽位（AUTO_TRANSLATE_SLOTS_PER_DAY，默认 24），扫描时只处理落在当前
 *   槽位的店，该店所有语言在同一小时一起创建；整店冷却
 *   AUTO_TRANSLATE_SHARD_COOLDOWN_MS（默认 20h）保证每店每天≈1 批。
 * - 分槽关闭时回退旧逻辑：整店按 AUTO_TRANSLATE_SHOP_COOLDOWN_MS（默认 3h）冷却。
 * - 各 shop+target 若已有进行中任务则单独跳过。
 * - AUTO_TRANSLATE_MAX_NEW_JOBS_PER_SCAN（默认 0=不限）：单次扫描新建上限，安全带。
 */
export async function runAutoTranslateScan(
  options: AutoTranslateScanOptions = {},
): Promise<void> {
  if (!hasTsfDbCredentials()) {
    console.log("[autoTranslate] TSF Turso 未配置（TURSO_DATABASE_URL / TURSO_AUTH_TOKEN），跳过自动扫描");
    return;
  }

  const mode = options.mode ?? "scheduled";
  const prefix = logPrefix(mode);
  const sharding = isAutoTranslateShardingEnabled();
  const slotsPerDay = getAutoTranslateSlotsPerDay();
  const scanAt = options.scanAt ?? new Date();
  const curSlot =
    options.slotIndex ??
    (sharding ? currentSlotIndex(scanAt) : currentSlotIndex());
  const shopCooldownMs = getAutoTranslateShopCooldownMs();
  const shardCooldownMs = getAutoTranslateShardCooldownMs();
  // 分槽开启时用整店每日冷却（≈20h）；关闭时用旧的短冷却（≈3h）。
  const cooldownMs = sharding ? shardCooldownMs : shopCooldownMs;
  const maxNewJobs = getAutoTranslateMaxNewJobsPerScan();

  const shops = await listAutoTranslateShops();
  if (shops.length === 0) {
    console.log(`${prefix} 无开启自动翻译的店`);
    await setAutoScanLastAt(new Date().toISOString());
    await setAutoScanLastSuccessAt(new Date().toISOString());
    return;
  }

  let created = 0;
  let skippedActive = 0;
  let skippedShopCooldown = 0;
  let skippedSlot = 0;
  let skippedNoQuota = 0;
  let skippedNoAccount = 0;
  let cappedOut = false;

  for (const { shop, primaryLocale, targets } of shops) {
    if (maxNewJobs > 0 && created >= maxNewJobs) {
      cappedOut = true;
      break;
    }

    let source = primaryLocale?.trim();
    if (!source || !Array.isArray(targets) || targets.length === 0) continue;

    // 分槽打散：整店按 hash 固定到某槽位，只在当前槽位处理（该店所有语言一起建）。
    if (sharding && shopSlotIndex(shop, slotsPerDay) !== curSlot) {
      skippedSlot++;
      continue;
    }

    // 无 TSF 账户的店铺不建自动任务（未付费/试用过期/已卸载）
    if (!(await hasTsfAccount(shop))) {
      skippedNoAccount++;
      continue;
    }

    if (quotaEnforceEnabled(TSF_AUTO_TASK_SOURCE)) {
      const remaining = await getTsfRemainingWithRetry(shop);
      if (remaining <= 0) {
        skippedNoQuota++;
        continue;
      }
    }

    // 整店冷却：分槽下≈每天一批；非分槽下≈每 3h 一批。FAILED 不计入冷却。
    const lastShopBatchAt = await getLatestAutoJobCreatedAtForShop(shop);
    if (!isShopAutoCooldownElapsed(lastShopBatchAt, cooldownMs)) {
      skippedShopCooldown++;
      continue;
    }

    const token = (await getOfflineAccessTokenFromTsf(shop)) ?? "";
    if (!token) {
      console.warn(`${prefix} ${shop} 在 TSF 无 offline token，跳过该店`);
      continue;
    }

    try {
      const livePrimary = await fetchShopPrimaryLocale(shop);
      if (livePrimary) {
        await syncShopPrimaryLocaleInTsf(shop, livePrimary);
        source = livePrimary;
      }
    } catch (err) {
      console.warn(
        `${prefix} ${shop} 读取 Shopify 默认语言失败，沿用 TSF 缓存`,
        err,
      );
    }

    for (const rawTarget of targets) {
      if (maxNewJobs > 0 && created >= maxNewJobs) {
        cappedOut = true;
        break;
      }

      const target = String(rawTarget).trim();
      if (!target || target === source) continue;

      if (await hasActiveJobForTarget(shop, source, target)) {
        skippedActive++;
        continue;
      }

      const jobId = randomUUID();
      try {
        await createJob({
          id: jobId,
          shopName: shop,
          source,
          target,
          modules: AUTO_MODULES,
          aiModel: autoAiModel(),
          limitPerType: Number.MAX_SAFE_INTEGER,
          isCover: false,
          isHandle: false,
          taskSource: TSF_AUTO_TASK_SOURCE,
          status: "INIT_QUEUED",
          blobPrefix: `tasks/v4/${shop}/${jobId}`,
          createdBy: "auto",
        });
        await pushHint("init", { taskId: jobId, shopName: shop }, "auto");
        created++;
        console.log(
          `${prefix} 建任务 id=${jobId} shop=${shop} ${source}→${target}`,
        );
      } catch (err) {
        console.error(
          `${prefix} 建任务失败 shop=${shop} ${source}→${target}`,
          err,
        );
      }
    }
  }

  const slotLabel = sharding ? `${curSlot}/${slotsPerDay}` : "off";
  const scanAtLabel =
    mode === "catchup" && options.scanAt
      ? ` 原定=${options.scanAt.toISOString()}`
      : "";
  console.log(
    `${prefix} 扫描完成：店=${shops.length} 槽位=${slotLabel} 新建=${created}${scanAtLabel}` +
      ` 跳过(非本槽店)=${skippedSlot}` +
      ` 跳过(无账户)=${skippedNoAccount}` +
      ` 跳过(店冷却<${cooldownMs / 3600_000}h)=${skippedShopCooldown}` +
      ` 跳过(额度不足)=${skippedNoQuota}` +
      ` 跳过(语言进行中)=${skippedActive}` +
      (cappedOut ? ` [达单次上限 ${maxNewJobs}，剩余顺延下轮]` : ""),
  );

  const completedAt = new Date().toISOString();
  await setAutoScanLastSuccessAt(completedAt);
  if (mode === "scheduled") {
    await setAutoScanLastAt(resolveNextClockAlignedScanAt().toISOString());
  }
}

/**
 * 整点 tick：先补偿漏掉的上一轮（默认上一小时槽位），再跑本轮定时扫描。
 */
export async function runAutoTranslateScanTick(): Promise<void> {
  const lastSuccessRaw = await getAutoScanLastSuccessAt();
  const lastSuccess = lastSuccessRaw ? new Date(lastSuccessRaw) : null;
  const maxCatchup = getAutoTranslateMaxCatchupScans();
  const missed = listMissedClockAlignedScanAt(lastSuccess, new Date(), maxCatchup);

  for (const at of missed) {
    const sharding = isAutoTranslateShardingEnabled();
    const slotIndex = sharding ? currentSlotIndex(at) : undefined;
    console.log(
      `[autoTranslate] 补偿漏跑扫描 原定=${at.toISOString()}` +
        (sharding ? ` 槽位=${slotIndex}` : ""),
    );
    try {
      await runAutoTranslateScan({
        slotIndex,
        mode: "catchup",
        scanAt: at,
      });
    } catch (err) {
      console.error(
        `[autoTranslate] 补偿扫描失败 原定=${at.toISOString()}，继续本轮定时扫描`,
        err,
      );
    }
  }

  await runAutoTranslateScan({ mode: "scheduled" });
}
