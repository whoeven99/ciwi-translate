/**
 * 套餐能力矩阵（纯函数，App 客户端 / server 共用）。
 * Free：建任务一次 1 门目标语；模块五件套；禁 metafield/Liquid。
 * Basic：禁 metafield/Liquid；自动更新最短 24h。
 * Pro / Premium：全开；自动更新最短 12h / 1h（可选更长）。
 */

export type PlanTier = "free" | "basic" | "pro" | "premium";

/** 商户可选的自动更新间隔（小时）。 */
export type AutoTranslateIntervalHours = 1 | 12 | 24;

export type PlanEntitlements = {
  tier: PlanTier;
  /** 一次建任务最多目标语数；Infinity = 不限 */
  maxTargetsPerTask: number;
  /** 手动建任务允许的 v2 模块；null = 全部 */
  allowedV2Modules: readonly string[] | null;
  allowMetafield: boolean;
  allowLiquid: boolean;
  /** 套餐允许的最短自动更新间隔（小时） */
  minAutoTranslateIntervalHours: AutoTranslateIntervalHours;
  /** 套餐可选间隔（短→长） */
  allowedAutoTranslateIntervalHours: readonly AutoTranslateIntervalHours[];
};

const HOUR_MS = 60 * 60_000;

/** Free 可译模块：主题、导航、产品、页面、文章 */
export const FREE_ALLOWED_V2_MODULES = [
  "theme",
  "navigation",
  "products",
  "pages",
  "article",
] as const;

const FREE_ENTITLEMENTS: PlanEntitlements = {
  tier: "free",
  maxTargetsPerTask: 1,
  allowedV2Modules: [...FREE_ALLOWED_V2_MODULES],
  allowMetafield: false,
  allowLiquid: false,
  minAutoTranslateIntervalHours: 24,
  allowedAutoTranslateIntervalHours: [24],
};

const BASIC_ENTITLEMENTS: PlanEntitlements = {
  tier: "basic",
  maxTargetsPerTask: Number.POSITIVE_INFINITY,
  allowedV2Modules: null,
  allowMetafield: false,
  allowLiquid: false,
  minAutoTranslateIntervalHours: 24,
  allowedAutoTranslateIntervalHours: [24],
};

const PRO_ENTITLEMENTS: PlanEntitlements = {
  tier: "pro",
  maxTargetsPerTask: Number.POSITIVE_INFINITY,
  allowedV2Modules: null,
  allowMetafield: true,
  allowLiquid: true,
  minAutoTranslateIntervalHours: 12,
  allowedAutoTranslateIntervalHours: [12, 24],
};

const PREMIUM_ENTITLEMENTS: PlanEntitlements = {
  tier: "premium",
  maxTargetsPerTask: Number.POSITIVE_INFINITY,
  allowedV2Modules: null,
  allowMetafield: true,
  allowLiquid: true,
  minAutoTranslateIntervalHours: 1,
  allowedAutoTranslateIntervalHours: [1, 12, 24],
};

/** 从 bootstrap / PlanCatalog.shopifyPlanName 归一化套餐档。 */
export function normalizePlanTier(planType: string | null | undefined): PlanTier {
  const key = String(planType ?? "")
    .trim()
    .toLowerCase();
  if (key === "premium") return "premium";
  if (key === "pro") return "pro";
  if (key === "basic") return "basic";
  return "free";
}

export function entitlementsForPlanType(
  planType: string | null | undefined,
): PlanEntitlements {
  const tier = normalizePlanTier(planType);
  switch (tier) {
    case "premium":
      return PREMIUM_ENTITLEMENTS;
    case "pro":
      return PRO_ENTITLEMENTS;
    case "basic":
      return BASIC_ENTITLEMENTS;
    case "free":
      return FREE_ENTITLEMENTS;
  }
}

export function isV2ModuleAllowedForPlan(
  moduleKey: string,
  entitlements: PlanEntitlements,
): boolean {
  if (moduleKey === "metadata" && !entitlements.allowMetafield) return false;
  if (!entitlements.allowedV2Modules) return true;
  return entitlements.allowedV2Modules.includes(moduleKey);
}

/** 按套餐过滤 v2 模块列表（建任务默认勾选 / auto 设置）。 */
export function filterV2ModulesForPlan(
  keys: readonly string[],
  entitlements: PlanEntitlements,
): string[] {
  return keys.filter((key) => isV2ModuleAllowedForPlan(key, entitlements));
}

/** 套餐默认间隔 = 最短（最快）。 */
export function defaultAutoTranslateIntervalHours(
  entitlements: PlanEntitlements,
): AutoTranslateIntervalHours {
  return entitlements.minAutoTranslateIntervalHours;
}

/**
 * 将商户所选间隔钳到套餐允许集；非法/过短 → 套餐最短。
 */
export function clampAutoTranslateIntervalHours(
  hours: unknown,
  entitlements: PlanEntitlements,
): AutoTranslateIntervalHours {
  const n = typeof hours === "number" ? hours : Number(hours);
  const allowed = entitlements.allowedAutoTranslateIntervalHours;
  if (
    Number.isInteger(n) &&
    allowed.includes(n as AutoTranslateIntervalHours)
  ) {
    return n as AutoTranslateIntervalHours;
  }
  return entitlements.minAutoTranslateIntervalHours;
}

export function autoTranslateCooldownMsForInterval(
  intervalHours: AutoTranslateIntervalHours,
): number {
  return intervalHours * HOUR_MS;
}

/**
 * 当前小时槽是否落在「对齐时刻 + 间隔」的周期上。
 * interval=1 → 每小时都可；interval=24 → 仅对齐时刻；interval=12 → 对齐与 +12h。
 */
export function isAutoTranslateHourSlotMatch(params: {
  currentSlot: number;
  alignHour: number;
  intervalHours: AutoTranslateIntervalHours;
}): boolean {
  const cur = ((params.currentSlot % 24) + 24) % 24;
  const align = ((params.alignHour % 24) + 24) % 24;
  const interval = params.intervalHours;
  if (interval <= 1) return true;
  if (interval >= 24) return cur === align;
  return (cur - align + 24) % interval === 0;
}
