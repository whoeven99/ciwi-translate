/**
 * 首次翻译新手引导（onboarding）服务端逻辑。
 *
 * 职责：
 * - 读写 Turso `ShopOnboarding` 状态（not_started/preparing/recommended/skipped/completed）。
 * - 决策 `/app` 是否重定向到 `/app/onboarding`。
 * - 聚合 bootstrap / locales / coverage / recommendation / estimate，供
 *   `/app/onboarding` loader 一次性返回（方案 A：聚合 loader）。
 *
 * 全部数据来源复用现有能力，任何单项失败都降级为 null，不阻塞引导继续。
 */
import prisma from "~/db.server";
import type { ShopOnboarding } from "~/generated/prisma";
import { getTsfBootstrapData } from "~/server/billing/bootstrap/getTsfBootstrapData.server";
import { getShopCreditQuota } from "~/server/billing/quota/quotaRouter.server";
import {
  loadShopLocalesForTranslation,
  type ShopLocaleRow,
} from "~/server/translateV4/shopLocales.server";
import { getCoverageSummaryFromCache } from "~/server/translateV4/coverage.server";
import { estimateCreateTaskCredits } from "~/server/translateV4/creditEstimate.server";
import type {
  OnboardingLocaleOption,
  OnboardingStatus,
  OnboardingSummary,
  SerializedOnboardingState,
} from "~/routes/app.onboarding/types";
import {
  ONBOARDING_FAST_COVERAGE_LABELS,
  pickOnboardingFastCoverageLocale,
} from "~/server/onboarding/fastCoverage.server";

export type {
  OnboardingLocaleOption,
  OnboardingStatus,
  OnboardingSummary,
  SerializedOnboardingState,
} from "~/routes/app.onboarding/types";

/** 引导推荐的首轮高价值模块（v2 module key，对齐 moduleCatalog）。 */
export const ONBOARDING_RECOMMENDED_MODULE_KEYS = [
  "products",
  "collection",
  "navigation",
  "pages",
] as const;

/** 一屏最多主推的语言数量（超出仍纳入预估，仅影响展示）。 */
const MAX_SUGGESTED_TARGETS_DISPLAY = 6;

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

function serializeState(row: ShopOnboarding | null): SerializedOnboardingState | null {
  if (!row) return null;
  return {
    shop: row.shop,
    status: row.status as OnboardingStatus,
    firstEnteredAt: row.firstEnteredAt?.toISOString() ?? null,
    skippedAt: row.skippedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    startedTrialFromOnboarding: row.startedTrialFromOnboarding,
    createdFirstTaskFromOnboarding: row.createdFirstTaskFromOnboarding,
    recommendedTargets: parseJsonArray(row.recommendedTargets),
    recommendedModules: parseJsonArray(row.recommendedModules),
    estimateCredits: row.estimateCredits,
    estimateMinutes: row.estimateMinutes,
    sourceScanId: row.sourceScanId,
  };
}

export async function getOnboardingState(
  shop: string,
): Promise<SerializedOnboardingState | null> {
  try {
    const row = await prisma.shopOnboarding.findUnique({ where: { shop } });
    return serializeState(row);
  } catch (err) {
    console.error("[onboarding] getOnboardingState failed:", err);
    return null;
  }
}

/** 首次进入引导：把 not_started 升级为 preparing 并记录进入时间（幂等）。 */
export async function markOnboardingEntered(
  shop: string,
): Promise<SerializedOnboardingState | null> {
  try {
    const existing = await prisma.shopOnboarding.findUnique({ where: { shop } });
    if (!existing) {
      const created = await prisma.shopOnboarding.create({
        data: { shop, status: "preparing", firstEnteredAt: new Date() },
      });
      return serializeState(created);
    }
    if (existing.status === "not_started") {
      const updated = await prisma.shopOnboarding.update({
        where: { shop },
        data: { status: "preparing", firstEnteredAt: new Date() },
      });
      return serializeState(updated);
    }
    return serializeState(existing);
  } catch (err) {
    console.error("[onboarding] markOnboardingEntered failed:", err);
    return null;
  }
}

export async function markOnboardingSkipped(shop: string): Promise<void> {
  try {
    await prisma.shopOnboarding.upsert({
      where: { shop },
      update: { status: "skipped", skippedAt: new Date() },
      create: { shop, status: "skipped", skippedAt: new Date() },
    });
  } catch (err) {
    console.error("[onboarding] markOnboardingSkipped failed:", err);
  }
}

