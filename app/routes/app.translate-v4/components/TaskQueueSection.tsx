import { useEffect, useMemo, useState } from "react";
import { Button, InlineStack, Text } from "@shopify/polaris";
import { useNavigate } from "@remix-run/react";
import { useTranslation } from "react-i18next";
import type { CSSProperties } from "react";
import type { TranslationJobProgressSummary } from "~/server/translateV4/progress.server";
import { canPauseV4Job, isAutoV4TaskSource } from "~/server/translateV4/types";
import { v4Colors, v4CardStyle } from "../v4Styles";
import { formatLocaleRoute } from "../localeDisplay";
import { jobDisplayPercent } from "../jobStageUtils";
import { ProgressRing, StatusTag, MiniStageTrack, V4Skeleton } from "./V4JobCardParts";
import { AutoTaskBadge } from "./AutoTranslateMarkers";
import { JobCollapsedMeta, JobSummaryStats, JobStageProgressList } from "./JobExpandedDetail";
import {
  getV4JobStatusLabel,
  getV4VisibleStageLabel,
} from "../v4I18n";
import { getV4JobNotice } from "../v4JobNotice";
import { isCurrentV4Job, isHistoryV4Job } from "../jobFilters";

type Props = {
  job: TranslationJobProgressSummary;
  translateSlotBusy: boolean;
  highlighted?: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onBuyCredits: (job: TranslationJobProgressSummary) => void;
  onAction: (
    taskId: string,
    action: "pause" | "resume" | "cancel" | "delete",
  ) => Promise<boolean>;
};

