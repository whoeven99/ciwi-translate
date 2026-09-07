import type { CSSProperties, ReactNode } from "react";
import { appColors, appFontSizes, appRadius } from "~/ui/tokens";

export type AppPillTone = "neutral" | "info" | "success" | "warning" | "critical";

interface AppPillProps {
  children: ReactNode;
  tone?: AppPillTone;
  style?: CSSProperties;
}

const toneStyles: Record<AppPillTone, CSSProperties> = {
  neutral: {
    border: `1px solid ${appColors.borderSecondary}`,
    background: appColors.surface,
    color: appColors.text,
  },
  info: {
    border: "1px solid transparent",
    background: appColors.surfaceInfo,
    color: appColors.textInfo,
  },
  success: {
    border: "1px solid transparent",
    background: appColors.surfaceSuccess,
    color: appColors.textSuccess,
  },
  warning: {
    border: "1px solid transparent",
    background: appColors.surfaceCaution,
    color: appColors.textCaution,
  },
  critical: {
    border: "1px solid transparent",
    background: appColors.surfaceCritical,
    color: appColors.textCritical,
  },
};

const basePillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 28,
  padding: "0 10px",
  borderRadius: appRadius.md,
  fontSize: appFontSizes.caption,
  fontWeight: 600,
  whiteSpace: "nowrap",
};

/**
 * 轻量标签：用于展示只读的元信息（覆盖率、待译条目、额度、耗时等）。
 * 色调走 Polaris 语义 surface + text token，保证字色对比度 ≥ WCAG AA 4.5:1。
 * 需要表达资源状态时用 Polaris `Badge` 或 `AppStatusBadge`，不要用这个。
 */
export default function AppPill({ children, tone = "neutral", style }: AppPillProps) {
  return (
    <span style={{ ...basePillStyle, ...toneStyles[tone], ...style }}>{children}</span>
  );
}
