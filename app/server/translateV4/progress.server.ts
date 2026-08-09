import { getTranslateV4RedisClient, v4ControlKey, v4ProgressKey, type V4ControlAction } from "./redis.server";
import {
  getV4Job,
  listV4JobSummaryDocs,
  updateV4Job,
  type V4JobSummaryDoc,
} from "./cosmos.server";
import { escalateStuckPauseIfNeeded } from "./pauseReconcile.server";
import {
  escalateStuckTranslatingToWritebackIfNeeded,
  isTranslateCompleteButWritebackPending,
} from "./stageReconcile.server";
import {
  capTranslateUnitsByResources,
  isTranslateResourceComplete,
  reconcileTranslateUnitMetrics,
} from "./metricsUtils";
import { writebackResourceTotal } from "./resumeStatus";
import { sanitizeV4UserErrorMessage } from "./userFacingMessages.server";
import { isV4CancelledMessage } from "~/shared/translateV4MessageTokens";
import {
  ACTIVE_V4_STATUSES,
  EMPTY_V4_METRICS,
  TERMINAL_V4_STATUSES,
  type StageTimings,
  type TranslationV4Job,
  type TranslationV4Metrics,
  type TranslationV4Status,
} from "./types";

/** Human-readable unit label for field / HTML fragment counts. */
const TRANSLATION_V4_UNIT_LABEL = "Items";

/** Init worker coarse phase for a single in-flight module (Redis activity). */
export type V4InitModulePhase = "querying" | "saving";

export type V4InitActiveModule = {
  module: string;
  phase: V4InitModulePhase;
};

export type V4InitCompletedModule = {
  module: string;
  items: number;
};

export type TranslationV4MergedMetrics = TranslationV4Metrics & {
  currentModule: string | null;
  translateStartedAt: string | null;
  progressUpdatedAt: string | null;
  /** worker 触发暂停后、Cosmos 尚未落盘前的 Redis 信号 */
  pausePending: boolean;
  pauseReason: string | null;
  /** 控制键仍 pending（API 已写入、worker 尚未消费） */
  controlAction: V4ControlAction | null;
  /** API 写入 pausePending 的时间戳（ms） */
  pauseRequestedAt: string | null;
  /** Selected module count for init x/N progress (Redis). */
  initModulesTotal: number;
  /** Fully finished init modules (Redis). */
  initModulesDone: number;
  /** In-flight init modules with coarse phase (Redis JSON). */
  initActiveModules: V4InitActiveModule[];
  /** Completed init modules with item counts (Redis JSON). */
  initCompletedModules: V4InitCompletedModule[];
  /** Job-level init phase, e.g. writing_manifest (Redis). */
  initPhase: string | null;
};

function parseInitActiveModules(raw: string | undefined): V4InitActiveModule[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: V4InitActiveModule[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const module = String((item as { module?: unknown }).module ?? "").trim();
      const phase = String((item as { phase?: unknown }).phase ?? "").trim();
      if (!module) continue;
      if (phase !== "querying" && phase !== "saving") continue;
      out.push({ module, phase });
    }
    return out;
  } catch {
    return [];
  }
}

function parseInitCompletedModules(
  raw: string | undefined,
): V4InitCompletedModule[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: V4InitCompletedModule[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const module = String((item as { module?: unknown }).module ?? "").trim();
      const items = Number((item as { items?: unknown }).items) || 0;
      if (!module) continue;
      out.push({ module, items });
    }
    return out;
  } catch {
    return [];
  }
}

