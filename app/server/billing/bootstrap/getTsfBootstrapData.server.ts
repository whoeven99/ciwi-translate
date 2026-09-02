import type { AppBootstrapData } from "~/server/appBootstrap.server";
import prisma from "../../../db.server";
import {
  APP_SUBSCRIPTION_STATUS,
  BILLING_INTERVAL,
  BILLING_LOG_EVENT,
} from "../types.server";
import { getAccountQuota } from "../quota/getAccountQuota.server";

/** 与老系统 planId 对齐（Free=2 / Basic=4 / Pro=5 / Premium=6），前端 loading 判定依赖非 0 id。 */
const PLAN_ID_BY_NAME: Record<string, number> = {
  Free: 2,
  Basic: 4,
  Pro: 5,
  Premium: 6,
};

function formatPlanUpdateTime(value: Date | null | undefined): string | null {
  if (!value) return null;
  const time = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(time.getTime())) return null;
  return time.toISOString();
}

/**
 * tsf（新系统）用户的 bootstrap 数据，替代 Java 侧订阅/额度。
 * chars=已用积分、totalChars=总积分（与老系统语义一致，前端算余额）。
 * isNew=从未激活过订阅（决定是否展示试用入口）。
 */
export async function getTsfBootstrapData(
  shop: string,
): Promise<AppBootstrapData> {
  const [quota, sub, activatedCount] = await Promise.all([
    getAccountQuota(shop),
    prisma.appSubscription.findUnique({ where: { shop } }),
    prisma.billingLog.count({
      where: { shop, eventType: BILLING_LOG_EVENT.SUBSCRIPTION_ACTIVATED },
    }),
  ]);

  let plan: AppBootstrapData["plan"] = {
    id: PLAN_ID_BY_NAME.Free,
    type: "Free",
    feeType: 0,
    isInFreePlanTime: false,
  };
  let updateTime: string | null = null;

  if (sub && sub.status === APP_SUBSCRIPTION_STATUS.ACTIVE) {
    const catalog = await prisma.planCatalog.findUnique({
      where: { planKey: sub.planKey },
    });
    const name = catalog?.shopifyPlanName ?? "Free";
    const now = Date.now();
    plan = {
      id: PLAN_ID_BY_NAME[name] ?? PLAN_ID_BY_NAME.Free,
      type: name,
      feeType: sub.billingInterval === BILLING_INTERVAL.ANNUAL ? 2 : 1,
      isInFreePlanTime: sub.trialEndsAt
        ? sub.trialEndsAt.getTime() > now
        : false,
    };
    updateTime = formatPlanUpdateTime(sub.currentPeriodEnd);
  }

  return {
    plan,
    updateTime,
    chars: quota?.usedCredits,
    totalChars: quota?.totalCredits,
    trialCredits: quota?.trialCredits ?? 0,
    purchasedCredits: quota?.purchasedCredits ?? 0,
    migratablePurchasedCredits: quota?.migratablePurchasedCredits ?? 0,
    isNew: activatedCount === 0,
  };
}
