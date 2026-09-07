/**
 * TS 侧唯一的设计 token 出口。值全部指向 `app/styles.css` 里定义的 `--app-*`
 * CSS 变量，所以 `app/routes/app.ui-library-demo` 的配置台可以在预览容器上
 * 覆盖同名变量做实时换肤，而无需改动组件代码。
 *
 * 写 inline style 时用这里的常量，不要直接写十六进制色值或魔法 px。
 */

export const appColors = {
  bg: "var(--app-color-bg)",
  surface: "var(--app-color-surface)",
  surfaceSecondary: "var(--app-color-surface-secondary)",
  surfaceHover: "var(--app-color-surface-hover)",
  surfaceSelected: "var(--app-color-surface-selected)",
  surfaceInfo: "var(--app-color-surface-info)",
  surfaceSuccess: "var(--app-color-surface-success)",
  surfaceCaution: "var(--app-color-surface-caution)",
  surfaceCritical: "var(--app-color-surface-critical)",
  border: "var(--app-color-border)",
  borderSecondary: "var(--app-color-border-secondary)",
  text: "var(--app-color-text)",
  textSecondary: "var(--app-color-text-secondary)",
  textTertiary: "var(--app-color-text-tertiary)",
  textInfo: "var(--app-color-text-info)",
  textSuccess: "var(--app-color-text-success)",
  textCaution: "var(--app-color-text-caution)",
  textCritical: "var(--app-color-text-critical)",
} as const;

export const appAccents = {
  primary: "var(--app-accent-primary)",
  primaryHover: "var(--app-accent-primary-hover)",
  primaryDeep: "var(--app-accent-primary-deep)",
  primarySoft: "var(--app-accent-primary-soft)",
  primaryMuted: "var(--app-accent-primary-muted)",
  onFill: "var(--app-color-brand-on-fill)",
  growth: "var(--app-accent-growth)",
  growthSoft: "var(--app-accent-growth-soft)",
  utility: "var(--app-accent-utility)",
  utilitySoft: "var(--app-accent-utility-soft)",
  critical: "var(--app-accent-critical)",
  criticalSoft: "var(--app-accent-critical-soft)",
} as const;

export const appFontSizes = {
  body: "var(--app-font-size-body)",
  bodySmall: "var(--app-font-size-body-small)",
  caption: "var(--app-font-size-caption)",
  micro: "var(--app-font-size-micro)",
} as const;

export const appSpace = {
  s100: "var(--app-space-100)",
  s200: "var(--app-space-200)",
  s300: "var(--app-space-300)",
  s400: "var(--app-space-400)",
  s500: "var(--app-space-500)",
  s600: "var(--app-space-600)",
} as const;

export const appRadius = {
  sm: "var(--app-radius-sm)",
  md: "var(--app-radius-md)",
  lg: "var(--app-radius-lg)",
} as const;

export const appShadows = {
  card: "var(--app-shadow-card)",
  cardStrong: "var(--app-shadow-card-strong)",
} as const;

export const appTokens = {
  color: appColors,
  accent: appAccents,
  fontSize: appFontSizes,
  space: appSpace,
  radius: appRadius,
  shadow: appShadows,
} as const;
