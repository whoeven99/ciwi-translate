import { useEffect, useMemo, useState } from "react";
import { Button } from "@shopify/polaris";
import { useFetcher, useNavigate } from "@remix-run/react";
import { useTranslation } from "react-i18next";
import { AppSModal } from "~/ui/components/AppSModal";
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
import { shouldBlockCreateTaskByCredits } from "~/lib/createTranslateQuotaGuard";
import { buildBillingReturnPath } from "~/utils/billingReturn";
import { reportClientLog } from "~/utils/clientLog";
import {
  ConfirmInfoCard,
  CreditsEstimatePanel,
  QuotaOfferPanel,
  formatConfirmCredits,
  getConfirmScenarioTitle,
  resolveScenarioFromOfferMode,
  type CreateTaskConfirmScenario,
  type CreateTaskQuotaOfferMode,
} from "./CreditsConfirmPanel";

type Props = {
  open: boolean;
  creating: boolean;
  planType?: string | null;
  targetOptions: ShopLocaleOption[];
  targets: string[];
  modules: string[];
  aiModel: string;
  isCover: boolean;
  isHandle: boolean;
  includeLiquid: boolean;
  sourceLocale?: string;
  estimate: CreateTaskEstimateView | null;
  scenario: CreateTaskConfirmScenario;
  quotaOfferMode: CreateTaskQuotaOfferMode;
  previousTotalChars?: number;
  onClose: () => void;
  onConfirmCreate: () => void;
  onBuyCredits: (estimatedCredits?: number | null) => void;
  onBeforeBilling?: () => void;
};

type TranslateFn = (
  key: string,
  options?: Record<string, unknown>,
) => string;

type PlanTier = "basic" | "pro" | "premium";

type PlanOption = {
  title: string;
  tier: PlanTier;
  monthlyCredits: number;
  monthlyPrice: number;
  yearlyPrice: number;
  fitLabelKey: string;
  fitLabelDefault: string;
};

const PLAN_OPTIONS: readonly PlanOption[] = [
  {
    title: "Basic",
    tier: "basic",
    monthlyCredits: 1500000,
    monthlyPrice: 7.99,
    yearlyPrice: 6.39,
    fitLabelKey: "pricing.fit_basic",
    fitLabelDefault:
      "Good for smaller stores that need core product and page translation.",
  },
  {
    title: "Pro",
    tier: "pro",
    monthlyCredits: 3000000,
    monthlyPrice: 19.99,
    yearlyPrice: 15.99,
    fitLabelKey: "pricing.fit_pro",
    fitLabelDefault:
      "Good for stores expanding into multiple markets with regular content updates.",
  },
  {
    title: "Premium",
    tier: "premium",
    monthlyCredits: 8000000,
    monthlyPrice: 39.99,
    yearlyPrice: 31.99,
    fitLabelKey: "pricing.fit_premium",
    fitLabelDefault:
      "Good for high-volume teams managing multiple markets and frequent launches.",
  },
] as const;

