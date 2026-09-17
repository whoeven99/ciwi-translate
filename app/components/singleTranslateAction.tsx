import { Input, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifyIfCreateTaskBlockedByCredits } from "~/lib/createTranslateQuotaGuard";
import {
  AI_MODEL_OPTIONS,
  DEFAULT_AI_MODEL,
} from "~/routes/app.translate-v4/constants";
import { getV4AiModelLabel } from "~/routes/app.translate-v4/v4I18n";
import { AiModelInFlowSelect } from "~/routes/app.translate-v4/components/AiModelInFlowSelect";
import { AppSModal } from "~/ui/components/AppSModal";
import Button, { type AppButtonProps } from "~/ui/components/AppButton";
import {
  ConfirmInfoCard,
  CreditsEstimatePanel,
  formatConfirmCredits,
} from "~/routes/app.translate-v4/components/CreditsConfirmPanel";
import { openCreditsPurchaseModal } from "~/utils/creditsPurchaseModal";

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
  sourceText?: string | null;
  targetLocale?: string | null;
  fieldKey?: string | null;
  onSubmit: (payload: SingleTranslateSubmitPayload) => void | Promise<void>;
  triggerProps?: AppButtonProps;
}

const normalizeText = (value?: string | null) => value?.trim() ?? "";

function parseRemainingCredits(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : Number.NaN;
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : null;
}