/** 合并 Cosmos 持久化 metrics 与 worker 实时写入 Redis 的进度。 */
export function mergeV4JobMetrics(
  job: V4JobSummaryDoc,
  redisProgress: Record<string, string>,
  controlAction: V4ControlAction | null = null,
): TranslationV4MergedMetrics {
  const jobMetrics = job.metrics ?? EMPTY_V4_METRICS;
  // 计数器在单个 run 内单调递增；两源取 max 而非「redis || cosmos」，避免某一源瞬时
  // 为 0/空（pause/resume 切换、Redis 与 Cosmos 短暂不一致）时进度回退闪 0。
  const merge = (key: keyof TranslationV4Metrics): number =>
    Math.max(Number(redisProgress[key]) || 0, Number(jobMetrics[key]) || 0);
  const translateDone = merge("translateDone");
  const translateTotal = merge("translateTotal");
  const mergedUnits = reconcileTranslateUnitMetrics({
    translateDone,
    translateTotal,
    translateUnitDone: merge("translateUnitDone"),
    translateUnitTotal: merge("translateUnitTotal"),
  });
  return {
    initTotal: merge("initTotal"),
    initDone: merge("initDone"),
    translateTotal,
    translateDone,
    translateFailed: merge("translateFailed"),
    translateFallback: Math.max(
      Number(redisProgress.translateFallback) || 0,
      Number(jobMetrics.translateFallback) || 0,
    ),
    translateUnitTotal: mergedUnits.translateUnitTotal,
    translateUnitDone: mergedUnits.translateUnitDone,
    writebackTotal: merge("writebackTotal"),
    writebackDone: merge("writebackDone"),
    writebackFailed: merge("writebackFailed"),
    verifyTotal: merge("verifyTotal"),
    verifyDone: merge("verifyDone"),
    verifyFailed: merge("verifyFailed"),
    usedTokens: merge("usedTokens"),
    currentModule: redisProgress.currentModule ?? null,
    translateStartedAt: redisProgress.translateStartedAt ?? null,
    progressUpdatedAt: redisProgress.updatedAt ?? null,
    pausePending: redisProgress.pausePending === "1",
    pauseReason: redisProgress.pauseReason?.trim() || null,
    controlAction,
    pauseRequestedAt: redisProgress.pauseRequestedAt ?? null,
    initModulesTotal: Number(redisProgress.initModulesTotal) || 0,
    initModulesDone: Number(redisProgress.initModulesDone) || 0,
    initActiveModules: parseInitActiveModules(redisProgress.initActiveModules),
    initCompletedModules: parseInitCompletedModules(
      redisProgress.initCompletedModules,
    ),
    initPhase: redisProgress.initPhase?.trim() || null,
  };
}

/**
 * UI 展示用状态：保留真实状态。
 * 注意——以前会把「TRANSLATING + pausePending」提前显示成 PAUSED，但那会让「继续」
 * 按钮提前出现、随后又因 worker 进入写回而消失，造成闪烁。现改为不提前翻转，由
 * `isStopping` 标志单独驱动「正在暂停…」展示（见 toProgressSummary）。
 */
export function resolveV4DisplayStatus(
  status: TranslationV4Status,
): TranslationV4Status {
  return status;
}

function isCancelledUserMessage(message: string | null | undefined): boolean {
  return isV4CancelledMessage(message);
}

export function translationV4StatusLabel(
  status: TranslationV4Status,
  errorMessage?: string | null,
  metrics?: TranslationV4Metrics,
): string {
  // Pause reason lives in errorMessage / job notice; status label stays "Paused".
  void errorMessage;
  if (status === "TRANSLATE_QUEUED" && metrics) {
    const started =
      metrics.translateDone > 0 ||
      metrics.translateUnitDone > 0 ||
      metrics.translateTotal > 0;
    if (started) return "Queued to resume translation";
  }
  if (status === "WRITEBACK_QUEUED" && metrics && metrics.writebackDone > 0) {
    return "Queued to resume write-back";
  }
  const labels: Record<TranslationV4Status, string> = {
    CREATED: "Created",
    INIT_QUEUED: "Waiting to initialize",
    INITIALIZING: "Initializing",
    INIT_DONE: "Initialization complete",
    TRANSLATE_QUEUED: "Waiting to translate",
    TRANSLATING: "Translating",
    TRANSLATE_DONE: "Translation complete",
    WRITEBACK_QUEUED: "Waiting to write back",
    WRITING_BACK: "Writing back to Shopify",
    VERIFY_QUEUED: "Write-back complete",
    VERIFYING: "Write-back complete",
    COMPLETED: "Completed",
    FAILED: "Failed",
    PAUSED: "Paused",
    CANCELLED: "Cancelled",
  };
  return labels[status] ?? status;
}

function ratioPercent(done: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.min(100, Math.round((done / total) * 100));
}

function taskResourceTotal(metrics: TranslationV4Metrics): number {
  return metrics.translateTotal || metrics.initTotal || 0;
}

