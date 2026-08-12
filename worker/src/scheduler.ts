import { runInitWorker } from "./workers/initWorker.js";
import { runTranslateWorker } from "./workers/translateWorker.js";
import { runWritebackWorker } from "./workers/writebackWorker.js";
import { runEmailWorker } from "./workers/emailWorker.js";
import { runShopScanWorker } from "./workers/shopScanWorker.js";
import {
  resetStaleShopScanJobs,
  wakeQueuedShopScanJobsAfterDeploy,
} from "./services/shopScanCosmos.js";
import {
  resetStaleJobs,
  wakeQueuedJobsAfterDeploy,
} from "./services/cosmosV4.js";
import { runAutoTranslateScanTick } from "./services/autoTranslate.js";
import {
  getShopScanScheduleMinute,
  isShopScanScheduleEnabled,
  runScheduledShopScanTick,
} from "./services/scheduledShopScan.js";
import { cleanupStaleEmptyAutoJobs } from "./services/cleanupEmptyAutoJobs.js";
import {
  cleanupOldTranslationJobs,
  getJobRetentionCleanupIntervalMs,
  getJobRetentionCleanupMinute,
  getJobRetentionCleanupTimezone,
  getJobRetentionDays,
  isJobRetentionCleanupEnabled,
  msUntilNextJobRetentionCleanup,
  resolveNextJobRetentionCleanupAt,
} from "./services/cleanupOldJobs.js";
import {
  cleanupOldShopScanJobs,
  getShopScanJobCleanupIntervalMs,
  getShopScanJobCleanupMinute,
  getShopScanJobCleanupTimezone,
  getShopScanJobRetentionDays,
  isShopScanJobCleanupEnabled,
  msUntilNextShopScanJobCleanup,
  resolveNextShopScanJobCleanupAt,
} from "./services/cleanupOldShopScanJobs.js";
import {
  cleanupOldAutoLiquidRules,
  getAutoLiquidRetentionDays,
  getAutoLiquidRetentionIntervalMs,
  getAutoLiquidRetentionMinute,
  getAutoLiquidRetentionTimezone,
  isAutoLiquidRetentionEnabled,
  msUntilNextAutoLiquidRetention,
  resolveNextAutoLiquidRetentionAt,
} from "./services/cleanupOldAutoLiquid.js";
import {
  runBillingSubscriptionNearDueReconcile,
  runBillingSubscriptionReconcile,
} from "./services/billingSubscriptionReconcile.js";
import {
  getRenderErrorDigestIntervalMs,
  getRenderErrorDigestScheduleMinute,
  getRenderErrorDigestScheduleTimezone,
  isRenderErrorDigestEnabled,
  runRenderErrorDigest,
} from "./services/renderErrorDigest.js";
import { isShuttingDown } from "./shutdown.js";
import { hostname } from "os";
import {
  getAutoTranslateIntervalMs,
  getAutoTranslateScheduleMinute,
  getAutoTranslateScheduleTimezone,
  msUntilNextClockAlignedScan,
  resolveNextClockAlignedScanAt,
} from "./services/autoScanSchedule.js";

/** 各 stage 轮询间隔；hint 队列有任务时仍靠上一阶段 wake 立即触发。 */
const POLL_INTERVAL_MS = Math.max(
  500,
  Number(process.env.WORKER_POLL_INTERVAL_MS) || 2_000,
);
const STALE_RESET_INTERVAL_MS = 5 * 60_000;
/** 空自动任务定时清理间隔（默认 6 小时）。 */
const AUTO_EMPTY_JOB_CLEANUP_INTERVAL_MS =
  Number(process.env.AUTO_EMPTY_JOB_CLEANUP_INTERVAL_MS) || 6 * 60 * 60_000;
