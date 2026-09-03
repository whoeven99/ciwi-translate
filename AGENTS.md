# [AGENTS.md](http://AGENTS.md)

This file is the navigation index for future AI agents working in this repo.
Read it before changing code, then use the relevant section to jump to the
right route, server helper, worker, extension, script, or Prisma model.





## Required Workflow

1. Read `AGENTS.md` first and identify the feature area.
2. Read and follow `.cursor/skills/deliberate-collab/SKILL.md` (Claude-style
 collab: confirm technical choices, then **P0/P1** plan / UI samples, then
 edit; default execute P0 only).
3. Run `git status --short` before editing. Do not overwrite user changes or
  unrelated untracked files.
4. Read the route entry, server helper, worker or extension caller, and Prisma
  model that own the behavior.
5. Keep changes small and local to the feature boundary.
6. Never copy, print, commit, or summarize real values from `.env*`. Mention
  variable names only.
7. Some existing Chinese comments may display as mojibake in PowerShell. Do not
  rewrite whole files for encoding cleanup unless explicitly asked.
8. For Shopify, billing, quota, worker, and live-store writeback changes, verify
  the smallest meaningful path and report any remaining risk.
9. `AGENTS.md` is the current root repo index. Do not assume a separate
  `Agent.md` exists unless it has been restored in the live checkout.



## Project Overview

- Shopify embedded app built with Remix, Vite, React, Polaris, and Ant Design.
- Main app code lives in `app/`.
- Background translation worker lives in `worker/` as a separate TypeScript
package.
- Prisma schema lives in `prisma/schema.prisma`; generated client output is
`app/generated/prisma`.
- Runtime database is Turso/LibSQL through `app/db.server.ts`, even though the
Prisma datasource says `sqlite`.
- Translation v4 job state spans Cosmos, Redis, Azure Blob, Turso, and Shopify
Admin API.
- Storefront runtime code lives in Shopify extensions under `extensions/`.
- Legacy Spring/Java wrapper file `app/api/JavaServer.ts` has been removed and
runtime quota, billing, picture, currency, switcher, glossary, PageFly, and
manage-translation paths no longer call Spring. Remaining `legacy` / `Spring`
text is compatibility naming, historical schema commentary, or old-data
handling unless a new outbound call is reintroduced.



## Markdown Policy

`AGENTS.md` is the durable AI-facing index. Historical debug notes and phase
plans have been merged here and removed. Prefer updating this file instead of
adding another root-level planning or debug markdown file.

Keep separate markdown only when it is colocated with a subsystem and carries
deep implementation detail that would be too long for this index. If a new
temporary debug note is needed, delete or merge it after the issue is resolved.

## Top-Level Map


| Path                                                         | Purpose                                                                                   |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `app/root.tsx`                                               | Global Remix root, Redux provider, GTM/web-vitals, global client error reporting.         |
| `app/entry.client.tsx` / `app/entry.server.tsx`              | Remix hydrate/SSR. Server inlines i18n boot (`app/lib/i18nBoot.ts`) so client hydrate does not await `/locales/*.json`. |
| `app/shopify.server.ts`                                      | Shopify app config, auth exports, API version, session storage.                           |
| `app/db.server.ts`                                           | Turso/Prisma client；凭据 `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`（见 `tursoTarget.server.ts`）。 |
| `app/routes/app.tsx`                                         | Embedded app shell, auth, nav, bootstrap, install-time init, shop scan trigger.           |
| `app/routes/*`                                               | Remix flat routes for pages and API endpoints.                                            |
| `app/server/*`                                               | Server-side business logic. Prefer adding feature helpers here and keeping routes thin.   |
| `app/lib/*`                                                  | Shared small helpers used by route/UI code.                                               |
| `app/config/*`, `app/hooks/*`, `app/utils/*`, `app/shared/*` | Runtime configuration, shared hooks, error/log helpers, and cross-runtime message tokens. |
| `app/api/googleAnalyticsClient.ts`                           | Google Analytics Measurement Protocol helper; not related to Spring/Java.                 |
| `app/store/*`                                                | Redux store modules, mostly for older pages.                                              |
| `app/components/*`                                           | Shared React components, including manage-translation editors and support chat.           |
| `app/ui/*`                                                   | Shared UI wrappers/theme/message helpers.                                                 |
| `packages/translation-core/*`                                | Shared translation engine used by both the Remix app and Worker.                          |
| `prisma/schema.prisma`                                       | Turso/Prisma model source.                                                                |
| `prisma/migrations/*`                                        | SQL migrations.                                                                           |
| `worker/src/*`                                               | Background workers and services for translation, shop scan, email, Cosmos/Blob/Redis/LLM. |
| `extensions/ciwi-switcher/*`                                 | Storefront language/currency switcher theme extension.                                    |
| `extensions/web-pixel/*`                                     | Shopify web pixel extension.                                                              |
| `scripts/*`                                                  | 运维 / 诊断 / 迁移 / 审计脚本；共用 `scripts/lib/loadEnv.mjs`；`eventReport.ts` 为 App 运行时埋点。 |
| `public/locales/*/translation.json`                          | App i18n strings (15 locales，清单在 `app/lib/appI18nLanguages.ts`)。手写 `en` + `zh-CN`，其余可用 `npm run translate` 机翻补齐。 |
| `.github/workflows/tsf-deploy.yml`                           | Manual Shopify extension/config and Render app/worker deployment workflow.                |
| `Dockerfile`                                                 | Render container build for the Remix app (`node:22-slim`); the worker is built from `worker/`. |




## Commands And Validation

Package scripts:

- `npm run dev`: Shopify app dev on port 8080.
- `npm run build`: Remix/Vite build. Useful for route mapping and bundle checks.
- `npm run setup` or `npx prisma generate`: generate Prisma client.
- `npx prisma validate`: validate Prisma schema.
- `npm run worker:build`: build worker TypeScript.
- `npm run worker:dev` / `npm run worker:start`: run the worker package in watch
mode or from compiled `worker/dist`.
- `npm run lint`: repository ESLint check; existing repository-wide noise may
make a focused build/type check more useful for small changes.
- `npm run core:build`: build shared `packages/translation-core` into `.build`.
- `npm run turso:migrate:test` / `npm run turso:migrate:prod`: run Turso migrations.
- `npm run deployTest` / `npm run deployProd`: Shopify app deploy with matching config.
- `npm run push:pr`: commit (skips secrets) → push → create/reuse PR (`PR_URL:`).
- `npm run merge:deploy:test`: squash-merge current PR to master, then trigger
test web + worker deploy (`MERGED_PR_URL:`, `DEPLOY_RUN_URL:`).

Validation choices:

- Prisma schema or migration: `npx prisma generate` and `npx prisma validate`.
- App route or UI: `npm run build`.
- Worker code: `npm run worker:build`.
- Shared translation logic: `npm run core:build`.
- Worker module catalog: `npm run check:auto-translate-modules --prefix worker`.
- Billing/quota: focused grep or script validation across TSF paths.



## UI Standards

Use these rules when changing UI. They summarize the older UI design, audit, and
execution docs that were consolidated into this file.

- The app should feel like a Shopify Admin tool: restrained, reliable, dense
enough for repeated work, and not like a marketing landing page.
- Polaris is the visual and semantic baseline. Ant Design is allowed for complex
tables, charts, dense filters, modal interiors, and high-density business
controls.
- **Dropdowns in the embedded app:** prefer Polaris `Select` for single-select
and chip / `ChoiceList` / `Combobox` for multi-select. Avoid Ant Design
`Select` on translate-v4 / create-task surfaces unless there is a strong
reason; do not add page-local CSS that overrides `.ant-select-selection-item`
globally inside a card (it breaks Ant single-select layout). ESLint
`no-restricted-imports` blocks `Select` from `antd` under
`app/routes/app.translate-v4/**`（`.eslintrc.cjs` override；`app.translate-v4-history`
目前不在该 glob 内，新增下拉仍请用 Polaris）。Remaining Ant Selects
(allow for now, 已核对):
`app/components/singleTranslateAction.tsx`（AI 模型）、manage-translation 头部
（`app.manage_translation/route.tsx`）、custom liquid `updateCustomTransModal`、
glossary `updateGlossaryModal`、currency `currencyEditModal` — prefer Polaris
when those screens are next touched。`app/components/paymentModal.tsx` 已是
Polaris `Select` 的参考实现。Cursor rule: `.cursor/rules/polaris-dropdowns.mdc`.
- Ant Design theme values should be derived from Polaris-like tokens through
`app/ui/theme.ts`; avoid creating a second visual system.
- Prefer existing shared wrappers in `app/ui/components/*`, including
`AppPageHeader`, `AppSectionCard`, `AppStatusBadge`, and `AppButton`.
- Avoid new hard-coded colors, ad hoc font sizes, one-off radius values, and
large inline style blocks in route files.
- Page patterns:
  - Overview/dashboard pages: summary first, then status/risk/action entry.
  - Settings pages: grouped form sections with clear save feedback.
  - Resource management pages: filter/action area plus dense table/list body.
  - Editor pages: stable two-pane or master/detail layout.
  - Pricing pages: clear plan hierarchy, restrained emphasis, no aggressive
  sales-page styling.
- One page section should have one clear primary action. Secondary actions should
not compete visually with the main action.
- Add i18n keys for visible UI text in `public/locales/en/translation.json` and
`public/locales/zh-CN/translation.json`. The admin UI ships 15 locales
(`APP_I18N_LANGUAGES` in `app/lib/appI18nLanguages.ts`); the other 13 files are
machine-filled from `en` via `npm run translate` (needs `GOOGLE_CLOUD_API_KEY`).
Do not leave merchant-visible English literals in route files — recent i18n
sweeps moved plan names, modal copy, and worker notice text into locale keys.



## Route Entries



### App Shell, Auth, Webhooks

- `app/routes/app.tsx`: app shell loader/action, navigation, app bootstrap.
- `app/routes/auth.$.tsx`, `app/routes/auth.login/route.tsx`: Shopify auth.
- `app/routes/webhooks.tsx`: Shopify webhook topic handling. Billing and uninstall
logic use TSF billing exclusively. `APP_UNINSTALLED` / `SHOP_REDACT` call
`cleanupBillingOnUninstall` (local `cancelSubscription`; SHOP_REDACT only
best-effort Shopify cancel when token present) before Account soft-delete and
Session delete.
`APP_UNINSTALLED` snapshots subscription/quota/size via
`uninstallSnapshot.server.ts` before cleanup, then fire-and-forgets
`uninstallEmail.server.ts`: uninstall Feishu (same billing snapshot text;
title is `emoji 店铺卸载 · 分群：shop`; if winback is skipped, last line is
`挽回邮件：未发（原因）`) plus optional winback SES + Feishu metadata (no email
body; payload `email` / `customer_email`; 互斥：已付费未完成 `212617` → 剩余积分
`212612` → 从未 COMPLETED `212616`; 额度用清理前快照; Redis
`tsf:uninstall-email:{shop}` NX 7d 只挡 SES；duplicate 仍发卸载飞书且标题
仍带分群，末行 `挽回邮件：未发（7 天内已发过）`)。`SHOP_REDACT` does not send winback.
Lifetime-first install (`bound: true` Account create in `app.tsx` loader) and
lifetime-first `BillingLog.SUBSCRIPTION_ACTIVATED` (count === 1) also send to
the same support webhook via `lifecycleFeishuNotify.server.ts`; reinstall /
plan change / resubscribe do not. Worker `billingSubscriptionReconcile`
notifies only when it inserts the shop's first ACTIVATED row (webhook miss).
Billing webhooks ACK first and process in the background
(`APP_PURCHASES_ONE_TIME_UPDATE` / `APP_SUBSCRIPTIONS_UPDATE` are fire-and-forget
with `.catch`; ledger writes are idempotent and failures are recovered by worker
`billingSubscriptionReconcile.ts`). Every `APP_UNINSTALLED` step is best-effort
try/catch and never blocks the `200`.
- `app/routes/currencyInit.tsx`: currency initialization route.
- `app/routes/web-vitals-metrics.tsx`: 兼容保留的 web vitals receiver；已无调用方
（要过 `authenticate.admin`，且 `fetcher.submit` 上报会触发全量 loader revalidate）。
- `app/routes/log.tsx`: structured client log receiver plus legacy form payload
compatibility; client helpers live in `app/utils/clientLog.ts`。对
`event=lcp_diagnostics` 额外输出可 grep 的 `[perf][lcp] {json}` 单行（LCP 归因，
见 Operations Debugging → LCP）。
- `app/routes/publishAction.tsx`: publish/unpublish Shopify locales.
- `app/routes/_index/route.tsx` and `app/routes/app._index/route.tsx`: root entry
and embedded `/app` redirect/landing behavior.
- `app/routes/invite/route.tsx`: standalone invite page.



### Main Pages

- `/app`: `app/routes/app._index/route.tsx` 重定向到 `/app/translate-v4-mvp`（`getTranslatePagePath()` 同指向 MVP）。
- `/app/translate-v4-mvp`: `app/routes/app.translate-v4-mvp/route.tsx`（推荐任务 + 覆盖率摘要 + 任务队列；复用 v4 确认弹窗 / TaskQueue / 预估）。
- `/app/translate-v4-mvp-custom`: `app/routes/app.translate-v4-mvp-custom/route.tsx`（自定义语言/模块建任务）。
- `/app/translate-v4`: `app/routes/app.translate-v4/route.tsx`（全量工作台保留；只展示进行中 /
暂停 / 失败任务，见 `jobFilters.ts` `isCurrentV4Job`）。
- `/app/translate-v4-history`: `app/routes/app.translate-v4-history/route.tsx`
（终态任务历史；无导航入口，由 `TaskQueueSection.tsx` 的「历史」按钮跳入；支持
`?returnTo=` 回跳；复用 `CompactJobCard` + `isHistoryV4Job` + `/api/translate-v4/task-action`）。
- `/app/language`: `app/routes/app.language/route.tsx`.
- `/app/manage_translation`: `app/routes/app.manage_translation/route.tsx`.
- `/app/manage_translation/<module>`: `app/routes/app.manage_translation_.*/route.tsx`.
- `/app/currency`: `app/routes/app.currency/route.tsx`.
- `/app/switcher`: `app/routes/app.switcher/route.tsx`.
- `/app/glossary`: `app/routes/app.glossary/route.tsx`.
- `/app/pricing`: `app/routes/app.pricing/route.tsx`.
- `/app/shop-profile`: `app/routes/app.shop-profile/route.tsx`; nav is hidden in production.
- `/app/onboarding`: `app/routes/app.onboarding/route.tsx`; 首次翻译新手引导（无导航入口，
仍可显式访问 `/app/onboarding`）。
- Treat an `app/routes/app.*` directory without a route file as inactive until a
real `route.tsx` or route module is added.



### API Routes

- `/api/app-bootstrap`: `app/routes/api.app-bootstrap.ts` →
`app/server/appBootstrap.server.ts`（plan / credits / locales 一次性引导数据，
`app/routes/app.tsx` 与 Redux `userConfig` 共用）。
- `/api/billing/active-subscription`: `app/routes/api.billing.active-subscription.ts`.
- `/api/billing/migrate-credits-to-spark`: `app/routes/api.billing.migrate-credits-to-spark.ts`
  （定价页迁剩余积分到 Spark：先加 Spark `purchasedTokens`，再加翻译 `usedCredits`；成败写 `BillingLog` 并异步飞书）。
- `/api/shop-profile`: `app/routes/api.shop-profile.ts`.
- `/api/support`: `app/routes/api.support.tsx`.
- `/api/storefront/*`: `app/routes/api.storefront.$.ts`, the Shopify App Proxy API.
- `/api/picture/*`: `app/routes/api.picture.{product,shop,upload,upsert,delete,save-from-url}.ts`.
- `/api/translate-v4/tasks`: `app/routes/api.translate-v4.tasks.ts`.
- `/api/translate-v4/estimate`: `app/routes/api.translate-v4.estimate.ts`.
- `/api/translate-v4/estimate-detailed`: `app/routes/api.translate-v4.estimate-detailed.ts`
  （确认弹窗「精准预估」：单 locale×module 扫 Shopify + TM miss，客户端分片串行；
  `detailedCreditEstimate.server.ts`）。
