import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CosmosClient } from "@azure/cosmos";
import { loadStackedEnv, resolveCosmos } from "./lib/loadEnv.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { env } = loadStackedEnv({ root });
const cosmos = resolveCosmos(env);

if (!cosmos.endpoint || !cosmos.key) {
  console.error(
    "缺少 Cosmos 凭据。默认叠 .env + .env.test + .env.worker.test；可用 --env=.env.prod",
  );
  process.exit(1);
}

const client = new CosmosClient({
  endpoint: cosmos.endpoint,
  key: cosmos.key,
});
const container = client
  .database(cosmos.databaseId)
  .container(cosmos.containerId);

const prefixes = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (prefixes.length) {
  for (const prefix of prefixes) {
    const { resources } = await container.items
      .query({
        query: "SELECT * FROM c WHERE CONTAINS(c.id, @prefix)",
        parameters: [{ name: "@prefix", value: prefix }],
      })
      .fetchAll();
    console.log(`\n=== prefix ${prefix} (${resources.length}) ===`);
    for (const r of resources) {
      const m = r.metrics ?? {};
      console.log(
        JSON.stringify(
          {
            id: r.id,
            shop: r.shopName,
            source: r.source,
            target: r.target,
            status: r.status,
            errorStage: r.errorStage,
            errorMessage: r.errorMessage,
            taskSource: r.taskSource,
            translateDone: m.translateDone,
            translateTotal: m.translateTotal,
            writebackDone: m.writebackDone,
            writebackTotal: m.writebackTotal,
            writebackFailed: m.writebackFailed,
            updatedAt: r.updatedAt,
          },
          null,
          2,
        ),
      );
    }
  }
}

const { resources: arFailed } = await container.items
  .query({
    query:
      "SELECT TOP 20 c.id, c.shopName, c.target, c.status, c.errorStage, c.errorMessage, c.metrics, c.updatedAt FROM c WHERE c.target = @target AND (c.status = @failed OR c.errorStage = @wb) ORDER BY c.updatedAt DESC",
    parameters: [
      { name: "@target", value: "ar" },
      { name: "@failed", value: "FAILED" },
      { name: "@wb", value: "WRITEBACK" },
    ],
  })
  .fetchAll();

console.log(`\n=== recent ar FAILED/WRITEBACK (${arFailed.length}) ===`);
for (const r of arFailed) {
  const m = r.metrics ?? {};
  console.log(
    JSON.stringify({
      id: r.id,
      shop: r.shopName,
      status: r.status,
      errorStage: r.errorStage,
      errorMessage: r.errorMessage?.slice?.(0, 120),
      writeback: `${m.writebackDone}/${m.writebackTotal} failed=${m.writebackFailed}`,
      updatedAt: r.updatedAt,
    }),
  );
}