/** 邮件通知发送间隔（默认 30 秒，可用 EMAIL_WORKER_INTERVAL_MS 覆盖）。 */
const EMAIL_WORKER_INTERVAL_MS = (() => {
  const n = Number(process.env.EMAIL_WORKER_INTERVAL_MS);
  return n > 0 ? n : 30_000;
})();
/** 订阅对账：默认每 12 小时在 worker 内对比 Shopify 周期并补续费。 */
const BILLING_SUBSCRIPTION_RECONCILE_INTERVAL_MS = Math.max(
  60_000,
  Number(process.env.BILLING_SUBSCRIPTION_RECONCILE_INTERVAL_MS) ||
    12 * 60 * 60_000,
);
/** 启动后首次对账延迟（默认 2 分钟，避免与 deploy 抢资源）。 */
const BILLING_SUBSCRIPTION_RECONCILE_INITIAL_DELAY_MS = Math.max(
  0,
  Number(process.env.BILLING_SUBSCRIPTION_RECONCILE_INITIAL_DELAY_MS) ||
    2 * 60_000,
);
const BILLING_SUBSCRIPTION_NEAR_DUE_RECONCILE_INTERVAL_MS = Math.max(
  60_000,
  Number(process.env.BILLING_SUBSCRIPTION_NEAR_DUE_RECONCILE_INTERVAL_MS) ||
    30 * 60_000,
);
const BILLING_SUBSCRIPTION_NEAR_DUE_RECONCILE_INITIAL_DELAY_MS = Math.max(
  0,
  Number(process.env.BILLING_SUBSCRIPTION_NEAR_DUE_RECONCILE_INITIAL_DELAY_MS) ||
    5 * 60_000,
);

/** 店铺画像扫描轮询间隔（默认 10 秒；hint 立即唤醒，轮询兜底）。 */
const SHOP_SCAN_POLL_INTERVAL_MS = Math.max(
  2_000,
  Number(process.env.SHOP_SCAN_POLL_INTERVAL_MS) || 10_000,
);

const ALL_STAGES = ["init", "translate", "writeback"] as const;
type Stage = (typeof ALL_STAGES)[number];

/**
 * Which pipeline stages this process runs. Defaults to all. Set WORKER_STAGES
 * to a comma list (e.g. "init,translate") to gate stages — useful for online
 * quality testing where writeback to the live store must be skipped.
 */
function enabledStages(): Set<Stage> {
  const raw = process.env.WORKER_STAGES?.trim();
  if (!raw) return new Set(ALL_STAGES);
  const requested = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is Stage => (ALL_STAGES as readonly string[]).includes(s));
  return new Set(requested.length > 0 ? requested : ALL_STAGES);
}

function safeRun(name: string, fn: () => Promise<void>): void {
  if (isShuttingDown()) return;
  fn().catch((e) => console.error(`[scheduler] ${name} error`, e));
}

function scheduleAutoTranslateScan(): void {
  const tz = getAutoTranslateScheduleTimezone();
  const intervalMs = getAutoTranslateIntervalMs();
  const minute = getAutoTranslateScheduleMinute();

  const scheduleNext = () => {
    const waitMs = msUntilNextClockAlignedScan();
    const nextAt = resolveNextClockAlignedScanAt();
    console.log(
      `[scheduler] autoTranslate 下次扫描 ${nextAt.toISOString()} (tz=${tz}, :${String(minute).padStart(2, "0")}, interval=${intervalMs}ms)`,
    );
    setTimeout(() => {
      if (isShuttingDown()) return;
      void (async () => {
        try {
          await runAutoTranslateScanTick();
        } catch (err) {
          console.error("[scheduler] autoTranslate error", err);
        } finally {
          if (!isShuttingDown()) scheduleNext();
        }
      })();
    }, waitMs);
  };

  scheduleNext();
}

/**
 * scheduled shop scan：与 auto 同时区 / 分槽，触发分钟独立（默认 :30），槽位延后 1h。
 */
