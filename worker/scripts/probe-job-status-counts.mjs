/**
 * Count translation_v4_jobs by status.
 * 默认测环境；生产：--env=.env.prod
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CosmosClient } from "@azure/cosmos";
import { loadStackedEnv, resolveCosmos } from "../../scripts/lib/loadEnv.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
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

const statuses = [
  "INIT_QUEUED",
  "INITIALIZING",
  "TRANSLATE_QUEUED",
  "TRANSLATING",
  "WRITEBACK_QUEUED",
  "WRITEBACKING",
  "COMPLETED",
  "FAILED",
];

console.log("=== job counts by status ===");
for (const s of statuses) {
  const { resources } = await container.items
    .query({
      query: "SELECT VALUE COUNT(1) FROM c WHERE c.status = @s",
      parameters: [{ name: "@s", value: s }],
    })
    .fetchAll();
  console.log(`${s}: ${resources[0]}`);
}

const { resources: inFlight } = await container.items
  .query({
    query:
      "SELECT TOP 20 c.id, c.shopName, c.status, c.claimedBy, c.lastHeartbeat, c.updatedAt FROM c WHERE c.status IN ('INITIALIZING','TRANSLATING','WRITEBACKING') ORDER BY c.updatedAt DESC",
  })
  .fetchAll();
console.log("\n=== in-flight jobs ===");
console.log(JSON.stringify(inFlight, null, 2));

const { resources: oldestQueued } = await container.items
  .query({
    query:
      "SELECT TOP 5 c.id, c.shopName, c.status, c.updatedAt FROM c WHERE c.status = 'INIT_QUEUED' ORDER BY c.updatedAt ASC",
  })
  .fetchAll();
console.log("\n=== oldest INIT_QUEUED ===");
console.log(JSON.stringify(oldestQueued, null, 2));
