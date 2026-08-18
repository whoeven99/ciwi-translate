import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  ProgressBar,
  Icon,
  Box,
} from "@shopify/polaris";
import { CheckIcon } from "@shopify/polaris-icons";
import { useTranslation } from "react-i18next";
import type { OnboardingSummary } from "../types";

export type PreparingPhase =
  | "boot"
  | "locales"
  | "market"
  | "recommendation"
  | "done";

const PHASE_ORDER: PreparingPhase[] = [
  "boot",
  "locales",
  "market",
  "recommendation",
  "done",
];

const PHASE_ROWS: Array<{ key: string; doneAt: PreparingPhase }> = [
  { key: "onboarding.preparing.step.structure", doneAt: "locales" },
  { key: "onboarding.preparing.step.data", doneAt: "locales" },
  { key: "onboarding.preparing.step.market", doneAt: "market" },
  { key: "onboarding.preparing.step.recommendation", doneAt: "recommendation" },
];

function phaseReached(current: PreparingPhase, target: PreparingPhase): boolean {
  return PHASE_ORDER.indexOf(current) >= PHASE_ORDER.indexOf(target);
}

export function PreparingStep({
  summary,
  phase,
}: {
  summary: OnboardingSummary;
  phase: PreparingPhase;
}) {
  const { t } = useTranslation();

  const doneCount = PHASE_ROWS.filter((row) => phaseReached(phase, row.doneAt)).length;
  const progress = phase === "done" ? 100 : Math.round((doneCount / PHASE_ROWS.length) * 100);

  return (
    <Card>
      <BlockStack gap="500">
        <BlockStack gap="200">
          <Text as="h1" variant="headingLg">
            {t("onboarding.preparing.welcome")}
          </Text>
          <Text as="p" tone="subdued">
            {t("onboarding.preparing.subtitle")}
          </Text>
        </BlockStack>

        <ProgressBar progress={progress} size="small" tone="primary" />

        <BlockStack gap="200">
          {PHASE_ROWS.map((row) => {
            const done = phaseReached(phase, row.doneAt);
            return (
              <InlineStack key={row.key} gap="200" blockAlign="center">
                <Box minWidth="20px">
                  {done ? (
                    <Icon source={CheckIcon} tone="success" />
                  ) : (
                    <Text as="span" tone="subdued">
                      …
                    </Text>
                  )}
                </Box>
                <Text as="span" tone={done ? "base" : "subdued"}>
                  {t(row.key)}
                </Text>
              </InlineStack>
            );
          })}
        </BlockStack>

        <Text as="p" tone="subdued" variant="bodySm">
          {t("onboarding.preparing.hint", {
            count: summary.locales.suggestedTargets.length,
          })}
        </Text>
      </BlockStack>
    </Card>
  );
}
