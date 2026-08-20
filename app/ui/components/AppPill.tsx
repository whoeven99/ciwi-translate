import type { CSSProperties, ReactNode } from "react";
import { appAccents, appColors, appFontSizes, appRadius } from "~/ui/tokens";

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
    color: appColors.textSecondary,
  },
  info: {
    border: "1px solid transparent",
    background: appAccents.primarySoft,
    color: appAccents.primary,
  },
  success: {
    border: "1px solid transparent",
    background: appAccents.growthSoft,
    color: appAccents.growth,
  },
  warning: {
    border: "1px solid transparent",
    background: appAccents.utilitySoft,
    color: appAccents.utility,
  },
  critical: {
    border: "1px solid transparent",
    background: appAccents.criticalSoft,
    color: appAccents.critical,
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
 * 需要表达资源状态时用 Polaris `Badge` 或 `AppStatusBadge`，不要用这个。
 */
export default function AppPill({ children, tone = "neutral", style }: AppPillProps) {
  return (
    <span style={{ ...basePillStyle, ...toneStyles[tone], ...style }}>{children}</span>
  );
}