/** 任务已结束时的整体进度：按写回实际成功比例，避免写回仅一半仍显示 100%。 */
function completedJobProgressPercent(metrics: TranslationV4Metrics): number {
  const total = taskResourceTotal(metrics);
  if (total > 0) {
    return ratioPercent(metrics.writebackDone, total) ?? 0;
  }
  return 100;
}

/** 当前阶段的进度百分比；终态(非完成)返回 null。 */
export function computeTranslationV4ProgressPercent(
  status: TranslationV4Status,
  metrics: TranslationV4Metrics,
  errorStage?: string | null,
): number | null {
  if (status === "COMPLETED") return completedJobProgressPercent(metrics);
  if (TERMINAL_V4_STATUSES.includes(status)) return null;

  if (status === "PAUSED") {
    switch (errorStage) {
      case "WRITEBACK": {
        const total = taskResourceTotal(metrics);
        return total > 0 ? ratioPercent(metrics.writebackDone, total) : null;
      }
      case "TRANSLATE":
      default:
        if (metrics.translateUnitTotal > 0) {
          return ratioPercent(
            capTranslateUnitsByResources(metrics),
            metrics.translateUnitTotal,
          );
        }
        return ratioPercent(metrics.translateDone, taskResourceTotal(metrics));
    }
  }

  if (
    status === "INIT_QUEUED" ||
    status === "INITIALIZING" ||
    status === "INIT_DONE" ||
    status === "CREATED"
  ) {
    const modulesTotal =
      "initModulesTotal" in metrics
        ? Number((metrics as TranslationV4MergedMetrics).initModulesTotal) || 0
        : 0;
    const modulesDone =
      "initModulesDone" in metrics
        ? Number((metrics as TranslationV4MergedMetrics).initModulesDone) || 0
        : 0;
    if (modulesTotal > 0) {
      return ratioPercent(modulesDone, modulesTotal);
    }
    return ratioPercent(metrics.initDone, metrics.initTotal);
  }

  if (
    status === "TRANSLATE_QUEUED" ||
    status === "TRANSLATING" ||
    status === "TRANSLATE_DONE"
  ) {
    if (isTranslateResourceComplete(metrics)) {
      const total = writebackResourceTotal(metrics);
      return total > 0 ? ratioPercent(metrics.writebackDone, total) : 100;
    }
    const resourceTotal = taskResourceTotal(metrics);
    if (resourceTotal > 0) {
      return ratioPercent(metrics.translateDone, resourceTotal);
    }
    if (metrics.translateUnitTotal > 0) {
      return ratioPercent(
        capTranslateUnitsByResources(metrics),
        metrics.translateUnitTotal,
      );
    }
    return null;
  }

  if (status === "WRITEBACK_QUEUED" || status === "WRITING_BACK") {
    const total = taskResourceTotal(metrics);
    return total > 0 ? ratioPercent(metrics.writebackDone, total) : null;
  }

  if (status === "VERIFY_QUEUED" || status === "VERIFYING") {
    const total = taskResourceTotal(metrics);
    return total > 0 ? ratioPercent(metrics.writebackDone, total) : 100;
  }

  return null;
}

function formatTranslateDetail(
  metrics: TranslationV4MergedMetrics,
): string | null {
  if (metrics.translateUnitTotal <= 0) return null;
  const unit = `${TRANSLATION_V4_UNIT_LABEL} ${metrics.translateUnitDone.toLocaleString()}/${metrics.translateUnitTotal.toLocaleString()}`;
  if (metrics.translateTotal > 0) {
    return `${unit} · ${metrics.translateDone.toLocaleString()}/${metrics.translateTotal.toLocaleString()}`;
  }
  return unit;
}

