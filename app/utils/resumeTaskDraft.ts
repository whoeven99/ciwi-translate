/**
 * Persist paused translate-v4 task ids across Shopify billing redirects.
 * Used to auto-resume after credits purchase or subscription billing return.
 */

export type ResumeTaskDraft = {
  taskIds: string[];
  savedAt: number;
};

const STORAGE_PREFIX = "ciwi:v4:resumeTaskDraft:";
/** Discard drafts older than 2 hours. */
const DRAFT_TTL_MS = 2 * 60 * 60 * 1000;

function storageKey(shop: string): string {
  return `${STORAGE_PREFIX}${shop.trim().toLowerCase()}`;
}

function canUseSessionStorage(): boolean {
  try {
    return typeof sessionStorage !== "undefined";
  } catch {
    return false;
  }
}

function normalizeTaskIds(taskIds: string[]): string[] {
  return [...new Set(taskIds.map((id) => id.trim()).filter(Boolean))];
}

export function saveResumeTaskDraft(shop: string, taskId: string): void {
  const normalizedShop = shop.trim();
  const normalizedTaskId = taskId.trim();
  if (!normalizedShop || !normalizedTaskId || !canUseSessionStorage()) return;

  const existing = loadResumeTaskDraft(normalizedShop);
  const payload: ResumeTaskDraft = {
    taskIds: normalizeTaskIds([
      ...(existing?.taskIds ?? []),
      normalizedTaskId,
    ]),
    savedAt: Date.now(),
  };
  try {
    sessionStorage.setItem(storageKey(normalizedShop), JSON.stringify(payload));
  } catch {
    // quota / private mode — best-effort
  }
}

export function loadResumeTaskDraft(shop: string): ResumeTaskDraft | null {
  const normalizedShop = shop.trim();
  if (!normalizedShop || !canUseSessionStorage()) return null;

  try {
    const raw = sessionStorage.getItem(storageKey(normalizedShop));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<
      ResumeTaskDraft & { taskId?: string }
    >;
    if (!parsed || typeof parsed !== "object") return null;
    if (
      typeof parsed.savedAt !== "number" ||
      !Number.isFinite(parsed.savedAt) ||
      Date.now() - parsed.savedAt > DRAFT_TTL_MS
    ) {
      clearResumeTaskDraft(normalizedShop);
      return null;
    }

    const taskIds = normalizeTaskIds([
      ...(Array.isArray(parsed.taskIds) ? parsed.taskIds.map(String) : []),
      ...(typeof parsed.taskId === "string" ? [parsed.taskId] : []),
    ]);
    if (taskIds.length === 0) return null;

    return {
      taskIds,
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

export function clearResumeTaskDraft(shop: string): void {
  const normalizedShop = shop.trim();
  if (!normalizedShop || !canUseSessionStorage()) return;
  try {
    sessionStorage.removeItem(storageKey(normalizedShop));
  } catch {
    // ignore
  }
}
