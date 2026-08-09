import { useTranslation } from "react-i18next";
import { v4Colors, V4_OVERVIEW_CARD_MIN_HEIGHT } from "../v4Styles";
import { formatCredits } from "../localeDisplay";
import type { CoverageSummary } from "~/server/translateV4/coverage.server";
import AppPageHeader from "~/ui/components/AppPageHeader";
import AppStatusBadge from "~/ui/components/AppStatusBadge";
import { useCountUp } from "../hooks/useCountUp";
import { formatV4PlanType } from "../v4I18n";
import { V4Skeleton } from "./V4JobCardParts";

type Props = {
  summary: CoverageSummary;
  compact?: boolean;
  /** 首帧骨架：文档不再阻塞等覆盖率，数据到达前不显示会被改写的 0。 */
  loading?: boolean;
};

/** 左侧摘要卡固定宽度与高度，不随右侧表单展开而拉伸。 */
const SUMMARY_CARD_WIDTH = 296;
const SUMMARY_RING_SIZE = 148;

export function SummaryDonutCard({
  summary,
  compact = false,
  loading = false,
}: Props) {
  const { t } = useTranslation();
  const percent = summary.overallPercent ?? 0;
  const translatedLanguageCount = summary.locales.filter((row) => (row.percent ?? 0) > 0).length;
  const pendingItems = Math.max(summary.totalItems - summary.translatedItems, 0);

  // 数字滚动动画（挂载时从 0 滚到目标值，刷新统计后重新滚动）
  const animatedPercent = useCountUp(percent);
  const animatedTranslatedLang = useCountUp(translatedLanguageCount);
  const animatedTranslatedItems = useCountUp(summary.translatedItems);
  const animatedPendingItems = useCountUp(pendingItems);
  const dash = `${animatedPercent} 100`;

  if (compact) {
    return (
      <div
        className="v4-enter v4-enter-d1 v4-lift"
        style={{
          background: v4Colors.summaryBg,
          borderRadius: 18,
          padding: "20px 22px",
          color: v4Colors.text,
          width: "100%",
          height: "100%",
          minWidth: 0,
          minHeight: V4_OVERVIEW_CARD_MIN_HEIGHT,
          boxSizing: "border-box",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "stretch",
          flexWrap: "wrap",
          gap: 24,
          border: `1px solid ${v4Colors.cardBorder}`,
          boxShadow: "var(--app-shadow-card-strong)",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-start",
            minWidth: 0,
            flex: 1,
            flexBasis: 320,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: "-0.02em",
                color: v4Colors.text,
                lineHeight: 1.4,
                overflowWrap: "anywhere",
              }}
            >
              {t("v4.siteTranslationStatus")}
            </div>
            <div
              style={{
                fontSize: 13,
                color: v4Colors.textMuted,
                marginTop: 6,
                lineHeight: "20px",
                fontWeight: 400,
                overflowWrap: "anywhere",
              }}
            >
              {loading ? (
                <V4Skeleton width={200} height={14} />
              ) : (
                t("v4.targetLanguagesSummary", {
                  total: summary.languageCount,
                  translated: translatedLanguageCount,
                })
              )}
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
              gap: 12,
              borderTop: `1px solid ${v4Colors.divider}`,
              paddingTop: 14,
              marginTop: 72,
            }}
          >
            <StatFoot
              label={t("v4.translationProgress")}
              value={`${animatedPercent}%`}
              unit={t("v4.overallCompletion")}
              loading={loading}
            />
            <StatFoot
              label={t("v4.languagesWithContent")}
              value={`${animatedTranslatedLang}`}
              unit={t("v4.outOfLanguages", { count: summary.languageCount })}
              loading={loading}
            />
            <StatFoot
              label={t("v4.translatedItems")}
              value={formatLargeCount(animatedTranslatedItems)}
              unit={t("v4.done")}
              loading={loading}
            />
            <StatFoot
              label={t("v4.pendingItems")}
              value={formatLargeCount(animatedPendingItems)}
              unit={t("v4.pending")}
              loading={loading}
            />
          </div>
        </div>
        <div
          style={{
            width: 148,
            minWidth: 148,
            maxWidth: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginLeft: "auto",
          }}
        >
          <div
            style={{
              position: "relative",
              width: 132,
              height: 132,
              flexShrink: 0,
            }}
          >
            <svg
              viewBox="0 0 36 36"
              style={{
                width: 132,
                height: 132,
                transform: "rotate(-90deg)",
              }}
            >
              <circle
                cx="18"
                cy="18"
                r="15.5"
                fill="none"
                stroke={v4Colors.ringTrack}
                strokeWidth="3"
              />
              <circle
                cx="18"
                cy="18"
                r="15.5"
                fill="none"
                stroke={v4Colors.primary}
                strokeWidth="3"
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
              }}
            >
              <span
                style={{
                  fontSize: 28,
                  fontWeight: 700,
                  letterSpacing: "-0.03em",
                  lineHeight: 1,
                  color: v4Colors.text,
                }}
              >
                {loading
                ? "—"
                : summary.overallPercent != null
                  ? `${animatedPercent}%`
                  : "—"}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: v4Colors.textMuted,
                  marginTop: 6,
                  fontWeight: 600,
                  letterSpacing: "-0.01em",
                }}
              >
                {t("v4.overallCoverage")}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        background: v4Colors.summaryBg,
        borderRadius: 16,
        padding: "16px",
        color: v4Colors.text,
        display: "flex",
        flexDirection: "column",
        width: SUMMARY_CARD_WIDTH,
        minWidth: SUMMARY_CARD_WIDTH,
        boxSizing: "border-box",
        flexShrink: 0,
        border: `1px solid ${v4Colors.cardBorder}`,
        boxShadow: "var(--app-shadow-card-strong)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "8px 0 20px",
        }}
      >
        <div style={{ position: "relative", width: SUMMARY_RING_SIZE, height: SUMMARY_RING_SIZE }}>
          <svg
            viewBox="0 0 36 36"
            style={{ width: SUMMARY_RING_SIZE, height: SUMMARY_RING_SIZE, transform: "rotate(-90deg)" }}
          >
            <circle cx="18" cy="18" r="15.5" fill="none" stroke={v4Colors.ringTrack} strokeWidth="3" />
            <circle
              cx="18"
              cy="18"
              r="15.5"
              fill="none"
              stroke={v4Colors.primary}
              strokeWidth="3"
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
            }}
          >
            <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1, color: v4Colors.text }}>
              {loading
                ? "—"
                : summary.overallPercent != null
                  ? `${animatedPercent}%`
                  : "—"}
            </span>
            <span style={{ fontSize: 11, color: v4Colors.primaryHover ?? v4Colors.primary, marginTop: 4, fontWeight: 600 }}>
              {t("v4.translated")}
            </span>
          </div>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          borderTop: `1px solid ${v4Colors.divider}`,
          paddingTop: 16,
          flexShrink: 0,
        }}
      >
        <StatFoot
          label={t("v4.languages")}
          value={`${summary.languageCount}`}
          unit={t("v4.languages")}
        />
        <StatFoot
          label={t("v4.translatedItems")}
          value={formatLargeCount(summary.translatedItems)}
          unit={t("v4.translatedItems")}
          align="right"
        />
      </div>
    </div>
  );
}