/** 当前阶段的一句话摘要文案。 */
export function buildTranslationV4StageSummary(
  status: TranslationV4Status,
  metrics: TranslationV4MergedMetrics,
  errorMessage?: string | null,
  errorStage?: string | null,
): string {
  const label = translationV4StatusLabel(status, errorMessage);

  if (status === "PAUSED") {
    if (errorStage === "TRANSLATE" || !errorStage) {
      const detail = formatTranslateDetail(metrics);
      const taskTotal = taskResourceTotal(metrics);
      const writebackNote =
        taskTotal > 0 && metrics.writebackDone > 0
          ? metrics.writebackDone >= taskTotal
            ? `Write-back ${metrics.writebackDone}/${taskTotal} complete`
            : `Write-back ${metrics.writebackDone}/${taskTotal}`
          : null;
      return [label, detail, writebackNote].filter(Boolean).join(" · ");
    }
    if (errorStage === "WRITEBACK") {
      const taskTotal = taskResourceTotal(metrics);
      if (taskTotal > 0) {
        return `${label} · ${metrics.writebackDone}/${taskTotal}`;
      }
    }
    return label;
  }

  if (
    status === "TRANSLATING" ||
    status === "TRANSLATE_QUEUED" ||
    status === "TRANSLATE_DONE"
  ) {
    const detail = formatTranslateDetail(metrics);
    const modulePart = metrics.currentModule
      ? `Current module ${metrics.currentModule}`
      : null;
    return [label, detail, modulePart].filter(Boolean).join(" · ");
  }

  if (
    status === "INITIALIZING" ||
    status === "INIT_QUEUED" ||
    status === "INIT_DONE"
  ) {
    if (metrics.initTotal > 0) return `${label} · ${metrics.initDone}/${metrics.initTotal}`;
    return label;
  }

  if (status === "WRITING_BACK" || status === "WRITEBACK_QUEUED") {
    const taskTotal = taskResourceTotal(metrics);
    if (taskTotal > 0) {
      return `${label} · ${metrics.writebackDone}/${taskTotal}`;
    }
    return label;
  }

  if (status === "VERIFYING" || status === "VERIFY_QUEUED") {
    const taskTotal = taskResourceTotal(metrics);
    if (taskTotal > 0) {
      return `${label} · ${metrics.writebackDone}/${taskTotal}`;
    }
    return label;
  }

  if (status === "FAILED" && metrics.translateFailed > 0) {
    return `${label} · ${metrics.translateFailed} item(s) failed`;
  }

  return label;
}

export type TranslationJobProgressSummary = {
  taskId: string;
  status: TranslationV4Status;
  statusLabel: string;
  isActive: boolean;
  isTerminal: boolean;
  /** 已请求暂停/取消、worker 仍在翻译收尾（等在飞 LLM）的过渡态。 */
  isStopping: boolean;
  /** 是否允许点「继续」（PAUSED/FAILED 且不在收尾中）。 */
  canResume: boolean;
  source: string;
  target: string;
  modules: string[];
  aiModel: string;
  taskSource: string | null;
  createdAt: string;
  updatedAt: string;
  errorMessage: string | null;
  errorStage: string | null;
  stageSummary: string;
  stageTimings: StageTimings | null;
  progressPercent: number | null;
  usedTokens: number;
  metrics: {
    initDone: number;
    initTotal: number;
    translateDone: number;
    translateTotal: number;
    translateUnitDone: number;
    translateUnitTotal: number;
    translateFailed: number;
    writebackDone: number;
    writebackTotal: number;
    writebackFailed: number;
    verifyDone: number;
    verifyTotal: number;
    verifyFailed: number;
    currentModule: string | null;
    initModulesDone: number;
    initModulesTotal: number;
    initActiveModules: V4InitActiveModule[];
    initCompletedModules: V4InitCompletedModule[];
    initPhase: string | null;
  };
};

