import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate, useSearchParams } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { useSelector } from "react-redux";
import {
  Badge,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Modal,
  Page,
  ProgressBar,
  Text,
} from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import { message } from "~/ui/message";
import { authenticate } from "~/shopify.server";
import type { RootState } from "~/store";
import { loadShopLocalesForTranslation } from "~/server/translateV4/shopLocales.server";
import type {
  CoverageSummary,
  LocaleCoverageRow,
} from "~/server/translateV4/coverage.server";
import type { TranslationJobProgressSummary } from "~/server/translateV4/progress.server";
import {
  DEFAULT_MODULE_KEYS,
} from "~/routes/app.translate-v4/constants";
import {
  buildUntranslatedRatioByLocale,
  formatEstimateCredits,
} from "~/routes/app.translate-v4/useCreateTaskEstimate";
import {
  formatV4CreateTasksMessage,
  getV4ModuleLabel,
  getV4StatusLabel,
  translateV4Message,
} from "~/routes/app.translate-v4/v4I18n";
import { PageHeaderBar } from "~/routes/app.translate-v4/components/SummaryAndHeader";
import { localeRegionCode, localeShortName } from "~/routes/app.translate-v4/localeDisplay";
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
  locale: string;
  reasons: string[];
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
  const changedLocaleCodes = findChangedLocaleCodes(before, after);
  const beforePending = Math.max(before.totalItems - before.translatedItems, 0);
  const afterPending = Math.max(after.totalItems - after.translatedItems, 0);
  const pendingDelta = afterPending - beforePending;
  const changedLocales = changedLocaleCodes.length;

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

function findChangedLocaleCodes(
  before: CoverageSummary,
  after: CoverageSummary,
): string[] {
  return after.locales
    .filter((row) => {
      const previous = before.locales.find((item) => item.locale === row.locale);
      if (!previous) return true;
      return (
        previous.total !== row.total ||
        previous.translated !== row.translated ||
        previous.percent !== row.percent
      );
    })
    .map((row) => row.locale);
}

function coverageTone(percent: number | null): "success" | "attention" | "info" {
  if (percent == null) return "info";
  if (percent >= 90) return "success";
  return "attention";
}

function buildCustomTranslationPath({
  targets,
  modules,
}: {
  targets: string[];
  modules: string[];
}) {
  const params = new URLSearchParams();
  if (targets.length > 0) {
    params.set("targets", targets.join(","));
  }
  if (modules.length > 0) {
    params.set("modules", modules.join(","));
  }
  const query = params.toString();
  return query
    ? `/app/translate-v4-mvp-custom?${query}`
    : "/app/translate-v4-mvp-custom";
}

function buildRecommendations(
  coverage: CoverageSummary,
  jobs: TranslationJobProgressSummary[],
  changedLocaleCodes: string[],
  t: ReturnType<typeof useTranslation>["t"],
): Recommendation[] {
  const activeTargets = new Set(
    jobs
      .filter((job) => !job.isTerminal)
      .map((job) => job.target.trim().toLowerCase()),
  );
  const changedLocaleSet = new Set(changedLocaleCodes.map((item) => item.trim().toLowerCase()));

  return coverage.locales
    .map((row) => ({
      ...row,
      pendingItems: Math.max(row.total - row.translated, 0),
    }))
    .filter((row) => !activeTargets.has(row.locale.trim().toLowerCase()))
    .map((row) => {
      const coverageInsufficient = row.total > 0 && (row.percent ?? 0) < 100;
      const contentChanged = changedLocaleSet.has(row.locale.trim().toLowerCase());
      const reasons: string[] = [];

      if (coverageInsufficient) {
        reasons.push(
          t("v4Mvp.recommended.reasonCoverage", {
            percent: row.percent ?? 0,
          }),
        );
      }

      if (contentChanged) {
        reasons.push(t("v4Mvp.recommended.reasonChanged"));
      }

      return {
        id: `locale-${row.locale}`,
        title: t("v4Mvp.recommended.localeTaskTitle", {
          locale: localeShortName(row.locale, row.label),
        }),
        locale: row.locale,
        reasons,
        targets: [row.locale],
        modules: DEFAULT_MODULE_KEYS,
        pendingItems: row.pendingItems,
        tone: contentChanged ? "info" : coverageTone(row.percent),
      } satisfies Recommendation;
    })
    .filter((item) => item.reasons.length > 0)
    .sort((a, b) => {
      const changedA = a.reasons.some((reason) => reason === t("v4Mvp.recommended.reasonChanged"));
      const changedB = b.reasons.some((reason) => reason === t("v4Mvp.recommended.reasonChanged"));
      if (changedA !== changedB) return changedA ? -1 : 1;
      return b.pendingItems - a.pendingItems;
    });
}

