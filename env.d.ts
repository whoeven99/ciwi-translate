/// <reference types="vite/client" />
/// <reference types="@remix-run/node" />

interface ImportMetaEnv {
  readonly DATABASE_URL?: string;
  readonly TURSO_DATABASE_URL?: string;
  readonly TURSO_AUTH_TOKEN?: string;
  /** @deprecated 短期兼容；请改用 TURSO_DATABASE_URL */
  readonly TURSO_TEST_DATABASE_URL?: string;
  /** @deprecated 短期兼容；请改用 TURSO_AUTH_TOKEN */
  readonly TURSO_TEST_AUTH_TOKEN?: string;
  /** @deprecated 短期兼容；请改用 TURSO_DATABASE_URL */
  readonly TURSO_PROD_DATABASE_URL?: string;
  /** @deprecated 短期兼容；请改用 TURSO_AUTH_TOKEN */
  readonly TURSO_PROD_AUTH_TOKEN?: string;
  /** @deprecated 已废弃；测/产由部署环境区分 */
  readonly TURSO_TARGET?: "test" | "prod";
}