function toProgressSummary(
  job: V4JobSummaryDoc,
  metrics: TranslationV4MergedMetrics,
): TranslationJobProgressSummary {
  /**
   * 暂停/取消触发的「先写回已翻译」阶段（仅兼容升级前已在写回中的任务）。
   * 新任务暂停不再走写回，正常写回仍用 WRITING_BACK。
   */
  const writebackPauseLabel =
    (job.status === "WRITEBACK_QUEUED" || job.status === "WRITING_BACK") &&
    job.pauseAfterWriteback
      ? job.pauseAfterWriteback === "cancel"
        ? "Cancelled, writing back remaining content"
        : "Paused, writing back remaining content"
      : null;
  const writebackWhileTranslating =
    isTranslateCompleteButWritebackPending(job.status, metrics)
      ? metrics.writebackDone > 0
        ? "Writing back to Shopify"
        : "Waiting to write back"
      : null;
  // 已请求暂停/取消但 worker 仍在翻译收尾（尚未进入写回）的过渡态。
  const isStopping =
    job.status === "TRANSLATING" &&
    (metrics.pausePending ||
      metrics.controlAction === "pause" ||
      metrics.controlAction === "cancel");
  const stoppingLabel =
    metrics.controlAction === "cancel" || isCancelledUserMessage(metrics.pauseReason)
      ? "Cancelling…"
      : "Pausing…";
  // 过渡态不把 pauseReason 当作 errorMessage 暴露——否则顶部「正在暂停…」与底部
  // 「已手动暂停」同时出现，语义重复且像两个矛盾状态。
  const errorMessage = sanitizeV4UserErrorMessage(
    job.errorMessage ?? (isStopping ? null : metrics.pauseReason),
  );
  const displayStatus =
    job.status === "CANCELLED" || (!isStopping && isCancelledUserMessage(errorMessage))
      ? "CANCELLED"
      : resolveV4DisplayStatus(job.status);
  const errorStage =
    job.errorStage ?? (displayStatus === "PAUSED" ? "TRANSLATE" : null);
  const canResume =
    (displayStatus === "PAUSED" || displayStatus === "FAILED") &&
    !isStopping &&
    !metrics.pausePending &&
    !metrics.controlAction;
  return {
    taskId: job.id,
    status: displayStatus,
    statusLabel:
      writebackPauseLabel ??
      writebackWhileTranslating ??
      (isStopping ? stoppingLabel : translationV4StatusLabel(displayStatus, errorMessage, metrics)),
    isStopping,
    canResume,
    isActive:
      ACTIVE_V4_STATUSES.includes(displayStatus) &&
      !metrics.pausePending &&
      !metrics.controlAction,
    isTerminal: TERMINAL_V4_STATUSES.includes(displayStatus),
    source: job.source,
    target: job.target,
    modules: job.modules,
    aiModel: job.aiModel,
    taskSource: job.taskSource ?? null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    errorMessage,
    errorStage,
    stageSummary: buildTranslationV4StageSummary(
      displayStatus,
      metrics,
      errorMessage,
      errorStage,
    ),
    stageTimings: job.stageTimings ?? null,
    progressPercent: computeTranslationV4ProgressPercent(
      displayStatus,
      metrics,
      errorStage,
    ),
    usedTokens: metrics.usedTokens,
    metrics: {
      initDone: metrics.initDone,
      initTotal: metrics.initTotal,
      translateDone: metrics.translateDone,
      translateTotal: metrics.translateTotal,
      translateUnitDone: metrics.translateUnitDone,
      translateUnitTotal: metrics.translateUnitTotal,
      translateFailed: metrics.translateFailed,
      writebackDone: metrics.writebackDone,
      writebackTotal: metrics.writebackTotal,
      writebackFailed: metrics.writebackFailed,
      verifyDone: metrics.verifyDone,
      verifyTotal: metrics.verifyTotal,
      verifyFailed: metrics.verifyFailed,
      currentModule: metrics.currentModule,
      initModulesDone: metrics.initModulesDone,
      initModulesTotal: metrics.initModulesTotal,
      initActiveModules: metrics.initActiveModules,
      initCompletedModules: metrics.initCompletedModules,
      initPhase: metrics.initPhase,
    },
  };
}

async function readRedisProgress(
  taskId: string,
): Promise<{ progress: Record<string, string>; control: V4ControlAction | null }> {
  try {
    const redis = getTranslateV4RedisClient();
    const [progress, controlRaw] = await Promise.all([
      redis.hgetall(v4ProgressKey(taskId)),
      redis.get(v4ControlKey(taskId)),
    ]);
    const control =
      controlRaw === "pause" || controlRaw === "cancel" ? controlRaw : null;
    return { progress, control };
  } catch {
    return { progress: {}, control: null };
  }
}

