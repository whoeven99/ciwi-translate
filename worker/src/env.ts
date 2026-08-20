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

function mask(key: string, value: string): string {
  const v = value.trim();
  if (!v) return "❌ 缺失";
  if (/TOKEN|SECRET|KEY|PASSWORD|CONNECTION_STRING/i.test(key)) {
    return `(已设置,len=${v.length})`;
  }
  if (v.length > 48) return `${v.slice(0, 48)}…`;
  return v;
}

function redisConfigured(): boolean {
  return Boolean(process.env.RENDER_KV?.trim());
}

function llmConfigured(): boolean {
  return Boolean(
    process.env.DEEPSEEK_API_KEYS?.trim() ||
      process.env.DEEPSEEK_API_KEY?.trim() ||
      process.env.Gpt_ApiKey?.trim(),
  );
}

function tursoConfigured(): boolean {
  return Boolean(
    (process.env.TURSO_DATABASE_URL?.trim()?.startsWith("libsql://") &&
      process.env.TURSO_AUTH_TOKEN?.trim()) ||
      (process.env.TSF_TURSO_DATABASE_URL?.trim()?.startsWith("libsql://") &&
        process.env.TSF_TURSO_AUTH_TOKEN?.trim()) ||
      (process.env.TURSO_TEST_DATABASE_URL?.trim()?.startsWith("libsql://") &&
        process.env.TURSO_TEST_AUTH_TOKEN?.trim()) ||
      (process.env.TURSO_PROD_DATABASE_URL?.trim()?.startsWith("libsql://") &&
        process.env.TURSO_PROD_AUTH_TOKEN?.trim()),
  );
}

function collectChecks(): ServiceCheck[] {
  const cosmosOk = Boolean(
    process.env.COSMOS_ENDPOINT?.trim() && process.env.COSMOS_KEY?.trim(),
  );
  const blobOk = Boolean(process.env.AZURE_BLOB_CONNECTION_STRING?.trim());
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
      hint: "RENDER_KV",
    },
    {
      label: "Blob",
      ok: blobOk,
      hint: "AZURE_BLOB_CONNECTION_STRING",
    },
    {
      label: "Turso",
      ok: tursoConfigured(),
      hint: "TURSO_DATABASE_URL, TURSO_AUTH_TOKEN",
    },
    {
      label: "LLM",
      ok: llmConfigured(),
      hint: "DEEPSEEK_API_KEYS（或 DEEPSEEK_API_KEY）或 Gpt_ApiKey",
    },
    {
      label: "SES",
      ok: sesOk,
      hint: "TENCENT_CLOUD_KEY_ID, TENCENT_CLOUD_KEY（邮件可选）",
    },
  ];
}

/** 只打印现行主 key，避免兼容旧名刷 ❌ */
function logPrimaryEnvDetails(): void {
  console.info(`${LOG} ===== 关键变量 =====`);
  const rows: Array<[string, string | undefined, string?]> = [
    ["TURSO_DATABASE_URL", process.env.TURSO_DATABASE_URL],
    ["TURSO_AUTH_TOKEN", process.env.TURSO_AUTH_TOKEN],
    ["RENDER_KV", process.env.RENDER_KV],
    ["COSMOS_ENDPOINT", process.env.COSMOS_ENDPOINT],
    ["COSMOS_KEY", process.env.COSMOS_KEY],
    ["AZURE_BLOB_CONNECTION_STRING", process.env.AZURE_BLOB_CONNECTION_STRING],
    ["DEEPSEEK_API_KEYS", process.env.DEEPSEEK_API_KEYS],
    ["DEEPSEEK_API_KEY", process.env.DEEPSEEK_API_KEY],
    ["Gpt_ApiKey", process.env.Gpt_ApiKey],
    ["TENCENT_CLOUD_KEY_ID", process.env.TENCENT_CLOUD_KEY_ID],
    ["TENCENT_CLOUD_KEY", process.env.TENCENT_CLOUD_KEY],
  ];
  for (const [key, value, def] of rows) {
    if (value?.trim()) {
      console.info(`${LOG}   ${key}=${mask(key, value)}`);
    } else if (def) {
      console.info(`${LOG}   ${key}=(默认 ${def})`);
    } else if (
      key === "DEEPSEEK_API_KEY" &&
      process.env.DEEPSEEK_API_KEYS?.trim()
    ) {
      // 有 KEYS 时不报单 key 缺失
      continue;
    } else if (
      key === "DEEPSEEK_API_KEYS" &&
      process.env.DEEPSEEK_API_KEY?.trim()
    ) {
      continue;
    } else {
      console.info(`${LOG}   ${key}=❌ 缺失`);
    }
  }
  console.info(`${LOG} =================`);
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

  logPrimaryEnvDetails();

  const failed = checks.filter((c) => !c.ok);
  for (const c of failed) {
    console.warn(`${LOG} ${c.label} 未就绪 → 需要 ${c.hint}`);
  }

  if (process.env.RENDER_KV?.trim()) {
    console.info(`${LOG} redis: RENDER_KV set`);
  } else if (
    process.env.REDIS_DUAL_WRITE?.trim() ||
    process.env.REDIS_CUTOVER?.trim()
  ) {
    console.warn(
      `${LOG} redis: REDIS_DUAL_WRITE / REDIS_CUTOVER 已废弃，请改配 RENDER_KV`,
    );
  }

  const cosmosOk = checks.find((c) => c.label === "Cosmos")?.ok;
  if (!cosmosOk && secretApplied === 0) {
    console.warn(
      `${LOG} ⚠️ Cosmos 未配置且未从 Secret File 加载变量，请检查 Render Environment / Secret File`,
    );
  }
}