export function CompactJobCard({
  job,
  translateSlotBusy,
  highlighted = false,
  expanded,
  onToggleExpand,
  onBuyCredits,
  onAction,
}: Props) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<null | "pause" | "resume" | "cancel" | "delete">(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const displayStatusLabel = getV4JobStatusLabel(job, t, translateSlotBusy);
  const notice = getV4JobNotice(job.errorMessage, t);
  const isCancelledLike = job.status === "CANCELLED" || notice.kind === "cancelled";

  const percent = jobDisplayPercent(job);

  const canResume = job.canResume && !isCancelledLike;
  const canPause = canPauseV4Job(job.status) && !job.isStopping;
  const canCancel =
    job.status !== "COMPLETED" &&
    job.status !== "CANCELLED" &&
    !job.isStopping &&
    !isCancelledLike;
  const canDelete =
    job.isTerminal ||
    job.status === "PAUSED" ||
    job.status === "CANCELLED" ||
    job.status === "FAILED" ||
    isCancelledLike ||
    job.status === "COMPLETED";

  useEffect(() => {
    if (!pending) return;
    if (pending === "resume" && !canResume) {
      setPending(null);
      return;
    }
    if (pending === "pause" && !canPause) {
      setPending(null);
      return;
    }
    if (pending === "cancel" && (isCancelledLike || !canCancel)) {
      setPending(null);
    }
  }, [pending, canResume, canPause, canCancel, isCancelledLike]);

  useEffect(() => {
    if (!canDelete) {
      setDeleteConfirmOpen(false);
    }
  }, [canDelete]);

  const runAction = (action: "pause" | "resume" | "cancel" | "delete") => {
    setPending(action);
    void (async () => {
      const ok = await onAction(job.taskId, action);
      if (!ok) setPending(null);
    })();
  };

  // 顶部三阶段迷你进度（不含 verify）
  const stageSummary = job.isTerminal
    ? job.status === "COMPLETED"
      ? ""
      : job.status === "CANCELLED"
        ? ""
        : t("v4.tasks.ended")
    : t("v4.tasks.inProgress", { stage: getV4VisibleStageLabel(job, t) });

  return (
    <div
      className={highlighted ? "v4-task-card-spotlight" : undefined}
      style={{
        ...v4CardStyle,
        padding: expanded ? "16px 18px" : "14px 16px",
        marginBottom: 10,
        background: expanded ? v4Colors.cardSubdued : v4Colors.cardBg,
        border: highlighted
          ? `1px solid ${v4Colors.primary}`
          : expanded
            ? "1px solid #d6e4ff"
            : "none",
        boxShadow: "var(--app-shadow-card)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <ProgressRing percent={percent} size="sm" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 800, fontSize: 14, color: v4Colors.text, minWidth: 0, overflowWrap: "anywhere" }}>
              {formatLocaleRoute(job.source, job.target)}
            </span>
            {highlighted ? <JustCreatedBadge /> : null}
            {isAutoV4TaskSource(job.taskSource) ? <AutoTaskBadge /> : null}
            <StatusTag status={job.status} label={displayStatusLabel} />
            {stageSummary ? (
              <span style={{ fontSize: 12, color: v4Colors.textFaint, fontWeight: 400, minWidth: 0, overflowWrap: "anywhere" }}>
                {stageSummary}
              </span>
            ) : null}
          </div>
          <MiniStageTrack job={job} />
          {!expanded ? <JobCollapsedMeta job={job} /> : null}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0, marginTop: -2 }}>
          <div style={detailToggleButtonWrapStyle}>
            <Button
              variant={expanded ? "secondary" : "plain"}
              size="slim"
              onClick={onToggleExpand}
            >
              {expanded ? t("v4.tasks.collapse") : t("v4.tasks.view")}
            </Button>
          </div>
        </div>
      </div>

      {expanded ? (
        <div
          style={{
            marginTop: 14,
            padding: "14px 14px 12px",
            borderTop: `1px solid ${v4Colors.divider}`,
            background: "rgba(255,255,255,0.6)",
            borderRadius: 10,
          }}
        >
          <JobSummaryStats job={job} />
          <JobStageProgressList job={job} />

          {canResume || canPause || canCancel || canDelete ? (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
                marginTop: 14,
                paddingTop: 12,
                borderTop: `1px solid ${v4Colors.divider}`,
              }}
            >
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {canResume ? (
                  <ActionChip label={t("v4.tasks.resume")} kind="primary" loading={pending === "resume"} onClick={() => runAction("resume")} />
                ) : null}
                {canPause ? (
                  <ActionChip label={t("v4.tasks.pause")} kind="ghost" loading={pending === "pause"} onClick={() => runAction("pause")} />
                ) : null}
                {canCancel ? (
                  <ActionChip label={t("v4.tasks.cancelTask")} kind="danger" loading={pending === "cancel"} onClick={() => runAction("cancel")} />
                ) : null}
              </div>
              {canDelete ? (
                <div style={deleteActionWrapStyle}>
                  <Button
                    tone="critical"
                    variant="secondary"
                    size="slim"
                    onClick={() => setDeleteConfirmOpen((value) => !value)}
                  >
                    {t("v4.tasks.deleteRecord")}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {deleteConfirmOpen ? (
            <div style={deleteConfirmBarStyle}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={deleteConfirmTitleStyle}>
                  {t("v4.tasks.deleteConfirmTitle")}
                </div>
                <div style={deleteConfirmDescStyle}>
                  {t("v4.tasks.deleteConfirmDesc")}
                </div>
              </div>
              <InlineStack gap="200" align="end">
                <Button
                  variant="secondary"
                  size="slim"
                  onClick={() => setDeleteConfirmOpen(false)}
                >
                  {t("Cancel")}
                </Button>
                <Button
                  tone="critical"
                  variant="primary"
                  size="slim"
                  loading={pending === "delete"}
                  onClick={() => runAction("delete")}
                >
                  {t("Delete")}
                </Button>
              </InlineStack>
            </div>
          ) : null}

        </div>
      ) : null}

      {notice.message ? (
        <JobNoticeBar
          message={notice.message}
          tone={job.status === "FAILED" ? "danger" : "warning"}
          actionLabel={notice.action === "buy_credits" ? t("Buy credits") : null}
          onAction={
            notice.action === "buy_credits"
              ? () => onBuyCredits(job)
              : undefined
          }
        />
      ) : null}
    </div>
  );
}

function JustCreatedBadge() {
  const { t } = useTranslation();

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: 999,
        background: v4Colors.primarySoft,
        color: v4Colors.primary,
        fontSize: 11,
        fontWeight: 700,
        lineHeight: 1.5,
      }}
    >
      {t("v4.tasks.justCreated")}
    </span>
  );
}

