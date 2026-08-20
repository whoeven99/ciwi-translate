import type { CSSProperties, ReactNode } from "react";
import { appAccents, appColors } from "~/ui/tokens";

const ringPrimary = `var(--v4-accent-primary, ${appAccents.primary})`;
const ringTrack = `var(--v4-ring-track, ${appAccents.primarySoft})`;

export interface AppProgressRingProps {
  percent: number | null;
  size?: number;
  strokeWidth?: number;
  /** 圆心主文案，默认显示百分比 */
  center?: ReactNode;
  /** 圆心副文案（如「整体覆盖率」） */
  sublabel?: ReactNode;
  loading?: boolean;
  /** 100% 时使用 success 色而非 primary */
  successAtFull?: boolean;
  style?: CSSProperties;
}

/**
 * SVG 圆环进度（圆角端点），与 UI demo / MVP 覆盖率环同一视觉语言。
 * 在 `.v4-page` 内自动跟随 v4 靛蓝 token。
 */
export default function AppProgressRing({
  percent,
  size = 132,
  strokeWidth = 3,
  center,
  sublabel,
  loading = false,
  successAtFull = false,
  style,
}: AppProgressRingProps) {
  const safePercent =
    percent == null || loading
      ? 0
      : Math.max(0, Math.min(percent, 100));
  const dash = `${safePercent} 100`;
  const done = safePercent >= 100;
  const stroke = done && successAtFull ? appAccents.growth : ringPrimary;

  const centerContent =
    center ??
    (loading || percent == null ? "—" : `${Math.round(safePercent)}%`);

  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        flexShrink: 0,
        ...style,
      }}
    >
      <svg
        viewBox="0 0 36 36"
        style={{ width: size, height: size, transform: "rotate(-90deg)" }}
        aria-hidden
      >
        <circle
          cx="18"
          cy="18"
          r="15.5"
          fill="none"
          stroke={ringTrack}
          strokeWidth={strokeWidth}
        />
        <circle
          cx="18"
          cy="18"
          r="15.5"
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeDasharray={dash}
          strokeLinecap="round"
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: "0 8px",
        }}
      >
        <span
          style={{
            fontSize: size >= 120 ? 28 : size >= 80 ? 22 : 12,
            fontWeight: 700,
            letterSpacing: "-0.03em",
            lineHeight: 1,
            color: appColors.text,
            fontFamily:
              size < 80
                ? "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
                : undefined,
          }}
        >
          {centerContent}
        </span>
        {sublabel ? (
          <span
            style={{
              fontSize: size >= 120 ? 11 : 10,
              color: appColors.textSecondary,
              marginTop: size >= 120 ? 6 : 2,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              lineHeight: 1.25,
            }}
          >
            {sublabel}
          </span>
        ) : null}
      </div>
    </div>
  );
}
