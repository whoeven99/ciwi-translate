/**
 * v4 页「语言覆盖率」与左上汇总 —— 口径与管理翻译汇总页各卡片累加一致
 * （COVERAGE_COUNT_LABELS，不含 Policies / handle）。
 * 语言级汇总权威在 Turso ShopTargetLocale.coverage*；Redis 仅作未回填时的回退。
 */
import {
  COVERAGE_COUNT_LABELS,
  refreshItemsCountForLocales,
  sumItemsCountByLabels,
  sumItemsCountByLabelsFromCache,
} from "./itemsCount.server";
import type { AdminGraphqlClient } from "./itemsCount.server";
import { listV4JobSummaryDocs } from "./cosmos.server";
import { sameTranslationLocale } from "./locale";
import { listTargetLocales, type TargetLocaleRow } from "./targetLocale.server";
import { ACTIVE_V4_STATUSES } from "./types";
import {
  readAutoScanLastAt,
  resolveNextAutoUpdateAt,
} from "./autoScanSchedule.server";

export type LocaleCoverageRow = {
  locale: string;
  label: string;
  translated: number;
  total: number;
  percent: number | null;
  /** 缓存未命中时为 true（Turso 未统计且 Redis 也缺） */
  cacheMissing: boolean;
  /** Turso 从未写入覆盖率（coverageUpdatedAt 为空）且 Redis 也空 */
  cacheEmpty: boolean;
  /** 与语言页自动翻译开关同源：ShopTargetLocale.autoTranslate */
  autoTranslate: boolean;
  /** 当前语言是否有活跃中的 v4 任务 */
  isTranslating: boolean;
  /** Worker 最近一次自动扫描时刻（ISO，全店共用） */
  lastAutoUpdateAt: string | null;
  /** 下一轮 Worker 自动扫描时刻（ISO，由前端按本地时区/相对时间展示） */
  nextAutoUpdateAt: string | null;
};

export type CoverageSummary = {
  languageCount: number;
  translatedItems: number;
  totalItems: number;
  overallPercent: number | null;
  locales: LocaleCoverageRow[];
};

function ratioPercent(translated: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.min(100, Math.round((translated / total) * 100));
}

type LocaleInput = { value: string; label: string };

function findTargetRow(
  rows: TargetLocaleRow[],
  locale: string,
): TargetLocaleRow | undefined {
  return rows.find((t) => sameTranslationLocale(t.locale, locale));
}

/** 合并语言页运行态信号：自动翻译开关 + 活跃任务标记。 */
async function enrichCoverageWithRuntimeSignals(
  shop: string,
  summary: CoverageSummary,
  targetRows?: TargetLocaleRow[],
): Promise<CoverageSummary> {
  try {
    const [rows, jobs, lastAutoUpdateAt] = await Promise.all([
      targetRows ? Promise.resolve(targetRows) : listTargetLocales(shop),
      listV4JobSummaryDocs(shop, 100),
      readAutoScanLastAt(),
    ]);
    const activeJobs = jobs.filter((job) => ACTIVE_V4_STATUSES.includes(job.status));
    const locales = await Promise.all(
      summary.locales.map(async (row) => {
        const match = findTargetRow(rows, row.locale);
        const autoTranslate = match?.autoTranslate ?? row.autoTranslate ?? false;
        const isTranslating = activeJobs.some((job) =>
          sameTranslationLocale(job.target, row.locale),
        );
        const nextAutoUpdateAt = await resolveNextAutoUpdateAt(autoTranslate);
        return {
          ...row,
          autoTranslate,
          isTranslating,
          lastAutoUpdateAt: autoTranslate ? lastAutoUpdateAt : null,
          nextAutoUpdateAt,
        };
      }),
    );
    return { ...summary, locales };
  } catch (err) {
    console.error("[translateV4] enrichCoverageWithRuntimeSignals failed:", err);
    return summary;
  }
}

/** 语言页等轻量场景：只补 autoTranslate / isTranslating，跳过 auto-scan 时刻计算。 */
async function enrichCoverageWithMinimalRuntimeSignals(
  shop: string,
  summary: CoverageSummary,
  targetRows?: TargetLocaleRow[],
): Promise<CoverageSummary> {
  try {
    const [rows, jobs] = await Promise.all([
      targetRows ? Promise.resolve(targetRows) : listTargetLocales(shop),
      listV4JobSummaryDocs(shop, 30),
    ]);
    const activeJobs = jobs.filter((job) => ACTIVE_V4_STATUSES.includes(job.status));
    const locales = summary.locales.map((row) => {
      const match = findTargetRow(rows, row.locale);
      return {
        ...row,
        autoTranslate: match?.autoTranslate ?? row.autoTranslate ?? false,
        isTranslating: activeJobs.some((job) =>
          sameTranslationLocale(job.target, row.locale),
        ),
        lastAutoUpdateAt: null,
        nextAutoUpdateAt: null,
      };
    });
    return { ...summary, locales };
  } catch (err) {
    console.error("[translateV4] enrichCoverageWithMinimalRuntimeSignals failed:", err);
    return summary;
  }
}

/**
 * 单语言：优先 Turso coverage*；未统计时回退 Redis items_count。
 */
