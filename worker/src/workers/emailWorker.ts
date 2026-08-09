/**
 * emailWorker — 翻译完成通知邮件发送 worker。
 *
 * 每次运行：
 *  1. 找出 COMPLETED / PAUSED、未发邮件的任务。
 *     收件人邮箱在发信时通过 Shopify GraphQL 实时查询（不用 Session 快照）。
 *  2. 手动任务（taskSource ≠ TsFrontend-Auto）：等同店内所有进行中手动任务结束后，
 *     查询该店全部待发 manual 任务并汇总发信（对齐自动翻译合并策略）。
 *  3. 自动任务（taskSource = TsFrontend-Auto）：等同店内所有进行中自动任务结束后，
 *     查询该店全部待发 auto 任务并汇总发一封（对齐 Spring TranslateTask.sendEmail）。
 *     usedTokens=0 的语言仍出现在手动成功邮件表格中；自动成功邮件仍跳过 usedTokens=0。
 *     手动：积分不足 PAUSED → 211401；其余 COMPLETED / 人工暂停 / CANCELLED → 210764。
 *     手动汇总若待发组全部是 CANCELLED：不发信，仍标记 emailSent（对齐 auto 取消）。
 *     PAUSED 进度百分比对齐任务列表（translateUnitTotal 口径）。
 *  4. 发送成功后将 emailSent=true 写回 Cosmos，防止重发。
 *  5. 手动任务默认仅对 2026-08-03（北京时间）及之后创建的任务发信；
 *     可用 MANUAL_EMAIL_MIN_CREATED_AT 调整或关闭（false / 0 / 空）。
 *  6. 已卸载（Turso 无 offline Session）→ 不发信，仍标 emailSent，并飞书通知运营
 *     （FEISHU_WEBHOOK_URL_SUPPORT；缺配置则跳过通知）。
 *
 * 任务类型对应模板：
 *   manual + 积分不足 PAUSED → 211401 未完成（Credits used / Additional required）
 *   manual + COMPLETED / 人工暂停 /（与其它终态混发的）CANCELLED → 210764 完成汇总
 *   manual + 全部 CANCELLED → 不发信，仅 emailSent=true
 *   auto   + COMPLETED → 140352 自动翻译成功（同店多语言合并）
 *   auto   + PAUSED → 159297 翻译部分完成（额度不足）
 *   auto   + CANCELLED → 不发信，仅 emailSent=true
 *   无 offline token（卸载等）→ 不发信，标 emailSent，并飞书通知
 */

import type { TranslationV4Job } from "../services/cosmosV4.js";
import {
  ACTIVE_V4_STATUSES,
  findAutoJobsNeedingEmailForShop,
  findManualJobsNeedingEmailForShop,
  findRecentManualJobsForShop,
  findShopsWithPendingAutoEmail,
  findShopsWithPendingManualEmail,
  hasActiveAutoJobsForShop,
  hasActiveManualJobsForShop,
  updateJob,
} from "../services/cosmosV4.js";
import {
  clearEmailPendingShop,
  getEmailPendingShops,
  releaseEmailSendLock,
  tryAcquireEmailSendLock,
} from "../services/redisV4.js";
import { computePausedJobProgressPercent } from "../services/metricsUtils.js";
import { sendFeishuTextMessage } from "../services/feishuNotify.js";
import { fetchShopContact } from "../services/shopEmail.js";
import { getOfflineAccessTokenFromTsf } from "../services/tsfDb.js";
import { isQuotaInsufficientMessage } from "../services/userFacingMessages.js";
import {
  sendManualTranslationSuccessEmail,
  sendManualTranslationIncompleteEmail,
  sendAutoTranslationSuccessEmail,
  sendTranslationPartialEmail,
  hasPartialEmailProgress,
  maskEmail,
  type TranslationJobSummary,
} from "../services/workerEmail.js";

const LOG = "[emailWorker]";

/** 近期同店手动任务视为一批的窗口（默认 15 分钟）。 */
const MANUAL_EMAIL_COHORT_MS = (() => {
  const n = Number(process.env.MANUAL_EMAIL_COHORT_MS);
  return Number.isFinite(n) && n > 0 ? n : 15 * 60_000;
})();

/** 批次内最后一个任务终态后，再等待一段时间聚合发信（默认 90 秒）。 */
const MANUAL_EMAIL_SETTLE_MS = (() => {
  const n = Number(process.env.MANUAL_EMAIL_SETTLE_MS);
  return Number.isFinite(n) && n >= 0 ? n : 90_000;
})();