- `/api/translate-v4/task-action`: `app/routes/api.translate-v4.task-action.ts`.
- `/api/translate-v4/task-progress`: `app/routes/api.translate-v4.task-progress.ts`.
- `/api/translate-v4/coverage`: `app/routes/api.translate-v4.coverage.ts`.
  Optional `targets=locale,locale` skips Shopify locale fetch (language page
  passes locales it already loaded). Cache reads use one Redis `HGETALL` per
  locale; language page force-refreshes a locale only when that hash is empty
  (`cacheEmpty`, same as v4「刷新统计」`refresh=1&locales=`).
- `/api/onboarding/fast-coverage`: `app/routes/api.onboarding.fast-coverage.ts`
  （Preparing 真进度：逐 label 现算最重要 1 语 × 5 模块，写 Redis 不写 Turso）。
- `/api/translate-v4/quota`: `app/routes/api.translate-v4.quota.ts`.
- `/api/translate-v4/single`: `app/routes/api.translate-v4.single.ts`.
- `/api/translate-v4/single-estimate`: `app/routes/api.translate-v4.single-estimate.ts`
（单字段积分预估，展示用；`singleTranslateEstimate.server.ts`）。
- `/api/translate-v4/image`: `app/routes/api.translate-v4.image.ts`.
- `/api/translate-v4/currency`: `app/routes/api.translate-v4.currency.ts`.
- `/api/translate-v4/glossary`, `liquid`, `pagefly`, `switcher`,
`target-locale`: feature-specific translate-v4 APIs.



## Feature Index



### Translation V4

Core files:

- UI page: `app/routes/app.translate-v4/route.tsx`.
- UI components: `app/routes/app.translate-v4/components/*`.
- UI constants/status/i18n: `constants.ts`, `v4I18n.ts`, `jobStageUtils.ts`,
`v4JobNotice.ts`, `localeDisplay.ts`, `v4Styles.ts`（共享色板/卡片样式，
`paymentModal` 等也在用）, `jobFilters.ts`（current / history 任务切分）,
`hooks/useCountUp.ts`.
- Client create-task helper: `app/lib/createTranslateV4Tasks.ts`.
- Create/list jobs: `app/routes/api.translate-v4.tasks.ts`.
- Create-task credit estimate (display upper bound): 
`app/server/translateV4/creditEstimate.server.ts` (`credits ≈ ceil(chars × k)`,
default `k=1.6` / `TRANSLATE_ESTIMATE_CREDITS_PER_CHAR`),
`app/routes/api.translate-v4.estimate.ts`,
`app/routes/app.translate-v4/useCreateTaskEstimate.ts` (wired in
`CreateTaskCard` / `route.tsx`). Uses shop scan `moduleStats.chars` +
coverage untranslated ratio; `includeLiquid` 时再加上 `sumPendingLiquidChars`
（`liquidRule.server.ts`，PENDING 自定义 Liquid 字符数）。写入 Cosmos 的
`estimatedCredits`（`estimatePersistedJobCredits`）同样按该 job 的 `target`
加 Liquid 字符，供积分不足邮件 `required_credits`；不是 worker 实扣公式。
精准预估（可选、可等待）：`CreateTaskConfirmModal` →
`useDetailedCreateTaskEstimate` → `/api/translate-v4/estimate-detailed`，
按语言×v4 module 分片拉字段、拆叶子、`tmMGetByValue` 去命中后按 miss 字符×k。
- Pause/resume/cancel/delete: `app/routes/api.translate-v4.task-action.ts`.
- Progress summaries: `app/server/translateV4/progress.server.ts`
（`listV4JobSummaryDocs` 带 `includeLiquid`；摘要 `modules` 经 `jobModulesWithLiquid` 拼虚拟 `CUSTOM_LIQUID`，不写回 Cosmos）。
- Init activity UI (module `x/N` bar + i18n activity log): Redis fields
`initModulesTotal` / `initModulesDone` / `initActiveModules` /
`initCompletedModules` / `initPhase` written by `initWorker.ts`; rendered in
`JobExpandedDetail.tsx` via `v4.initLog.*` locale keys.
- Shop profile prompt for live translation: `shopProfilePrompt.server.ts`
(`buildShopProfilePromptBlock`) and `shopProfileContext.server.ts`
(`loadShopProfilePromptBlock`); manual create-task and single-field paths
persist/pass `profileBlock` on the Cosmos job / sync call.
- Cosmos jobs: `app/server/translateV4/cosmos.server.ts`.
- Redis progress/control/hints: `app/server/translateV4/redis.server.ts`.
- Blob helpers: `app/server/translateV4/blob.server.ts`.
- Types/status rules: `app/server/translateV4/types.ts`.
- Resume rules: `app/server/translateV4/resumeStatus.ts`.
- App-side helpers kept aligned with worker: `languageStatus.server.ts`
  (language page status 0..4, consumed by `/api/translate-v4/target-locale`),
  `autoScanSchedule.server.ts` (interval 1h / shop cooldown 3h / `Asia/Shanghai`
  :00 defaults), `quotaMultiplier.server.ts` (DeepSeek default 1 via
  `DEEPSEEK_QUOTA_TOKEN_MULTIPLIER`; GPT/Google default 1.5 via
  `QUOTA_TOKEN_MULTIPLIER`), `stageReconcile.server.ts` (stuck TRANSLATING -> WRITEBACK escalation,
  called from `progress.server.ts`), `userFacingMessages.server.ts` (normalize
  pause/fail reasons to stable codes like `QUOTA_INSUFFICIENT` /
  `JOB_FAILED`; tokens + legacy Chinese dual-read in
  `app/shared/translateV4MessageTokens.ts`; Worker writes the same codes via
  `worker/src/services/userFacingMessages.ts`; UI renders via `v4.notice.*`
  locale keys in `v4I18n` / `v4JobNotice`), and `migration.server.ts` (`ensureShopV4Settings`).
- Module catalog: `app/server/translateV4/moduleCatalog.ts` and
`worker/src/services/moduleCatalog.ts`.
- Single-field translation: `app/routes/api.translate-v4.single.ts` ->
`app/server/translateV4/singleTranslate.server.ts` ->
`packages/translation-core/src/syncTranslate.ts` / `llmTranslate.ts`.
- Shared translation rules and safeguards live in
`packages/translation-core/src/*`. Worker `llmTranslate.ts` is a thin adapter;
App and Worker filter/count callers import translation-core subpaths directly.

Data flow:

1. UI calls `createTranslateV4Tasks()`.
2. `POST /api/translate-v4/tasks` validates locales, modules, and quota guard;
  loads `profileBlock` via `loadShopProfilePromptBlock` for manual jobs.
3. `createV4Job()` writes a Cosmos job (may include `profileBlock`) and pushes a
  Redis init hint into the **manual** or **auto** pool queue
   (`translate:v4:hint:init:{manual|auto}`). Cosmos jobs must never contain a
   Shopify access token.
4. `worker/src/workers/initWorker.ts` claims via `fairStageClaim` (manual first),
  resolves the current offline token from Turso `Session`, reads Shopify
   translatable resources, and writes init blobs.
5. `worker/src/workers/translateWorker.ts` reads blobs, calls LLMs (passing
  `job.profileBlock` when present), writes checkpoints, updates Redis/Cosmos
   progress, and deducts quota.
6. `worker/src/workers/writebackWorker.ts` writes translations back to Shopify.
7. UI polls summaries/progress and renders job state.

Common edits:

- Add/remove translation module: update both module catalogs, then run
`npm run check:auto-translate-modules --prefix worker`; filter validation is a
separate concern.
- Change create-task UX or request body: start in `app/lib/createTranslateV4Tasks.ts`,
then `api.translate-v4.tasks.ts`.
- Billing return after buy-credits / subscribe from create confirm: draft in
  `app/utils/createTaskDraft.ts` (sessionStorage); return flag via
  `app/utils/billingReturn.ts`; restore + reopen confirm in
  `app/routes/app.translate-v4/route.tsx`. 补额度弹窗本身是全局共享的，见
  Billing And Quota →「Credits purchase modal」。
- Change pause/resume/cancel: inspect `api.translate-v4.task-action.ts`,
`resumeStatus.ts`, `translateWorker.ts`, and `writebackWorker.ts`.
- Change progress display: inspect `progress.server.ts`, `jobStageUtils.ts`,
`TaskQueueSection.tsx`, and `JobExpandedDetail.tsx`.
- Change coverage/counts: inspect `coverage.server.ts`, `itemsCount.server.ts`,
`metricsUtils.ts`, worker `itemsCount.ts` / `metricsUtils.ts`, and
`api.translate-v4.coverage.ts`.
- Change copy: update locale JSON and any helper in `v4I18n.ts`.



### Translation Core And Filters

- Source of truth: `packages/translation-core/src/*`.
- Filter entry: `packages/translation-core/src/translationFilter/index.ts`.
- Runtime ports: `packages/translation-core/src/runtime.ts`.
- TM 读走批量：`translationMemory.ts` `tmMGet` / `tmMGetByValue`（`mgetAligned`
 按 index 对齐、500 一批、异常整批当 miss），`llmTranslate.ts` 的 digest / value /
 leaf 三处读点都用批量。**给 `TranslationCoreRedis` 加新方法时必须同时在
 `MigratingRedis` / pipeline / multi 代理里实现**（单一来源
 `packages/translation-core/src/redisDualClient.ts`，App/Worker 经
 `@ciwi/translation-core/redis-dual-client` 引用，不再有两份副本）：正常路径只连
 `RENDER_KV`（原生 ioredis）。若仍走历史双写代理 `MigratingRedis`，缺方法会让
 TM 静默整批 miss（只烧钱不报错）。
- **新增 core 子路径导出要改四处**，漏一处就会掉到 `.d.ts` 上（esbuild 剥掉类型 →
 运行时空模块 → rollup 报 `"x" is not exported by ...d.ts`）：
 `packages/translation-core/package.json` 的 `exports`、根 `tsconfig.json` paths、
 `worker/tsconfig.json` paths、**以及 `vite.config.ts` 的 `translationCoreAliases`**
 （App 侧靠这份 alias 指向 `src/*.ts` 源码，不走 `.build`）。
- App adapter: `app/server/translateV4/translationCoreRuntime.server.ts`.
- Worker adapter: `worker/src/services/translationCoreRuntime.ts`.
- EMAIL / packing-slip Liquid HTML: `packages/translation-core/src/liquidHtmlTranslate.ts`
(`liquid_html` klass). Block tags `{% %}` are masked then carried in skipped
`<script type="application/vnd.ciwi-liquid">` elements so keywords / system
literals like `else` and `Default Title` never enter the LLM text pool;
`{{ }}` stays in-place for `maskPlaceholders`.
- Structural BR leaves (`⟦BR⟧` from `htmlTranslate`, ascii `[BR]`):
  `isPassthroughLeafText` in `translateQuality.ts` skips the LLM/Google pool and
  reassembles identity in `llmTranslate.ts` (not counted as echo/`fallback`).
- Output quality gates (`looksLikeUntranslated`, wrong-script, empty-source
  hallucination, prompt sentinel) live in `translateQuality.ts` and gate
  fallback/retry in `llmTranslate.ts`. Disable all with
  `TRANSLATE_QUALITY_GATE=false` (placeholder/HTML integrity checks unchanged).
- Short plain fields (`<80` chars, not handle / meta_description): chunk-level
  JSON pack in `llmTranslate.ts` — field/value TM first, then dedupe by text,
  then size-capped JSON batches (`TRANSLATE_SHORT_JSON_MAX_CHARS` /
  `TRANSLATE_SHORT_JSON_MAX_ITEMS`, defaults 3000/40) with LLM first and Google
  last. Within LLM: `aiModel=gpt-*` tries Azure GPT first, then DeepSeek for
  unresolved items, then Google. Non-GPT jobs use DeepSeek then Google. Pool
  prefix `@short@` keeps pack limits separate from rich HTML/JSON. Rollback:
  `TRANSLATE_SHORT_PACK_LLM_FIRST=false` restores Google-first for short plain.
  Forced `aiModel=google-translate` still Google-only. Metafield `json`
  FieldPlan remains single-value slot extract/reassemble — it does not pack
  multiple Shopify fields into one JSON document.
  Azure GPT chat body sampling is per-model via `resolveGptChatSampling` /
  `buildGptChatRequestBody` in `azureGptClient.ts` (re-exported from
  `llmTranslate.ts`): `gpt-4.1-*` send `temperature: 0.1` (+ penalty 0);
  `gpt-5.6-*` omit temperature/penalties (Azure only allows default
  temperature=1; sending 0.1 returns HTTP 400).
  Transport / pool split (orchestration stays in `llmTranslate.ts`):
  `llmErrors.ts`, `deepseekClient.ts`, `azureGptClient.ts`,
  `googleTranslate.ts`, `llmKeyPool.ts`, `quotaGate.ts`.
- DeepSeek usage on each LLM call is persisted from the API `usage` object onto
  blob field `cost`: `inputTokens` / `outputTokens` / `totalTokens`, plus
  `promptCacheHitTokens` / `promptCacheMissTokens` (`prompt_cache_hit_tokens` /
  `prompt_cache_miss_tokens`). Merchant job `usedTokens` / credit deduct uses
  `billableLlmTokens` = miss + out when cache hit is present (hit excluded);
  Admin still shows hit for observability. Without cache fields, keep in+out.
