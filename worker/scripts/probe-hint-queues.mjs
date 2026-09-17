/**
 * List translation v4 Redis hint queues.
 * 默认测环境：.env + .env.test + .env.worker.test
 * 生产：node worker/scripts/probe-hint-queues.mjs --env=.env.prod
 */
import IORedis from "ioredis";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadStackedEnv,
  resolveRedisUrl,
} from "../../scripts/lib/loadEnv.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const { env, files } = loadStackedEnv({ root });

const HINT_KEYS = {
  "init/manual": "translate:v4:hint:init:manual",
  "init/auto": "translate:v4:hint:init:auto",
  "init/legacy": "translate:v4:hint:init",
  "translate/manual": "translate:v4:hint:translate:manual",
  "translate/auto": "translate:v4:hint:translate:auto",
  "translate/legacy": "translate:v4:hint:translate",
  "writeback/manual": "translate:v4:hint:writeback:manual",
  "writeback/auto": "translate:v4:hint:writeback:auto",
  "writeback/legacy": "translate:v4:hint:writeback",
  verify: "translate:v4:hint:verify",
  analysis: "translate:v4:hint:analysis",
};

const { url: redisUrl, source } = resolveRedisUrl(env);
if (!redisUrl) {
  console.error("缺少 Redis（RENDER_KV）。已加载:", files);
  process.exit(1);
}

const redis = new IORedis(redisUrl, {
  maxRetriesPerRequest: 2,
  connectTimeout: 15000,
});
await redis.ping();
console.log(`Redis source=${source}`);

for (const [stage, key] of Object.entries(HINT_KEYS)) {
  const len = await redis.llen(key);
  console.log(`${stage.padEnd(20)} ${key}  llen=${len}`);
  if (len > 0 && len <= 5) {
    const items = await redis.lrange(key, 0, 4);
    for (const item of items) console.log(`  - ${item}`);
  } else if (len > 5) {
    const items = await redis.lrange(key, 0, 2);
    for (const item of items) console.log(`  - ${item}`);
    console.log(`  ... (${len - 3} more)`);
  }
}

const lastAt = await redis.get("translate:v4:auto_scan:last_at");
const lastOk = await redis.get("translate:v4:auto_scan:last_success_at");
console.log("\nauto_scan:last_at =", lastAt);
console.log("auto_scan:last_success_at =", lastOk);

await redis.quit();
