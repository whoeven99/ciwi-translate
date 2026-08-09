/**
 * 跨店公平 claim：分池 hint 队列 + Cosmos 兜底扫描。
 *
 * - manual / auto Redis 队列物理隔离，互不干扰。
 * - claim 顺序：manual hint → auto hint → legacy 混合队列 → Cosmos（manual 优先）。
 * - 同店串行（busy shop）时不把 hint 塞回队尾，避免大店占满队列饿死其它店；
 *   同店下一条由 wakeNext*ForShop 在完成后 RPUSH。
 */
import {
  findPendingJobs,
  getJob,
  type TranslationV4Job,
  type TranslationV4Status,
} from "./cosmosV4.js";
import {
  hintPoolFromTaskSource,
  popHint,
  popLegacyHint,
  requeueHintTail,
  type HintPayload,
  type HintPipelineStage,
  type HintPool,
} from "./redisV4.js";
import {
  stagePoolKindForJob,
  stageSlots,
  type StagePoolKind,
  type StagePoolStage,
} from "./stagePool.js";

export type FairStageClaimOptions = {
  stage: StagePoolStage;
  hintKey: HintPipelineStage;
  drainMax: number;
  queuedStatus: TranslationV4Status;
  logTag: string;
  scanBatch?: number;
  scanMaxBatches?: number;
  isStaleHint: (hint: HintPayload) => Promise<boolean>;
  isShopBusy: (shopName: string) => Promise<boolean>;
  tryClaimJob: (shopName: string, taskId: string) => Promise<TranslationV4Job | null>;
};

/**
 * Cosmos 兜底扫描的空转退避。
 *
 * hint 队列为空时 claim 必然落到 `findPendingJobs`，而该查询是跨分区的。按
 * `WORKER_POLL_INTERVAL_MS` 默认 2s 计，3 个 stage × 2 个池会在完全没有任务时
 * 持续产生约 3 次跨分区查询/秒。这里对「确实一条候选都没扫到」的池做指数退避；
 * 一旦扫到候选就立刻复位。
 *
 * hint 队列是正常路径，退避只影响 hint 丢失后的兜底发现延迟，因此 manual 的上限
 * 明显短于 auto——商户在等 manual 任务。
 */
const COSMOS_SCAN_BACKOFF_MAX_MS: Record<StagePoolKind, number> = {
  manual: Math.max(
    0,
    Number(process.env.COSMOS_SCAN_BACKOFF_MAX_MANUAL_MS) || 10_000,
  ),
  auto: Math.max(
    0,
    Number(process.env.COSMOS_SCAN_BACKOFF_MAX_AUTO_MS) || 30_000,
  ),
};

const cosmosScanBackoff = new Map<
  string,
  { emptyStreak: number; nextAllowedAt: number }
>();

function backoffKey(stage: StagePoolStage, pool: StagePoolKind): string {
  return `${stage}:${pool}`;
}

/** true = 本轮跳过该池的 Cosmos 兜底扫描。 */
function shouldSkipCosmosScan(stage: StagePoolStage, pool: StagePoolKind): boolean {
  const state = cosmosScanBackoff.get(backoffKey(stage, pool));
  if (!state) return false;
  return Date.now() < state.nextAllowedAt;
}

function recordCosmosScanEmpty(stage: StagePoolStage, pool: StagePoolKind): void {
  const max = COSMOS_SCAN_BACKOFF_MAX_MS[pool];
  if (max <= 0) return;
  const key = backoffKey(stage, pool);
  const emptyStreak = (cosmosScanBackoff.get(key)?.emptyStreak ?? 0) + 1;
  // 2s 基准翻倍：4s → 8s → 16s → 上限
  const delay = Math.min(max, 2_000 * 2 ** emptyStreak);
  cosmosScanBackoff.set(key, { emptyStreak, nextAllowedAt: Date.now() + delay });
}

function resetCosmosScanBackoff(stage: StagePoolStage, pool: StagePoolKind): void {
  cosmosScanBackoff.delete(backoffKey(stage, pool));
}

/** manual 优先，再 auto。仅包含当前有空槽的池。 */
function claimPoolsInPriority(stage: StagePoolStage): StagePoolKind[] {
  const pools: StagePoolKind[] = [];
  if (stageSlots.hasCapacity(stage, "manual")) pools.push("manual");
  if (stageSlots.hasCapacity(stage, "auto")) pools.push("auto");
  return pools;
}