function JobNoticeBar({
  message,
  tone,
  actionLabel,
  onAction,
}: {
  message: string;
  tone: "warning" | "danger";
  actionLabel?: string | null;
  onAction?: () => void;
}) {
  const isDanger = tone === "danger";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
        marginTop: 12,
        padding: "10px 12px",
        borderRadius: 10,
        background: isDanger ? v4Colors.dangerBg : v4Colors.warningBg,
        border: `1px solid ${isDanger ? "#ffccc7" : "#ffe58f"}`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
          minWidth: 0,
          flex: 1,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            marginTop: 6,
            borderRadius: "50%",
            flexShrink: 0,
            background: isDanger ? v4Colors.danger : v4Colors.warning,
          }}
        />
        <span
          style={{
            fontSize: 12,
            lineHeight: 1.5,
            color: isDanger ? v4Colors.danger : v4Colors.warning,
            overflowWrap: "anywhere",
          }}
        >
          {message}
        </span>
      </div>
      {actionLabel && onAction ? (
        <div style={{ flexShrink: 0 }}>
          <Button variant="primary" size="slim" onClick={onAction}>
            {actionLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ActionChip({
  label,
  onClick,
  loading,
  kind,
}: {
  label: string;
  onClick: () => void;
  loading?: boolean;
  kind: "primary" | "ghost" | "danger";
}) {
  return (
    <div style={actionChipWrapStyle}>
      <Button
        variant={kind === "primary" ? "primary" : "secondary"}
        tone={kind === "danger" ? "critical" : undefined}
        size="slim"
        loading={loading}
        onClick={onClick}
      >
        {label}
      </Button>
    </div>
  );
}

export function TaskQueueSection({
  jobs,
  spotlightTaskIds = [],
  translateSlotBusy,
  loading = false,
  onBuyCredits,
  onAction,
}: {
  jobs: TranslationJobProgressSummary[];
  spotlightTaskIds?: string[];
  translateSlotBusy: boolean;
  /** 首帧骨架：数据到达前不要先闪「暂无任务」空态。 */
  loading?: boolean;
  onBuyCredits: (job: TranslationJobProgressSummary) => void;
  onAction: Props["onAction"];
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const spotlightTaskIdSet = useMemo(
    () => new Set(spotlightTaskIds),
    [spotlightTaskIds],
  );

  useEffect(() => {
    if (spotlightTaskIds.length === 0) return;
    setExpandedTaskId(spotlightTaskIds[0] ?? null);
  }, [spotlightTaskIds]);

  const currentJobs = useMemo(
    () => jobs.filter(isCurrentV4Job),
    [jobs],
  );
  const historyJobs = useMemo(
    () => jobs.filter(isHistoryV4Job),
    [jobs],
  );

  return (
    <div style={{ ...v4CardStyle, padding: "16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: v4Colors.text }}>
            {t("v4.tasks.title", { count: currentJobs.length })}
          </h2>
          <div style={{ marginTop: 4, fontSize: 13, color: v4Colors.textMuted, lineHeight: "20px" }}>
            {t("v4.tasks.currentHelper")}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={() => navigate("/app/translate-v4-history")}
            style={historyEntryButtonStyle}
          >
            {t("v4.tasks.openHistory", { count: historyJobs.length })}
          </button>
          <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: v4Colors.textFaint, fontWeight: 600, minWidth: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: v4Colors.successSoft }} />
            {t("v4.tasks.syncLive")}
          </span>
        </div>
      </div>

      {spotlightTaskIds.length > 0 ? (
        <div
          className="v4-row-enter"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            marginBottom: 12,
            padding: "10px 12px",
            borderRadius: 10,
            background: v4Colors.infoBg,
            border: `1px solid ${v4Colors.primarySoft}`,
            color: v4Colors.info,
          }}
        >
          <span
            aria-hidden
            className="v4-livedot"
            style={{
              width: 8,
              height: 8,
              marginTop: 6,
              borderRadius: "50%",
              background: "currentColor",
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: 13, lineHeight: "20px", overflowWrap: "anywhere" }}>
            {t("v4.tasks.createdHint", { count: spotlightTaskIds.length })}
          </span>
        </div>
      ) : null}

      {loading ? (
        <div style={{ display: "grid", gap: 12 }}>
          {[0, 1].map((row) => (
            <div
              key={row}
              style={{
                borderRadius: 8,
                background: v4Colors.cardSubdued,
                padding: "18px 16px",
                display: "flex",
                alignItems: "center",
                gap: 16,
              }}
            >
              <V4Skeleton width={44} height={44} radius={22} />
              <div style={{ display: "grid", gap: 8, flex: 1, minWidth: 0 }}>
                <V4Skeleton width="42%" height={14} />
                <V4Skeleton width="72%" height={12} />
              </div>
            </div>
          ))}
        </div>
      ) : currentJobs.length === 0 ? (
        <div style={{ borderRadius: 8, background: v4Colors.cardSubdued, padding: "32px 16px" }}>
          <div style={emptyStateStyle}>
            <div style={emptyStateIconStyle} aria-hidden>
              <span style={emptyStateLineStyle} />
              <span style={emptyStateLineStyle} />
              <span style={{ ...emptyStateLineStyle, width: 20 }} />
            </div>
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              {t("v4.tasks.noCurrent")}
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              {t("v4.tasks.noCurrentDesc")}
            </Text>
          </div>
        </div>
      ) : (
        <>
          {currentJobs.map((job) => (
            <CompactJobCard
              key={job.taskId}
              job={job}
              highlighted={spotlightTaskIdSet.has(job.taskId)}
              translateSlotBusy={translateSlotBusy}
              expanded={expandedTaskId === job.taskId}
              onBuyCredits={onBuyCredits}
              onToggleExpand={() =>
                setExpandedTaskId((current) =>
                  current === job.taskId ? null : job.taskId,
                )
              }
              onAction={onAction}
            />
          ))}
        </>
      )}
    </div>
  );
}

const detailToggleButtonWrapStyle: CSSProperties = {
  borderRadius: 8,
  overflow: "hidden",
};

const actionChipWrapStyle: CSSProperties = {
  borderRadius: 8,
  overflow: "hidden",
};

const deleteActionWrapStyle: CSSProperties = {
  borderRadius: 8,
  overflow: "hidden",
};

const deleteConfirmBarStyle: CSSProperties = {
  marginTop: 12,
  padding: "12px 14px",
  borderRadius: 10,
  border: `1px solid ${v4Colors.cardBorder}`,
  background: v4Colors.cardBg,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
  flexWrap: "wrap",
};

const deleteConfirmTitleStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  lineHeight: "20px",
  color: v4Colors.text,
  marginBottom: 4,
};

const deleteConfirmDescStyle: CSSProperties = {
  fontSize: 12,
  lineHeight: "18px",
  color: v4Colors.textMuted,
};

const emptyStateStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 6,
  textAlign: "center",
};

const emptyStateIconStyle: CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 12,
  background: v4Colors.cardBg,
  border: `1px solid ${v4Colors.cardBorder}`,
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  alignItems: "center",
  gap: 4,
  marginBottom: 2,
};

const emptyStateLineStyle: CSSProperties = {
  width: 16,
  height: 2,
  borderRadius: 999,
  background: v4Colors.textFaint,
};

const historyEntryButtonStyle: CSSProperties = {
  padding: 0,
  border: "none",
  background: "transparent",
  color: v4Colors.primary,
  fontSize: 13,
  fontWeight: 600,
  lineHeight: "20px",
  cursor: "pointer",
  textDecoration: "underline",
  textUnderlineOffset: 3,
  fontFamily: "inherit",
};
