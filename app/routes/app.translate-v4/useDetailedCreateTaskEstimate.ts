import { useCallback, useEffect, useRef, useState } from "react";
import { expandV2ModuleKeys } from "~/server/translateV4/moduleCatalog";

export type DetailedEstimateProgress = {
  /** idle | running | done | error */
  status: "idle" | "running" | "done" | "error";
  doneCount: number;
  totalCount: number;
  currentLabel: string;
  /** 累计 miss 估分（详细） */
  estimatedCredits: number | null;
  missChars: number;
  hitChars: number;
  remainingCredits: number | null;
  errorMessage: string | null;
};

const IDLE: DetailedEstimateProgress = {
  status: "idle",
  doneCount: 0,
  totalCount: 0,
  currentLabel: "",
  estimatedCredits: null,
  missChars: 0,
  hitChars: 0,
  remainingCredits: null,
  errorMessage: null,
};

type ShardResponse = {
  ok?: boolean;
  error?: string;
  shard?: {
    estimatedCredits?: number;
    missChars?: number;
    hitChars?: number;
    remainingCredits?: number;
    module?: string;
    target?: string;
  };
};

/**
 * 确认弹窗「精准预估」：按 target × v4 module（+ liquid）串行扫 TM miss。
 */
export function useDetailedCreateTaskEstimate() {
  const [progress, setProgress] = useState<DetailedEstimateProgress>(IDLE);
  const abortRef = useRef(0);

  const reset = useCallback(() => {
    abortRef.current += 1;
    setProgress(IDLE);
  }, []);

  const run = useCallback(
    async (args: {
      modules: string[];
      targets: string[];
      isCover: boolean;
      isHandle: boolean;
      includeLiquid: boolean;
      aiModel: string;
      source?: string;
    }) => {
      const runId = ++abortRef.current;
      const v4Modules = expandV2ModuleKeys(args.modules);
      const work: Array<{ target: string; module: string; label: string }> = [];
      for (const target of args.targets) {
        for (const module of v4Modules) {
          work.push({
            target,
            module,
            label: `${target} · ${module}`,
          });
        }
      }
      if (args.includeLiquid && args.targets.length > 0) {
        work.push({
          target: args.targets[0]!,
          module: "__liquid__",
          label: "Custom Liquid",
        });
      }

      if (work.length === 0) {
        setProgress({
          ...IDLE,
          status: "error",
          errorMessage: "empty",
        });
        return;
      }

      setProgress({
        status: "running",
        doneCount: 0,
        totalCount: work.length,
        currentLabel: work[0]!.label,
        estimatedCredits: 0,
        missChars: 0,
        hitChars: 0,
        remainingCredits: null,
        errorMessage: null,
      });

      let missChars = 0;
      let hitChars = 0;
      let estimatedCredits = 0;
      let remainingCredits: number | null = null;

      try {
        for (let i = 0; i < work.length; i++) {
          if (abortRef.current !== runId) return;
          const item = work[i]!;
          setProgress((prev) => ({
            ...prev,
            status: "running",
            doneCount: i,
            totalCount: work.length,
            currentLabel: item.label,
            estimatedCredits,
            missChars,
            hitChars,
            remainingCredits,
          }));

          const body =
            item.module === "__liquid__"
              ? {
                  module: "__liquid__",
                  targets: args.targets,
                  isCover: args.isCover,
                  isHandle: args.isHandle,
                  aiModel: args.aiModel,
                }
              : {
                  target: item.target,
                  module: item.module,
                  isCover: args.isCover,
                  isHandle: args.isHandle,
                  aiModel: args.aiModel,
                  source: args.source,
                };

          const res = await fetch("/api/translate-v4/estimate-detailed", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const text = await res.text();
          const data = text.trim()
            ? (JSON.parse(text) as ShardResponse)
            : null;
          if (!res.ok || !data?.ok || !data.shard) {
            throw new Error(data?.error || `HTTP ${res.status}`);
          }

          missChars += Math.max(0, Math.floor(data.shard.missChars ?? 0));
          hitChars += Math.max(0, Math.floor(data.shard.hitChars ?? 0));
          estimatedCredits += Math.max(
            0,
            Math.floor(data.shard.estimatedCredits ?? 0),
          );
          if (typeof data.shard.remainingCredits === "number") {
            remainingCredits = data.shard.remainingCredits;
          }
        }

        if (abortRef.current !== runId) return;
        setProgress({
          status: "done",
          doneCount: work.length,
          totalCount: work.length,
          currentLabel: "",
          estimatedCredits: Math.max(0, estimatedCredits),
          missChars,
          hitChars,
          remainingCredits,
          errorMessage: null,
        });
      } catch (err) {
        if (abortRef.current !== runId) return;
        setProgress({
          status: "error",
          doneCount: 0,
          totalCount: work.length,
          currentLabel: "",
          estimatedCredits: estimatedCredits > 0 ? estimatedCredits : null,
          missChars,
          hitChars,
          remainingCredits,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [],
  );

  useEffect(() => {
    return () => {
      abortRef.current += 1;
    };
  }, []);

  return { progress, run, reset };
}
