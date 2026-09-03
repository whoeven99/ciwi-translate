import { useFetcher, useNavigate } from "@remix-run/react";
import { Modal, Space, Typography } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { v4CardStyle, v4Colors, v4ToneChip } from "../v4Styles";
import Button from "~/ui/components/AppButton";

const { Paragraph, Text, Title } = Typography;

type Props = {
  open: boolean;
  mode: "trial" | "pricing";
  onClose: () => void;
};

export function CreateTaskQuotaGateModal({ open, mode, onClose }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const planFetcher = useFetcher<{ success?: boolean; response?: { confirmationUrl?: string } }>();
  const [pendingAction, setPendingAction] = useState<"trial" | "subscribe" | null>(null);

  useEffect(() => {
    if (!planFetcher.data?.success) return;
    const confirmationUrl = planFetcher.data.response?.confirmationUrl;
    if (confirmationUrl) openUrl(confirmationUrl);
  }, [planFetcher.data]);

  useEffect(() => {
    if (planFetcher.state === "idle") {
      setPendingAction(null);
    }
  }, [planFetcher.state]);

  const submitBasicPlan = (trialDays: number, action: "trial" | "subscribe") => {
    setPendingAction(action);
    planFetcher.submit(
      {
        payForPlan: JSON.stringify({
          title: "Basic",
          monthlyPrice: 7.99,
          yearlyPrice: 6.39,
          yearly: false,
          trialDays,
        }),
      },
      { method: "POST", action: "/app/pricing" },
    );
  };

  const handlePrimaryAction = () => {
    if (mode === "trial") {
      submitBasicPlan(0, "subscribe");
      return;
    }

    onClose();
    navigate("/app/pricing");
  };

  const handleTrialAction = () => {
    submitBasicPlan(5, "trial");
  };

  const isTrial = mode === "trial";
  const trialHighlightKeys = [
    "v4.quotaGate.trialHighlight1",
    "v4.quotaGate.trialHighlight2",
    "v4.quotaGate.trialHighlight3",
    "v4.quotaGate.trialHighlight4",
  ] as const;
  const trialUnlockKeys = [
    "v4.quotaGate.trialUnlock1",
    "v4.quotaGate.trialUnlock2",
    "v4.quotaGate.trialUnlock3",
  ] as const;
  const pricingUnlockKeys = [
    "v4.quotaGate.pricingUnlock1",
    "v4.quotaGate.pricingUnlock2",
    "v4.quotaGate.pricingUnlock3",
  ] as const;
  const title = isTrial
    ? t("v4.quotaGate.trialTitle")
    : t("v4.quotaGate.pricingTitle");
  const description = isTrial ? null : t("v4.quotaGate.pricingDescription");
  const nextStepLabel = t("v4.quotaGate.upgradePlan");
  const nextStepDescription = t("v4.quotaGate.upgradePlanDescription");
  const unlockKeys = isTrial ? trialUnlockKeys : pricingUnlockKeys;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      centered
      width={560}
      destroyOnClose
      zIndex={10001}
      getContainer={() => document.body}
      styles={{
        content: {
          padding: 0,
          overflow: "hidden",
          borderRadius: 20,
          border: `1px solid ${v4Colors.cardBorder}`,
          background: v4Colors.cardBg,
          boxShadow: "var(--app-shadow-card-strong)",
        },
        body: {
          padding: 0,
        },
      }}
    >
      <div style={{ padding: "24px 24px 20px" }}>
        <div
          style={{
            paddingBottom: 20,
            marginBottom: 20,
            borderBottom: `1px solid ${v4Colors.divider}`,
          }}
        >
          <Text
            strong
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "4px 10px",
              borderRadius: 999,
              background: v4ToneChip.info.background,
              color: v4ToneChip.info.color,
              fontSize: 12,
              lineHeight: "20px",
              marginBottom: 12,
            }}
          >
            {t("v4.quotaGate.badge")}
          </Text>
          <Title level={3} style={{ margin: 0, lineHeight: 1.25, color: v4Colors.text }}>
            {title}
          </Title>
          {description ? (
            <Paragraph
              style={{
                marginTop: 12,
                marginBottom: 0,
                color: v4Colors.textMuted,
                fontSize: 14,
                lineHeight: "22px",
                maxWidth: 460,
              }}
            >
              {description}
            </Paragraph>
          ) : null}
        </div>

        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          {isTrial ? (
            <div
              style={{
                ...v4CardStyle,
                background: v4Colors.summaryBg,
                padding: "16px 18px",
                borderRadius: 16,
              }}
            >
              <Space direction="vertical" size={8} style={{ width: "100%" }}>
                {trialHighlightKeys.map((key) => (
                  <div key={key} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <span
                      aria-hidden
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: v4Colors.primary,
                        marginTop: 7,
                        flexShrink: 0,
                      }}
                    />
                    <Text style={{ color: v4Colors.text, lineHeight: "22px" }}>{t(key)}</Text>
                  </div>
                ))}
              </Space>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 12,
              }}
            >
              <div
                style={{
                  ...v4CardStyle,
                  background: v4Colors.summaryBg,
                  padding: "16px 18px",
                  borderRadius: 16,
                }}
              >
                <Text
                  style={{
                    display: "block",
                    fontSize: 12,
                    fontWeight: 600,
                    color: v4Colors.textMuted,
                    marginBottom: 8,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  {t("v4.quotaGate.nextStep")}
                </Text>
                <Text
                  strong
                  style={{
                    display: "block",
                    fontSize: 16,
                    color: v4Colors.text,
                    marginBottom: 8,
                    lineHeight: 1.4,
                  }}
                >
                  {nextStepLabel}
                </Text>
                <Text style={{ color: v4Colors.textMuted, lineHeight: "22px" }}>
                  {nextStepDescription}
                </Text>
              </div>

              <div
                style={{
                  ...v4CardStyle,
                  background: v4Colors.cardSubdued,
                  padding: "16px 18px",
                  borderRadius: 16,
                }}
              >
                <Text
                  style={{
                    display: "block",
                    fontSize: 12,
                    fontWeight: 600,
                    color: v4Colors.textMuted,
                    marginBottom: 10,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  {t("v4.quotaGate.includedAfterUpgrade")}
                </Text>
                <Space direction="vertical" size={8} style={{ width: "100%" }}>
                  {unlockKeys.map((key) => (
                    <div key={key} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <span
                        aria-hidden
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: v4Colors.primary,
                          marginTop: 7,
                          flexShrink: 0,
                        }}
                      />
                      <Text style={{ color: v4Colors.text, lineHeight: "22px" }}>{t(key)}</Text>
                    </div>
                  ))}
                </Space>
              </div>
            </div>
          )}

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 12,
              flexWrap: "wrap",
              paddingTop: 4,
            }}
          >
            {isTrial ? (
              <Button
                onClick={handleTrialAction}
                loading={pendingAction === "trial" && planFetcher.state === "submitting"}
                style={{
                  minWidth: 220,
                  height: "auto",
                  paddingBlock: 8,
                  borderColor: v4Colors.cardBorder,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    lineHeight: 1.25,
                  }}
                >
                  <Text strong style={{ color: "inherit" }}>
                    {t("v4.quotaGate.freeTrial")}
                  </Text>
                  <Text style={{ color: "inherit", opacity: 0.72, fontSize: 12 }}>
                    {t("v4.quotaGate.chargedAfter5Days")}
                  </Text>
                </div>
              </Button>
            ) : (
              <Button
                onClick={onClose}
                style={{
                  minWidth: 108,
                  borderColor: v4Colors.cardBorder,
                }}
              >
                {t("v4.quotaGate.maybeLater")}
              </Button>
            )}
            {!isTrial ? (
              <Button
                type="primary"
                onClick={handlePrimaryAction}
                loading={pendingAction === "subscribe" && planFetcher.state === "submitting"}
                style={{ minWidth: 140 }}
              >
                {t("v4.quotaGate.viewPlans")}
              </Button>
            ) : null}
          </div>
        </Space>
      </div>
    </Modal>
  );
}

function openUrl(url: string) {
  open(url, "_top");
}
