import type { Account } from "../../../generated/prisma";
import prisma from "../../../db.server";
import { APP_SUBSCRIPTION_STATUS } from "../types.server";
import { cancelSubscription } from "../subscription/cancelSubscription.server";
import { resetSetupGuideOnReinstall } from "../../setupGuide.server";

/**
 * 确保 tsf 账户存在且非软删除状态（幂等）。
 * 卸载 → 重装：恢复账户，但额度清零（全新开始，避免重复试用）；
 * 并清掉卸载路径未处理完的残留 AppSubscription（pricing 否则仍显示付费计划）。
 */
export async function ensureAccount(shop: string): Promise<Account> {
  const existing = await prisma.account.findUnique({ where: { shop } });
  if (existing && existing.deletedAt) {
    const leftover = await prisma.appSubscription.findUnique({
      where: { shop },
    });
    if (leftover) {
      await cancelSubscription({
        shop,
        shopifySubscriptionId: leftover.shopifySubscriptionId,
        status: APP_SUBSCRIPTION_STATUS.CANCELLED,
      });
    }
    // 卸载后重装：恢复账户，清空所有额度
    const restored = await prisma.account.update({
      where: { shop },
      data: {
        deletedAt: null,
        subscriptionCredits: 0,
        purchasedCredits: 0,
        trialCredits: 0,
        usedCredits: 0,
      },
    });
    await resetSetupGuideOnReinstall(shop);
    return restored;
  }
  return prisma.account.upsert({
    where: { shop },
    create: { shop },
    update: { deletedAt: null },
  });
}
