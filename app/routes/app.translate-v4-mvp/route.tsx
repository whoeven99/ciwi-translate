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
import { CreateTaskQuotaGateModal } from "~/routes/app.translate-v4/components/CreateTaskQuotaGateModal";
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
import {
  AppMetricTile,
  AppPill,
  AppProgressRing,
  AppSectionCard,
  AppStatusBadge,
} from "~/ui/components";
import { appColors } from "~/ui/tokens";
import { localeRegionCode, localeShortName } from "~/routes/app.translate-v4/localeDisplay";
import {
  createTranslateV4Tasks,
  type ShopLocaleOption,
} from "~/lib/createTranslateV4Tasks";
import { shouldBlockCreateTaskByCredits } from "~/lib/createTranslateQuotaGuard";
import { normalizeShopQuota, type ShopQuota } from "~/lib/translationQuota";
import { openCreditsPurchaseModal } from "~/utils/creditsPurchaseModal";
import { buildCreateTaskCreditsPurchaseContext } from "~/utils/creditsPurchaseTaskContext";

const EMPTY_COVERAGE: CoverageSummary = {
  languageCount: 0,
  translatedItems: 0,
  totalItems: 0,
  overallPercent: null,
  locales: [],
};

const SUMMARY_VIDEO_URL = "https://www.youtube.com/watch?v=AJ0RZkCQMd0&t=9s";

function shouldPollV4Job(job: TranslationJobProgressSummary): boolean {
  return (
    !job.isTerminal &&
    job.status !== "PAUSED" &&
    job.status !== "FAILED" &&
    job.status !== "CANCELLED"
  );
}

type RecommendationTone = "success" | "attention" | "info";

type Recommendation = {
  id: string;
  title: string;
  locale: string;
  reasons: string[];
  targets: string[];
  modules: string[];
  pendingItems: number;
  coveragePercent: number | null;
  contentChanged: boolean;
  tone: RecommendationTone;
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

/** prod Turso COMPLETED 任务 p75 校准（translateUnitDone ≈ 待译字段数）。 */
const ESTIMATE_DURATION_BASE_MIN = 4;
const ESTIMATE_DURATION_UNITS_PER_MIN_P75 = 48;

function estimateDurationMinutes(pendingItems: number): number {
  if (pendingItems <= 0) return 0;
  return Math.ceil(
    ESTIMATE_DURATION_BASE_MIN + pendingItems / ESTIMATE_DURATION_UNITS_PER_MIN_P75,
  );
}

function estimateDurationLabel(
  minutes: number,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (minutes <= 5) return t("v4Mvp.time.fast");
  if (minutes <= 15) return t("v4Mvp.time.medium");
  if (minutes <= 30) return t("v4Mvp.time.long");
  return t("v4Mvp.time.xlong");
}

function estimateTimeLabel(
  pendingItems: number,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  return estimateDurationLabel(estimateDurationMinutes(pendingItems), t);
}

function formatMvpEstimateCredits(n: number): string {
  return `${formatEstimateCredits(n)} Credit`;
}

function extractYoutubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    let videoId = "";

    if (host === "youtube.com" || host === "m.youtube.com") {
      videoId = parsed.searchParams.get("v") ?? "";
    } else if (host === "youtu.be") {
      videoId = parsed.pathname.replace("/", "");
    }

    return videoId || null;
  } catch {
    return null;
  }
}

