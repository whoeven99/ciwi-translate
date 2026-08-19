/**
 * Remove stale entries from translation v4 Redis hint queues.
 * Keeps only hints whose Cosmos job is still in the expected queued status.
 *
 * Credentials: 默认测环境 .env + .env.test + .env.worker.test；生产 --env=.env.prod
 *
 * Usage:
 *   node worker/scripts/cleanup-stale-hints.mjs              # dry-run (default)
 *   node worker/scripts/cleanup-stale-hints.mjs --apply      # rewrite queues
 *   node worker/scripts/cleanup-stale-hints.mjs --stage init # init queue only
 *   node worker/scripts/cleanup-stale-hints.mjs --env=.env.prod --apply --confirm-prod
 */
import IORedis from "ioredis";
import { CosmosClient } from "@azure/cosmos";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertProdWriteAllowed,
  loadStackedEnv,
  resolveCosmos,
  resolveRedisUrl,
} from "../../scripts/lib/loadEnv.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

const STAGE_CONFIG = {
  init: {
    keys: [
      "translate:v4:hint:init:manual",
      "translate:v4:hint:init:auto",
      "translate:v4:hint:init",
    ],
    expectedStatus: "INIT_QUEUED",
  },
  translate: {
    keys: [
      "translate:v4:hint:translate:manual",
      "translate:v4:hint:translate:auto",
      "translate:v4:hint:translate",
    ],
    expectedStatus: "TRANSLATE_QUEUED",
  },
  writeback: {
    keys: [
      "translate:v4:hint:writeback:manual",
      "translate:v4:hint:writeback:auto",
      "translate:v4:hint:writeback",
    ],
    expectedStatus: "WRITEBACK_QUEUED",
  },
  verify: {
    keys: ["translate:v4:hint:verify"],
    expectedStatus: "VERIFY_QUEUED",
  },
};

function parseArgs(argv) {
  const apply = argv.includes("--apply");
  let stage = "all";
  for (const a of argv) {
    if (a.startsWith("--stage=")) stage = a.slice("--stage=".length).trim();
  }
  const stageIdx = argv.indexOf("--stage");
  if (stageIdx >= 0 && argv[stageIdx + 1] && !argv[stageIdx + 1].startsWith("--")) {
    stage = argv[stageIdx + 1].trim();
  }
  if (stage !== "all" && !STAGE_CONFIG[stage]) {
    console.error(
      `Unknown --stage ${stage}. Use: init|translate|writeback|verify|all`,
    );
    process.exit(1);
  }
  return { apply, stage };
}

function parseHint(raw, idx) {
  try {
    const hint = JSON.parse(raw);
    if (!hint?.taskId || !hint?.shopName) {
      return { idx, raw, invalid: true };
    }
    return { idx, hint, raw };
  } catch {
    return { idx, raw, invalid: true };
  }
}

async function classifyHint(container, hint, expectedStatus) {
  try {
    const { resource } = await container.item(hint.taskId, hint.shopName).read();
    if (!resource) {
      return { keep: false, reason: "missing" };
    }
    if (resource.status !== expectedStatus) {
      return { keep: false, reason: resource.status };
    }
    return { keep: true, reason: expectedStatus };
  } catch (err) {
    const code = err?.code ?? err?.statusCode;
    if (code === 404) return { keep: false, reason: "missing" };
    throw err;
  }
}

async function cleanupStage(redis, container, stageName, config, apply) {
  const { keys, expectedStatus } = config;
  let totalKept = 0;
  let totalDropped = 0;

  for (const key of keys) {
    const len = await redis.llen(key);
    if (len === 0) {
      console.log(`[${stageName}] ${key} empty — skip`);
      continue;
    }

    const raws = await redis.lrange(key, 0, len - 1);
    const kept = [];
    const dropped = [];

    for (const entry of raws.map(parseHint)) {
      if (entry.invalid) {
        dropped.push({ ...entry, reason: "invalid_json" });
        continue;
      }
      const verdict = await classifyHint(container, entry.hint, expectedStatus);
      if (verdict.keep) {
        kept.push(entry);
      } else {
        dropped.push({ ...entry, reason: verdict.reason });
      }
    }

    const dropByReason = {};
    for (const d of dropped) {
      dropByReason[d.reason] = (dropByReason[d.reason] || 0) + 1;
    }

    console.log(`\n=== ${stageName} ${key} ===`);
    console.log(`before=${len} keep=${kept.length} drop=${dropped.length}`);
    if (Object.keys(dropByReason).length) {
      console.log("dropByReason:", dropByReason);
    }
    if (kept.length) {
      console.log(
        "kept head:",
        kept.slice(0, 8).map((k) => ({
          taskId: k.hint.taskId,
          shop: k.hint.shopName,
        })),
      );
    }
    if (dropped.length) {
      console.log(
        "dropped head:",
        dropped.slice(0, 8).map((d) => ({
          taskId: d.hint?.taskId ?? d.raw?.slice(0, 40),
          shop: d.hint?.shopName,
          reason: d.reason,
        })),
      );
    }

    if (apply && dropped.length > 0) {
      const multi = redis.multi();
      multi.del(key);
      for (const k of kept) {
        multi.rpush(key, k.raw);
      }
      await multi.exec();
      console.log(`[${stageName}] applied — ${key} rewritten (${kept.length} kept)`);
    } else if (apply && dropped.length === 0) {
      console.log(`[${stageName}] ${key} nothing to clean`);
    } else if (!apply && dropped.length > 0) {
      console.log(`[${stageName}] dry-run only — re-run with --apply to rewrite`);
    }

    totalKept += kept.length;
    totalDropped += dropped.length;
  }

  return { kept: totalKept, dropped: totalDropped };
}

const { apply, stage } = parseArgs(process.argv.slice(2));
const { env, overlay } = loadStackedEnv({ root });
if (apply) {
  assertProdWriteAllowed(process.argv.slice(2), overlay);
}
const { url: redisUrl } = resolveRedisUrl(env);
const cosmosCfg = resolveCosmos(env);

if (!redisUrl || !cosmosCfg.endpoint || !cosmosCfg.key) {
  console.error("Missing RENDER_KV / COSMOS 凭据（默认测环境）");
  process.exit(1);
}

console.log(`mode=${apply ? "APPLY" : "DRY-RUN"} stage=${stage}`);

const redis = new IORedis(redisUrl, {
  maxRetriesPerRequest: 2,
  connectTimeout: 20000,
});
await redis.ping();

const cosmos = new CosmosClient({
  endpoint: cosmosCfg.endpoint,
  key: cosmosCfg.key,
});
const container = cosmos
  .database(cosmosCfg.databaseId)
  .container(cosmosCfg.containerId);

const stages =
  stage === "all" ? Object.entries(STAGE_CONFIG) : [[stage, STAGE_CONFIG[stage]]];

let totalKept = 0;
let totalDropped = 0;
for (const [name, config] of stages) {
  const { kept, dropped } = await cleanupStage(redis, container, name, config, apply);
  totalKept += kept;
  totalDropped += dropped;
}

console.log(`\nTotal keep=${totalKept} drop=${totalDropped}`);
await redis.quit();
