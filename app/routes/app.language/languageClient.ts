/**
 * 语言页状态口径：覆盖率结果 + 活跃任务中的翻译态。
 * 覆盖率优先读 Turso ShopTargetLocale.coverage*；cacheEmpty 时后台 refresh 现算并回写。
 * 传入 targets 时 coverage API 跳过 Shopify locales 拉取。
 */
export async function listLanguageCoverageCompat(args?: {
  /** 页面已有的目标语言；有则 API 不再打 Shopify */
  targets?: string[];
  /** true：现算 Shopify 并回写 Turso（+ Redis 明细） */
  forceRefresh?: boolean;
  /** forceRefresh 时仅重算这些语言；省略则按 API 默认策略 */
  refreshLocales?: string[];
}) {
  const params = new URLSearchParams({ signals: "minimal" });
  if (args?.targets?.length) {
    params.set("targets", args.targets.join(","));
  }
  if (args?.forceRefresh) {
    params.set("refresh", "1");
    if (args.refreshLocales?.length) {
      params.set("locales", args.refreshLocales.join(","));
    }
  } else {
    params.set("cache", "1");
  }
  const res = await fetch(`/api/translate-v4/coverage?${params.toString()}`);
  return res.json();
}

/** 语言页「按语言自动翻译开关」——统一写 TSF Prisma。 */
export async function setAutoTranslateCompat(args: {
  target: string;
  autoTranslate: boolean;
}) {
  const res = await fetch("/api/translate-v4/target-locale", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      intent: "setAuto",
      locale: args.target,
      autoTranslate: args.autoTranslate,
    }),
  });
  return res.json();
}

/** 读取整店自动更新设置（小时 + 模块）。 */
export async function getAutoTranslateSettingsCompat() {
  const res = await fetch("/api/translate-v4/target-locale");
  return res.json();
}

/** 保存整店自动更新小时 + 模块（不含 liquid）。 */
export async function setAutoTranslateSettingsCompat(args: {
  hour: number;
  modules: string[];
}) {
  const res = await fetch("/api/translate-v4/target-locale", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      intent: "setAutoSettings",
      hour: args.hour,
      modules: args.modules,
    }),
  });
  return res.json();
}