export async function markOnboardingCompleted(
  shop: string,
  opts: { createdFirstTask?: boolean } = {},
): Promise<void> {
  try {
    const data = {
      status: "completed" as const,
      completedAt: new Date(),
      ...(opts.createdFirstTask ? { createdFirstTaskFromOnboarding: true } : {}),
    };
    await prisma.shopOnboarding.upsert({
      where: { shop },
      update: data,
      create: { shop, ...data },
    });
  } catch (err) {
    console.error("[onboarding] markOnboardingCompleted failed:", err);
  }
}

export async function markOnboardingTrialStarted(shop: string): Promise<void> {
  try {
    await prisma.shopOnboarding.upsert({
      where: { shop },
      update: { startedTrialFromOnboarding: true },
      create: { shop, status: "recommended", startedTrialFromOnboarding: true },
    });
  } catch (err) {
    console.error("[onboarding] markOnboardingTrialStarted failed:", err);
  }
}

/** 保存本次推荐快照，便于埋点/转化追踪与后续复用。 */
export async function saveOnboardingRecommendation(
  shop: string,
  data: {
    recommendedTargets: string[];
    recommendedModules: string[];
    estimateCredits: number | null;
    estimateMinutes: number | null;
    sourceScanId: string | null;
  },
): Promise<void> {
  try {
    const payload = {
      status: "recommended" as const,
      recommendedTargets: JSON.stringify(data.recommendedTargets),
      recommendedModules: JSON.stringify(data.recommendedModules),
      estimateCredits: data.estimateCredits ?? null,
      estimateMinutes: data.estimateMinutes ?? null,
      sourceScanId: data.sourceScanId ?? null,
    };
    await prisma.shopOnboarding.upsert({
      where: { shop },
      // 只在仍处于引导中时把 status 推进为 recommended，避免覆盖 skipped/completed
      update: {
        recommendedTargets: payload.recommendedTargets,
        recommendedModules: payload.recommendedModules,
        estimateCredits: payload.estimateCredits,
        estimateMinutes: payload.estimateMinutes,
        sourceScanId: payload.sourceScanId,
      },
      create: { shop, ...payload },
    });
  } catch (err) {
    console.error("[onboarding] saveOnboardingRecommendation failed:", err);
  }
}

/**
 * `/app` 入口决策：是否重定向到 `/app/onboarding`。
 * 新手引导已暂时关闭，始终返回 false。
 */
export async function shouldRedirectToOnboarding(
  _shop: string,
): Promise<boolean> {
  return false;
}

function chooseSuggestedTargets(targets: ShopLocaleRow[]): string[] {
  const published = targets.filter((t) => t.published).map((t) => t.locale);
  if (published.length > 0) return published;
  return targets.map((t) => t.locale);
}

/** 覆盖率缺口最大的语言（未译比例最高优先）。 */
function computeTopGaps(
  untranslatedRatioByLocale: Record<string, number | null>,
  labelByLocale: Map<string, string>,
): string[] {
  return Object.entries(untranslatedRatioByLocale)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([locale]) => labelByLocale.get(locale) ?? locale);
}

/** 由展示用积分粗估耗时（纯展示，非真实排队时间）。 */
function estimateMinutesFromCredits(credits: number | null): number | null {
  if (credits == null || credits <= 0) return null;
  // 经验值：约 2 万积分/分钟吞吐，夹在 1~120 分钟展示区间。
  return Math.min(120, Math.max(1, Math.ceil(credits / 20000)));
}

/**
 * 聚合 onboarding 展示数据（方案 A）。任一数据源失败都降级，不抛错。
 */
