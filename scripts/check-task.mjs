import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Redis from "ioredis";
import {
  loadStackedEnv,
  resolveCosmos,
  resolveRedisUrl,
} from "./lib/loadEnv.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { env } = loadStackedEnv({ root });

const taskId = process.argv[2];
const shop = process.argv[3] || "ciwishop.myshopify.com";
if (!taskId) {
  console.error(
    "Usage: node scripts/check-task.mjs <taskId> [shop] [--env=.env.test]",
  );
  process.exit(1);
}

const cosmos = resolveCosmos(env);
if (!cosmos.endpoint || !cosmos.key) {
  console.error("缺少 Cosmos 凭据（COSMOS_ENDPOINT_V4 / COSMOS_KEY_V4 或无后缀）");
  process.exit(1);
}

const redisResolved = resolveRedisUrl(env);
if (!redisResolved.url) {
  console.error("缺少 Redis（RENDER_KV 或 REDIS_URL_V4 / REDIS_URL）");
  process.exit(1);
}

const { getV4Job } = await import("../app/server/translateV4/cosmos.server.ts");

const job = await getV4Job(shop, taskId);
const redis = new Redis(redisResolved.url, {
  maxRetriesPerRequest: 1,
  connectTimeout: 8000,
});
const [progress, control] = await Promise.all([
  redis.hgetall(`translate:v4:progress:${taskId}`),
  redis.get(`translate:v4:control:${taskId}`),
]);
await redis.quit();

console.log(
  JSON.stringify(
    {
      redisSource: redisResolved.source,
      job: job
        ? {
            id: job.id,
            status: job.status,
            source: job.source,
            target: job.target,
            aiModel: job.aiModel,
            metrics: job.metrics,
            errorMessage: job.errorMessage,
            updatedAt: job.updatedAt,
            stageTimings: job.stageTimings,
          }
        : null,
      progress,
      control,
    },
    null,
    2,
  ),
);