function scheduleScheduledShopScan(): void {
  if (!isShopScanScheduleEnabled()) {
    console.log(
      "[scheduler] scheduledShopScan 未启用（SHOP_SCAN_SCHEDULE_ENABLED=false）",
    );
    return;
  }

  const tz = getAutoTranslateScheduleTimezone();
  const intervalMs = getAutoTranslateIntervalMs();
  const minute = getShopScanScheduleMinute();

  const scheduleNext = () => {
    const waitMs = msUntilNextClockAlignedScan(
      new Date(),
      intervalMs,
      tz,
      minute,
    );
    const nextAt = resolveNextClockAlignedScanAt(
      new Date(),
      intervalMs,
      tz,
      minute,
    );
    console.log(
      `[scheduler] scheduledShopScan 下次扫描 ${nextAt.toISOString()} (tz=${tz}, :${String(minute).padStart(2, "0")}, interval=${intervalMs}ms, slot=auto-1h)`,
    );
    setTimeout(() => {
      if (isShuttingDown()) return;
      void (async () => {
        try {
          await runScheduledShopScanTick();
        } catch (err) {
          console.error("[scheduler] scheduledShopScan error", err);
        } finally {
          if (!isShuttingDown()) scheduleNext();
        }
      })();
    }, waitMs);
  };

  scheduleNext();
}

function scheduleBillingSubscriptionReconcile(): void {
  const tick = () => {
    safeRun("billingSubscriptionReconcile", runBillingSubscriptionReconcile);
  };
  console.log(
    `[scheduler] billingSubscriptionReconcile 每 ${BILLING_SUBSCRIPTION_RECONCILE_INTERVAL_MS}ms，首次 ${BILLING_SUBSCRIPTION_RECONCILE_INITIAL_DELAY_MS}ms 后`,
  );
  setTimeout(() => {
    tick();
    setInterval(tick, BILLING_SUBSCRIPTION_RECONCILE_INTERVAL_MS);
  }, BILLING_SUBSCRIPTION_RECONCILE_INITIAL_DELAY_MS);
}

function scheduleBillingSubscriptionNearDueReconcile(): void {
  const tick = () => {
    safeRun(
      "billingSubscriptionNearDueReconcile",
      runBillingSubscriptionNearDueReconcile,
    );
  };
  console.log(
    `[scheduler] billingSubscriptionNearDueReconcile every ${BILLING_SUBSCRIPTION_NEAR_DUE_RECONCILE_INTERVAL_MS}ms, first after ${BILLING_SUBSCRIPTION_NEAR_DUE_RECONCILE_INITIAL_DELAY_MS}ms`,
  );
  setTimeout(() => {
    tick();
    setInterval(tick, BILLING_SUBSCRIPTION_NEAR_DUE_RECONCILE_INTERVAL_MS);
  }, BILLING_SUBSCRIPTION_NEAR_DUE_RECONCILE_INITIAL_DELAY_MS);
}

function scheduleRenderErrorDigest(): void {
  if (!isRenderErrorDigestEnabled()) {
    console.log(
      "[scheduler] renderErrDigest 未启用（需 RENDER_API_KEY + FEISHU_WEBHOOK_URL_RENDER_DIGEST）",
    );
    return;
  }

  // 与 autoTranslate（CST :00）错峰：默认 Asia/Shanghai 每小时 :45。
  const tz = getRenderErrorDigestScheduleTimezone();
  const intervalMs = getRenderErrorDigestIntervalMs();
  const minute = getRenderErrorDigestScheduleMinute();

  const scheduleNext = () => {
    const waitMs = msUntilNextClockAlignedScan(
      new Date(),
      intervalMs,
      tz,
      minute,
    );
    const nextAt = resolveNextClockAlignedScanAt(
      new Date(),
      intervalMs,
      tz,
      minute,
    );
    console.log(
      `[scheduler] renderErrDigest 下次汇总 ${nextAt.toISOString()} (tz=${tz}, :${String(minute).padStart(2, "0")}, interval=${intervalMs}ms)`,
    );
    setTimeout(() => {
      if (isShuttingDown()) return;
      safeRun("renderErrDigest", runRenderErrorDigest);
      if (!isShuttingDown()) scheduleNext();
    }, waitMs);
  };

  scheduleNext();
}

