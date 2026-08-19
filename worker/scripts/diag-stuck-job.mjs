import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CosmosClient } from "@azure/cosmos";
import IORedis from "ioredis";
import {
  loadStackedEnv,
  resolveCosmos,
  resolveRedisUrl,
} from "../../scripts/lib/loadEnv.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const { env } = loadStackedEnv({ root });

const taskPrefix =
  process.argv.slice(2).find((a) => !a.startsWith("--")) || "7c5ca446";

const cosmos = resolveCosmos(env);
if (!cosmos.endpoint || !cosmos.key) {
  console.error("COSMOS 凭据未配置（默认测环境 .env + .env.test + .env.worker.test）");
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
      "SELECT c.id, c.shopName, c.status, c.source, c.target, c.modules, c.claimedBy, c.lastHeartbeat, c.updatedAt, c.metrics, c.errorMessage, c.aiModel, c.aiModelUsed, c.aiProvider FROM c WHERE c.status = @translating OR STARTSWITH(c.id, @prefix) ORDER BY c.updatedAt DESC OFFSET 0 LIMIT 10",
    parameters: [
      { name: "@translating", value: "TRANSLATING" },
      { name: "@prefix", value: taskPrefix },
    ],
  })
  .fetchAll();

console.log("=== Cosmos jobs ===");
for (const j of resources) {
  console.log(
    JSON.stringify(
      {
        id: j.id,
        shop: j.shopName,
        status: j.status,
        route: `${j.source} -> ${j.target}`,
        modules: j.modules,
        aiModel: j.aiModel,
        aiModelUsed: j.aiModelUsed,
        claimedBy: j.claimedBy,
        lastHeartbeat: j.lastHeartbeat,
        updatedAt: j.updatedAt,
        metrics: j.metrics,
        errorMessage: j.errorMessage,
      },
      null,
      2,
    ),
  );
}

function createRedis() {
  const { url } = resolveRedisUrl(env);
  if (!url) return null;
  return new IORedis(url, {
    maxRetriesPerRequest: 1,
    connectTimeout: 8_000,
    lazyConnect: true,
  });
}

const redis = createRedis();
if (!redis) {
  console.log("Redis not configured");
  process.exit(0);
}

await redis.connect();

for (const j of resources) {
  const prog = await redis.hgetall(`translate:v4:progress:${j.id}`);
  console.log(`--- Redis progress ${j.id} ---`);
  console.log(prog);
}

const keystats = await redis.keys("translate:v4:keystat:*");
console.log(`--- Redis keystats (${keystats.length} keys) ---`);
for (const k of keystats.slice(0, 8)) {
  const h = await redis.hgetall(k);
  console.log(k, {
    calls: h.calls,
    tokens: h.tokens,
    throttleCount: h.throttleCount,
    errors: h.errors,
    poolConcurrency: h.poolConcurrency,
    remainingReq: h.remainingReq,
    updatedAt: h.updatedAt,
  });
}

const hints = [
  "translate:v4:hint:init:manual",
  "translate:v4:hint:init:auto",
  "translate:v4:hint:init",
  "translate:v4:hint:translate:manual",
  "translate:v4:hint:translate:auto",
  "translate:v4:hint:translate",
  "translate:v4:hint:writeback:manual",
  "translate:v4:hint:writeback:auto",
  "translate:v4:hint:writeback",
];
for (const hintKey of hints) {
  const len = await redis.llen(hintKey);
  if (len > 0) {
    const head = await redis.lrange(hintKey, 0, 2);
    console.log(`--- hint queue ${hintKey} len=${len} ---`, head);
  }
}

const { BlobServiceClient } = await import("@azure/storage-blob");
const blobConn = env.AZURE_BLOB_CONNECTION_STRING?.trim();
const blobContainer =
  env.AZURE_BLOB_TRANSLATION_CONTAINER?.trim() || "translation-content";
if (blobConn && resources[0]) {
  const j = resources[0];
  const prefix = `tasks/v4/${j.shopName}/${j.id}`;
  const container = BlobServiceClient.fromConnectionString(blobConn).getContainerClient(
    blobContainer,
  );
  const paths = [];
  for await (const item of container.listBlobsFlat({ prefix })) {
    paths.push(item.name);
  }
  console.log(`--- Blob paths under ${prefix} (${paths.length}) ---`);
  const translatePaths = paths.filter((p) => p.includes("/translate/"));
  const initPaths = paths.filter((p) => p.includes("/init/"));
  console.log("init files:", initPaths.length, "translate files:", translatePaths.length);
  console.log("sample init:", initPaths.slice(0, 5));
  console.log("sample translate:", translatePaths.slice(0, 5));

  async function readJson(rel) {
    try {
      const client = container.getBlockBlobClient(`${prefix}/${rel}`);
      if (!(await client.exists())) return null;
      const buf = await client.downloadToBuffer();
      return JSON.parse(buf.toString("utf8"));
    } catch {
      return null;
    }
  }

  for (const rel of [
    "init/PRODUCT/chunk-00.json",
    "translate/PRODUCT/chunk-00.json",
    "translate/COLLECTION/chunk-00.json",
    "translate/PAGE/chunk-00.json",
  ]) {
    const data = await readJson(rel);
    const count = Array.isArray(data) ? data.length : 0;
    const sample = Array.isArray(data) && data[0] ? Object.keys(data[0]) : [];
    console.log(`blob ${rel}:`, { count, sampleKeys: sample });
  }
}

await redis.quit();
