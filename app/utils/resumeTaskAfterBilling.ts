import { isV4QuotaInsufficientMessage } from "~/shared/translateV4MessageTokens";
import type { TranslationJobProgressSummary } from "~/server/translateV4/progress.server";
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
): Promise<{ ok: boolean; error?: string }> {
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
  return { ok: Boolean(data.ok), error: data.error };
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
    if (!data.ok || !Array.isArray(data.jobs)) return [];
    return data.jobs
      .filter(isQuotaPausedResumableJob)
      .map((job) => job.taskId)
      .filter(Boolean);
  } catch {
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
      if (result.ok) return true;

      if (isPermanentResumeError(result.error)) {
        return false;
      }

      if (!isRetryableResumeError(result.error)) {
        return false;
      }
    } catch {
      // network blip — retry
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
  const discoveredTaskIds = await discoverQuotaPausedTaskIds(shop);
  const taskIds = [...new Set([...draftTaskIds, ...discoveredTaskIds])];
  if (taskIds.length === 0) return "skipped";

  let resumedCount = 0;
  for (const taskId of taskIds) {
    const ok = await resumeTaskWithRetries(shop, taskId);
    if (ok) resumedCount += 1;
  }

  clearResumeTaskDraft(shop);

  if (resumedCount > 0) {
    notifyTaskListRefresh();
    return "resumed";
  }

  return "failed";
}
