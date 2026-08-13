import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate, useSearchParams } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import {
  Badge,
  BlockStack,
  Button,
  Card,
  Checkbox,
  InlineStack,
  Page,
  Select,
  Text,
} from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import { message } from "~/ui/message";
import { authenticate } from "~/shopify.server";
import { loadShopLocalesForTranslation } from "~/server/translateV4/shopLocales.server";
import type { CoverageSummary } from "~/server/translateV4/coverage.server";
import {
  AI_MODEL_OPTIONS,
  DEFAULT_AI_MODEL,
  DEFAULT_MODULE_KEYS,
} from "~/routes/app.translate-v4/constants";
import {
  buildUntranslatedRatioByLocale,
  formatEstimateCredits,
  useCreateTaskEstimate,
} from "~/routes/app.translate-v4/useCreateTaskEstimate";
import {
  formatV4CreateTasksMessage,
  getV4AiModelLabel,
  getV4ModuleLabel,
} from "~/routes/app.translate-v4/v4I18n";
import {
  formatCredits,
  localeRegionCode,
  localeShortName,
} from "~/routes/app.translate-v4/localeDisplay";
import {
  createTranslateV4Tasks,
  type ShopLocaleOption,
} from "~/lib/createTranslateV4Tasks";
import { normalizeShopQuota, type ShopQuota } from "~/lib/translationQuota";

const EMPTY_COVERAGE: CoverageSummary = {
  languageCount: 0,
  translatedItems: 0,
  totalItems: 0,
  overallPercent: null,
  locales: [],
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  let locales: ShopLocaleOption[] = [];
  let primaryLocale = "en";

  try {
    const loaded = await loadShopLocalesForTranslation({
      shop: session.shop,
      accessToken: session.accessToken as string,
    });
    locales = loaded.localeOptions;
    primaryLocale = loaded.primaryLocale;
  } catch (err) {
    console.error("[translate-v4-mvp-custom] load locales failed:", err);
  }

  return json({
    shop: session.shop,
    locales,
    primaryLocale,
  });
};

async function readJsonResponse<T = unknown>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(`Empty response body (${res.status})`);
  }
  return JSON.parse(text) as T;
}

function formatDateTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function latestAutoScanAt(locales: CoverageSummary["locales"]): string | null {
  const timestamps = locales
    .map((row) => row.lastAutoUpdateAt)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));
  if (!timestamps.length) return null;
  return new Date(Math.max(...timestamps)).toISOString();
}

function estimateTimeLabel(workload: number, t: ReturnType<typeof useTranslation>["t"]) {
  if (workload <= 200) return t("v4Mvp.time.fast");
  if (workload <= 1_000) return t("v4Mvp.time.medium");
  if (workload <= 4_000) return t("v4Mvp.time.long");
  return t("v4Mvp.time.xlong");
}

