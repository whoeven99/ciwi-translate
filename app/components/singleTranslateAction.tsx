import { Input, Typography } from "antd";
import { Select as PolarisSelect } from "@shopify/polaris";
import { useEffect, useMemo, useState } from "react";
import { useFetcher, useNavigate } from "@remix-run/react";
import { useTranslation } from "react-i18next";
import { useSelector } from "react-redux";
import { openCreditsPurchaseModal } from "~/utils/creditsPurchaseModal";
import { buildBillingReturnPath } from "~/utils/billingReturn";
import {
  AI_MODEL_OPTIONS,
  DEFAULT_AI_MODEL,
} from "~/routes/app.translate-v4/constants";
import { getV4AiModelLabel } from "~/routes/app.translate-v4/v4I18n";
import { AppSModal } from "~/ui/components/AppSModal";
import Button, { type AppButtonProps } from "~/ui/components/AppButton";
import {
  CreditsEstimatePanel,
  QuotaOfferPanel,
  formatConfirmCredits,
  getConfirmScenarioTitle,
  type CreateTaskConfirmScenario,
  type CreateTaskQuotaOfferMode,
} from "~/routes/app.translate-v4/components/CreditsConfirmPanel";

const { TextArea } = Input;
const { Text } = Typography;

const MAX_PROMPT_LENGTH = 500;
const AI_MODEL_STORAGE_KEY = "ciwi.manage.singleTranslate.aiModel";
const ESTIMATE_DEBOUNCE_MS = 350;

type SingleTranslateModalState = "missing" | "quality" | "outdated";

export type SingleTranslateSubmitPayload = {
  customPrompt?: string;
  aiModel: string;
};

interface SingleTranslateActionProps {
  existingTranslation?: string | null;
  isOutdated?: boolean;
  loading?: boolean;
  /** 源文字段（用于积分预估）。 */
  sourceText?: string | null;
  /** 目标语言 locale。 */
  targetLocale?: string | null;
  /** Shopify 字段 key（handle 走专用 prompt）。 */
  fieldKey?: string | null;
  onSubmit: (payload: SingleTranslateSubmitPayload) => void | Promise<void>;
  triggerProps?: AppButtonProps;
}

const normalizeText = (value?: string | null) => value?.trim() ?? "";

function readStoredAiModel(): string {
  try {
    const stored = sessionStorage.getItem(AI_MODEL_STORAGE_KEY)?.trim() ?? "";
    if (stored && AI_MODEL_OPTIONS.some((option) => option.value === stored)) {
      return stored;
    }
  } catch {
    // sessionStorage may be unavailable
  }
  return DEFAULT_AI_MODEL;
}

function persistAiModel(aiModel: string) {
  try {
    sessionStorage.setItem(AI_MODEL_STORAGE_KEY, aiModel);
  } catch {
    // ignore quota / private mode
  }
}

function getModalState(args: {
  hasExistingTranslation: boolean;
  isOutdated: boolean;
}): SingleTranslateModalState {
  if (!args.hasExistingTranslation) return "missing";
  if (args.isOutdated) return "outdated";
  return "quality";
}

function deferOpenCreditsPurchaseModal(
  context: Parameters<typeof openCreditsPurchaseModal>[0],
) {
  const schedule = () => openCreditsPurchaseModal(context);
  if (typeof window === "undefined") return;
  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(schedule);
    });
    return;
  }
  window.setTimeout(schedule, 0);
}

