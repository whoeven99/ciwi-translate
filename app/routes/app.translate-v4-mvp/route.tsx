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
import type { CoverageSummary } from "~/server/translateV4/coverage.server";
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
  translateV4Message,
} from "~/routes/app.translate-v4/v4I18n";
import { TaskQueueSection } from "~/routes/app.translate-v4/components/TaskQueueSection";
import { PageHeaderBar } from "~/routes/app.translate-v4/components/SummaryAndHeader";
import { v4CardStyle, v4Colors, v4ContentStyle } from "~/routes/app.translate-v4/v4Styles";
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
  const activeTaskCount = currentJobs.length;
  const translateSlotBusy = useMemo(
    () => jobs.some((job) => job.status === "TRANSLATING" || job.isStopping),
    [jobs],
  );

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
          return false;
        }
        await Promise.all([refreshTasks(), refreshQuota()]);
        return true;
      } catch (err) {
        console.error("[translate-v4-mvp] task action failed:", err);
        message.error(t("v4.actionFailedRetry"));
        return false;
      }
    },
    [refreshQuota, refreshTasks, shop, t],
  );

  return (
    <Page>
      <TitleBar title={t("v4.title")} />
      <div style={v4ContentStyle}>
        <BlockStack gap="500">
          <PageHeaderBar
            credits={normalizedQuota?.remaining ?? null}
            planType={planType}
          />

          <div style={summaryHeroCardStyle}>
            <div style={summaryHeroHeaderStyle}>
              <InlineStack align="space-between" blockAlign="start" wrap={false}>
                <div style={summaryValueBlockStyle}>
                  <Text as="p" tone="subdued" variant="bodyMd">
                    {t("v4.translationProgress")}
                  </Text>
                  <Text as="p" variant="heading2xl">
                    {coverageLoading && coverage.locales.length === 0
                      ? "—"
                      : `${coverage.overallPercent ?? 0}%`}
                  </Text>
                </div>
                <div style={sectionActionWrapStyle}>
                  <Button onClick={() => setCoverageDetailOpen(true)}>
                    {t("v4Mvp.coverageCard.viewDetails")}
                  </Button>
                </div>
              </InlineStack>
            </div>
          </div>

          <div style={batchEntryCardStyle}>
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <Text as="span" variant="bodySm" tone="subdued">
                  {t("v4Mvp.custom.title")}
                </Text>
                <Text as="p" variant="headingMd">
                  {t("v4Mvp.custom.description")}
                </Text>
              </BlockStack>
              <div style={sectionActionWrapStyle}>
                <Button
                  variant="primary"
                  onClick={() => navigate(buildCustomTranslationPath({
                    targets: customTargets,
                    modules: customModules,
                  }))}
                >
                  {t("v4Mvp.custom.translate")}
                </Button>
              </div>
            </InlineStack>
          </div>

          <div ref={queueSectionRef} style={workbenchShellStyle}>
            <BlockStack gap="400">
              <div style={workbenchHeaderStyle}>
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
                      <Button
                        variant="primary"
                        onClick={() => void refreshCoverage(true)}
                        loading={scanLoading}
                      >
                        {t("v4Mvp.scan.rescan")}
                      </Button>
                    </InlineStack>
                  ) : null}
                </InlineStack>
              </div>

              {workbenchTab === "recommended" ? (
                <BlockStack gap="300">
                  {scanSummary ? (
                    <div style={scanSummaryStyle}>
                      <Text as="p" tone="subdued" variant="bodySm">
                        {scanSummary}
                      </Text>
                    </div>
                  ) : null}
                  {recommendations.length > 0 ? (
                    recommendations.map((item) => (
                      <RecommendationCard
                        key={item.id}
                        title={item.title}
                        reasons={item.reasons}
                        pendingItems={item.pendingItems}
                        estimatedCredits={recommendationEstimates[item.id] ?? null}
                        estimatedTime={estimateTimeLabel(item.pendingItems, t)}
                        onTranslate={() => void handleRecommendationTranslate(item)}
                      />
                    ))
                  ) : (
                    <div style={emptyStateStyle}>
                      <div style={emptyStateInnerStyle}>
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
                    </div>
                  )}
                </BlockStack>
              ) : (
                <TaskQueueSection
                  jobs={jobs}
                  translateSlotBusy={translateSlotBusy}
                  loading={jobsLoading}
                  onBuyCredits={() => navigate("/app/pricing")}
                  onAction={handleTaskAction}
                />
              )}
            </BlockStack>
          </div>
        </BlockStack>
      </div>
      <Modal
        open={coverageDetailOpen}
        onClose={() => setCoverageDetailOpen(false)}
        title={t("v4Mvp.coverageModal.title")}
        size="large"
      >
        <Modal.Section>
          <div style={coverageModalShellStyle}>
            <BlockStack gap="350">
              <div style={coverageModalHeroStyle}>
                <BlockStack gap="150">
                  <div style={coverageModalStatStyle}>
                    <Text as="p" tone="subdued" variant="bodySm">
                      {t("v4.translationProgress")}
                    </Text>
                    <Text as="p" variant="headingLg">
                      {coverageLoading && coverage.locales.length === 0
                        ? "—"
                        : `${coverage.overallPercent ?? 0}%`}
                    </Text>
                  </div>
                </BlockStack>
              </div>

              <BlockStack gap="200">
                {coverage.locales.length > 0 ? (
                  [...coverage.locales]
                    .sort((a, b) => (a.percent ?? 0) - (b.percent ?? 0))
                    .map((locale) => (
                      <div key={locale.locale} style={coverageRowStyle}>
                        <InlineStack align="space-between" blockAlign="center">
                          <BlockStack gap="050">
                            <InlineStack gap="150" blockAlign="center" wrap>
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
                  <div style={coverageModalEmptyStyle}>
                    <Text as="p" tone="subdued">
                      {t("v4Mvp.coverageModal.empty")}
                    </Text>
                  </div>
                )}
              </BlockStack>
            </BlockStack>
          </div>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

function RecommendationCard({
  title,
  reasons,
  pendingItems,
  estimatedCredits,
  estimatedTime,
  onTranslate,
}: {
  title: string;
  reasons: string[];
  pendingItems: number;
  estimatedCredits: number | null;
  estimatedTime: string;
  onTranslate: () => void;
}) {
  const { t } = useTranslation();
  const sourceUpdatedReason = t("v4Mvp.recommended.reasonChanged");
  const hasSourceUpdated = reasons.includes(sourceUpdatedReason);
  const primaryReason = reasons.find((reason) => reason !== sourceUpdatedReason) ?? null;

  return (
    <div style={recommendationCardStyle}>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="start" wrap={false}>
          <BlockStack gap="250">
            <InlineStack gap="200" blockAlign="center" wrap>
              <span style={recommendationTonePillStyle}>
                {t("v4Mvp.recommended.priority")}
              </span>
              {hasSourceUpdated ? (
                <span style={recommendationSourcePillStyle}>
                  {t("v4Mvp.recommended.sourceUpdated")}
                </span>
              ) : null}
            </InlineStack>
            <BlockStack gap="150">
              <Text as="h3" variant="headingLg">
                {title}
              </Text>
              {primaryReason ? (
                <Text as="p" tone="subdued" variant="bodyMd">
                  {primaryReason}
                </Text>
              ) : null}
            </BlockStack>
          </BlockStack>
          <div style={recommendationActionWrapStyle}>
            <Button variant="primary" onClick={onTranslate}>
              {t("v4Mvp.recommended.translate")}
            </Button>
          </div>
        </InlineStack>

        <div style={recommendationMetricsGridStyle}>
          <MetricStat
            label={t("v4Mvp.recommended.pendingItems")}
            value={pendingItems.toLocaleString()}
          />
          <MetricStat
            label={t("v4.createTask.confirmCreditsRequired")}
            value={
              estimatedCredits != null ? formatEstimateCredits(estimatedCredits) : "—"
            }
          />
          <MetricStat
            label={t("v4Mvp.recommended.estimateTime")}
            value={estimatedTime}
          />
        </div>
      </BlockStack>
    </div>
  );
}

function MetricStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div style={recommendationMetricCardStyle}>
      <BlockStack gap="100">
        <Text as="p" tone="subdued" variant="bodyMd">
          {label}
        </Text>
        <Text as="p" variant="headingLg">
          {value}
        </Text>
      </BlockStack>
    </div>
  );
}

