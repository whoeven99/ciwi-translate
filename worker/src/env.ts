import { existsSync, readFileSync } from "node:fs";

const LOG = "[worker:env]";

/** 去掉首尾空白与成对引号 */
function normalize(value: string): string {
  let v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

/** 加载单个 KEY=VALUE 文件，仅设置尚为空的键（不覆盖 Render 已注入的） */
function loadEnvFile(filePath: string): number {
  try {
    const content = readFileSync(filePath, "utf8");
    let appliedCount = 0;
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      if (!key) continue;
      const value = normalize(line.slice(eq + 1));
      if (process.env[key] !== undefined && process.env[key] !== "") continue;
      process.env[key] = value;
      appliedCount++;
    }
    return appliedCount;
  } catch (err) {
    console.error(`${LOG} 读取 ${filePath} 失败:`, err);
    return 0;
  }
}

const SECRET_PATHS = [
  "/etc/secrets/.env",
  "/etc/secrets/env",
  "/var/secrets/.env",
];

type ServiceCheck = {
  label: string;
  ok: boolean;
  /** 仅 ok=false 时打印 */
  hint?: string;
};

function redisConfigured(): boolean {
  // Sole mode: REDIS_CUTOVER=all + dual-write off → only RENDER_KV
  const dual = (process.env.REDIS_DUAL_WRITE?.trim() || "").toLowerCase();
  const dualOn = dual === "1" || dual === "true" || dual === "yes";
  const cutover = (process.env.REDIS_CUTOVER?.trim() || "").toLowerCase();
  const cutoverAll =
    cutover === "all" ||
    cutover === "*" ||
    cutover.split(",").some((t) => t.trim() === "all" || t.trim() === "*");
  if (!dualOn && cutoverAll && process.env.RENDER_KV?.trim()) return true;

  if (process.env.REDIS_URL?.trim() || process.env.REDIS_URL_V4?.trim()) {
    return true;
  }
  const host =
    process.env.REDIS_HOSTNAME?.trim() ||
    process.env.REDIS_HOST?.trim() ||
    process.env.REDISCACHEHOSTNAME?.trim();
  const password =
    process.env.REDIS_PASSWORD?.trim() || process.env.REDISCACHEKEY?.trim();
  return Boolean(host && password);
}

function llmConfigured(): boolean {
  return Boolean(
    process.env.DEEPSEEK_API_KEY?.trim() ||
      process.env.DEEPSEEK_API_KEYS?.trim() ||
      process.env.Gpt_ApiKey?.trim(),
  );
}

function collectChecks(): ServiceCheck[] {
  const cosmosOk = Boolean(
    process.env.COSMOS_ENDPOINT?.trim() && process.env.COSMOS_KEY?.trim(),
  );
  const blobOk = Boolean(process.env.AZURE_BLOB_CONNECTION_STRING?.trim());
  const tsfTursoOk = Boolean(
    (process.env.TURSO_DATABASE_URL?.trim()?.startsWith("libsql://") &&
      process.env.TURSO_AUTH_TOKEN?.trim()) ||
      (process.env.TSF_TURSO_DATABASE_URL?.trim()?.startsWith("libsql://") &&
        process.env.TSF_TURSO_AUTH_TOKEN?.trim()) ||
      (process.env.TURSO_TEST_DATABASE_URL?.trim()?.startsWith("libsql://") &&
        process.env.TURSO_TEST_AUTH_TOKEN?.trim()) ||
      (process.env.TURSO_PROD_DATABASE_URL?.trim()?.startsWith("libsql://") &&
        process.env.TURSO_PROD_AUTH_TOKEN?.trim()),
  );
  const sesOk = Boolean(
    process.env.TENCENT_CLOUD_KEY_ID?.trim() && process.env.TENCENT_CLOUD_KEY?.trim(),
  );
  return [
    {
      label: "Cosmos",
      ok: cosmosOk,
      hint: "COSMOS_ENDPOINT, COSMOS_KEY",
    },
    {
      label: "Redis",
      ok: redisConfigured(),
      hint: "RENDER_KV（sole: CUTOVER=all + DUAL_WRITE off）或 REDIS_URL / REDIS_HOSTNAME+REDIS_PASSWORD",
    },
    {
      label: "Blob",
      ok: blobOk,
      hint: "AZURE_BLOB_CONNECTION_STRING",
    },
    {
      label: "TSF Turso",
      ok: tsfTursoOk,
      hint: "TURSO_DATABASE_URL, TURSO_AUTH_TOKEN（兼容 TSF_TURSO_* / TURSO_TEST_* / TURSO_PROD_*）",
    },
    {
      label: "LLM",
      ok: llmConfigured(),
      hint: "DEEPSEEK_API_KEY 或 Gpt_ApiKey",
    },
    {
      label: "SES",
      ok: sesOk,
      hint: "TENCENT_CLOUD_KEY_ID, TENCENT_CLOUD_KEY（邮件可选）",
    },
  ];
}

/** 启动时加载 Render Secret File + 一行摘要诊断 */
export function ensureWorkerEnv(): void {
  let secretApplied = 0;
  for (const p of SECRET_PATHS) {
    if (existsSync(p)) {
      secretApplied += loadEnvFile(p);
    }
  }

  const checks = collectChecks();
  const summary = checks.map((c) => `${c.label}${c.ok ? "✅" : "❌"}`).join(" · ");
  const stages = process.env.WORKER_STAGES?.trim() || "init,translate,writeback";
  console.info(`${LOG} ${summary} | stages=${stages}`);

  if (secretApplied > 0) {
    console.info(`${LOG} secret file: +${secretApplied} keys`);
  }

  const failed = checks.filter((c) => !c.ok);
  for (const c of failed) {
    console.warn(`${LOG} ${c.label} 未就绪 → 需要 ${c.hint}`);
  }

  const renderKv = Boolean(process.env.RENDER_KV?.trim());
  const dual = (process.env.REDIS_DUAL_WRITE?.trim() || "").toLowerCase();
  const cutover = process.env.REDIS_CUTOVER?.trim() || "(empty)";
  if (renderKv || dual === "true" || dual === "1" || dual === "yes" || process.env.REDIS_CUTOVER?.trim()) {
    const sole =
      !(dual === "true" || dual === "1" || dual === "yes") &&
      (cutover === "all" || cutover === "*");
    console.info(
      `${LOG} redis migrate: RENDER_KV=${renderKv ? "set" : "missing"} dualWrite=${dual || "false"} cutover=${cutover}${sole ? " soleClient=true" : ""}`,
    );
  }

  const cosmosOk = checks.find((c) => c.label === "Cosmos")?.ok;
  if (!cosmosOk && secretApplied === 0) {
    console.warn(
      `${LOG} ⚠️ Cosmos 未配置且未从 Secret File 加载变量，请检查 Render Environment / Secret File`,
    );
  }
}