export async function buildOnboardingSummary(args: {
  shop: string;
  accessToken?: string;
  state?: SerializedOnboardingState | null;
}): Promise<OnboardingSummary> {
  const { shop, accessToken } = args;

  // 1) bootstrap（plan/trial/credits/isNew）
  let bootstrap: OnboardingSummary["bootstrap"] = {
    planType: "Free",
    isNew: null,
    isInFreePlanTime: false,
    remainingCredits: 0,
  };
  try {
    const [boot, quota] = await Promise.all([
      getTsfBootstrapData(shop),
      getShopCreditQuota(shop).catch(() => null),
    ]);
    bootstrap = {
      planType: boot.plan.type,
      isNew: boot.isNew,
      isInFreePlanTime: boot.plan.isInFreePlanTime,
      remainingCredits: Math.max(0, Math.floor(quota?.remaining ?? 0)),
    };
  } catch (err) {
    console.error("[onboarding] bootstrap load failed:", err);
  }

  // 2) locales（source + targets）
  let source = "en";
  let availableTargets: OnboardingLocaleOption[] = [];
  let suggestedTargets: string[] = [];
  let targetRows: ShopLocaleRow[] = [];
  try {
    if (accessToken) {
      const loaded = await loadShopLocalesForTranslation({ shop, accessToken });
      source = loaded.primaryLocale;
      targetRows = loaded.rows.filter((r) => !r.primary);
      availableTargets = targetRows.map((r) => ({
        value: r.locale,
        label: `${r.name} (${r.locale})`,
        published: r.published,
      }));
      suggestedTargets = chooseSuggestedTargets(targetRows);
    }
  } catch (err) {
    console.error("[onboarding] locales load failed:", err);
  }

  const labelByLocale = new Map(
    availableTargets.map((t) => [t.value, t.label] as const),
  );

  // 3) coverage（只读缓存，非阻塞；未统计则降级为 null 比例）
  let coverage: OnboardingSummary["coverage"] = null;
  let untranslatedRatioByLocale: Record<string, number | null> = {};
  try {
    if (suggestedTargets.length > 0) {
      const summary = await getCoverageSummaryFromCache({
        shop,
        targetLocales: suggestedTargets.map((value) => ({
          value,
          label: labelByLocale.get(value) ?? value,
        })),
        includeRuntimeSignals: false,
      });
      for (const row of summary.locales) {
        const pct = row.cacheMissing ? null : row.percent;
        untranslatedRatioByLocale[row.locale] =
          pct == null ? null : Math.min(1, Math.max(0, (100 - pct) / 100));
      }
      coverage = {
        overallPercent: summary.overallPercent,
        untranslatedRatioByLocale,
        topGaps: computeTopGaps(untranslatedRatioByLocale, labelByLocale),
      };
    }
  } catch (err) {
    console.error("[onboarding] coverage load failed:", err);
  }

  // 4) recommendation（模块 + 理由 + 店铺画像上下文）
  let shopProfile: OnboardingSummary["recommendation"]["shopProfile"] = null;
  try {
    const profile = await prisma.shopProfile.findUnique({
      where: { shop },
      select: { industry: true, brandTone: true, description: true },
    });
    if (profile) {
      shopProfile = {
        industry: profile.industry ?? null,
        brandTone: profile.brandTone ?? null,
        description: profile.description ?? null,
      };
    }
  } catch (err) {
    console.error("[onboarding] shop profile load failed:", err);
  }

  const reasons: string[] = [];
  const publishedCount = targetRows.filter((t) => t.published).length;
  if (publishedCount > 0) {
    reasons.push("onboarding.reason.published");
  } else if (targetRows.length > 0) {
    reasons.push("onboarding.reason.configured");
  } else {
    reasons.push("onboarding.reason.default");
  }
  if (shopProfile?.industry) reasons.push("onboarding.reason.industry");

  const localizationNotes = suggestedTargets
    .slice(0, MAX_SUGGESTED_TARGETS_DISPLAY)
    .map((locale) => ({
      locale,
      label: labelByLocale.get(locale) ?? locale,
      note: "onboarding.localizationNote.default",
    }));

  const recommendation: OnboardingSummary["recommendation"] = {
    suggestedModuleKeys: [...ONBOARDING_RECOMMENDED_MODULE_KEYS],
    reasons,
    localizationNotes,
    shopProfile,
  };

  // 5) estimate（复用创建任务预估，增量口径）
  let estimate: OnboardingSummary["estimate"] = null;
  try {
    if (suggestedTargets.length > 0) {
      const est = await estimateCreateTaskCredits({
        shop,
        v2ModuleKeys: recommendation.suggestedModuleKeys,
        targets: suggestedTargets,
        isCover: false,
        untranslatedRatioByLocale,
      });
      estimate = {
        credits: est.estimatedCredits,
        minutes: estimateMinutesFromCredits(est.estimatedCredits),
        isUpperBound: est.isUpperBound,
        needsMoreCredits: est.needsMoreCredits,
      };
    }
  } catch (err) {
    console.error("[onboarding] estimate failed:", err);
  }

  const picked = pickOnboardingFastCoverageLocale({
    suggestedTargets,
    availableTargets,
  });
  const fastCoveragePlan = picked
    ? {
        locale: picked.locale,
        localeLabel: picked.localeLabel,
        labels: [...ONBOARDING_FAST_COVERAGE_LABELS],
      }
    : null;

  return {
    shop,
    onboardingState: args.state ?? null,
    bootstrap,
    locales: { source, availableTargets, suggestedTargets },
    coverage,
    fastCoveragePlan,
    recommendation,
    estimate,
  };
}
