import type { CSSProperties } from "react";
import { appColors } from "~/ui/tokens";

type AppStatusTone = "neutral" | "info" | "success" | "caution" | "critical";

interface AppStatusBadgeProps {
  tone?: AppStatusTone;
  children: string;
  style?: CSSProperties;
}

const toneStyles: Record<AppStatusTone, CSSProperties> = {
  neutral: {
    background: appColors.surfaceSecondary,
    color: appColors.text,
    border: `1px solid ${appColors.borderSecondary}`,
  },
  info: {
    background: appColors.surfaceInfo,
    color: appColors.textInfo,
    border: "1px solid transparent",
  },
  success: {
    background: appColors.surfaceSuccess,
    color: appColors.textSuccess,
    border: "1px solid transparent",
  },
  caution: {
    background: appColors.surfaceCaution,
    color: appColors.textCaution,
    border: "1px solid transparent",
  },
  critical: {
    background: appColors.surfaceCritical,
    color: appColors.textCritical,
    border: "1px solid transparent",
  },
};

export default function AppStatusBadge({
  tone = "neutral",
  children,
  style,
}: AppStatusBadgeProps) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 24,
        padding: "2px 10px",
        borderRadius: 9999,
        fontSize: "var(--app-font-size-caption)",
        lineHeight: "16px",
        fontWeight: 600,
        whiteSpace: "nowrap",
        ...toneStyles[tone],
        ...style,
      }}
    >
      {children}
    </span>
  );
}
