import { isV4QuotaInsufficientMessage } from "~/shared/translateV4MessageTokens";
import type { TranslationJobProgressSummary } from "~/server/translateV4/progress.server";
import { reportClientLog } from "~/utils/clientLog";
import {
  clearResumeTaskDraft,
  loadResumeTaskDraft,
} from "~/utils/resumeTaskDraft";

export const V4_REFRESH_TASKS_EVENT = "ciwi:v4-refresh-tasks";

export type ResumeTaskAfterBillingResult =
  | "skipped"
  | "resumed"
  | "failed";

const RETRY_DELAYS_MS = [0, 800, 1600, 2500, 4000, 6000, 8000, 12_000];
const LOG_EVENT = "v4_billing_resume";

function logResumeStep(
  step: string,
  context: Record<string, unknown>,
): void {
  console.log(`[${LOG_EVENT}]`, step, context);
  void reportClientLog({
    event: LOG_EVENT,
    kind: "action",
    status: "success",
    context: { step, ...context },
  });
}

function isRetryableResumeError(error: unknown): boolean {
  if (typeof error !== "string" || !error.trim()) return false;
  return (
    error === "v4.create.noCreditsPricing" ||
    error === "v4.error.taskStillStopping" ||
    error === "v4.create.quotaUnavailable"
  );
}

function isPermanentResumeError(error: unknown): boolean {
  if (typeof error !== "string" || !error.trim()) return false;
  if (error === "v4.error.taskNotFound") return true;
  if (/^cannot resume from status/i.test(error)) return true;
  return false;
}

async function requestTaskResume(
  shop: string,
  taskId: string,
): Promise<{ ok: boolean; error?: string; status?: number }> {
  const res = await fetch("/api/translate-v4/task-action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      taskId,
      shopName: shop,
      action: "resume",
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
  };
  return {
    ok: Boolean(data.ok),
    error: data.error,
    status: res.status,
  };
}

function notifyTaskListRefresh(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(V4_REFRESH_TASKS_EVENT));
}

function isQuotaPausedResumableJob(
  job: TranslationJobProgressSummary,
): boolean {
  return (
    job.status === "PAUSED" &&
    job.canResume &&
    isV4QuotaInsufficientMessage(job.errorMessage)
  );
}

async function discoverQuotaPausedTaskIds(shop: string): Promise<string[]> {
  try {
    const res = await fetch(
      `/api/translate-v4/tasks?shopName=${encodeURIComponent(shop)}`,
    );
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      jobs?: TranslationJobProgressSummary[];
    };
    if (!data.ok || !Array.isArray(data.jobs)) {
      logResumeStep("discover_failed", {
        shop,
        ok: data.ok,
        jobsType: typeof data.jobs,
      });
      return [];
    }

    const candidates = data.jobs
      .filter((job) => job.status === "PAUSED")
      .map((job) => ({
        taskId: job.taskId,
        target: job.target,
        canResume: job.canResume,
        errorMessage: job.errorMessage,
        isStopping: job.isStopping,
        quotaMatch: isV4QuotaInsufficientMessage(job.errorMessage),
      }));

    logResumeStep("discover_list", {
      shop,
      pausedCount: candidates.length,
      candidates,
    });

    return data.jobs
      .filter(isQuotaPausedResumableJob)
      .map((job) => job.taskId)
      .filter(Boolean);
  } catch (e) {
    logResumeStep("discover_error", {
      shop,
      message: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}

async function resumeTaskWithRetries(
  shop: string,
  taskId: string,
): Promise<boolean> {
  for (let i = 0; i < RETRY_DELAYS_MS.length; i++) {
    const delayMs = RETRY_DELAYS_MS[i] ?? 0;
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    try {
      const result = await requestTaskResume(shop, taskId);
      logResumeStep("resume_attempt", {
        shop,
        taskId,
        attempt: i + 1,
        delayMs,
        ok: result.ok,
        httpStatus: result.status,
        error: result.error ?? null,
        retryable: result.error ? isRetryableResumeError(result.error) : false,
        permanent: result.error ? isPermanentResumeError(result.error) : false,
      });

      if (result.ok) return true;

      if (isPermanentResumeError(result.error)) {
        return false;
      }

      if (!isRetryableResumeError(result.error)) {
        return false;
      }
    } catch (e) {
      logResumeStep("resume_attempt_error", {
        shop,
        taskId,
        attempt: i + 1,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return false;
}

/**
 * After billing return (credits pack or subscription): resume paused quota tasks.
 * Uses session draft when present; otherwise resumes all quota-paused tasks for the shop.
 */
export async function resumePausedTaskAfterBilling(
  shop: string,
): Promise<ResumeTaskAfterBillingResult> {
  const draft = loadResumeTaskDraft(shop);
  const draftTaskIds = draft?.taskIds ?? [];
  logResumeStep("start", {
    shop,
    draftTaskIds,
    draftSavedAt: draft?.savedAt ?? null,
  });

  const discoveredTaskIds = await discoverQuotaPausedTaskIds(shop);
  const taskIds = [...new Set([...draftTaskIds, ...discoveredTaskIds])];

  logResumeStep("task_ids_merged", {
    shop,
    draftTaskIds,
    discoveredTaskIds,
    taskIds,
  });

  if (taskIds.length === 0) {
    logResumeStep("skipped_no_tasks", { shop });
    return "skipped";
  }

  let resumedCount = 0;
  const results: Array<{ taskId: string; ok: boolean }> = [];
  for (const taskId of taskIds) {
    const ok = await resumeTaskWithRetries(shop, taskId);
    results.push({ taskId, ok });
    if (ok) resumedCount += 1;
  }

  clearResumeTaskDraft(shop);

  logResumeStep("finished", {
    shop,
    resumedCount,
    total: taskIds.length,
    results,
    outcome:
      resumedCount > 0
        ? "resumed"
        : taskIds.length > 0
          ? "failed"
          : "skipped",
  });

  if (resumedCount > 0) {
    notifyTaskListRefresh();
    return "resumed";
  }

  return "failed";
}
