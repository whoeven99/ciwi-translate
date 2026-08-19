/**
 * Summarize auto-translate jobs created since a UTC timestamp.
 * 默认测环境；生产：--env=.env.prod
 * Usage: node worker/scripts/probe-auto-batch.mjs [sinceIso] [--env=.env.test]
 */
import { CosmosClient } from "@azure/cosmos";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadStackedEnv, resolveCosmos } from "../../scripts/lib/loadEnv.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

const AUTO = "TsFrontend-Auto";
const since =
  process.argv.slice(2).find((a) => !a.startsWith("--"))?.trim() ||
  new Date().toISOString().slice(0, 10) + "T12:00:00.000Z";

const { env } = loadStackedEnv({ root });
const cosmos = resolveCosmos(env);
if (!cosmos.endpoint || !cosmos.key) {
  console.error("COSMOS env missing");
  process.exit(1);
}

const client = new CosmosClient({
  endpoint: cosmos.endpoint,
  key: cosmos.key,
});
const container = client
  .database(cosmos.databaseId)
  .container(cosmos.containerId);

const { resources: jobs } = await container.items
  .query({
    query: `
      SELECT c.id, c.shopName, c.status, c.source, c.target, c.taskSource,
             c.createdAt, c.updatedAt, c.metrics, c.errorStage, c.errorMessage
      FROM c
      WHERE c.taskSource = @src AND c.createdAt >= @since
    `,
    parameters: [
      { name: "@src", value: AUTO },
      { name: "@since", value: since },
    ],
  })
  .fetchAll();

const byStatus = {};
const byShop = {};
for (const j of jobs) {
  byStatus[j.status] = (byStatus[j.status] || 0) + 1;
  byShop[j.shopName] = (byShop[j.shopName] || 0) + 1;
}

const activeStatuses = [
  "INIT_QUEUED",
  "INITIALIZING",
  "TRANSLATE_QUEUED",
  "TRANSLATING",
  "WRITEBACK_QUEUED",
  "WRITING_BACK",
];
const active = jobs.filter((j) => activeStatuses.includes(j.status));
const activeShops = [...new Set(active.map((j) => j.shopName))];
const processing = jobs.filter((j) =>
  ["INITIALIZING", "TRANSLATING", "WRITING_BACK"].includes(j.status),
);

console.log("since", since, "(20:00 CST if default)");
console.log("total auto jobs created:", jobs.length);
console.log("unique shops:", Object.keys(byShop).length);
console.log("byStatus:", JSON.stringify(byStatus, null, 2));
console.log("active jobs:", active.length, "active shops:", activeShops.length);
console.log(
  "active by stage:",
  JSON.stringify(
    active.reduce((a, j) => {
      a[j.status] = (a[j.status] || 0) + 1;
      return a;
    }, {}),
    null,
    2,
  ),
);
console.log("currently processing:", processing.length);
for (const j of processing) {
  const m = j.metrics ?? {};
  console.log(
    `  ${j.status} ${j.shopName} ${j.source}->${j.target}` +
      ` init=${m.initDone ?? 0}/${m.initTotal ?? 0}` +
      ` tr=${m.translateDone ?? 0}/${m.translateTotal ?? 0}` +
      ` wb=${m.writebackDone ?? 0}/${m.writebackTotal ?? 0}`,
  );
}

const failed = jobs.filter((j) => j.status === "FAILED");
if (failed.length) {
  console.log("\nFAILED:", failed.length);
  for (const j of failed.slice(0, 10)) {
    console.log(`  ${j.shopName} ${j.errorStage}: ${j.errorMessage?.slice(0, 120)}`);
  }
}
