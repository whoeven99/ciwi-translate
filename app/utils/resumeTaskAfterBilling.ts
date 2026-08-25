import {
  clearResumeTaskDraft,
  loadResumeTaskDraft,
} from "~/utils/resumeTaskDraft";

export const V4_REFRESH_TASKS_EVENT = "ciwi:v4-refresh-tasks";

export type ResumeTaskAfterBillingResult =
  | "skipped"
  | "resumed"
  | "failed";

const RETRY_DELAYS_MS = [0, 800, 1600, 2500, 4000, 6000, 8000];

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

/**
 * After credits billing return: resume the paused task saved before redirect.
 * Retries while webhook settlement or pause cleanup is still in flight.
 */
export async function resumePausedTaskAfterBilling(
  shop: string,
): Promise<ResumeTaskAfterBillingResult> {
  const draft = loadResumeTaskDraft(shop);
  if (!draft) return "skipped";

  for (let i = 0; i < RETRY_DELAYS_MS.length; i++) {
    const delayMs = RETRY_DELAYS_MS[i] ?? 0;
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    try {
      const result = await requestTaskResume(shop, draft.taskId);
      if (result.ok) {
        clearResumeTaskDraft(shop);
        notifyTaskListRefresh();
        return "resumed";
      }

      if (isPermanentResumeError(result.error)) {
        clearResumeTaskDraft(shop);
        return "failed";
      }

      if (!isRetryableResumeError(result.error)) {
        clearResumeTaskDraft(shop);
        return "failed";
      }
    } catch {
      // network blip — retry
    }
  }

  clearResumeTaskDraft(shop);
  return "failed";
}
