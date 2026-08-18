import {
  Badge,
  BlockStack,
  Box,
  Card,
  Divider,
  InlineStack,
  Text,
} from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import type { OnboardingSummary } from "../types";

function LabeledCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">
          {title}
        </Text>
        <Divider />
        {children}
      </BlockStack>
    </Card>
  );
}

type MarketRow = {
  key: string;
  marketName: string;
  marketLocales: string[];
  matchedLocales: string[];
  missingLocales: string[];
  status: "matched" | "partial" | "missing" | "unknown";
};

function localeMatches(configuredLocale: string, marketLocale: string) {
  const configured = configuredLocale.trim().toLowerCase();
  const market = marketLocale.trim().toLowerCase();
  if (configured === market) return true;
  return configured.split(/[-_]/)[0] === market.split(/[-_]/)[0];
}

function buildMarketRows(summary: OnboardingSummary): MarketRow[] {
  const configuredLocales = summary.locales.availableTargets.map((item) => item.value);

  return summary.markets.map((market, index) => {
    const marketLocales = [...new Set(market.locales)].filter(Boolean);
    const matchedLocales = configuredLocales.filter((configuredLocale) =>
      marketLocales.some((marketLocale) => localeMatches(configuredLocale, marketLocale)),
    );
    const missingLocales = marketLocales.filter(
      (marketLocale) =>
        !configuredLocales.some((configuredLocale) =>
          localeMatches(configuredLocale, marketLocale),
        ),
    );

    let status: MarketRow["status"] = "unknown";
    if (marketLocales.length === 0) status = "unknown";
    else if (matchedLocales.length === 0) status = "missing";
    else if (missingLocales.length === 0) status = "matched";
    else status = "partial";

    return {
      key: market.handle || `${market.name}-${index}`,
      marketName: market.name,
      marketLocales,
      matchedLocales,
      missingLocales,
      status,
    };
  });
}

function statusTone(status: MarketRow["status"]) {
  switch (status) {
    case "matched":
      return "success" as const;
    case "partial":
      return "attention" as const;
    case "missing":
      return "attention" as const;
    default:
      return "info" as const;
  }
}

function MarketLocaleBadges({
  locales,
  labelByLocale,
  tone = "info",
  emptyLabel,
}: {
  locales: string[];
  labelByLocale: Map<string, string>;
  tone?: "info" | "success" | "attention";
  emptyLabel?: string;
}) {
  const { t } = useTranslation();

  if (locales.length === 0) {
    return (
      <Text as="span" tone="subdued" variant="bodySm">
        {emptyLabel ?? t("onboarding.health.none")}
      </Text>
    );
  }

  return (
    <InlineStack gap="150" wrap>
      {locales.map((locale) => (
        <Badge key={locale} tone={tone}>
          {labelByLocale.get(locale) ?? locale}
        </Badge>
      ))}
    </InlineStack>
  );
}

export function RecommendationStep({ summary }: { summary: OnboardingSummary }) {
  const { t } = useTranslation();
  const rows = buildMarketRows(summary);
  const labelByLocale = new Map(
    summary.locales.availableTargets.map((item) => [item.value, item.label] as const),
  );

  return (
    <LabeledCard title={t("onboarding.health.title")}>
      {rows.length === 0 ? (
        <BlockStack gap="300">
          <Box>
            <Text as="p" tone="subdued">
              {t("onboarding.health.noMarkets")}
            </Text>
          </Box>
          <Box>
            <Text as="p" tone="subdued" variant="bodySm">
              {t("onboarding.health.configuredLanguages")}
            </Text>
            <Box paddingBlockStart="200">
              <MarketLocaleBadges
                locales={summary.locales.availableTargets.map((item) => item.value)}
                labelByLocale={labelByLocale}
                emptyLabel={t("onboarding.languages.empty")}
              />
            </Box>
          </Box>
        </BlockStack>
      ) : (
        <BlockStack gap="300">
          <div
            style={{
              border: "1px solid rgba(138, 142, 145, 0.18)",
              borderRadius: "12px",
              overflow: "hidden",
              background: "#ffffff",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "minmax(180px, 1fr) minmax(240px, 1.2fr) minmax(240px, 1.2fr) minmax(120px, 0.7fr)",
                gap: "12px",
                padding: "12px 16px",
                background: "rgba(246, 246, 247, 0.95)",
                borderBottom: "1px solid rgba(138, 142, 145, 0.18)",
              }}
            >
              <Text as="span" variant="bodySm" tone="subdued">
                {t("onboarding.health.column.market")}
              </Text>
              <Text as="span" variant="bodySm" tone="subdued">
                {t("onboarding.health.column.marketLocales")}
              </Text>
              <Text as="span" variant="bodySm" tone="subdued">
                {t("onboarding.health.column.configuredLocales")}
              </Text>
              <Text as="span" variant="bodySm" tone="subdued">
                {t("onboarding.health.column.status")}
              </Text>
            </div>

            {rows.map((row, index) => (
              <div
                key={row.key}
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "minmax(180px, 1fr) minmax(240px, 1.2fr) minmax(240px, 1.2fr) minmax(120px, 0.7fr)",
                  gap: "12px",
                  padding: "16px",
                  background: "#ffffff",
                  borderBottom:
                    index === rows.length - 1
                      ? "none"
                      : "1px solid rgba(138, 142, 145, 0.14)",
                }}
              >
                <BlockStack gap="100">
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {row.marketName}
                  </Text>
                  {row.marketLocales.length > 0 ? (
                    <Text as="span" tone="subdued" variant="bodySm">
                      {`${row.marketLocales.length} ${t("onboarding.health.localeCount")}`}
                    </Text>
                  ) : null}
                </BlockStack>

                <MarketLocaleBadges
                  locales={row.marketLocales}
                  labelByLocale={labelByLocale}
                  emptyLabel={t("onboarding.health.unknownLocales")}
                />

                <BlockStack gap="150">
                  <MarketLocaleBadges
                    locales={row.matchedLocales}
                    labelByLocale={labelByLocale}
                    tone="success"
                  />
                  {row.missingLocales.length > 0 ? (
                    <MarketLocaleBadges
                      locales={row.missingLocales}
                      labelByLocale={labelByLocale}
                      tone="attention"
                    />
                  ) : null}
                </BlockStack>

                <InlineStack align="start">
                  <Badge tone={statusTone(row.status)}>
                    {t(`onboarding.health.status.${row.status}`)}
                  </Badge>
                </InlineStack>
              </div>
            ))}
          </div>
        </BlockStack>
      )}
    </LabeledCard>
  );
}
