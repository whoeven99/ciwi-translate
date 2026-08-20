/**
 * 诊断脚本共用：叠加载 env + 解析 Turso / Redis / Cosmos。
 *
 * ## 口径（与 .cursor/rules/env-prod-safety.mdc 一致）
 * - **默认测环境**：无参数 → .env.test → .env.worker.test → .env
 * - **查生产**：必须显式 `--env=.env.prod`（再叠 .env.worker.prod → .env）
 * - **改生产数据**：除 `--env=.env.prod` 外，还必须加 `--confirm-prod`
 *
 * Redis：RENDER_KV → REDIS_URL_V4 → REDIS_URL
 * Cosmos：*_V4 与无后缀互通
 * Turso：TURSO_DATABASE_URL / TURSO_AUTH_TOKEN（兼容旧键）
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "../..");

export function parseEnvFile(filePath) {
  const env = {};
  if (!existsSync(filePath)) return env;
  for (const raw of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

/** 从 argv 取 --env=；默认测环境 .env.test */
export function pickEnvOverlayFromArgv(argv = process.argv.slice(2), fallback = ".env.test") {
  for (const a of argv) {
    if (a.startsWith("--env=")) {
      return a.slice("--env=".length).trim() || fallback;
    }
  }
  return fallback;
}

function resolveEnvPath(root, nameOrPath) {
  if (!nameOrPath) return null;
  return isAbsolute(nameOrPath) ? nameOrPath : resolve(root, nameOrPath);
}

/**
 * @param {{
 *   root?: string,
 *   overlay?: string,
 *   includeWorkerCompanion?: boolean,
 *   applyToProcess?: boolean,
 *   argv?: string[],
 * }} [opts]
 */
export function loadStackedEnv(opts = {}) {
  const root = opts.root ?? REPO_ROOT;
  const overlayName =
    opts.overlay ??
    pickEnvOverlayFromArgv(opts.argv ?? process.argv.slice(2), ".env.test");
  const includeWorkerCompanion = opts.includeWorkerCompanion !== false;
  const applyToProcess = opts.applyToProcess !== false;

  const files = [];
  const overlayPath = resolveEnvPath(root, overlayName);
  if (overlayPath) files.push(overlayPath);

  if (includeWorkerCompanion) {
    const base = String(overlayName).replace(/\\/g, "/").split("/").pop() || "";
    if (base === ".env.test") files.push(resolve(root, ".env.worker.test"));
    else if (base === ".env.prod") files.push(resolve(root, ".env.worker.prod"));
    else if (base === ".env.worker.test") files.push(resolve(root, ".env.test"));
    else if (base === ".env.worker.prod") files.push(resolve(root, ".env.prod"));
  }

  // .env 最后叠：本地覆盖（如 External RENDER_KV）优先于测/产文件里的 Internal URL
  files.push(resolve(root, ".env"));

  // de-dupe while preserving order
  const seen = new Set();
  const uniqueFiles = [];
  for (const f of files) {
    const n = resolve(f);
    if (seen.has(n)) continue;
    seen.add(n);
    uniqueFiles.push(n);
  }

  const env = {};
  for (const f of uniqueFiles) {
    Object.assign(env, parseEnvFile(f));
  }
  // process.env wins over files for already-exported vars
  for (const [k, v] of Object.entries(process.env)) {
    if (v != null && v !== "") env[k] = v;
  }

  if (applyToProcess) {
    for (const [k, v] of Object.entries(env)) {
      if (process.env[k] == null || process.env[k] === "") process.env[k] = v;
    }
  }

  return { env, files: uniqueFiles.filter((f) => existsSync(f)), overlay: overlayName };
}

export function resolveRedisUrl(env = process.env) {
  const url =
    env.RENDER_KV?.trim() ||
    env.REDIS_URL_V4?.trim() ||
    env.REDIS_URL?.trim() ||
    "";
  let source = null;
  if (env.RENDER_KV?.trim()) source = "RENDER_KV";
  else if (env.REDIS_URL_V4?.trim()) source = "REDIS_URL_V4";
  else if (env.REDIS_URL?.trim()) source = "REDIS_URL";
  return { url: url || null, source };
}

export function resolveCosmos(env = process.env) {
  const endpoint =
    env.COSMOS_ENDPOINT_V4?.trim() || env.COSMOS_ENDPOINT?.trim() || "";
  const key = env.COSMOS_KEY_V4?.trim() || env.COSMOS_KEY?.trim() || "";
  const databaseId =
    env.COSMOS_TRANSLATION_DATABASE_ID_V4?.trim() ||
    env.COSMOS_TRANSLATION_DATABASE_ID?.trim() ||
    "translation";
  const containerId =
    env.COSMOS_TRANSLATION_V4_JOBS_CONTAINER_V4?.trim() ||
    env.COSMOS_TRANSLATION_V4_JOBS_CONTAINER?.trim() ||
    "translation_v4_jobs";
  return {
    endpoint: endpoint || null,
    key: key || null,
    databaseId,
    containerId,
  };
}

export function resolveTurso(env = process.env) {
  const candidates = [
    ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN"],
    ["TSF_TURSO_DATABASE_URL", "TSF_TURSO_AUTH_TOKEN"],
    ["TURSO_TEST_DATABASE_URL", "TURSO_TEST_AUTH_TOKEN"],
    ["TURSO_PROD_DATABASE_URL", "TURSO_PROD_AUTH_TOKEN"],
  ];
  for (const [urlKey, tokenKey] of candidates) {
    const url = env[urlKey]?.trim();
    const authToken = env[tokenKey]?.trim();
    if (url && authToken) return { url, authToken, urlKey };
  }
  return { url: null, authToken: null, urlKey: "TURSO_DATABASE_URL" };
}

/** 当前叠加载是否指向生产 env 文件 */
export function isProdEnvOverlay(overlay) {
  const base = String(overlay || "")
    .replace(/\\/g, "/")
    .split("/")
    .pop();
  return base === ".env.prod" || base === ".env.worker.prod";
}

/**
 * 写生产数据前硬门禁：必须同时有产 overlay + --confirm-prod。
 * @param {string[]} [argv]
 * @param {string} [overlay]
 */
export function assertProdWriteAllowed(
  argv = process.argv.slice(2),
  overlay = pickEnvOverlayFromArgv(argv),
) {
  if (!isProdEnvOverlay(overlay)) return;
  if (argv.includes("--confirm-prod")) return;
  throw new Error(
    [
      "拒绝写生产：检测到 --env 指向生产文件，但未带 --confirm-prod。",
      "只读查询加 --env=.env.prod 即可。",
      "若确认要改产数据，请同时加上：--env=.env.prod --confirm-prod",
      "（Cursor Agent 还须与用户二次确认后再执行。）",
    ].join("\n"),
  );
}

