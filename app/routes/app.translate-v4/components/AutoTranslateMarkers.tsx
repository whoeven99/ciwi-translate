import { useTranslation } from "react-i18next";
import { v4ToneChip } from "../v4Styles";

const autoMarkerBadgeStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  maxWidth: "100%",
  padding: "3px 8px",
  fontSize: 12,
  fontWeight: 600,
  lineHeight: 1.5,
  textAlign: "center",
  whiteSpace: "normal",
  overflowWrap: "anywhere",
  color: v4ToneChip.success.color,
  background: v4ToneChip.success.background,
  borderRadius: 999,
  border: "1px solid transparent",
} as const;

type BadgeProps = {
  lastUpdateHint?: string | null;
  nextUpdateHint?: string | null;
};

/** 与语言页自动翻译开关同源（ShopTargetLocale.autoTranslate）。 */
export function AutoTranslateBadge({ lastUpdateHint, nextUpdateHint }: BadgeProps = {}) {
  const { t } = useTranslation();
  const hasHints = Boolean(lastUpdateHint || nextUpdateHint);

  return (
    <span className="v4-auto-badge-wrap">
      <span style={autoMarkerBadgeStyle}>{t("v4.autoTranslate.badge")}</span>
      {hasHints ? (
        <span className="v4-auto-badge-hints" aria-hidden>
          {lastUpdateHint ? <span>{lastUpdateHint}</span> : null}
          {nextUpdateHint ? <span>{nextUpdateHint}</span> : null}
        </span>
      ) : null}
    </span>
  );
}

/** 任务队列：自动任务来源标记，样式与覆盖率「自动翻译」一致。 */
export function AutoTaskBadge() {
  const { t } = useTranslation();
  return <span style={autoMarkerBadgeStyle}>{t("v4.autoTranslate.taskBadge")}</span>;
}
