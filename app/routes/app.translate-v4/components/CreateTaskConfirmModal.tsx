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
  const showTaskDetails = isReady;
  const hasPositiveCredits = remainingCredits != null && remainingCredits > 0;
  const hasNonPositiveCredits = remainingCredits != null && remainingCredits <= 0;
  const canStartPartial = !isReady && !hasNonPositiveCredits && hasPositiveCredits;
  const scenarioTitle = getConfirmScenarioTitle(t, scenario, canStartPartial);
  const recommendedPlan =
    shortfallCredits > 0 ? recommendPlanForShortfall(shortfallCredits) : null;
  const recommendedPaidUpgradePlan =
    scenario === "insufficient_paid" && !canStartPartial
      ? recommendPaidUpgradePlan({
          currentPlanType: planType ?? null,
          estimatedCredits,
        })
      : null;
  const showPaidUpgradeAction =
    scenario === "insufficient_paid" &&
    !canStartPartial &&
    recommendedPaidUpgradePlan != null;
  const subscriptionBenefitValue =
    recommendedPlan &&
    scenario === "insufficient_pricing"
      ? t("pricing.launchCredits", {
          credits: formatConfirmCredits(recommendedPlan.launchCredits),
          defaultValue: "+{{credits}} Launch Credits (first subscribe only)",
        })
      : null;
  const subscriptionBenefitCaption =
    recommendedPlan &&
    scenario === "insufficient_pricing"
      ? t("v4.createTask.confirmRecommendedPlanMonthlyValue", {
          plan: recommendedPlan.title,
          monthly: formatConfirmCredits(recommendedPlan.monthlyCredits),
          defaultValue: "{{plan}} · {{monthly}} credits/month",
        })
      : null;
  const estimateHint = detailedDone
    ? t("v4.createTask.detailedEstimateDoneHint")
    : detailed.progress.status === "error"
      ? t("v4.createTask.detailedEstimateErrorHint")
      : t("v4.createTask.confirmEstimateExactHint");

  const primaryActionLabel = isReady
    ? t("v4.createTask.confirmStartNow")
    : canStartPartial
      ? t("v4.createTask.confirmStartPartial")
      : isInsufficientPaid
        ? t("v4.createTask.confirmBuyCreditsAndStart")
        : isTrialOffer
          ? t("v4.createTask.confirmTrialAndStart")
          : t("v4.createTask.confirmBuyCreditsOnly");
  const secondaryActionLabel = isReady
    ? null
    : canStartPartial
      ? isTrialOffer
        ? t("v4.createTask.confirmTrialAndStart")
        : scenario === "insufficient_pricing"
          ? t("v4.createTask.confirmViewPlans")
          : t("v4.createTask.confirmBuyCreditsOnly")
      : isInsufficientPaid
        ? showPaidUpgradeAction
          ? t("v4.createTask.confirmViewPlans")
          : null
        : isTrialOffer
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
    if (isInsufficientPricing) {
      onBeforeBilling?.();
      onBuyCredits(estimatedCredits);
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
      if (scenario === "insufficient_pricing") {
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
      return;
    }
    if (isTrialOffer) {
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

          {showTaskDetails ? (
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
          ) : null}

          <QuotaOfferPanel
            scenario={scenario}
            subscriptionBenefitValue={subscriptionBenefitValue}
            subscriptionBenefitCaption={subscriptionBenefitCaption}
          />
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

const PLAN_RECOMMENDATIONS = [
  { title: "Basic", tier: "basic", monthlyCredits: 1500000, launchCredits: 4000000 },
  { title: "Pro", tier: "pro", monthlyCredits: 3000000, launchCredits: 8000000 },
  { title: "Premium", tier: "premium", monthlyCredits: 8000000, launchCredits: 16000000 },
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

function normalizePaidPlanTier(planType: string | null): "basic" | "pro" | "premium" | null {
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

  const currentIndex = PLAN_RECOMMENDATIONS.findIndex((plan) => plan.tier === currentTier);
  if (currentIndex < 0) return null;

  return (
    PLAN_RECOMMENDATIONS.slice(currentIndex + 1).find(
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