/** 每小时 :50 清理过期 shop_scan_jobs（保留每店最新 COMPLETED/PARTIAL）。 */
function scheduleShopScanJobCleanup(): void {
  if (!isShopScanJobCleanupEnabled()) {
    console.log(
      "[scheduler] shopScanJobCleanup 未启用（SHOP_SCAN_JOB_CLEANUP_ENABLED=false）",
    );
    return;
  }

  const tz = getShopScanJobCleanupTimezone();
  const minute = getShopScanJobCleanupMinute();
  const intervalMs = getShopScanJobCleanupIntervalMs();
  const retentionDays = getShopScanJobRetentionDays();

  const scheduleNext = () => {
    const waitMs = msUntilNextShopScanJobCleanup();
    const nextAt = resolveNextShopScanJobCleanupAt();
    console.log(
      `[scheduler] shopScanJobCleanup 下次 ${nextAt.toISOString()} (tz=${tz}, :${String(minute).padStart(2, "0")}, interval=${intervalMs}ms, retentionDays=${retentionDays})`,
    );
    setTimeout(() => {
      if (isShuttingDown()) return;
      void (async () => {
        try {
          await cleanupOldShopScanJobs();
        } catch (err) {
          console.error("[scheduler] shopScanJobCleanup error", err);
        } finally {
          if (!isShuttingDown()) scheduleNext();
        }
      })();
    }, waitMs);
  };

  scheduleNext();
}

/** 每小时 :40 缓慢清理超过保留期的自动翻译任务（Cosmos + Blob + Redis）。 */
function scheduleJobRetentionCleanup(): void {
  if (!isJobRetentionCleanupEnabled()) {
    console.log(
      "[scheduler] jobRetentionCleanup 未启用（V4_JOB_RETENTION_CLEANUP_ENABLED=false）",
    );
    return;
  }

  const tz = getJobRetentionCleanupTimezone();
  const minute = getJobRetentionCleanupMinute();
  const intervalMs = getJobRetentionCleanupIntervalMs();
  const retentionDays = getJobRetentionDays();

  const scheduleNext = () => {
    const waitMs = msUntilNextJobRetentionCleanup();
    const nextAt = resolveNextJobRetentionCleanupAt();
    console.log(
      `[scheduler] jobRetentionCleanup 下次 ${nextAt.toISOString()} (tz=${tz}, :${String(minute).padStart(2, "0")}, interval=${intervalMs}ms, retentionDays=${retentionDays})`,
    );
    setTimeout(() => {
      if (isShuttingDown()) return;
      void (async () => {
        try {
          await cleanupOldTranslationJobs();
        } catch (err) {
          console.error("[scheduler] jobRetentionCleanup error", err);
        } finally {
          if (!isShuttingDown()) scheduleNext();
        }
      })();
    }, waitMs);
  };

  scheduleNext();
}

/** 每小时 :55 缓慢清理过期 source=auto 的 LiquidRule（不碰 manual）。 */
function scheduleAutoLiquidRetentionCleanup(): void {
  if (!isAutoLiquidRetentionEnabled()) {
    console.log(
      "[scheduler] autoLiquidRetention 未启用（AUTO_LIQUID_RETENTION_ENABLED=false）",
    );
    return;
  }

  const tz = getAutoLiquidRetentionTimezone();
  const minute = getAutoLiquidRetentionMinute();
  const intervalMs = getAutoLiquidRetentionIntervalMs();
  const retentionDays = getAutoLiquidRetentionDays();

  const scheduleNext = () => {
    const waitMs = msUntilNextAutoLiquidRetention();
    const nextAt = resolveNextAutoLiquidRetentionAt();
    console.log(
      `[scheduler] autoLiquidRetention 下次 ${nextAt.toISOString()} (tz=${tz}, :${String(minute).padStart(2, "0")}, interval=${intervalMs}ms, retentionDays=${retentionDays})`,
    );
    setTimeout(() => {
      if (isShuttingDown()) return;
      void (async () => {
        try {
          await cleanupOldAutoLiquidRules();
        } catch (err) {
          console.error("[scheduler] autoLiquidRetention error", err);
        } finally {
          if (!isShuttingDown()) scheduleNext();
        }
      })();
    }, waitMs);
  };

  scheduleNext();
}

