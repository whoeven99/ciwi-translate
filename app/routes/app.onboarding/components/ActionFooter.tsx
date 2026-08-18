import { Card, BlockStack, InlineStack, Button, Text } from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import type { OnboardingSummary } from "../types";
import { formatEstimateCredits } from "~/routes/app.translate-v4/useCreateTaskEstimate";

export type PrimaryCtaKind = "create" | "trial" | "upgrade" | "configure";

const PRIMARY_LABEL_KEY: Record<PrimaryCtaKind, string> = {
  create: "onboarding.action.createTask",
  trial: "onboarding.action.startTrial",
  upgrade: "onboarding.action.upgrade",
  configure: "onboarding.action.configureLanguages",
};

export function ActionFooter({
  summary,
  primaryCta,
  creating,
  onPrimary,
  onCustomize,
  onSkip,
}: {
  summary: OnboardingSummary;
  primaryCta: PrimaryCtaKind;
  creating: boolean;
  onPrimary: () => void;
  onCustomize: () => void;
  onSkip: () => void;
}) {
  const { t } = useTranslation();
  const contextKey = `onboarding.action.context.${primaryCta}`;
  const estimateCredits =
    summary.estimate?.credits != null
      ? formatEstimateCredits(summary.estimate.credits)
      : null;

  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="100">
          <Text as="h2" variant="headingMd">
            {t("onboarding.action.title")}
          </Text>
          <Text as="p" tone="subdued">
            {t(contextKey)}
          </Text>
        </BlockStack>

        <InlineStack gap="200" wrap>
          <Text as="span" tone="subdued" variant="bodySm">
            {t("onboarding.action.scope", {
              count: summary.locales.suggestedTargets.length,
            })}
          </Text>
          {estimateCredits ? (
            <Text as="span" tone="subdued" variant="bodySm">
              {t("onboarding.action.scopeCredits", {
                credits: estimateCredits,
              })}
            </Text>
          ) : null}
        </InlineStack>

        <InlineStack gap="300" align="space-between" blockAlign="center" wrap>
          <Button
            variant="primary"
            size="large"
            loading={creating && primaryCta === "create"}
            onClick={onPrimary}
          >
            {t(PRIMARY_LABEL_KEY[primaryCta])}
          </Button>
          <InlineStack gap="200">
            <Button variant="tertiary" onClick={onCustomize}>
              {t("onboarding.action.customize")}
            </Button>
            <Button variant="plain" onClick={onSkip}>
              {t("onboarding.action.skip")}
            </Button>
          </InlineStack>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