async function tryClaimFromHint(
  options: FairStageClaimOptions,
  hint: HintPayload,
  pool: HintPool,
): Promise<TranslationV4Job | null> {
  const {
    stage,
    hintKey,
    logTag,
    isStaleHint,
    isShopBusy,
    tryClaimJob,
  } = options;

  if (await isStaleHint(hint)) {
    console.log(
      `[${logTag}] discard stale hint job=${hint.taskId} shop=${hint.shopName} pool=${pool}`,
    );
    return null;
  }

  const queued = await getJob(hint.shopName, hint.taskId);
  const resolvedPool: HintPool = queued
    ? stagePoolKindForJob(queued)
    : pool;

  if (
    queued &&
    !stageSlots.hasCapacity(stage, stagePoolKindForJob(queued))
  ) {
    await requeueHintTail(hintKey, hint, resolvedPool);
    return null;
  }

  if (await isShopBusy(hint.shopName)) {
    // 同店已有任务在跑：丢弃 hint（Cosmos 仍为 queued），由 wakeNext*ForShop 再入队
    return null;
  }

  const job = await tryClaimJob(hint.shopName, hint.taskId);
  if (job) return job;

  await requeueHintTail(hintKey, hint, resolvedPool);
  return null;
}

async function drainPoolHints(
  options: FairStageClaimOptions,
  pool: HintPool,
): Promise<TranslationV4Job | null> {
  const { hintKey, drainMax } = options;
  for (let n = 0; n < drainMax; n++) {
    const hint = await popHint(hintKey, pool);
    if (!hint) break;
    const job = await tryClaimFromHint(options, hint, pool);
    if (job) return job;
  }
  return null;
}

/** 部署过渡：drain 旧混合队列，按 job.taskSource 归入正确池再 claim/requeue。 */
async function drainLegacyHints(
  options: FairStageClaimOptions,
): Promise<TranslationV4Job | null> {
  const { hintKey, drainMax, stage } = options;
  for (let n = 0; n < drainMax; n++) {
    const hint = await popLegacyHint(hintKey);
    if (!hint) break;

    const queued = await getJob(hint.shopName, hint.taskId);
    const pool = hintPoolFromTaskSource(queued?.taskSource);
    if (!stageSlots.hasCapacity(stage, pool)) {
      await requeueHintTail(hintKey, hint, pool);
      continue;
    }
    const job = await tryClaimFromHint(options, hint, pool);
    if (job) return job;
  }
  return null;
}

async function scanCosmosForPool(
  options: FairStageClaimOptions,
  pool: StagePoolKind,
): Promise<TranslationV4Job | null> {
  const {
    queuedStatus,
    scanBatch = 50,
    scanMaxBatches = 5,
    isShopBusy,
    tryClaimJob,
  } = options;

  if (shouldSkipCosmosScan(options.stage, pool)) return null;

  const busyShops = new Set<string>();
  for (let batch = 0; batch < scanMaxBatches; batch++) {
    const offset = batch * scanBatch;
    const candidates = await findPendingJobs(
      queuedStatus,
      scanBatch,
      offset,
      pool,
    );
    if (candidates.length === 0) {
      // 第一批就空 = 该池确实没有待处理任务，进入退避。后续批次为空只是分页到尾，
      // 说明本轮扫到过候选（只是都 busy 或抢锁失败），不该长退避。
      if (batch === 0) recordCosmosScanEmpty(options.stage, pool);
      break;
    }
    resetCosmosScanBackoff(options.stage, pool);

    for (const candidate of candidates) {
      if (busyShops.has(candidate.shopName)) continue;
      if (!stageSlots.hasCapacity(options.stage, pool)) {
        return null;
      }
      if (await isShopBusy(candidate.shopName)) {
        busyShops.add(candidate.shopName);
        continue;
      }
      const job = await tryClaimJob(candidate.shopName, candidate.id);
      if (job) return job;
    }

    if (candidates.length < scanBatch) break;
  }
  return null;
}

export async function claimNextJobWithFairScheduling(
  options: FairStageClaimOptions,
): Promise<TranslationV4Job | null> {
  const pools = claimPoolsInPriority(options.stage);
  if (pools.length === 0) return null;

  // 1) 分池 hint：manual 优先
  for (const pool of pools) {
    const job = await drainPoolHints(options, pool);
    if (job) {
      // hint 命中说明该池又有活儿了，兜底扫描恢复灵敏。
      resetCosmosScanBackoff(options.stage, pool);
      return job;
    }
  }

  // 2) 遗留混合队列（部署过渡）
  const legacy = await drainLegacyHints(options);
  if (legacy) {
    resetCosmosScanBackoff(options.stage, stagePoolKindForJob(legacy));
    return legacy;
  }

  // 3) Cosmos 兜底：同样 manual 优先
  for (const pool of pools) {
    const job = await scanCosmosForPool(options, pool);
    if (job) return job;
  }

  return null;
}
