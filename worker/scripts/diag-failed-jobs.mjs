import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CosmosClient } from "@azure/cosmos";
import IORedis from "ioredis";
import { BlobServiceClient } from "@azure/storage-blob";
import {
  loadStackedEnv,
  resolveCosmos,
  resolveRedisUrl,
} from "../../scripts/lib/loadEnv.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const { env } = loadStackedEnv({ root });

const prefixes = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const listFailed = process.argv.includes("--list-failed");

const cosmos = resolveCosmos(env);
if (!cosmos.endpoint || !cosmos.key) {
  console.error("COSMOS 凭据未配置（默认测环境）");
  process.exit(1);
}

const client = new CosmosClient({
  endpoint: cosmos.endpoint,
  key: cosmos.key,
});
const container = client
  .database(cosmos.databaseId)
  .container(cosmos.containerId);

const jobs = [];

if (listFailed) {
  const { resources } = await container.items
    .query({
      query:
        "SELECT TOP 30 c.id, c.shopName, c.status, c.source, c.target, c.errorStage, c.errorMessage, c.metrics, c.stageTimings, c.updatedAt, c.blobPrefix FROM c WHERE c.status = 'FAILED' ORDER BY c.updatedAt DESC",
    })
    .fetchAll();
  jobs.push(...resources);
} else if (prefixes.length === 0) {
  console.error("Usage: node diag-failed-jobs.mjs <jobIdPrefix> [...] | --list-failed");
  process.exit(1);
} else {
  for (const prefix of prefixes) {
    const { resources } = await container.items
      .query({
        query:
          "SELECT * FROM c WHERE STARTSWITH(c.id, @prefix) OR CONTAINS(c.id, @prefix) ORDER BY c.updatedAt DESC OFFSET 0 LIMIT 3",
        parameters: [{ name: "@prefix", value: prefix }],
      })
      .fetchAll();
    jobs.push(...resources);
  }
}

console.log(`=== Found ${jobs.length} job(s) ===\n`);
for (const j of jobs) {
  console.log(
    JSON.stringify(
      {
        id: j.id,
        shop: j.shopName,
        status: j.status,
        route: `${j.source} -> ${j.target}`,
        modules: j.modules,
        errorStage: j.errorStage,
        errorMessage: j.errorMessage,
        metrics: j.metrics,
        stageTimings: j.stageTimings,
        aiModel: j.aiModel,
        claimedBy: j.claimedBy,
        updatedAt: j.updatedAt,
        blobPrefix: j.blobPrefix,
      },
      null,
      2,
    ),
  );
  console.log("");
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
if (redis) {
  await redis.connect();
  for (const j of jobs) {
    const prog = await redis.hgetall(`translate:v4:progress:${j.id}`);
    const ctrl = await redis.get(`translate:v4:control:${j.id}`);
    console.log(`--- Redis progress ${j.id} ---`);
    console.log(prog);
    if (ctrl) {
      console.log(`--- Redis control ${j.id} ---`);
      console.log(ctrl);
    }
  }
  await redis.quit();
}

const blobConn = env.AZURE_BLOB_CONNECTION_STRING?.trim();
const blobContainer =
  env.AZURE_BLOB_TRANSLATION_CONTAINER?.trim() || "translation-content";

if (blobConn) {
  const blobClient = BlobServiceClient.fromConnectionString(blobConn).getContainerClient(
    blobContainer,
  );
  for (const j of jobs) {
    const prefix = j.blobPrefix ?? `tasks/v4/${j.shopName}/${j.id}`;
    const paths = [];
    for await (const item of blobClient.listBlobsFlat({ prefix })) {
      paths.push(item.name);
    }
    const initCount = paths.filter((p) => p.includes("/init/")).length;
    const translateCount = paths.filter((p) => p.includes("/translate/")).length;
    console.log(`--- Blob ${j.id} (${paths.length} files, init=${initCount}, translate=${translateCount}) ---`);
    console.log("manifest:", paths.includes(`${prefix}/manifest.json`));
    const sample = paths.filter((p) => p.endsWith(".json")).slice(0, 8);
    console.log("sample:", sample);
  }
}
