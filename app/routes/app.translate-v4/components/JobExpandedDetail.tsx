import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { TranslationJobProgressSummary } from "~/server/translateV4/progress.server";
import type { StageName } from "~/server/translateV4/types";
import { MODULE_LABELS, QUOTA_TOKEN_MULTIPLIER } from "../constants";
import { v4Colors } from "../v4Styles";
import {
  initModuleProgress,
  isStageBarComplete,
  jobElapsedMs,
  jobQuotaCredits,
  stageBarPercent,
  stageOf,
} from "../jobStageUtils";
import {
  formatV4Elapsed,
  formatV4JobStartTime,
  getV4ModuleLabel,
} from "../v4I18n";
import type { V4_STAGE_KEYS } from "../v4I18n";

type StageMetrics = TranslationJobProgressSummary["metrics"];

const STAGE_DEF_KEYS: { key: StageName; labelKey: (typeof V4_STAGE_KEYS)[number] }[] = [
  { key: "INIT", labelKey: "v4.stage.init" },
  { key: "TRANSLATE", labelKey: "v4.stage.translate" },
  { key: "WRITEBACK", labelKey: "v4.stage.writeback" },
];

// 进度色与品牌统一：进行中用主题紫 v4Colors.primary，完成用绿色。
const INIT_SCAN_CSS = `
@keyframes v4-indet { 0% { left: -42%; } 100% { left: 100%; } }
@keyframes v4-dots { 0% { content: ""; } 25% { content: "."; } 50% { content: ".."; } 75%,100% { content: "..."; } }
.v4-indet-track { position: relative; height: 6px; border-radius: 3px; background: var(--p-color-bg-surface-secondary); overflow: hidden; }
.v4-indet-fill { position: absolute; top: 0; height: 100%; width: 42%; border-radius: 3px;
  background: linear-gradient(90deg, transparent, var(--p-color-bg-fill-brand), transparent);
  animation: v4-indet 1.1s ease-in-out infinite; }
.v4-dots::after { content: ""; animation: v4-dots 1.2s steps(1) infinite; }
`;

function taskResourceTotal(m: StageMetrics): number {
  return m.translateTotal || m.initTotal || 0;
}

function moduleLabel(moduleKey: string, t: TFunction): string {
  return (
    getV4ModuleLabel(moduleKey, t) ||
    MODULE_LABELS[moduleKey] ||
    moduleKey
  );
}

function stageDetail(
  idx: number,
  m: StageMetrics,
  jobModules?: string[],
  jobStatus?: TranslationJobProgressSummary["status"],
): string {
  if (idx === 0) {
    const { done, total } = initModuleProgress(m, jobModules, jobStatus);
    if (total > 0 && (m.initModulesTotal > 0 || (jobModules?.length ?? 0) > 0)) {
      return `${done}/${total}`;
    }
    return m.initTotal > 0 ? `${m.initDone}/${m.initTotal}` : "";
  }
  if (idx === 1) {
    const total = m.translateTotal || taskResourceTotal(m);
    return total > 0 ? `${m.translateDone}/${total}` : "";
  }
  const total = taskResourceTotal(m);
  const writebackTotal = total || m.writebackTotal;
  return writebackTotal > 0 ? `${m.writebackDone}/${writebackTotal}` : "";
}

function stageElapsedMs(
  t?: { startedAt: string; endedAt?: string | null },
  freezeAt?: string | null,
  nowMs?: number | null,
): number | null {
  if (!t?.startedAt) return null;
  const end = t.endedAt
    ? new Date(t.endedAt).getTime()
    : freezeAt
      ? new Date(freezeAt).getTime()
      : nowMs ?? null;
  if (end == null) return null;
  const ms = end - new Date(t.startedAt).getTime();
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

function useHydratedNow(enabled: boolean) {
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setNowMs(null);
      return;
    }
    setNowMs(Date.now());
  }, [enabled]);

  return nowMs;
}