function isActiveV4Status(status: TranslationV4Job["status"]): boolean {
  return ACTIVE_V4_STATUSES.includes(status);
}

async function shouldDeferManualEmailBatch(
  shopName: string,
  pendingJobs: TranslationV4Job[],
): Promise<{ defer: boolean; reason?: string; detail?: Record<string, unknown> }> {
  const cohort = await findRecentManualJobsForShop(shopName, MANUAL_EMAIL_COHORT_MS);
  const activeInCohort = cohort.filter((job) => isActiveV4Status(job.status));
  if (activeInCohort.length > 0) {
    return {
      defer: true,
      reason: "cohort_has_active_jobs",
      detail: {
        cohortSize: cohort.length,
        activeCount: activeInCohort.length,
        activeTargets: activeInCohort.map((j) => j.target),
      },
    };
  }

  if (cohort.length <= 1 && pendingJobs.length <= 1) {
    return { defer: false };
  }

  if (MANUAL_EMAIL_SETTLE_MS > 0) {
    const terminalJobs = cohort.filter((job) => !isActiveV4Status(job.status));
    const lastTerminalAt = Math.max(
      ...terminalJobs.map((job) => new Date(job.updatedAt).getTime()),
      0,
    );
    const elapsed = Date.now() - lastTerminalAt;
    if (elapsed < MANUAL_EMAIL_SETTLE_MS) {
      return {
        defer: true,
        reason: "batch_settle_wait",
        detail: {
          cohortSize: cohort.length,
          pendingCount: pendingJobs.length,
          settleMs: MANUAL_EMAIL_SETTLE_MS,
          remainingMs: MANUAL_EMAIL_SETTLE_MS - elapsed,
        },
      };
    }
  }

  return { defer: false };
}

function logDetail(phase: string, payload: Record<string, unknown>): void {
  console.info(`${LOG} ${phase} ${JSON.stringify(payload)}`);
}

function describeJob(job: TranslationV4Job): Record<string, unknown> {
  return {
    id: job.id,
    shop: job.shopName,
    taskSource: job.taskSource ?? null,
    status: job.status,
    target: job.target,
    emailSent: job.emailSent ?? false,
    usedTokens: job.metrics.usedTokens ?? 0,
    translateDone: job.metrics.translateDone,
    translateTotal: job.metrics.translateTotal,
  };
}

/** 从任务的 stageTimings / createdAt / updatedAt 估算完成耗时（分钟）。 */
function calcElapsedMinutes(job: TranslationV4Job): number {
  const start = job.stageTimings?.INIT?.startedAt ?? job.createdAt;
  const end =
    job.stageTimings?.VERIFY?.endedAt ??
    job.stageTimings?.WRITEBACK?.endedAt ??
    job.updatedAt;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return Math.max(1, Math.round(ms / 60_000));
}

/** 邮件 Status 列用的完成百分比；PAUSED 与任务列表 progressPercent 同一算法。 */
function calcCompletionPercent(job: TranslationV4Job): number {
  if (job.status === "PAUSED") {
    return computePausedJobProgressPercent(job.metrics, job.errorStage);
  }
  const total = job.metrics.translateTotal || job.metrics.initTotal || 0;
  if (total <= 0) return 0;
  return Math.min(
    100,
    Math.round((job.metrics.translateDone / total) * 100),
  );
}

function toJobSummary(job: TranslationV4Job): TranslationJobSummary {
  const terminalStatus: TranslationJobSummary["terminalStatus"] =
    job.status === "PAUSED"
      ? "PAUSED"
      : job.status === "CANCELLED"
        ? "CANCELLED"
        : "COMPLETED";
  return {
    target: job.target,
    usedTokens: job.metrics.usedTokens ?? 0,
    translateDone: job.metrics.translateDone ?? 0,
    elapsedMinutes: calcElapsedMinutes(job),
    completionPercent: calcCompletionPercent(job),
    terminalStatus,
  };
}

/**
 * 手动任务是否因积分不足暂停。
 * translateWorker 写入稳定码 `QUOTA_INSUFFICIENT`（兼认旧中英文文案）；
 * 人工暂停多为 null / `manually paused`。
 */
export function isManualQuotaInsufficientPause(
  errorMessage: string | null | undefined,
): boolean {
  return isQuotaInsufficientMessage(errorMessage);
}

