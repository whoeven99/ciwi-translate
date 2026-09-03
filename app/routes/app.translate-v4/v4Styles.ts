import type { CSSProperties } from "react";

export const v4Colors = {
  cardBg: "var(--app-color-surface)",
  cardSubdued: "var(--app-color-surface-secondary)",
  cardSelected: "var(--app-color-surface-selected)",
  cardBorder: "var(--app-color-border-secondary)",
  divider: "var(--app-color-border-secondary)",
  summaryBg:
    "linear-gradient(135deg, rgba(255, 255, 255, 0.96) 0%, rgba(246, 248, 252, 0.92) 55%, rgba(29, 154, 127, 0.05) 100%)",
  primary: "var(--v4-accent-primary, var(--app-accent-primary))",
  primaryHover: "var(--v4-accent-primary-hover, var(--app-accent-primary-hover))",
  primaryTextOnFill: "var(--app-color-brand-on-fill)",
  primarySoft: "var(--v4-accent-primary-soft, var(--app-accent-primary-soft))",
  infoBg: "var(--p-color-bg-surface-info)",
  info: "var(--p-color-text-info)",
  successBg: "var(--app-accent-growth-soft)",
  success: "var(--app-accent-growth)",
  successSoft: "rgba(29, 154, 127, 0.28)",
  warningBg: "var(--app-accent-utility-soft)",
  warning: "var(--app-accent-utility)",
  dangerBg: "var(--app-accent-critical-soft)",
  danger: "var(--app-accent-critical)",
  text: "var(--app-color-text)",
  textMuted: "var(--app-color-text-secondary)",
  textFaint: "var(--app-color-text-tertiary)",
  textLight: "var(--app-color-text-secondary)",
  ringTrack: "var(--v4-ring-track, rgba(84, 103, 255, 0.16))",
  progressTrack: "var(--app-color-surface-secondary)",
  disabledBg: "var(--app-color-surface-secondary)",
  disabledText: "var(--app-color-text-tertiary)",
  // 字体
  font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
} as const;

/** 着色标签字色：Polaris 语义 surface + text，保证 ≥ WCAG AA 4.5:1。不要用 accent fill 当 12px 字。 */
export const v4ToneChip = {
  info: {
    background: "var(--app-color-surface-info)",
    color: "var(--app-color-text-info)",
  },
  success: {
    background: "var(--app-color-surface-success)",
    color: "var(--app-color-text-success)",
  },
  caution: {
    background: "var(--app-color-surface-caution)",
    color: "var(--app-color-text-caution)",
  },
  critical: {
    background: "var(--app-color-surface-critical)",
    color: "var(--app-color-text-critical)",
  },
} as const;

export const v4PageStyle: CSSProperties = {
  background: "var(--app-color-bg)",
  minHeight: "calc(100vh - 48px)",
  fontFamily: v4Colors.font,
  color: v4Colors.text,
  WebkitFontSmoothing: "antialiased",
};

export const v4ContentStyle: CSSProperties = {
  width: "100%",
};

export const v4CardStyle: CSSProperties = {
  background: v4Colors.cardBg,
  borderRadius: 16,
  border: `1px solid ${v4Colors.cardBorder}`,
  boxShadow: "var(--app-shadow-card)",
};

/** 概览区左右双卡默认最小高度（覆盖率未展开语言列表时对齐）。 */
export const V4_OVERVIEW_CARD_MIN_HEIGHT = 284;

export function v4ChipStyle(selected: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 12px",
    borderRadius: 999,
    border: `1px solid ${selected ? v4Colors.primary : v4Colors.cardBorder}`,
    background: selected ? v4Colors.primarySoft : v4Colors.cardBg,
    color: selected ? v4Colors.info : v4Colors.text,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.15s",
    fontFamily: "inherit",
  };
}