function StatFoot({
  label,
  value,
  unit,
  align = "left",
  loading = false,
}: {
  label: string;
  value: string;
  unit: string;
  align?: "left" | "right";
  loading?: boolean;
}) {
  return (
    <div style={{ textAlign: align, minWidth: 0 }}>
      <div
        style={{
          fontSize: 11,
          color: v4Colors.textMuted,
          fontWeight: 500,
          marginBottom: 6,
          letterSpacing: "-0.01em",
          lineHeight: 1.35,
          overflowWrap: "anywhere",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 700,
          lineHeight: 1.1,
          letterSpacing: "-0.03em",
          color: v4Colors.text,
        }}
      >
        {loading ? <V4Skeleton width={64} height={22} /> : value}
      </div>
      <div
        style={{
          fontSize: 11,
          color: v4Colors.textMuted,
          fontWeight: 500,
          marginTop: 4,
          letterSpacing: "-0.01em",
          lineHeight: 1.35,
          overflowWrap: "anywhere",
        }}
      >
        {unit}
      </div>
    </div>
  );
}

function formatLargeCount(n: number): string {
  return n.toLocaleString();
}

export function PageHeaderBar({
  credits,
  planType,
}: {
  credits: number | null;
  planType: string | null;
}) {
  const { t } = useTranslation();
  const planLabel = formatV4PlanType(planType, t);

  return (
    <AppPageHeader
      style={{ marginBottom: 18 }}
      title={t("v4.title")}
      extra={
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            justifyContent: "flex-end",
            minWidth: 0,
          }}
        >
          <AppStatusBadge tone="info">{planLabel}</AppStatusBadge>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
              minWidth: 0,
              padding: "8px 12px",
              borderRadius: 999,
              background: v4Colors.cardBg,
              border: `1px solid ${v4Colors.cardBorder}`,
              color: v4Colors.textMuted,
            }}
          >
            <span style={{ fontSize: 12, color: v4Colors.textMuted, lineHeight: 1.35, overflowWrap: "anywhere" }}>
              {t("v4.availableCredits")}
            </span>
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: v4Colors.success,
                letterSpacing: "-0.01em",
              }}
            >
              {credits != null ? `${formatCredits(credits)}` : "—"}
            </span>
          </div>
        </div>
      }
    />
  );
}

export function coverageBarColor(percent: number | null): string {
  if (percent == null) return v4Colors.textMuted;
  if (percent >= 100) return v4Colors.success;
  if (percent >= 60) return v4Colors.primary;
  return v4Colors.warning;
}