/**
 * 剩余所需积分（两手准备）：
 * - 无创建估算（旧任务）→ 仅进度外推
 * - 实扣 < k=1.6 估算 → 估算 − 实扣
 * - 实扣 ≥ 估算（含相等）→ 进度外推 ceil(已用 × (100−进度)/进度)
 */
export function estimateRequiredCreditsForIncompleteEmail(args: {
  usedTokens: number;
  completionPercent: number;
  estimatedCredits?: number | null;
}): number {
  const used = Math.max(0, Math.floor(args.usedTokens || 0));
  const pct = Math.max(0, Math.min(100, args.completionPercent || 0));
  const estimated =
    typeof args.estimatedCredits === "number" &&
    Number.isFinite(args.estimatedCredits) &&
    args.estimatedCredits > 0
      ? Math.floor(args.estimatedCredits)
      : null;

  const fromProgress = (): number => {
    if (used <= 0 || pct <= 0 || pct >= 100) return 0;
    return Math.max(1, Math.ceil((used * (100 - pct)) / pct));
  };

  if (estimated == null) return fromProgress();
  if (used < estimated) return Math.max(0, estimated - used);
  return fromProgress();
}

/** @deprecated 使用 {@link estimateRequiredCreditsForIncompleteEmail} */
export function estimateRequiredCreditsFromProgress(
  usedTokens: number,
  completionPercent: number,
): number {
  return estimateRequiredCreditsForIncompleteEmail({
    usedTokens,
    completionPercent,
  });
}

async function markEmailSentBatch(jobs: TranslationV4Job[]): Promise<void> {
  for (const job of jobs) {
    await markEmailSent(job);
  }
}

/** 去掉 .myshopify.com 后缀，得到可读店名（firstName 不可用时的兜底）。 */
function parseShopName(shopName: string): string {
  return shopName.replace(/\.myshopify\.com$/, "");
}

export type RecipientContact = {
  email: string;
  userName: string;
};

function buildNoOfflineTokenFeishuMessage(
  shopName: string,
  jobs: TranslationV4Job[],
  kind: "manual" | "auto",
): string {
  const targets = jobs.map((j) => j.target).join(", ");
  const jobIds = jobs.map((j) => j.id).join(", ");
  return [
    "[TSF Worker] 跳过翻译完成邮件（无 offline Session，疑似已卸载）",
    `shop: ${shopName}`,
    `kind: ${kind}`,
    `jobCount: ${jobs.length}`,
    `targets: ${targets || "-"}`,
    `jobIds: ${jobIds || "-"}`,
    "action: emailSent=true（不发信）",
  ].join("\n");
}

/** best-effort 飞书通知；失败不影响 emailSent 标记。 */
async function notifyFeishuNoOfflineToken(
  shopName: string,
  jobs: TranslationV4Job[],
  kind: "manual" | "auto",
): Promise<void> {
  const result = await sendFeishuTextMessage(
    buildNoOfflineTokenFeishuMessage(shopName, jobs, kind),
  );
  logDetail(`handle-${kind}-feishu`, {
    shop: shopName,
    ok: result.ok,
    skipped: "skipped" in result ? result.skipped : false,
    reason: "reason" in result ? result.reason : null,
  });
  if (!result.ok && !("skipped" in result && result.skipped)) {
    console.warn(`${LOG} feishu notify failed shop=${shopName}`, result);
  }
}

/**
 * 无 offline Session（常见于已卸载）时无法查 Shopify 邮箱，也不应再发通知。
 * 返回 true 表示已跳过并标 emailSent，调用方应直接 return。
 */
async function skipEmailIfNoOfflineToken(
  shopName: string,
  jobs: TranslationV4Job[],
  kind: "manual" | "auto",
): Promise<boolean> {
  const token = await getOfflineAccessTokenFromTsf(shopName);
  if (token) return false;

  logDetail(`handle-${kind}-skipped`, {
    reason: "no_offline_token",
    shop: shopName,
    jobIds: jobs.map((j) => j.id),
    targets: jobs.map((j) => j.target),
    action: "mark_email_sent",
  });
  await markEmailSentBatch(jobs);
  await notifyFeishuNoOfflineToken(shopName, jobs, kind);
  return true;
}

/** 发信前从 Shopify GraphQL 拉取收件人与称呼。 */
async function resolveRecipientContact(
  job: TranslationV4Job,
): Promise<RecipientContact | null> {
  logDetail("resolve-recipient-start", {
    jobId: job.id,
    shop: job.shopName,
  });
  const contact = await fetchShopContact(job.shopName);
  const email = contact.email;
  const userName = contact.firstName?.trim() || parseShopName(job.shopName);
  logDetail("resolve-recipient-done", {
    jobId: job.id,
    shop: job.shopName,
    email: email ? maskEmail(email) : null,
    userName,
    firstNameSource: contact.firstName ? "shopify_api" : "shop_prefix_fallback",
    found: Boolean(email),
  });
  if (!email) return null;
  return { email, userName };
}

