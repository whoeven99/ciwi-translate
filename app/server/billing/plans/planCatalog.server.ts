import type { PlanCatalog } from "../../../generated/prisma";
import prisma from "../../../db.server";
import { PLAN_KIND } from "../types.server";

/** 套餐目录记录（对外只暴露业务需要的字段）。 */
export type PlanRecord = Pick<
  PlanCatalog,
  | "planKey"
  | "kind"
  | "billingInterval"
  | "displayName"
  | "credits"
  | "priceAmount"
  | "currencyCode"
  | "trialDays"
  | "shopifyPlanName"
>;

const PLAN_SELECT = {
  planKey: true,
  kind: true,
  billingInterval: true,
  displayName: true,
  credits: true,
  priceAmount: true,
  currencyCode: true,
  trialDays: true,
  shopifyPlanName: true,
} as const;

export async function getPlanByKey(planKey: string): Promise<PlanRecord | null> {
  return prisma.planCatalog.findUnique({
    where: { planKey },
    select: PLAN_SELECT,
  });
}

/**
 * 按 Shopify 套餐名 + 周期匹配订阅套餐（webhook 用）。
 * 与 Java 侧一致：shopifyPlanName ∈ {Basic, Pro, Premium}。
 */
export async function findSubscriptionPlan(params: {
  shopifyPlanName: string;
  billingInterval: string; // MONTHLY | ANNUAL
}): Promise<PlanRecord | null> {
  return prisma.planCatalog.findFirst({
    where: {
      kind: PLAN_KIND.SUBSCRIPTION,
      shopifyPlanName: params.shopifyPlanName,
      billingInterval: params.billingInterval,
      enabled: true,
    },
    select: PLAN_SELECT,
  });
}

/**
 * 按包名匹配加量包（webhook 用）。
 * 与 Java 侧一致：shopifyPlanName 形如 "100K Credits" / "500K Credits" / "1M Credits" ...
 */
export async function findPackPlanByName(
  shopifyPlanName: string,
): Promise<PlanRecord | null> {
  return prisma.planCatalog.findFirst({
    where: {
      kind: PLAN_KIND.ONE_TIME_PACK,
      shopifyPlanName,
      enabled: true,
    },
    select: PLAN_SELECT,
  });
}
