/**
 * Turso 凭据：只认一对主键。
 *   TURSO_DATABASE_URL / TURSO_AUTH_TOKEN
 *
 * 测/产由部署环境区分（本地 `.env`、Render 各服务各自配值），代码不再读 TURSO_TARGET。
 *
 * 短期兼容回退（会打一次 deprecate 日志）：
 *   TSF_TURSO_* → TURSO_TEST_* → TURSO_PROD_*
 */

import { getRuntimeEnv, normalizeEnvValue } from "./runtimeEnv.server";

export { normalizeEnvValue };

const PLACEHOLDER_URL_MARKERS = [
  "your-prod",
  "replace_me",
  "xxx.turso",
  "example.turso",
  "changeme",
] as const;

const PRIMARY_URL_KEY = "TURSO_DATABASE_URL";
const PRIMARY_TOKEN_KEY = "TURSO_AUTH_TOKEN";

/** 主键之后的兼容候选（成对）。 */
const LEGACY_TURSO_PAIRS = [
  ["TSF_TURSO_DATABASE_URL", "TSF_TURSO_AUTH_TOKEN"],
  ["TURSO_TEST_DATABASE_URL", "TURSO_TEST_AUTH_TOKEN"],
  ["TURSO_PROD_DATABASE_URL", "TURSO_PROD_AUTH_TOKEN"],
] as const;

let deprecationLogged = false;

function isPlaceholderTursoUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return PLACEHOLDER_URL_MARKERS.some((marker) => lower.includes(marker));
}

function isUsableLibsqlUrl(value: string): boolean {
  if (!value.startsWith("libsql://")) return false;
  if (isPlaceholderTursoUrl(value)) return false;
  return true;
}

function pickPair(
  urlKey: string,
  tokenKey: string,
): { url: string; authToken: string; urlKey: string; tokenKey: string } | null {
  const url = getRuntimeEnv(urlKey);
  const authToken = getRuntimeEnv(tokenKey);
  if (!isUsableLibsqlUrl(url) || !authToken) return null;
  return { url, authToken, urlKey, tokenKey };
}

function logLegacyOnce(urlKey: string): void {
  if (deprecationLogged) return;
  deprecationLogged = true;
  console.warn(
    `[Turso] 使用兼容键 ${urlKey}；请改为 ${PRIMARY_URL_KEY} / ${PRIMARY_TOKEN_KEY}`,
  );
}

/**
 * 读取当前进程应连接的 Turso 凭据。
 * 优先主键；否则回退旧键（同进程只打一次 deprecate 日志）。
 */
export function readTursoCredentials(): {
  url: string;
  authToken: string;
  urlKey: string;
  tokenKey: string;
} {
  const primary = pickPair(PRIMARY_URL_KEY, PRIMARY_TOKEN_KEY);
  if (primary) return primary;

  for (const [urlKey, tokenKey] of LEGACY_TURSO_PAIRS) {
    const legacy = pickPair(urlKey, tokenKey);
    if (legacy) {
      logLegacyOnce(urlKey);
      return legacy;
    }
  }

  return {
    url: getRuntimeEnv(PRIMARY_URL_KEY),
    authToken: getRuntimeEnv(PRIMARY_TOKEN_KEY),
    urlKey: PRIMARY_URL_KEY,
    tokenKey: PRIMARY_TOKEN_KEY,
  };
}

/** 当前进程是否已配置可用的 Turso 凭据（含短期兼容键）。 */
export function hasTursoCredentials(): boolean {
  const { url, authToken } = readTursoCredentials();
  return isUsableLibsqlUrl(url) && Boolean(authToken);
}
