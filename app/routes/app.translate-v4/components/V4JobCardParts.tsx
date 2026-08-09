import { useTranslation } from "react-i18next";
import type { TranslationJobProgressSummary } from "~/server/translateV4/progress.server";
import { v4Colors } from "../v4Styles";
import {
  miniStageSegmentState,
  type VisibleStageIndex,
} from "../jobStageUtils";
import { V4_STAGE_KEYS } from "../v4I18n";

/** 首帧骨架条：任务列表与覆盖率改由客户端补齐，占位期间不闪 0 值或空态文案。 */
export function V4Skeleton({
  width,
  height,
  radius = 6,
}: {
  width: number | string;
  height: number;
  radius?: number;
}) {
  return (
    <span
      aria-hidden
      className="v4-skeleton"
      style={{
        display: "inline-block",
        width,
        height,
        borderRadius: radius,
        verticalAlign: "middle",
      }}
    />
  );
}

export function ProgressRing({ percent, size = "md" }: { percent: number; size?: "md" | "sm" }) {
  const dash = `${percent} 100`;
  const done = percent >= 100;
  const dim = size === "sm" ? 44 : 58;
  const fontSize = size === "sm" ? 10 : 12;
  const strokeWidth = size === "sm" ? 2.8 : 3.2;
  return (
    <div style={{ position: "relative", width: dim, height: dim, flexShrink: 0 }}>
      <svg viewBox="0 0 36 36" style={{ width: dim, height: dim, transform: "rotate(-90deg)" }}>
        <circle cx="18" cy="18" r="15.5" fill="none" stroke={v4Colors.ringTrack} strokeWidth={strokeWidth} />
        <circle
          cx="18"
          cy="18"
          r="15.5"
          fill="none"
          stroke={done ? v4Colors.success : v4Colors.primary}
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
          alignItems: "center",
          justifyContent: "center",
          fontFamily: v4Colors.mono,
          fontSize,
          fontWeight: 600,
          color: v4Colors.text,
        }}
      >
        {percent}%
      </div>
    </div>
  );
}

const MINI_STAGE_INDICES: VisibleStageIndex[] = [0, 1, 2];

/** 列表卡片：三阶段迷你进度（初始化 → 翻译 → 写回，不含 verify）。 */
export function MiniStageTrack({ job }: { job: TranslationJobProgressSummary }) {
  const { t } = useTranslation();
  const segments = MINI_STAGE_INDICES.map((idx) => ({
    idx,
    label: t(V4_STAGE_KEYS[idx]),
    ...miniStageSegmentState(idx, job),
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {segments.map((seg, i) => (
          <div key={seg.idx} style={{ flex: 1, display: "flex", alignItems: "center", minWidth: 0 }}>
            {i > 0 ? (
              <span
                aria-hidden
                style={{
                  width: 8,
                  height: 1,
                  flexShrink: 0,
                  marginRight: 6,
                  background: segments[i - 1]!.complete ? v4Colors.successSoft : v4Colors.progressTrack,
                }}
              />
            ) : null}
            <div
              style={{
                flex: 1,
                height: 5,
                borderRadius: 999,
                background: v4Colors.progressTrack,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${seg.percent}%`,
                  borderRadius: 999,
                  background: seg.complete
                    ? v4Colors.successSoft
                    : seg.active
                      ? v4Colors.primary
                      : v4Colors.ringTrack,
                  transition: "width 0.45s ease, background 0.2s",
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {segments.map((seg) => (
          <span
            key={seg.idx}
            style={{
              flex: 1,
              minWidth: 0,
              textAlign: "center",
              fontSize: 11,
              fontWeight: seg.active ? 700 : 500,
              color: seg.complete
                ? v4Colors.success
                : seg.active
                  ? v4Colors.primary
                  : v4Colors.textFaint,
              lineHeight: 1.25,
              letterSpacing: "0.01em",
              whiteSpace: "normal",
              overflowWrap: "anywhere",
            }}
          >
            {seg.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function StatusTag({
  status,
  label,
}: {
  status: TranslationJobProgressSummary["status"];
  label: string;
}) {
  let bg: string = v4Colors.primarySoft;
  let color: string = v4Colors.primary;
  if (status === "COMPLETED") {
    bg = v4Colors.successBg;
    color = v4Colors.success;
  } else if (status === "PAUSED") {
    bg = v4Colors.warningBg;
    color = v4Colors.warning;
  } else if (status === "CANCELLED") {
    bg = v4Colors.cardSubdued;
    color = v4Colors.textMuted;
  } else if (status === "FAILED") {
    bg = v4Colors.dangerBg;
    color = v4Colors.danger;
  }

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 12,
        fontWeight: 600,
        padding: "3px 8px",
        borderRadius: 999,
        background: bg,
        color,
        maxWidth: "100%",
        textAlign: "center",
        lineHeight: 1.35,
        whiteSpace: "normal",
        overflowWrap: "anywhere",
        border: `1px solid ${status === "COMPLETED"
          ? "#d9f7be"
          : status === "PAUSED"
            ? "#ffe58f"
            : status === "FAILED"
              ? "#ffccc7"
              : status === "CANCELLED"
                ? v4Colors.cardBorder
                : "#bae0ff"}`,
      }}
    >
      {label}
    </span>
  );
}
