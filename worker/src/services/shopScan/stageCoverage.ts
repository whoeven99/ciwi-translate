import {
  sumCoverageSummaryModules,
  type ModuleCount,
} from "../coverageSummary.js";
import { upsertLocaleCoverage } from "../localeCoverageTsf.js";
import { AUTO_TRANSLATE_V4_MODULES } from "../moduleCatalog.js";
import { setItemsCount } from "../redisV4.js";
import { runBulkScanCounts } from "./bulkScanCounts.js";
import { upsertTargetLocales } from "./tsfWrite.js";
import { upsertShopProfileLatestScan } from "./shopProfileArtifact.js";
import type { ShopLocaleRow } from "./shopContext.js";

/**
 * 阶段3：把非主语言同步到 ShopTargetLocale，并逐语言统计翻译覆盖率。
 * 语言集合与 v4「刷新统计」一致：店铺内所有非主语言（含未发布）。
 * 逐模块回填 Redis items_count 缓存；按 COVERAGE_SUMMARY_MODULES 写 Turso 语言级汇总；
 * Blob 只在 latest-scan.json 留轻量 locale 汇总（无 perModule）。
 *
 * 覆盖率统计的模块 = 管理翻译汇总页全部卡片对应的 module，因此回填的缓存可被
 * 管理翻译页 getItemsCountByLabel 直接命中（预热），各卡片「已翻译/总数」秒出。
 * 相比自动翻译模块（AUTO_TRANSLATE_V4_MODULES）额外补齐三个覆盖率聚合 module：
 *   - PAYMENT_GATEWAY（并入 Shop 卡片，与 app 侧 coverage 聚合保持一致）
 *   - EMAIL_TEMPLATE（管理翻译「电子邮件通知」卡片）
 *   - ONLINE_STORE_THEME_LOCALE_CONTENT（主题语言内容，Theme 卡片累加项之一）
 *
 * 拉数：Shopify bulk JSONL（全量，失败回退分页）。
 */
const COVERAGE_MODULES: readonly string[] = [
  ...AUTO_TRANSLATE_V4_MODULES,
  "PAYMENT_GATEWAY",
  "EMAIL_TEMPLATE",
  "ONLINE_STORE_THEME_LOCALE_CONTENT",
];

export type CoverageRow = {
  locale: string;
  published: boolean;
  translated: number;
  total: number;
  percent: number | null;
};

export type CoverageStageResult = {
  status: "done" | "skipped";
  reason?: string;
  coverage: CoverageRow[];
  syncedLocales: number;
};

/** 与 App `selectShopTargetLocales` 同口径：所有非主语言（含未发布）。 */
function selectCoverageTargetLocales(
  locales: ShopLocaleRow[],
  primaryLocale: string,
): ShopLocaleRow[] {
  const source = primaryLocale.trim().toLowerCase();
  return locales.filter(
    (l) =>
      !l.primary &&
      Boolean(l.locale.trim()) &&
      l.locale.trim().toLowerCase() !== source,
  );
}

export async function runCoverageStage(args: {
  shop: string;
  accessToken: string;
  primaryLocale: string;
  locales: ShopLocaleRow[];
  scanId?: string;
  trigger?: string;
  /** @deprecated 稳定产物写 shop-profile/{shop}/latest-scan.json。 */
  blobPrefix?: string;
  heartbeat: () => Promise<void>;
  isShutdown?: () => boolean;
}): Promise<CoverageStageResult> {
  const {
    shop,
    accessToken,
    primaryLocale,
    locales,
    scanId,
    trigger,
    heartbeat,
    isShutdown,
  } = args;

  const targetLocales = selectCoverageTargetLocales(locales, primaryLocale);

  if (targetLocales.length === 0) {
    return {
      status: "skipped",
      reason: "no_target_locales",
      coverage: [],
      syncedLocales: 0,
    };
  }

  // 1. 同步目标语言到 ShopTargetLocale（只增不删，默认 autoTranslate=0）
  const syncedLocales = await upsertTargetLocales(
    shop,
    targetLocales.map((l) => l.locale),
  );
  await heartbeat();

  // 2. 全量 (module × locale) bulk 计数；边完成边回填 Redis
  const localeAgg = new Map<
    string,
    { published: boolean; translated: number; total: number }
  >();
  const moduleByLocale = new Map<string, Map<string, ModuleCount>>();
  for (const target of targetLocales) {
    localeAgg.set(target.locale, {
      published: target.published,
      translated: 0,
      total: 0,
    });
    moduleByLocale.set(target.locale, new Map());
  }

  const jobs = targetLocales.flatMap((target) =>
    COVERAGE_MODULES.map((module) => ({
      id: `${module}::${target.locale}`,
      module,
      locale: target.locale,
    })),
  );

  await runBulkScanCounts({
    shop,
    accessToken,
    jobs,
    onHeartbeat: heartbeat,
    isShutdown,
    onResult: async ({ job, count, usedFallback }) => {
      const agg = localeAgg.get(job.locale);
      if (agg) {
        agg.total += count.total;
        agg.translated += count.translated;
      }
      const modMap = moduleByLocale.get(job.locale);
      modMap?.set(job.module, {
        total: count.total,
        translated: count.translated,
      });
      await setItemsCount(shop, job.locale, job.module, {
        total: count.total,
        translated: count.translated,
      });
      if (usedFallback) {
        console.log(
          `[shopScan:coverage] fallback=page module=${job.module} locale=${job.locale}`,
        );
      }
      await heartbeat();
    },
  });

  const coverage: CoverageRow[] = targetLocales.map((target) => {
    const agg = localeAgg.get(target.locale) ?? {
      published: target.published,
      translated: 0,
      total: 0,
    };
    const percent =
      agg.total > 0
        ? Math.round((agg.translated / agg.total) * 1000) / 10
        : null;
    return {
      locale: target.locale,
      published: agg.published,
      translated: agg.translated,
      total: agg.total,
      percent,
    };
  });

  // 3. Turso 语言级汇总（COVERAGE_SUMMARY_MODULES 口径，与语言页一致）
  for (const target of targetLocales) {
    try {
      const summary = sumCoverageSummaryModules(
        moduleByLocale.get(target.locale) ?? new Map(),
      );
      await upsertLocaleCoverage({
        shop,
        locale: target.locale,
        translated: summary.translated,
        total: summary.total,
        source: "shop_scan",
      });
    } catch (err) {
      console.error(
        `[shopScan:coverage] turso upsert failed shop=${shop} locale=${target.locale}:`,
        err,
      );
    }
  }

  await upsertShopProfileLatestScan(shop, {
    scanId,
    trigger,
    coverage: coverage.map((row) => ({
      locale: row.locale,
      published: row.published,
      translated: row.translated,
      total: row.total,
      percent: row.percent,
    })),
  });

  return { status: "done", coverage, syncedLocales };
}
