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
import { reportClientLog } from "~/utils/clientLog";

type CreateTaskConfirmScenario =
  | "ready"
  | "insufficient_paid"
  | "insufficient_trial"
  | "insufficient_pricing";

type CreateTaskQuotaOfferMode = "paid" | "trial" | "pricing";

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
  quotaOfferMode: CreateTaskQuotaOfferMode;
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

type OfferFeatureItem = {
  title: string;
  note?: string;
  badge?: string;
};

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
  quotaOfferMode,
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
  const hasEstimateInputs =
    targets.length > 0 && (modules.length > 0 || includeLiquid);
  const coarseEstimatedCredits = estimate?.estimatedCredits ?? null;
  const coarseEstimatePending =
    !detailedDone && hasEstimateInputs && (!estimate?.loaded || !!estimate?.loading);
  const estimatedCredits = detailedDone
    ? detailed.progress.estimatedCredits
    : coarseEstimatedCredits;
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
      ? resolveScenarioFromOfferMode(quotaOfferMode)
      : "ready"
    : parentScenario;

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
  const estimateComputingLabel = t("v4.createTask.confirmEstimateComputing", {
    defaultValue: "Calculating...",
  });
  const requiredCreditsValue =
    detailedRunning || coarseEstimatePending
      ? estimateComputingLabel
      : estimatedCreditsLabel;
  const availableCreditsValue = coarseEstimatePending && !detailedRunning
    ? estimateComputingLabel
    : remainingCreditsLabel;

  const isReady = scenario === "ready";
  const isInsufficientPaid = scenario === "insufficient_paid";
  const isTrialOffer = scenario === "insufficient_trial";
  const showTaskDetails = isReady;
  const hasPositiveCredits = remainingCredits != null && remainingCredits > 0;
  const hasNonPositiveCredits = remainingCredits != null && remainingCredits <= 0;
  const canStartPartial = !isReady && !hasNonPositiveCredits && hasPositiveCredits;
  const scenarioMeta = getScenarioMeta(t, scenario, canStartPartial);
  const recommendedPlan =
    shortfallCredits > 0 ? recommendPlanForShortfall(shortfallCredits) : null;
  const subscriptionBenefitValue =
    recommendedPlan &&
    scenario === "insufficient_pricing"
      ? t("pricing.launchCredits", {
          credits: formatCreditsFull(recommendedPlan.launchCredits),
          defaultValue: "+{{credits}} Launch Credits (first subscribe only)",
        })
      : null;
  const subscriptionBenefitCaption =
    recommendedPlan &&
    scenario === "insufficient_pricing"
      ? t("v4.createTask.confirmRecommendedPlanMonthlyValue", {
          plan: recommendedPlan.title,
          monthly: formatCreditsFull(recommendedPlan.monthlyCredits),
          defaultValue: "{{plan}} · {{monthly}} credits/month",
        })
      : null;
  const offerDescriptionText = offerDescription(t, scenario);

  const primaryActionLabel = isReady
    ? t("v4.createTask.confirmStartNow")
    : canStartPartial
      ? t("v4.createTask.confirmStartPartial")
      : isInsufficientPaid
        ? t("v4.createTask.confirmBuyCreditsAndStart")
        : isTrialOffer
          ? t("v4.createTask.confirmTrialAndStart")
          : t("v4.createTask.confirmSubscribeAndStart");
  const secondaryActionLabel = isReady
    ? null
    : canStartPartial
      ? isTrialOffer
        ? t("v4.createTask.confirmTrialAndStart")
        : t("v4.createTask.confirmBuyCreditsOnly")
      : isInsufficientPaid || isTrialOffer
        ? t("v4.createTask.confirmViewPlans")
        : t("v4.createTask.confirmBuyCreditsOnly");
  const showTrialTextLink =
    isTrialOffer && !canStartPartial && secondaryActionLabel != null;

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

  const logConfirmStart = (action: "start_translation" | "start_partial") => {
    void reportClientLog({
      event: "translate_v4_confirm_start",
      action,
      kind: "action",
      level: "info",
      status: "start",
      context: {
        estimatedCredits: coarseEstimatedCredits,
        usedDetailedEstimate: detailedDone,
        detailedEstimateStatus: detailed.progress.status,
        detailedEstimatedCredits: detailedDone
          ? detailed.progress.estimatedCredits
          : null,
        remainingCredits,
        scenario,
        targets,
        modules,
        aiModel,
        isCover,
        isHandle,
        includeLiquid,
      },
    });
  };

  const handlePrimaryAction = () => {
    if (isReady) {
      logConfirmStart("start_translation");
      onConfirmCreate();
      return;
    }
    if (canStartPartial) {
      logConfirmStart("start_partial");
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
    if (canStartPartial) {
      if (isTrialOffer) {
        handleTrialAction();
        return;
      }
      onBeforeBilling?.();
      onBuyCredits(estimatedCredits);
      return;
    }
    if (isInsufficientPaid || isTrialOffer) {
      onBeforeBilling?.();
      const returnPath = buildReturnPathForPlan();
      onClose();
      navigate(
        returnPath
          ? `/app/pricing?returnPath=${encodeURIComponent(returnPath)}`
          : "/app/pricing",
      );
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
              <div style={summaryStatStyle}>
                <div style={summaryStatLabelStyle}>
                  {t("v4.createTask.confirmCreditsRequired")}
                </div>
                <div style={summaryStatValueStyle}>{requiredCreditsValue}</div>
                <div style={requiredActionRowStyle}>
                  <Button
                    size="slim"
                    variant="secondary"
                    onClick={handleDetailedEstimate}
                    loading={detailedRunning}
                    disabled={creating || detailedRunning || targets.length === 0}
                  >
                    {detailedDone
                      ? t("v4.createTask.detailedEstimateRerun")
                      : t("v4.createTask.detailedEstimateAction")}
                  </Button>
                </div>
              </div>
              <div style={summaryStatStyle}>
                <div style={summaryStatLabelStyle}>
                  {t("v4.createTask.confirmCreditsAvailable")}
                  </div>
                  <div style={summaryStatValueStyle}>{availableCreditsValue}</div>
              </div>
            </div>
            <div style={estimateHintStyle}>
              {detailedDone
                ? t("v4.createTask.detailedEstimateDoneHint")
                : detailed.progress.status === "error"
                  ? t("v4.createTask.detailedEstimateErrorHint")
                  : t("v4.createTask.confirmEstimateExactHint")}
            </div>
          </section>

          {showTaskDetails ? (
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
          ) : null}

          {!isReady && scenario !== "insufficient_paid" ? (
            <InfoCard title={offerTitle(t, scenario)} highlighted>
              {offerDescriptionText ? (
                <div style={offerDescriptionStyle}>{offerDescriptionText}</div>
              ) : null}
              {subscriptionBenefitValue ? (
                <div style={subscriptionBenefitStyle}>
                  <div style={subscriptionBenefitLabelStyle}>
                    {t("pricing.launchCreditsRow", {
                      defaultValue: "Launch Credits (first subscribe)",
                    })}
                  </div>
                  <div style={subscriptionBenefitValueStyle}>
                    {subscriptionBenefitValue}
                  </div>
                  {subscriptionBenefitCaption ? (
                    <div style={subscriptionBenefitCaptionStyle}>
                      {t("v4.createTask.confirmRecommendedPlan")}:
                      {" "}
                      {subscriptionBenefitCaption}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div style={offerFeatureGridStyle}>
                {offerFeatures(t, scenario).map((feature) => (
                  <div key={`${feature.title}-${feature.note ?? ""}`} style={offerFeatureItemStyle}>
                    {feature.badge ? (
                      <div style={offerFeatureBadgeStyle}>{feature.badge}</div>
                    ) : null}
                    <div style={offerFeatureTitleStyle}>{feature.title}</div>
                    {feature.note ? (
                      <div style={offerFeatureNoteStyle}>{feature.note}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            </InfoCard>
          ) : null}
        </div>

        <div
          style={{
            ...footerStyle,
            flexDirection: showTrialTextLink ? "column" : "row",
            alignItems: "center",
          }}
        >
          <div
            style={{
              ...primaryButtonStyle,
              width: showTrialTextLink ? 240 : undefined,
            }}
          >
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
          {showTrialTextLink ? (
            <button
              type="button"
              onClick={handleSecondaryAction}
              disabled={creating}
              style={footerTextLinkStyle}
            >
              {secondaryActionLabel}
            </button>
          ) : secondaryActionLabel ? (
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
  if (canStartPartial) {
    if (scenario === "insufficient_trial") {
      return {
        title: t("v4.createTask.confirmPartialTitle"),
      };
    }

    if (scenario === "insufficient_pricing") {
      return {
        title: t("v4.createTask.confirmPartialTitle"),
      };
    }
  }

  if (scenario === "ready") {
    return {
      title: t("v4.createTask.confirmReadyTitle"),
    };
  }

  if (scenario === "insufficient_paid") {
    return {
      title: canStartPartial
        ? t("v4.createTask.confirmPartialTitle")
        : t("v4.createTask.confirmNoCreditsTitle"),
    };
  }

  if (scenario === "insufficient_trial") {
    return {
      title: t("v4.createTask.confirmTrialTitle"),
    };
  }

  return {
    title: t("v4.createTask.confirmPricingTitle"),
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

function offerDescription(
  t: TranslateFn,
  scenario: CreateTaskConfirmScenario,
): string | null {
  if (scenario === "insufficient_paid") {
    return t("v4.createTask.confirmPaidOfferDesc");
  }
  if (scenario === "insufficient_trial") {
    return null;
  }
  return t("v4.createTask.confirmPricingOfferDesc");
}

function offerFeatures(
  t: TranslateFn,
  scenario: CreateTaskConfirmScenario,
): OfferFeatureItem[] {
  return scenario === "insufficient_trial"
    ? [
        {
          title: t("v4.createTask.confirmTrialFeatureModel"),
          note: t("v4.createTask.confirmTrialFeatureModelValue"),
        },
        {
          title: t("v4.createTask.confirmTrialFeatureSpeed"),
          note: t("v4.createTask.confirmTrialFeatureSpeedValue"),
          badge: t("v4.createTask.confirmTrialFeatureSpeedBadge"),
        },
      ]
    : [
        { title: t("v4.createTask.confirmPricingFeatureCredits") },
        { title: t("v4.createTask.confirmPricingFeatureModel") },
        { title: t("v4.createTask.confirmPricingFeatureSpeed") },
      ];
}

function resolveScenarioFromOfferMode(
  offerMode: CreateTaskQuotaOfferMode,
): CreateTaskConfirmScenario {
  if (offerMode === "paid") return "insufficient_paid";
  return offerMode === "trial" ? "insufficient_trial" : "insufficient_pricing";
}

const PLAN_RECOMMENDATIONS = [
  { title: "Basic", monthlyCredits: 1500000, launchCredits: 4000000 },
  { title: "Pro", monthlyCredits: 3000000, launchCredits: 8000000 },
  { title: "Premium", monthlyCredits: 8000000, launchCredits: 16000000 },
] as const;

function recommendPlanForShortfall(shortfallCredits: number) {
  return (
    PLAN_RECOMMENDATIONS.find(
      (plan) => plan.monthlyCredits + plan.launchCredits >= shortfallCredits,
    ) ??
    PLAN_RECOMMENDATIONS[PLAN_RECOMMENDATIONS.length - 1] ??
    null
  );
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
  fontWeight: 500,
} as const;

const detailValueStyle = {
  color: v4Colors.text,
  fontWeight: 400,
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

const requiredActionRowStyle = {
  display: "flex",
  alignItems: "center",
  marginTop: 10,
} as const;

const estimateHintStyle = {
  color: v4Colors.textMuted,
  fontSize: 12,
  fontWeight: 500,
  lineHeight: "18px",
  marginTop: 12,
} as const;

const offerFeatureGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
  gap: 12,
} as const;

const offerDescriptionStyle = {
  marginBottom: 14,
  color: v4Colors.textMuted,
  fontSize: 14,
  lineHeight: "22px",
} as const;

const subscriptionBenefitStyle = {
  marginBottom: 14,
  padding: "14px 16px",
  borderRadius: 16,
  border: "1px solid rgba(122, 60, 255, 0.18)",
  background: "linear-gradient(180deg, rgba(122, 60, 255, 0.08) 0%, rgba(33, 128, 255, 0.04) 100%)",
} as const;

const subscriptionBenefitLabelStyle = {
  marginBottom: 6,
  color: "#7a3cff",
  fontSize: 12,
  fontWeight: 700,
  lineHeight: "18px",
  letterSpacing: "0.02em",
  textTransform: "uppercase",
} as const;

const subscriptionBenefitValueStyle = {
  color: v4Colors.text,
  fontSize: 16,
  fontWeight: 700,
  lineHeight: "24px",
} as const;

const subscriptionBenefitCaptionStyle = {
  marginTop: 8,
  color: v4Colors.textMuted,
  fontSize: 13,
  lineHeight: "20px",
} as const;

const offerFeatureItemStyle = {
  position: "relative",
  minHeight: 108,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexDirection: "column",
  textAlign: "center",
  padding: "18px 12px 14px",
  borderRadius: 16,
  border: `1px solid ${v4Colors.cardBorder}`,
  background: v4Colors.cardBg,
} as const;

const offerFeatureBadgeStyle = {
  position: "absolute",
  top: 10,
  right: 10,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "2px 8px",
  borderRadius: 999,
  background: "rgba(122, 60, 255, 0.1)",
  color: "#7a3cff",
  fontSize: 11,
  fontWeight: 700,
  lineHeight: "16px",
} as const;

const offerFeatureTitleStyle = {
  color: v4Colors.text,
  fontSize: 15,
  fontWeight: 700,
  lineHeight: "22px",
} as const;

const offerFeatureNoteStyle = {
  marginTop: 6,
  color: v4Colors.textMuted,
  fontSize: 12,
  fontWeight: 500,
  lineHeight: "18px",
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

const footerTextLinkStyle = {
  border: "none",
  background: "transparent",
  padding: 0,
  color: v4Colors.textMuted,
  fontSize: 13,
  fontWeight: 600,
  lineHeight: "20px",
  cursor: "pointer",
} as const;
