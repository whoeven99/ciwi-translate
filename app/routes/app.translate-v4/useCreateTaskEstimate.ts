import { useEffect, useState } from "react";
import type { LocaleCoverageRow } from "~/server/translateV4/coverage.server";

export type CreateTaskEstimateView = {
  estimatedCredits: number | null;
  remainingCredits: number;
  isUpperBound: boolean;
  needsMoreCredits: boolean;
  loading: boolean;
};

const EMPTY_ESTIMATE: CreateTaskEstimateView = {
  estimatedCredits: null,
  remainingCredits: 0,
  isUpperBound: true,
  needsMoreCredits: false,
  loading: false,
};

/** 展示用额度简写：1200 → 1K，1_500_000 → 1.5M */
export function formatEstimateCredits(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  }
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

/** 从覆盖率行推导未译比例（0=已全译，1=全未译；未知为 null）。 */
export function buildUntranslatedRatioByLocale(
  locales: LocaleCoverageRow[],
): Record<string, number | null> {
  const map: Record<string, number | null> = {};
  for (const row of locales) {
    const pct = row.cacheMissing ? null : row.percent;
    map[row.locale] =
      pct == null ? null : Math.min(1, Math.max(0, (100 - pct) / 100));
  }
  return map;
}

/**
 * 创建任务卡额度预估：targets / modules / isCover 变化时防抖请求
 * POST /api/translate-v4/estimate。
 */
export function useCreateTaskEstimate(args: {
  modules: string[];
  targets: string[];
  isCover: boolean;
  includeLiquid?: boolean;
  untranslatedRatioByLocale: Record<string, number | null>;
  remainingCredits: number | null;
}): CreateTaskEstimateView {
  const {
    modules,
    targets,
    isCover,
    includeLiquid = false,
    untranslatedRatioByLocale,
    remainingCredits,
  } = args;
  const [estimate, setEstimate] =
    useState<CreateTaskEstimateView>(EMPTY_ESTIMATE);

  useEffect(() => {
    if (targets.length === 0 || (modules.length === 0 && !includeLiquid)) {
      setEstimate((prev) => ({
        ...prev,
        estimatedCredits: null,
        remainingCredits: remainingCredits ?? prev.remainingCredits,
        loading: false,
        needsMoreCredits: false,
        isUpperBound: true,
      }));
      return;
    }

    let cancelled = false;
    setEstimate((prev) => ({ ...prev, loading: true }));
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch("/api/translate-v4/estimate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              modules,
              targets,
              isCover,
              includeLiquid,
              untranslatedRatioByLocale,
            }),
          });
          const text = await res.text();
          const data = text.trim()
            ? (JSON.parse(text) as {
                ok?: boolean;
                estimate?: Omit<CreateTaskEstimateView, "loading">;
              })
            : null;
          if (cancelled) return;
          if (data?.ok && data.estimate) {
            setEstimate({
              estimatedCredits: data.estimate.estimatedCredits,
              remainingCredits: data.estimate.remainingCredits,
              isUpperBound: data.estimate.isUpperBound ?? true,
              needsMoreCredits: data.estimate.needsMoreCredits,
              loading: false,
            });
          } else {
            setEstimate((prev) => ({
              ...prev,
              estimatedCredits: null,
              loading: false,
            }));
          }
        } catch (err) {
          console.warn("[translateV4] estimate fetch failed:", err);
          if (!cancelled) {
            setEstimate((prev) => ({
              ...prev,
              estimatedCredits: null,
              loading: false,
            }));
          }
        }
      })();
    }, 400);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    targets,
    modules,
    isCover,
    includeLiquid,
    untranslatedRatioByLocale,
    remainingCredits,
  ]);

  return estimate;
}