/** 列表页批量读取活跃任务的 Redis 进度 + 控制键（含写回/校验阶段，保证写回进度实时）。 */
async function batchReadRedisForJobs(
  jobs: V4JobSummaryDoc[],
): Promise<Map<string, { progress: Record<string, string>; control: V4ControlAction | null }>> {
  const activeIds = jobs.filter((j) => ACTIVE_V4_STATUSES.includes(j.status)).map((j) => j.id);
  const out = new Map<
    string,
    { progress: Record<string, string>; control: V4ControlAction | null }
  >();
  if (!activeIds.length) return out;

  try {
    const redis = getTranslateV4RedisClient();
    const pipeline = redis.pipeline();
    for (const id of activeIds) {
      pipeline.hgetall(v4ProgressKey(id));
      pipeline.get(v4ControlKey(id));
    }
    const results = await pipeline.exec();
    if (!results) return out;

    for (let i = 0; i < activeIds.length; i++) {
      const progressResult = results[i * 2];
      const controlResult = results[i * 2 + 1];
      const progress =
        progressResult?.[1] && typeof progressResult[1] === "object"
          ? (progressResult[1] as Record<string, string>)
          : {};
      const controlRaw = controlResult?.[1];
      const control =
        controlRaw === "pause" || controlRaw === "cancel" ? controlRaw : null;
      out.set(activeIds[i], { progress, control });
    }
  } catch {
    // non-fatal — 列表仍可用 Cosmos 快照
  }
  return out;
}

/** 清掉历史上误写入 Cosmos 的 worker 内部文案。 */
async function healInternalErrorMessageIfNeeded(
  shopName: string,
  job: TranslationV4Job,
): Promise<TranslationV4Job> {
  if (
    !job.errorMessage ||
    sanitizeV4UserErrorMessage(job.errorMessage) ||
    (job.status !== "PAUSED" && job.status !== "FAILED")
  ) {
    return job;
  }
  const healed = await updateV4Job(shopName, job.id, { errorMessage: null });
  return healed ?? { ...job, errorMessage: null };
}

/** 单个任务的实时进度摘要（Cosmos + Redis 合并）。 */
export async function getV4JobProgressSummary(
  shopName: string,
  taskId: string,
): Promise<TranslationJobProgressSummary | null> {
  let job = await getV4Job(shopName, taskId);
  if (!job) return null;
  job = await healInternalErrorMessageIfNeeded(shopName, job);
  const { progress, control } = await readRedisProgress(taskId);
  const metrics = mergeV4JobMetrics(job, progress, control);
  const escalated = await escalateStuckPauseIfNeeded(shopName, job, metrics);
  if (escalated) {
    job = escalated;
    return toProgressSummary(job, mergeV4JobMetrics(job, {}, null));
  }
  const writebackEscalated = await escalateStuckTranslatingToWritebackIfNeeded(
    shopName,
    job,
    metrics,
  );
  if (writebackEscalated) {
    job = writebackEscalated;
    return toProgressSummary(job, mergeV4JobMetrics(job, {}, null));
  }
  return toProgressSummary(job, metrics);
}

/**
 * 任务列表摘要。仅做 Cosmos 查询（不逐条读 Redis，避免列表 N 次往返）；
 * 活跃任务的实时细节由前端逐条轮询 task-progress 获取。
 */
export async function listV4JobSummaries(
  shopName: string,
  options?: { limit?: number; taskSource?: string; escalateStuck?: boolean },
): Promise<TranslationJobProgressSummary[]> {
  const limit = Math.min(Math.max(options?.limit ?? 30, 1), 50);
  const escalateStuck = options?.escalateStuck ?? true;
  const jobs = await listV4JobSummaryDocs(shopName, limit);
  const filtered = options?.taskSource
    ? jobs.filter((j) => (j.taskSource ?? null) === options.taskSource)
    : jobs;
  const redisByTaskId = await batchReadRedisForJobs(filtered);
  const summaries: TranslationJobProgressSummary[] = [];
  for (const job of filtered) {
    try {
      const redis = redisByTaskId.get(job.id);
      const metrics = mergeV4JobMetrics(
        job,
        redis?.progress ?? {},
        redis?.control ?? null,
      );
      let escalated: TranslationV4Job | null = null;
      let writebackEscalated: TranslationV4Job | null = null;

      if (escalateStuck) {
        escalated = await escalateStuckPauseIfNeeded(shopName, job, metrics);
        writebackEscalated =
          escalated ??
          (await escalateStuckTranslatingToWritebackIfNeeded(shopName, job, metrics));
      }

      const finalJob = writebackEscalated ?? escalated ?? job;
      summaries.push(
        toProgressSummary(
          finalJob,
          writebackEscalated || escalated
            ? mergeV4JobMetrics(finalJob, {}, null)
            : metrics,
        ),
      );
    } catch {
      continue;
    }
  }
  return summaries;
}