- DeepSeek **provider ¥** is estimated in `deepseekPricing.ts` from the official
  **CNY** list (https://api-docs.deepseek.com/zh-cn/quick_start/pricing) ×
  usage — API does not return money. Stored as `costCny` only (固定元价目，无
  USD)。Optional peak 2× via `DEEPSEEK_PEAK_PRICING=true` (Beijing 09–12 /
  14–18) when DeepSeek enables it.

Do not restore App/Worker/Spark copies of these rules. Change the core package,
then run `npm run core:build`, `npm run worker:build`, and `npm run build`.

Translation-core compiles into ignored `packages/translation-core/.build`.
`packages/translation-core/dist` must not exist locally or in Git; if it appears,
remove it and fix the command that recreated it.

Filter decision chain:

1. Reject blank values.
2. Reject Shopify default option placeholders such as `Default Title`, `Default`,
  and `Title` for product option modules.
3. If not in cover mode, reject fields that already have a non-outdated
  translation.
4. Reject non-translatable resource/link/file/url types.
5. Reject `JSON` except supported metafield cases.
6. Reject `handle` URI fields unless the task explicitly enables handle
  translation.
7. Reject generic non-human text such as timestamps, URLs, IDs, hashes, JWTs,
  email/phone values, booleans, pure numbers, and size/config values.
8. Apply theme-specific rules for placeholder headings, demo content, asset
  names, paths, and locale-content blocklists.
9. Apply metafield-specific rules for encoded strings, Base64, CSS/config
  fragments, and known third-party snippets.
10. Reject `METAOBJECT` values containing `grp__`.



### Worker

Entries:

- `worker/src/index.ts`: env loading, Redis ping, shutdown, scheduler start.
- `worker/src/scheduler.ts`: polls init/translate/writeback, email, shop scan,
and auto-translate; also runs scheduled shop-scan enqueue (target slot =
`(currentSlot - 1) % slots`, i.e. 1h after the shop's auto slot), deploy
wake/stale reset, empty auto-job cleanup, hourly v4 job retention cleanup
(`cleanupOldJobs`，默认每小时 :40), shop_scan_jobs retention
(`cleanupOldShopScanJobs`，默认每小时 :50), and subscription reconciliation
schedules.
- `worker/src/env.ts`: required env diagnostics.
- `worker/src/shutdown.ts`: shared shutdown flag; `index.ts` releases jobs
claimed by the current process on SIGTERM/SIGINT before exit.

Pipeline:

- `worker/src/workers/initWorker.ts`: initialize jobs and write init blobs.
- `worker/src/workers/translateWorker.ts`: translation stage, LLM calls,
checkpoints, quota, pause/cancel.
- `worker/src/workers/writebackWorker.ts`: Shopify translation writeback.
**按 module 分批流式**读译文（`iterateTranslatedItemsForModule`，默认 500/批），
不再一次性把全店译文读进内存。`skipResourceId` 在**下载前**用 blob 文件名
（base64url(resourceId)）挡掉 `writtenSet` 里已写回的资源，所以续跑不会重新
下载已完成部分。写回按 resource 独立、module 间无依赖，所以分批安全；每批边界
会让 `runShopifyAdaptive` 的在飞请求排空一次。改这里请保持 `writtenSet` 全局
（resume 语义）与 `writebackTotal` 取自 `job.metrics`（不依赖数组长度）。
- `worker/src/workers/shopScanWorker.ts`: shop scan（install/scheduled 计量；
manual AI 画像；glossary 阶段已停用）。
- `worker/src/workers/emailWorker.ts`: notifications. 候选店走 **Redis 标记快路径**
（`translate:v4:email:pending:{manual|auto}`，Worker 侧 `updateJob` 写入终态时
由 `noteEmailPendingIfTerminal` 打标），只在 `EMAIL_FALLBACK_SCAN_INTERVAL_MS`
（默认 5min）到点时才跑跨分区 DISTINCT 兜底。标记清除发生在「该店确认无待发
任务」时（`jobs.length === 0`），不在发信后清，宁可多留一轮也不漏发。App 侧手动
暂停/取消不经过 Worker 的 `updateJob`，靠兜底扫描捞回——所以**兜底不能关掉**。

Services:

- `worker/src/services/cosmosV4.ts`: Cosmos translation jobs.
- `worker/src/services/blobV4.ts`, `translateBlobIO.ts`: Blob IO and checkpoint format.
- `worker/src/services/redisV4.ts`: progress, **split auto/manual hint queues**, control keys.
- `worker/src/services/fairStageClaim.ts`: claim order = manual hint → auto hint →
legacy mixed queue → Cosmos scan (manual first). Manual never waits behind auto.
- `worker/src/services/shopifyFetch.ts`, `shopifyConcurrency.ts`: Shopify Admin
GraphQL fetch and per-shop adaptive concurrency driven by cost bucket / 429
feedback; init and writeback use this path. Shopify access tokens are loaded
just-in-time from Turso `Session`; do not persist copies in Cosmos, Redis,
Blob, job payloads, or other business tables.
- `worker/src/services/shopAccessToken.ts`: the enforced Worker token boundary;
it only reads an offline token from Turso `Session` and has no fallback/cache.
- `worker/src/services/shopifyBulkShared.ts`: shared Shopify bulk primitives
(submit / poll / cancel / JSONL stream / sliding-window queue ≤5).
- `worker/src/services/shopifyBulkFetch.ts`: **init** via shared bulk queue →
filter → Blob chunks; per-module failure falls back to paginated `shopifyFetch`.
- `worker/src/services/shopScan/bulkScanCounts.ts`: shop scan metrics **always**
use shared bulk JSONL (no allowlist); failure falls back to paginated
`scanCounts.countModuleScan`. Wired in `stageContentSize` / `stageCoverage`.
- `worker/src/services/llmTranslate.ts`: thin Worker entry point into
`@ciwi/translation-core`.
- `worker/src/services/translationCoreRuntime.ts` + `tsfDb.ts`: Worker runtime
ports; glossary rows load via `loadGlossaryRowsFromTsf()` (no separate
`glossary.ts`).
- `worker/src/services/writebackFields.ts`: writeback field shaping helpers.
- `worker/src/services/shopifyAdminApiVersion.ts`: Worker Shopify Admin API
version (keep aligned with `app/lib/shopifyAdminApiVersion.ts`).
- `packages/translation-core/src/*`: LLM routing, translation memory, glossary
injection, HTML/JSON handling, filters, quality rules, placeholders, prompt
constraints, and field limits shared by App and Worker.
- `worker/src/services/itemsCount.ts`, `metricsUtils.ts`: worker-side count and
metric reconciliation helpers kept aligned with `app/server/translateV4/*`.
- `worker/src/services/userFacingMessages.ts`: Worker status messages.
- `worker/src/services/tsfQuota.ts`: quota query/deduct adapter.
- `worker/src/services/stagePool.ts`: stage concurrency (auto/manual slot pools).
- `worker/src/services/finalizeJobAfterWriteback.ts`: post-writeback final status
selection and Redis `items_count` refresh for completed jobs. Benign Shopify
writeback rejections (`too many translation keys`, field length validation on
resource) are reconciled to `writebackDone` at finalize so jobs are not marked
`WRITEBACK_ALL_FAILED` when every failure is a platform constraint (`writebackUserErrors.ts`).
- `worker/src/services/recordJobUsageSnapshot.ts`: task-terminal usage snapshot
into Turso `TranslateV4JobUsage` (time / tokens / units / chars; survives Cosmos
job retention cleanup).
- `worker/src/services/coverageSummary.ts`: language-level coverage module set
(`COVERAGE_SUMMARY_MODULES`, excludes Policies; aligned with App
`COVERAGE_COUNT_LABELS`).
- `worker/src/services/workerEmail.ts`, `shopEmail.ts`, `feishuNotify.ts`:
  email sending; shop contact via Shopify GraphQL (1h cache). No offline
  Session（已卸载）→ `emailWorker` 不发信、标 `emailSent`，并经
  `FEISHU_WEBHOOK_URL_SUPPORT` 飞书通知（缺配置则跳过）；`shopEmail` 静默跳过。
  Manual: success merge `210764` (`total_credits`) vs quota-insufficient
  incomplete `211401` (`total_credits_used` / `required_credits`); auto:
  success `140352` / partial `159297`. Manual create persists
  `estimatedCredits` (chars×1.6, no coverage scale) for required_credits
  two-handed math vs `usedTokens`. 同一次创建点击写共享 `batchId`
  （`createTranslateV4Tasks` → Cosmos）；有 `batchId` 时该批终态即发一封、
  不等其它批次；无 `batchId` 旧任务仍整店待发汇总。
- `worker/src/services/translationReport.ts` and
`worker/src/scripts/exportTranslationReport.ts`: offline quality report builder
for translated blob entries.
- `worker/src/services/autoTranslate.ts`, `autoScanSchedule.ts`: auto translate.
- `worker/src/services/scheduledShopScan.ts`: scheduled metrics shop scan
enqueue（同分槽 / 时区，默认每小时 :30，槽位相对 auto 延后 1h；`trigger: scheduled`）。
- `worker/src/services/cleanupEmptyAutoJobs.ts`, `autoJobCleanup.ts`: automatic
job cleanup helpers; the scheduler invokes `cleanupStaleEmptyAutoJobs()`.
- `worker/src/services/cleanupOldJobs.ts`: hourly retention cleanup（默认每小时
:40）for **auto** v4 jobs (`TsFrontend-Auto`) older than N days (default 7).
Manual jobs are kept. Deletes Cosmos + Blob + Redis slowly with per-job /
per-blob delays; skips jobs with a fresh worker heartbeat. Scheduled from
`scheduler.ts` via `scheduleJobRetentionCleanup()`.
- `worker/src/services/billingSubscriptionReconcile.ts`: near-due and periodic
Shopify subscription reconciliation against Turso.
- `worker/src/services/shopScan/*`: shop profile scan stages；计量
`contentSize` / `coverage` 经 `bulkScanCounts.ts` 全量 bulk JSONL。

Hint queue keys (Redis lists):

- `translate:v4:hint:{init|translate|writeback}:manual`
- `translate:v4:hint:{init|translate|writeback}:auto`
- Legacy (drain-only during deploy): `translate:v4:hint:{init|translate|writeback}`

App push helpers: `app/server/translateV4/redis.server.ts` → `v4HintKey(stage, pool)`.

Important env names only:

- Cosmos: `COSMOS_ENDPOINT`, `COSMOS_KEY`, `COSMOS_TRANSLATION_DATABASE_ID`,
`COSMOS_TRANSLATION_V4_JOBS_CONTAINER`, and app-side `_V4` variants.
Admin 体量标签另用 `COSMOS_SHOP_DATABASE_ID`（默认 `shop`）、
`COSMOS_SHOP_PROFILE_CONTAINER`（默认 `shop_profile`）；分档
`SHOP_SIZE_TIER_MEDIUM_BYTES` / `_LARGE_` / `_HUGE_`（默认 2/10/50 MiB）。
- Redis: **仅** `RENDER_KV`（Render Key Value / Valkey）。不要再配或连接
  `REDIS_URL` / `REDIS_URL_V4`（Azure 已弃用，见 Operations → Redis）。
- Blob: `AZURE_BLOB_CONNECTION_STRING`, `AZURE_BLOB_TRANSLATION_CONTAINER`.
- Turso: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`（测/产由各 Render 服务各自配值；
 短期兼容 `TSF_TURSO_*` / `TURSO_TEST_*` / `TURSO_PROD_*`）。
- LLM: `DEEPSEEK_API_KEY`, `DEEPSEEK_API_KEYS`, `DEEPSEEK_BASE_URL`,
`DEEPSEEK_MODEL` (default `deepseek-chat`; known id whitelist includes
`deepseek-v4-flash` / `deepseek-v4-pro` / `deepseek-reasoner`),
`GOOGLE_TRANSLATE_API_KEY`, `Gpt_ApiKey` / `Gpt_Model` (Azure OpenAI, default
`gpt-4.1-nano`); DeepSeek pool concurrency overrides:
`DEEPSEEK_CONCURRENCY_LIMIT` / `DEEPSEEK_CONCURRENCY_UTIL` /
`DEEPSEEK_INITIAL_CONCURRENCY`.
- Quota: `QUOTA_ENFORCE`, `DEEPSEEK_QUOTA_TOKEN_MULTIPLIER`（DeepSeek 默认 1）,
`QUOTA_TOKEN_MULTIPLIER`（GPT/Google 默认 1.5；Worker 额度读写直连 Turso）,
`TRANSLATE_QUOTA_FLUSH_CHARGE`, `QUOTA_PER_CALL_COST`（默认 15k；`remaining < perCall` →
并发 cap=0）, `QUOTA_MAX_CONCURRENCY`, `TRANSLATE_QUOTA_ESTIMATE_SAFETY`（默认 1.2）。
任务 seed 记下 `budget`；发 LLM 前 `committed += 预估`；返回后预估换成实扣
（`syncShopQuotaBudget` + `callLLMOnce`）。`committed + nextEst > budget` 则**软停**
（`quotaStopped` 正常返回，不抛 `QuotaExhaustedError`、不打 `[route] llm engine error`、
**不 fallback Google**）；`setShopQuotaCap(0)` 后等在飞 LLM 结清，Worker
`flushQuota` 实扣后再 `PAUSED`。Google 质量兜底单独计费：
`credits = ceil(chars × GOOGLE_CREDITS_PER_CHAR)`（默认 1.6，不再乘模型系数），
记入 `engineUsage["google-translate"]` 与任务 `usedTokens`。
`TRANSLATE_QUOTA_RECHECK_MS`（默认 30s）：chunk 循环里读剩余额度是**节流 +
single-flight**（`getRemainingThrottled`），不是每 chunk 打一次 Turso——并发 chunk
默认 64，逐 chunk 查询会把 Turso 打成瓶颈（502 的流量源之一）。超支准入由上面的
budget/committed 把住，这里只负责发现**任务外部**的额度变化；`seed` 与 `flushQuota`
拿到权威 remaining 时会一并推进时间戳。查询失败时沿用 `lastKnownRemaining` 继续
（不再让 Turso 抖动把 chunk 打挂），并推进时间戳避免重试风暴。
- Scheduling: `WORKER_STAGES`, `WORKER_POLL_INTERVAL_MS`,
`TRANSLATE_CHUNK_CONCURRENCY`, `MAX_CONCURRENT_AUTO_TRANSLATE_JOBS`,
`MAX_CONCURRENT_MANUAL_TRANSLATE_JOBS`, `AUTO_TRANSLATE_*`.
- Shared Shopify bulk JSONL（init + shop scan 全量）:
`SHOPIFY_BULK_SUBMIT_WINDOW` / `INIT_BULK_SUBMIT_WINDOW`（默认 5，**JSONL 下载**并发上限）,
`SHOPIFY_BULK_POLL_MS` / `INIT_BULK_POLL_MS`（默认 1000）,
`SHOPIFY_BULK_DOWNLOAD_CONCURRENCY` / `INIT_BULK_DOWNLOAD_CONCURRENCY`（默认 5）,
`SHOPIFY_BULK_TIMEOUT_MS` / `INIT_BULK_TIMEOUT_MS`（默认 6h）.
Code: `worker/src/services/shopifyBulkShared.ts`.
同店 bulk **submit** 串行（Shopify 每店仅 1 个 bulk query）；多 module 排队 submit + 滑动下载。
- Init bulk（全量；submit 限流/槽位忙自动重试；单 module 失败重入队 bulk，不回退分页）:
`SHOPIFY_BULK_SUBMIT_MAX_RETRIES`（默认 24，submit 与 module 级重试共用上限）.
无 offline Session（卸载等）→ `shopifyBulkShared` 立刻 abort 整店队列（不 poll
空转、不 requeue）。Code: `worker/src/services/shopifyBulkFetch.ts`，接入
`initWorker.ts`.
- Shop scan bulk（计量全量，无 allowlist；默认偏慢以削平 CPU）:
`SHOP_SCAN_BULK_FALLBACK`（默认开，失败回退 `countModuleScan` 分页）,
`SHOP_SCAN_DRAIN_MAX`（默认 1；且 tick 互斥，避免 setInterval 叠跑）,
`SHOP_SCAN_BULK_DOWNLOAD_CONCURRENCY`（默认 1，与 init 的 5 独立）,
`SHOP_SCAN_BULK_SUBMIT_WINDOW`（默认 2）,
`SHOP_SCAN_JSONL_YIELD_EVERY_LINES` / `SHOP_SCAN_JSONL_YIELD_MS`
（默认每 200 行 pause 25ms）,
`SHOP_SCAN_INTER_SHOP_DELAY_MS`（默认 5s，店与店之间/tick 结束后）。
Code: `worker/src/services/shopScan/scanPace.ts`、
`bulkScanCounts.ts`、`shopScanWorker.ts` →
`stageContentSize.ts` / `stageCoverage.ts`.
- Init Blob chunk 大小（page/bulk 共用，按文件字节切分，不再按资源数）:
`TRANSLATION_MAX_CHUNK_BYTES`（默认 2MiB；单资源超限则独占一个 chunk）.
Code: `worker/src/services/shopifyFetch.ts` `chunkResources`.
- Auxiliary schedules: `SHOP_SCAN_POLL_INTERVAL_MS`, `EMAIL_WORKER_INTERVAL_MS`,
`EMAIL_FALLBACK_SCAN_INTERVAL_MS`（默认 5min；邮件 worker 跨分区 DISTINCT 兜底
间隔，平时走 Redis 标记快路径），
`AUTO_EMPTY_JOB_CLEANUP_INTERVAL_MS`,
`BILLING_SUBSCRIPTION_RECONCILE_INTERVAL_MS`, and
`BILLING_SUBSCRIPTION_NEAR_DUE_RECONCILE_INTERVAL_MS`.
- Scheduled shop scan（计量复扫，与 auto 同一时区 / slots；目标槽
`(currentSlot - 1) % slots`，即相对同店 auto 延后 1h）：
`SHOP_SCAN_SCHEDULE_ENABLED` (default true),
`SHOP_SCAN_SCHEDULE_MINUTE` (default 30；与 auto 的 :00 错开),
`SHOP_SCAN_SHARD_COOLDOWN_MS` (default 同 `AUTO_TRANSLATE_SHARD_COOLDOWN_MS` / 20h),
`SHOP_SCAN_MAX_ENQUEUE_PER_TICK` (default 0=不限)。
时区 / slots 复用 `AUTO_TRANSLATE_SCHEDULE_TZ` /
`AUTO_TRANSLATE_SLOTS_PER_DAY`；触发分钟用 `SHOP_SCAN_SCHEDULE_MINUTE`。
Code: `worker/src/services/scheduledShopScan.ts`.
- V4 **auto** job retention cleanup (hourly :40, slow delete; manual jobs kept):
`V4_JOB_RETENTION_CLEANUP_ENABLED` (default true),
`V4_JOB_RETENTION_DAYS` (default 7),
`V4_JOB_RETENTION_CLEANUP_TZ` (default `Asia/Shanghai`),
`V4_JOB_RETENTION_CLEANUP_MINUTE` (default 40；每小时该分钟触发),
`V4_JOB_RETENTION_CLEANUP_INTERVAL_MS` (default 1h),
`V4_JOB_RETENTION_CLEANUP_MAX_PER_RUN` (default 150；删不完下小时继续),
`V4_JOB_RETENTION_CLEANUP_DELAY_MS` (default 1000 between jobs),
`V4_JOB_RETENTION_BLOB_DELETE_DELAY_MS` (default 50 between blobs),
`V4_JOB_RETENTION_CLEANUP_QUERY_BATCH`,
`V4_JOB_RETENTION_HEARTBEAT_GRACE_MS`.
Code: `worker/src/services/cleanupOldJobs.ts`.
- Render prod error digest → Feishu:
`RENDER_API_KEY`, `FEISHU_WEBHOOK_URL_RENDER_DIGEST`,
`RENDER_ERROR_DIGEST_INTERVAL_MS` (default 1h),
`RENDER_ERROR_DIGEST_LOOKBACK_MS` (default 1h),
`RENDER_ERROR_DIGEST_TZ` (default `Asia/Shanghai`),
`RENDER_ERROR_DIGEST_SCHEDULE_MINUTE` (default 45，与 autoTranslate `:00` 错峰),
`RENDER_ERROR_DIGEST_ENABLED` (set `false` on test worker),
optional `RENDER_OWNER_ID`.
Code: `worker/src/services/renderErrorDigest.ts`, scheduled in `scheduler.ts`
via clock-aligned `Asia/Shanghai` `:45` (not process-local `:30`).
Prisma/LibSQL 多行栈常被 Render 拆开且只有中间行带 `level=error`；digest
会对残缺的 `Error occurred during query execution` 回拉同资源邻近日志，
把 `SqliteError.message`（如 `capacity temporarily exceeded`）拼进飞书样本。
发版噪音默认过滤：`AbortError`、Render SIGTERM 时的 `npm error *`、旧 hash
`/assets/*` 的 `No route matches URL`（见 `IGNORE_MESSAGE_PATTERNS`）。
- Email: `TENCENT_CLOUD_KEY_ID`, `TENCENT_CLOUD_KEY`, and template/recipient
variables consumed by `workerEmail.ts` and TSF email helpers.



### Billing And Quota

Models:

- `Account`: TSF credit pools: subscription, purchased, trial, used.
- `PlanCatalog`, `AppSubscription`, `BillingLog`, `AccountPeriodUsage`.
- `TranslateV4JobUsage`: per v4 job usage snapshot (Worker writes on terminal status).
- `CreditUsage`: per-deduction credit audit (`single` / `image` / `v4_job`);
  units are billable credits (not cash). `BillingLog` remains income-only.
  定价页仅可将未被用量占用的购买积分 1:1 迁入 Spark：可迁 =
  `purchasedCredits − max(0, usedCredits − subscriptionCredits − trialCredits)`，
  成功后 `purchasedCredits -= amount`（不改 `usedCredits`），Spark
  `purchasedTokens += amount`；流水 `CREDITS_MIGRATED_OUT` /
  `CREDITS_MIGRATION_FAILED`（`app/server/billing/migrateCreditsToSpark.server.ts`）。

Code:

- `app/server/billing/index.server.ts`: billing barrel exports.
- `app/server/billing/binding/resolveBillingBinding.server.ts`: TSF account initialization helper.
- `app/server/billing/quota/quotaRouter.server.ts`: quota query/deduct routing
  (`deductShopCredits` optional audit → `CreditUsage`).
- `app/server/billing/quota/recordCreditUsage.server.ts`: App-side `CreditUsage` writer.
- `app/server/billing/quota/createTaskQuotaGuard.server.ts`: create-task guard.
- `app/server/billing/quota/deductCredits.server.ts`: TSF credit deduction.
- `app/server/billing/webhooks/handleBillingWebhook.server.ts`: TSF webhook handling
(`APP_SUBSCRIPTIONS_UPDATE` CANCELLED/EXPIRED → `cancelSubscription`; idempotent
if uninstall already cleared the row).
- `app/server/billing/subscription/cleanupOnUninstall.server.ts`: uninstall /
redact billing cleanup (local cancel always; Shopify `appSubscriptionCancel`
best-effort only on SHOP_REDACT when token present; APP_UNINSTALLED skips
outbound cancel). Reinstall path in `ensureAccount.server.ts` also clears
leftover `AppSubscription` when restoring a soft-deleted Account.
- `app/server/billing/uninstallSnapshot.server.ts`: shop billing snapshot +
 Feishu text for uninstall / first-install / first-subscribe (plan, interval,
 quota, size tier via `shopScan/shopSizeProfile.server.ts`).
- `app/server/billing/lifecycleFeishuNotify.server.ts`: lifetime-first install
 (`bound: true`) and lifetime-first `SUBSCRIPTION_ACTIVATED` (Turso count === 1)
 to `FEISHU_WEBHOOK_URL_SUPPORT`; same group as uninstall.
- `app/server/billing/email/billingEmail.server.ts`: purchase/subscribe/renewal emails.
- `app/server/billing/email/welcomeEmail.server.ts`: first-install welcome email
(`bound: true` from `resolveBillingBinding` in `app/routes/app.tsx` loader init;
 same `bound` gate also fires the first-install Feishu notify).
- `app/server/billing/email/uninstallEmail.server.ts`: uninstall snapshot Feishu
  (title `emoji 店铺卸载 · 分群`) + winback SES (templates `212617` / `212612`
  / `212616`) + Feishu metadata (shop / recipient / segment / template / SES /
  remaining credits / subject; no email body); skip (no email / no segment /
  Redis NX duplicate) appends `挽回邮件：未发（原因）` on the snapshot message
  (`7 天内已发过` for duplicate; SES 仍跳过，飞书照发且标题仍带分群). Scheduled from
  `APP_UNINSTALLED` in `webhooks.tsx`.
- 迁积分到 Spark：`SPARK_CREDIT_MIGRATION_ENABLED`（默认关；`true`/`1`/`on`/`yes` 才展示定价页按钮并放行 API）+ `SPARK_CREDIT_MIGRATION_URL` + `SPARK_CREDIT_MIGRATION_SECRET`
  （HMAC，与 Spark `CREDIT_MIGRATION_SECRET` 相同）；飞书仍走 `FEISHU_WEBHOOK_URL_SUPPORT`。
- 收件人/后台 token：`app/server/shop/fetchShopContact.server.ts`（Shopify
GraphQL 拉店铺联系邮箱）与 `app/server/shop/offlineSessionToken.server.ts`
（App 侧唯一的 offline token 读取口，Turso `Session`；storefront switcher /
liquid collect 也走它）。卸载后取不到 token 属预期，调用方需静默降级。
- `worker/src/services/billingSubscriptionReconcile.ts`: worker-only Shopify
subscription reconciliation (writes Turso directly; does not call TSF Web).
If it inserts the shop's first `SUBSCRIPTION_ACTIVATED` BillingLog, it sends
the same first-subscribe Feishu notify (`lifecycleFeishuNotify.ts`).
Syncs `AppSubscription.currentPeriodEnd/Start` from Shopify for MONTHLY and
ANNUAL; for ANNUAL also grants monthly credits every 30 days (max 12 per
Shopify year) derived from `currentPeriodEnd` (never from `createdAt`).
- `packages/translation-core/src/annualCreditCycle.ts`: **single source** of the
annual credit-cycle pure math, imported by both sides as
`@ciwi/translation-core/annual-credit-cycle` (App via
`app/server/billing/index.server.ts` barrel, Worker via
`billingSubscriptionReconcile.ts`). The old per-side copies were deleted; do not
recreate them.
- `worker/src/services/accountBalance.ts`: credit pool settle helpers for renewals.
- `app/routes/webhooks.tsx`: Shopify webhook branching.
- `app/routes/app.pricing/route.tsx`: pricing UI/actions. `action` 现在
**返回** `response.confirmationUrl`（不再 `shopifyRedirect` 抛重定向），由客户端
`app/utils/billingConfirmation.client.ts` `redirectToBillingConfirmation()` 在
top frame 打开；无 confirmationUrl 时返回 `errorCode: 10002` + Shopify
`userErrors[0].message`。
- `app/server/billing/quota/quotaRouter.server.ts`: shared app-side quota facade;
`/api/translate-v4/quota`, task creation, single translation, and picture
translation all use this TSF account path.
- `worker/src/services/tsfQuota.ts`: worker quota adapter.
- `worker/src/services/creditUsage.ts`: Worker `CreditUsage` writer; `translateWorker`
  `flushQuota` records each successful credit flush (`source=v4_job`).

Credits purchase modal（全局唯一补额度入口）:

- `app/components/paymentModal.tsx`（+ `paymentModal.shared.ts`
`buildPaymentOptions` / `paymentOptionSelect.tsx`）在 `app/routes/app.tsx` 里
`lazy` 挂载一次，靠 window 事件 `ciwi:open-credits-purchase-modal` 打开。
- 触发方：`app/utils/creditsPurchaseModal.ts` `openCreditsPurchaseModal(context)`，
`context.kind` = `translate_v4_task` | `create_task` | `single_translate`，
带 `estimatedCredits` / `currentRemainingCredits` / `shortfallCredits`；弹窗按
shortfall 预选**最小够用**的积分包。新增调用方请复用该事件，不要在页面里再挂一个
PaymentModal。
- 回跳：`app/utils/billingReturn.ts`（`ciwiBillingReturn` / `ciwiBillingKind` /
`ciwiBillingPrevTotal` 三个 query；只保留 `/app/**` pathname，剔除嵌入式 session
参数）+ `app/lib/shopifyAppHandle.server.ts`
`buildShopifyEmbeddedAppReturnUrl()`（按 `SHOPIFY_API_KEY` 解析 Partners app
handle，不再读 `process.env.HANDLE`；超过 Shopify 255 字符上限时降级为无 query
的最短路径）。改 returnUrl 时必须同时确认这个长度上限。

Quota work must check:

- Create-task guard.
- Worker deduction and pause-on-insufficient behavior.
- Webhook income paths for subscriptions and token packs.

Billing notes:

- Runtime billing, quota reads/deductions, and Shopify billing webhooks use TSF
Turso. TSF account initialization is now keyed by `Account`; the old
`ShopBillingBinding` marker table has no runtime callers.
- TSF quota remaining is derived from `subscriptionCredits + purchasedCredits + trialCredits - usedCredits`.
- Launch Credits（新手礼包）：店铺终身首次 `SUBSCRIPTION_ACTIVATED` 时按档写入
  `trialCredits`（Basic 4M / Pro 8M / Premium 16M），`BillingLog` `TRIAL_GRANTED`
  + `referenceId=launch_credits` 幂等；续费结转、不随月额度替换；App
  `grantLaunchCredits.server.ts` 与 Worker `grantLaunchCredits.ts` 双路径发放。
- Worker 额度读写直连 Turso Account。
- `AppSubscription.currentPeriodEnd` is always the Shopify next-charge time
(MONTHLY ≈ +30d, ANNUAL ≈ +365d). `currentPeriodStart = end - intervalDays`.
Do not use `createdAt` as a billing or credit-cycle anchor.
- Annual plans still bill once per year in Shopify, but TSF grants the monthly
`PlanCatalog.credits` every 30 days within that year (max 12). Mid-year grants
are Worker-driven (`grantKind: annual_credit_cycle` on `BillingLog`) and must
not overwrite `currentPeriodEnd`. After 12 grants, wait for Shopify year renewal.
- Annual credit grants **never catch up history**. Decision uses the current
30-day window vs TSF `creditCycleIndex` watermark only (`maxGranted + 1`).
Migrated shops with no TSF cycle logs (or a large gap vs the current window)
are assumed already granted elsewhere; Worker writes `grantKind: migration_assumed` (`creditsDelta: 0`) as a baseline so the *next* window can
fire normally. See `packages/translation-core/src/annualCreditCycle.ts`.
- Worker runs a near-due reconciliation every 30 minutes (includes all ACTIVE
ANNUAL shops for credit-cycle checks) and a full subscription reconciliation
every 12 hours by default (both configurable) inside the worker process when
Turso credentials are set. TSF Web does not schedule or execute these jobs.
- Subscription renewal emails (template 143058) are sent from webhook, near-due,
and full reconcile on Shopify period `renewed` only — not on
`annual_credit_cycle_*`. Idempotency uses
`BillingLog.metadata.renewalEmailSent` so the three paths do not double-send.



### Currency

- Models: `Currency`, `CurrencyRate`.
- Server: `app/server/currency/currency.server.ts`.
- Admin API: `app/routes/api.translate-v4.currency.ts`.
- Page: `app/routes/app.currency/route.tsx` and components.
- Init route: `app/routes/currencyInit.tsx`.
- Storefront App Proxy: `app/routes/api.storefront.$.ts` paths
`currency/getCurrencyByShopName` and `currency/getCacheData`.
- Extension caller: `extensions/ciwi-switcher/assets/ciwi-api.js`.

Currency changes often touch admin, App Proxy, and extension JS.

### Switcher And Storefront App Proxy

- Admin page: `app/routes/app.switcher/route.tsx`.
- Client helper: `app/routes/app.switcher/switcherClient.ts`.
- UI component: `app/routes/app.switcher/components/switcherSettingCard.tsx`.
- Server: `app/server/storefront/switcherAdmin.server.ts`,
`switcherConfig.server.ts`, `switcherData.server.ts`, `auth.server.ts`,
`response.server.ts`.
- Storefront Liquid / PageFly branches: `app/server/storefront/liquid.server.ts`
(`LiquidMap` shape aligned with legacy `parseLiquidDataByShopNameAndLanguage`),
`pagefly.server.ts` (PageFly translation reads via Prisma).
- App Proxy: `app/routes/api.storefront.$.ts`.
- Extension: `extensions/ciwi-switcher/blocks/ciwi_I18n_Switcher.liquid` and
`extensions/ciwi-switcher/assets/ciwi-*.js`.
- App Proxy 店面路径：Extension `ciwi-api.js` 固定 `STOREFRONT_APP_PROXY_BASE=/apps/ciwi`
 （对齐正式 `shopify.app.prod.toml` `subpath=ciwi`）。测试 App 为 `ciwi-test` 时
 需临时改扩展常量或单独分支后再 `deployTest`。
- Constants: `app/lib/switcherConstants.ts`.
- `ipOpen` is the live geolocation switch and is stored on Turso
`SwitcherConfiguration`. The old `IpRedirection` table/model was dropped
(`prisma/migrations/20260713000000_drop_ip_redirection`). Do not assume the
removed `api.translate-v4.ip-redirections` / `custom_redirects` path or the
Prisma model still exist; design a new owner before reviving region-specific
redirect records.
- 确认保存时**不再**调用 Spring `/userIp/addOrUpdateUserIp`。店面 IP 定位走
`ciwi-main.js` + ipapi。
- **第三方 / 自定义 Liquid 翻译管线（PENDING→Worker→DONE）**：
 1. **采集（默认开，无商户开关）**：storefront `CollectUntranslatedText` → App
 Proxy `POST liquid/collect` → `liquidCollect.server.ts` 只写入
 `LiquidRule(status=PENDING, source=auto, afterTranslation="")`，**不在 Web
 进程跑 LLM**。店面只报「像源语」文本（无覆盖率/80% 占比门控）；入库前叠
 `looksTranslatable` + `translationRuleJudgment("liquid", …)`（与 init 共用通用值
 启发式；`looksLikeHtmlMarkupFragment`（HTML 属性碎片）与
 `looksLikeAutoLiquidJunk`（评价组件/价格/SKU/年款/产品型号等）仅
 `key === "liquid"` 时拦截，不拦手动/自动 Shopify 字段）。店面采集另跳过
 `isPriceRelatedElement` 与评价 App 常见容器 class。其它门控：全局
 `AUTO_LIQUID_COLLECT_ENABLED`（出事可关）、shop 白名单 `AUTO_LIQUID_SHOP_ALLOWLIST`（逗号分隔；**空=全店可写**；
 名单外仍收请求但不落库；Render 单行 `[auto-liquid] deny allowlist …`，
 Redis 日聚合 `tsf:auto_liquid:deny:req|texts|shops:{utcYmd}`（8d TTL）。
  服务端细日志默认开（`AUTO_LIQUID_DEBUG` 默认 true，可设 false）；店面
  `[ciwi-auto-liquid]` / `[ciwi-liquid-translate]` 默认开，关：
  `localStorage.ciwi_debug_auto_liquid=0` /
  `localStorage.ciwi_debug_liquid_translate=0`。
 主语言（Redis 缓存 1h）、去重、每日帽 `AUTO_LIQUID_DAILY_CAP`（默认 0=
 不限；需背压时设正数如 100）、总量帽 `AUTO_LIQUID_TOTAL_CAP`（默认 60000）。
 店面扫描：`ciwi-ui.js` TreeWalker **分片 idle**（单片约 8ms yield），不因
 时间预算整页放弃；扫描根 = `body` + **open shadowRoot** + **同源 iframe**
 （含嵌套同源；跨域 iframe / closed shadow 不可访问则跳过）；触 `max_nodes`
 仍上报已扫候选；候选条数不设客户端上限，POST 按 100/片
 （`AUTO_LIQUID_POST_CHUNK` / 服务端 `MAX_PER_REQUEST`）。采集启动门禁：
 `customLiquidReplacePromise` 结束后再等 `max(第一次 countdown 补扫, 2s)`
 （无 Liquid 规则的店也等 2s，用来抓晚注入第三方文案），再
 `requestIdleCallback`（timeout 9s，无 4s 硬抢）。countdown 定点补扫仍是
 500ms / 1.5s，不跟采集共用同一根 2s 针。语言门：只采「像 `primaryLanguage`（Switcher 配置接口附带，
 Shopify 主 locale，非商户手填）且不像当前目标语」；无 primary 则本轮不采。
 店面 Switcher **全店采集上报**；采集只写 PENDING，**不查额度**；真正扣费在
 后续 v4「自定义 Liquid」翻译阶段。`SwitcherConfiguration.autoLiquidCollect`
 列保留且默认 `true`，保存时强制 `true`，Switcher UI 开关已移除。
 2. **建任务**：勾选「自定义 Liquid」→ `job.includeLiquid=true`（不进 Shopify
 module 枚举）。
 3. **Worker**：init 读 PENDING → 虚拟 module `CUSTOM_LIQUID` init blob（行
 `PENDING→TRANSLATING`+`jobId`）；translate 复用现有管线；writeback 写回
 Turso `DONE`（**不** `registerTranslations`）。代码：
 `worker/src/services/customLiquid.ts`、`initWorker` / `writebackWorker`。
 4. **店面替换**：`parseLiquidTranslations` **只返回 `status=DONE` 且译文非空**；
 map 按原文长度降序（同长度 `createdAt` 新→旧）；`CustomLiquidTextTranslate`
 对 fuzzy 再按长度降序替换（文本/属性/HTML 共用）。首次全页替换按 **8ms idle 分片**
 （`requestIdleCallback`；小页一片内走完不 yield）；countdown 单根增量仍整段同步。
 全页泵结束后再挂 countdown：首次全页替换后**立刻不扫**
 countdown；500ms / 1.5s 再 `querySelectorAll('[class*="countdown-timer"]')`，
 补译并挂容器 Observer。15s `document.body` MutationObserver 发现中间插入的
 countdown → `observeCountdownTimerRoot`（数字刷新继续忽略）。已观察根不再被
 body / 1.5s 补扫二次 apply；容器 mutation 无原文、或去掉数字后文案指纹未变
 （只改秒数）则跳过整管线。countdown 增量不打 `textFuzzyFast`。持续增量仅对该
 selector（含 `characterData`，跟数字格刷新）。
 空结果返回 `ok({})` 供浏览器负缓存。
 5. **治理**：`worker/src/services/cleanupOldAutoLiquid.ts` 挂 `scheduler.ts`
 （默认每小时 :55），按 `updatedAt` 超 `AUTO_LIQUID_RETENTION_DAYS`（默认 90）
 慢删 `source='auto'`（绝不碰 manual）；同 tick 再清 auto+PENDING junk：
 游标扫 PENDING，唯一判定 `isAutoLiquidCollectJunk`（与 claim/查询 junk 同一套
 `looksLikeHtmlMarkupFragment` + `looksLikeAutoLiquidJunk`，**无** SQL LIKE
 预筛）。`looksLikeAutoLiquidJunk` 另拦品牌/平台/支付、评价人名、规格型号/优惠码、
 尺码码、语言切换标签（保留 FAQ/Price/Shop 等短 UI）；默认每 tick 最多删 5000 /
 扫 15 万行（
 `AUTO_LIQUID_JUNK_CLEANUP_MAX_TOTAL_PER_TICK` /
 `AUTO_LIQUID_JUNK_CLEANUP_MAX_SCAN_PER_TICK` /
 `AUTO_LIQUID_JUNK_CLEANUP_BATCH_SIZE` / `AUTO_LIQUID_JUNK_CLEANUP_DELAY_MS`）。
claim PENDING 时也会跳过并
删除这类行，避免拿去翻译。管理页
 `/app/manage_translation/custom_liquid` 按 metafield 风格编辑（顶栏语言筛选，
 不展示 status / source / 替换方式）；新建规则默认模糊替换。PageFly 管理入口
 已去掉，旧 URL 重定向到 custom_liquid；店面 `userPageFly/readTranslatedText`
 仍读 `PageFlyTranslation`，数据暂不迁移。

- **店面读路径 Redis 缓存**（`app/server/storefront/cache.server.ts`）：
 `api.storefront.$.ts` 的 switcher / currency（`getCurrencyByShopName` +
 `getCacheData`）/ liquid / picture 读端点经
 `readThroughStorefrontCache(kind, shop, extra, load)`，TTL 300s，只缓存
 `success: true`；Redis 任何异常都静默降级直查库，`load()` 自身异常照常上抛。
 失效用 per-(kind, shop) 版本号 key `tsf:sf:ver:{kind}:{shop}`，
 `invalidateStorefrontCache` 对版本 key 做 `INCR` + `EXPIRE`（sole
 `RENDER_KV` / 原生 ioredis；生产禁止 KEYS/SCAN 批量删）。
 已接失效的写入方：`switcherData.upsertSwitcherConfig`、currency
 `insertCurrency`/`updateCurrency`/`deleteCurrency`/`updateDefaultCurrency`、
 picture `upsertUserPicture`/`softDeleteUserPicture`（覆盖 upload / saveFromUrl）、
 liquid manual `createLiquidDo`/`updateLiquidDo`/`deleteLiquidDo`/
 `toggleLiquidReplacementMethod`。**新增 storefront 读端点或写入方时必须同步接入**。
 缓存只用于店面路径，admin 页面仍直查库，避免商户看到自己刚改的旧值。
 未接主动失效：Worker 写 liquid `DONE`（跨进程），靠 300s TTL 收敛。

Do not make storefront API unauthenticated. App Proxy requests use HMAC checks.

### Picture Translation (TSF)

- Prisma model: `UserPicture`.
- Server: `app/server/picture/picture.server.ts`, `translateImage.server.ts`,
`aidge.server.ts`, `cos.server.ts`.
- Admin client: `app/api/pictureClient.ts`, using TSF endpoints
`/api/picture/*` and `/api/translate-v4/image`.
- Manual replace upload must use `UploadProductImage` (`fetch` + FormData).
Ant Design `Upload` default XHR does not carry the embedded session token and
gets `302` from `authenticate.admin` on `/api/picture/upload`.
- Routes: `api.picture.*`, `api.translate-v4.image`, storefront picture paths in
`api.storefront.$.ts`.
- Admin pages: `app.manage_translation/route.tsx`,
`app.manage_translation_.productImage/route.tsx`,
`app.manage_translation_.productImageAlt/route.tsx`.
- Extension reads: `extensions/ciwi-switcher/assets/ciwi-api.js` via App Proxy.
- 图片翻译扣费走 TSF Turso `deductShopCredits`。
- COS credentials on Render: `TENCENT_BUCKET_SECRET_ID` /
`TENCENT_BUCKET_SECRET_KEY` (also accepted as `TENCENT_COS_SECRET_*`).



### Manage Translation Legacy Pages

- Main page: `app/routes/app.manage_translation/route.tsx`.
- Resource pages: `app/routes/app.manage_translation_.*/route.tsx`.
- Custom Liquid（metafield 风格）：`app/routes/app.manage_translation_.custom_liquid/route.tsx`；
  顶栏语言筛选，不展示 status / source / 替换方式；新建默认模糊替换。
  `/app/manage_translation/pagefly` 重定向到 custom_liquid（店面 PageFly 接口仍保留）。
- Server helper: `app/server/manageTranslation/manageTranslationRoute.server.ts`.
- Manage save paths use TSF/Shopify helpers such as
`app/server/shopify/translations.server.ts`.
- Editors: `app/components/manageTableInputEditor.tsx`,
`manageTableInput.tsx`, `manageTableRichText.ts`, `manageTranslationFieldRow.tsx`,
`richTextInput/*`.
- 页面共享行为：`app/utils/manageSave.ts`、`manageTranslationState.ts`、
`manageTranslationErrors.ts`（保存提交 / 脏值状态 / 错误归一）。改一个 manage 页
的保存或报错前，先看这三个是否已经有实现。
- Shopify translation helper: `app/server/shopify/translations.server.ts`.

These pages are not the same UX as translation v4 jobs. Preserve existing
interaction unless the user explicitly asks for a redesign or consolidation.

Historical manage-translation migration guidance:

- All manage pages now read Shopify translatable resources directly.
- All pages（包括 shipping）保存已直连 Shopify `registerManageTranslations`。
- The TSF-side direct save helper is `app/server/shopify/translations.server.ts`.
- When modifying save/delete behavior, preserve the existing response shape used
by page actions and surface Shopify `userErrors` as partial failures.
- Manual single-field translate uses shared `SingleTranslateAction` (modal with
AI model `Select` + optional prompt + credit estimate) →
`SingleTextTranslate` → `/api/translate-v4/single` (`aiModel`, default
`deepseek-v4-flash`). Estimate: `POST /api/translate-v4/single-estimate` builds
the real system prompt (glossary + shop profile + custom prompt) via
`estimateSingleTranslateLlmTokens`, then ceil(tokens × model multiplier)
(DeepSeek default 1, GPT/Google default 1.5).
- 单字段额度不足：打开弹窗时先预估 + 读剩余额度，`shortfallCredits > 0` 直接转到
共享补额度弹窗（`app/components/singleTranslateAction.tsx` →
`openCreditsPurchaseModal({ kind: "single_translate", … })`）；翻译失败后的
额度类报错统一走 `app/hooks/useSingleTranslateQuotaGate.tsx` +
`app/lib/singleTranslateQuotaFeedback.ts`（`v4.create.noCreditsPricing` → 补额度
弹窗，`noCreditsTrial` → `CreateTaskQuotaGateModal` trial 模式，其余落
`v4.error.singleQuotaInsufficient`）。20 多个 manage 页共用这一套，不要在单页
自己拼额度文案。

Image translation, PageFly, and some summary/count behavior may still be
separate from the save path.

Summary/count guidance:

- Manage summary counts should use the same translation filter rules as v4,
otherwise v4 can complete all fields it considers translatable while the old
Java count still shows incomplete totals.
- Count logic lives around `app/server/translateV4/itemsCount.server.ts` and the
`itemsCount` action branch in `app/routes/app.manage_translation/route.tsx`.
- Performance-sensitive count work must account for Shopify GraphQL cost and
throttle status.



### Onboarding (First-time Translation Guide)

首次安装用户的前置引导层：把 shop scan / locales / coverage / estimate / trial /
create-task 编排成一条「店铺理解 → 推荐 → 试用/建首个任务」路径。全部数据复用现有
能力，任一数据源失败都降级，不阻塞继续；可跳过，跳过/完成后不再打断。

Core files:

- Route (loader 聚合 + action 状态流转): `app/routes/app.onboarding/route.tsx`。
  loader 用方案 A 一次性返回聚合 `OnboardingSummary`（不在前端并发拼接口）。
  action 只写状态并返回 json（skip / complete / trial），客户端负责跳转，避免嵌入式
  服务端重定向问题。
- UI: `app/routes/app.onboarding/components/*`（`OnboardingFlow` 编排 Preparing→
  Recommendation 两步 + `ActionFooter` CTA；`PreparingStep` / `RecommendationStep`）。
- 展示层类型（无服务端依赖，可被组件 import）: `app/routes/app.onboarding/types.ts`。
- Server 聚合与状态: `app/server/onboarding/onboarding.server.ts`
  （`shouldRedirectToOnboarding` / `markOnboardingEntered` / `markOnboardingSkipped`
  / `markOnboardingCompleted` / `markOnboardingTrialStarted` /
  `saveOnboardingRecommendation` / `buildOnboardingSummary`）。
- 快扫覆盖率: `app/server/onboarding/fastCoverage.server.ts` +
  `app/routes/api.onboarding.fast-coverage.ts`（Preparing 真进度：最重要 1 语 ×
  Products/Collection/Navigation/Pages/Shop 五个模块，逐 label POST；只写 Redis
  module 明细，**不**写 Turso 语言级汇总，避免污染权威覆盖率）。
- 入口重定向: `app/routes/app._index/route.tsx` 当前直接跳
  `/app/translate-v4-mvp`；首次引导不再自动拦截 `/app`，仍可显式访问
  `/app/onboarding`。install shop scan 继续由 `app.tsx` / onboarding loader
  幂等入队。
- Model: `ShopOnboarding`（每店一行，独立于 `Account.isNew`）。

Data reuse（不重复建设）:

- bootstrap（plan/trial/credits/isNew）: `getTsfBootstrapData` + `getShopCreditQuota`。
- locales: `loadShopLocalesForTranslation`（source + 非主语言 targets；推荐语言三层兜底：
  已发布 → 全部已配置 → 无则空）。
- coverage 快路径: Preparing 调 `/api/onboarding/fast-coverage` 现算 1 语 × 5 模块；
  推荐页展示该样本覆盖率，并提示全店仍在后台 install scan。
- coverage 缓存: loader 仍读 `getCoverageSummaryFromCache`（有则展示全量缓存）。
- estimate: `estimateCreateTaskCredits`（增量口径，展示上限；耗时为纯展示粗估）。
- 建首个任务: 客户端 `createTranslateV4Tasks`（同翻译页），成功后 action `complete`。
- 试用/升级: 记录 `startedTrialFromOnboarding` 后跳 `/app/pricing`（试用=带 trialDays 的
  订阅确认流，无独立发放额度）。

CTA 决策（`resolvePrimaryCta`）: 无目标语言→引导去 `/app/language`；额度足够→建任务；
额度不足且 `isNew`（从未订阅，有试用资格）→开试用；否则→升级。

Common edits:

- 改入口判断: `shouldRedirectToOnboarding`（skipped/completed 或已有任意 v4 任务→不打扰）。
- 改推荐模块: `ONBOARDING_RECOMMENDED_MODULE_KEYS`（v2 module key，对齐 moduleCatalog）。
- 改快扫模块: `ONBOARDING_FAST_COVERAGE_LABELS`（itemsCount 卡片 label）。
- 改文案: `onboarding.*` 键，`public/locales/{en,zh-CN}/translation.json`。
- 埋点: `reportClientLog`（`onboarding_viewed` / `_recommendation_viewed` /
  `_trial_clicked` / `_task_created` / `_skipped` / `_upgrade_clicked`）。



### Language, Glossary, Shop Profile, Support

Language:

- Page: `app/routes/app.language/route.tsx`.
- Client: `app/routes/app.language/languageClient.ts`.
- Server: `app/server/translateV4/targetLocale.server.ts`,
`shopLocales.server.ts`, `languageStatus.server.ts`（语言页 status 0..4，
由 `/api/translate-v4/target-locale` 调用）。
- Models: `ShopTranslationSettings`, `ShopTargetLocale`（含语言级覆盖率汇总
  `coverageTranslated` / `coverageTotal` / `coveragePercent` /
  `coverageUpdatedAt` / `coverageSource`；权威在 Turso，与 autoTranslate 同表）。
- Coverage 写入：`app/server/translateV4/coverageStore.server.ts`（App refresh）、
  `worker/src/services/localeCoverageTsf.ts`（finalize / shop_scan）；
  口径 `COVERAGE_COUNT_LABELS` / `COVERAGE_SUMMARY_MODULES`。
- Coverage 读取：`coverage.server.ts` / Spark `tsfLanguageCoverage.ts` 优先
  Turso `ShopTargetLocale.coverage*`；未统计时 TSF 可回退 Redis；
  `cacheEmpty` 触发语言页后台 refresh。
- 线上 Redis→Turso 回填：`scripts/backfill-locale-coverage-from-redis.mjs`
  （默认 dry-run；`--write` 写入；`--shop=` / `--only-missing`）。

Glossary:

- Page: `app/routes/app.glossary/route.tsx`.
- Server/API: `app/server/translateV4/glossary.server.ts`,
`app/routes/api.translate-v4.glossary.ts`.
- Worker injection: `worker/src/services/translationCoreRuntime.ts` loads rows
via `tsfDb.loadGlossaryRowsFromTsf()` for batch/single prompts (no separate
`glossary.ts`).

Shop Profile / Shop Scan:

- Page (non-prod debug): `app/routes/app.shop-profile/route.tsx`.
- API: `app/routes/api.shop-profile.ts`.
- Trigger: `app/server/shopScan/trigger.server.ts`（`enqueueShopScan`）。
- Cosmos: `app/server/shopScan/cosmos.server.ts` /
`worker/src/services/shopScanCosmos.ts`（容器 `shop_scan_jobs`）。
- Worker: `worker/src/workers/shopScanWorker.ts`,
`worker/src/services/shopScan/*`.
- Scheduled enqueue: `worker/src/services/scheduledShopScan.ts`（挂在
`scheduler.ts`，与 init 同 gate）。
- Model: `ShopProfile`（AI 画像当前生效行）；计量 summary 在 Cosmos + Redis
`items_count`。
- **稳定 Blob 产物**（每店一份，覆盖写 / patch 合并）：
`shop-profile/{shop}/latest-scan.json`
（helper：`worker/src/services/shopScan/shopProfileArtifact.ts`）。
Job `blobPrefix` = `shop-profile/{shop}`。段：`contentSize`、轻量
`coverage`（无 perModule）、`profile`；`glossary` 段保留兼容、scan 不再写入。
`install`/`scheduled` 只更新计量段并**保留**已有 AI 段；`manual` 只更新
`profile` 并**保留**计量段（不再写 glossary）。读者（TSF `artifacts.server.ts` / Spark
`tsfShopProfileArtifacts.ts`）优先读该文件，再 fallback 旧
`shop-scan/{shop}/{scanId}/` 散文件。
- **覆盖率双写分工**：语言级汇总权威在 Turso `ShopTargetLocale.coverage*`
  （v4 / 语言页 / Spark 读此）；`coverage` 阶段仍写 Redis `tsf:items_count`
  module 明细（管理翻译卡片）并 upsert Turso 汇总；Blob latest-scan 只留
  locale 汇总快照。
- **shop_scan_jobs 清理**（与 v4 job retention 独立）：每小时 :50
（`cleanupOldShopScanJobs.ts`）；默认保留 7 天终态任务，每店保留最新一条
COMPLETED/PARTIAL；不删 `latest-scan.json`；可 best-effort 清遗留
`shop-scan/{shop}/{scanId}/`。开关：`SHOP_SCAN_JOB_CLEANUP_*`。
- Admin 体量标签（超大/大/中等/小商店）：Cosmos DB `shop` / 容器
`shop_profile`（`type: "size"`）。由 shop scan `contentSize` 写入
（`worker/src/services/shopScan/shopSizeProfile.ts`）；Spark Admin 翻译任务
列表读取。翻译 INIT **不再**更新该文档。`dataBytes` 口径为源语言
`totalChars`；分档默认 2MB / 10MB / 50MB（`SHOP_SIZE_TIER_*_BYTES`）。
- Trigger split:
  - `install`（`app/routes/app.tsx` 首次进 App，生产也开，幂等）：只跑
  `contentSize`（源语言总量）+ `coverage`（全部非主语言覆盖率，含未发布；
  与 v4「刷新统计」/`selectShopTargetLocales` 同口径），无 AI。
  - `scheduled`：同计量两段，复扫覆写 latest summary / Redis。Worker 每小时
  :30 入队（与 auto 同一时区 / 24 槽；分钟默认 30，可用
  `SHOP_SCAN_SCHEDULE_MINUTE` 覆盖），但目标槽为
  `(currentSlot - 1) % slots`（比同店 auto 槽延后 1 小时）。候选店 =
  有 Account + offline token（不要求开自动翻译）；整店冷却约 20h；
  已有进行中 scan 则跳过。
  - `manual`（调试页按钮 / Admin 画像「重新扫描」）：只跑 `profile`（AI）；
  `glossary` 阶段已停用（一律 SKIPPED）。跳过计量阶段，并从上一份 summary
  合并计量字段，保证 `getLatestShopScanJob` 仍完整。
  - `admin`（Spark Admin 语言覆盖率「现算」）：只跑 `coverage` → 写 Turso
  `ShopTargetLocale.coverage*`（`source=shop_scan`），对齐语言页「刷新统计」
  展示口径；不跑 contentSize / profile。
- Nav / shop-profile UI 在生产仍隐藏；安装计量入队不依赖该页。

Shop profile intelligence direction:

- Treat `ShopProfile` as translation context, not only a display card.
- Current scan/profile code extracts shop identity, industry, keywords,
description, brand tone, coverage, glossary suggestions, and content scale.
- Current production boundary:
  - Preview: shop-profile page uses `buildShopProfilePromptBlock()`.
  - Live manual create-task: `api.translate-v4.tasks.ts` →
  `loadShopProfilePromptBlock` → Cosmos job `profileBlock` →
  `translateWorker` passes it into translation-core.
  - Live single-field: `singleTranslate.server.ts` loads and passes
  `profileBlock` into sync translation.
  - Not yet live for auto: `autoTranslate.ts` `createJob()` does not set
  `profileBlock`. Prompt block construction lives in the App
  (`shopProfilePrompt.server.ts`); there is no Worker-side builder.
- Future work: enrich reusable translation context (shop intelligence, content
signals, terminology/market/module policy) and inject into auto-translate.
- Prompt injection points include `buildShopProfilePromptBlock`,
`buildSystemPrompt`, single translation, batch translation, and auto paths.
- Do not dump raw full-store text into prompts. Prefer sampled, cleaned,
weighted signals plus AI summarization.

Support chat:

- UI: `app/components/SupportChatWidget.tsx`.
- API: `app/routes/api.support.tsx`.
- Store: `app/server/support/supportStore.server.ts`.
- Models: `SupportConversation`, `SupportMessage`.
- Notifications: `app/server/feishu/*`, `app/server/email/tencentSes.server.ts`.



## Prisma Model Index

Current models:

- `Session`: Shopify session storage.
- `ShopTranslationSettings`: per-shop translation settings.
- `ShopTargetLocale`: per-shop target locale, auto-translate flag, and
  language-level coverage summary (`coverageTranslated` / `coverageTotal` /
  `coveragePercent` / `coverageUpdatedAt` / `coverageSource`).
- `Glossary`: glossary terms.
- `ShopProfile`: AI-generated shop profile.
- `SwitcherConfiguration`: storefront switcher settings（含 `autoLiquidCollect`
 默认 `true`：店面自动抓取第三方未翻译文本回填 `LiquidRule`；无商户开关）。
- `Currency`, `CurrencyRate`: currency list and rate cache.
- `PageFlyTranslation`: PageFly translations.
- `LiquidRule`: custom Liquid translation rules（`source` = `manual`|`auto`；
 `status` = `PENDING`|`TRANSLATING`|`DONE`；可选 `sourceDigest` / `jobId`；
 `@@unique([shop, languageCode, beforeTranslation])`；采集侧 `createMany` +
 `skipDuplicates` 落 PENDING；Worker 写 DONE）。
- `Account`, `PlanCatalog`, `AppSubscription`, `BillingLog`,
`AccountPeriodUsage`: TSF billing/quota.
- `TranslateV4JobUsage`: per-job translation usage snapshot (time, tokens,
units, source chars); written by Worker at job terminal states.
- `CreditUsage`: credit spend audit rows (`single` / `image` / `v4_job`);
written on deduct (App) or quota flush (Worker).
- `SupportConversation`, `SupportMessage`: support chat.
- `ShopOnboarding`: 首次翻译新手引导状态（status/skipped/completed/试用/建首任务来源、
 推荐语言与模块快照、积分与耗时预估、来源 scan id）；独立于 `Account.isNew`。
- `UserPicture`: product/shop image translation metadata and translated image
URLs used by admin pages and storefront App Proxy reads.

When changing schema:

1. Edit `prisma/schema.prisma`.
2. Add `prisma/migrations/<timestamp>_<name>/migration.sql`.
3. Run `npx prisma generate` and `npx prisma validate`.
4. Check whether generated files changed and whether this repo expects them committed.
5. Check scripts and worker code for the same field/model dependency.



## Legacy Java Boundary — FULLY DECOMMISSIONED

The Spring/Java runtime boundary is decommissioned. Live code uses TSF
infrastructure (Turso, Cosmos, Redis, Azure Blob, direct Shopify GraphQL, COS,
and external AI/email providers).

The legacy Spring wrapper `app/api/JavaServer.ts` has been deleted. Historical
`Spring`, `Java`, and `legacy` wording remains in compatibility comments, enum
values, old blob handling, and response-shape notes; it is not proof of a
live network dependency.

Residual `SERVER_URL` or Spring DB references in env files are historical
artifacts and should be cleaned up. No runtime code depends on them.

## Shopify Extensions

`extensions/ciwi-switcher` runs on the merchant storefront, not inside the admin app.

- Liquid block: `extensions/ciwi-switcher/blocks/ciwi_I18n_Switcher.liquid`.
- API caller: `extensions/ciwi-switcher/assets/ciwi-api.js`.
- UI/render: `assets/ciwi-ui.js`, `ciwi-main.js`, `ciwi-page.js`.
- Storage: `assets/ciwi-storage.js`.
- Styling: `assets/switcher.css`.
- Boot（`ciwi-main.js` `ciwiOnload`）：DCL 后**不** `await` 配置/IP。
  A 立刻：Custom Liquid 替换、有汇率缓存则换价、IP/浏览器语言请求发出（跳转不挡 UI）。
  B 主题首屏后（双 `rAF`）：Switcher 控件；主题预览仍立刻画。
  C idle：图片翻译、采集、配置/货币后台刷新。语言同步靠 `lang` / `pageshow` / `popstate`，不轮询。

Check deploy configs when changing extensions:

- `shopify.app.toml`
- `shopify.app.test.toml`
- `shopify.app.prod.toml`

`extensions/web-pixel` is a standard Shopify web pixel extension. Its source is
`extensions/web-pixel/src/index.ts`; generated output is in `dist/`.

## Trigger Phrases (AI Agent Actions)

When the user says these exact or similar phrases, immediately run the
corresponding script without asking for confirmation:


| User says                                             | Action                                                                                        |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| "提个pr" / "提pr" / "创建PR" / "push and create PR"        | Run `npm run push:pr`（或 `npm run push:pr -- --message "说明"`）                                  |
| "合入PR然后发布测试环境" / "合入pr发布测试" / "merge and deploy test" | Run `npm run merge:deploy:test`                                                               |
| "发布测试环境" / "deploy test" (单独发布，不合入PR)                 | 触发 `tsf-deploy.yml` workflow on master，参数 `render_service_test=true, render_worker_test=true` |
| "审计店面多语言" / "storefront locale audit"                 | Cursor browser 发现语言并切 locale → `node scripts/storefront-locale-audit.mjs` 落盘（见 Scripts） |


For "合入PR然后发布测试环境", the script will:

1. Auto-detect the PR for the current branch
2. Squash-merge it to master
3. Switch local to master and pull
4. Trigger `tsf-deploy.yml` workflow for test environment
5. Output the workflow run URL



## Task Locator


| User asks about                  | First read                                            | Then read                                                                                               |
| -------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Translation v4 UI                | `app/routes/app.translate-v4/route.tsx`               | `components/*`, `v4I18n.ts`, locales                                                                    |
| Create task failure              | `app/lib/createTranslateV4Tasks.ts`                   | `api.translate-v4.tasks.ts`, quota guard, Cosmos/Redis                                                  |
| Single-field translation         | `api.translate-v4.single.ts`                          | `singleTranslate.server.ts`, translation-core `syncTranslate.ts` / `llmTranslate.ts`, quota guard       |
| Stuck task/progress              | `progress.server.ts`                                  | worker scheduler/init/translate/writeback, Redis/Cosmos scripts                                         |
| Pause/resume/cancel bug          | `api.translate-v4.task-action.ts`                     | `resumeStatus.ts`, worker control logic                                                                 |
| Post-writeback completion/counts | `worker/src/services/finalizeJobAfterWriteback.ts`    | `worker/src/services/itemsCount.ts`, `app/server/translateV4/itemsCount.server.ts`, Redis `items_count` |
| Worker Shopify throttling        | `worker/src/services/shopifyConcurrency.ts`           | `worker/src/services/shopifyFetch.ts`, init/writeback callers                                           |
| Translation quality report       | `worker/src/scripts/exportTranslationReport.ts`       | `worker/src/services/translationReport.ts`, Blob translate chunks                                       |
| Quota mismatch                   | `quotaRouter.server.ts`                               | `webhooks.tsx`, TSF billing webhooks, worker `tsfQuota.ts`                                              |
| Subscription/purchase bug        | `app/routes/app.pricing/route.tsx`                    | `webhooks.tsx`, `app/server/billing/*`                                                                  |
| 补额度弹窗 / Shopify 回跳        | `app/utils/creditsPurchaseModal.ts`                   | `app/components/paymentModal.tsx`, `app/routes/app.tsx`, `app/utils/billingReturn.ts`, `app/lib/shopifyAppHandle.server.ts` |
| 迁移积分到 Spark                 | `app/server/billing/migrateCreditsToSpark.server.ts`  | `SPARK_CREDIT_MIGRATION_ENABLED`（默认关）、`api.billing.migrate-credits-to-spark.ts`、定价页 `AcountInfoCard`、Spark `/api/internal/credit-migration` |
| 任务历史页                       | `app/routes/app.translate-v4-history/route.tsx`       | `app/routes/app.translate-v4/jobFilters.ts`, `components/TaskQueueSection.tsx`, `progress.server.ts`     |
| Currency switcher bug            | `app/server/currency/currency.server.ts`              | `api.storefront.$.ts`, extension `ciwi-api.js`                                                          |
| App Proxy 401/404                | `api.storefront.$.ts`                                 | `server/storefront/auth.server.ts`, extension caller                                                    |
| 店面数据不更新 / Turso 502       | `app/server/storefront/cache.server.ts`               | `app/config/libsqlFetch.server.ts`, `api.storefront.$.ts`, 写入方的 `invalidateStorefrontCache` 调用     |
| Manage Translation resource page | `app/routes/app.manage_translation_.<type>/route.tsx` | `manageTranslationRoute.server.ts`, `pictureClient.ts`                                                  |
| `/app/...&icon=data:image` 404   | `app/lib/sanitizeEmbeddedAppPath.ts`                  | `app/routes/app.$.tsx`, `app/root.tsx` ErrorBoundary                                                    |
| Picture translation/storage      | `app/server/picture/picture.server.ts`                | `api.picture.*`, `api.translate-v4.image`, `UserPicture`, App Proxy picture branches                    |
| Glossary                         | `app/routes/app.glossary/route.tsx`                   | `glossary.server.ts`, Worker `tsfDb.loadGlossaryRowsFromTsf` via `translationCoreRuntime.ts`            |
| Shop profile / AI profile        | `app/routes/app.shop-profile/route.tsx`               | `server/shopScan/*`, `shopProfileContext.server.ts` / `shopProfilePrompt.server.ts`, worker shop scan   |
| Support chat / notifications     | `app/components/SupportChatWidget.tsx`                | `api.support.tsx`, `supportStore.server.ts`, Feishu/SES helpers                                         |
| 安装 / 首次订阅 / 卸载飞书       | `app/server/billing/lifecycleFeishuNotify.server.ts`  | `uninstallSnapshot.server.ts`, `app.tsx` loader, `handleBillingWebhook.server.ts`, worker `lifecycleFeishuNotify.ts` |
| 卸载挽回邮件                     | `app/server/billing/email/uninstallEmail.server.ts`   | `webhooks.tsx` `APP_UNINSTALLED`、腾讯云模板 `212617`/`212612`/`212616`、飞书按分群发元数据（不含邮件正文） |
| First-time onboarding            | `app/routes/app.onboarding/route.tsx`                 | `app/server/onboarding/onboarding.server.ts`, `app/routes/app._index/route.tsx`, `ShopOnboarding`      |
| Auto translate                   | `worker/src/services/autoTranslate.ts`                | `autoScanSchedule.ts`, `ShopTargetLocale`, module catalog                                               |
| Scheduled shop scan              | `worker/src/services/scheduledShopScan.ts`            | `autoScanSchedule.ts`, `shopScanCosmos.ts`, `shopScanWorker.ts`                                         |
| Public storefront locale audit   | `scripts/storefront-locale-audit.mjs`                 | Cursor browser locale discovery; local tree under `scripts/tmp/storefront-audit/`                       |
| Translation core/filter rule     | `packages/translation-core/src/*`                     | App and Worker runtime adapters, focused builds                                                         |
| i18n copy                        | `public/locales/en/translation.json`                  | `public/locales/zh-CN/translation.json`, other locales                                                  |
| Shopify auth/API version         | `app/lib/shopifyAdminApiVersion.ts`（硬编码 `2026-07`）    | `app/shopify.server.ts`（`@shopify/shopify-app-remix` 5 / `@shopify/shopify-api` 14，需 Node ≥22）、`worker/src/services/shopifyAdminApiVersion.ts`、`shopify.app*.toml` |
| Deploy config                    | `shopify.app*.toml`                                   | `Dockerfile`, Render/GitHub Actions config                                                              |




## Scripts

诊断脚本默认叠 `.env.test` → `.env.worker.test` → `.env`（`scripts/lib/loadEnv.mjs`）；
查产需 `--env=.env.prod`；写产另需 `--confirm-prod`（见
`.cursor/rules/env-prod-safety.mdc`）。

Package-backed root scripts:

- `scripts/translate.js`: `npm run translate`, i18n helper.
- `scripts/turso-migrate.cjs`: `npm run turso:migrate:test|prod`。
 `test` 读 `.env`+`.env.test`，`prod` 读 `.env`+`.env.prod`；文件内同一对
 `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`（短期兼容 `TSF_TURSO_*` 与该
 target 的旧 `TURSO_{TEST|PROD}_*`）。
- `scripts/cursor-push-pr.mjs`: `npm run push:pr` — commit（跳过敏感文件）→ push → 创建 PR；
成功输出 `PR_URL:`。
- `scripts/merge-deploy-test.mjs`: `npm run merge:deploy:test` — 合入当前分支 PR 并触发
TSF Web Test + Worker Test 部署；成功输出 `MERGED_PR_URL:` 与 `DEPLOY_RUN_URL:`。

Operational root scripts（查任务 / 队列 / 日志 / 运维，保留）：

- `scripts/lib/loadEnv.mjs`: 诊断脚本共用 env 叠载 + Turso / Redis / Cosmos 解析。
- `scripts/lib/autoScanSchedule.mjs`: helper used by auto-scan scheduling
scripts.
- `scripts/inspect-v4-tasks.mjs`: inspect v4 tasks in Cosmos.
- `scripts/reset-onboarding.mjs`: 把「指定 shop」重置为可重新看到首次翻译新手引导的状态
 （删 Turso `ShopOnboarding` + Cosmos 该店 v4 任务 + `TranslateV4JobUsage` +
 `ShopTargetLocale` + `ShopTranslationSettings` + Redis `tsf:items_count:{shop}:*` +
 Cosmos `shop_scan_jobs`（避免 install 因历史 COMPLETED 被 `skipped_existing`）；可选
 `--billing` 连带清 `Account/AppSubscription/BillingLog/AccountPeriodUsage` 让 `isNew=true`）。
 默认 dry-run，`--write` 才落库；必须 `--shop=`； `--env=`（默认 `.env`）；Turso 认 `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`
 （兼容 `TSF_TURSO_*` / `TURSO_TEST_*` / `TURSO_PROD_*`）；Redis **只连**
 `RENDER_KV`，按该店 locale **精确 DEL**（不用 KEYS/SCAN）；不删 Blob
 `latest-scan.json`；只打印脱敏 host。
 示例：`node scripts/reset-onboarding.mjs --shop=xxx.myshopify.com --env=.env.test --write`。
- `scripts/check-task.mjs`: inspect one task and related Redis state.
- `scripts/diag-shop-scan.mjs`: inspect shop scan state.
- `scripts/auto-tasks-72h-trend.mjs`: auto-translate trend report over the
recent 72-hour window.
- `scripts/next-auto-slot-shops.mjs`: preview shops in next auto-translate scan slot.
- `scripts/lcp-trend.mjs`: 首屏 LCP 归因趋势（只读）。从 Render 运行日志抓
 `[perf][lcp]` 单行，聚合 LCP / FCP / TTFB 的 p50/p75/p90，并按冷热缓存、LCP 元素、
 路由、网络档位分组。`--hours=` / `--route=/app` / `--service=srv-xxx` /
 `--env=.env.prod` / `--json`；需要 `RENDER_API_KEY`。
- `scripts/backfill-locale-coverage-from-redis.mjs`: Redis `items_count` →
  Turso `ShopTargetLocale.coverage*`（默认 dry-run；`--write` 写线上；
  支持 `--shop=` / `--only-missing`；MOVED 重连重试；Redis 源用 `RENDER_KV`）。
- `scripts/storefront-locale-audit.mjs`: public storefront multi-locale product
field audit (competitor research). Paginates `/products.json` (or
`/{locale}/products.json`), writes a local tree mirroring v4 blob layout under
`scripts/tmp/storefront-audit/{shopHost}/{runId}/` (`init/PRODUCT/chunk-*.json`,
`scrape/{locale}/PRODUCT/resources/{base64url}.json`, `diff/summary.json`,
`report.md`), and computes obviously-untranslated ratios vs primary.
- `scripts/switcher-perf-measure.mjs`: 店面 Switcher 性能采集 / 对比（Chrome CDP）。
  `--label before|after --runs 5` 落盘 `scripts/tmp/switcher-perf/`；`--compare`
  出 p50/p90。测非主语言页才能看到 Liquid 替换 / 采集；默认关 liquid debug。
- `scripts/eventReport.ts`: imported by app routes/components; this is runtime
client reporting code, not a throwaway script.

Storefront locale audit playbook (trigger: 「审计店面多语言」):

1. Open the public shop URL in the Cursor browser.
2. Discover locales from the language dropdown / `hreflang` /
   `document.documentElement.lang` / `window.Shopify?.locale`; switch each
   locale via the UI or Shopify `/localization` when needed; record evidence in
   `locales.json` if collecting manually.
3. Run the script (HTTP fetch path; pass `--cookie` if the browser session is
   required for Markets):
   `node scripts/storefront-locale-audit.mjs --shop <url> --locales <a,b,c> [--primary <a>]`
   If Node HTTP is rate-limited, fetch `products.json` in the Cursor browser,
   save each locale as `{locale}.json` under a raw dir, then:
   `node scripts/storefront-locale-audit.mjs --shop <url> --primary <a> --from-raw <rawDir>`
   Or rebuild diff only:
   `node scripts/storefront-locale-audit.mjs --out <runDir> --diff-only`
4. Reply with locale count, primary product count, local root path
   (`blobPrefix` equivalent `storefront-audit/{host}/{runId}`), and
   per-locale `untranslatedRatio` from `diff/summary.json`. Prefer quoting
   the auto-generated Chinese `report.md` in the run folder.
5. Artifacts stay under ignored `scripts/tmp/`; do not commit them.

Worker scripts to keep:

- `worker/scripts/check-auto-translate-modules.mjs`: package-backed module
catalog check（`npm run check:auto-translate-modules --prefix worker`）。
- `worker/scripts/cleanup-stale-hints.mjs`: package-backed cleanup
（`npm run cleanup:stale-hints[--apply] --prefix worker`）。
- `worker/scripts/probe-hint-queues.mjs`（`npm run probe:hint-queues --prefix worker`）、
`probe-job-redis.mjs`、`probe-job-progress.mjs`、`probe-job-status-counts.mjs`、
`probe-prod-jobs.mjs`、`probe-auto-batch.mjs`: queue/job probes.
- `worker/scripts/diag-stuck-job.mjs`, `diag-failed-jobs.mjs`: worker diagnostics.
- `worker/scripts/resume-job.mjs` and `resume-orphaned-processing.mjs`:
operational recovery tools（写产需 `--confirm-prod`）。
- `worker/scripts/auto-tasks-24h-trend.mjs`: auto-translate volume report.
- `worker/scripts/v4-auto-translate-modules.json`: module catalog fixture/data.
- `worker/src/scripts/exportTranslationReport.ts`: TypeScript source for the
translation quality report command; compiled output lives in `worker/dist/scripts/`.

Temporary script policy:

- `scripts/tmp/`、`scripts/out/`、`worker/scripts/tmp/`、`worker/scripts/out/` 已
gitignore，勿提交。
- 已删除、勿恢复：一次性 `smoke-*`、历史 `migrate-redis-azure-to-render.mjs`、
以及失效的 `npm run i18n:key`（单 key 机翻已停用；用 `npm run translate`）。
- Prefer one-off scripts outside the repo, or delete them immediately after the
investigation. If a one-off becomes useful twice, promote it into the
operational list above with a clear name and dry-run behavior when it writes.



## Operations Debugging

This section covers how to inspect live data and infrastructure state during
debugging, incident response, or ad-hoc investigation.

### Turso (SQL Database)

Turso is the primary relational store (billing, settings, glossary, etc.).
The Prisma client connects via `libsql://` HTTP.

**Local / dev query:**

```ps1
# Open a Node.js REPL with Prisma client loaded
node --experimental-vm-modules -e "
  const { PrismaClient } = require('./app/generated/prisma');
  const prisma = new PrismaClient();
  // Example: list recent accounts
  prisma.account.findMany({ take: 5, orderBy: { updatedAt: 'desc' } })
    .then(r => console.log(JSON.stringify(r, null, 2)))
    .finally(() => prisma.\$disconnect());
"
```

**Key tables for debugging:**


| Table                   | Common Query                                                        |
| ----------------------- | ------------------------------------------------------------------- |
| `Account`               | `findMany({ where: { shopName } })` — quota/credit state            |
| `AppSubscription`       | `findMany({ where: { shopName }, orderBy: { createdAt: 'desc' } })` |
| `ShopTargetLocale`      | `findMany({ where: { shop } })` — auto-translate + coverage summary |
| `SwitcherConfiguration` | `findUnique({ where: { shopName } })` — storefront switcher         |
| `Glossary`              | `findMany({ where: { shopName } })` — glossary entries              |


**Prod access:** Turso prod credentials are in `.env.prod` as
`TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`（与 App/Worker 同名；测/产靠不同
env 文件或 Render 服务区分）。短期仍兼容旧名 `TSF_TURSO_*` /
`TURSO_TEST_*` / `TURSO_PROD_*`。You can also read them
from Render env vars (see Render section below).

### Cosmos DB (Translation V4 Jobs)

Cosmos holds translation job documents. Each job is keyed by `(id, shopName)`.

**Quick inspection scripts (local env):**

```ps1
# List jobs by id prefix or shop name
node scripts/inspect-v4-tasks.mjs <prefix1> <prefix2> ...

# Inspect one task (Cosmos + Redis combined)
node scripts/check-task.mjs <jobId> [shopName]

# Diagnose stuck/failed jobs
node worker/scripts/diag-stuck-job.mjs <idPrefix>
node worker/scripts/diag-failed-jobs.mjs
```

**Prod Cosmos access via Render API:**

`worker/scripts/probe-job-redis.mjs` reads Cosmos credentials from Render
service env vars, so you don't need `.env.prod` locally:

```ps1
$env:RENDER_API_KEY = "rnd_..."  # Render API key
node worker/scripts/probe-job-redis.mjs <jobIdPrefix>
```

**Key Cosmos fields for debugging:**

- `status`: `INIT_QUEUED` → `INITIALIZING` → `TRANSLATING` → `WRITEBACK` →
`COMPLETED` / `FAILED` / `CANCELED`
- `errorStage` / `errorMessage`: which stage failed and why
- `metrics.translateDone` / `metrics.translateTotal`: translation progress
- `metrics.writebackDone` / `metrics.writebackTotal`: writeback progress
- `claimedBy`: worker instance that holds the job
- `lastHeartbeat`: last worker heartbeat (stale if > 2 min)
- `aiModel` / `aiModelUsed`: requested vs actual AI model



### Redis (Job Progress, Hint Queues, Controls)

Redis holds real-time progress counters, hint queues, control flags, and
translation memory cache.

**唯一连接：`RENDER_KV`（Render Key Value / Valkey 8，Redis 兼容）。**

- App、Worker、运维脚本、Agent 诊断：**只连** `RENDER_KV`。
- **不要**再使用 `REDIS_URL` / `REDIS_URL_V4`（Azure Cache 已弃用；本地 `.env*` 里若仍残留可忽略或删除）。
- 不要打印 URL/密码；只打印脱敏 host。
- App / Worker：`RENDER_KV` 已配置则**只连它**；不再需要 `REDIS_DUAL_WRITE` /
  `REDIS_CUTOVER`。未配 `RENDER_KV` 时才回退 `REDIS_URL*`（本地脚本应急）。
- 集合语义用 Hash（见 `translate:v4:email:pending:*`），不要依赖已废弃双写代理的 Set 命令。
- Render 服务内用 **Internal** URL（通常 `redis://…`）；本机 / Agent `.env*` 用 **External**
  `rediss://…`（需 Dashboard 放行 Inbound IP）。
- 交互 CLI：Dashboard **Valkey CLI Command**，或服务同区 Shell 里
  `redis-cli -u "$RENDER_KV"`。

历史说明：曾用 `REDIS_DUAL_WRITE` / `REDIS_CUTOVER` + Azure `REDIS_URL*` 做双写切流；
迁移已完成，这两个开关可从环境变量删除（残留时仅打 deprecate 警告）。

**Ping Render KV from local `.env` / `.env.test` (masks host only; never echo secrets):**

```ps1
# From repo root; reads RENDER_KV from the named file
node -e "
const fs=require('fs'); const Redis=require('ioredis');
const file=process.argv[1]||'.env.test';
const m=fs.readFileSync(file,'utf8').match(/^RENDER_KV=(.+)$/m);
if(!m) throw new Error('RENDER_KV missing in '+file);
const url=m[1].trim().replace(/^[\"']|[\"']$/g,'');
const r=new Redis(url,{maxRetriesPerRequest:1,connectTimeout:8000});
r.ping().then(async (pong)=>{
  const n=await r.dbsize();
  console.log(JSON.stringify({file, ok:pong==='PONG', pong, dbsize:n}));
  r.quit();
}).catch((e)=>{ console.error(file, e.message); process.exit(1); });
" .env.test
```

**Hint queue inspection（读 `.env*` 的 `RENDER_KV`）:**

```ps1
node worker/scripts/probe-hint-queues.mjs
```

**Key Redis keys:**


| Pattern | Type / Purpose |
| --- | --- |
| `translate:v4:hint:{stage}:{manual\|auto}` | List: stage hint queues (`stage` = init / translate / writeback; claim prefers manual) |
| `translate:v4:hint:{stage}` | List: legacy mixed queues (drain-only during deploy) |
| `translate:v4:hint:verify`, `translate:v4:hint:analysis` | List: retired stages (compat / probe only; no live producers) |
| `translate:v4:progress:<jobId>` | Hash: per-stage done/total, init module activity, pausePending (TTL 7d) |
| `translate:v4:control:<jobId>` | String: `pause` / `cancel` (TTL 1d) |
| `translate:v4:email:pending:{manual\|auto}` | Hash: shopName → 标记时刻；emailWorker 候选店快路径（TTL 7d，跨分区 DISTINCT 兜底仍保留）。用 Hash 而非 Set：双写 `RedisLike` 没有 `sadd`/`smembers`/`srem` |
| `translate:v4:auto_scan:last_at` | String: last / next auto-scan schedule marker |
| `translate:v4:auto_scan:last_success_at` | String: last successful auto-scan completion |
| `tsf:shop_scan:hints` | List: shop-scan wake hints `{scanId,shopName}` (Cosmos poll is fallback) |
| `tsf:items_count:{shop}:{locale}` | Hash: module → `{total,translated,updatedAt}` (TTL 7d; language summary in Turso) |
| `tsf:uninstall-email:{shop}` | String: uninstall **SES** send lock (`SET NX`, TTL 7d；duplicate 仍发卸载飞书) |
| `tm:v5:{shop}:{target}:{model}:{digest}` | String: field-digest translation memory (TTL default 30d) |
| `tm:v5:val:{source}:{target}:{model}:{id}` | String: value-level TM; id = digest or CRC-32 (TTL default 30d) |
| `translate:v4:keystat:{label}` | Hash: LLM API-key snapshot (TTL 24h) |
| `translate:v4:keystatlog:{label}` | List: LLM key throughput history (~30 min, TTL 2h) |

Code owners: `app/server/translateV4/redis.server.ts`, `worker/src/services/redisV4.ts`,
`packages/translation-core/src/translationMemory.ts` (TM), `llmKeyPool.ts` /
`llmTranslate.ts` (keystat flush).

**Query Render Key Value** (official: [Render Key Value docs](https://render.com/docs/key-value)):

| How | When | Notes |
| --- | --- | --- |
| Dashboard **Valkey CLI Command** / External Access paste command | Local interactive | Needs **Inbound IP** allowlist; external URL is `rediss://` (TLS). |
| `redis-cli` / `valkey-cli` on laptop | Local interactive | Same as Dashboard command (includes `--tls`). |
| Render service **Shell** (same region, non-Docker) | From Web/Worker Shell | Use **Internal** URL (`redis://…`). |
| Node `ioredis` via `RENDER_KV` in `.env*` | Agent / scripts | **唯一** in-repo 连接方式；never print the URL/password. |

Dashboard / CLI (do not commit the pasted command; it contains secrets):

```bash
# After enabling external access, Dashboard → Key Value → External Access
# shows a copy-pasteable redis-cli line (includes --tls).
PING
DBSIZE
GET translate:v4:auto_scan:last_at
HGETALL translate:v4:progress:<jobId>
PTTL tm:v5:val:...
# Prefer SCAN over KEYS on prod. KEYS is OK only on small test instances.
```

Same-region service Shell (Internal URL, usually no TLS):

```bash
# On Ciwi Translate Test / Worker Test Shell (same region as KV):
redis-cli -u "$RENDER_KV"
# then: PING / DBSIZE / GET …
```

Node（本地 / Agent；读 `.env.test` 的 `RENDER_KV`，不 echo 密钥）:

```ps1
$line = (Get-Content .env.test | Where-Object { $_ -match '^RENDER_KV=' })
$url = ($line -replace '^RENDER_KV=','').Trim().Trim('"').Trim("'")
node -e "
const Redis=require('ioredis');
const r=new Redis(process.argv[1],{maxRetriesPerRequest:1,connectTimeout:8000});
const key=process.argv[2]||'translate:v4:auto_scan:last_at';
(async()=>{
  const [pong, dbsize, t] = await Promise.all([r.ping(), r.dbsize(), r.type(key)]);
  const out=t==='hash'?await r.hgetall(key):t==='list'?await r.lrange(key,0,20):await r.get(key);
  const pttl=await r.pttl(key);
  console.log(JSON.stringify({pong, dbsize, key, t, pttl, out},null,2));
  r.quit();
})().catch(e=>{console.error(e.message);process.exit(1)});
" $url translate:v4:auto_scan:last_at
```



### Render (Service Logs & Deploy Status)

The app and worker run on Render. Use the Render API or the built-in MCP tools
to inspect service state.

**MCP tools (available in Copilot):**

- `mcp_render_list_services` — list all Render services
- `mcp_render_list_deploys` — recent deploys for a service
- `mcp_render_get_deploy_logs` — detailed build/deploy log for a specific deploy
- `mcp_render_get_latest_failed_log` — auto-locate the most recent failed build

**Known service IDs:**


| Service             | ID                         |
| ------------------- | -------------------------- |
| TSF Web (Remix app) | `srv-csp2931u0jms738sfmc0` |
| TSF Worker          | `srv-d8sqas4vikkc73f5nbog` |


**Render API direct access (PowerShell):**

```ps1
$env:RENDER_API_KEY = "rnd_..."

# List deploys
Invoke-RestMethod -Uri "https://api.render.com/v1/services/srv-csp2931u0jms738sfmc0/deploys?limit=5" `
  -Headers @{ Authorization = "Bearer $env:RENDER_API_KEY" }

# Get deploy logs (use deploy ID from list above)
Invoke-RestMethod -Uri "https://api.render.com/v1/services/srv-csp2931u0jms738sfmc0/deploys/<deployId>" `
  -Headers @{ Authorization = "Bearer $env:RENDER_API_KEY" }

# Read service env vars (for debugging config issues)
Invoke-RestMethod -Uri "https://api.render.com/v1/services/srv-csp2931u0jms738sfmc0/env-vars?limit=100" `
  -Headers @{ Authorization = "Bearer $env:RENDER_API_KEY" }
```

**⚠️ 运行时日志查询（正确端点）：**

Render 的运行时日志不在 `/services/{id}/logs`（该端点 404），正确端点：

```
GET https://api.render.com/v1/logs?ownerId=<ownerId>&resource=<svcId>&level=error&type=app&startTime=<ISO>&endTime=<ISO>&direction=backward&limit=50
```

- `ownerId`: `tea-csovfmhu0jms738qrra0`（whoeven's Workspace，可用 `RENDER_OWNER_ID` 覆盖）
- `resource`: 可传多个，逗号分隔
- `level`: `error`（只看错误）或 `all`
- `type`: `app`
- `direction`: `backward`（最近的在前）
- `startTime` / `endTime`: ISO 8601 UTC

**PowerShell 一键拉日志：**

```ps1
$k = "rnd_..."; $owner = "tea-csovfmhu0jms738qrra0"
$end = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
$start = [DateTime]::UtcNow.AddHours(-2).ToString("yyyy-MM-ddTHH:mm:ssZ")
$url = "https://api.render.com/v1/logs?ownerId=$owner&resource=srv-d8sqas4vikkc73f5nbog&resource=srv-csp2931u0jms738sfmc0&level=error&type=app&startTime=$start&endTime=$end&direction=backward&limit=50"
$logs = Invoke-RestMethod -Uri $url -Headers @{Authorization="Bearer $k"}
$logs.logs | ForEach-Object { Write-Output "$($_.timestamp) $($_.message)" }
```

**Node.js 拉日志（与** `renderErrorDigest.ts` **一致）：**

```js
const url = `https://api.render.com/v1/logs?ownerId=${ownerId}&resource=${svcId}&startTime=${start}&endTime=${end}&level=error&type=app&direction=backward&limit=100`;
const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
const { logs } = await res.json();
```

**Diagnostic flow:**

1. Check Render deploy status — is the service even running the latest code?
2. Check recent deploy logs — did the build succeed? Any env var missing?
3. Check env vars on Render — compare with `.env.prod` for drift.
4. If the service is healthy but data looks wrong, move to Turso/Cosmos/Redis.



### LCP / 首屏性能归因

嵌入式首页（`/app`、`/app/translate-v4`）的 LCP 有完整归因链，**不要再靠猜**：

1. 采集：`app/utils/lcpDiagnostics.ts`（`app/root.tsx` 里 `observeLcpDiagnostics()`
 挂一次）。用 `PerformanceObserver('largest-contentful-paint')` + navigation /
 paint / resource timing，在**首次交互 / 页面隐藏 / 12s 兜底**三者最早发生时
 `sendBeacon` 发 `/log`（`event=lcp_diagnostics`，`context.reportReason` 标明时机）。
 一个文档只发一次。Shopify App Bridge 的 `webVitals.onReport` 也走同一通道
 （`event=shopify_web_vitals`）。
2. 落盘：`app/routes/log.tsx` 输出 `[perf][lcp] {json}` 单行 + 原有 `[client-log]` 全量行。
3. 聚合：`node scripts/lcp-trend.mjs --hours=72 --route=/app`。
 分位数 + 冷热缓存 / LCP 元素 / 路由 / 网络档位分组。

字段判读：

- `coldLoad`：由 `scriptCachedCount < scriptCount/2` 推出。**首次安装冷加载和回访
 热加载的 LCP 能差 3 倍**，混在一起看分位数会得出错误结论。
- `element`：LCP 元素的短选择器（标签 + class + nth-child）。首屏卡片带
  `.v4-enter` / `.v4-enter-d1` / `.v4-lift`，据此能定位到具体卡片。
  **有意不采文本内容** —— manage_translation 等页面的 LCP 元素可能是商户商品文案。
- `/app` 与 `/app/translate-v4`：鉴权 + Shopify 语言列表只在父级 `app.tsx` loader
  跑一次；子页经 `useRouteLoaderData("routes/app")` 读 `shopLocales`，避免同文档
  双鉴权把 TTFB 抬到 ~2s。标题区 `PageHeaderBar` 固定尺寸并预留积分 pill 宽度。
- `ttfbMs` vs `fcpMs` vs `lcpMs`：TTFB 高 → 服务端 loader（鉴权 / Shopify GraphQL）；
  FCP 与 TTFB 差距大 → 阻塞 CSS/JS；LCP 明显晚于 FCP → 骨架屏换真实内容太晚
  （对照 `context.resources.apiTimings` 里首屏接口的 `responseEnd`）。
- `effectiveType` / `rttMs`：排除「其实是商户网络慢」。

`app/utils/perf.ts` 的 `markPerfStart` / `logReactProfilerRender` 是另一条**按需**
链路，只在 `?perf=1` 或 `localStorage.CIWI_PERF_DEBUG=1` 时上报，用于本地细查渲染。

### Combined Diagnostic Cheat Sheet


| Symptom                              | Start Here                                                     |
| ------------------------------------ | -------------------------------------------------------------- |
| Translation job stuck in INIT_QUEUED | `probe-hint-queues.mjs` → check init hint queues               |
| Translation job stuck in TRANSLATING | `diag-stuck-job.mjs` → check Redis progress + Cosmos heartbeat |
| Translation job stuck in WRITEBACK   | Check Cosmos `errorStage`, Render worker logs                  |
| Quota/billing mismatch               | Turso: `Account` + `AppSubscription` tables                    |
| Currency/switcher not working        | Turso: `SwitcherConfiguration`, `Currency` tables              |
| App 500 / worker crash               | Render deploy logs → check for missing env vars                |
| Auto-translate not running           | `probe-hint-queues.mjs` auto queues + `auto_scan:last_at`      |
| 首屏 LCP 慢                          | `scripts/lcp-trend.mjs` → `[perf][lcp]` 归因（见上一节）        |




## Debug Lessons

These replace old one-off debug markdown files.

- `translate-v4` SSR 500: old or malformed Cosmos job documents can lack
`metrics`. Guard with `EMPTY_V4_METRICS`, make summary builders skip bad
single jobs instead of crashing the page, and inspect
`app/server/translateV4/progress.server.ts`, `pauseReconcile.server.ts`, and
`listV4JobSummaries()`.
- `manage_translation` 502: first-screen item-count traffic can stress Shopify
GraphQL cost buckets or upstream services. Check batching gaps, delayed
non-core count batches, `itemsCount.server.ts` throttle handling, and whether
logging uses beacon-style client logging instead of route `fetcher.submit`.
- Turso `SERVER_ERROR: Server returned HTTP status 502`: 这是 Turso 网关在容量
 紧张时拒绝请求，**不是慢查询**（曾在 `switcherConfiguration.findUnique()` 这种
 主键单行查询上出现）。Prisma 把它包成 `transient: false` 直接抛出，店面 App
 Proxy 因此冒 500，错误呈突发聚集而非均匀分布。两处缓解已落地：
 `app/config/libsqlFetch.server.ts` 对 429/502/503/504 最多重试 2 次（请求体
 先缓冲才可重放；**仅**当 body 像只读 SQL——含 SELECT/WITH 且无
 INSERT/UPDATE/DELETE/事务边界等——才重试，避免写重放），以及 storefront 读
 路径的 Redis 缓存（见 Switcher And Storefront App Proxy）。再遇同类问题先看
 请求量与缓存命中，不要先去优化 SQL。
- `pricing` AbortError: Remix fetcher replacement or route changes can produce
expected aborts. Global client error reporting should ignore AbortError-like
noise, and exposure logging should prefer `reportClientLog(..., { beacon: true })` over competing fetcher submits.
- `/app/manage_translation&icon=data:image/png;base64,...` 404: Shopify Admin /
  App Bridge can append the 32×32 nav icon with `&` and no `?`, so Remix treats
  it as pathname. Recover via `sanitizeEmbeddedAppPath` (`app.$.tsx` redirect +
  root ErrorBoundary `location.replace`). Do not add a dedicated route for the
  junk URL. `entry.server` is too late (routing already ran).



## Risk Notes

- `.env`, `.env.test`, and `.env.prod` may contain live credentials. Never echo
values in responses or docs.
- `node_modules/`, `build/`, and extension `dist/` are not places for manual edits.
- Empty directories under `app/routes/` are not active Remix route modules; confirm
a route file exists before documenting or changing a page entry.
- Runtime billing/quota is TSF Turso, but compatibility binding rows can still
contain `legacy`; inspect actual callers before deleting the enum/model.
- Translation v4 state is distributed. State machine changes must consider
resume, retry, delete, stale reset, Redis controls, Blob checkpoints, and
Shopify writeback.
- Manual vs auto must stay on split hint queues (`:manual` / `:auto`); do not
reintroduce a shared FIFO that lets auto starve manual.
- `WORKER_STAGES` can disable init/translate/writeback. Check it when debugging
missing writeback.
- Manual and auto translation use **separate Redis hint queues and Cosmos scan
filters**. Claim always prefers manual. If manual tasks sit in INIT_QUEUED while
auto is busy, check whether code still pushes to legacy unsplit keys.
- Storefront extension calls TSF through App Proxy. API request shape changes
often require extension JS changes.
- App Proxy supports explicit currency GET plus POST branches for Liquid,
switcher configuration, PageFly, currency cache, and picture reads. Preserve
HMAC verification and update `ciwi-api.js` together with route shape changes.
- Translation-filter ownership crosses into sibling `Spark`; the root check
validates provenance for the app copy only and can fail when that generated
copy drifts. Treat the failure as an ownership/sync issue, not a worker build
failure.
- Shop-profile `profileBlock` is live for manual create-task and single-field
translation, but auto-translate still does not set it. Empty Turso
`ShopProfile` rows still yield an empty block.
- `app/routes/app.tsx` affects every embedded page.
- Legacy manage-translation pages and v4 job pages are separate experiences.



## Short Locator Flow

1. Read and follow `.cursor/skills/deliberate-collab/SKILL.md` (P0/P1 plan;
 default execute P0 only).
2. `git status --short`
3. Read the matching section in this file.
4. `rg -n "<keyword>" app worker extensions scripts prisma`
5. Read route entry, server helper, worker/extension caller, and data model.
6. Apply the smallest P0 patch.
7. Run the validation command that matches the change.
8. Final response should include changed files, validation result, residual
 risk, and unfinished P1 items when applicable.

