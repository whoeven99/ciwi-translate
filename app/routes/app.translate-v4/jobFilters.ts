import type { TranslationJobProgressSummary } from "~/server/translateV4/progress.server";

export function isCurrentV4Job(job: TranslationJobProgressSummary): boolean {
  return !job.isTerminal || job.status === "PAUSED" || job.status === "FAILED";
}

export function isHistoryV4Job(job: TranslationJobProgressSummary): boolean {
  return job.isTerminal && job.status !== "PAUSED" && job.status !== "FAILED";
}

export function shouldPollV4Job(job: TranslationJobProgressSummary): boolean {
  return (
    !job.isTerminal &&
    job.status !== "PAUSED" &&
    job.status !== "FAILED" &&
    job.status !== "CANCELLED"
  );
}
