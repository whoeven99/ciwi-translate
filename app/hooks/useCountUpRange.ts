import { useEffect, useRef, useState } from "react";

/**
 * 数字从 from 平滑滚动到 to（缓出曲线）。
 * enabled=false 或 to<=from 时直接显示 to，避免普通进入页面也播动画。
 */
export function useCountUpRange(
  from: number,
  to: number,
  options?: { enabled?: boolean; durationMs?: number },
): number {
  const enabled = options?.enabled ?? false;
  const durationMs = options?.durationMs ?? 1200;
  const safeFrom = Number.isFinite(from) ? from : 0;
  const safeTo = Number.isFinite(to) ? to : 0;
  const [value, setValue] = useState(safeTo);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (!enabled || safeTo <= safeFrom) {
      setValue(safeTo);
      return;
    }

    const start = performance.now();
    const delta = safeTo - safeFrom;
    setValue(safeFrom);
    const animate = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(safeFrom + delta * eased));
      if (p < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        setValue(safeTo);
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [safeFrom, safeTo, enabled, durationMs]);

  return value;
}