function formatCreditsCount(count: number, locale?: string): string {
  return count.toLocaleString(locale);
}

export function JobSummaryStats({ job }: { job: TranslationJobProgressSummary }) {
  const { t, i18n } = useTranslation();
  const m = job.metrics;
  const translatedResources = m.translateDone;
  const resourceTotal = m.translateTotal || taskResourceTotal(m);
  const nowMs = useHydratedNow(
    !job.isTerminal && job.status !== "PAUSED" && job.status !== "CANCELLED",
  );
  const elapsed =
    job.isTerminal || job.status === "PAUSED" || job.status === "CANCELLED"
      ? jobElapsedMs(job)
      : nowMs != null
        ? jobElapsedMs(job, nowMs)
        : null;
  const startTime = formatV4JobStartTime(job.createdAt, i18n.language);
  const summaryItems = [
    {
      key: "progress",
      label: t("v4.job.translatedResources"),
      value:
        resourceTotal > 0
          ? `${translatedResources.toLocaleString()} / ${resourceTotal.toLocaleString()}`
          : translatedResources.toLocaleString(),
    },
    startTime
      ? {
          key: "startTime",
          label: t("v4.job.startTime"),
          value: startTime,
        }
      : null,
    elapsed != null
      ? {
          key: "elapsed",
          label: t("v4.job.elapsed"),
          value: formatV4Elapsed(elapsed, t),
        }
      : null,
  ].filter((item): item is { key: string; label: string; value: string } => item !== null);

  return (
    <div
      style={{
        marginBottom: 14,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: 10,
      }}
    >
      {summaryItems.map((item) => (
        <div
          key={item.key}
          style={{
            borderRadius: 10,
            border: `1px solid ${v4Colors.cardBorder}`,
            background: v4Colors.cardBg,
            padding: "10px 12px",
          }}
        >
          <div
            style={{
              fontSize: 11,
              lineHeight: 1.4,
              color: v4Colors.textMuted,
              marginBottom: 4,
            }}
          >
            {item.label}
          </div>
          <div
            style={{
              fontSize: 14,
              lineHeight: 1.5,
              color: v4Colors.text,
              fontWeight: 600,
              overflowWrap: "anywhere",
            }}
          >
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

/** 收起态：启动时间、耗时、积分一行摘要。 */
export function JobCollapsedMeta({ job }: { job: TranslationJobProgressSummary }) {
  const { t, i18n } = useTranslation();
  const nowMs = useHydratedNow(
    !job.isTerminal && job.status !== "PAUSED" && job.status !== "CANCELLED",
  );
  const elapsed =
    job.isTerminal || job.status === "PAUSED" || job.status === "CANCELLED"
      ? jobElapsedMs(job)
      : nowMs != null
        ? jobElapsedMs(job, nowMs)
        : null;
  const credits = jobQuotaCredits(job.usedTokens, QUOTA_TOKEN_MULTIPLIER);
  const startTime = formatV4JobStartTime(job.createdAt, i18n.language);

  const items: string[] = [];
  if (startTime) items.push(t("v4.job.startedAt", { time: startTime }));
  if (elapsed != null) items.push(t("v4.job.elapsedShort", { time: formatV4Elapsed(elapsed, t) }));
  if (job.usedTokens > 0) {
    items.push(
      t("v4.job.creditsShort", {
        formattedCount: formatCreditsCount(credits, i18n.language),
      }),
    );
  } else if (!job.isTerminal) {
    items.push(t("v4.job.creditsCounting"));
  }

  if (items.length === 0) return null;

  return (
    <div
      style={{
        marginTop: 10,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
        color: v4Colors.textMuted,
        lineHeight: 1.4,
      }}
    >
      {items.map((text, i) => (
        <span key={text} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {i > 0 ? (
            <span style={{ color: v4Colors.textFaint, userSelect: "none" }}>·</span>
          ) : null}
          <span>{text}</span>
        </span>
      ))}
    </div>
  );
}

export function JobStageProgressList({ job }: { job: TranslationJobProgressSummary }) {
  const { t } = useTranslation();
  const m = job.metrics;
  const timings = job.stageTimings ?? {};
  const activeStage = stageOf(job.status, job.errorStage, m);
  const isPaused = job.status === "PAUSED";
  const nowMs = useHydratedNow(
    !job.isTerminal && job.status !== "PAUSED" && job.status !== "CANCELLED",
  );
  const freezeAt =
    job.status === "PAUSED" || job.status === "CANCELLED" || job.isTerminal
      ? job.updatedAt
      : null;

  return (
    <div>
      <style>{INIT_SCAN_CSS}</style>
      {STAGE_DEF_KEYS.map(({ labelKey, key }, idx) => {
        const complete = isStageBarComplete(idx, m, job.status, job.modules);
        const percent = stageBarPercent(idx, m, job.status, job.modules);
        const current =
          idx === activeStage && !job.isTerminal && !isPaused && !job.isStopping;
        const pausedHere = isPaused && idx === activeStage;
        const stoppingHere = job.isStopping && idx === activeStage;
        const stageFreezeAt =
          (job.status === "PAUSED" || job.status === "CANCELLED") && idx === activeStage
            ? freezeAt
            : undefined;
        const ms = stageElapsedMs(timings[key], stageFreezeAt, nowMs);
        const showInitActivity =
          idx === 0 &&
          current &&
          (job.status === "INIT_QUEUED" || job.status === "INITIALIZING");
        // Old workers with no module telemetry and no selected-module list.
        const legacyInitScanning =
          showInitActivity &&
          job.modules.length === 0 &&
          m.initModulesTotal <= 0 &&
          m.initActiveModules.length === 0 &&
          m.initCompletedModules.length === 0 &&
          m.initTotal <= 0;
        const translateWarmingUp =
          idx === 1 &&
          current &&
          job.status === "TRANSLATING" &&
          m.translateUnitTotal > 0 &&
          m.translateUnitDone <= 0;
        const inProgress = percent > 0 && !complete;

        return (
          <div key={key} style={{ marginBottom: 6 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span
                style={{
                  width: 56,
                  fontSize: 12,
                  flexShrink: 0,
                  lineHeight: 1.45,
                  color: complete
                    ? v4Colors.success
                    : pausedHere || stoppingHere
                      ? v4Colors.warning
                      : current
                        ? v4Colors.text
                        : v4Colors.textFaint,
                }}
              >
                {t(labelKey)}
              </span>
              {legacyInitScanning ? (
                <InitScanIndicator
                  initDone={m.initDone}
                  moduleLabel={
                    m.currentModule ? moduleLabel(m.currentModule, t) : null
                  }
                />
              ) : translateWarmingUp ? (
                <TranslateWorkingIndicator
                  moduleLabel={
                    m.currentModule ? moduleLabel(m.currentModule, t) : null
                  }
                />
              ) : (
                <>
                  <div
                    style={{
                      flex: 1,
                      height: 6,
                      borderRadius: 3,
                      background: v4Colors.progressTrack,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${percent}%`,
                        height: "100%",
                        borderRadius: 3,
                        background:
                          job.status === "FAILED" && (current || pausedHere)
                            ? v4Colors.danger
                            : complete
                              ? v4Colors.success
                              : inProgress || (showInitActivity && percent >= 0)
                                ? v4Colors.primary
                                : v4Colors.progressTrack,
                        transition: "width 0.2s",
                        opacity:
                          showInitActivity && percent === 0 && !complete
                            ? 0.45
                            : 1,
                      }}
                    />
                  </div>
                  <span
                    style={{
                      fontSize: 12,
                      color: v4Colors.textMuted,
                      minWidth: 72,
                      textAlign: "right",
                      flexShrink: 0,
                      lineHeight: 1.45,
                      overflowWrap: "anywhere",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {[
                      stageDetail(idx, m, job.modules, job.status),
                      complete ? "✓" : null,
                      ms != null
                        ? t("v4.job.elapsedShort", { time: formatV4Elapsed(ms, t) })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </>
              )}
            </div>
            {showInitActivity && !legacyInitScanning ? (
              <InitActivityLog job={job} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function InitScanIndicator({
  initDone,
  moduleLabel,
}: {
  initDone: number;
  moduleLabel: string | null;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="v4-indet-track" style={{ flex: 1 }}>
        <div className="v4-indet-fill" />
      </div>
      <span
        style={{
          fontSize: 12,
          color: v4Colors.textMuted,
          minWidth: 132,
          textAlign: "right",
          flexShrink: 0,
          lineHeight: 1.45,
          overflowWrap: "anywhere",
        }}
      >
        {t("v4.job.itemsFound", { count: initDone })}
        {moduleLabel ? ` · ${moduleLabel}` : ""}
        <span className="v4-dots" />
      </span>
    </>
  );
}

function InitActivityLog({ job }: { job: TranslationJobProgressSummary }) {
  const { t } = useTranslation();
  const m = job.metrics;
  const activeModules = (m.initActiveModules ?? []).map((item) => item.module);
  const completedModules = (m.initCompletedModules ?? []).map((item) => item.module);
  const activeSet = new Set(activeModules);
  const completedSet = new Set(completedModules);
  const waitingModules = job.modules.filter(
    (mod) => !activeSet.has(mod) && !completedSet.has(mod),
  );
  const uniqueModules = [...activeModules, ...waitingModules, ...completedModules].filter(
    (mod, index, list) => list.indexOf(mod) === index,
  );
  const visibleModules = uniqueModules.slice(0, 2).map((mod) => moduleLabel(mod, t));
  const extraModulesCount = uniqueModules.length - visibleModules.length;
  const modulesText =
    visibleModules.length > 0
      ? extraModulesCount > 0
        ? `${visibleModules.join(" · ")} +${extraModulesCount}`
        : visibleModules.join(" · ")
      : null;
  const primaryText = modulesText
    ? t("v4.job.preparingModules", { modules: modulesText })
    : t("v4.job.preparingStore");
  const secondaryText =
    m.initDone > 0
      ? t("v4.job.itemsFound", { count: m.initDone })
      : t("v4.job.preparingHint");

  return (
    <div
      style={{
        marginLeft: 66,
        marginTop: 8,
        borderLeft: `1px solid ${v4Colors.divider}`,
        paddingLeft: 12,
      }}
    >
      <div
        style={{
          background: v4Colors.cardBg,
          borderRadius: 10,
          border: `1px solid ${v4Colors.cardBorder}`,
          padding: "10px 12px",
        }}
      >
        <div
          style={{
            fontSize: 12,
            color: v4Colors.text,
            lineHeight: 1.5,
            marginBottom: 4,
          }}
        >
          {primaryText}
          <span className="v4-dots" />
        </div>
        <div
          style={{
            fontSize: 11,
            color: v4Colors.textMuted,
            lineHeight: 1.45,
            overflowWrap: "anywhere",
          }}
        >
          {secondaryText}
        </div>
      </div>
    </div>
  );
}

function TranslateWorkingIndicator({
  moduleLabel,
}: {
  moduleLabel: string | null;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="v4-indet-track" style={{ flex: 1 }}>
        <div className="v4-indet-fill" />
      </div>
      <span
        style={{
          fontSize: 12,
          color: v4Colors.textMuted,
          minWidth: 132,
          textAlign: "right",
          flexShrink: 0,
          lineHeight: 1.45,
          overflowWrap: "anywhere",
        }}
      >
        {moduleLabel
          ? t("v4.job.translatingModule", { module: moduleLabel })
          : t("v4.job.translatingNow")}
        <span className="v4-dots" />
      </span>
    </>
  );
}