export function startScheduler(): void {
  const stages = enabledStages();
  const claimSuffix = `-${process.env.HOSTNAME ?? hostname()}-${process.pid}`;
  console.log(`[scheduler] starting translation v4 workers (stages: ${[...stages].join(",")}, poll=${POLL_INTERVAL_MS}ms)`);

  const runners: Record<Stage, () => Promise<void>> = {
    init: runInitWorker,
    translate: runTranslateWorker,
    writeback: runWritebackWorker,
  };

  // resetStale always runs — harmless when a stage is disabled.
  safeRun("deployWake", async () => {
    await wakeQueuedJobsAfterDeploy(claimSuffix);
  });
  safeRun("resetStale", () => resetStaleJobs());
  setInterval(() => safeRun("resetStale", () => resetStaleJobs()), STALE_RESET_INTERVAL_MS);

  // 自动翻译：按整点调度（默认北京时间每小时 :00），启动时不立即扫描
  if (stages.has("init")) {
    scheduleAutoTranslateScan();
  } else {
    console.log('[scheduler] init stage 关闭，跳过 autoTranslate 扫描');
  }

  if (stages.has("init")) {
    safeRun("autoJobCleanup", () => cleanupStaleEmptyAutoJobs());
    setInterval(
      () => safeRun("autoJobCleanup", () => cleanupStaleEmptyAutoJobs()),
      AUTO_EMPTY_JOB_CLEANUP_INTERVAL_MS,
    );
  }

  // 店铺画像扫描：与 init 同 gate（做 Shopify 读扫描）。hint 立即唤醒 + 轮询兜底，
  // stale-reset 自愈崩溃任务，部署重启后 re-hint 待处理扫描。
  // scheduled 计量复扫：与 auto 同分槽，默认 :30 触发，槽位延后 1h（scheduledShopScan）。
  if (stages.has("init")) {
    safeRun("shopScanDeployWake", async () => {
      await wakeQueuedShopScanJobsAfterDeploy();
    });
    safeRun("shopScanStaleReset", async () => {
      await resetStaleShopScanJobs();
    });
    setInterval(
      () =>
        safeRun("shopScanStaleReset", async () => {
          await resetStaleShopScanJobs();
        }),
      STALE_RESET_INTERVAL_MS,
    );
    safeRun("shopScan", () => runShopScanWorker());
    setInterval(
      () => safeRun("shopScan", () => runShopScanWorker()),
      SHOP_SCAN_POLL_INTERVAL_MS,
    );
    scheduleScheduledShopScan();
  } else {
    console.log('[scheduler] init stage 关闭，跳过店铺画像扫描');
  }

  // 邮件通知：翻译任务完成后发送通知邮件（独立于 pipeline stages，始终运行）。
  safeRun("emailWorker", () => runEmailWorker());
  setInterval(() => safeRun("emailWorker", () => runEmailWorker()), EMAIL_WORKER_INTERVAL_MS);

  // 订阅对账：仅 worker 调度；直连 Turso，不打 TSF Web。
  scheduleBillingSubscriptionNearDueReconcile();
  scheduleBillingSubscriptionReconcile();

  // Render prod error 汇总 → 飞书（独立于 pipeline stages）。
  scheduleRenderErrorDigest();

  // 自动任务保留期清理：每小时 :40 缓慢删除 N 天前的自动任务（与 pipeline stages 独立）。
  scheduleJobRetentionCleanup();

  // shop_scan_jobs 保留期清理：每小时 :50；Blob 稳定产物 latest-scan.json 不删。
  scheduleShopScanJobCleanup();

  // auto LiquidRule 保留清理：每小时 :55；只删 source=auto。
  scheduleAutoLiquidRetentionCleanup();

  for (const stage of ALL_STAGES) {
    if (!stages.has(stage)) {
      console.log(`[scheduler] stage "${stage}" disabled by WORKER_STAGES`);
      continue;
    }
    const run = runners[stage];
    safeRun(stage, run);
    setInterval(() => safeRun(stage, run), POLL_INTERVAL_MS);
  }
}
