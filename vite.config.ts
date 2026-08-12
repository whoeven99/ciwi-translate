import { vitePlugin as remix } from "@remix-run/dev";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type UserConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const appRoot = path.dirname(fileURLToPath(import.meta.url));

// Related: https://github.com/remix-run/remix/issues/2835#issuecomment-1144102176
// Replace the HOST env var with SHOPIFY_APP_URL so that it doesn't break the remix server. The CLI will eventually
// stop passing in HOST, so we can remove this workaround after the next major release.
if (
  process.env.HOST &&
  (!process.env.SHOPIFY_APP_URL ||
    process.env.SHOPIFY_APP_URL === process.env.HOST)
) {
  process.env.SHOPIFY_APP_URL = process.env.HOST;
  delete process.env.HOST;
}

const host = new URL(process.env.SHOPIFY_APP_URL || "http://localhost")
  .hostname;

const translationCoreAliases = [
  {
    find: "@ciwi/translation-core/llm-translate",
    replacement: path.resolve(
      appRoot,
      "packages/translation-core/src/llmTranslate.ts",
    ),
  },
  {
    find: "@ciwi/translation-core/translation-memory",
    replacement: path.resolve(
      appRoot,
      "packages/translation-core/src/translationMemory.ts",
    ),
  },
  {
    find: "@ciwi/translation-core/runtime",
    replacement: path.resolve(appRoot, "packages/translation-core/src/runtime.ts"),
  },
  {
    find: "@ciwi/translation-core/html-translate",
    replacement: path.resolve(
      appRoot,
      "packages/translation-core/src/htmlTranslate.ts",
    ),
  },
  {
    find: "@ciwi/translation-core/json-extract-rules",
    replacement: path.resolve(
      appRoot,
      "packages/translation-core/src/jsonExtractRules.ts",
    ),
  },
  {
    find: "@ciwi/translation-core/placeholder-mask",
    replacement: path.resolve(
      appRoot,
      "packages/translation-core/src/placeholderMask.ts",
    ),
  },
  {
    find: "@ciwi/translation-core/target-language-prompt",
    replacement: path.resolve(
      appRoot,
      "packages/translation-core/src/targetLanguagePrompt.ts",
    ),
  },
  {
    find: "@ciwi/translation-core/translate-quality",
    replacement: path.resolve(
      appRoot,
      "packages/translation-core/src/translateQuality.ts",
    ),
  },
  {
    find: "@ciwi/translation-core/translation-filter/v3Base",
    replacement: path.resolve(
      appRoot,
      "packages/translation-core/src/translationFilter/v3Base.ts",
    ),
  },
  {
    find: "@ciwi/translation-core/translation-filter",
    replacement: path.resolve(
      appRoot,
      "packages/translation-core/src/translationFilter/index.ts",
    ),
  },
  {
    find: /^@ciwi\/translation-core$/,
    replacement: path.resolve(appRoot, "packages/translation-core/src/index.ts"),
  },
];

let hmrConfig;
if (host === "localhost") {
  hmrConfig = {
    protocol: "ws",
    host: "localhost",
    port: 64999,
    clientPort: 64999,
  };
} else {
  hmrConfig = {
    protocol: "wss",
    host: host,
    port: parseInt(process.env.FRONTEND_PORT!) || 8002,
    clientPort: 443,
  };
}

export default defineConfig({
  server: {
    port: Number(process.env.PORT || 3000),
    hmr: hmrConfig,
    fs: {
      // See https://vitejs.dev/config/server-options.html#server-fs-allow for more information
      allow: ["app", "node_modules", "packages", "scripts", "worker"],
    },
  },
  resolve: {
    alias: translationCoreAliases,
  },
  plugins: [
    remix({
      ignoredRouteFiles: ["**/.*"],
    }),
    tsconfigPaths(),
  ],
  build: {
    assetsInlineLimit: 0,
    rollupOptions: {
      external: [
        "@prisma/adapter-libsql",
        "cos-nodejs-sdk-v5",
        "tencentcloud-sdk-nodejs-ses",
      ],
    },
  },
  optimizeDeps: {
    include: ["antd"],
  },
}) satisfies UserConfig;
