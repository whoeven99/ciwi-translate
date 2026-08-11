import { useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { Button } from "@shopify/polaris";
import { useFetcher, useNavigate } from "@remix-run/react";
import { useTranslation } from "react-i18next";
import { v4Colors } from "../v4Styles";
import {
  AI_MODEL_OPTIONS,
  CREATE_TASK_MODULE_LABELS,
} from "../constants";
import { localeRegionCode, localeShortName } from "../localeDisplay";
import { getV4AiModelLabel, getV4ModuleLabel } from "../v4I18n";
import type { CreateTaskEstimateView } from "../useCreateTaskEstimate";
import { useDetailedCreateTaskEstimate } from "../useDetailedCreateTaskEstimate";
import type { ShopLocaleOption } from "~/lib/createTranslateV4Tasks";
import { buildBillingReturnPath } from "~/utils/billingReturn";

type CreateTaskConfirmScenario =
  | "ready"
  | "insufficient_paid"
  | "insufficient_trial"
  | "insufficient_pricing";

type Props = {
  open: boolean;
  creating: boolean;
  targetOptions: ShopLocaleOption[];
  targets: string[];
  modules: string[];
  aiModel: string;
  isCover: boolean;
  isHandle: boolean;
  includeLiquid: boolean;
  /** 源语言（TM key）；缺省由服务端 primary 兜底 */
  sourceLocale?: string;
  estimate: CreateTaskEstimateView | null;
  scenario: CreateTaskConfirmScenario;
  previousTotalChars?: number;
  onClose: () => void;
  onConfirmCreate: () => void;
  onBuyCredits: (estimatedCredits?: number | null) => void;
  /** Persist create-task selections before Shopify billing redirect. */
  onBeforeBilling?: () => void;
};

type TranslateFn = (
  key: string,
  options?: Record<string, unknown>,
) => string;

export function CreateTaskConfirmModal({
  open,
  creating,
  targetOptions,
  targets,
  modules,
  aiModel,
  isCover,
  isHandle,
  includeLiquid,
  sourceLocale,
  estimate,
  scenario: parentScenario,
  previousTotalChars,
  onClose,
  onConfirmCreate,
  onBuyCredits,
  onBeforeBilling,
}: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const planFetcher = useFetcher<{
    success?: boolean;
    response?: { confirmationUrl?: string };
  }>();
  const detailed = useDetailedCreateTaskEstimate();

  const detailedRunning = detailed.progress.status === "running";
  const { reset: resetDetailed } = detailed;

  useEffect(() => {
    if (!open) {
      resetDetailed();
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !creating && !detailedRunning) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, creating, onClose, resetDetailed, detailedRunning]);

  useEffect(() => {
    if (!open) return;
    resetDetailed();
  }, [
    open,
    targets,
    modules,
    isCover,
    isHandle,
    includeLiquid,
    aiModel,
    sourceLocale,
    resetDetailed,
  ]);

  useEffect(() => {
    if (!planFetcher.data?.success) return;
    const confirmationUrl = planFetcher.data.response?.confirmationUrl;
    if (confirmationUrl) {
      window.open(confirmationUrl, "_top");
    }
  }, [planFetcher.data]);

  const selectedTargets = useMemo(
    () =>
      [...targetOptions]
        .filter((option) => targets.includes(option.value))
        .map((option) => ({
          value: option.value,
          label: localeShortName(option.value, option.label),
          regionCode: localeRegionCode(option.value),
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [targetOptions, targets],
  );

  const selectedModules = useMemo(
    () =>
      modules.map((mod) => ({
        value: mod,
        label:
          getV4ModuleLabel(mod, t) || CREATE_TASK_MODULE_LABELS[mod] || mod,
      })),
    [modules, t],
  );

  const aiModelLabel = AI_MODEL_OPTIONS.some((option) => option.value === aiModel)
    ? getV4AiModelLabel(aiModel, t)
    : aiModel;

  const detailedDone = detailed.progress.status === "done";
  const estimatedCredits = detailedDone
    ? detailed.progress.estimatedCredits
    : (estimate?.estimatedCredits ?? null);
  const remainingCredits = detailedDone
    ? (detailed.progress.remainingCredits ?? estimate?.remainingCredits ?? null)
    : (estimate?.remainingCredits ?? null);
  const shortfallCredits =
    estimatedCredits != null && remainingCredits != null
      ? Math.max(estimatedCredits - remainingCredits, 0)
      : 0;
  const needsMoreCredits =
    estimatedCredits != null &&
    remainingCredits != null &&
    estimatedCredits > remainingCredits;
  const scenario: CreateTaskConfirmScenario = detailedDone
    ? needsMoreCredits
      ? parentScenario === "ready"
        ? "insufficient_paid"
        : parentScenario
      : "ready"
    : parentScenario;
  const progressPercent =
    estimatedCredits != null && estimatedCredits > 0 && remainingCredits != null
      ? Math.max(0, Math.min(100, (remainingCredits / estimatedCredits) * 100))
      : scenario === "ready"
        ? 100
        : 0;
  const coveragePercent = Math.round(progressPercent);

  const detailItems = [
    {
      label: t("v4.createTask.targetLanguages"),
      value: summarizeCompactLine(
        selectedTargets.map((item) => `${item.regionCode} ${item.label}`),
        t,
      ),
    },
    {
      label: t("v4.createTask.content"),
      value: summarizeCompactLine(
        selectedModules.map((item) => item.label),
        t,
      ),
    },
    {
      label: t("v4.createTask.aiModel"),
      value: aiModelLabel,
    },
    {
      label: t("v4.createTask.overwriteExisting"),
      value: isCover ? t("Yes") : t("No"),
    },
    {
      label: t("v4.createTask.translateHandle"),
      value: isHandle ? t("Yes") : t("No"),
    },
    {
      label: t("v4.createTask.includeLiquid"),
      value: includeLiquid ? t("Yes") : t("No"),
    },
  ];

  const estimatedCreditsLabel =
    estimatedCredits != null ? formatCreditsFull(estimatedCredits) : "--";
  const remainingCreditsLabel =
    remainingCredits != null ? formatCreditsFull(remainingCredits) : "--";
  const shortfallCreditsLabel =
    shortfallCredits > 0 ? formatCreditsFull(shortfallCredits) : "0";
  const coverageLabel = `${coveragePercent}%`;
  const estimateSummaryItems = [
    {
      label: t("v4.createTask.confirmCreditsRequired"),
      value: detailedRunning
        ? t("v4.createTask.detailedEstimateRunning", {
            current: detailed.progress.doneCount,
            total: detailed.progress.totalCount,
            label: detailed.progress.currentLabel,
          })
        : estimate?.loading && !detailedDone
          ? t("v4.createTask.estimateLoading")
          : estimatedCreditsLabel,
    },
    {
      label: t("v4.createTask.confirmCreditsAvailable"),
      value: estimate?.loading && !detailedDone && !detailedRunning
        ? t("v4.createTask.estimateLoading")
        : remainingCreditsLabel,
    },
  ];

  const isReady = scenario === "ready";
  const isInsufficientPaid = scenario === "insufficient_paid";
  const isTrialOffer = scenario === "insufficient_trial";
  const canStartPartial = isInsufficientPaid && (remainingCredits ?? 0) > 0;
  const scenarioMeta = getScenarioMeta(t, scenario, canStartPartial);

  const primaryActionLabel = isReady
    ? t("v4.createTask.confirmStartNow")
    : isInsufficientPaid
      ? t("v4.createTask.confirmBuyCreditsAndStart")
      : isTrialOffer
        ? t("v4.createTask.confirmTrialAndStart")
        : t("v4.createTask.confirmSubscribeAndStart");
  const secondaryActionLabel = isReady
    ? null
    : isInsufficientPaid
      ? canStartPartial
        ? t("v4.createTask.confirmStartPartial")
        : null
      : isTrialOffer
        ? t("v4.createTask.confirmBuyCreditsSecondary")
        : t("v4.createTask.confirmBuyCreditsOnly");

  const buildReturnPathForPlan = () => {
    if (typeof window === "undefined") return undefined;
    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    return buildBillingReturnPath(currentPath, {
      kind: "plan",
      previousTotalChars,
    });
  };

  const handleTrialAction = () => {
    onBeforeBilling?.();
    const payload: Record<string, string> = {
      payForPlan: JSON.stringify({
        title: "Basic",
        monthlyPrice: 7.99,
        yearlyPrice: 6.39,
        yearly: false,
        trialDays: 5,
      }),
    };
    const returnPath = buildReturnPathForPlan();
    if (returnPath) {
      payload.returnPath = returnPath;
    }
    planFetcher.submit(payload, { method: "POST", action: "/app/pricing" });
  };

  const handlePrimaryAction = () => {
    if (isReady) {
      onConfirmCreate();
      return;
    }
    if (isInsufficientPaid) {
      onBeforeBilling?.();
      onBuyCredits(estimatedCredits);
      return;
    }
    if (isTrialOffer) {
      handleTrialAction();
      return;
    }

    onBeforeBilling?.();
    const returnPath = buildReturnPathForPlan();
    onClose();
    navigate(
      returnPath ? `/app/pricing?returnPath=${encodeURIComponent(returnPath)}` : "/app/pricing",
    );
  };

  const handleSecondaryAction = () => {
    if (isInsufficientPaid) {
      if (!canStartPartial) return;
      onConfirmCreate();
      return;
    }
    onBeforeBilling?.();
    onBuyCredits(estimatedCredits);
  };

  const handleDetailedEstimate = () => {
    if (detailedRunning || creating) return;
    void detailed.run({
      modules,
      targets,
      isCover,
      isHandle,
      includeLiquid,
      aiModel,
      source: sourceLocale,
    });
  };

  if (!open) return null;

  return (
    <div
      aria-modal="true"
      role="dialog"
      style={overlayStyle}
      onClick={() => {
        if (!creating && !detailedRunning) onClose();
      }}
    >
      <div style={panelStyle} onClick={(event) => event.stopPropagation()}>
        <div style={headerStyle}>
          <div style={headerCopyStyle}>
            <div style={titleStyle}>{scenarioMeta.title}</div>
            {shortfallCredits > 0 ? (
              <div
                style={{
                  ...headlineStyle,
                  color: scenarioMeta.accent,
                  background: scenarioMeta.headlineBg,
                }}
              >
                {t("v4.createTask.confirmShortfallHeadline", {
                  credits: shortfallCreditsLabel,
                })}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            aria-label={t("Close")}
            onClick={onClose}
            disabled={creating || detailedRunning}
            style={closeButtonStyle}
          >
            ×
          </button>
        </div>

        <div style={bodyStyle}>
          <section style={estimateSectionStyle}>
            <div style={estimateSectionTitleStyle}>
              {t("v4.createTask.confirmEstimatePanelTitle")}
            </div>
            <div style={summaryStatsRowStyle}>
              {estimateSummaryItems.map((item) => (
                <div key={item.label} style={summaryStatStyle}>
                  <div style={summaryStatLabelStyle}>{item.label}</div>
                  <div style={summaryStatValueStyle}>{item.value}</div>
                </div>
              ))}
            </div>
            <div style={progressSectionStyle}>
              <div style={progressHeaderStyle}>
                <span style={progressLabelStyle}>
                  {t("v4.createTask.confirmCoverageLabel")}
                </span>
                <span
                  style={{
                    ...progressValueStyle,
                    color: scenarioMeta.accent,
                  }}
                >
                  {coverageLabel}
                </span>
              </div>
              <div style={progressTrackStyle}>
                <div
                  style={{
                    ...progressFillStyle,
                    width: `${progressPercent}%`,
                    background: scenarioMeta.progressBar,
                  }}
                />
              </div>
              <div style={estimateHintStyle}>
                {detailedDone
                  ? t("v4.createTask.detailedEstimateDoneHint")
                  : detailed.progress.status === "error"
                    ? t("v4.createTask.detailedEstimateErrorHint")
                    : t("v4.createTask.confirmEstimateExactHint")}
              </div>
              <div style={detailedEstimateRowStyle}>
                <Button
                  size="slim"
                  onClick={handleDetailedEstimate}
                  loading={detailedRunning}
                  disabled={creating || detailedRunning || targets.length === 0}
                >
                  {detailedDone
                    ? t("v4.createTask.detailedEstimateRerun")
                    : t("v4.createTask.detailedEstimateAction")}
                </Button>
                {detailedRunning ? (
                  <span style={detailedEstimateProgressStyle}>
                    {t("v4.createTask.detailedEstimateProgress", {
                      current: detailed.progress.doneCount,
                      total: detailed.progress.totalCount,
                      label: detailed.progress.currentLabel,
                    })}
                  </span>
                ) : null}
              </div>
            </div>
          </section>

          <InfoCard title={t("v4.createTask.confirmTaskDetailTitle")}>
            <div style={detailListStyle}>
              {detailItems.map((item) => (
                <DetailLine
                  key={item.label}
                  label={item.label}
                  value={item.value}
                />
              ))}
            </div>
          </InfoCard>

          {!isReady && scenario !== "insufficient_paid" ? (
            <InfoCard title={offerTitle(t, scenario)} highlighted>
              <div style={offerFeatureGridStyle}>
                {offerFeatures(t, scenario).map((feature) => (
                  <div key={feature} style={offerFeatureItemStyle}>
                    {feature}
                  </div>
                ))}
              </div>
            </InfoCard>
          ) : null}
        </div>

        <div style={footerStyle}>
          <div style={primaryButtonStyle}>
            <Button
              fullWidth
              size="large"
              variant="primary"
              onClick={handlePrimaryAction}
              loading={creating || planFetcher.state === "submitting"}
            >
              {primaryActionLabel}
            </Button>
          </div>
          {secondaryActionLabel ? (
            <div style={secondaryButtonStyle}>
              <Button
                fullWidth
                size="large"
                variant="secondary"
                onClick={handleSecondaryAction}
                disabled={creating}
              >
                {secondaryActionLabel}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function InfoCard({
  title,
  highlighted = false,
  children,
}: {
  title: string;
  highlighted?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        ...cardStyle,
        borderColor: highlighted
          ? "rgba(33, 128, 255, 0.22)"
          : v4Colors.cardBorder,
        boxShadow: highlighted ? "0 8px 30px rgba(33, 128, 255, 0.08)" : "none",
      }}
    >
      <div style={cardTitleStyle}>{title}</div>
      {children}
    </div>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div style={detailLineStyle}>
      <span style={detailLabelStyle}>{label}</span>
      <span style={detailValueStyle}>{value}</span>
    </div>
  );
}

function getScenarioMeta(
  t: TranslateFn,
  scenario: CreateTaskConfirmScenario,
  canStartPartial: boolean,
) {
  if (scenario === "ready") {
    return {
      title: t("v4.createTask.confirmReadyTitle"),
      accent: "#0a934c",
      headlineBg: "rgba(10, 147, 76, 0.1)",
      progressBar: "linear-gradient(90deg, #0a934c 0%, #2180ff 100%)",
    };
  }

  if (scenario === "insufficient_paid") {
    return {
      title: canStartPartial
        ? t("v4.createTask.confirmPartialTitle")
        : t("v4.createTask.confirmNoCreditsTitle"),
      accent: "#df5a00",
      headlineBg: "rgba(223, 90, 0, 0.1)",
      progressBar: "linear-gradient(90deg, #ffb84d 0%, #df5a00 100%)",
    };
  }

  if (scenario === "insufficient_trial") {
    return {
      title: t("v4.createTask.confirmTrialTitle"),
      accent: "#2180ff",
      headlineBg: "rgba(33, 128, 255, 0.1)",
      progressBar: "linear-gradient(90deg, #8dc5ff 0%, #2180ff 100%)",
    };
  }

  return {
    title: t("v4.createTask.confirmPricingTitle"),
    accent: "#7a3cff",
    headlineBg: "rgba(122, 60, 255, 0.1)",
    progressBar: "linear-gradient(90deg, #c6a4ff 0%, #7a3cff 100%)",
  };
}

function offerTitle(t: TranslateFn, scenario: CreateTaskConfirmScenario): string {
  if (scenario === "insufficient_paid") {
    return t("v4.createTask.confirmPaidOfferTitle");
  }
  return scenario === "insufficient_trial"
    ? t("v4.createTask.confirmTrialOfferTitle")
    : t("v4.createTask.confirmPricingOfferTitle");
}

function offerFeatures(
  t: TranslateFn,
  scenario: CreateTaskConfirmScenario,
): string[] {
  return scenario === "insufficient_trial"
    ? [
        t("v4.createTask.confirmTrialFeatureCredits"),
        t("v4.createTask.confirmTrialFeatureModel"),
        t("v4.createTask.confirmTrialFeatureSpeed"),
      ]
    : [
        t("v4.createTask.confirmPricingFeatureCredits"),
        t("v4.createTask.confirmPricingFeatureModel"),
        t("v4.createTask.confirmPricingFeatureSpeed"),
      ];
}

function formatCreditsFull(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

function summarizeCompactLine(items: string[], t: TranslateFn): string {
  if (items.length === 0) {
    return t("v4.createTask.confirmCompactListEmpty");
  }

  const visibleItems = items.slice(0, 3).join(", ");
  const hiddenCount = Math.max(items.length - 3, 0);

  if (hiddenCount > 0) {
    return t("v4.createTask.confirmCompactListMore", {
      count: items.length,
      items: visibleItems,
      more: hiddenCount,
    });
  }

  return t("v4.createTask.confirmCompactList", {
    count: items.length,
    items: visibleItems,
  });
}

const overlayStyle = {
  position: "fixed",
  inset: 0,
  zIndex: 2147483100,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 28,
  background: "rgba(15, 23, 42, 0.36)",
  backdropFilter: "blur(8px)",
} as const;

const panelStyle = {
  width: "min(520px, calc(100vw - 32px))",
  maxHeight: "min(820px, calc(100vh - 32px))",
  overflow: "hidden",
  borderRadius: 28,
  border: `1px solid ${v4Colors.cardBorder}`,
  background: v4Colors.cardBg,
  boxShadow: "0 24px 80px rgba(15, 23, 42, 0.18)",
  display: "flex",
  flexDirection: "column",
} as const;

const headerStyle = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 16,
  padding: "28px 28px 10px",
} as const;

const headerCopyStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  minWidth: 0,
} as const;

const bodyStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 16,
  padding: "0 28px",
  overflowY: "auto",
} as const;

const footerStyle = {
  display: "flex",
  justifyContent: "center",
  gap: 0,
  padding: "22px 28px 28px",
  background: v4Colors.cardBg,
  flexWrap: "wrap",
} as const;

const titleStyle = {
  margin: 0,
  fontSize: 28,
  fontWeight: 700,
  lineHeight: 1.15,
  color: v4Colors.text,
} as const;

const headlineStyle = {
  display: "inline-flex",
  alignItems: "center",
  width: "fit-content",
  margin: 10,
  padding: "8px 12px",
  borderRadius: 12,
  background: "rgba(223, 90, 0, 0.1)",
  color: "#df5a00",
  fontSize: 13,
  fontWeight: 700,
  lineHeight: "22px",
} as const;

const closeButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 36,
  height: 36,
  padding: 0,
  border: "none",
  borderRadius: 999,
  background: "rgba(15, 23, 42, 0.04)",
  color: v4Colors.textMuted,
  fontSize: 22,
  lineHeight: 1,
  cursor: "pointer",
  flexShrink: 0,
} as const;

const cardStyle = {
  borderRadius: 20,
  background: v4Colors.summaryBg,
  border: `1px solid ${v4Colors.cardBorder}`,
  padding: "20px 18px",
} as const;

const cardTitleStyle = {
  fontSize: 13,
  fontWeight: 700,
  lineHeight: "20px",
  color: v4Colors.text,
  marginBottom: 14,
} as const;

const detailListStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
} as const;

const detailLineStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(116px, 140px) minmax(0, 1fr)",
  gap: 12,
  alignItems: "start",
  fontSize: 14,
  lineHeight: "22px",
} as const;

const detailLabelStyle = {
  color: v4Colors.textMuted,
  fontWeight: 600,
} as const;

const detailValueStyle = {
  color: v4Colors.text,
  fontWeight: 600,
  wordBreak: "break-word",
} as const;

const estimateSectionStyle = {
  padding: "2px 0 4px",
} as const;

const estimateSectionTitleStyle = {
  fontSize: 13,
  fontWeight: 700,
  lineHeight: "20px",
  color: v4Colors.text,
  marginBottom: 14,
} as const;

const summaryStatsRowStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 20,
} as const;

const summaryStatStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
} as const;

const summaryStatLabelStyle = {
  color: v4Colors.textMuted,
  fontSize: 12,
  fontWeight: 700,
  lineHeight: "18px",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
} as const;

const summaryStatValueStyle = {
  color: v4Colors.text,
  fontSize: 30,
  fontWeight: 700,
  lineHeight: "34px",
  wordBreak: "break-word",
} as const;

const progressSectionStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  marginTop: 18,
} as const;

const progressHeaderStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
} as const;

const progressLabelStyle = {
  color: v4Colors.text,
  fontSize: 14,
  fontWeight: 600,
  lineHeight: "22px",
} as const;

const progressValueStyle = {
  fontSize: 16,
  fontWeight: 700,
  lineHeight: "24px",
} as const;

const progressTrackStyle = {
  width: "100%",
  height: 12,
  borderRadius: 999,
  overflow: "hidden",
  background: "rgba(15, 23, 42, 0.08)",
} as const;

const progressFillStyle = {
  height: "100%",
  borderRadius: 999,
} as const;

const estimateHintStyle = {
  color: v4Colors.textMuted,
  fontSize: 12,
  fontWeight: 500,
  lineHeight: "18px",
} as const;

const detailedEstimateRowStyle = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  marginTop: 10,
  flexWrap: "wrap",
} as const;

const detailedEstimateProgressStyle = {
  color: v4Colors.textMuted,
  fontSize: 12,
  fontWeight: 500,
  lineHeight: "18px",
} as const;

const offerFeatureGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
  gap: 12,
} as const;

const offerFeatureItemStyle = {
  minHeight: 88,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
  padding: "14px 12px",
  borderRadius: 16,
  border: `1px solid ${v4Colors.cardBorder}`,
  background: v4Colors.cardBg,
  color: v4Colors.text,
  fontSize: 15,
  fontWeight: 600,
  lineHeight: "24px",
  whiteSpace: "pre-line",
} as const;

const primaryButtonStyle = {
  minWidth: 184,
  minHeight: 48,
  paddingInline: 18,
} as const;

const secondaryButtonStyle = {
  minWidth: 184,
  minHeight: 48,
  paddingInline: 18,
} as const;