function buildYoutubeThumbnailUrl(url: string): string | null {
  const videoId = extractYoutubeVideoId(url);
  if (!videoId) return null;
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
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

function getCoverageRating(
  percent: number | null,
  t: ReturnType<typeof useTranslation>["t"],
) {
  if (percent == null) {
    return {
      label: t("v4.coverage.notScanned"),
      accent: appColors.textTertiary,
    };
  }

  const accent = v4Colors.primary;

  if (percent >= 100) {
    return {
      label: t("v4Mvp.coverageCard.ratingAmazing"),
      accent,
    };
  }

  if (percent >= 80) {
    return {
      label: t("v4Mvp.coverageCard.ratingExcellent"),
      accent,
    };
  }

  if (percent >= 60) {
    return {
      label: t("v4Mvp.coverageCard.ratingQualified"),
      accent,
    };
  }

  return {
    label: t("v4.coverage.needsImprovement"),
    accent,
  };
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
        coveragePercent: coverageInsufficient ? (row.percent ?? 0) : null,
        contentChanged,
        tone: contentChanged ? "info" : coverageTone(row.percent),
      } satisfies Recommendation;
    })
    .filter((item) => item.reasons.length > 0)
    .sort((a, b) => {
      if (a.contentChanged !== b.contentChanged) return a.contentChanged ? -1 : 1;
      return b.pendingItems - a.pendingItems;
    });
}

