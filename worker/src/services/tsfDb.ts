import { createClient, type Client, type InStatement, type ResultSet } from "@libsql/client/web";

/** Turso 网关瞬时错误（502/503/504）短退避重试次数，与 shopifyFetch 默认一致。 */
const TSF_DB_5XX_MAX_RETRIES = Math.max(
  0,
  Number(process.env.TSF_DB_5XX_MAX_RETRIES?.trim()) || 2,
);
const TSF_DB_5XX_RETRY_STATUSES = new Set([502, 503, 504]);

/**
 * 连接 TSF Turso 库，读取自动翻译配置、Session token、Glossary 等。
 *
 * 环境变量（本地 `.env` / Render Worker Environment）：
 *   TURSO_DATABASE_URL   libsql://xxx.turso.io
 *   TURSO_AUTH_TOKEN     eyJhbGci...
 *
 * 短期兼容：TSF_TURSO_* → TURSO_TEST_* → TURSO_PROD_*
 */
let client: Client | null = null;
let deprecationLogged = false;

function normalizeEnv(value: string | undefined): string {
  let v = (value ?? "").trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

const PRIMARY_URL_KEY = "TURSO_DATABASE_URL";
const PRIMARY_TOKEN_KEY = "TURSO_AUTH_TOKEN";

const LEGACY_TURSO_PAIRS = [
  ["TSF_TURSO_DATABASE_URL", "TSF_TURSO_AUTH_TOKEN"],
  ["TURSO_TEST_DATABASE_URL", "TURSO_TEST_AUTH_TOKEN"],
  ["TURSO_PROD_DATABASE_URL", "TURSO_PROD_AUTH_TOKEN"],
] as const;

function readTursoPair(): { url: string; authToken: string; urlKey: string } {
  const primaryUrl = normalizeEnv(process.env[PRIMARY_URL_KEY]);
  const primaryToken = normalizeEnv(process.env[PRIMARY_TOKEN_KEY]);
  if (primaryUrl.startsWith("libsql://") && primaryToken) {
    return { url: primaryUrl, authToken: primaryToken, urlKey: PRIMARY_URL_KEY };
  }

  for (const [urlKey, tokenKey] of LEGACY_TURSO_PAIRS) {
    const url = normalizeEnv(process.env[urlKey]);
    const authToken = normalizeEnv(process.env[tokenKey]);
    if (url.startsWith("libsql://") && authToken) {
      if (!deprecationLogged) {
        deprecationLogged = true;
        console.warn(
          `[tsfDb] 使用兼容键 ${urlKey}；请改为 ${PRIMARY_URL_KEY} / ${PRIMARY_TOKEN_KEY}`,
        );
      }
      return { url, authToken, urlKey };
    }
  }

  return { url: primaryUrl, authToken: primaryToken, urlKey: PRIMARY_URL_KEY };
}

export function hasTsfDbCredentials(): boolean {
  const { url, authToken } = readTursoPair();
  return url.startsWith("libsql://") && Boolean(authToken);
}

export function getTsfDb(): Client {
  if (client) return client;
  const { url, authToken, urlKey } = readTursoPair();
  if (!url.startsWith("libsql://") || !authToken) {
    throw new Error(
      `TSF Turso 未配置：请设置 ${PRIMARY_URL_KEY}（libsql://...）与 ${PRIMARY_TOKEN_KEY}` +
        `（当前未命中可用键，含兼容 ${urlKey}）`,
    );
  }
  client = createClient({ url, authToken });
  return client;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function collectTsfDbErrorStrings(error: unknown): string[] {
  const strings: string[] = [];
  let current: unknown = error;
  while (current) {
    if (current instanceof Error) {
      strings.push(current.message);
      const code = (current as NodeJS.ErrnoException).code;
      if (typeof code === "string") strings.push(code);
      current = current.cause;
    } else if (typeof current === "string") {
      strings.push(current);
      break;
    } else {
      strings.push(String(current));
      break;
    }
  }
  return strings;
}

function hasTransientTsfDbHttpStatus(error: unknown): boolean {
  let current: unknown = error;
  while (current) {
    if (typeof current === "object" && current !== null && "status" in current) {
      const status = Number((current as { status?: unknown }).status);
      if (TSF_DB_5XX_RETRY_STATUSES.has(status)) return true;
    }
    current =
      current instanceof Error
        ? current.cause
        : typeof current === "object" && current !== null && "cause" in current
          ? (current as { cause?: unknown }).cause
          : undefined;
  }
  return false;
}

function isTransientTsfDbError(error: unknown): boolean {
  const text = collectTsfDbErrorStrings(error).join("\n");
  if (hasTransientTsfDbHttpStatus(error)) return true;
  if (/HTTP status 50[234]|HTTP 50[234]/i.test(text)) return true;
  if (/SERVER_ERROR/i.test(text) && /50[234]/.test(text)) return true;
  return /ETIMEDOUT|ECONNRESET|EAI_AGAIN|fetch failed/i.test(text);
}

function sqlHint(statement: string | InStatement): string {
  const sql = typeof statement === "string" ? statement : statement.sql;
  return sql.replace(/\s+/g, " ").trim().slice(0, 80);
}

/** 带 502/503/504 短退避重试的 Turso execute（默认重试 2 次）。 */
export async function tsfExecute(
  statement: string | InStatement,
  retries5xx = TSF_DB_5XX_MAX_RETRIES,
): Promise<ResultSet> {
  try {
    return await getTsfDb().execute(statement);
  } catch (error) {
    if (!isTransientTsfDbError(error) || retries5xx <= 0) throw error;
    const waitMs = Math.min(8_000, 2_000 * (TSF_DB_5XX_MAX_RETRIES - retries5xx + 1));
    console.warn(
      `[tsfDb] transient Turso error — waiting ${waitMs}ms (retries left: ${retries5xx - 1}) sql=${sqlHint(statement)}`,
    );
    await sleep(waitMs);
    return tsfExecute(statement, retries5xx - 1);
  }
}

export type AutoTranslateShop = {
  shop: string;
  primaryLocale: string;
  targets: string[];
};

/** 自动扫描用：开了自动翻译的店。 */
export async function listAutoTranslateShops(): Promise<AutoTranslateShop[]> {
  // 按语言精确取：该语言开了自动翻译（ShopTargetLocale）
  const rs = await tsfExecute(
    `SELECT s.shop AS shop, s.primaryLocale AS primaryLocale, t.locale AS target
     FROM ShopTranslationSettings s
     JOIN ShopTargetLocale t ON t.shop = s.shop
     WHERE t.autoTranslate = 1`,
  );
  const byShop = new Map<string, AutoTranslateShop>();
  for (const r of rs.rows) {
    const shop = String(r.shop);
    const primaryLocale = String(r.primaryLocale);
    const target = String(r.target);
    const entry = byShop.get(shop) ?? { shop, primaryLocale, targets: [] };
    entry.targets.push(target);
    byShop.set(shop, entry);
  }
  return [...byShop.values()];
}

/**
 * scheduled shop scan 候选店：有未软删 Account + offline Session token。
 * 不要求开启自动翻译（「每个可扫店」覆盖）。
 */
export async function listScannableShops(): Promise<string[]> {
  const rs = await tsfExecute(
    `SELECT DISTINCT sess.shop AS shop
     FROM Session sess
     INNER JOIN Account a ON a.shop = sess.shop AND a.deletedAt IS NULL
     WHERE sess.isOnline = 0
       AND sess.accessToken IS NOT NULL
     ORDER BY sess.shop ASC`,
  );
  return rs.rows.map((r) => String(r.shop));
}

function normalizeLocaleKey(locale: string): string {
  return locale.trim().replace(/_/g, "-").toLowerCase();
}

/**
 * 商家在 Shopify 改了默认语言后，把 TSF 缓存的 primaryLocale 对齐到最新值。
 * 自动翻译 worker 建任务时用 Shopify 实时 primary 作 source。
 */
export async function syncShopPrimaryLocaleInTsf(
  shop: string,
  primaryLocale: string,
): Promise<boolean> {
  const primary = primaryLocale.trim();
  if (!primary) return false;

  const rs = await tsfExecute({
    sql: "SELECT primaryLocale FROM ShopTranslationSettings WHERE shop = ? LIMIT 1",
    args: [shop],
  });
  const row = rs.rows[0];
  if (!row) return false;

  const stored = String(row.primaryLocale ?? "");
  if (normalizeLocaleKey(stored) === normalizeLocaleKey(primary)) return false;

  await tsfExecute({
    sql: "UPDATE ShopTranslationSettings SET primaryLocale = ?, updatedAt = datetime('now') WHERE shop = ?",
    args: [primary, shop],
  });
  console.log(`[tsfDb] primaryLocale synced shop=${shop} ${stored} → ${primary}`);
  return true;
}

/**
 * 从 TSF 的 Session 表取该店的 offline accessToken。
 * 这是 Worker 调用 Shopify Admin API 的唯一 token 来源；不使用 job 快照或缓存。
 */
export async function getOfflineAccessTokenFromTsf(shop: string): Promise<string | null> {
  const rs = await tsfExecute({
    sql: "SELECT accessToken FROM Session WHERE shop = ? AND isOnline = 0 AND accessToken IS NOT NULL LIMIT 1",
    args: [shop],
  });
  const token = rs.rows[0]?.accessToken;
  return token ? String(token) : null;
}

/** 读 tsf 账户剩余额度（三池之和 - 已用）。无账户返回 null。 */
export async function getTsfAccountRemaining(shop: string): Promise<number | null> {
  if (!hasTsfDbCredentials()) return null;
  const rs = await tsfExecute({
    sql: "SELECT subscriptionCredits, purchasedCredits, trialCredits, usedCredits FROM Account WHERE shop = ? AND deletedAt IS NULL LIMIT 1",
    args: [shop],
  });
  const r = rs.rows[0];
  if (!r) return null;
  const total =
    Number(r.subscriptionCredits ?? 0) +
    Number(r.purchasedCredits ?? 0) +
    Number(r.trialCredits ?? 0);
  return total - Number(r.usedCredits ?? 0);
}

/** 检查店铺是否在 TSF Account 表中有记录且未被软删除（有账户 = 有付费/试用资格）。 */
export async function hasTsfAccount(shop: string): Promise<boolean> {
  if (!hasTsfDbCredentials()) return false;
  const rs = await tsfExecute({
    sql: "SELECT 1 FROM Account WHERE shop = ? AND deletedAt IS NULL LIMIT 1",
    args: [shop],
  });
  return rs.rows.length > 0;
}

/**
 * tsf 账户周期内扣减：仅自增 usedCredits（分池结算在续费时做），返回扣减后剩余。
 * 无账户或未配置 Turso → 返回 null（调用方视为扣减失败）。
 */
export async function deductTsfAccountCredits(
  shop: string,
  amount: number,
): Promise<number | null> {
  if (!hasTsfDbCredentials()) return null;
  const amt = Math.max(0, Math.ceil(amount));
  if (amt > 0) {
    const res = await tsfExecute({
      sql: "UPDATE Account SET usedCredits = usedCredits + ?, updatedAt = datetime('now') WHERE shop = ? AND deletedAt IS NULL",
      args: [amt, shop],
    });
    if (!res.rowsAffected) return null;
  }
  return getTsfAccountRemaining(shop);
}

export type TsfGlossaryRow = {
  sourceText: string;
  targetText: string;
  rangeCode: string | null;
  caseSensitive: boolean;
};

/**
 * 从 TSF Turso 读该店适用于 target 的术语表。
 * 过滤口径与 Java GlossaryService.getGlossaryDoByShopName 一致：rangeCode == target 或 "ALL"。
 */
export async function loadGlossaryRowsFromTsf(
  shop: string,
  target: string,
): Promise<TsfGlossaryRow[]> {
  const rs = await tsfExecute({
    sql: "SELECT sourceText, targetText, rangeCode, caseSensitive FROM Glossary WHERE shop = ? AND status = 1 AND (rangeCode = ? OR rangeCode = 'ALL' OR rangeCode IS NULL)",
    args: [shop, target],
  });
  return rs.rows.map((r) => ({
    sourceText: String(r.sourceText ?? ""),
    targetText: String(r.targetText ?? ""),
    rangeCode: r.rangeCode != null ? String(r.rangeCode) : null,
    caseSensitive: Number(r.caseSensitive) === 1,
  }));
}