export default function TranslateV4MvpRoute() {
  const { t } = useTranslation();
  const { shop, locales, primaryLocale } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const plan = useSelector((state: RootState) => state.userConfig.plan);
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
  const [lastManualScanAt, setLastManualScanAt] = useState<string | null>(null);
  const [scanSummary, setScanSummary] = useState<string | null>(null);
  const [changedLocaleCodes, setChangedLocaleCodes] = useState<string[]>([]);
  const [scanLoading, setScanLoading] = useState(false);
  const [workbenchTab, setWorkbenchTab] = useState<"recommended" | "queue">(
    searchParams.get("tab") === "queue" ? "queue" : "recommended",
  );
  const [coverageDetailOpen, setCoverageDetailOpen] = useState(false);
  const coverageRef = useRef<CoverageSummary>(EMPTY_COVERAGE);
  const planType = plan?.type?.trim() || null;

  const customTargets = useMemo(
    () =>
      targetOptions.map((option) => option.value),
    [targetOptions],
  );
  const customModules = DEFAULT_MODULE_KEYS;

  const untranslatedRatioByLocale = useMemo(
    () => buildUntranslatedRatioByLocale(coverage.locales),
    [coverage.locales],
  );
  const normalizedQuota = useMemo(() => normalizeShopQuota(quota), [quota]);

  const recommendations = useMemo(
    () => buildRecommendations(coverage, jobs, changedLocaleCodes, t),
    [changedLocaleCodes, coverage, jobs, t],
  );
  const [recommendationEstimates, setRecommendationEstimates] = useState<
    Record<string, number | null>
  >({});

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
    try {
      const res = await fetch(
        `/api/translate-v4/quota?shopName=${encodeURIComponent(shop)}`,
      );
      const data = await readJsonResponse<{ ok?: boolean; quota?: ShopQuota | null }>(res);
      if (data.ok) {
        setQuota(data.quota ?? null);
      }
    } catch (err) {
      console.error("[translate-v4-mvp] refresh quota failed:", err);
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
          setChangedLocaleCodes(findChangedLocaleCodes(before, latestSummary));
          setScanSummary(buildScanSummary(before, latestSummary, t));
        } else {
          setScanSummary(t("v4Mvp.scan.summaryUpdated"));
          setChangedLocaleCodes([]);
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

  const currentJobs = useMemo(() => jobs.filter((job) => !job.isTerminal), [jobs]);
  const historyJobs = useMemo(() => jobs.filter((job) => job.isTerminal), [jobs]);
  const activeTaskCount = currentJobs.length;
  const displayedLastScan = lastManualScanAt ?? latestAutoScanAt(coverage.locales);

  const createTasksWithConfig = useCallback(async ({
    nextTargets,
    nextModules,
    nextAiModel = "gpt-4o-mini",
    nextIsCover = false,
    nextIsHandle = false,
    nextIncludeLiquid = false,
  }: {
    nextTargets: string[];
    nextModules: string[];
    nextAiModel?: string;
    nextIsCover?: boolean;
    nextIsHandle?: boolean;
    nextIncludeLiquid?: boolean;
  }) => {
    try {
      const result = await createTranslateV4Tasks({
        source: primaryLocale,
        targets: nextTargets,
        modules: nextModules,
        aiModel: nextAiModel,
        isCover: nextIsCover,
        isHandle: nextIsHandle,
        includeLiquid: nextIncludeLiquid,
        targetOptions,
        shop,
      });

      if (result.created.length > 0) {
        message.success(formatV4CreateTasksMessage(result, t, localeRegionCode));
        await Promise.all([refreshTasks(), refreshQuota(), refreshCoverage(false)]);
        setWorkbenchTab("queue");
        setTimeout(() => {
          queueSectionRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }, 120);
      } else {
        message.error(formatV4CreateTasksMessage(result, t, localeRegionCode));
      }
    } catch (err) {
      console.error("[translate-v4-mvp] create tasks failed:", err);
      message.error(t("v4.createFailedRetry"));
    }
  }, [
    primaryLocale,
    refreshCoverage,
    refreshQuota,
    refreshTasks,
    shop,
    t,
    targetOptions,
  ]);

  const handleRecommendationTranslate = useCallback(async (item: Recommendation) => {
    await createTasksWithConfig({
      nextTargets: item.targets,
      nextModules: item.modules,
    });
  }, [createTasksWithConfig]);

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
      <TitleBar title={t("v4.title")} />
      <BlockStack gap="500">
        <PageHeaderBar
          credits={normalizedQuota?.remaining ?? null}
          planType={planType}
        />

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="start">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">
                  {t("v4Mvp.coverageCard.title")}
                </Text>
                <Text as="p" tone="subdued">
                  {t("v4Mvp.coverageCard.description", {
                    translated: coverage.translatedItems,
                    total: coverage.totalItems,
                  })}
                </Text>
              </BlockStack>
              <Button onClick={() => setCoverageDetailOpen(true)}>
                {t("v4Mvp.coverageCard.viewDetails")}
              </Button>
            </InlineStack>

            <InlineStack align="space-between" blockAlign="end">
              <BlockStack gap="050">
                <Text as="p" tone="subdued" variant="bodySm">
                  {t("v4.translationProgress")}
                </Text>
                <Text as="p" variant="heading2xl">
                  {coverageLoading && coverage.locales.length === 0
                    ? "—"
                    : `${coverage.overallPercent ?? 0}%`}
                </Text>
              </BlockStack>
              <BlockStack gap="050">
                <Text as="p" tone="subdued" variant="bodySm" alignment="end">
                  {t("v4Mvp.coverageCard.lastScanLabel")}
                </Text>
                <Text as="p" variant="bodyMd">
                  {displayedLastScan
                    ? formatDateTime(displayedLastScan) ?? "—"
                    : t("v4Mvp.scan.never")}
                </Text>
              </BlockStack>
            </InlineStack>
          </BlockStack>
        </Card>

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
              <Button
                variant="primary"
                onClick={() => navigate(buildCustomTranslationPath({
                  targets: customTargets,
                  modules: customModules,
                }))}
              >
                {t("v4Mvp.custom.translate")}
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        <div ref={queueSectionRef}>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <div style={tabListStyle}>
                  <button
                    type="button"
                    onClick={() => setWorkbenchTab("recommended")}
                    style={tabButtonStyle(workbenchTab === "recommended")}
                  >
                    {t("v4Mvp.tabs.recommended", { count: recommendations.length })}
                  </button>
                  <button
                    type="button"
                    onClick={() => setWorkbenchTab("queue")}
                    style={tabButtonStyle(workbenchTab === "queue")}
                  >
                    {t("v4Mvp.tabs.queue", { count: activeTaskCount })}
                  </button>
                </div>

                {workbenchTab === "recommended" ? (
                  <InlineStack gap="200">
                    {displayedLastScan ? (
                      <Text as="span" tone="subdued" variant="bodySm">
                        {t("v4Mvp.scan.lastScanShort", {
                          time: formatDateTime(displayedLastScan),
                        })}
                      </Text>
                    ) : null}
                    <Button
                      variant="primary"
                      onClick={() => void refreshCoverage(true)}
                      loading={scanLoading}
                    >
                      {t("v4Mvp.scan.rescan")}
                    </Button>
                  </InlineStack>
                ) : (
                  <button
                    type="button"
                    onClick={() => navigate("/app/translate-v4-history")}
                    style={historyLinkStyle}
                  >
                    {t("v4.tasks.openHistory", { count: historyJobs.length })}
                  </button>
                )}
              </InlineStack>

              {workbenchTab === "recommended" ? (
                <BlockStack gap="300">
                  {scanSummary ? (
                    <Text as="p" tone="subdued" variant="bodySm">
                      {scanSummary}
                    </Text>
                  ) : null}
                  {recommendations.length > 0 ? (
                    recommendations.map((item) => (
                      <RecommendationCard
                        key={item.id}
                        title={item.title}
                        locale={item.locale}
                        reasons={item.reasons}
                        targets={item.targets}
                        modules={item.modules}
                        pendingItems={item.pendingItems}
                        estimatedCredits={recommendationEstimates[item.id] ?? null}
                        estimatedTime={estimateTimeLabel(item.pendingItems, t)}
                        tone={item.tone}
                        onTranslate={() => void handleRecommendationTranslate(item)}
                      />
                    ))
                  ) : (
                    <div style={emptyStateStyle}>
                      <BlockStack gap="300">
                        <BlockStack gap="100">
                          <Text as="h3" variant="headingMd" alignment="center">
                            {t("v4Mvp.recommended.emptyTitle")}
                          </Text>
                          <Text as="p" tone="subdued" alignment="center">
                            {t("v4Mvp.recommended.emptyDescription")}
                          </Text>
                        </BlockStack>
                        <InlineStack align="center">
                          <Button
                            variant="primary"
                            size="large"
                            onClick={() =>
                              navigate(
                                buildCustomTranslationPath({
                                  targets: customTargets,
                                  modules: customModules,
                                }),
                              )
                            }
                          >
                            {t("v4Mvp.custom.translate")}
                          </Button>
                        </InlineStack>
                      </BlockStack>
                    </div>
                  )}
                </BlockStack>
              ) : jobsLoading ? (
                <Text as="p" tone="subdued">
                  {t("v4.coverage.refreshing")}
                </Text>
              ) : currentJobs.length === 0 ? (
                <Text as="p" tone="subdued">
                  {t("v4Mvp.queue.empty")}
                </Text>
              ) : (
                <BlockStack gap="300">
                  {currentJobs.map((job) => (
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
      <Modal
        open={coverageDetailOpen}
        onClose={() => setCoverageDetailOpen(false)}
        title={t("v4Mvp.coverageModal.title")}
        size="large"
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p" tone="subdued">
              {t("v4Mvp.coverageModal.description")}
            </Text>
            <BlockStack gap="200">
              {coverage.locales.length > 0 ? (
                [...coverage.locales]
                  .sort((a, b) => (a.percent ?? 0) - (b.percent ?? 0))
                  .map((locale) => (
                    <div key={locale.locale} style={coverageRowStyle}>
                      <InlineStack align="space-between" blockAlign="center">
                        <BlockStack gap="050">
                          <InlineStack gap="150" blockAlign="center">
                            <Text as="p" variant="bodyMd">
                              {localeShortName(locale.locale, locale.label)}
                            </Text>
                            <Badge tone={(locale.percent ?? 0) >= 90 ? "success" : "attention"}>
                              {localeRegionCode(locale.locale)}
                            </Badge>
                          </InlineStack>
                          <Text as="p" tone="subdued" variant="bodySm">
                            {t("v4Mvp.coverageModal.progressText", {
                              translated: locale.translated,
                              total: locale.total,
                            })}
                          </Text>
                        </BlockStack>
                        <Text as="p" variant="headingMd">
                          {`${locale.percent ?? 0}%`}
                        </Text>
                      </InlineStack>
                      <ProgressBar progress={locale.percent ?? 0} size="small" tone="primary" />
                    </div>
                  ))
              ) : (
                <Text as="p" tone="subdued">
                  {t("v4Mvp.coverageModal.empty")}
                </Text>
              )}
            </BlockStack>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

function RecommendationCard({
  title,
  locale,
  reasons,
  targets,
  modules,
  pendingItems,
  estimatedCredits,
  estimatedTime,
  tone,
  onTranslate,
}: {
  title: string;
  locale: string;
  reasons: string[];
  targets: string[];
  modules: string[];
  pendingItems: number;
  estimatedCredits: number | null;
  estimatedTime: string;
  tone: "success" | "attention" | "info";
  onTranslate: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="start">
          <BlockStack gap="150">
            <InlineStack gap="200" blockAlign="center" wrap>
              <Text as="h3" variant="headingSm">
                {title}
              </Text>
              <Badge tone={tone}>{localeRegionCode(locale)}</Badge>
            </InlineStack>
            <BlockStack gap="100">
              {reasons.map((reason) => (
                <Text key={reason} as="p" tone="subdued" variant="bodySm">
                  {reason}
                </Text>
              ))}
            </BlockStack>
          </BlockStack>
          <Button variant="primary" onClick={onTranslate}>
            {t("v4Mvp.recommended.translate")}
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

const tabListStyle = {
  display: "inline-flex",
  gap: "8px",
  padding: "4px",
  borderRadius: "999px",
  background: "rgba(246, 246, 247, 0.95)",
  border: "1px solid rgba(138, 142, 145, 0.18)",
} satisfies CSSProperties;

const emptyStateStyle = {
  minHeight: "240px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "24px 16px",
} satisfies CSSProperties;

const historyLinkStyle = {
  appearance: "none",
  border: "none",
  background: "transparent",
  padding: 0,
  color: "#6b7280",
  fontSize: "13px",
  lineHeight: "20px",
  fontWeight: 500,
  cursor: "pointer",
  fontFamily: "inherit",
  textDecoration: "underline",
  textUnderlineOffset: "2px",
} satisfies CSSProperties;

const coverageRowStyle = {
  padding: "14px 16px",
  border: "1px solid rgba(138, 142, 145, 0.18)",
  borderRadius: "12px",
  background: "#ffffff",
} satisfies CSSProperties;

function tabButtonStyle(active: boolean): CSSProperties {
  return {
    appearance: "none",
    border: "none",
    background: active ? "#111827" : "transparent",
    color: active ? "#ffffff" : "#4b5563",
    borderRadius: "999px",
    padding: "8px 14px",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  };
}
