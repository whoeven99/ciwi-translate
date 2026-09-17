import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CosmosClient } from "@azure/cosmos";
import { BlobServiceClient } from "@azure/storage-blob";
import { loadStackedEnv, resolveCosmos } from "./lib/loadEnv.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { env } = loadStackedEnv({ root });
const cosmos = resolveCosmos(env);

const shop = process.argv.slice(2).find((a) => !a.startsWith("--")) || null;

if (!cosmos.endpoint || !cosmos.key) {
  console.error("缺少 Cosmos 凭据（默认 .env + .env.test + .env.worker.test）");
  process.exit(1);
}

const client = new CosmosClient({
  endpoint: cosmos.endpoint,
  key: cosmos.key,
});
const container = client.database(cosmos.databaseId).container("shop_scan_jobs");

const query = shop
  ? {
      query:
        "SELECT TOP 3 c.shopName, c.id, c.status, c.stages, c.blobPrefix, c.updatedAt, c.summary FROM c WHERE c.shopName = @shop ORDER BY c.updatedAt DESC",
      parameters: [{ name: "@shop", value: shop }],
    }
  : {
      query:
        "SELECT TOP 5 c.shopName, c.id, c.status, c.stages, c.blobPrefix, c.updatedAt, c.summary FROM c ORDER BY c.updatedAt DESC",
    };

const { resources: scans } = await container.items.query(query).fetchAll();
console.log("=== Recent scans ===");
console.log(JSON.stringify(scans, null, 2));

const latest = scans[0];
if (!latest?.blobPrefix) {
  console.log("\nNo blobPrefix on latest scan.");
  process.exit(0);
}

const blobConn = env.AZURE_BLOB_CONNECTION_STRING?.trim();
if (!blobConn) {
  console.log("\n=== Blob ===");
  console.log(
    "AZURE_BLOB_CONNECTION_STRING not set — cannot read profile-facts.json",
  );
  process.exit(0);
}

const containerName =
  env.AZURE_BLOB_TRANSLATION_CONTAINER?.trim() || "translation-content";
const blobContainer = BlobServiceClient.fromConnectionString(
  blobConn,
).getContainerClient(containerName);
const prefix = latest.blobPrefix.endsWith("/")
  ? latest.blobPrefix
  : `${latest.blobPrefix}/`;

async function readJson(name) {
  const blob = blobContainer.getBlockBlobClient(`${prefix}${name}`);
  if (!(await blob.exists())) return { exists: false, data: null };
  const buf = await blob.downloadToBuffer();
  return { exists: true, data: JSON.parse(buf.toString("utf8")) };
}

const profileFacts = await readJson("profile-facts.json");
const glossaryRaw = await readJson("glossary-raw.json");

console.log("\n=== profile-facts.json ===");
if (!profileFacts.exists) {
  console.log("NOT FOUND");
} else {
  const d = profileFacts.data;
  console.log("keys:", Object.keys(d ?? {}));
  console.log("has induction:", Boolean(d?.induction));
  console.log("has old ai:", Boolean(d?.ai));
  console.log(
    "understanding industry:",
    d?.induction?.understanding?.industry ?? null,
  );
  const s = d?.induction?.strategy;
  console.log(
    "strategy:",
    s
      ? {
          brandTerms: s.brandTerms?.length ?? 0,
          doNotTranslateTerms: s.doNotTranslateTerms?.length ?? 0,
          preferredTerms: s.preferredTerms?.length ?? 0,
          seoTerms: s.seoTerms?.length ?? 0,
          moduleHints: s.moduleHints?.length ?? 0,
        }
      : null,
  );
  if (d?.induction?.ai?.step2) {
    console.log(
      "step2 raw preview:",
      String(d.induction.ai.step2.raw).slice(0, 500),
    );
  }
}

console.log("\n=== glossary-raw.json ===");
if (!glossaryRaw.exists) {
  console.log("NOT FOUND");
} else {
  const d = glossaryRaw.data;
  console.log("totalSuggested:", d?.totalSuggested ?? d?.totalInserted ?? null);
  console.log(
    "perLocale terms:",
    (d?.perLocale ?? []).map((r) => ({
      locale: r.locale,
      terms: r.terms?.length ?? 0,
      inserted: r.inserted ?? null,
    })),
  );
}