const tabListStyle = {
  display: "inline-flex",
  gap: "8px",
  padding: "4px",
  borderRadius: "999px",
  background: "rgba(246, 248, 252, 0.96)",
  border: `1px solid ${v4Colors.cardBorder}`,
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9)",
} satisfies CSSProperties;

const emptyStateStyle = {
  minHeight: "240px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "24px 16px",
} satisfies CSSProperties;

const coverageRowStyle = {
  padding: "14px 16px",
  border: `1px solid ${v4Colors.cardBorder}`,
  borderRadius: "14px",
  background: "#ffffff",
  boxShadow: "0 6px 18px rgba(15, 23, 42, 0.04)",
} satisfies CSSProperties;

const coverageModalShellStyle = {
  padding: "4px 2px 2px",
} satisfies CSSProperties;

const coverageModalHeroStyle = {
  ...v4CardStyle,
  padding: "16px 18px",
  background: v4Colors.summaryBg,
  boxShadow: "var(--app-shadow-card)",
} satisfies CSSProperties;

const coverageModalStatStyle = {
  minWidth: "180px",
  padding: "12px 14px",
  borderRadius: "14px",
  background: "rgba(255,255,255,0.74)",
  border: `1px solid ${v4Colors.cardBorder}`,
} satisfies CSSProperties;

