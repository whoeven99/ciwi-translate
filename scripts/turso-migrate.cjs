/**
 * 对 Turso 做 Prisma 风格增量迁移：维护 _prisma_migrations，只执行未应用的 migration.sql。
 *
 * 说明：Prisma CLI 的 `migrate deploy` 在 provider=sqlite 时要求 DATABASE_URL 为 file:，
 * 不能直接连 libsql://。本脚本用 @libsql/client 执行 SQL，并写入 _prisma_migrations。
 *
 * 用法：
 *   npm run turso:migrate:test   # 读 .env + .env.test
 *   npm run turso:migrate:prod   # 读 .env + .env.prod
 *
 * 凭据（文件内同一对键；测/产靠不同 env 文件区分）：
 *   TURSO_DATABASE_URL / TURSO_AUTH_TOKEN
 * 短期兼容回退：
 *   TSF_TURSO_* → 该 target 的 TURSO_{TEST|PROD}_*
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@libsql/client/http");

/** 本地 migration → 执行后应存在的代表性表（用于漂移修复） */
const MIGRATION_MARKERS = [
  { name: "20250526051132_init", table: "Session" },
  { name: "20250619000000_add_session_refresh_token", table: "Session" },
  { name: "20260622111403_add_shop_translation_glossary_liquid", table: "ShopTranslationSettings" },
  { name: "20260622144316_add_shop_target_locale_glossary_int_id", table: "ShopTargetLocale" },
  {
    name: "20260629100000_add_switcher_configuration_ip_redirection",
    table: "SwitcherConfiguration",
  },
];

const PRISMA_MIGRATIONS_DDL = `
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                    TEXT PRIMARY KEY NOT NULL,
    "checksum"              TEXT NOT NULL,
    "finished_at"           DATETIME,
    "migration_name"        TEXT NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        DATETIME,
    "started_at"            DATETIME NOT NULL,
    "applied_steps_count"   INTEGER NOT NULL DEFAULT 0
);
`;

function loadDotEnv(dotenvPath) {
  if (!fs.existsSync(dotenvPath)) return {};
  const content = fs.readFileSync(dotenvPath, "utf8");
  const result = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

/** 合并多个 env 文件；后文件覆盖先文件。process.env 已有键不覆盖。 */
function loadEnvFiles(paths) {
  const merged = {};
  const loaded = [];
  for (const p of paths) {
    if (!fs.existsSync(p)) continue;
    Object.assign(merged, loadDotEnv(p));
    loaded.push(path.basename(p));
  }
  return { merged, loaded };
}

/**
 * 解析 Turso 凭据。主键优先；兼容旧键。migrate 的 target 仅决定加载哪个 env 文件，
 * 以及旧键回退时用 TEST 还是 PROD（不跨环境互备）。
 * @returns {{ url: string, authToken: string, urlKey: string, tokenKey: string }}
 */
function resolveTursoCreds(target, fileEnv) {
  const pick = (urlKey, tokenKey) => {
    const url = (process.env[urlKey] || fileEnv[urlKey] || "").trim();
    const authToken = (process.env[tokenKey] || fileEnv[tokenKey] || "").trim();
    if (!url || !authToken) return null;
    return { url, authToken, urlKey, tokenKey };
  };

  const primary = pick("TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN");
  if (primary) return primary;

  const tsf = pick("TSF_TURSO_DATABASE_URL", "TSF_TURSO_AUTH_TOKEN");
  if (tsf) {
    console.warn(
      `[turso:migrate] 使用兼容键 ${tsf.urlKey}；请改为 TURSO_DATABASE_URL / TURSO_AUTH_TOKEN`,
    );
    return tsf;
  }

  const legacy =
    target === "prod"
      ? pick("TURSO_PROD_DATABASE_URL", "TURSO_PROD_AUTH_TOKEN")
      : pick("TURSO_TEST_DATABASE_URL", "TURSO_TEST_AUTH_TOKEN");
  if (legacy) {
    console.warn(
      `[turso:migrate] 使用兼容键 ${legacy.urlKey}；请改为 TURSO_DATABASE_URL / TURSO_AUTH_TOKEN`,
    );
    return legacy;
  }

  throw new Error(
    `无效 Turso 凭据（target=${target}）。请在对应 env 文件配置 TURSO_DATABASE_URL / TURSO_AUTH_TOKEN`,
  );
}

function listMigrations(migrationsDir) {
  if (!fs.existsSync(migrationsDir)) return [];
  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .map((name) => ({
      name,
      sqlPath: path.join(migrationsDir, name, "migration.sql"),
    }))
    .filter((m) => fs.existsSync(m.sqlPath));
}

function checksumSql(sql) {
  return crypto.createHash("sha256").update(sql, "utf8").digest("hex");
}

function splitStatements(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function executeWithRetry(client, statement, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await client.execute(statement);
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, attempt * 800));
      }
    }
  }
  throw lastError;
}

async function tableExists(client, table) {
  try {
    await client.execute(`SELECT 1 FROM "${table}" LIMIT 1`);
    return true;
  } catch {
    return false;
  }
}

