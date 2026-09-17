import {
  InlineStack,
  Link as PolarisLink,
  Text as PolarisText,
} from "@shopify/polaris";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "@remix-run/react";
import { useTranslation } from "react-i18next";
import { handleContactSupport } from "~/utils/supportChat";
import { useSelector } from "react-redux";
import useReport from "../../scripts/eventReport";
import "./styles.css";
import { v4Colors } from "~/routes/app.translate-v4/v4Styles";
import { AppSModal } from "~/ui/components/AppSModal";
import { InFlowSelect } from "~/ui/components/InFlowSelect";
import { buildPaymentOptions, type OptionType } from "./paymentModal.shared";
import { buildBillingReturnPath } from "~/utils/billingReturn";
import type { CreditsPurchaseModalContext } from "~/utils/creditsPurchaseModal";
import { redirectToBillingConfirmation } from "~/utils/billingConfirmation.client";
import { saveResumeTaskDraft } from "~/utils/resumeTaskDraft";
import { message } from "~/ui/message";

interface PaymentModalProps {
  visible: boolean;
  setVisible: (visible: boolean) => void;
  variant?: "default" | "v4";
  purchaseContext?: CreditsPurchaseModalContext | null;
}
const PaymentModal: React.FC<PaymentModalProps> = ({
  visible,
  setVisible,
  variant = "default",
  purchaseContext = null,
}) => {
  const [selectedKey, setSelectedKey] = useState<string>("option-100k");
  const [buyButtonLoading, setBuyButtonLoading] = useState<boolean>(false);
  const paySubmittingRef = useRef(false);
  const payRedirectedRef = useRef(false);
  const { t } = useTranslation();
  const payFetcher = useFetcher<{
    success?: boolean;
    errorMsg?: string;
    response?: { confirmationUrl?: string };
  }>();
  const { reportClick } = useReport();
  const { plan, totalChars, shop } = useSelector((state: any) => state.userConfig);
  void variant;

  const options: OptionType[] = useMemo(() => buildPaymentOptions(plan), [plan]);

  const selectedOption = useMemo(() => {
    return options.find((item) => item.key == selectedKey) || options[0];
  }, [selectedKey, options]);
  const recommendedCreditsTarget = useMemo(() => {
    if (!purchaseContext) return null;

    const shortfall =
      "shortfallCredits" in purchaseContext
        ? purchaseContext.shortfallCredits ?? 0
        : 0;
    if (shortfall > 0) return shortfall;

    return null;
  }, [purchaseContext]);
  const recommendedOption = useMemo(() => {
    if (recommendedCreditsTarget == null || recommendedCreditsTarget <= 0) {
      return options[0] ?? null;
    }
    return (
      options.find((option) => option.Credits >= recommendedCreditsTarget) ??
      options[options.length - 1] ??
      null
    );
  }, [options, recommendedCreditsTarget]);

  const selectOptions = useMemo(
    () =>
      options.map((option) => ({
        label: `${option.name} · ${Number(option.Credits).toLocaleString()} ${t("credits")}`,
        value: option.key,
      })),
    [options, t],
  );

  useEffect(() => {
    const confirmationUrl = payFetcher.data?.response?.confirmationUrl;
    if (
      payFetcher.data?.success &&
      confirmationUrl &&
      !payRedirectedRef.current
    ) {
      payRedirectedRef.current = true;
      redirectToBillingConfirmation(confirmationUrl);
    }

    if (payFetcher.state === "submitting" || payFetcher.state === "loading") {
      return;
    }
    if (payFetcher.state !== "idle" || !paySubmittingRef.current) return;

    paySubmittingRef.current = false;
    setBuyButtonLoading(false);

    if (!payFetcher.data) return;

    if (payFetcher.data.success && confirmationUrl) {
      return;
    }

    message.error(
      payFetcher.data.errorMsg ??
        t("Something went wrong. Please try again later."),
    );
  }, [payFetcher.state, payFetcher.data, t]);

  useEffect(() => {
    if (!visible) return;
    if (!recommendedOption?.key) return;
    setSelectedKey(recommendedOption.key);
  }, [visible, recommendedOption]);

  const taskContext =
    purchaseContext?.kind === "translate_v4_task" ? purchaseContext : null;
  const createTaskContext =
    purchaseContext?.kind === "create_task" ? purchaseContext : null;
  const singleTranslateContext =
    purchaseContext?.kind === "single_translate" ? purchaseContext : null;

  const onClick = () => {
    setBuyButtonLoading(true);
    paySubmittingRef.current = true;
    payRedirectedRef.current = false;
    if (taskContext?.taskId && typeof shop === "string" && shop.trim()) {
      saveResumeTaskDraft(shop, taskContext.taskId);
    }
    const payInfo = {
      name: selectedOption?.name,
      price: {
        amount: selectedOption?.price.currentPrice,
        currencyCode: selectedOption?.price.currencyCode,
      },
    };
    const formData = new FormData();
    formData.append("payInfo", JSON.stringify(payInfo));
    if (typeof window !== "undefined") {
      const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      formData.append(
        "returnPath",
        buildBillingReturnPath(currentPath, {
          kind: "credits",
          previousTotalChars:
            typeof totalChars === "number" ? totalChars : undefined,
        }),
      );
    }
    payFetcher.submit(formData, {
      method: "post",
      action: "/app/pricing",
    });
    reportClick("dashboard_translation_task_buy");
  };

  const onCancel = () => {
    setVisible(false);
    // if (recommendOption) setSelectedOption(recommendOption);
  };

  const ctaLabel = taskContext || singleTranslateContext || createTaskContext
    ? t("paymentModal.cta.continue", {
        defaultValue: "Add credits and continue",
      })
    : t("Buy now");
  const heading = taskContext
    ? t("paymentModal.heading.task", {
        defaultValue: "Add credits to continue this task",
      })
    : singleTranslateContext
      ? t("paymentModal.heading.singleTranslate", {
          defaultValue: "Add credits to continue this field",
        })
      : createTaskContext
        ? t("paymentModal.heading.createTask", {
            defaultValue: "Add credits to continue creating this task",
          })
        : t("Buy credits");
  const headingDescription = taskContext
    ? t("paymentModal.description.task", {
        defaultValue:
          "This task is ready to continue. Review the shortfall and choose a pack.",
      })
    : singleTranslateContext
      ? t("paymentModal.description.singleTranslate", {
          defaultValue:
            "Your current field settings are ready. Review the shortfall and choose a pack.",
        })
      : createTaskContext
        ? t("paymentModal.description.createTask", {
            defaultValue:
              "Your current task setup is ready. Review the shortfall and choose a pack.",
          })
        : t("Choose a pack for this task.");

  return (
    <AppSModal
      open={visible}
      heading={heading}
      onClose={onCancel}
      size="base"
      primaryAction={{
        content: ctaLabel,
        onAction: onClick,
        disabled: buyButtonLoading || !selectedKey,
        loading: buyButtonLoading,
      }}
      secondaryActions={[
        {
          content: t("v4.quotaGate.maybeLater"),
          onAction: onCancel,
        },
      ]}
    >
      <div>
        <div style={{ marginBottom: 18 }}>
          <PolarisText as="p" variant="bodyMd" tone="subdued">
            {headingDescription}
          </PolarisText>
        </div>

        {taskContext ? (
          <div
            style={{
              marginBottom: 18,
              padding: "14px 16px",
              borderRadius: 14,
              border: `1px solid ${v4Colors.cardBorder}`,
              background: v4Colors.cardSubdued,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
                marginBottom: 12,
              }}
            >
              <PolarisText as="p" variant="bodyMd" fontWeight="semibold">
                {`${taskContext.source.toUpperCase()} -> ${taskContext.target.toUpperCase()}`}
              </PolarisText>
              <PolarisText as="p" variant="bodySm" tone="subdued">
                {`#${taskContext.taskId.split("-")[0] ?? taskContext.taskId.slice(0, 8)}`}
              </PolarisText>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                gap: 12,
              }}
            >
              <TaskStat
                label={t("Estimated remaining")}
                value={formatCreditsValue(taskContext.estimatedRemainingCredits, t)}
              />
              <TaskStat
                label={t("Available now")}
                value={formatCreditsValue(taskContext.currentRemainingCredits, t)}
              />
              <TaskStat
                label={t("Need to top up")}
                value={formatCreditsValue(taskContext.shortfallCredits, t)}
              />
            </div>
            {recommendedOption ? (
              <div style={{ marginTop: 12 }}>
                <PolarisText as="p" variant="bodySm" tone="subdued">
                  {t("Recommended pack")}:{" "}
                  <strong style={{ color: v4Colors.text }}>
                    {recommendedOption.name} ·{" "}
                    {Number(recommendedOption.Credits).toLocaleString()} {t("credits")}
                  </strong>
                </PolarisText>
              </div>
            ) : null}
          </div>
        ) : null}

        {singleTranslateContext ? (
          <div
            style={{
              marginBottom: 18,
              padding: "14px 16px",
              borderRadius: 14,
              border: `1px solid ${v4Colors.cardBorder}`,
              background: v4Colors.cardSubdued,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
                marginBottom: 12,
              }}
            >
              <div>
                <PolarisText as="p" variant="bodyMd" fontWeight="semibold">
                  {t("Single field translation")}
                </PolarisText>
                <div style={{ marginTop: 4 }}>
                  <PolarisText as="p" variant="bodySm" tone="subdued">
                    {singleTranslateContext.target.toUpperCase()} ·{" "}
                    {formatSingleTranslateState(singleTranslateContext.state, t)}
                  </PolarisText>
                </div>
              </div>
              <PolarisText as="p" variant="bodySm" tone="subdued">
                {singleTranslateContext.fieldKey}
              </PolarisText>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                gap: 12,
              }}
            >
              <TaskStat
                label={t("Estimated total")}
                value={formatCreditsValue(singleTranslateContext.estimatedCredits, t)}
              />
              <TaskStat
                label={t("Available now")}
                value={formatCreditsValue(
                  singleTranslateContext.currentRemainingCredits,
                  t,
                )}
              />
              <TaskStat
                label={t("Need to top up")}
                value={formatCreditsValue(singleTranslateContext.shortfallCredits, t)}
              />
            </div>
            {recommendedOption ? (
              <div style={{ marginTop: 12 }}>
                <PolarisText as="p" variant="bodySm" tone="subdued">
                  {t("Recommended pack")}:{" "}
                  <strong style={{ color: v4Colors.text }}>
                    {recommendedOption.name} ·{" "}
                    {Number(recommendedOption.Credits).toLocaleString()} {t("credits")}
                  </strong>
                </PolarisText>
              </div>
            ) : null}
          </div>
        ) : null}

        {createTaskContext ? (
          <div
            style={{
              marginBottom: 18,
              padding: "14px 16px",
              borderRadius: 14,
              border: `1px solid ${v4Colors.cardBorder}`,
              background: v4Colors.cardSubdued,
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))",
                gap: 12,
              }}
            >
              <TaskStat
                label={t("Targets")}
                value={String(createTaskContext.targetsCount)}
              />
              <TaskStat
                label={t("Modules")}
                value={String(createTaskContext.modulesCount)}
              />
              <TaskStat
                label={t("Estimated total")}
                value={formatCreditsValue(createTaskContext.estimatedCredits, t)}
              />
              <TaskStat
                label={t("Available now")}
                value={formatCreditsValue(
                  createTaskContext.currentRemainingCredits,
                  t,
                )}
              />
              <TaskStat
                label={t("Need to top up")}
                value={formatCreditsValue(createTaskContext.shortfallCredits, t)}
              />
            </div>
            {recommendedOption ? (
              <div style={{ marginTop: 12 }}>
                <PolarisText as="p" variant="bodySm" tone="subdued">
                  {t("Recommended pack")}:{" "}
                  <strong style={{ color: v4Colors.text }}>
                    {recommendedOption.name} ·{" "}
                    {Number(recommendedOption.Credits).toLocaleString()} {t("credits")}
                  </strong>
                </PolarisText>
              </div>
            ) : null}
          </div>
        ) : null}

        <div style={{ marginBottom: 24 }}>
          <InFlowSelect
            label={t("Credit pack")}
            labelHidden
            options={selectOptions}
            value={selectedKey}
            onChange={setSelectedKey}
          />
          <div
            style={{
              marginTop: 14,
              padding: "14px 16px",
              borderRadius: 14,
              border: `1px solid ${v4Colors.cardBorder}`,
              background: v4Colors.cardBg,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 16,
                flexWrap: "wrap",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <PolarisText as="p" variant="bodySm" tone="subdued">
                  {t("Credits")}
                </PolarisText>
                <div style={{ marginTop: 4 }}>
                  <PolarisText as="p" variant="headingMd" fontWeight="bold">
                    {selectedOption?.name}
                  </PolarisText>
                </div>
                <div style={{ marginTop: 4 }}>
                  <PolarisText as="p" variant="bodyMd" tone="subdued">
                    {Number(selectedOption?.Credits ?? 0).toLocaleString()} {t("credits")}
                  </PolarisText>
                </div>
              </div>
              <div style={{ minWidth: 0, textAlign: "right" }}>
                <PolarisText as="p" variant="bodySm" tone="subdued">
                  {t("Total Payment:")}
                </PolarisText>
                <div style={{ marginTop: 4 }}>
                  <PolarisText as="p" variant="headingMd" fontWeight="bold">
                    ${selectedOption?.price.currentPrice.toFixed(2) ?? "0.00"}
                  </PolarisText>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 8 }}>
          <InlineStack gap="100" align="center">
            <PolarisText as="span" variant="bodyMd" tone="subdued">
              {t("Need help?")}
            </PolarisText>
            <PolarisLink onClick={handleContactSupport}>{t("Contact us")}</PolarisLink>
          </InlineStack>
        </div>
      </div>
    </AppSModal>
  );
};

function TaskStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <PolarisText as="p" variant="bodySm" tone="subdued">
        {label}
      </PolarisText>
      <div style={{ marginTop: 4 }}>
        <PolarisText as="p" variant="headingMd" fontWeight="bold">
          {value}
        </PolarisText>
      </div>
    </div>
  );
}

function formatCreditsValue(
  value: number | null,
  t: (key: string) => string,
): string {
  if (value == null) return t("Estimating...");
  return `${Number(value).toLocaleString()} ${t("credits")}`;
}

function formatSingleTranslateState(
  state: "missing" | "quality" | "outdated",
  t: (key: string) => string,
): string {
  if (state === "missing") return t("Missing translation");
  if (state === "outdated") return t("Source changed");
  return t("Needs improvement");
}

export default PaymentModal;
export type { OptionType } from "./paymentModal.shared";
