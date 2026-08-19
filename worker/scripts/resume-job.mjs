// 手动恢复一个卡住的 v4 任务（处理中状态但 worker 已死）。
// 默认测环境。写生产：--env=.env.prod --confirm-prod

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CosmosClient } from "@azure/cosmos";
import IORedis from "ioredis";
import {
  assertProdWriteAllowed,
  loadStackedEnv,
  resolveCosmos,
  resolveRedisUrl,
} from "../../scripts/lib/loadEnv.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const argv = process.argv.slice(2);
const { env, overlay } = loadStackedEnv({ root });
// resume 会改 Cosmos + Redis：产环境必须 --confirm-prod
assertProdWriteAllowed(argv, overlay);

const prefix = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!prefix) {
  console.error(
    "用法: node worker/scripts/resume-job.mjs <jobId 或前缀> [--env=.env.test]",
  );
  process.exit(1);
}

const cosmos = resolveCosmos(env);
if (!cosmos.endpoint || !cosmos.key) {
  console.error("缺少 Cosmos 凭据");
  process.exit(1);
}
const db = cosmos.databaseId;
const containerId = cosmos.containerId;
const endpoint = cosmos.endpoint;
const key = cosmos.key;

const PROC_TO_QUEUED = {
  INITIALIZING: ["INIT_QUEUED", "init"],
  TRANSLATING: ["TRANSLATE_QUEUED", "translate"],
  WRITING_BACK: ["WRITEBACK_QUEUED", "writeback"],
  VERIFYING: ["VERIFY_QUEUED", null],
  INIT_QUEUED: ["INIT_QUEUED", "init"],
  TRANSLATE_QUEUED: ["TRANSLATE_QUEUED", "translate"],
  WRITEBACK_QUEUED: ["WRITEBACK_QUEUED", "writeback"],
  VERIFY_QUEUED: ["VERIFY_QUEUED", null],
};

const client = new CosmosClient({ endpoint, key });
const container = client.database(db).container(containerId);

const { resources } = await container.items
  .query({
    query:
      "SELECT * FROM c WHERE STARTSWITH(c.id, @p) ORDER BY c.updatedAt DESC OFFSET 0 LIMIT 5",
    parameters: [{ name: "@p", value: prefix }],
  })
  .fetchAll();

if (!resources.length) {
  console.error(`没找到任务 ${prefix}（确认连的是生产 Cosmos）`);
  process.exit(1);
}
const job = resources[0];
console.log(
  `找到任务 ${job.id} status=${job.status} claimedBy=${job.claimedBy} lastHeartbeat=${job.lastHeartbeat}`,
);
console.log("metrics:", JSON.stringify(job.metrics, null, 2));

function translateResourcesComplete(metrics) {
  const total = metrics?.translateTotal ?? metrics?.initTotal ?? 0;
  if (total <= 0) return false;
  const attempted = (metrics?.translateDone ?? 0) + (metrics?.translateFailed ?? 0);
  return attempted >= total;
}

function writebackResourceTotal(metrics) {
  if (metrics?.writebackTotal > 0) return metrics.writebackTotal;
  if (translateResourcesComplete(metrics) && metrics?.translateDone > 0) {
    return metrics.translateDone;
  }
  return metrics?.translateTotal || metrics?.initTotal || 0;
}

function writebackNeedsRetry(metrics) {
  const total = writebackResourceTotal(metrics);
  if (total <= 0) return false;
  const done = metrics?.writebackDone ?? 0;
  const failed = metrics?.writebackFailed ?? 0;
  return done < total || failed > 0;
}

function resolveFinalStatusAfterWriteback(metrics) {
  const initTotal = metrics?.initTotal ?? 0;
  const nothingToTranslate = initTotal === 0;
  const writebackDone = metrics?.writebackDone ?? 0;
  const wroteAnything = nothingToTranslate || writebackDone > 0;
  const tTotal = metrics?.translateTotal ?? 0;
  const tAttempted = (metrics?.translateDone ?? 0) + (metrics?.translateFailed ?? 0);
  const translateIncomplete = wroteAnything && tTotal > 0 && tAttempted < tTotal;
  if (translateIncomplete) return "PAUSED";
  if (wroteAnything) return "COMPLETED";
  return "FAILED";
}

if (job.status === "VERIFY_QUEUED" || job.status === "VERIFYING") {
  const finalStatus = resolveFinalStatusAfterWriteback(job.metrics);
  const writebackDone = job.metrics?.writebackDone ?? 0;
  const translateIncomplete =
    finalStatus === "PAUSED" &&
    (job.metrics?.translateTotal ?? 0) > 0 &&
    (job.metrics?.translateDone ?? 0) + (job.metrics?.translateFailed ?? 0) <
      (job.metrics?.translateTotal ?? 0);
  await container.item(job.id, job.shopName).replace({
    ...job,
    status: finalStatus,
    claimedBy: null,
    claimedAt: null,
    errorStage:
      translateIncomplete ? "TRANSLATE" : finalStatus === "FAILED" ? "WRITEBACK" : null,
    errorMessage:
      translateIncomplete
        ? "QUOTA_INSUFFICIENT_PARTIAL"
        : finalStatus === "FAILED"
          ? "WRITEBACK_ALL_FAILED"
          : null,
    updatedAt: new Date().toISOString(),
  });
  console.log(`校验环节已移除：${job.status} → ${finalStatus}（writebackDone=${writebackDone}）`);
  console.log("✅ 完成。");
  process.exit(0);
}

let resetStatus;
let hintStage;
if (
  (job.status === "TRANSLATING" || job.status === "TRANSLATE_QUEUED") &&
  translateResourcesComplete(job.metrics) &&
  writebackNeedsRetry(job.metrics)
) {
  resetStatus = "WRITEBACK_QUEUED";
  hintStage = "writeback";
  console.log(
    `翻译已完成 (${job.metrics.translateDone}/${job.metrics.translateTotal})，推进到写回队列`,
  );
} else {
  const mapping = PROC_TO_QUEUED[job.status];
  if (!mapping) {
    console.error(`状态 ${job.status} 不是可恢复的处理中/排队态，未操作。`);
    process.exit(1);
  }
  [resetStatus, hintStage] = mapping;
}

await container.item(job.id, job.shopName).replace({
  ...job,
  status: resetStatus,
  claimedBy: null,
  claimedAt: null,
  updatedAt: new Date().toISOString(),
  ...(resetStatus === "WRITEBACK_QUEUED" && job.metrics
    ? {
        metrics: {
          ...job.metrics,
          writebackTotal: writebackResourceTotal(job.metrics),
        },
      }
    : {}),
});
console.log(`已重置 ${job.status} → ${resetStatus}, claimedBy=null`);

// 推 hint 让 worker 立即拾取（best-effort）
const { url: redisUrl } = resolveRedisUrl(env);
let redis = null;
if (redisUrl) {
  redis = new IORedis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
}

if (redis && hintStage) {
  try {
    await redis.connect();
    await redis.lpush(
      `translate:v4:hint:${hintStage}`,
      JSON.stringify({ taskId: job.id, shopName: job.shopName }),
    );
    console.log(`已推 hint translate:v4:hint:${hintStage}`);
    await redis.quit();
  } catch (e) {
    console.warn("推 hint 失败（worker 仍会在下个轮询周期拾取）:", e.message);
  }
} else {
  console.log("Redis 未配置，跳过 hint（worker 会在下个轮询周期拾取）");
}
console.log("✅ 完成。worker 应很快接着写回。");
process.exit(0);
