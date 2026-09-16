/**
 * Worker 侧套餐能力（与 app/lib/planEntitlements.ts 对齐；勿漂移）。
 */

import { tsfExecute } from "./tsfDb.js";

export type PlanTier = "free" | "basic" | "pro" | "premium";
export type AutoTranslateIntervalHours = 1 | 12 | 24;

export type PlanEntitlements = {
  tier: PlanTier;
  allowMetafield: boolean;
  allowedV2Modules: string[] | null;
  minAutoTranslateIntervalHours: AutoTranslateIntervalHours;
  allowedAutoTranslateIntervalHours: readonly AutoTranslateIntervalHours[];
};

export const FREE_ALLOWED_V2_MODULES = [
  "theme",
  "navigation",
  "products",
  "pages",
  "article",
] as const;

const BY_TIER: Record<PlanTier, PlanEntitlements> = {
  free: {
    tier: "free",
    allowMetafield: false,
    allowedV2Modules: [...FREE_ALLOWED_V2_MODULES],
    minAutoTranslateIntervalHours: 24,
    allowedAutoTranslateIntervalHours: [24],
  },
  basic: {
    tier: "basic",
    allowMetafield: false,
    allowedV2Modules: null,
    minAutoTranslateIntervalHours: 24,
    allowedAutoTranslateIntervalHours: [24],
  },
  pro: {
    tier: "pro",
    allowMetafield: true,
    allowedV2Modules: null,
    minAutoTranslateIntervalHours: 12,
    allowedAutoTranslateIntervalHours: [12, 24],
  },
  premium: {
    tier: "premium",
    allowMetafield: true,
    allowedV2Modules: null,
    minAutoTranslateIntervalHours: 1,
    allowedAutoTranslateIntervalHours: [1, 12, 24],
  },
};

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
  return BY_TIER[normalizePlanTier(planType)];
}

export async function resolveShopPlanType(shop: string): Promise<string> {
  const rs = await tsfExecute({
    sql: `SELECT c.shopifyPlanName AS shopifyPlanName
          FROM AppSubscription s
          LEFT JOIN PlanCatalog c ON c.planKey = s.planKey
          WHERE s.shop = ? AND s.status = 'ACTIVE'
          LIMIT 1`,
    args: [shop],
  });
  const name = rs.rows[0]?.shopifyPlanName;
  return name != null && String(name).trim() ? String(name).trim() : "Free";
}

export async function resolveShopPlanEntitlements(
  shop: string,
): Promise<PlanEntitlements> {
  return entitlementsForPlanType(await resolveShopPlanType(shop));
}

export function filterAutoV2ModulesForPlan(
  keys: string[],
  entitlements: PlanEntitlements,
): string[] {
  return keys.filter((key) => {
    if (key === "metadata" && !entitlements.allowMetafield) return false;
    if (!entitlements.allowedV2Modules) return true;
    return entitlements.allowedV2Modules.includes(key);
  });
}

/** 未配置时默认 24h（各档套餐均允许）；可选更短间隔仍按套餐最短闸。 */
export function defaultAutoTranslateIntervalHours(
  _entitlements: PlanEntitlements,
): AutoTranslateIntervalHours {
  return 24;
}

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
  return defaultAutoTranslateIntervalHours(entitlements);
}

export function autoTranslateCooldownMsForInterval(
  intervalHours: AutoTranslateIntervalHours,
): number {
  return intervalHours * 60 * 60_000;
}

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