/** 标记 emailSent=true，使用 etag 防止并发写冲突，失败静默（不影响主流程）。 */
async function markEmailSent(job: TranslationV4Job): Promise<void> {
  try {
    await updateJob(job.shopName, job.id, { emailSent: true });
    logDetail("mark-email-sent-ok", { jobId: job.id, shop: job.shopName });
  } catch (e) {
    console.warn(`${LOG} markEmailSent failed job=${job.id}`, e);
  }
}

/** 处理同一店铺的手动翻译邮件：整店任务都终态后汇总发一封。 */
async function handleManualJobGroup(shopName: string): Promise<void> {
  const hasActive = await hasActiveManualJobsForShop(shopName);
  if (hasActive) {
    logDetail("handle-manual-skipped", {
      reason: "active_manual_jobs_still_running",
      shop: shopName,
    });
    return;
  }

  const jobs = await findManualJobsNeedingEmailForShop(shopName);
  if (jobs.length === 0) {
    // 已确认无待发任务，清掉快路径标记（active 早退时不清，之后还要发）。
    await clearEmailPendingShop(shopName, "manual");
    return;
  }

  const defer = await shouldDeferManualEmailBatch(shopName, jobs);
  if (defer.defer) {
    logDetail("handle-manual-skipped", {
      reason: defer.reason,
      shop: shopName,
      jobIds: jobs.map((j) => j.id),
      targets: jobs.map((j) => j.target),
      ...defer.detail,
    });
    return;
  }

  const lockAcquired = await tryAcquireEmailSendLock(shopName, "manual");
  if (!lockAcquired) {
    logDetail("handle-manual-skipped", {
      reason: "email_send_lock_busy",
      shop: shopName,
      jobIds: jobs.map((j) => j.id),
    });
    return;
  }

  try {
    logDetail("handle-manual-start", {
      shop: shopName,
      jobCount: jobs.length,
      jobs: jobs.map(describeJob),
    });

    if (await skipEmailIfNoOfflineToken(shopName, jobs, "manual")) {
      return;
    }

    const recipient = await resolveRecipientContact(jobs[0]);
    if (!recipient) {
      logDetail("handle-manual-skipped", {
        reason: "no_shop_email",
        shop: shopName,
        jobIds: jobs.map((j) => j.id),
      });
      return;
    }
    const { email: to, userName } = recipient;
    const quotaPausedJobs = jobs.filter(
      (j) =>
        j.status === "PAUSED" &&
        isManualQuotaInsufficientPause(j.errorMessage),
    );
    const successJobs = jobs.filter(
      (j) =>
        !(
          j.status === "PAUSED" &&
          isManualQuotaInsufficientPause(j.errorMessage)
        ),
    );
    const completedJobs = successJobs.filter((j) => j.status === "COMPLETED");
    const pausedJobs = successJobs.filter((j) => j.status === "PAUSED");
    const cancelledJobs = successJobs.filter((j) => j.status === "CANCELLED");

    logDetail("handle-manual-split", {
      shop: shopName,
      to: maskEmail(to),
      quotaPausedCount: quotaPausedJobs.length,
      successCount: successJobs.length,
      completedCount: completedJobs.length,
      pausedCount: pausedJobs.length,
      cancelledCount: cancelledJobs.length,
      quotaPausedTargets: quotaPausedJobs.map((j) => j.target),
      successTargets: successJobs.map((j) => j.target),
    });

    if (quotaPausedJobs.length > 0) {
      const quotaSummaries = quotaPausedJobs.map(toJobSummary);
      const requiredCredits = quotaPausedJobs.reduce((sum, job, i) => {
        const summary = quotaSummaries[i];
        return (
          sum +
          estimateRequiredCreditsForIncompleteEmail({
            usedTokens: summary.usedTokens,
            completionPercent: summary.completionPercent ?? 0,
            estimatedCredits: job.estimatedCredits,
          })
        );
      }, 0);
      const sent = await sendManualTranslationIncompleteEmail(
        shopName,
        to,
        userName,
        quotaSummaries,
        requiredCredits,
      );
      logDetail("handle-manual-incomplete-send-result", {
        shop: shopName,
        to: maskEmail(to),
        sent,
        jobIds: quotaPausedJobs.map((j) => j.id),
        targets: quotaSummaries.map((j) => j.target),
        requiredCredits,
        estimatedCredits: quotaPausedJobs.map((j) => j.estimatedCredits ?? null),
      });
      if (sent) {
        await markEmailSentBatch(quotaPausedJobs);
        logDetail("handle-manual-incomplete-done", {
          shop: shopName,
          langs: quotaSummaries.map((j) => j.target),
          markedJobIds: quotaPausedJobs.map((j) => j.id),
        });
      }
    }

    if (successJobs.length > 0) {
      const allCancelled = successJobs.every((j) => j.status === "CANCELLED");
      if (allCancelled) {
        // 全取消：不发「完成」邮件，仍标已发送，避免重试噪声。
        logDetail("handle-manual-success-skipped", {
          reason: "all_cancelled",
          shop: shopName,
          jobIds: successJobs.map((j) => j.id),
          targets: successJobs.map((j) => j.target),
        });
        await markEmailSentBatch(successJobs);
      } else {
        const jobsToEmail: TranslationJobSummary[] = successJobs.map(toJobSummary);
        const sent = await sendManualTranslationSuccessEmail(
          shopName,
          to,
          userName,
          jobsToEmail,
        );
        logDetail("handle-manual-send-result", {
          shop: shopName,
          to: maskEmail(to),
          sent,
          jobIds: successJobs.map((j) => j.id),
          targets: jobsToEmail.map((j) => j.target),
        });
        if (sent) {
          await markEmailSentBatch(successJobs);
          logDetail("handle-manual-done", {
            shop: shopName,
            langs: jobsToEmail.map((j) => j.target),
            markedJobIds: successJobs.map((j) => j.id),
          });
        }
      }
    }
  } finally {
    await releaseEmailSendLock(shopName, "manual");
  }
}

