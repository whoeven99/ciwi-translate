/**
 * Probe job Cosmos + Redis progress by id prefix.
 * 默认测环境本地 env；可用 --env=.env.prod。
 * Usage: node worker/scripts/probe-job-redis.mjs <idPrefix> [--env=.env.test]
 */
import { CosmosClient } from "@azure/cosmos";
import IORedis from "ioredis";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadStackedEnv,
  resolveCosmos,
  resolveRedisUrl,
} from "../../scripts/lib/loadEnv.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const prefix = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!prefix) {
  console.error(
    "Usage: node worker/scripts/probe-job-redis.mjs <idPrefix> [--env=.env.test]",
  );
  process.exit(1);
}

const { env } = loadStackedEnv({ root });
const cosmos = resolveCosmos(env);
if (!cosmos.endpoint || !cosmos.key) {
  console.error("缺少 Cosmos 凭据");
  process.exit(1);
}

const client = new CosmosClient({
  endpoint: cosmos.endpoint,
  key: cosmos.key,
});
const container = client
  .database(cosmos.databaseId)
  .container(cosmos.containerId);
const { resources } = await container.items
  .query({
    query:
      "SELECT * FROM c WHERE STARTSWITH(c.id, @prefix) ORDER BY c.updatedAt DESC OFFSET 0 LIMIT 3",
    parameters: [{ name: "@prefix", value: prefix }],
  })
  .fetchAll();

if (!resources.length) {
  console.error("No job found for prefix", prefix);
  process.exit(1);
}

const job = resources[0];
console.log("=== Cosmos job ===");
console.log(
  JSON.stringify(
    {
      id: job.id,
      shop: job.shopName,
      status: job.status,
      claimedBy: job.claimedBy,
      lastHeartbeat: job.lastHeartbeat,
      updatedAt: job.updatedAt,
      errorStage: job.errorStage,
      errorMessage: job.errorMessage,
      metrics: job.metrics,
      stageTimings: job.stageTimings,
      blobPrefix: job.blobPrefix,
    },
    null,
    2,
  ),
);

const { url: redisUrl, source } = resolveRedisUrl(env);
if (!redisUrl) {
  console.warn("No RENDER_KV / REDIS_URL — skip Redis");
  process.exit(0);
}

const redis = new IORedis(redisUrl, {
  maxRetriesPerRequest: 1,
  lazyConnect: true,
});
await redis.connect();
const prog = await redis.hgetall(`translate:v4:progress:${job.id}`);
const ctrl = await redis.get(`translate:v4:control:${job.id}`);
console.log(`\n=== Redis progress (source=${source}) ===`);
console.log(prog);
console.log("\n=== Redis control ===");
console.log(ctrl);
await redis.quit();
