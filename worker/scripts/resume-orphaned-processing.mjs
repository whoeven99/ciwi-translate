/**
 * 批量恢复僵死的 processing 任务（INITIALIZING / TRANSLATING / WRITING_BACK）。
 *
 * 默认：测环境 + dry-run（不写）。
 * 真正写入：加 --apply
 * 写生产：--env=.env.prod --apply --confirm-prod
 *
 * Usage:
 *   node worker/scripts/resume-orphaned-processing.mjs
 *   node worker/scripts/resume-orphaned-processing.mjs --apply
 *   node worker/scripts/resume-orphaned-processing.mjs --env=.env.prod --apply --confirm-prod
 */
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
const apply = argv.includes("--apply");
// 兼容旧参数名：--dry-run 仍表示只读（默认已是 dry-run）
const dryRun = !apply;

const { env, overlay } = loadStackedEnv({ root });
if (apply) {
  assertProdWriteAllowed(argv, overlay);
}

const cosmos = resolveCosmos(env);
if (!cosmos.endpoint || !cosmos.key) {
  console.error("缺少 Cosmos 凭据（默认测环境；产环境加 --env=.env.prod）");
  process.exit(1);
}

const { url: redisUrl } = resolveRedisUrl(env);
if (!redisUrl) {
  console.error("缺少 Redis（RENDER_KV）");
  process.exit(1);
}

const PROC_TO_QUEUED = {
  INITIALIZING: ["INIT_QUEUED", "init"],
  TRANSLATING: ["TRANSLATE_QUEUED", "translate"],
  WRITING_BACK: ["WRITEBACK_QUEUED", "writeback"],
};

const AUTO_TASK_SOURCE = "TsFrontend-Auto";

function hintKeyForJob(hintStage, taskSource) {
  const pool = taskSource === AUTO_TASK_SOURCE ? "auto" : "manual";
  return `translate:v4:hint:${hintStage}:${pool}`;
}

const client = new CosmosClient({
  endpoint: cosmos.endpoint,
  key: cosmos.key,
});
const container = client
  .database(cosmos.databaseId)
  .container(cosmos.containerId);
const redis = new IORedis(redisUrl, { maxRetriesPerRequest: 2 });

const graceMs = Number(process.env.ORPHAN_HEARTBEAT_MS) || 30_000;
const threshold = new Date(Date.now() - graceMs).toISOString();

const { resources } = await container.items
  .query({
    query: `
      SELECT c.id, c.shopName, c.status, c.claimedBy, c.lastHeartbeat, c.updatedAt, c.taskSource
      FROM c
      WHERE c.status IN ('INITIALIZING', 'TRANSLATING', 'WRITING_BACK')
        AND (NOT IS_DEFINED(c.lastHeartbeat) OR c.lastHeartbeat < @threshold)
    `,
    parameters: [{ name: "@threshold", value: threshold }],
  })
  .fetchAll();

console.log(
  `overlay=${overlay} orphaned (hb before ${threshold}): ${resources.length}${dryRun ? " [dry-run]" : " [APPLY]"}`,
);

for (const job of resources) {
  const mapping = PROC_TO_QUEUED[job.status];
  if (!mapping) continue;
  const [resetStatus, hintStage] = mapping;
  console.log(
    `  ${job.id.slice(0, 8)} ${job.status} → ${resetStatus} shop=${job.shopName} hb=${job.lastHeartbeat}`,
  );
  if (dryRun) continue;

  const { resource: current } = await container
    .item(job.id, job.shopName)
    .read();
  await container.item(job.id, job.shopName).replace({
    ...current,
    status: resetStatus,
    claimedBy: null,
    claimedAt: null,
    updatedAt: new Date().toISOString(),
  });
  await redis.lpush(
    hintKeyForJob(hintStage, job.taskSource),
    JSON.stringify({ taskId: job.id, shopName: job.shopName }),
  );
}

if (dryRun) {
  console.log("\nDry-run only. Re-run with --apply to write (prod also needs --confirm-prod).");
}

await redis.quit();