function parseListParam(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBooleanParam(value: string | null): boolean {
  return value === "1" || value === "true";
}

export default function TranslateV4MvpCustomRoute() {
  const { t } = useTranslation();
  const { shop, locales, primaryLocale } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const targetOptions = useMemo(
    () =>
      locales.filter((locale) => locale.value !== primaryLocale) as ShopLocaleOption[],
    [locales, primaryLocale],
  );

  const validTargets = useMemo(
    () => new Set(targetOptions.map((option) => option.value)),
    [targetOptions],
  );
  const validModules = useMemo(() => new Set(DEFAULT_MODULE_KEYS), []);

  const initialTargets = useMemo(() => {
    const parsed = parseListParam(searchParams.get("targets")).filter((item) =>
      validTargets.has(item),
    );
    return parsed.length > 0 ? parsed : targetOptions.map((item) => item.value);
  }, [searchParams, targetOptions, validTargets]);

  const initialModules = useMemo(() => {
    const parsed = parseListParam(searchParams.get("modules")).filter((item) =>
      validModules.has(item),
    );
    return parsed.length > 0 ? parsed : DEFAULT_MODULE_KEYS;
  }, [searchParams, validModules]);

  const initialAiModel = useMemo(() => {
    const value = searchParams.get("aiModel");
    if (value && AI_MODEL_OPTIONS.some((item) => item.value === value)) {
      return value;
    }
    return DEFAULT_AI_MODEL;
  }, [searchParams]);

  const [coverage, setCoverage] = useState<CoverageSummary>(EMPTY_COVERAGE);
  const [coverageLoading, setCoverageLoading] = useState(true);
  const [quota, setQuota] = useState<ShopQuota | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const [targets, setTargets] = useState<string[]>(initialTargets);
  const [modules, setModules] = useState<string[]>(initialModules);
  const [aiModel, setAiModel] = useState<string>(initialAiModel);
  const [isCover, setIsCover] = useState(parseBooleanParam(searchParams.get("isCover")));
  const [isHandle, setIsHandle] = useState(parseBooleanParam(searchParams.get("isHandle")));
  const [includeLiquid, setIncludeLiquid] = useState(
    parseBooleanParam(searchParams.get("includeLiquid")),
  );

  const normalizedQuota = useMemo(() => normalizeShopQuota(quota), [quota]);
  const untranslatedRatioByLocale = useMemo(
    () => buildUntranslatedRatioByLocale(coverage.locales),
    [coverage.locales],
  );

  const taskEstimate = useCreateTaskEstimate({
    modules,
    targets,
    isCover,
    includeLiquid,
    untranslatedRatioByLocale,
    remainingCredits: normalizedQuota?.remaining ?? null,
  });

  const aiModelOptions = useMemo(
    () =>
      AI_MODEL_OPTIONS.map((option) => ({
        ...option,
        label: getV4AiModelLabel(option.value, t),
      })),
    [t],
  );

  const refreshCoverage = useCallback(async () => {
    setCoverageLoading(true);
    try {
      const res = await fetch(
        `/api/translate-v4/coverage?shopName=${encodeURIComponent(shop)}&cache=1`,
      );
      const data = await readJsonResponse<{ ok?: boolean; summary?: CoverageSummary }>(res);
      if (data.ok && data.summary) {
        setCoverage(data.summary);
      }
    } catch (err) {
      console.error("[translate-v4-mvp-custom] refresh coverage failed:", err);
      message.error(t("v4.actionFailedRetry"));
    } finally {
      setCoverageLoading(false);
    }
  }, [shop, t]);

  const refreshQuota = useCallback(async () => {
    setQuotaLoading(true);
    try {
      const res = await fetch(
        `/api/translate-v4/quota?shopName=${encodeURIComponent(shop)}`,
      );
      const data = await readJsonResponse<{ ok?: boolean; quota?: ShopQuota | null }>(res);
      if (data.ok) {
        setQuota(normalizeShopQuota(data.quota ?? null));
      }
    } catch (err) {
      console.error("[translate-v4-mvp-custom] refresh quota failed:", err);
    } finally {
      setQuotaLoading(false);
    }
  }, [shop]);

  useEffect(() => {
    void Promise.all([refreshCoverage(), refreshQuota()]);
  }, [refreshCoverage, refreshQuota]);

  const handleToggleTargets = (value: string) => {
    setTargets((prev) =>
      prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value],
    );
  };

  const handleToggleModules = (value: string) => {
    setModules((prev) =>
      prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value],
    );
  };

  const handleReset = () => {
    setTargets(targetOptions.map((item) => item.value));
    setModules(DEFAULT_MODULE_KEYS);
    setAiModel(DEFAULT_AI_MODEL);
    setIsCover(false);
    setIsHandle(false);
    setIncludeLiquid(false);
  };

  const handleCreate = useCallback(async () => {
    setCreating(true);
    try {
      const result = await createTranslateV4Tasks({
        source: primaryLocale,
        targets,
        modules,
        aiModel,
        isCover,
        isHandle,
        includeLiquid,
        targetOptions,
        shop,
      });

      const resultMessage = formatV4CreateTasksMessage(result, t, localeRegionCode);
      if (result.created.length > 0) {
        message.success(resultMessage);
        navigate("/app/translate-v4-mvp?tab=queue");
      } else {
        message.error(resultMessage);
      }
    } catch (err) {
      console.error("[translate-v4-mvp-custom] create tasks failed:", err);
      message.error(t("v4.createFailedRetry"));
    } finally {
      setCreating(false);
    }
  }, [
    aiModel,
    includeLiquid,
    isCover,
    isHandle,
    modules,
    navigate,
    primaryLocale,
    shop,
    t,
    targetOptions,
    targets,
  ]);

  const displayedLastScan = latestAutoScanAt(coverage.locales);
  const selectedModuleCount = modules.length + (includeLiquid ? 1 : 0);

  return (
    <Page
      backAction={{ content: t("v4Mvp.customPage.back"), onAction: () => navigate("/app/translate-v4-mvp") }}
    >
      <TitleBar title={t("v4Mvp.customPage.title")} />
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="start">
              <BlockStack gap="100">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="h1" variant="headingLg">
                    {t("v4Mvp.customPage.title")}
                  </Text>
                  <Badge tone="info">{t("v4Mvp.previewBadge")}</Badge>
                </InlineStack>
                <Text as="p" tone="subdued">
                  {t("v4Mvp.customPage.subtitle")}
                </Text>
              </BlockStack>
              <InlineStack gap="200">
                <Button onClick={handleReset}>{t("v4Mvp.custom.reset")}</Button>
                <Button
                  variant="primary"
                  onClick={() => void handleCreate()}
                  loading={creating}
                  disabled={targets.length === 0 || (modules.length === 0 && !includeLiquid)}
                >
                  {t("v4Mvp.customPage.submit")}
                </Button>
              </InlineStack>
            </InlineStack>

            <div style={summaryGridStyle}>
              <SummaryItem
                label={t("v4Mvp.custom.selectedTargets")}
                value={String(targets.length)}
              />
              <SummaryItem
                label={t("v4Mvp.custom.selectedModules")}
                value={String(selectedModuleCount)}
              />
              <SummaryItem
                label={t("v4.createTask.confirmCreditsRequired")}
                value={
                  taskEstimate.loading
                    ? "…"
                    : taskEstimate.estimatedCredits != null
                      ? formatEstimateCredits(taskEstimate.estimatedCredits)
                      : "—"
                }
              />
              <SummaryItem
                label={t("v4Mvp.recommended.estimateTime")}
                value={estimateTimeLabel(
                  Math.max(targets.length, 1) * Math.max(modules.length, 1) * 120,
                  t,
                )}
              />
            </div>
          </BlockStack>
        </Card>

        <div style={twoColumnStyle}>
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  {t("v4.createTask.targetLanguages")}
                </Text>
                <div style={checkboxGridStyle}>
                  {targetOptions.map((option) => (
                    <div key={option.value} style={checkboxCardStyle}>
                      <Checkbox
                        label={`${localeShortName(option.value, option.label)} (${localeRegionCode(option.value)})`}
                        checked={targets.includes(option.value)}
                        onChange={() => handleToggleTargets(option.value)}
                      />
                    </div>
                  ))}
                </div>
              </BlockStack>

              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  {t("v4.createTask.content")}
                </Text>
                <div style={checkboxGridStyle}>
                  {DEFAULT_MODULE_KEYS.map((moduleKey) => (
                    <div key={moduleKey} style={checkboxCardStyle}>
                      <Checkbox
                        label={getV4ModuleLabel(moduleKey, t)}
                        checked={modules.includes(moduleKey)}
                        onChange={() => handleToggleModules(moduleKey)}
                      />
                    </div>
                  ))}
                  <div style={checkboxCardStyle}>
                    <Checkbox
                      label={t("v4.createTask.includeLiquid")}
                      helpText={t("v4.createTask.includeLiquidHelp")}
                      checked={includeLiquid}
                      onChange={setIncludeLiquid}
                    />
                  </div>
                </div>
              </BlockStack>
            </BlockStack>
          </Card>

          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  {t("v4.createTask.translationOptions")}
                </Text>
                <Select
                  label={t("v4.createTask.aiModel")}
                  options={aiModelOptions}
                  value={aiModel}
                  onChange={setAiModel}
                />
                <Checkbox
                  label={t("v4.createTask.overwriteExisting")}
                  checked={isCover}
                  onChange={setIsCover}
                />
                <Checkbox
                  label={t("v4.createTask.translateHandle")}
                  checked={isHandle}
                  onChange={setIsHandle}
                />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  {t("v4.createTask.confirmEstimateTitle")}
                </Text>
                <InlineStack align="space-between">
                  <Text as="span" tone="subdued">
                    {t("v4.availableCredits")}
                  </Text>
                  <Text as="span" variant="headingMd">
                    {quotaLoading
                      ? "—"
                      : normalizedQuota
                        ? formatCredits(normalizedQuota.remaining)
                        : "—"}
                  </Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="span" tone="subdued">
                    {t("v4Mvp.scan.lastScanLabel")}
                  </Text>
                  <Text as="span" variant="bodyMd">
                    {coverageLoading
                      ? "—"
                      : displayedLastScan
                        ? formatDateTime(displayedLastScan) ?? "—"
                        : t("v4Mvp.scan.never")}
                  </Text>
                </InlineStack>
                {taskEstimate.needsMoreCredits ? (
                  <Badge tone="attention">{t("v4.createTask.estimateShort")}</Badge>
                ) : null}
                <Button
                  variant="primary"
                  onClick={() => void handleCreate()}
                  loading={creating}
                  disabled={targets.length === 0 || (modules.length === 0 && !includeLiquid)}
                >
                  {t("v4Mvp.customPage.submit")}
                </Button>
              </BlockStack>
            </Card>
          </BlockStack>
        </div>
      </BlockStack>
    </Page>
  );
}

function SummaryItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div style={summaryItemStyle}>
      <Text as="p" tone="subdued" variant="bodySm">
        {label}
      </Text>
      <Text as="p" variant="headingMd">
        {value}
      </Text>
    </div>
  );
}

const summaryGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
  gap: "12px",
} satisfies CSSProperties;

const summaryItemStyle = {
  padding: "12px 14px",
  border: "1px solid rgba(138, 142, 145, 0.18)",
  borderRadius: "12px",
  background: "rgba(246, 246, 247, 0.72)",
} satisfies CSSProperties;

const twoColumnStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1.5fr) minmax(280px, 0.9fr)",
  gap: "16px",
} satisfies CSSProperties;

const checkboxGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "12px",
} satisfies CSSProperties;

const checkboxCardStyle = {
  padding: "12px 14px",
  border: "1px solid rgba(138, 142, 145, 0.24)",
  borderRadius: "12px",
  background: "#ffffff",
} satisfies CSSProperties;