function toastMessage(message: string) {
  shopify.toast.show(message);
}

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
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState(false);
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

  const quotaPrecheckPending = open && (estimateLoading || quotaLoading);

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
  }, [open, sourceText, targetLocale, fieldKey, prompt, aiModel]);

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
        setCurrentRemainingCredits(parseRemainingCredits(data?.quota?.remaining));
      })
      .catch(() => {
        if (!controller.signal.aborted) setCurrentRemainingCredits(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setQuotaLoading(false);
      });

    return () => controller.abort();
  }, [open]);

  const openSingleTranslateCreditsModal = useCallback((remainingCredits: number | null) => {
    openCreditsPurchaseModal({
      kind: "single_translate",
      target: normalizeText(targetLocale) || "unknown",
      fieldKey: normalizeText(fieldKey) || "value",
      estimatedCredits,
      currentRemainingCredits: remainingCredits,
      shortfallCredits:
        estimatedCredits == null
          ? null
          : Math.max(estimatedCredits - (remainingCredits ?? 0), 0),
      state: modalState,
    });
  }, [estimatedCredits, fieldKey, modalState, targetLocale]);

  useEffect(() => {
    if (!open || quotaLoading) return;
    if (
      notifyIfCreateTaskBlockedByCredits({
        remainingCredits: currentRemainingCredits,
        t,
        notify: toastMessage,
      })
    ) {
      openSingleTranslateCreditsModal(currentRemainingCredits);
      setOpen(false);
      setPrompt("");
    }
  }, [open, quotaLoading, currentRemainingCredits, openSingleTranslateCreditsModal, t]);

  const actionLabel = getActionLabel(modalState, t);
  const modalTitle = getModalTitle(modalState, t);
  const modalDescription = getModalDescription(modalState, t);
  const submitLabel = getSubmitLabel(modalState, t);
  const promptLabel = t("manage.singleTranslate.promptSuggestion");
  const stateLabel = getStateLabel(modalState, t);
  const targetLabel = normalizeText(targetLocale).toUpperCase() || "TARGET";
  const fieldLabel = fieldKey?.trim() || "value";
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

  const handleOpen = async () => {
    if (opening || loading) return;
    setAiModel(readStoredAiModel());
    setOpening(true);
    try {
      const res = await fetch("/api/translate-v4/quota");
      const data = (await res.json()) as {
        quota?: { remaining?: number | string | null };
      };
      const remaining = parseRemainingCredits(data?.quota?.remaining);
      if (remaining == null) {
        toastMessage(t("v4.create.quotaUnavailable"));
        return;
      }
      if (
        notifyIfCreateTaskBlockedByCredits({
          remainingCredits: remaining,
          t,
          notify: toastMessage,
        })
      ) {
        openSingleTranslateCreditsModal(remaining);
        return;
      }
      setOpen(true);
    } catch {
      toastMessage(t("v4.create.quotaUnavailable"));
    } finally {
      setOpening(false);
    }
  };

  const handlePrimaryAction = () => {
    if (quotaPrecheckPending) {
      toastMessage(t("Calculating..."));
      return;
    }
    if (
      notifyIfCreateTaskBlockedByCredits({
        remainingCredits: currentRemainingCredits,
        t,
        notify: toastMessage,
      })
    ) {
      openSingleTranslateCreditsModal(currentRemainingCredits);
      closeModal();
      return;
    }

    persistAiModel(aiModel);
    void onSubmit({
      customPrompt: normalizeText(prompt) || undefined,
      aiModel,
    });
    closeModal();
  };

  return (
    <>
      <Button
        {...triggerProps}
        type={triggerProps?.type ?? "default"}
        size={triggerProps?.size ?? "middle"}
        onClick={() => {
          void handleOpen();
        }}
        loading={loading || opening}
      >
        {actionLabel}
      </Button>
      <AppSModal
        open={open}
        heading={modalTitle}
        onClose={closeModal}
        size="base"
        primaryAction={{
          content: submitLabel,
          onAction: handlePrimaryAction,
          loading: loading || opening,
          disabled: quotaPrecheckPending,
        }}
        secondaryActions={[
          {
            content: t("Cancel"),
            onAction: closeModal,
            disabled: loading,
          },
        ]}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Text type="secondary" style={{ display: "block", lineHeight: 1.6 }}>
            {modalDescription}
          </Text>

          <ConfirmInfoCard title={t("manage.singleTranslate.summaryTitle")}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div>
                <Text strong style={{ display: "block" }}>
                  {`${targetLabel} · ${stateLabel}`}
                </Text>
                <Text
                  type="secondary"
                  style={{ display: "block", marginTop: 4, fontSize: 12 }}
                >
                  {fieldLabel}
                </Text>
              </div>
            </div>
            <Text
              type="secondary"
              style={{ display: "block", marginTop: 10, lineHeight: 1.6 }}
            >
              {t("manage.singleTranslate.estimateHint")}
            </Text>
          </ConfirmInfoCard>

          <CreditsEstimatePanel
            requiredValue={requiredCreditsValue}
            availableValue={availableCreditsValue}
            hint={t("manage.singleTranslate.estimateHint")}
          />

          <div>
            <Text strong style={{ display: "block", marginBottom: 8 }}>
              {t("v4.createTask.aiModel")}
            </Text>
            <AiModelInFlowSelect
              label={t("v4.createTask.aiModel")}
              value={aiModel}
              options={aiModelOptions}
              onChange={setAiModel}
              active={open}
            />
          </div>

          <div>
            <Text strong style={{ display: "block", marginBottom: 4 }}>
              {promptLabel}
            </Text>
            <Text
              type="secondary"
              style={{ display: "block", marginBottom: 8, lineHeight: 1.6 }}
            >
              {getPromptDescription(modalState, t)}
            </Text>
            <TextArea
              rows={4}
              maxLength={MAX_PROMPT_LENGTH}
              value={prompt}
              placeholder={t("manage.singleTranslate.promptPlaceholder")}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </div>
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

function getStateLabel(
  state: SingleTranslateModalState,
  t: (key: string) => string,
) {
  if (state === "missing") return t("manage.singleTranslate.stateMissing");
  if (state === "outdated") return t("manage.singleTranslate.stateOutdated");
  return t("manage.singleTranslate.stateQuality");
}

function getModalDescription(
  state: SingleTranslateModalState,
  t: (key: string) => string,
) {
  if (state === "missing") return t("manage.singleTranslate.descMissing");
  if (state === "outdated") return t("manage.singleTranslate.descOutdated");
  return t("manage.singleTranslate.descQuality");
}

function getPromptDescription(
  state: SingleTranslateModalState,
  t: (key: string) => string,
) {
  if (state === "missing") return t("manage.singleTranslate.promptDescMissing");
  if (state === "outdated") return t("manage.singleTranslate.promptDescOutdated");
  return t("manage.singleTranslate.promptDescQuality");
}

export default SingleTranslateAction;