/** 处理同一店铺的自动翻译邮件：整店任务都终态后汇总发一封。 */
async function handleAutoJobGroup(shopName: string): Promise<void> {
  // 等所有进行中的自动任务结束后再发（对齐 Java 按店汇总逻辑）
  const hasActive = await hasActiveAutoJobsForShop(shopName);
  if (hasActive) {
    logDetail("handle-auto-skipped", {
      reason: "active_auto_jobs_still_running",
      shop: shopName,
    });
    return;
  }

  const jobs = await findAutoJobsNeedingEmailForShop(shopName);
  if (jobs.length === 0) {
    await clearEmailPendingShop(shopName, "auto");
    return;
  }

  const lockAcquired = await tryAcquireEmailSendLock(shopName, "auto");
  if (!lockAcquired) {
    logDetail("handle-auto-skipped", {
      reason: "email_send_lock_busy",
      shop: shopName,
      jobIds: jobs.map((j) => j.id),
    });
    return;
  }

  try {
    logDetail("handle-auto-start", {
    shop: shopName,
    jobCount: jobs.length,
    jobs: jobs.map(describeJob),
  });

  if (await skipEmailIfNoOfflineToken(shopName, jobs, "auto")) {
    return;
  }

  const recipient = await resolveRecipientContact(jobs[0]);
  if (!recipient) {
    logDetail("handle-auto-skipped", {
      reason: "no_shop_email",
      shop: shopName,
      jobIds: jobs.map((j) => j.id),
    });
    return;
  }
  const { email: to, userName } = recipient;
  const completedJobs = jobs.filter((j) => j.status === "COMPLETED");
  const pausedJobs = jobs.filter((j) => j.status === "PAUSED");
  logDetail("handle-auto-split", {
    shop: shopName,
    to: maskEmail(to),
    completedCount: completedJobs.length,
    pausedCount: pausedJobs.length,
    completedTargets: completedJobs.map((j) => j.target),
    pausedTargets: pausedJobs.map((j) => j.target),
  });

  // 成功任务：发汇总成功邮件（140352）
  if (completedJobs.length > 0) {
    const sent = await sendAutoTranslationSuccessEmail(
      shopName,
      to,
      userName,
      completedJobs.map(toJobSummary),
    );
    logDetail("handle-auto-success-send-result", {
      shop: shopName,
      to: maskEmail(to),
      sent,
      jobIds: completedJobs.map((j) => j.id),
      targets: completedJobs.map((j) => j.target),
    });
    if (sent) {
      for (const job of completedJobs) {
        await markEmailSent(job);
      }
      logDetail("handle-auto-success-done", {
        shop: shopName,
        langs: completedJobs.map((j) => j.target),
        markedJobIds: completedJobs.map((j) => j.id),
      });
    }
  }

  // 暂停任务：发部分完成邮件（159297）；进度 0% 不发信，避免扫描后额度为 0 的误通知
  if (pausedJobs.length > 0) {
    const pausedSummaries = pausedJobs.map(toJobSummary);
    const pausedWithProgress = pausedSummaries.filter(hasPartialEmailProgress);
    if (pausedWithProgress.length === 0) {
      logDetail("handle-auto-partial-skipped", {
        reason: "all_zero_progress",
        shop: shopName,
        jobIds: pausedJobs.map((j) => j.id),
        targets: pausedJobs.map((j) => j.target),
      });
      await markEmailSentBatch(pausedJobs);
    } else {
      const sent = await sendTranslationPartialEmail(
      shopName,
      to,
      userName,
      "auto translation",
      pausedWithProgress,
    );
    logDetail("handle-auto-partial-send-result", {
      shop: shopName,
      to: maskEmail(to),
      sent,
      jobIds: pausedJobs.map((j) => j.id),
      targets: pausedJobs.map((j) => j.target),
      emailedTargets: pausedWithProgress.map((j) => j.target),
    });
      if (sent) {
        await markEmailSentBatch(pausedJobs);
        logDetail("handle-auto-partial-done", {
          shop: shopName,
          langs: pausedWithProgress.map((j) => j.target),
          markedJobIds: pausedJobs.map((j) => j.id),
        });
      }
    }
  }

  const cancelledJobs = jobs.filter((j) => j.status === "CANCELLED");
  if (cancelledJobs.length > 0) {
    logDetail("handle-auto-cancelled-mark", {
      shop: shopName,
      jobIds: cancelledJobs.map((j) => j.id),
      targets: cancelledJobs.map((j) => j.target),
    });
    await markEmailSentBatch(cancelledJobs);
  }
  } finally {
    await releaseEmailSendLock(shopName, "auto");
  }
}