async function resolveLocaleCoverageCounts(
  shop: string,
  locale: string,
  tursoRow?: TargetLocaleRow,
): Promise<{
  translated: number;
  total: number;
  percent: number | null;
  cacheMissing: boolean;
  cacheEmpty: boolean;
}> {
  if (tursoRow?.coverageUpdatedAt) {
    const translated = tursoRow.coverageTranslated;
    const total = tursoRow.coverageTotal;
    return {
      translated,
      total,
      percent:
        tursoRow.coveragePercent ?? ratioPercent(translated, total),
      cacheMissing: false,
      cacheEmpty: false,
    };
  }

  const redis = await sumItemsCountByLabelsFromCache(
    shop,
    locale,
    COVERAGE_COUNT_LABELS,
  );
  if (!redis.cacheEmpty) {
    return {
      translated: redis.translated,
      total: redis.total,
      percent: ratioPercent(redis.translated, redis.total),
      cacheMissing: redis.cacheMissing,
      cacheEmpty: false,
    };
  }

  return {
    translated: 0,
    total: 0,
    percent: null,
    cacheMissing: true,
    cacheEmpty: true,
  };
}

/** 优先 Turso 语言级汇总；适合 loader / cache=1 快速路径。 */
export async function getCoverageSummaryFromCache({
  shop,
  targetLocales,
  includeRuntimeSignals = true,
}: {
  shop: string;
  targetLocales: LocaleInput[];
  /** true=完整信号；false=跳过；'minimal'=仅 autoTranslate/isTranslating */
  includeRuntimeSignals?: boolean | "minimal";
}): Promise<CoverageSummary> {
  let targetRows: TargetLocaleRow[] = [];
  try {
    targetRows = await listTargetLocales(shop);
  } catch (err) {
    console.error("[translateV4] listTargetLocales for coverage failed:", err);
  }

  const rows = await Promise.all(
    targetLocales.map(async (loc) => {
      const match = findTargetRow(targetRows, loc.value);
      const agg = await resolveLocaleCoverageCounts(shop, loc.value, match);
      return {
        locale: loc.value,
        label: loc.label,
        translated: agg.translated,
        total: agg.total,
        percent: agg.percent,
        cacheMissing: agg.cacheMissing,
        cacheEmpty: agg.cacheEmpty,
        autoTranslate: match?.autoTranslate ?? false,
        isTranslating: false,
        lastAutoUpdateAt: null,
        nextAutoUpdateAt: null,
      } satisfies LocaleCoverageRow;
    }),
  );

  const translatedItems = rows.reduce((sum, row) => sum + row.translated, 0);
  const totalItems = rows.reduce((sum, row) => sum + row.total, 0);

  const summary: CoverageSummary = {
    languageCount: targetLocales.length,
    translatedItems,
    totalItems,
    overallPercent: ratioPercent(translatedItems, totalItems),
    locales: rows,
  };

  if (includeRuntimeSignals === false) {
    return summary;
  }

  if (includeRuntimeSignals === "minimal") {
    return enrichCoverageWithMinimalRuntimeSignals(shop, summary, targetRows);
  }

  return enrichCoverageWithRuntimeSignals(shop, summary, targetRows);
}

/** 现算 Shopify 并回写 Turso（+ Redis 明细）；forceRefresh 后从 Turso 再读。 */
export async function computeCoverageSummary({
  admin,
  shop,
  targetLocales,
  forceRefresh = false,
  localesToRefresh,
}: {
  admin: AdminGraphqlClient;
  shop: string;
  targetLocales: LocaleInput[];
  /** true：与管理翻译「刷新统计」同效 —— 现算并写 Turso/Redis */
  forceRefresh?: boolean;
  /** 指定要刷新的语言；省略时 forceRefresh 仅刷新 cacheEmpty/cacheMissing 的语言 */
  localesToRefresh?: string[];
}): Promise<CoverageSummary> {
  if (forceRefresh && targetLocales.length > 0) {
    let refreshLocales: string[];
    if (localesToRefresh?.length) {
      refreshLocales = localesToRefresh;
    } else {
      const cached = await getCoverageSummaryFromCache({
        shop,
        targetLocales,
        includeRuntimeSignals: false,
      });
      const missing = cached.locales
        .filter((row) => row.cacheEmpty || row.cacheMissing)
        .map((row) => row.locale);
      refreshLocales =
        missing.length > 0 ? missing : targetLocales.map((l) => l.value);
    }
    await refreshItemsCountForLocales({
      admin,
      shop,
      locales: refreshLocales,
      labels: COVERAGE_COUNT_LABELS,
    });
    return getCoverageSummaryFromCache({
      shop,
      targetLocales,
      includeRuntimeSignals: true,
    });
  }

  const locales: LocaleCoverageRow[] = [];
  let translatedItems = 0;
  let totalItems = 0;

  for (const loc of targetLocales) {
    let translated: number;
    let total: number;
    let cacheMissing = false;
    let cacheEmpty = false;

    try {
      const computed = await sumItemsCountByLabels({
        admin,
        shop,
        target: loc.value,
        labels: COVERAGE_COUNT_LABELS,
      });
      translated = computed.translated;
      total = computed.total;
    } catch (err) {
      console.error(
        `[translateV4] coverage locale failed shop=${shop} locale=${loc.value}:`,
        err,
      );
      const cached = await resolveLocaleCoverageCounts(shop, loc.value);
      translated = cached.translated;
      total = cached.total;
      cacheMissing = cached.cacheMissing || cached.total === 0;
      cacheEmpty = cached.cacheEmpty;
    }

    locales.push({
      locale: loc.value,
      label: loc.label,
      translated,
      total,
      percent: ratioPercent(translated, total),
      cacheMissing,
      cacheEmpty,
      autoTranslate: false,
      isTranslating: false,
      lastAutoUpdateAt: null,
      nextAutoUpdateAt: null,
    });
    translatedItems += translated;
    totalItems += total;
  }

  return enrichCoverageWithRuntimeSignals(shop, {
    languageCount: targetLocales.length,
    translatedItems,
    totalItems,
    overallPercent: ratioPercent(translatedItems, totalItems),
    locales,
  });
}