export function CreateTaskConfirmModal({
  open,
  creating,
  planType,
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
  const [narrowViewport, setNarrowViewport] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 768px)").matches,
  );
  const [selectedPlanTitle, setSelectedPlanTitle] = useState<string>("Pro");
  const planFetcher = useFetcher<{
    success?: boolean;
    response?: { confirmationUrl?: string };
  }>();
  const detailed = useDetailedCreateTaskEstimate();

  const detailedRunning = detailed.progress.status === "running";
  const { reset: resetDetailed } = detailed;

  useEffect(() => {
    const media = window.matchMedia("(max-width: 768px)");
    const sync = () => setNarrowViewport(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!open) {
      resetDetailed();
    }
  }, [open, resetDetailed]);

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
  const createTaskBlockedByCredits = shouldBlockCreateTaskByCredits({
    remainingCredits,
  });
  const scenario: CreateTaskConfirmScenario = detailedDone
    ? createTaskBlockedByCredits
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
    estimatedCredits != null ? formatConfirmCredits(estimatedCredits) : "--";
  const remainingCreditsLabel =
    remainingCredits != null ? formatConfirmCredits(remainingCredits) : "--";
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
  const isInsufficientPricing = scenario === "insufficient_pricing";
  const isPlanSelectionVisible = isTrialOffer || isInsufficientPricing;
  const hasPositiveCredits = remainingCredits != null && remainingCredits > 0;
  const hasNonPositiveCredits = remainingCredits != null && remainingCredits <= 0;
  const canStartPartial = isInsufficientPaid && !hasNonPositiveCredits && hasPositiveCredits;
  const scenarioTitle = getConfirmScenarioTitle(t, scenario, canStartPartial);
  const estimateHint = detailedDone
    ? t("v4.createTask.detailedEstimateDoneHint")
    : detailed.progress.status === "error"
      ? t("v4.createTask.detailedEstimateErrorHint")
      : t("v4.createTask.confirmEstimateExactHint");

  const planOptions = useMemo(
    () => buildPlanOptions(t),
    [t],
  );
  const recommendedPlanTitle = isTrialOffer
    ? "Basic"
    : (recommendPlanForShortfall(shortfallCredits)?.title ??
      planOptions[1]?.title ??
      "Pro");
  const selectedPlan =
    planOptions.find((item) => item.title === selectedPlanTitle) ??
    planOptions.find((item) => item.title === recommendedPlanTitle) ??
    planOptions[0];
  const selectedPlanStartsWithTrial =
    isTrialOffer && selectedPlan?.title === "Basic";
  const recommendedPaidUpgradePlan =
    isInsufficientPaid && !canStartPartial
      ? recommendPaidUpgradePlan({
          currentPlanType: planType ?? null,
          estimatedCredits,
        })
      : null;
  const showPaidUpgradeAction =
    isInsufficientPaid && !canStartPartial && recommendedPaidUpgradePlan != null;
  const planPickerDescription = isTrialOffer
    ? t("v4.createTask.planPickerTrialDescription", {
        defaultValue:
          "Monthly plans only. Basic includes a 5-day free trial and starts billing after the trial ends unless you cancel first.",
      })
    : t("v4.createTask.planPickerDescription", {
        defaultValue:
          "Pick the monthly plan that fits this task best. Your current setup will be kept after billing.",
      });

  useEffect(() => {
    if (!open) return;
    setSelectedPlanTitle(recommendedPlanTitle);
  }, [open, recommendedPlanTitle]);

  const primaryActionLabel = isReady
    ? t("v4.createTask.confirmStartNow")
    : isPlanSelectionVisible
      ? selectedPlanStartsWithTrial
        ? t("v4.createTask.confirmBasicTrialAndStart", {
            defaultValue: "Start Basic trial",
          })
        : t("v4.createTask.confirmSelectedPlanAndStart", {
            defaultValue: "Continue with selected plan",
          })
      : canStartPartial
        ? t("v4.createTask.confirmStartPartial")
        : isInsufficientPaid
          ? t("v4.createTask.confirmBuyCreditsAndStart")
          : t("v4.createTask.confirmBuyCreditsOnly");

  const secondaryActionLabel = isReady
    ? null
    : isPlanSelectionVisible
      ? canStartPartial
        ? t("v4.createTask.confirmStartPartial")
        : t("v4.createTask.confirmBuyCreditsOnly")
      : canStartPartial
        ? t("v4.createTask.confirmBuyCreditsOnly")
        : isInsufficientPaid && showPaidUpgradeAction
          ? t("v4.createTask.confirmViewPlans")
          : null;

  const buildReturnPathForPlan = () => {
    if (typeof window === "undefined") return undefined;
    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    return buildBillingReturnPath(currentPath, {
      kind: "plan",
      previousTotalChars,
    });
  };

  const handleSelectedPlanAction = () => {
    if (!selectedPlan) return;
    onBeforeBilling?.();
    const payload: Record<string, string> = {
      payForPlan: JSON.stringify({
        title: selectedPlan.title,
        monthlyPrice: selectedPlan.monthlyPrice,
        yearlyPrice: selectedPlan.yearlyPrice,
        yearly: false,
        trialDays: selectedPlanStartsWithTrial ? 5 : 0,
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
    if (isPlanSelectionVisible) {
      handleSelectedPlanAction();
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
    onBeforeBilling?.();
    onBuyCredits(estimatedCredits);
  };

  const handleSecondaryAction = () => {
    if (isPlanSelectionVisible) {
      if (canStartPartial) {
        logConfirmStart("start_partial");
        onConfirmCreate();
        return;
      }
      onBeforeBilling?.();
      onBuyCredits(estimatedCredits);
      return;
    }
    if (canStartPartial) {
      onBeforeBilling?.();
      onBuyCredits(estimatedCredits);
      return;
    }
    if (isInsufficientPaid) {
      if (!showPaidUpgradeAction) return;
      onBeforeBilling?.();
      const returnPath = buildReturnPathForPlan();
      onClose();
      navigate(
        returnPath
          ? `/app/pricing?returnPath=${encodeURIComponent(returnPath)}`
          : "/app/pricing",
      );
    }
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

  const actionsBusy = creating || planFetcher.state === "submitting";

  return (
    <AppSModal
      open={open}
      heading={scenarioTitle}
      onClose={onClose}
      size={narrowViewport ? "base" : "large"}
      primaryAction={{
        content: primaryActionLabel,
        onAction: handlePrimaryAction,
        loading: actionsBusy,
        disabled: detailedRunning,
      }}
      secondaryActions={
        secondaryActionLabel
          ? [
              {
                content: secondaryActionLabel,
                onAction: handleSecondaryAction,
                disabled: creating,
              },
            ]
          : []
      }
    >
      <div style={bodyStyle}>
        <CreditsEstimatePanel
          requiredValue={requiredCreditsValue}
          availableValue={availableCreditsValue}
          hint={estimateHint}
          requiredAction={
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
          }
        />

        <ConfirmInfoCard title={t("v4.createTask.confirmTaskDetailTitle")}>
          <div style={detailListStyle}>
            {detailItems.map((item) => (
              <DetailLine
                key={item.label}
                label={item.label}
                value={item.value}
              />
            ))}
          </div>
        </ConfirmInfoCard>

        <QuotaOfferPanel
          scenario={scenario}
          subscriptionBenefitValue={null}
          subscriptionBenefitCaption={null}
        />

        {isPlanSelectionVisible ? (
          <ConfirmInfoCard
            title={t("v4.createTask.planPickerTitle", {
              defaultValue: "Choose a plan for this task",
            })}
          >
            <div style={planPickerDescriptionStyle}>{planPickerDescription}</div>
            <div style={planGridStyle}>
              {planOptions.map((plan) => {
                const selected = plan.title === selectedPlan?.title;
                const recommended = plan.title === recommendedPlanTitle;
                const includesTrial = isTrialOffer && plan.title === "Basic";
                return (
                  <button
                    key={plan.title}
                    type="button"
                    onClick={() => setSelectedPlanTitle(plan.title)}
                    style={{
                      ...planCardStyle,
                      ...(selected ? planCardSelectedStyle : null),
                    }}
                  >
                    <div style={planCardHeaderStyle}>
                      <div>
                        <div style={planCardTitleStyle}>{plan.title}</div>
                        <div style={planCardPriceStyle}>
                          ${plan.monthlyPrice.toFixed(2)}
                          <span style={planCardPriceUnitStyle}>{t("/month")}</span>
                        </div>
                      </div>
                      {recommended ? (
                        <div style={planCardBadgeStyle}>{t("Recommended")}</div>
                      ) : null}
                    </div>
                    <div style={planCardCreditsStyle}>
                      {t("{{credits}} credits/month", {
                        credits: Number(plan.monthlyCredits).toLocaleString("en-US"),
                      })}
                    </div>
                    {includesTrial ? (
                      <div style={planCardTrialBoxStyle}>
                        <div style={planCardTrialTitleStyle}>
                          {t("v4.createTask.planBasicTrialTitle", {
                            defaultValue: "5-day free trial included",
                          })}
                        </div>
                        <div style={planCardTrialDescStyle}>
                          {t("v4.createTask.planBasicTrialDesc", {
                            defaultValue:
                              "Start now. Then $7.99/month after 5 days unless you cancel before billing.",
                          })}
                        </div>
                      </div>
                    ) : null}
                    <div style={planCardFitStyle}>{plan.fitLabel}</div>
                  </button>
                );
              })}
            </div>
          </ConfirmInfoCard>
        ) : null}
      </div>
    </AppSModal>
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

function buildPlanOptions(t: TranslateFn) {
  return PLAN_OPTIONS.map((plan) => ({
    ...plan,
    fitLabel: t(plan.fitLabelKey, {
      defaultValue: plan.fitLabelDefault,
    }),
  }));
}

function recommendPlanForShortfall(shortfallCredits: number) {
  return (
    PLAN_OPTIONS.find((plan) => plan.monthlyCredits >= shortfallCredits) ??
    PLAN_OPTIONS[PLAN_OPTIONS.length - 1] ??
    null
  );
}

function normalizePaidPlanTier(planType: string | null): PlanTier | null {
  if (!planType) return null;

  const normalized = planType.trim().toLowerCase();
  if (normalized.startsWith("basic")) return "basic";
  if (normalized === "pro" || normalized === "professional" || normalized.startsWith("pro-")) {
    return "pro";
  }
  if (
    normalized.startsWith("premium") ||
    normalized === "enterprise" ||
    normalized === "unlimited"
  ) {
    return "premium";
  }
  return null;
}

function recommendPaidUpgradePlan(params: {
  currentPlanType: string | null;
  estimatedCredits: number | null;
}) {
  const { currentPlanType, estimatedCredits } = params;
  if (estimatedCredits == null || estimatedCredits <= 0) return null;

  const currentTier = normalizePaidPlanTier(currentPlanType);
  if (!currentTier) return null;

  const currentIndex = PLAN_OPTIONS.findIndex((plan) => plan.tier === currentTier);
  if (currentIndex < 0) return null;

  return (
    PLAN_OPTIONS.slice(currentIndex + 1).find(
      (plan) => plan.monthlyCredits >= estimatedCredits,
    ) ?? null
  );
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

const bodyStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 16,
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

const planPickerDescriptionStyle = {
  color: v4Colors.textMuted,
  fontSize: 12,
  fontWeight: 500,
  lineHeight: "18px",
  marginBottom: 14,
} as const;

const planGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 12,
} as const;

const planCardStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  width: "100%",
  padding: "16px 14px",
  borderRadius: 16,
  border: `1px solid ${v4Colors.cardBorder}`,
  background: v4Colors.cardBg,
  textAlign: "left",
  cursor: "pointer",
} as const;

const planCardSelectedStyle = {
  borderColor: "rgba(33, 128, 255, 0.4)",
  boxShadow: "0 10px 28px rgba(33, 128, 255, 0.12)",
  background: "rgba(33, 128, 255, 0.04)",
} as const;

const planCardHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
} as const;

const planCardTitleStyle = {
  color: v4Colors.text,
  fontSize: 15,
  fontWeight: 700,
  lineHeight: "22px",
} as const;

const planCardPriceStyle = {
  color: v4Colors.text,
  fontSize: 26,
  fontWeight: 700,
  lineHeight: "30px",
  marginTop: 4,
} as const;

const planCardPriceUnitStyle = {
  color: v4Colors.textMuted,
  fontSize: 12,
  fontWeight: 600,
  lineHeight: "18px",
  marginLeft: 4,
} as const;

const planCardBadgeStyle = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 8px",
  borderRadius: 999,
  background: "rgba(33, 128, 255, 0.1)",
  color: v4Colors.primary,
  fontSize: 11,
  fontWeight: 700,
  lineHeight: "16px",
  whiteSpace: "nowrap",
} as const;

const planCardCreditsStyle = {
  color: v4Colors.text,
  fontSize: 13,
  fontWeight: 700,
  lineHeight: "20px",
} as const;

const planCardTrialBoxStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  padding: "10px 12px",
  borderRadius: 12,
  background: "rgba(33, 128, 255, 0.08)",
  border: "1px solid rgba(33, 128, 255, 0.16)",
} as const;

const planCardTrialTitleStyle = {
  color: v4Colors.primary,
  fontSize: 12,
  fontWeight: 700,
  lineHeight: "18px",
} as const;

const planCardTrialDescStyle = {
  color: v4Colors.text,
  fontSize: 12,
  fontWeight: 600,
  lineHeight: "18px",
} as const;

const planCardFitStyle = {
  color: v4Colors.textMuted,
  fontSize: 12,
  fontWeight: 500,
  lineHeight: "18px",
} as const;
