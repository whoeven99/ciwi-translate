import {
  type CSSProperties,
  Profiler,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { message } from "~/ui/message";
import { TitleBar } from "@shopify/app-bridge-react";
import { Page } from "@shopify/polaris";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import {
  useLoaderData,
  useLocation,
  useNavigate,
  useRouteLoaderData,
} from "@remix-run/react";
import { useTranslation } from "react-i18next";
import { useSelector } from "react-redux";
import type { RootState } from "~/store";
import type { TranslationJobProgressSummary } from "~/server/translateV4/progress.server";
import type { ShopQuota } from "~/lib/translationQuota";
import type { CoverageSummary } from "~/server/translateV4/coverage.server";
import {
  createTranslateV4Tasks,
} from "~/lib/createTranslateV4Tasks";
import type { loader as appLoader } from "~/routes/app";
import { normalizeShopQuota } from "~/lib/translationQuota";
import { shouldBlockCreateTaskByCredits } from "~/lib/createTranslateQuotaGuard";
import {
  AI_MODEL_OPTIONS,
  CREATE_TASK_MODULE_OPTIONS,
  DEFAULT_MODULE_KEYS,
  DEFAULT_AI_MODEL,
} from "./constants";
import { expandV2ModuleKeys } from "~/server/translateV4/moduleCatalog";
import { v4ContentStyle, V4_OVERVIEW_CARD_MIN_HEIGHT } from "./v4Styles";
import { PageHeaderBar, SummaryDonutCard } from "./components/SummaryAndHeader";
import { CreateTaskCard } from "./components/CreateTaskCard";
import { CreateTaskConfirmModal } from "./components/CreateTaskConfirmModal";
import { TaskQueueSection } from "./components/TaskQueueSection";
import { CoverageCard } from "./components/CoverageCard";
import { localeRegionCode } from "./localeDisplay";
import { formatV4CreateTasksMessage, translateV4Message } from "./v4I18n";
import {
  buildUntranslatedRatioByLocale,
  useCreateTaskEstimate,
} from "./useCreateTaskEstimate";
import { notifyTranslationStatsUpdated } from "~/lib/translationStatsSync";
import { selectShopTargetLocales } from "~/lib/shopTargetLocales";
import { isCurrentV4Job } from "./jobFilters";
import {
  finishClientLogTrace,
  startClientLogTrace,
} from "~/utils/clientLog";
import {
  isPerfDebugEnabled,
  logReactProfilerRender,
  markPerfEnd,
  markPerfStart,
} from "~/utils/perf";
import { openCreditsPurchaseModal } from "~/utils/creditsPurchaseModal";
import {
  buildCreateTaskCreditsPurchaseContext,
  buildTranslateV4TaskCreditsPurchaseContext,
} from "~/utils/creditsPurchaseTaskContext";
import {
  clearCreateTaskDraft,
  loadCreateTaskDraft,
  saveCreateTaskDraft,
} from "~/utils/createTaskDraft";
import {
  parseBillingReturn,
  stripBillingReturnParams,
} from "~/utils/billingReturn";

/**
 * 额度轮询的最小间隔。任务列表在进度变化时会一直保持 3s 一轮，额度不需要跟到那么密
 * （每次都是一次鉴权 + Turso Account 读）。
 */
const QUOTA_POLL_MIN_INTERVAL_MS = 60_000;

/** 首屏骨架期的占位覆盖率；真实值由客户端首帧从 `coverage?cache=1` 拉取。 */
const EMPTY_COVERAGE: CoverageSummary = {
  languageCount: 0,
  translatedItems: 0,
  totalItems: 0,
  overallPercent: null,
  locales: [],
};

async function readJsonResponse<T = any>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(`Empty response body (${res.status})`);
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    const contentType = res.headers.get("content-type") || "unknown";
    throw new Error(
      `Invalid JSON response (${res.status}, ${contentType}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // 鉴权 + Shopify 语言列表由父级 `routes/app` loader 统一完成。
  // 同文档再跑一次 authenticate + loadShopLocales 会把 TTFB 抬到 ~2s（见 LCP 归因）。
  const perfDebug = new URL(request.url).searchParams.get("perf") === "1";
  if (perfDebug) {
    console.log(
      `[perf][loader] translate-v4 ${JSON.stringify({
        skippedAuthLocales: true,
        totalMs: 0,
      })}`,
    );
  }
  return json({ perfDebug });
};

export default function AppTranslateV4() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const initialLocationState = location.state as
    | { spotlightTaskIds?: string[] }
    | null
    | undefined;
  const appData = useRouteLoaderData<typeof appLoader>("routes/app");
  const { perfDebug } = useLoaderData<typeof loader>();
  const shop = appData?.shop ?? "";
  const locales = appData?.shopLocales?.localeOptions ?? [];
  const primaryLocale = appData?.shopLocales?.primaryLocale ?? "en";
  const [perfDebugEnabled, setPerfDebugEnabled] = useState(perfDebug);

  useEffect(() => {
    if (isPerfDebugEnabled()) {
      setPerfDebugEnabled(true);
    }
  }, []);

  const [jobs, setJobs] = useState<TranslationJobProgressSummary[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const currentJobCount = useMemo(
    () => jobs.filter(isCurrentV4Job).length,
    [jobs],
  );
  const [quota, setQuota] = useState<ShopQuota | null>(null);
  const normalizedQuota = useMemo(() => normalizeShopQuota(quota), [quota]);
  const [coverage, setCoverage] = useState<CoverageSummary>(EMPTY_COVERAGE);
  const plan = useSelector((state: RootState) => state.userConfig.plan);
  const isNew = useSelector((state: RootState) => state.userConfig.isNew);
  const totalChars = useSelector((state: RootState) => state.userConfig.totalChars);
  const planType = plan?.type?.trim() || null;
  const createDisabledMessage =
    normalizedQuota == null ? t("v4.create.quotaUnavailable") : null;
  const [coverageLoading, setCoverageLoading] = useState(true);
  const [coverageExpanded, setCoverageExpanded] = useState(false);
  const source = primaryLocale || "en";

  const localeOptions = useMemo(
    () =>
      locales.length
        ? locales
        : [
            {
              value: "zh-CN",
              label: `${t("v4.locale.zhCnFallback")} (zh-CN)`,
              primary: true,
              published: true,
            },
          ],
    [locales, t],
  );

  const targetOptions = useMemo(
    () => selectShopTargetLocales(localeOptions, source),
    [localeOptions, source],
  );

  const [targets, setTargets] = useState<string[]>(() =>
    targetOptions.map((option) => option.value),
  );
  const [moduleKeys, setModuleKeys] = useState<string[]>(DEFAULT_MODULE_KEYS);
  const [aiModel, setAiModel] = useState<string>(DEFAULT_AI_MODEL);
  const [isCover, setIsCover] = useState(false);
  const [isHandle, setIsHandle] = useState(false);
  const [includeLiquid, setIncludeLiquid] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createConfirmOpen, setCreateConfirmOpen] = useState(false);
  const [activeWorkbenchTab, setActiveWorkbenchTab] = useState<
    "create" | "tasks"
  >(() =>
    (initialLocationState?.spotlightTaskIds?.length ?? 0) > 0
      ? "tasks"
      : "create",
  );
  const [spotlightTaskIds, setSpotlightTaskIds] = useState<string[]>(() => {
    return initialLocationState?.spotlightTaskIds ?? [];
  });
  const billingDraftRestoredRef = useRef(false);

  const persistCreateTaskDraft = useCallback(() => {
    saveCreateTaskDraft(shop, {
      targets,
      modules: moduleKeys,
      aiModel,
      isCover,
      isHandle,
    });
  }, [shop, targets, moduleKeys, aiModel, isCover, isHandle]);

  const refreshCoverage = useCallback(
    async (forceRefresh = true) => {
      const perfStart = markPerfStart(
        forceRefresh
          ? "translate-v4.coverage.refresh.force"
          : "translate-v4.coverage.refresh.cache",
      );
      setCoverageLoading(true);
      const trace = forceRefresh
        ? startClientLogTrace({
            event: "translate_v4_refresh_coverage",
            action: "refresh_coverage",
            shop,
            context: {
              source,
              targets: targetOptions.map((item) => item.value),
            },
          })
        : null;
      try {
        if (!forceRefresh) {
          const res = await fetch(
            `/api/translate-v4/coverage?shopName=${encodeURIComponent(shop)}&cache=1`,
          );
          const data = await readJsonResponse(res);
          if (data?.ok) setCoverage(data.summary as CoverageSummary);
          markPerfEnd("translate-v4.coverage.refresh.cache", perfStart, {
            status: res.status,
            ok: Boolean(data?.ok),
          });
          if (trace) {
            finishClientLogTrace(trace, {
              status: "success",
              context: {
                localeCount: targetOptions.length,
              },
            });
          }
          return;
        }

        // 按语言逐个刷新，避免一次请求扫全店导致超时 / 与翻译任务争抢 Shopify 限流
        for (const loc of targetOptions) {
          const res = await fetch(
            `/api/translate-v4/coverage?shopName=${encodeURIComponent(shop)}&refresh=1&locales=${encodeURIComponent(loc.value)}`,
          );
          const data = await readJsonResponse(res);
          if (data?.ok) setCoverage(data.summary as CoverageSummary);
        }
        markPerfEnd("translate-v4.coverage.refresh.force", perfStart, {
          localeCount: targetOptions.length,
        });
        if (trace) {
          finishClientLogTrace(trace, {
            status: "success",
            context: {
              localeCount: targetOptions.length,
            },
          });
        }
      } catch (err) {
        console.error("[translateV4] refresh coverage failed:", err);
        markPerfEnd(
          forceRefresh
            ? "translate-v4.coverage.refresh.force"
            : "translate-v4.coverage.refresh.cache",
          perfStart,
          {
            failed: true,
          },
        );
        if (trace) {
          finishClientLogTrace(trace, {
            level: "error",
            status: "failure",
            error: err,
          });
        }
        if (forceRefresh) message.error(t("v4.refreshStatsFailed"));
      } finally {
        setCoverageLoading(false);
      }
    },
    [shop, source, targetOptions, t],
  );

  const refreshCoverageFromCache = useCallback(
    async (includeRuntimeSignals = true) => {
      try {
        // signals=0 跳过 enrichCoverageWithRuntimeSignals 的 Cosmos 扫描；首帧只要数字，
        // autoTranslate / isTranslating 标记留给后续带信号的刷新补上。
        const signalsParam = includeRuntimeSignals ? "" : "&signals=0";
        const res = await fetch(
          `/api/translate-v4/coverage?shopName=${encodeURIComponent(shop)}&cache=1${signalsParam}`,
        );
        const data = await readJsonResponse(res);
        if (data?.ok) setCoverage(data.summary as CoverageSummary);
      } catch (err) {
        // Passive cache refresh should not pollute exception telemetry.
        console.warn("[translateV4] refresh coverage from cache failed:", err);
      }
    },
    [shop],
  );

  const jobStatusRef = useRef<Map<string, string>>(new Map());
  const jobTerminalRef = useRef<Map<string, boolean>>(new Map());
  /** 额度刷新在 refreshQuota 定义之后才可用，这里用 ref 打通先后顺序。 */
  const refreshQuotaRef = useRef<() => void>(() => {});

  const applyJobsUpdate = useCallback(
    (newJobs: TranslationJobProgressSummary[]) => {
      for (const j of newJobs) {
        const prev = jobStatusRef.current.get(j.taskId);
        if (j.status === "COMPLETED" && prev !== "COMPLETED") {
          void refreshCoverageFromCache();
          notifyTranslationStatsUpdated({ target: j.target, source: j.source });
        }
        // 任务刚落终态：额度轮询是低频的，这里补一次让扣费立即可见。
        const wasTerminal = jobTerminalRef.current.get(j.taskId);
        if (j.isTerminal && wasTerminal === false) {
          refreshQuotaRef.current();
        }
        jobStatusRef.current.set(j.taskId, j.status);
        jobTerminalRef.current.set(j.taskId, Boolean(j.isTerminal));
      }
      setJobs(newJobs);
    },
    [refreshCoverageFromCache],
  );

  const refreshList = useCallback(async () => {
    const perfStart = markPerfStart("translate-v4.tasks.refresh");
    try {
      const res = await fetch(
        `/api/translate-v4/tasks?shopName=${encodeURIComponent(shop)}`,
      );
      const data = await readJsonResponse(res);
      markPerfEnd("translate-v4.tasks.refresh", perfStart, {
        status: res.status,
        ok: Boolean(data?.ok),
      });
      if (data?.ok) {
        applyJobsUpdate(data.jobs as TranslationJobProgressSummary[]);
      }
    } catch (err) {
      console.error("[translateV4] refresh list failed:", err);
      markPerfEnd("translate-v4.tasks.refresh", perfStart, {
        failed: true,
      });
    } finally {
      setJobsLoading(false);
    }
  }, [shop, applyJobsUpdate]);

  const refreshQuota = useCallback(async () => {
    const perfStart = markPerfStart("translate-v4.quota.refresh");
    try {
      const res = await fetch(
        `/api/translate-v4/quota?shopName=${encodeURIComponent(shop)}`,
      );
      const data = await readJsonResponse(res);
      markPerfEnd("translate-v4.quota.refresh", perfStart, {
        status: res.status,
        ok: Boolean(data?.ok),
      });
      if (data?.ok) {
        setQuota(normalizeShopQuota(data.quota as ShopQuota | null));
      }
    } catch (err) {
      console.error("[translateV4] refresh quota failed:", err);
      markPerfEnd("translate-v4.quota.refresh", perfStart, {
        failed: true,
      });
    }
  }, [shop]);

  refreshQuotaRef.current = () => {
    void refreshQuota();
  };

  useEffect(() => {
    const perfStart = markPerfStart("translate-v4.first-load.quota");
    void refreshQuota().finally(() => {
      markPerfEnd("translate-v4.first-load.quota", perfStart);
    });
  }, [refreshQuota]);

  const openTaskCreditsModal = useCallback(
    (job: TranslationJobProgressSummary) => {
      openCreditsPurchaseModal(
        buildTranslateV4TaskCreditsPurchaseContext(
          job,
          normalizedQuota?.remaining ?? null,
        ),
      );
    },
    [normalizedQuota],
  );

  const handleAction = useCallback(
    async (
      taskId: string,
      actionType: "pause" | "resume" | "cancel" | "delete",
    ) => {
      const trace = startClientLogTrace({
        event: "translate_v4_task_action",
        action: actionType,
        shop,
        context: {
          taskId,
        },
      });
      try {
        const res = await fetch("/api/translate-v4/task-action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId, shopName: shop, action: actionType }),
        });
        const data = await readJsonResponse(res);
        if (data?.ok) {
          const label =
            actionType === "delete"
              ? t("v4.deleted")
              : actionType === "resume"
                ? t("v4.resuming")
                : actionType === "pause"
                  ? data.pending
                    ? t("v4.pausing")
                    : t("v4.paused")
                  : data.pending
                    ? t("v4.cancelling")
                    : t("v4.cancelled");
          message.success(label);
          await Promise.all([refreshList(), refreshQuota()]);
          finishClientLogTrace(trace, {
            status: "success",
            context: {
              taskId,
              pending: Boolean(data.pending),
              httpStatus: res.status,
            },
          });
          return true;
        }
        if (
          actionType === "resume" &&
          data?.error === "v4.create.noCreditsPricing"
        ) {
          const targetJob =
            jobs.find((item) => item.taskId === taskId) ?? null;
          finishClientLogTrace(trace, {
            level: "info",
            status: "failure",
            message: t("v4.error.singleQuotaInsufficient"),
            context: {
              taskId,
              httpStatus: res.status,
              quotaBlocked: true,
            },
          });
          if (targetJob) {
            openTaskCreditsModal(targetJob);
          } else {
            openCreditsPurchaseModal();
          }
          return false;
        }
        finishClientLogTrace(trace, {
          level: "warn",
          status: "failure",
          message: data?.error
            ? translateV4Message(data.error, t)
            : t("v4.actionFailed"),
          context: {
            taskId,
            httpStatus: res.status,
          },
        });
        message.error(data?.error ? translateV4Message(data.error, t) : t("v4.actionFailed"));
        return false;
      } catch (err) {
        console.error("[translateV4] task action failed:", err);
        finishClientLogTrace(trace, {
          level: "error",
          status: "failure",
          error: err,
          context: {
            taskId,
          },
        });
        message.error(t("v4.actionFailedRetry"));
        return false;
      }
    },
    [jobs, openTaskCreditsModal, shop, refreshList, refreshQuota, t],
  );
  const remainingCredits = normalizedQuota?.remaining ?? null;

  const normalizedPlanType = planType?.trim().toLowerCase() || "";
  const hasPaidPlan =
    normalizedPlanType !== "" && normalizedPlanType !== "free";
  const createShouldGateByCredits = shouldBlockCreateTaskByCredits({
    remainingCredits,
  });
  const createQuotaGatePending = createShouldGateByCredits && isNew === null;
  const createQuotaGateMode: "trial" | "pricing" | null =
    createShouldGateByCredits && isNew !== null
      ? isNew
        ? "trial"
        : "pricing"
      : null;
  const handleCreateRequest = useCallback(() => {
    if (createQuotaGatePending) {
      message.info(
        t("Checking your trial eligibility. Please try again in a moment."),
      );
      return;
    }
    setCreateConfirmOpen(true);
  }, [createQuotaGatePending, t]);

  // After Shopify billing return: restore create-task selections and reopen confirm.
  useEffect(() => {
    if (billingDraftRestoredRef.current) return;
    const billing = parseBillingReturn(location.search);
    if (!billing) return;
    billingDraftRestoredRef.current = true;

    const cleanedPath = stripBillingReturnParams(
      `${location.pathname}${location.search}${location.hash}`,
    );
    navigate(cleanedPath, { replace: true });

    const draft = loadCreateTaskDraft(shop);
    if (!draft) return;

    const allowedTargets = new Set(targetOptions.map((option) => option.value));
    const restoredTargets = draft.targets.filter((locale) =>
      allowedTargets.has(locale),
    );
    const allowedModules = new Set<string>(CREATE_TASK_MODULE_OPTIONS);
    const restoredModules = draft.modules.filter((mod) =>
      allowedModules.has(mod),
    );
    const allowedModels = new Set(AI_MODEL_OPTIONS.map((option) => option.value));
    const restoredModel = allowedModels.has(draft.aiModel)
      ? draft.aiModel
      : DEFAULT_AI_MODEL;

    if (restoredTargets.length > 0) setTargets(restoredTargets);
    if (restoredModules.length > 0) setModuleKeys(restoredModules);
    setAiModel(restoredModel);
    setIsCover(draft.isCover);
    setIsHandle(draft.isHandle);
    setActiveWorkbenchTab("create");
    setCreateConfirmOpen(true);
    void refreshQuota();
    message.info(t("v4.create.draftRestored"));
  }, [
    location.hash,
    location.pathname,
    location.search,
    navigate,
    refreshQuota,
    shop,
    t,
    targetOptions,
  ]);

  const handleCreateConfirm = useCallback(async () => {
    if (createQuotaGatePending) {
      message.info(
        t("Checking your trial eligibility. Please try again in a moment."),
      );
      return;
    }
    if (createQuotaGateMode !== null) return;

    setCreateConfirmOpen(false);
    const remainingCredits = normalizedQuota?.remaining ?? null;
    if (remainingCredits == null) {
      message.info(t("v4.create.quotaUnavailable"));
      return;
    }
    if (shouldBlockCreateTaskByCredits({ remainingCredits })) {
      return;
    }

    clearCreateTaskDraft(shop);
    setCreating(true);
    const trace = startClientLogTrace({
      event: "translate_v4_create_tasks",
      action: "create_tasks",
      shop,
      context: {
        source,
        targets,
        moduleKeys,
        aiModel,
        isCover,
        isHandle,
        includeLiquid,
      },
    });
    try {
      const result = await createTranslateV4Tasks({
        source,
        targets,
        modules: expandV2ModuleKeys(moduleKeys),
        aiModel,
        isCover,
        isHandle,
        includeLiquid,
        targetOptions,
        shop,
      });

      if (result.validationError) {
        finishClientLogTrace(trace, {
          level: "warn",
          status: "failure",
          message: result.validationError,
        });
        message.warning(translateV4Message(result.validationError, t));
        return;
      }

      const summary = formatV4CreateTasksMessage(result, t, localeRegionCode);
      if (result.created.length > 0) {
        message.success(`${summary} ${t("v4.create.createdBelow")}`);
        await Promise.all([refreshList(), refreshQuota()]);
        setActiveWorkbenchTab("tasks");
        setSpotlightTaskIds(result.created.map((item) => item.jobId));
      } else {
        message.error(summary);
      }

      finishClientLogTrace(trace, {
        level:
          result.failed.length > 0
            ? result.created.length > 0
              ? "warn"
              : "error"
            : "info",
        status:
          result.failed.length > 0 && result.created.length === 0
            ? "failure"
            : "success",
        message: summary,
        context: {
          created: result.created.map((item) => item.target),
          failed: result.failed.map((item) => ({
            target: item.target,
            error: item.error,
          })),
        },
      });

      if (result.failed.length > 0 && result.created.length > 0) {
        message.warning(
          result.failed
            .map(
              (f) =>
                `${localeRegionCode(f.target)}: ${translateV4Message(f.error, t)}`,
            )
            .join("；"),
          6,
        );
      }
    } catch (err) {
      console.error("[translateV4] create failed:", err);
      finishClientLogTrace(trace, {
        level: "error",
        status: "failure",
        error: err,
      });
      message.error(t("v4.createFailedRetry"));
    } finally {
      setCreating(false);
    }
  }, [
    source,
    targets,
    moduleKeys,
    aiModel,
    isCover,
    isHandle,
    includeLiquid,
    targetOptions,
    shop,
    refreshList,
    refreshQuota,
    normalizedQuota,
    t,
    createQuotaGateMode,
    createQuotaGatePending,
  ]);

  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stablePollCount = 0;
    let lastActiveJobsSignature = "";
    // 首屏 effect 已拉过一次额度，从挂载时刻开始计时。
    let lastQuotaAt = Date.now();

    const getNextDelay = () => {
      if (typeof document !== "undefined" && document.hidden) return 30_000;
      return Math.min(30_000, 3_000 * 2 ** Math.min(stablePollCount, 3));
    };

    const poll = () => {
      if (disposed) return;
      const hasActive = jobsRef.current.some((j) => !j.isTerminal);
      if (!hasActive) {
        stablePollCount = 0;
        timer = setTimeout(poll, 10_000);
        return;
      }

      const signature = jobsRef.current
        .filter((j) => !j.isTerminal)
        .map(
          (j) =>
            `${j.taskId}:${j.status}:${j.progressPercent ?? ""}:${j.updatedAt}`,
        )
        .join("|");

      stablePollCount =
        signature === lastActiveJobsSignature ? stablePollCount + 1 : 0;
      lastActiveJobsSignature = signature;

      if (typeof document === "undefined" || !document.hidden) {
        void refreshList();
        // 进度变化时列表会退回 3s 一轮，但额度不需要这个新鲜度：低频轮询兜住外部
        // 变化（充值 / 其它标签页），扣费可见性由终态跃迁那次补刷负责。
        if (Date.now() - lastQuotaAt >= QUOTA_POLL_MIN_INTERVAL_MS) {
          lastQuotaAt = Date.now();
          void refreshQuota();
        }
      }

      timer = setTimeout(poll, getNextDelay());
    };

    timer = setTimeout(poll, 3_000);

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [refreshList, refreshQuota]);

  const firstLoadDone = useRef(false);
  useEffect(() => {
    if (firstLoadDone.current) return;
    firstLoadDone.current = true;
    // 文档已不再阻塞等这两份数据，首帧挂载后立即并行补齐。
    const perfStart = markPerfStart("translate-v4.first-load.content");
    void Promise.all([
      refreshList(),
      refreshCoverageFromCache(false).finally(() => setCoverageLoading(false)),
    ]).finally(() => {
      markPerfEnd("translate-v4.first-load.content", perfStart);
    });
  }, [refreshCoverageFromCache, refreshList]);

  const translateSlotBusy = useMemo(
    () => jobs.some((j) => j.status === "TRANSLATING" || j.isStopping),
    [jobs],
  );

  const createTaskSectionRef = useRef<HTMLDivElement | null>(null);
  const taskQueueSectionRef = useRef<HTMLDivElement | null>(null);

  const untranslatedRatioByLocale = useMemo(
    () => buildUntranslatedRatioByLocale(coverage.locales),
    [coverage.locales],
  );
  const taskEstimate = useCreateTaskEstimate({
    modules: moduleKeys,
    targets,
    isCover,
    includeLiquid,
    untranslatedRatioByLocale,
    remainingCredits,
  });
  const createConfirmScenario:
    | "ready"
    | "insufficient_paid"
    | "insufficient_trial"
    | "insufficient_pricing" =
    taskEstimate.needsMoreCredits
      ? hasPaidPlan
        ? "insufficient_paid"
        : createQuotaGateMode === "trial"
          ? "insufficient_trial"
          : "insufficient_pricing"
      : "ready";

  useEffect(() => {
    if (spotlightTaskIds.length === 0) return;
    if (typeof window === "undefined") return;
    setActiveWorkbenchTab("tasks");

    const scrollTimer = window.setTimeout(() => {
      taskQueueSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 140);
    const clearTimer = window.setTimeout(() => {
      setSpotlightTaskIds([]);
    }, 7_000);

    return () => {
      window.clearTimeout(scrollTimer);
      window.clearTimeout(clearTimer);
    };
  }, [spotlightTaskIds]);

  const openLanguagePage = useCallback(() => {
    navigate("/app/language");
  }, [navigate]);

  return (
    <Page>
      <TitleBar title={t("v4.title")} />
      <Profiler
        id="translate-v4.page"
        onRender={(id, phase, actualDuration, baseDuration, startTime, commitTime) => {
          if (!perfDebugEnabled) return;
          logReactProfilerRender(
            id,
            phase,
            actualDuration,
            baseDuration,
            startTime,
            commitTime,
          );
        }}
      >
        <div className="v4-page" style={v4ContentStyle}>
          <div>
            <PageHeaderBar credits={remainingCredits} planType={planType} />
          </div>

          <div
            style={{
              display: "grid",
              gap: 18,
              alignItems: "start",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1.45fr) minmax(320px, 0.92fr)",
                gap: 18,
                alignItems: coverageExpanded ? "start" : "stretch",
              }}
            >
              <div
                style={{
                  display: "flex",
                  minHeight: V4_OVERVIEW_CARD_MIN_HEIGHT,
                  ...(coverageExpanded
                    ? {
                        alignSelf: "flex-start",
                        height: V4_OVERVIEW_CARD_MIN_HEIGHT,
                      }
                    : null),
                }}
              >
                <SummaryDonutCard
                  summary={coverage}
                  compact
                  loading={coverageLoading && coverage.locales.length === 0}
                />
              </div>
              <div
                style={{
                  display: "flex",
                  minHeight: V4_OVERVIEW_CARD_MIN_HEIGHT,
                }}
              >
                <CoverageCard
                  locales={coverage.locales}
                  loading={coverageLoading}
                  onRefresh={refreshCoverage}
                  compact
                  onManageLanguages={openLanguagePage}
                  onExpandedChange={setCoverageExpanded}
                  fillPairHeight={!coverageExpanded}
                />
              </div>
            </div>

            <div
              className="v4-enter v4-enter-d2"
              style={workbenchTabsShellStyle}
            >
              <div
                role="tablist"
                aria-label={t("v4.title")}
                style={workbenchTabListStyle}
              >
                <button
                  id="v4-workbench-tab-create"
                  type="button"
                  role="tab"
                  aria-selected={activeWorkbenchTab === "create"}
                  aria-controls="v4-workbench-panel-create"
                  onClick={() => setActiveWorkbenchTab("create")}
                  style={workbenchTabButtonStyle(
                    activeWorkbenchTab === "create",
                  )}
                >
                  {t("v4.createTask.title")}
                </button>
                <button
                  id="v4-workbench-tab-tasks"
                  type="button"
                  role="tab"
                  aria-selected={activeWorkbenchTab === "tasks"}
                  aria-controls="v4-workbench-panel-tasks"
                  onClick={() => setActiveWorkbenchTab("tasks")}
                  style={workbenchTabButtonStyle(
                    activeWorkbenchTab === "tasks",
                  )}
                >
                  {t("v4.tasks.title", { count: currentJobCount })}
                </button>
              </div>

              <div
                id="v4-workbench-panel-create"
                role="tabpanel"
                aria-labelledby="v4-workbench-tab-create"
                hidden={activeWorkbenchTab !== "create"}
                style={workbenchPanelStyle(activeWorkbenchTab === "create")}
              >
                <div ref={createTaskSectionRef}>
                  <CreateTaskCard
                    targetOptions={targetOptions}
                    targets={targets}
                    onTargetsChange={setTargets}
                    modules={moduleKeys}
                    onModulesChange={setModuleKeys}
                    creating={creating}
                    createDisabled={normalizedQuota == null}
                    disabledMessage={createDisabledMessage}
                    onCreate={handleCreateRequest}
                    aiModel={aiModel}
                    onAiModelChange={setAiModel}
                    isCover={isCover}
                    onIsCoverChange={setIsCover}
                    isHandle={isHandle}
                    onIsHandleChange={setIsHandle}
                    includeLiquid={includeLiquid}
                    onIncludeLiquidChange={setIncludeLiquid}
                    estimate={taskEstimate}
                  />
                </div>
              </div>

              <div
                id="v4-workbench-panel-tasks"
                role="tabpanel"
                aria-labelledby="v4-workbench-tab-tasks"
                hidden={activeWorkbenchTab !== "tasks"}
                style={workbenchPanelStyle(activeWorkbenchTab === "tasks")}
              >
                <div
                  ref={taskQueueSectionRef}
                  className="v4-enter v4-enter-d3"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr)",
                    gap: 16,
                  }}
                >
                  <TaskQueueSection
                    jobs={jobs}
                    spotlightTaskIds={spotlightTaskIds}
                    translateSlotBusy={translateSlotBusy}
                    loading={jobsLoading}
                    onBuyCredits={openTaskCreditsModal}
                    onAction={handleAction}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </Profiler>

      <CreateTaskConfirmModal
        open={createConfirmOpen}
        creating={creating}
        targetOptions={targetOptions}
        targets={targets}
        modules={moduleKeys}
        aiModel={aiModel}
        isCover={isCover}
        isHandle={isHandle}
        includeLiquid={includeLiquid}
        sourceLocale={source}
        estimate={taskEstimate}
        scenario={createConfirmScenario}
        previousTotalChars={
          typeof totalChars === "number" ? totalChars : undefined
        }
        onClose={() => setCreateConfirmOpen(false)}
        onConfirmCreate={handleCreateConfirm}
        onBeforeBilling={persistCreateTaskDraft}
        onBuyCredits={(detailedCredits) => {
          setCreateConfirmOpen(false);
          openCreditsPurchaseModal(
            buildCreateTaskCreditsPurchaseContext({
              estimatedCredits:
                detailedCredits ?? taskEstimate?.estimatedCredits ?? null,
              currentRemainingCredits: normalizedQuota?.remaining ?? null,
              targetsCount: targets.length,
              modulesCount: moduleKeys.length,
            }),
          );
        }}
      />
    </Page>
  );
}

const workbenchTabsShellStyle: CSSProperties = {
  display: "grid",
  gap: 14,
};

const workbenchTabListStyle: CSSProperties = {
  display: "inline-flex",
  flexWrap: "wrap",
  gap: 8,
  padding: 4,
  borderRadius: 999,
  background: "var(--app-color-surface-secondary)",
  alignSelf: "flex-start",
};

function workbenchTabButtonStyle(active: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    maxWidth: "100%",
    minHeight: 36,
    padding: "8px 14px",
    borderRadius: 999,
    border: "none",
    background: active ? "var(--app-color-surface)" : "transparent",
    color: active ? "var(--app-color-text)" : "var(--app-color-text-secondary)",
    boxShadow: active ? "var(--app-shadow-card)" : "none",
    fontSize: 13,
    fontWeight: active ? 600 : 500,
    lineHeight: 1.35,
    textAlign: "center",
    whiteSpace: "normal",
    overflowWrap: "anywhere",
    transition: "all 0.2s ease",
    cursor: "pointer",
    fontFamily: "inherit",
  };
}

function workbenchPanelStyle(active: boolean): CSSProperties {
  return {
    display: active ? "block" : "none",
    minWidth: 0,
  };
}