const SingleTranslateAction: React.FC<SingleTranslateActionProps> = ({
  existingTranslation,
  isOutdated = false,
  loading = false,
  sourceText,
  targetLocale,
  fieldKey,
  onSubmit,
  triggerProps,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isNew = useSelector(
    (state: { userConfig?: { isNew?: boolean | null } }) =>
      state.userConfig?.isNew ?? null,
  );
  const planType = useSelector(
    (state: { userConfig?: { plan?: { type?: string | null } } }) =>
      state.userConfig?.plan?.type?.trim() || null,
  );
  const planFetcher = useFetcher<{
    success?: boolean;
    response?: { confirmationUrl?: string };
  }>();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [aiModel, setAiModel] = useState(DEFAULT_AI_MODEL);
  const [estimatedCredits, setEstimatedCredits] = useState<number | null>(null);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [currentRemainingCredits, setCurrentRemainingCredits] = useState<
    number | null
  >(null);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const hasExistingTranslation = useMemo(
    () => normalizeText(existingTranslation).length > 0,
    [existingTranslation],
  );
  const modalState = useMemo(
    () => getModalState({ hasExistingTranslation, isOutdated }),
    [hasExistingTranslation, isOutdated],
  );

  const aiModelOptions = useMemo(
    () =>
      AI_MODEL_OPTIONS.map((option) => ({
        value: option.value,
        label: getV4AiModelLabel(option.value, t),
      })),
    [t],
  );

  const shortfallCredits = useMemo(() => {
    if (estimatedCredits == null || currentRemainingCredits == null) return null;
    return Math.max(estimatedCredits - currentRemainingCredits, 0);
  }, [estimatedCredits, currentRemainingCredits]);
  const quotaPrecheckPending = open && (estimateLoading || quotaLoading);
  const quotaPrecheckReady =
    estimatedCredits != null && currentRemainingCredits != null;
  const normalizedPlanType = planType?.trim().toLowerCase() || "";
  const hasPaidPlan =
    normalizedPlanType !== "" && normalizedPlanType !== "free";
  const needsMoreCredits =
    quotaPrecheckReady && estimatedCredits > currentRemainingCredits;
  const quotaOfferMode: CreateTaskQuotaOfferMode = hasPaidPlan
    ? "paid"
    : isNew === true
      ? "trial"
      : "pricing";
  const scenario: CreateTaskConfirmScenario =
    !quotaPrecheckReady || !needsMoreCredits
      ? "ready"
      : quotaOfferMode === "paid"
        ? "insufficient_paid"
        : quotaOfferMode === "trial"
          ? "insufficient_trial"
          : "insufficient_pricing";
  const isReady = scenario === "ready";
  const isTrialOffer = scenario === "insufficient_trial";
  const isInsufficientPaid = scenario === "insufficient_paid";
  const hasPositiveCredits =
    currentRemainingCredits != null && currentRemainingCredits > 0;
  const hasNonPositiveCredits =
    currentRemainingCredits != null && currentRemainingCredits <= 0;
  const canStartPartial = !isReady && !hasNonPositiveCredits && hasPositiveCredits;

  useEffect(() => {
    if (!open) {
      setEstimatedCredits(null);
      setEstimateLoading(false);
      return;
    }
    const text = sourceText ?? "";
    const target = normalizeText(targetLocale);
    if (!text.trim() || !target) {
      setEstimatedCredits(0);
      setEstimateLoading(false);
      return;
    }

    const controller = new AbortController();
    setEstimateLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/translate-v4/single-estimate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            context: text,
            target,
            key: fieldKey?.trim() || "value",
            customPrompt: normalizeText(prompt) || undefined,
            aiModel,
          }),
          signal: controller.signal,
        });
        const data = (await res.json()) as {
          ok?: boolean;
          estimate?: { estimatedCredits?: number };
        };
        if (!controller.signal.aborted) {
          setEstimatedCredits(
            data.ok && typeof data.estimate?.estimatedCredits === "number"
              ? data.estimate.estimatedCredits
              : null,
          );
        }
      } catch {
        if (!controller.signal.aborted) setEstimatedCredits(null);
      } finally {
        if (!controller.signal.aborted) setEstimateLoading(false);
      }
    }, ESTIMATE_DEBOUNCE_MS);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [
    open,
    sourceText,
    targetLocale,
    fieldKey,
    prompt,
    aiModel,
  ]);

  useEffect(() => {
    if (!open) {
      setCurrentRemainingCredits(null);
      setQuotaLoading(false);
      return;
    }

    const controller = new AbortController();
    setQuotaLoading(true);

    void fetch("/api/translate-v4/quota", {
      signal: controller.signal,
    })
      .then((res) => res.json())
      .then((data: { quota?: { remaining?: number | string | null } }) => {
        if (controller.signal.aborted) return;
        const remaining = data?.quota?.remaining;
        const parsed =
          typeof remaining === "number"
            ? remaining
            : typeof remaining === "string"
              ? Number(remaining.trim())
              : Number.NaN;
        setCurrentRemainingCredits(
          Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : null,
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setCurrentRemainingCredits(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setQuotaLoading(false);
      });

    return () => controller.abort();
  }, [open]);

  useEffect(() => {
    if (!planFetcher.data?.success) return;
    const confirmationUrl = planFetcher.data.response?.confirmationUrl;
    if (confirmationUrl) {
      window.open(confirmationUrl, "_top");
    }
  }, [planFetcher.data]);

  const actionLabel = getActionLabel(modalState, t);
  const submitLabel = getSubmitLabel(modalState, t);
  const promptLabel = t("manage.singleTranslate.promptSuggestion");
  const headingBusy = planFetcher.state === "submitting";
  const modalTitle =
    !quotaPrecheckReady || isReady
      ? getModalTitle(modalState, t)
      : getConfirmScenarioTitle(t, scenario, canStartPartial);

  const primaryLabel = isReady
    ? submitLabel
    : canStartPartial
      ? submitLabel
      : isInsufficientPaid
        ? t("Buy credits and translate")
        : isTrialOffer
          ? t("v4.createTask.confirmTrialAndStart")
          : t("Buy credits and translate");

  const requiredCreditsValue = quotaPrecheckPending
    ? t("v4.createTask.confirmEstimateComputing")
    : estimatedCredits == null
      ? "--"
      : formatConfirmCredits(estimatedCredits);
  const availableCreditsValue = quotaPrecheckPending
    ? t("v4.createTask.confirmEstimateComputing")
    : currentRemainingCredits == null
      ? "--"
      : formatConfirmCredits(currentRemainingCredits);

  const closeModal = () => {
    setOpen(false);
    setPrompt("");
  };

  const openPurchaseModalWithContext = () => {
    closeModal();
    deferOpenCreditsPurchaseModal({
      kind: "single_translate",
      target: normalizeText(targetLocale) || "target",
      fieldKey: fieldKey?.trim() || "value",
      estimatedCredits,
      currentRemainingCredits,
      shortfallCredits,
      state: modalState,
    });
  };

  const buildReturnPathForPlan = () => {
    if (typeof window === "undefined") return undefined;
    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    return buildBillingReturnPath(currentPath, { kind: "plan" });
  };

  const handleViewPlans = () => {
    const returnPath = buildReturnPathForPlan();
    closeModal();
    navigate(
      returnPath
        ? `/app/pricing?returnPath=${encodeURIComponent(returnPath)}`
        : "/app/pricing",
    );
  };

  const handleTrialAction = () => {
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

  const secondaryAction = isReady
    ? { content: t("Cancel"), onAction: closeModal }
    : canStartPartial
      ? isTrialOffer
        ? {
            content: t("v4.createTask.confirmTrialAndStart"),
            onAction: handleTrialAction,
          }
        : scenario === "insufficient_pricing"
          ? {
              content: t("v4.createTask.confirmViewPlans"),
              onAction: handleViewPlans,
            }
          : {
              content: t("v4.createTask.confirmBuyCreditsOnly"),
              onAction: openPurchaseModalWithContext,
            }
      : {
          content: t("v4.createTask.confirmViewPlans"),
          onAction: handleViewPlans,
        };

  const handlePrimaryAction = () => {
    if (quotaPrecheckPending) {
      shopify.toast.show(t("Calculating..."));
      return;
    }

    if (isReady || canStartPartial) {
      persistAiModel(aiModel);
      void onSubmit({
        customPrompt: normalizeText(prompt) || undefined,
        aiModel,
      });
      closeModal();
      return;
    }

    if (isTrialOffer) {
      handleTrialAction();
      return;
    }

    openPurchaseModalWithContext();
  };

  return (
    <>
      <Button
        {...triggerProps}
        type={triggerProps?.type ?? "default"}
        size={triggerProps?.size ?? "middle"}
        onClick={() => {
          setAiModel(readStoredAiModel());
          setOpen(true);
        }}
        loading={loading}
      >
        {actionLabel}
      </Button>
      <AppSModal
          open={open}
          heading={modalTitle}
          onClose={closeModal}
          size="base"
          primaryAction={{
            content: primaryLabel,
            onAction: handlePrimaryAction,
            loading: loading || headingBusy,
            disabled: quotaPrecheckPending,
          }}
          secondaryActions={[
            {
              content: secondaryAction.content,
              onAction: secondaryAction.onAction,
              disabled: loading || headingBusy,
            },
          ]}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <CreditsEstimatePanel
                requiredValue={requiredCreditsValue}
                availableValue={availableCreditsValue}
                hint={t("v4.createTask.confirmEstimateExactHint")}
              />

              {isReady ? (
                <>
                  <div>
                    <Text strong style={{ display: "block", marginBottom: 8 }}>
                      {t("v4.createTask.aiModel")}
                    </Text>
                    <PolarisSelect
                      label={t("v4.createTask.aiModel")}
                      labelHidden
                      options={aiModelOptions}
                      value={aiModel}
                      onChange={setAiModel}
                    />
                  </div>

                  <div>
                    <Text strong style={{ display: "block", marginBottom: 4 }}>
                      {promptLabel}
                    </Text>
                    <TextArea
                      rows={4}
                      maxLength={MAX_PROMPT_LENGTH}
                      value={prompt}
                      placeholder={t("manage.singleTranslate.promptPlaceholder")}
                      onChange={(event) => setPrompt(event.target.value)}
                    />
                  </div>
                </>
              ) : null}

              <QuotaOfferPanel scenario={scenario} />
          </div>
        </AppSModal>
    </>
  );
};

function getActionLabel(
  state: SingleTranslateModalState,
  t: (key: string) => string,
) {
  if (state === "missing") return t("Translate");
  if (state === "outdated") return t("Update translation");
  return t("Retranslate");
}

function getModalTitle(
  state: SingleTranslateModalState,
  t: (key: string) => string,
) {
  if (state === "missing") return t("manage.singleTranslate.titleMissing");
  if (state === "outdated") return t("manage.singleTranslate.titleOutdated");
  return t("manage.singleTranslate.titleQuality");
}

function getSubmitLabel(
  state: SingleTranslateModalState,
  t: (key: string) => string,
) {
  if (state === "missing") return t("manage.singleTranslate.submitMissing");
  if (state === "outdated") return t("manage.singleTranslate.submitOutdated");
  return t("manage.singleTranslate.submitQuality");
}

export default SingleTranslateAction;