const coverageModalEmptyStyle = {
  padding: "28px 18px",
  borderRadius: "14px",
  background: "rgba(247,248,250,0.96)",
  border: `1px dashed ${v4Colors.cardBorder}`,
} satisfies CSSProperties;

const summaryHeroCardStyle = {
  ...v4CardStyle,
  padding: "24px 26px",
  background: v4Colors.summaryBg,
  boxShadow: "var(--app-shadow-card-strong)",
} satisfies CSSProperties;

const sectionActionWrapStyle = {
  flexShrink: 0,
  paddingLeft: "16px",
} satisfies CSSProperties;

const summaryHeroHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "24px",
  flexWrap: "wrap",
} satisfies CSSProperties;

const summaryValueBlockStyle = {
  minWidth: 0,
  flex: "1 1 320px",
  display: "grid",
  gap: "8px",
} satisfies CSSProperties;

const batchEntryCardStyle = {
  ...v4CardStyle,
  padding: "18px 20px",
  background:
    "linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(247,248,250,0.96) 100%)",
  boxShadow: "var(--app-shadow-card)",
} satisfies CSSProperties;

const workbenchShellStyle = {
  ...v4CardStyle,
  padding: "18px",
  background:
    "linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(250,251,253,0.98) 100%)",
  boxShadow: "var(--app-shadow-card-strong)",
} satisfies CSSProperties;

const workbenchHeaderStyle = {
  paddingBottom: "4px",
  borderBottom: `1px solid ${v4Colors.divider}`,
} satisfies CSSProperties;

const scanSummaryStyle = {
  padding: "12px 14px",
  borderRadius: "12px",
  background: "rgba(240, 244, 255, 0.72)",
  border: `1px solid ${v4Colors.cardBorder}`,
} satisfies CSSProperties;

const emptyStateInnerStyle = {
  width: "100%",
  maxWidth: "540px",
  padding: "28px 24px",
  borderRadius: "16px",
  border: `1px dashed ${v4Colors.cardBorder}`,
  background:
    "linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(247,248,250,0.96) 100%)",
} satisfies CSSProperties;

const recommendationBlueStyles = {
  border: "rgba(37, 99, 235, 0.18)",
  background:
    "linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(239, 246, 255, 0.96) 100%)",
  accent: "#2563eb",
  accentSoft: "rgba(59, 130, 246, 0.10)",
} as const;

const recommendationCardStyle: CSSProperties = {
  padding: "22px 22px 20px",
  borderRadius: "16px",
  border: `1px solid ${recommendationBlueStyles.border}`,
  background: recommendationBlueStyles.background,
  boxShadow: "0 10px 28px rgba(15, 23, 42, 0.05)",
  position: "relative",
  overflow: "hidden",
};

const recommendationTonePillStyle = {
  display: "inline-flex",
  alignItems: "center",
  padding: "6px 12px",
  borderRadius: "999px",
  background: recommendationBlueStyles.accentSoft,
  color: recommendationBlueStyles.accent,
  fontSize: "13px",
  fontWeight: 700,
  lineHeight: "18px",
} satisfies CSSProperties;

const recommendationSourcePillStyle = {
  display: "inline-flex",
  alignItems: "center",
  padding: "6px 12px",
  borderRadius: "999px",
  background: "rgba(37, 99, 235, 0.08)",
  color: recommendationBlueStyles.accent,
  fontSize: "13px",
  fontWeight: 600,
  lineHeight: "18px",
} satisfies CSSProperties;

const recommendationActionWrapStyle = {
  flexShrink: 0,
  paddingLeft: "20px",
} satisfies CSSProperties;

const recommendationMetricsGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
  gap: "16px",
} satisfies CSSProperties;

const recommendationMetricCardStyle = {
  padding: "16px 18px",
  borderRadius: "12px",
  background: "#ffffff",
  border: "1px solid rgba(138, 142, 145, 0.16)",
} satisfies CSSProperties;

function tabButtonStyle(active: boolean): CSSProperties {
  return {
    appearance: "none",
    border: "none",
    background: active ? v4Colors.text : "transparent",
    color: active ? "#ffffff" : v4Colors.textMuted,
    borderRadius: "999px",
    padding: "8px 14px",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    boxShadow: active ? "0 8px 20px rgba(15, 23, 42, 0.12)" : "none",
    transition: "all 0.18s ease",
  };
}