/**
 * 跨分区兜底扫描间隔（默认 5 分钟）。
 * 平时靠 Redis 标记走快路径，兜底扫描负责捞回标记之外的任务。
 */
const EMAIL_FALLBACK_SCAN_MS = Math.max(
  30_000,
  Number(process.env.EMAIL_FALLBACK_SCAN_INTERVAL_MS) || 5 * 60_000,
);
let lastFallbackScanAt = 0;

export async function runEmailWorker(): Promise<void> {
  const startedAt = Date.now();

  // 快路径：Redis 标记（Worker 侧状态写入时打）直接给出候选店。
  // 兜底：每 EMAIL_FALLBACK_SCAN_MS 做一次跨分区扫描，兜住 App 侧手动
  // 暂停/取消、Redis 重启丢标记、以及任何漏写的情况。
  const useFallbackScan = Date.now() - lastFallbackScanAt >= EMAIL_FALLBACK_SCAN_MS;
  const [manualShops, autoShops] = useFallbackScan
    ? await Promise.all([
        findShopsWithPendingManualEmail(),
        findShopsWithPendingAutoEmail(),
      ])
    : await Promise.all([
        getEmailPendingShops("manual"),
        getEmailPendingShops("auto"),
      ]);
  if (useFallbackScan) lastFallbackScanAt = Date.now();

  if (manualShops.length === 0 && autoShops.length === 0) {
    return;
  }

  logDetail("run-start", {
    source: useFallbackScan ? "cosmos-fallback" : "redis-hint",
    manualShopCount: manualShops.length,
    autoShopCount: autoShops.length,
    manualShops,
    autoShops,
  });

  for (const shopName of manualShops) {
    await handleManualJobGroup(shopName).catch((e) => {
      logDetail("handle-manual-error", {
        shop: shopName,
        errorMessage: e instanceof Error ? e.message : String(e),
      });
      console.error(`${LOG} handleManualJobGroup error shop=${shopName}`, e);
    });
  }

  for (const shopName of autoShops) {
    await handleAutoJobGroup(shopName).catch((e) => {
      logDetail("handle-auto-error", {
        shop: shopName,
        errorMessage: e instanceof Error ? e.message : String(e),
      });
      console.error(`${LOG} handleAutoJobGroup error shop=${shopName}`, e);
    });
  }

  logDetail("run-done", {
    manualShopCount: manualShops.length,
    autoShopCount: autoShops.length,
    elapsedMs: Date.now() - startedAt,
  });
}
