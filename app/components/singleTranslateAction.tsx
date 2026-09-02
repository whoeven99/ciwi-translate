import { Input, Select, Typography } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { openCreditsPurchaseModal } from "~/utils/creditsPurchaseModal";
import {
  AI_MODEL_OPTIONS,
  DEFAULT_AI_MODEL,
} from "~/routes/app.translate-v4/constants";
import { getV4AiModelLabel } from "~/routes/app.translate-v4/v4I18n";
import { V4ModalShell } from "~/components/V4ModalShell";
import Button, { type AppButtonProps } from "~/ui/components/AppButton";
import { v4Colors } from "~/routes/app.translate-v4/v4Styles";

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
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [aiModel, setAiModel] = useState(DEFAULT_AI_MODEL);
  const [estimatedCredits, setEstimatedCredits] = useState<number | null>(null);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [currentRemainingCredits, setCurrentRemainingCredits] = useState<
    number | null
  >(null);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const hasSubmittedRef = useRef(false);
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
  const shouldOpenPurchaseModal =
    quotaPrecheckReady &&
    (currentRemainingCredits <= 0 || estimatedCredits > currentRemainingCredits);

  useEffect(() => {
    if (loading) {
      hasSubmittedRef.current = true;
      return;
    }
    if (!hasSubmittedRef.current) return;
    hasSubmittedRef.current = false;
    setOpen(false);
    setPrompt("");
  }, [loading]);

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

  const actionLabel = getActionLabel(modalState, t);
  const modalTitle = getModalTitle(modalState, t);
  const submitLabel = getSubmitLabel(modalState, t);
  const promptLabel = t("manage.singleTranslate.promptSuggestion");
  const primaryLabel = shouldOpenPurchaseModal
    ? t("Buy credits and translate")
    : submitLabel;

  const estimateLabel = estimateLoading
    ? t("Estimating...")
    : estimatedCredits === null
      ? "--"
      : `${estimatedCredits.toLocaleString()} ${t("credits")}`;

  const remainingLabel = quotaLoading
    ? t("Estimating...")
    : currentRemainingCredits == null
      ? "--"
      : `${currentRemainingCredits.toLocaleString()} ${t("credits")}`;

  const closeModal = () => {
    setOpen(false);
    setPrompt("");
  };

  const handleSubmit = () => {
    const customPrompt = normalizeText(prompt);

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

    if (quotaPrecheckPending) {
      shopify.toast.show(t("Calculating..."));
      return;
    }

    if (shouldOpenPurchaseModal) {
      openPurchaseModalWithContext();
      return;
    }

    persistAiModel(aiModel);
    hasSubmittedRef.current = true;
    void onSubmit({
      customPrompt: customPrompt || undefined,
      aiModel,
    });
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
      {open ? (
        <V4ModalShell
          open
          onClose={closeModal}
          size="small"
          title={modalTitle}
          primaryAction={{
            content: primaryLabel,
            onAction: handleSubmit,
            loading,
            disabled: quotaPrecheckPending,
          }}
          secondaryActions={[
            { content: t("Cancel"), onAction: closeModal, disabled: loading },
          ]}
        >

            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <div
                style={{
                  padding: "14px 16px",
                  borderRadius: 16,
                  border: `1px solid ${v4Colors.cardBorder}`,
                  background:
                    shortfallCredits && shortfallCredits > 0
                      ? "rgba(239, 68, 68, 0.06)"
                      : v4Colors.cardSubdued,
                }}
              >
                <Text strong style={{ display: "block", marginBottom: 12 }}>
                  {t("manage.singleTranslate.summaryTitle")}
                </Text>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                    gap: 12,
                  }}
                >
                  <StatItem
                    label={t("Estimated total")}
                    value={estimateLabel}
                    critical={false}
                  />
                  <StatItem
                    label={t("Available now")}
                    value={remainingLabel}
                    critical={false}
                  />
                  <StatItem
                    label={t("Need to top up")}
                    value={
                      shortfallCredits == null
                        ? t("Estimating...")
                        : `${shortfallCredits.toLocaleString()} ${t("credits")}`
                    }
                    critical={Boolean(shortfallCredits && shortfallCredits > 0)}
                  />
                </div>
              </div>

              <div>
                <Text strong style={{ display: "block", marginBottom: 8 }}>
                  {t("v4.createTask.aiModel")}
                </Text>
                <Select
                  style={{ width: "100%" }}
                  options={aiModelOptions}
                  value={aiModel}
                  onChange={setAiModel}
                  getPopupContainer={(node) => node.parentElement ?? document.body}
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
            </div>
        </V4ModalShell>
      ) : null}
    </>
  );
};

function StatItem({
  label,
  value,
  critical,
}: {
  label: string;
  value: string;
  critical: boolean;
}) {
  return (
    <div>
      <Text type="secondary" style={{ display: "block", fontSize: 12 }}>
        {label}
      </Text>
      <Text
        strong
        style={{
          display: "block",
          marginTop: 4,
          color: critical ? "#dc2626" : undefined,
        }}
      >
        {value}
      </Text>
    </div>
  );
}

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
