import prisma from "~/db.server";
import {
  entitlementsForPlanType,
  type PlanEntitlements,
} from "~/lib/planEntitlements";
import { expandV2ModuleKeys } from "~/server/translateV4/moduleCatalog";
import type { TranslationV4Module } from "~/server/translateV4/types";
import { APP_SUBSCRIPTION_STATUS } from "./types.server";

export type {
  PlanEntitlements,
  PlanTier,
} from "~/lib/planEntitlements";
export {
  entitlementsForPlanType,
  FREE_ALLOWED_V2_MODULES,
  isV2ModuleAllowedForPlan,
  filterV2ModulesForPlan,
  normalizePlanTier,
  defaultAutoTranslateIntervalHours,
  clampAutoTranslateIntervalHours,
  autoTranslateCooldownMsForInterval,
  isAutoTranslateHourSlotMatch,
  type AutoTranslateIntervalHours,
  type PlanEntitlements,
  type PlanTier,
} from "~/lib/planEntitlements";

/** 读 ACTIVE 订阅的 shopifyPlanName；无订阅 → Free。试用窗不改档（跟当前订阅）。 */
export async function resolveShopPlanType(shop: string): Promise<string> {
  const sub = await prisma.appSubscription.findUnique({
    where: { shop },
    select: { status: true, planKey: true },
  });
  if (!sub || sub.status !== APP_SUBSCRIPTION_STATUS.ACTIVE) {
    return "Free";
  }
  const catalog = await prisma.planCatalog.findUnique({
    where: { planKey: sub.planKey },
    select: { shopifyPlanName: true },
  });
  return catalog?.shopifyPlanName?.trim() || "Free";
}

export async function resolveShopPlanEntitlements(
  shop: string,
): Promise<PlanEntitlements> {
  const planType = await resolveShopPlanType(shop);
  return entitlementsForPlanType(planType);
}

export type PlanCreateTaskGateResult =
  | { ok: true; modules: TranslationV4Module[]; includeLiquid: boolean }
  | { ok: false; error: string; status: number };

/**
 * 建任务套餐闸：目标语批量数、模块、Liquid。
 * `batchTargetCount` 为同一次创建点击的目标语总数（客户端传入）。
 */
export function evaluateCreateTaskPlanGate(params: {
  entitlements: PlanEntitlements;
  batchTargetCount: number;
  modules: TranslationV4Module[];
  includeLiquid: boolean;
}): PlanCreateTaskGateResult {
  const { entitlements, batchTargetCount, modules, includeLiquid } = params;

  if (
    Number.isFinite(entitlements.maxTargetsPerTask) &&
    batchTargetCount > entitlements.maxTargetsPerTask
  ) {
    return {
      ok: false,
      error: "v4.plan.freeSingleTargetOnly",
      status: 403,
    };
  }

  if (includeLiquid && !entitlements.allowLiquid) {
    return {
      ok: false,
      error: "v4.plan.liquidRequiresPro",
      status: 403,
    };
  }

  const allowedV4 = entitlements.allowedV2Modules
    ? new Set<string>(expandV2ModuleKeys([...entitlements.allowedV2Modules]))
    : null;

  const filtered: TranslationV4Module[] = [];
  for (const mod of modules) {
    if (mod === "METAFIELD" && !entitlements.allowMetafield) {
      return {
        ok: false,
        error: "v4.plan.metafieldRequiresPro",
        status: 403,
      };
    }
    if (allowedV4 && !allowedV4.has(mod)) {
      return {
        ok: false,
        error: "v4.plan.moduleNotAllowed",
        status: 403,
      };
    }
    filtered.push(mod);
  }

  if (!filtered.length && !(includeLiquid && entitlements.allowLiquid)) {
    return {
      ok: false,
      error: "v4.validation.selectModule",
      status: 400,
    };
  }

  return {
    ok: true,
    modules: filtered,
    includeLiquid: includeLiquid && entitlements.allowLiquid,
  };
}
