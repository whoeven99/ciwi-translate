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
import { AUTO_TRANSLATE_V4_MODULES, expandAutoTranslateV2ModuleKeys, normalizeAutoTranslateV2Modules } from "./moduleCatalog.js";
import {
  getAutoScanLastSuccessAt,
  setAutoScanLastAt,
  setAutoScanLastSuccessAt,
} from "./redisV4.js";
import {
  currentSlotIndex,
  getAutoTranslateMaxCatchupScans,
  getAutoTranslateMaxNewJobsPerScan,
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
import {
  filterAutoV2ModulesForPlan,
  resolveShopPlanEntitlements,
  clampAutoTranslateIntervalHours,
  autoTranslateCooldownMsForInterval,
  isAutoTranslateHourSlotMatch,
  type PlanEntitlements,
} from "./planEntitlements.js";

/** 自动任务模块默认集（不含 EMAIL / LOCALE_CONTENT / liquid）。 */
const DEFAULT_AUTO_MODULES = [...AUTO_TRANSLATE_V4_MODULES];

function resolveAutoModules(
  raw: unknown,
  entitlements: PlanEntitlements,
): string[] {
  const keys = normalizeAutoTranslateV2Modules(raw);
  if (keys) {
    const filtered = filterAutoV2ModulesForPlan(keys, entitlements);
    const expanded = expandAutoTranslateV2ModuleKeys(filtered);
    if (expanded.length > 0) return expanded;
  }

  if (entitlements.allowedV2Modules?.length) {
    const expanded = expandAutoTranslateV2ModuleKeys([
      ...entitlements.allowedV2Modules,
    ]);
    if (expanded.length > 0) return expanded;
  }

  return DEFAULT_AUTO_MODULES.filter(
    (mod) => !(mod === "METAFIELD" && !entitlements.allowMetafield),
  );
}

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
 * - 对齐时刻 + 间隔：商户选下次对齐小时与间隔（1/12/24，受套餐最短限制）；
 *   当前小时落在对齐周期内且冷却已过才建任务。
 * - 冷却 = 商户所选间隔小时；分槽关闭时 Free/Basic 可回退旧 SHOP_COOLDOWN。
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
  const fallbackShopCooldownMs = getAutoTranslateShopCooldownMs();
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

  for (const {
    shop,
    primaryLocale,
    targets,
    autoTranslateHour,
    autoTranslateIntervalHours,
    autoTranslateModules,
  } of shops) {
    if (maxNewJobs > 0 && created >= maxNewJobs) {
      cappedOut = true;
      break;
    }

    let source = primaryLocale?.trim();
    if (!source || !Array.isArray(targets) || targets.length === 0) continue;

    const entitlements = await resolveShopPlanEntitlements(shop);
    const intervalHours = clampAutoTranslateIntervalHours(
      autoTranslateIntervalHours,
      entitlements,
    );
    const cooldownMs = !sharding
      ? Math.max(
          fallbackShopCooldownMs,
          autoTranslateCooldownMsForInterval(intervalHours),
        )
      : autoTranslateCooldownMsForInterval(intervalHours);

    const alignHour =
      autoTranslateHour != null
        ? autoTranslateHour
        : shopSlotIndex(shop, slotsPerDay);

    if (
      !isAutoTranslateHourSlotMatch({
        currentSlot: curSlot,
        alignHour,
        intervalHours,
      })
    ) {
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

    // 整店冷却：按商户所选间隔。FAILED 不计入冷却。
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

    const autoModules = resolveAutoModules(autoTranslateModules, entitlements);
    if (autoModules.length === 0) continue;

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
          modules: autoModules,
          aiModel: autoAiModel(),
          limitPerType: Number.MAX_SAFE_INTEGER,
          isCover: false,
          isHandle: false,
          // auto 永不带 liquid
          includeLiquid: false,
          taskSource: TSF_AUTO_TASK_SOURCE,
          status: "INIT_QUEUED",
          blobPrefix: `tasks/v4/${shop}/${jobId}`,
          createdBy: "auto",
        });
        await pushHint("init", { taskId: jobId, shopName: shop }, "auto");
        created++;
        console.log(
          `${prefix} 建任务 id=${jobId} shop=${shop} ${source}→${target}` +
            ` plan=${entitlements.tier} interval=${intervalHours}h` +
            ` align=${alignHour} modules=${autoModules.length}`,
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
      ` 跳过(非对齐槽)=${skippedSlot}` +
      ` 跳过(无账户)=${skippedNoAccount}` +
      ` 跳过(店冷却)=${skippedShopCooldown}` +
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
