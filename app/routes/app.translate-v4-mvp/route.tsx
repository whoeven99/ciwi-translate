import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import {
  Badge,
  BlockStack,
  Button,
  Card,
  Checkbox,
  Divider,
  InlineStack,
  Page,
  ProgressBar,
  Select,
  Text,
} from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import { message } from "~/ui/message";
import { authenticate } from "~/shopify.server";
import { loadShopLocalesForTranslation } from "~/server/translateV4/shopLocales.server";
import type {
  CoverageSummary,
  LocaleCoverageRow,
} from "~/server/translateV4/coverage.server";
import type { TranslationJobProgressSummary } from "~/server/translateV4/progress.server";
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
  getV4StatusLabel,
  translateV4Message,
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

type Recommendation = {
  id: string;
  title: string;
  reason: string;
  targets: string[];
  modules: string[];
  pendingItems: number;
  tone: "success" | "attention" | "info";
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
    console.error("[translate-v4-mvp] load locales failed:", err);
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

function latestAutoScanAt(locales: LocaleCoverageRow[]): string | null {
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

function buildScanSummary(
  before: CoverageSummary,
  after: CoverageSummary,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  const beforePending = Math.max(before.totalItems - before.translatedItems, 0);
  const afterPending = Math.max(after.totalItems - after.translatedItems, 0);
  const pendingDelta = afterPending - beforePending;
  const changedLocales = after.locales.reduce((count, row) => {
    const previous = before.locales.find((item) => item.locale === row.locale);
    if (!previous) return count + 1;
    if (
      previous.total !== row.total ||
      previous.translated !== row.translated ||
      previous.percent !== row.percent
    ) {
      return count + 1;
    }
    return count;
  }, 0);

  if (pendingDelta > 0) {
    return t("v4Mvp.scan.summaryPending", {
      count: pendingDelta,
      locales: changedLocales,
    });
  }
  if (changedLocales > 0) {
    return t("v4Mvp.scan.summaryChangedLocales", {
      count: changedLocales,
    });
  }
  return t("v4Mvp.scan.summaryNoChanges");
}

function coverageTone(percent: number | null): "success" | "attention" | "info" {
  if (percent == null) return "info";
  if (percent >= 90) return "success";
  return "attention";
}

function buildRecommendations(
  coverage: CoverageSummary,
  jobs: TranslationJobProgressSummary[],
  t: ReturnType<typeof useTranslation>["t"],
): Recommendation[] {
  const activeTargets = new Set(
    jobs
      .filter((job) => !job.isTerminal)
      .map((job) => job.target.trim().toLowerCase()),
  );

  const rows = coverage.locales
    .map((row) => ({
      ...row,
      pendingItems: Math.max(row.total - row.translated, 0),
    }))
    .filter((row) => row.total > 0 && row.pendingItems > 0)
    .sort((a, b) => {
      const percentA = a.percent ?? -1;
      const percentB = b.percent ?? -1;
      if (percentA !== percentB) return percentA - percentB;
      return b.pendingItems - a.pendingItems;
    });

  const availableRows = rows.filter(
    (row) => !activeTargets.has(row.locale.trim().toLowerCase()),
  );
  const recommendations: Recommendation[] = [];

  const lowestCoverage = availableRows[0];
  if (lowestCoverage) {
    recommendations.push({
      id: `low-${lowestCoverage.locale}`,
      title: t("v4Mvp.recommended.lowCoverageTitle", {
        locale: localeShortName(lowestCoverage.locale, lowestCoverage.label),
      }),
      reason: t("v4Mvp.recommended.lowCoverageReason", {
        percent: lowestCoverage.percent ?? 0,
      }),
      targets: [lowestCoverage.locale],
      modules: DEFAULT_MODULE_KEYS,
      pendingItems: lowestCoverage.pendingItems,
      tone: coverageTone(lowestCoverage.percent),
    });
  }

  const batchRows = availableRows.filter((row) => (row.percent ?? 0) < 80).slice(0, 3);
  if (batchRows.length >= 2) {
    recommendations.push({
      id: "batch-recovery",
      title: t("v4Mvp.recommended.batchTitle", {
        count: batchRows.length,
      }),
      reason: t("v4Mvp.recommended.batchReason"),
      targets: batchRows.map((row) => row.locale),
      modules: DEFAULT_MODULE_KEYS,
      pendingItems: batchRows.reduce((sum, row) => sum + row.pendingItems, 0),
      tone: "attention",
    });
  }

  const syncRows = availableRows.slice(0, Math.min(3, availableRows.length));
  if (syncRows.length > 0) {
    recommendations.push({
      id: "fresh-sync",
      title: t("v4Mvp.recommended.syncTitle"),
      reason: t("v4Mvp.recommended.syncReason"),
      targets: syncRows.map((row) => row.locale),
      modules: DEFAULT_MODULE_KEYS,
      pendingItems: syncRows.reduce((sum, row) => sum + row.pendingItems, 0),
      tone: "info",
    });
  }

  return recommendations.slice(0, 3);
}

export default function TranslateV4MvpRoute() {
  const { t } = useTranslation();
  const { shop, locales, primaryLocale } = useLoaderData<typeof loader>();
  const customSectionRef = useRef<HTMLDivElement | null>(null);
  const queueSectionRef = useRef<HTMLDivElement | null>(null);

  const targetOptions = useMemo(
    () =>
      locales.filter((locale) => locale.value !== primaryLocale) as ShopLocaleOption[],
    [locales, primaryLocale],
  );

  const [coverage, setCoverage] = useState<CoverageSummary>(EMPTY_COVERAGE);
  const [coverageLoading, setCoverageLoading] = useState(true);
  const [jobs, setJobs] = useState<TranslationJobProgressSummary[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [quota, setQuota] = useState<ShopQuota | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(true);
  const [customTaskOpen, setCustomTaskOpen] = useState(false);
  const [lastManualScanAt, setLastManualScanAt] = useState<string | null>(null);
  const [scanSummary, setScanSummary] = useState<string | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const coverageRef = useRef<CoverageSummary>(EMPTY_COVERAGE);

  const [targets, setTargets] = useState<string[]>(() =>
    targetOptions.map((option) => option.value),
  );
  const [modules, setModules] = useState<string[]>(DEFAULT_MODULE_KEYS);
  const [aiModel, setAiModel] = useState<string>(DEFAULT_AI_MODEL);
  const [isCover, setIsCover] = useState(false);
  const [isHandle, setIsHandle] = useState(false);
  const [includeLiquid, setIncludeLiquid] = useState(false);

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

  const recommendations = useMemo(
    () => buildRecommendations(coverage, jobs, t),
    [coverage, jobs, t],
  );
  const [recommendationEstimates, setRecommendationEstimates] = useState<
    Record<string, number | null>
  >({});

  const aiModelOptions = useMemo(
    () =>
      AI_MODEL_OPTIONS.map((option) => ({
        ...option,
        label: getV4AiModelLabel(option.value, t),
      })),
    [t],
  );

  const refreshTasks = useCallback(async () => {
    setJobsLoading(true);
    try {
      const res = await fetch(
        `/api/translate-v4/tasks?shopName=${encodeURIComponent(shop)}`,
      );
      const data = await readJsonResponse<{ ok?: boolean; jobs?: TranslationJobProgressSummary[] }>(
        res,
      );
      if (data.ok && Array.isArray(data.jobs)) {
        setJobs(data.jobs);
      }
    } catch (err) {
      console.error("[translate-v4-mvp] refresh tasks failed:", err);
    } finally {
      setJobsLoading(false);
    }
  }, [shop]);

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
      console.error("[translate-v4-mvp] refresh quota failed:", err);
    } finally {
      setQuotaLoading(false);
    }
  }, [shop]);

  const refreshCoverage = useCallback(
    async (forceRefresh = false) => {
      if (forceRefresh) setScanLoading(true);
      else setCoverageLoading(true);

      const before = coverageRef.current;

      try {
        if (!forceRefresh) {
          const res = await fetch(
            `/api/translate-v4/coverage?shopName=${encodeURIComponent(shop)}&cache=1`,
          );
          const data = await readJsonResponse<{ ok?: boolean; summary?: CoverageSummary }>(res);
          if (data.ok && data.summary) {
            setCoverage(data.summary);
          }
          return;
        }

        let latestSummary: CoverageSummary | null = null;
        for (const locale of targetOptions) {
          const res = await fetch(
            `/api/translate-v4/coverage?shopName=${encodeURIComponent(shop)}&refresh=1&locales=${encodeURIComponent(locale.value)}`,
          );
          const data = await readJsonResponse<{ ok?: boolean; summary?: CoverageSummary }>(res);
          if (data.ok && data.summary) {
            latestSummary = data.summary;
            setCoverage(data.summary);
          }
        }

        if (latestSummary) {
          setLastManualScanAt(new Date().toISOString());
          setScanSummary(buildScanSummary(before, latestSummary, t));
        } else {
          setScanSummary(t("v4Mvp.scan.summaryUpdated"));
        }
      } catch (err) {
        console.error("[translate-v4-mvp] refresh coverage failed:", err);
        message.error(t("v4.actionFailedRetry"));
      } finally {
        setCoverageLoading(false);
        setScanLoading(false);
      }
    },
    [shop, t, targetOptions],
  );

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshTasks(), refreshQuota(), refreshCoverage(false)]);
  }, [refreshCoverage, refreshQuota, refreshTasks]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    coverageRef.current = coverage;
  }, [coverage]);

  useEffect(() => {
    if (!recommendations.length) {
      setRecommendationEstimates({});
      return;
    }

    let cancelled = false;
    void (async () => {
      const next: Record<string, number | null> = {};
      for (const item of recommendations) {
        try {
          const res = await fetch("/api/translate-v4/estimate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              modules: item.modules,
              targets: item.targets,
              isCover: false,
              includeLiquid: false,
              untranslatedRatioByLocale,
            }),
          });
          const data = await readJsonResponse<{
            ok?: boolean;
            estimate?: { estimatedCredits?: number | null };
          }>(res);
          next[item.id] = data.ok ? (data.estimate?.estimatedCredits ?? null) : null;
        } catch {
          next[item.id] = null;
        }
      }
      if (!cancelled) {
        setRecommendationEstimates(next);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [recommendations, untranslatedRatioByLocale]);

  const pendingItems = Math.max(coverage.totalItems - coverage.translatedItems, 0);
  const activeTaskCount = jobs.filter((job) => !job.isTerminal).length;
  const displayedLastScan = lastManualScanAt ?? latestAutoScanAt(coverage.locales);

  const toggleTargets = (value: string) => {
    setTargets((prev) =>
      prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value],
    );
  };

  const toggleModules = (value: string) => {
    setModules((prev) =>
      prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value],
    );
  };

  const applyRecommendation = (item: Recommendation) => {
    setTargets(item.targets);
    setModules(item.modules);
    setCustomTaskOpen(true);
    setTimeout(() => {
      customSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    message.success(t("v4Mvp.recommended.applied"));
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
        await Promise.all([refreshTasks(), refreshQuota(), refreshCoverage(false)]);
        setTimeout(() => {
          queueSectionRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }, 120);
      } else {
        message.error(resultMessage);
      }
    } catch (err) {
      console.error("[translate-v4-mvp] create tasks failed:", err);
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
    primaryLocale,
    refreshCoverage,
    refreshQuota,
    refreshTasks,
    shop,
    t,
    targetOptions,
    targets,
  ]);

  const handleTaskAction = useCallback(
    async (
      taskId: string,
      actionType: "pause" | "resume" | "cancel" | "delete",
    ) => {
      try {
        const res = await fetch("/api/translate-v4/task-action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId, shopName: shop, action: actionType }),
        });
        const data = await readJsonResponse<{ ok?: boolean; error?: string }>(res);
        if (!data.ok) {
          message.error(
            data.error ? translateV4Message(data.error, t) : t("v4.actionFailed"),
          );
          return;
        }
        await Promise.all([refreshTasks(), refreshQuota()]);
      } catch (err) {
        console.error("[translate-v4-mvp] task action failed:", err);
        message.error(t("v4.actionFailedRetry"));
      }
    },
    [refreshQuota, refreshTasks, shop, t],
  );

  return (
    <Page>
      <TitleBar title={t("v4Mvp.title")} />
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="start">
              <BlockStack gap="100">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="h1" variant="headingLg">
                    {t("v4Mvp.title")}
                  </Text>
                  <Badge tone="info">{t("v4Mvp.previewBadge")}</Badge>
                </InlineStack>
                <Text as="p" tone="subdued">
                  {t("v4Mvp.subtitle")}
                </Text>
              </BlockStack>
              <InlineStack gap="200">
                <Button onClick={() => void refreshAll()} loading={coverageLoading || jobsLoading || quotaLoading}>
                  {t("v4Mvp.scan.refreshAll")}
                </Button>
                <Button variant="primary" onClick={() => void refreshCoverage(true)} loading={scanLoading}>
                  {t("v4Mvp.scan.rescan")}
                </Button>
              </InlineStack>
            </InlineStack>
          </BlockStack>
        </Card>

        <div style={metricsGridStyle}>
          <MetricCard
            title={t("v4.translationProgress")}
            value={
              coverageLoading && coverage.locales.length === 0
                ? "—"
                : `${coverage.overallPercent ?? 0}%`
            }
            detail={t("v4Mvp.overview.progress", {
              translated: coverage.translatedItems,
              total: coverage.totalItems,
            })}
          />
          <MetricCard
            title={t("v4Mvp.overview.pendingWork")}
            value={pendingItems.toLocaleString()}
            detail={t("v4.pendingItems")}
          />
          <MetricCard
            title={t("v4.availableCredits")}
            value={
              quotaLoading
                ? "—"
                : normalizedQuota
                  ? formatCredits(normalizedQuota.remaining)
                  : "—"
            }
            detail={
              taskEstimate.estimatedCredits != null
                ? t("v4.createTask.confirmEstimatedCredits", {
                    credits: formatEstimateCredits(taskEstimate.estimatedCredits),
                  })
                : t("v4.createTask.estimateSelectFirst")
            }
          />
          <MetricCard
            title={t("v4Mvp.overview.activeTasks")}
            value={activeTaskCount.toLocaleString()}
            detail={
              displayedLastScan
                ? t("v4Mvp.overview.lastScan", {
                    time: formatDateTime(displayedLastScan),
                  })
                : t("v4Mvp.scan.never")
            }
          />
        </div>

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="start">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">
                  {t("v4Mvp.scan.title")}
                </Text>
                <Text as="p" tone="subdued">
                  {t("v4Mvp.scan.description")}
                </Text>
              </BlockStack>
              <InlineStack gap="200">
                <Button onClick={() => void refreshCoverage(false)} loading={coverageLoading}>
                  {t("v4.coverage.refreshStats")}
                </Button>
                <Button variant="primary" onClick={() => void refreshCoverage(true)} loading={scanLoading}>
                  {t("v4Mvp.scan.rescan")}
                </Button>
              </InlineStack>
            </InlineStack>
            <Divider />
            <InlineStack gap="400" wrap>
              <Text as="p" tone="subdued">
                {displayedLastScan
                  ? lastManualScanAt
                    ? t("v4Mvp.scan.lastManual", {
                        time: formatDateTime(displayedLastScan),
                      })
                    : t("v4Mvp.scan.lastAuto", {
                        time: formatDateTime(displayedLastScan),
                      })
                  : t("v4Mvp.scan.never")}
              </Text>
              {scanSummary ? (
                <Text as="p" tone="subdued">
                  {scanSummary}
                </Text>
              ) : null}
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">
                {t("v4Mvp.recommended.title")}
              </Text>
              <Text as="p" tone="subdued">
                {t("v4Mvp.recommended.description")}
              </Text>
            </BlockStack>

            {recommendations.length === 0 ? (
              <Text as="p" tone="subdued">
                {t("v4Mvp.recommended.empty")}
              </Text>
            ) : (
              <div style={recommendationGridStyle}>
                {recommendations.map((item) => (
                  <RecommendationCard
                    key={item.id}
                    title={item.title}
                    reason={item.reason}
                    targets={item.targets}
                    modules={item.modules}
                    pendingItems={item.pendingItems}
                    estimatedCredits={recommendationEstimates[item.id] ?? null}
                    estimatedTime={estimateTimeLabel(item.pendingItems, t)}
                    tone={item.tone}
                    onApply={() => applyRecommendation(item)}
                  />
                ))}
              </div>
            )}
          </BlockStack>
        </Card>

        <div ref={customSectionRef}>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="start">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    {t("v4Mvp.custom.title")}
                  </Text>
                  <Text as="p" tone="subdued">
                    {t("v4Mvp.custom.description")}
                  </Text>
                </BlockStack>
                <InlineStack gap="200">
                  <Button onClick={() => setCustomTaskOpen((prev) => !prev)}>
                    {customTaskOpen ? t("v4Mvp.custom.hide") : t("v4Mvp.custom.show")}
                  </Button>
                  <Button
                    onClick={() => {
                      setTargets(targetOptions.map((item) => item.value));
                      setModules(DEFAULT_MODULE_KEYS);
                      setAiModel(DEFAULT_AI_MODEL);
                      setIsCover(false);
                      setIsHandle(false);
                      setIncludeLiquid(false);
                    }}
                  >
                    {t("v4Mvp.custom.reset")}
                  </Button>
                </InlineStack>
              </InlineStack>

              {customTaskOpen ? (
                <BlockStack gap="400">
                  <Divider />

                  <BlockStack gap="200">
                    <Text as="h3" variant="headingSm">
                      {t("v4.createTask.targetLanguages")}
                    </Text>
                    <div style={checkboxGridStyle}>
                      {targetOptions.map((option) => (
                        <div key={option.value} style={checkboxCardStyle}>
                          <Checkbox
                            label={`${localeShortName(option.value, option.label)} (${localeRegionCode(option.value)})`}
                            checked={targets.includes(option.value)}
                            onChange={() => toggleTargets(option.value)}
                          />
                        </div>
                      ))}
                    </div>
                  </BlockStack>

                  <BlockStack gap="200">
                    <Text as="h3" variant="headingSm">
                      {t("v4.createTask.content")}
                    </Text>
                    <div style={checkboxGridStyle}>
                      {DEFAULT_MODULE_KEYS.map((moduleKey) => (
                        <div key={moduleKey} style={checkboxCardStyle}>
                          <Checkbox
                            label={getV4ModuleLabel(moduleKey, t)}
                            checked={modules.includes(moduleKey)}
                            onChange={() => toggleModules(moduleKey)}
                          />
                        </div>
                      ))}
                    </div>
                  </BlockStack>

                  <div style={advancedGridStyle}>
                    <Card>
                      <BlockStack gap="300">
                        <Text as="h3" variant="headingSm">
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
                        <Checkbox
                          label={t("v4.createTask.includeLiquid")}
                          helpText={t("v4.createTask.includeLiquidHelp")}
                          checked={includeLiquid}
                          onChange={setIncludeLiquid}
                        />
                      </BlockStack>
                    </Card>

                    <Card>
                      <BlockStack gap="300">
                        <Text as="h3" variant="headingSm">
                          {t("v4.createTask.confirmEstimateTitle")}
                        </Text>
                        <InlineStack align="space-between">
                          <Text as="span" tone="subdued">
                            {t("v4.createTask.confirmCreditsRequired")}
                          </Text>
                          <Text as="span" variant="headingMd">
                            {taskEstimate.loading
                              ? "…"
                              : taskEstimate.estimatedCredits != null
                                ? formatEstimateCredits(taskEstimate.estimatedCredits)
                                : "—"}
                          </Text>
                        </InlineStack>
                        <InlineStack align="space-between">
                          <Text as="span" tone="subdued">
                            {t("v4.availableCredits")}
                          </Text>
                          <Text as="span" variant="headingMd">
                            {normalizedQuota ? formatCredits(normalizedQuota.remaining) : "—"}
                          </Text>
                        </InlineStack>
                        <InlineStack align="space-between">
                          <Text as="span" tone="subdued">
                            {t("v4Mvp.recommended.estimateTime")}
                          </Text>
                          <Text as="span" variant="headingMd">
                            {estimateTimeLabel(
                              Math.max(targets.length, 1) * Math.max(modules.length, 1) * 120,
                              t,
                            )}
                          </Text>
                        </InlineStack>
                        {taskEstimate.needsMoreCredits ? (
                          <Badge tone="attention">
                            {t("v4.createTask.estimateShort")}
                          </Badge>
                        ) : null}
                        <Button
                          variant="primary"
                          size="large"
                          onClick={() => void handleCreate()}
                          loading={creating}
                          disabled={targets.length === 0 || (modules.length === 0 && !includeLiquid)}
                        >
                          {t("v4.createTask.confirmAction")}
                        </Button>
                      </BlockStack>
                    </Card>
                  </div>
                </BlockStack>
              ) : null}
            </BlockStack>
          </Card>
        </div>

        <div ref={queueSectionRef}>
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">
                  {t("v4Mvp.queue.title")}
                </Text>
                <Text as="p" tone="subdued">
                  {t("v4.tasks.title", { count: activeTaskCount })}
                </Text>
              </BlockStack>

              {jobsLoading ? (
                <Text as="p" tone="subdued">
                  {t("v4.coverage.refreshing")}
                </Text>
              ) : jobs.length === 0 ? (
                <Text as="p" tone="subdued">
                  {t("v4Mvp.queue.empty")}
                </Text>
              ) : (
                <BlockStack gap="300">
                  {jobs.map((job) => (
                    <JobCard
                      key={job.taskId}
                      job={job}
                      t={t}
                      onAction={handleTaskAction}
                    />
                  ))}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </div>
      </BlockStack>
    </Page>
  );
}

function MetricCard({
  title,
  value,
  detail,
}: {
  title: string;
  value: string;
  detail: string;
}) {
  return (
    <Card>
      <BlockStack gap="200">
        <Text as="p" tone="subdued" variant="bodySm">
          {title}
        </Text>
        <Text as="p" variant="headingXl">
          {value}
        </Text>
        <Text as="p" tone="subdued" variant="bodySm">
          {detail}
        </Text>
      </BlockStack>
    </Card>
  );
}

function RecommendationCard({
  title,
  reason,
  targets,
  modules,
  pendingItems,
  estimatedCredits,
  estimatedTime,
  tone,
  onApply,
}: {
  title: string;
  reason: string;
  targets: string[];
  modules: string[];
  pendingItems: number;
  estimatedCredits: number | null;
  estimatedTime: string;
  tone: "success" | "attention" | "info";
  onApply: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="start">
          <BlockStack gap="150">
            <Text as="h3" variant="headingSm">
              {title}
            </Text>
            <Text as="p" tone="subdued" variant="bodySm">
              {reason}
            </Text>
          </BlockStack>
          <Button variant="primary" onClick={onApply}>
            {t("v4Mvp.recommended.apply")}
          </Button>
        </InlineStack>

        <InlineStack gap="400" wrap>
          <InlineStack gap="100" blockAlign="center">
            <Text as="span" tone="subdued" variant="bodySm">
              {t("v4Mvp.recommended.pendingItems")}
            </Text>
            <Text as="span" variant="bodyMd">
              {pendingItems.toLocaleString()}
            </Text>
          </InlineStack>
          <InlineStack gap="100" blockAlign="center">
            <Text as="span" tone="subdued" variant="bodySm">
              {t("v4.createTask.confirmCreditsRequired")}
            </Text>
            <Text as="span" variant="bodyMd">
              {estimatedCredits != null ? formatEstimateCredits(estimatedCredits) : "—"}
            </Text>
          </InlineStack>
          <InlineStack gap="100" blockAlign="center">
            <Text as="span" tone="subdued" variant="bodySm">
              {t("v4Mvp.recommended.estimateTime")}
            </Text>
            <Text as="span" variant="bodyMd">
              {estimatedTime}
            </Text>
          </InlineStack>
        </InlineStack>

        <BlockStack gap="150">
          <Text as="p" tone="subdued" variant="bodySm">
            {t("v4Mvp.recommended.targets")}
          </Text>
          <InlineStack gap="150" wrap>
            {targets.map((target) => (
              <Badge key={target} tone="info">
                {`${localeShortName(target)} (${localeRegionCode(target)})`}
              </Badge>
            ))}
          </InlineStack>
        </BlockStack>

        <BlockStack gap="150">
          <Text as="p" tone="subdued" variant="bodySm">
            {t("v4Mvp.recommended.modules")}
          </Text>
          <InlineStack gap="150" wrap>
            {modules.slice(0, 4).map((moduleKey) => (
              <Badge key={moduleKey} tone="info">
                {getV4ModuleLabel(moduleKey, t)}
              </Badge>
            ))}
            {modules.length > 4 ? (
              <Badge tone="info">{`+${modules.length - 4}`}</Badge>
            ) : null}
          </InlineStack>
        </BlockStack>
      </BlockStack>
    </Card>
  );
}

function JobCard({
  job,
  t,
  onAction,
}: {
  job: TranslationJobProgressSummary;
  t: ReturnType<typeof useTranslation>["t"];
  onAction: (
    taskId: string,
    actionType: "pause" | "resume" | "cancel" | "delete",
  ) => void;
}) {
  const statusLabel = job.isStopping
    ? t("v4.pausing")
    : getV4StatusLabel(job.status, t, job.metrics, job.errorMessage);
  const canPause = job.status === "TRANSLATE_QUEUED" || job.status === "TRANSLATING";
  const canResume = job.status === "PAUSED" || job.status === "FAILED";
  const canDelete = job.isTerminal || job.status === "PAUSED";

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="start">
          <BlockStack gap="100">
            <InlineStack gap="200" blockAlign="center" wrap>
              <Text as="h3" variant="headingSm">
                {localeRegionCode(job.source)} → {localeRegionCode(job.target)}
              </Text>
              <Badge tone={job.isTerminal ? "info" : "attention"}>{statusLabel}</Badge>
            </InlineStack>
            <Text as="p" tone="subdued" variant="bodySm">
              {t("v4Mvp.queue.createdAt", { time: formatDateTime(job.createdAt) ?? "—" })}
              {" · "}
              {t("v4Mvp.queue.updatedAt", { time: formatDateTime(job.updatedAt) ?? "—" })}
            </Text>
          </BlockStack>
          <InlineStack gap="200" wrap>
            {canPause ? (
              <Button size="slim" onClick={() => onAction(job.taskId, "pause")}>
                {t("v4.tasks.pause")}
              </Button>
            ) : null}
            {canResume ? (
              <Button size="slim" onClick={() => onAction(job.taskId, "resume")}>
                {t("v4.tasks.resume")}
              </Button>
            ) : null}
            {!job.isTerminal ? (
              <Button size="slim" onClick={() => onAction(job.taskId, "cancel")}>
                {t("Cancel")}
              </Button>
            ) : null}
            {canDelete ? (
              <Button size="slim" onClick={() => onAction(job.taskId, "delete")}>
                {t("Delete")}
              </Button>
            ) : null}
          </InlineStack>
        </InlineStack>

        {job.progressPercent != null ? (
          <BlockStack gap="100">
            <InlineStack align="space-between">
              <Text as="span" tone="subdued" variant="bodySm">
                {t("v4Mvp.queue.progress")}
              </Text>
              <Text as="span" variant="bodySm">
                {job.progressPercent}%
              </Text>
            </InlineStack>
            <ProgressBar progress={job.progressPercent} size="small" tone="primary" />
          </BlockStack>
        ) : null}

        <InlineStack gap="150" wrap>
          {job.modules.map((moduleKey) => (
            <Badge key={moduleKey} tone="info">
              {getV4ModuleLabel(moduleKey, t)}
            </Badge>
          ))}
        </InlineStack>

        {job.errorMessage ? (
          <Text as="p" tone="critical" variant="bodySm">
            {translateV4Message(job.errorMessage, t)}
          </Text>
        ) : null}
      </BlockStack>
    </Card>
  );
}

const metricsGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "16px",
} satisfies CSSProperties;

const recommendationGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
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

const advancedGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap: "16px",
} satisfies CSSProperties;
