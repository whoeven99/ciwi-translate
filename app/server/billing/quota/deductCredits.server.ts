import prisma from "../../../db.server";
import { expireInstallTrialCreditsIfDue } from "../grant/grantBasicFirstPayBonus.server";
import { getAccountQuota, type AccountQuota } from "./getAccountQuota.server";

/**
 * 周期内扣减：仅自增 usedCredits（三池在续费时才结算，故此处无需分池逻辑）。
 * 允许 used 超过总额（负余额），拦截交由上游 gate；返回扣减后的额度快照。
 * worker 直连 Turso 时可复用本函数（纯自增，无并发结算风险）。
 */
export async function deductCredits(
  shop: string,
  credits: number,
): Promise<AccountQuota | null> {
  const amount = Math.max(0, Math.floor(credits));
  await expireInstallTrialCreditsIfDue(shop);
  if (amount > 0) {
    await prisma.account.update({
      where: { shop },
      data: { usedCredits: { increment: amount } },
    });
  }
  return getAccountQuota(shop);
}