export default function TranslateV4MvpRoute() {
  const { t } = useTranslation();
  const { shop, locales, primaryLocale } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const plan = useSelector((state: RootState) => state.userConfig.plan);
  const isNew = useSelector((state: RootState) => state.userConfig.isNew);
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
  const [createQuotaGateOpen, setCreateQuotaGateOpen] = useState<"trial" | "pricing" | null>(
    null,
  );
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
  const coverageRating = useMemo(
    () => getCoverageRating(coverage.overallPercent, t),
    [coverage.overallPercent, t],
  );
  const hasCoverageData = !(coverageLoading && coverage.locales.length === 0);
  const summaryVideoThumbnailUrl = useMemo(
    () => buildYoutubeThumbnailUrl(SUMMARY_VIDEO_URL),
    [],
  );
  const normalizedQuota = useMemo(() => normalizeShopQuota(quota), [quota]);
  const remainingCredits = normalizedQuota?.remaining ?? null;
  const createShouldGateByCredits = shouldBlockCreateTaskByCredits({
    remainingCredits,
  });
  const createQuotaGatePending = createShouldGateByCredits && isNew == null;
  const createQuotaGateMode: "trial" | "pricing" | null =
    createShouldGateByCredits && isNew != null
      ? isNew
        ? "trial"
        : "pricing"
      : null;

  const recommendations = useMemo(
    () => buildRecommendations(coverage, jobs, changedLocaleCodes, t),
    [changedLocaleCodes, coverage, jobs, t],
  );
  const [submittingRecommendationIds, setSubmittingRecommendationIds] = useState<string[]>([]);
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
  const visibleRecommendations = useMemo(
    () => recommendations.filter((item) => !submittingRecommendationIds.includes(item.id)),
    [recommendations, submittingRecommendationIds],
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
        return true;
      } else {
        message.error(formatV4CreateTasksMessage(result, t, localeRegionCode));
        return false;
      }
    } catch (err) {
      console.error("[translate-v4-mvp] create tasks failed:", err);
      message.error(t("v4.createFailedRetry"));
      return false;
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

  const jobsRef = useRef<TranslationJobProgressSummary[]>([]);
  const previousActiveTaskIdsRef = useRef<string[]>([]);

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = () => {
      if (disposed) return;

      const hasActive = jobsRef.current.some(shouldPollV4Job);
      timer = setTimeout(() => {
        if (!hasActive) {
          poll();
          return;
        }

        void Promise.all([refreshTasks(), refreshQuota()]).finally(() => {
          poll();
        });
      }, hasActive ? 4_000 : 10_000);
    };

    poll();

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [refreshQuota, refreshTasks]);

  useEffect(() => {
    const previousIds = previousActiveTaskIdsRef.current;
    const nextIds = currentJobs.map((job) => job.taskId);
    const finishedTaskDetected =
      previousIds.length > 0 && previousIds.some((taskId) => !nextIds.includes(taskId));

    previousActiveTaskIdsRef.current = nextIds;

    if (!finishedTaskDetected) return;
    void refreshCoverage(true);
  }, [currentJobs, refreshCoverage]);

  const handleRecommendationTranslate = useCallback(async (item: Recommendation) => {
    if (createQuotaGatePending) {
      message.info(
        t("Checking your trial eligibility. Please try again in a moment."),
      );
      return;
    }

    if (createQuotaGateMode !== null) {
      setCreateQuotaGateOpen(createQuotaGateMode);
      return;
    }

    if (remainingCredits == null) {
      message.info(t("v4.create.quotaUnavailable"));
      return;
    }

    const estimatedCredits = recommendationEstimates[item.id] ?? null;
    if (estimatedCredits != null && estimatedCredits > remainingCredits) {
      openCreditsPurchaseModal(
        buildCreateTaskCreditsPurchaseContext({
          estimatedCredits,
          currentRemainingCredits: remainingCredits,
          targetsCount: item.targets.length,
          modulesCount: item.modules.length,
        }),
      );
      return;
    }

    setSubmittingRecommendationIds((current) =>
      current.includes(item.id) ? current : [...current, item.id],
    );

    await createTasksWithConfig({
      nextTargets: item.targets,
      nextModules: item.modules,
    });
    setSubmittingRecommendationIds((current) => current.filter((id) => id !== item.id));
  }, [
    createQuotaGateMode,
    createQuotaGatePending,
    createTasksWithConfig,
    recommendationEstimates,
    remainingCredits,
    t,
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
      <div className="v4-page" style={v4ContentStyle}>
        <BlockStack gap="500">
          <PageHeaderBar
            credits={normalizedQuota?.remaining ?? null}
            planType={planType}
          />

          <div style={summaryHeroGridStyle}>
            <div style={summaryHeroCardStyle}>
              <div style={summaryHeroLayoutStyle}>
                <div style={summaryProgressWrapStyle}>
                  <AppProgressRing
                    percent={hasCoverageData ? coverage.overallPercent : null}
                    size={96}
                    strokeWidth={3.2}
                    loading={!hasCoverageData}
                  />
                </div>

                <div style={summaryContentStyle}>
                  <Text as="p" tone="subdued" variant="bodySm">
                    {t("v4Mvp.coverageCard.title")}
                  </Text>
                  <InlineStack gap="150" blockAlign="center" wrap={false}>
                    <Text
                      as="p"
                      variant="headingMd"
                      style={summaryProgressLabelStyle(coverageRating.accent)}
                    >
                      {coverageRating.label}
                    </Text>
                    {coverage.languageCount > 0 ? (
                      <Text as="span" tone="subdued" variant="bodySm">
                        {`· ${t("v4Mvp.coverageCard.languageCount", {
                          total: coverage.languageCount,
                        })}`}
                      </Text>
                    ) : null}
                  </InlineStack>
                  {hasCoverageData && coverage.totalItems > 0 ? (
                    <Text as="p" tone="subdued" variant="bodySm">
                      {t("v4Mvp.overview.progress", {
                        translated: coverage.translatedItems.toLocaleString(),
                        total: coverage.totalItems.toLocaleString(),
                      })}
                    </Text>
                  ) : null}
                </div>

                <div style={summaryButtonWrapStyle}>
                  <Button variant="secondary" onClick={() => setCoverageDetailOpen(true)}>
                    {t("v4Mvp.coverageCard.viewDetails")}
                  </Button>
                </div>
              </div>
            </div>

            <a
              href={SUMMARY_VIDEO_URL}
              target="_blank"
              rel="noreferrer"
              style={videoPreviewLayerStyle}
            >
              <div style={videoPreviewSurfaceStyle}>
                {summaryVideoThumbnailUrl ? (
                  <img
                    alt={t("v4Mvp.videoCard.title")}
                    src={summaryVideoThumbnailUrl}
                    style={videoPreviewImageStyle}
                  />
                ) : (
                  <div style={videoPreviewFallbackStyle}>
                    <Badge tone="attention">{t("v4Mvp.videoCard.unavailable")}</Badge>
                  </div>
                )}

                <div style={videoPreviewOverlayStyle}>
                  <div style={videoPreviewPlayButtonStyle}>
                    <div style={videoPreviewPlayIconStyle} />
                  </div>
                </div>

                <div style={videoPreviewCaptionStyle}>
                  <Text as="p" variant="bodyMd" style={videoPreviewCaptionTextStyle}>
                    {t("v4Mvp.videoCard.tutorialTitle")}
                  </Text>
                </div>
              </div>
            </a>
          </div>

          <AppSectionCard
            title={t("v4Mvp.custom.title")}
            description={t("v4Mvp.custom.description")}
            extra={
              <Button
                variant="primary"
                onClick={() => navigate(buildCustomTranslationPath({
                  targets: customTargets,
                  modules: customModules,
                }))}
              >
                {t("v4Mvp.custom.translate")}
              </Button>
            }
            bodyPadding="20px 24px"
            style={{ boxShadow: "var(--app-shadow-card)" }}
          />

          <div ref={queueSectionRef}>
            <AppSectionCard
              bodyPadding="20px 24px"
              style={{ boxShadow: "var(--app-shadow-card-strong)" }}
            >
            <BlockStack gap="400">
              <div style={workbenchHeaderStyle}>
                <InlineStack align="space-between" blockAlign="center">
                  <div style={tabListStyle}>
                    <button
                      type="button"
                      onClick={() => setWorkbenchTab("recommended")}
                      style={tabButtonStyle(workbenchTab === "recommended")}
                    >
                        {t("v4Mvp.tabs.recommended", { count: visibleRecommendations.length })}
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
                        variant="secondary"
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
                <BlockStack gap="200">
                  {scanSummary ? (
                    <div style={scanSummaryStyle}>
                      <Text as="p" tone="subdued" variant="bodySm">
                        {scanSummary}
                      </Text>
                    </div>
                  ) : null}
                  {visibleRecommendations.length > 0 ? (
                    visibleRecommendations.map((item) => (
                      <RecommendationCard
                        key={item.id}
                        title={item.title}
                        tone={item.tone}
                        coveragePercent={item.coveragePercent}
                        contentChanged={item.contentChanged}
                        pendingItems={item.pendingItems}
                        estimatedCredits={recommendationEstimates[item.id] ?? null}
                        estimatedTime={estimateTimeLabel(item.pendingItems, t)}
                        loading={submittingRecommendationIds.includes(item.id)}
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
                          <InlineStack align="center">
                            <Button
                              variant="secondary"
                              size="large"
                              onClick={() => void refreshCoverage(true)}
                              loading={scanLoading}
                            >
                              {t("v4Mvp.scan.scanStore")}
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
            </AppSectionCard>
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
                    <AppMetricTile
                      label={t("v4.translationProgress")}
                      value={
                        coverageLoading && coverage.locales.length === 0
                          ? "—"
                          : `${coverage.overallPercent ?? 0}%`
                      }
                    />
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
      <CreateTaskQuotaGateModal
        open={createQuotaGateOpen !== null}
        mode={createQuotaGateOpen ?? "pricing"}
        onClose={() => setCreateQuotaGateOpen(null)}
      />
    </Page>
  );
}

function RecommendationCard({
  title,
  tone,
  coveragePercent,
  contentChanged,
  pendingItems,
  estimatedCredits,
  estimatedTime,
  loading = false,
  onTranslate,
}: {
  title: string;
  tone: RecommendationTone;
  coveragePercent: number | null;
  contentChanged: boolean;
  pendingItems: number;
  estimatedCredits: number | null;
  estimatedTime: string;
  loading?: boolean;
  onTranslate: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div style={recommendationRowStyle}>
      <div style={recommendationMainStyle}>
        <InlineStack gap="150" blockAlign="center" wrap={false}>
          <span style={recommendationToneDotStyle(tone)} />
          <Text as="h3" variant="headingSm" truncate>
            {title}
          </Text>
          {contentChanged ? (
            <AppStatusBadge tone="info">{t("v4Mvp.recommended.reasonChanged")}</AppStatusBadge>
          ) : null}
        </InlineStack>
        <div style={recommendationMetaListStyle}>
          {coveragePercent != null ? (
            <AppPill
              style={{
                background: v4Colors.infoBg,
                color: v4Colors.info,
                border: "1px solid transparent",
              }}
            >
              {t("v4Mvp.recommended.metaCoverage", { percent: coveragePercent })}
            </AppPill>
          ) : null}
          <AppPill tone="warning">
            {t("v4Mvp.recommended.metaPending", {
              items: pendingItems.toLocaleString(),
            })}
          </AppPill>
          {estimatedCredits != null ? (
            <AppPill tone="info">
              {t("v4Mvp.recommended.metaCredits", {
                credits: formatMvpEstimateCredits(estimatedCredits),
              })}
            </AppPill>
          ) : null}
          <AppPill tone="success">{estimatedTime}</AppPill>
        </div>
      </div>
      <div style={recommendationActionWrapStyle}>
        <Button size="slim" variant="secondary" loading={loading} onClick={onTranslate}>
          {t("v4Mvp.recommended.translate")}
        </Button>
      </div>
    </div>
  );
}

const tabListStyle = {
  display: "inline-flex",
  flexWrap: "wrap",
  gap: 8,
  padding: 4,
  borderRadius: 999,
  background: appColors.surfaceSecondary,
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
  background: appColors.surface,
  boxShadow: "var(--app-shadow-card)",
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

const coverageModalEmptyStyle = {
  padding: "28px 18px",
  borderRadius: "14px",
  background: appColors.surfaceSecondary,
  border: `1px dashed ${v4Colors.cardBorder}`,
} satisfies CSSProperties;

const summaryHeroGridStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: "18px",
  alignItems: "stretch",
  width: "100%",
} satisfies CSSProperties;

const summaryHeroCardStyle = {
  ...v4CardStyle,
  padding: "20px 24px",
  background: v4Colors.summaryBg,
  boxShadow: "var(--app-shadow-card-strong)",
  display: "flex",
  alignItems: "center",
  flex: "0.95 1 450px",
  minWidth: "320px",
} satisfies CSSProperties;

const videoPreviewLayerStyle = {
  ...v4CardStyle,
  padding: "0",
  overflow: "hidden",
  color: "inherit",
  textDecoration: "none",
  /* eslint-disable-next-line no-restricted-syntax -- 视频卡片固定深色底，不跟随可换肤 token */
  background: "#0f172a",
  boxShadow: "var(--app-shadow-card-strong)",
  flex: "1.35 1 10px",
  minWidth: "150px",
  minHeight: "100%",
  display: "block",
  width: "322px",
} satisfies CSSProperties;

const summaryHeroLayoutStyle = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: "20px",
  width: "100%",
} satisfies CSSProperties;

const summaryContentStyle = {
  minWidth: 0,
  flex: "1 1 180px",
  display: "grid",
  gap: "4px",
} satisfies CSSProperties;

const summaryProgressWrapStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
} satisfies CSSProperties;

const summaryButtonWrapStyle = {
  display: "flex",
  alignItems: "center",
  flexShrink: 0,
  marginLeft: "auto",
} satisfies CSSProperties;

function summaryProgressLabelStyle(accent: string): CSSProperties {
  return {
    color: accent,
    fontSize: "14px",
    lineHeight: "18px",
    fontWeight: 600,
  };
}

const videoPreviewSurfaceStyle = {
  position: "relative",
  width: "100%",
  height: "100%",
  minHeight: "100px",
  overflow: "hidden",
  /* eslint-disable-next-line no-restricted-syntax -- 视频预览区固定深色主题 */
  background: "#0f172a",
} satisfies CSSProperties;

const videoPreviewImageStyle = {
  width: "100%",
  height: "100%",
  minHeight: "112px",
  display: "block",
  objectFit: "cover",
} satisfies CSSProperties;

const videoPreviewOverlayStyle = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  paddingBottom: "10px",
  background:
    "linear-gradient(180deg, rgba(15,23,42,0.08) 0%, rgba(15,23,42,0.24) 100%)",
} satisfies CSSProperties;

const videoPreviewPlayButtonStyle = {
  width: "42px",
  height: "42px",
  borderRadius: "999px",
  background: "rgba(255,255,255,0.9)",
  boxShadow: "0 8px 18px rgba(15, 23, 42, 0.16)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  transform: "translateY(-4px)",
} satisfies CSSProperties;

const videoPreviewPlayIconStyle = {
  width: 0,
  height: 0,
  borderTop: "6px solid transparent",
  borderBottom: "6px solid transparent",
  borderLeft: `10px solid ${v4Colors.text}`,
  marginLeft: "2px",
} satisfies CSSProperties;

const videoPreviewCaptionStyle = {
  position: "absolute",
  inset: "auto 0 0 0",
  padding: "14px 16px 10px",
  background:
    "linear-gradient(180deg, rgba(15, 23, 42, 0) 0%, rgb(77 77 77 / 78%) 100%)",
} satisfies CSSProperties;

const videoPreviewCaptionTextStyle = {
  color: appColors.surface,
  fontWeight: 600,
  fontSize: "14px",
  lineHeight: "20px",
  textShadow: "0 1px 2px rgba(15, 23, 42, 0.24)",
} satisfies CSSProperties;

const videoPreviewFallbackStyle = {
  width: "100%",
  height: "100%",
  minHeight: "112px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background:
    "linear-gradient(180deg, rgba(15,23,42,0.92) 0%, rgba(30,41,59,0.96) 100%)",
} satisfies CSSProperties;

const scanSummaryStyle = {
  padding: "12px 14px",
  borderRadius: "12px",
  background: v4Colors.primarySoft,
  border: `1px solid ${v4Colors.cardBorder}`,
} satisfies CSSProperties;

const workbenchHeaderStyle = {
  paddingBottom: "4px",
  borderBottom: `1px solid ${v4Colors.divider}`,
} satisfies CSSProperties;

const emptyStateInnerStyle = {
  width: "100%",
  maxWidth: "540px",
  padding: "28px 24px",
  borderRadius: "16px",
  border: `1px dashed ${v4Colors.cardBorder}`,
  background: appColors.surface,
} satisfies CSSProperties;

const recommendationRowStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "16px",
  padding: "12px 16px",
  borderRadius: "12px",
  border: `1px solid ${v4Colors.cardBorder}`,
  background: v4Colors.cardBg,
} satisfies CSSProperties;

const recommendationMainStyle = {
  minWidth: 0,
  display: "grid",
  gap: "6px",
} satisfies CSSProperties;

const recommendationMetaListStyle = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: "6px",
} satisfies CSSProperties;

const recommendationActionWrapStyle = {
  flexShrink: 0,
} satisfies CSSProperties;

function recommendationToneDotStyle(tone: RecommendationTone): CSSProperties {
  const color =
    tone === "success"
      ? v4Colors.success
      : tone === "info"
        ? v4Colors.info
        : v4Colors.warning;
  return {
    width: "8px",
    height: "8px",
    borderRadius: "999px",
    background: color,
    flexShrink: 0,
  };
}

function tabButtonStyle(active: boolean): CSSProperties {
  return {
    appearance: "none",
    border: "none",
    background: active ? appColors.surface : "transparent",
    color: active ? v4Colors.primary : v4Colors.textMuted,
    borderRadius: "999px",
    padding: "8px 14px",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    boxShadow: active ? "var(--app-shadow-card)" : "none",
    transition: "all 0.18s ease",
  };
}