/** SQLite/Turso 不支持 ADD COLUMN IF NOT EXISTS；列/表/索引已存在时跳过。 */
async function executeMigrationStatement(client, statement) {
  try {
    return await executeWithRetry(client, statement);
  } catch (error) {
    const msg = String(error.message || error);
    const isAlterAdd =
      /^\s*ALTER\s+TABLE\b/i.test(statement) && /\bADD\s+COLUMN\b/i.test(statement);
    if (isAlterAdd && /duplicate column name/i.test(msg)) {
      console.log(`[turso:migrate] 跳过已存在列 (${statement.split(/\s+/).slice(-3).join(" ")})`);
      return;
    }
    const isCreateTable = /^\s*CREATE\s+TABLE\b/i.test(statement);
    if (isCreateTable && /already exists/i.test(msg)) {
      console.log("[turso:migrate] 跳过已存在表");
      return;
    }
    const isCreateIndex = /^\s*CREATE\s+(UNIQUE\s+)?INDEX\b/i.test(statement);
    if (isCreateIndex && /already exists/i.test(msg)) {
      console.log("[turso:migrate] 跳过已存在索引");
      return;
    }
    throw error;
  }
}

async function applyMigrationSql(client, migration, target) {
  const sql = fs.readFileSync(migration.sqlPath, "utf8");
  console.log(`[turso:migrate:${target}] 应用: ${migration.name}`);
  for (const statement of splitStatements(sql)) {
    await executeMigrationStatement(client, statement);
  }
  return sql;
}

/** 修复「_prisma_migrations 已标记但表未创建」的漂移（多由 baseline --through 误标引起）。 */
async function repairDrift(client, migrations, applied, target) {
  const migrationByName = new Map(migrations.map((m) => [m.name, m]));
  let repaired = 0;

  for (const marker of MIGRATION_MARKERS) {
    if (!applied.has(marker.name)) continue;
    if (await tableExists(client, marker.table)) continue;

    const migration = migrationByName.get(marker.name);
    if (!migration) continue;

    console.warn(
      `[turso:migrate:${target}] 漂移: ${marker.name} 已标记但表 ${marker.table} 不存在，重新执行 SQL`,
    );
    await applyMigrationSql(client, migration, target);
    repaired += 1;
  }

  return repaired;
}

async function getAppliedNames(client) {
  const res = await client.execute(
    'SELECT migration_name FROM "_prisma_migrations" WHERE rolled_back_at IS NULL',
  );
  return new Set(res.rows.map((row) => String(row.migration_name)));
}

async function markApplied(client, migrationName, sql) {
  const now = new Date().toISOString().replace("T", " ").replace("Z", "");
  const id = crypto.randomUUID();
  const checksum = checksumSql(sql);
  await client.execute({
    sql: `INSERT INTO "_prisma_migrations"
      (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
      VALUES (?, ?, ?, ?, NULL, NULL, ?, 1)`,
    args: [id, checksum, now, migrationName, now],
  });
}

async function main() {
  const root = process.cwd();
  const target = (process.argv[2] || "test").trim().toLowerCase();

  if (target !== "test" && target !== "prod") {
    throw new Error('仅支持 "test" 或 "prod"');
  }

  const targetEnvFile = target === "prod" ? ".env.prod" : ".env.test";
  const { merged: fileEnv, loaded: loadedEnvFiles } = loadEnvFiles([
    path.join(root, ".env"),
    path.join(root, targetEnvFile),
  ]);

  const { url, authToken, urlKey, tokenKey } = resolveTursoCreds(target, fileEnv);

  if (!url.startsWith("libsql://")) throw new Error(`无效 ${urlKey}（需 libsql://）`);
  if (authToken === "REPLACE_ME") throw new Error(`无效 ${tokenKey}`);

  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  })();
  console.log(
    `[turso:migrate:${target}] 目标库 host=${host} key=${urlKey}` +
      (loadedEnvFiles.length ? ` env=${loadedEnvFiles.join("+")}` : ""),
  );

  const client = createClient({ url, authToken });
  const migrations = listMigrations(path.join(root, "prisma", "migrations"));

  await executeWithRetry(client, PRISMA_MIGRATIONS_DDL.trim());
  const applied = await getAppliedNames(client);

  const repaired = await repairDrift(client, migrations, applied, target);

  let ran = 0;

  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;

    const sql = await applyMigrationSql(client, migration, target);
    await markApplied(client, migration.name, sql);
    ran += 1;
  }

  for (const table of ["SwitcherConfiguration"]) {
    const ok = await tableExists(client, table);
    console.log(`[turso:migrate:${target}] 校验 ${table}: ${ok ? "OK" : "缺失"}`);
    if (!ok) {
      throw new Error(`迁移后仍缺少表 ${table}，请检查 ${urlKey} 是否指向预期 Turso 库`);
    }
  }

  const status = await client.execute(
    'SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY finished_at',
  );
  console.log(`[turso:migrate:${target}] 本次应用 ${ran} 条 migration，漂移修复 ${repaired} 条`);
  console.log(
    `[turso:migrate:${target}] 共 ${status.rows.length} 条记录在 _prisma_migrations`,
  );
  if (ran === 0 && repaired === 0) {
    console.log(`[turso:migrate:${target}] 无待执行 migration（已是最新）`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("[turso:migrate] 失败:", error.message || error);
    process.exit(1);
  });
}