import prisma from "../../../db.server";
import {
  getMigratablePurchasedCredits,
  getRemainingCredits,
  getTotalCredits,
} from "../accountBalance.server";

export type AccountQuota = {
  totalCredits: number;
  usedCredits: number;
  remainingCredits: number;
  subscriptionCredits: number;
  purchasedCredits: number;
  trialCredits: number;
  migratablePurchasedCredits: number;
};

/** 读 tsf 账户额度（bootstrap 展示 / 建任务 gate 用）。无账户返回 null。 */
export async function getAccountQuota(
  shop: string,
): Promise<AccountQuota | null> {
  const account = await prisma.account.findUnique({ where: { shop } });
  if (!account) return null;

  return {
    totalCredits: getTotalCredits(account),
    usedCredits: account.usedCredits,
    remainingCredits: getRemainingCredits(account),
    subscriptionCredits: account.subscriptionCredits,
    purchasedCredits: account.purchasedCredits,
    trialCredits: account.trialCredits,
    migratablePurchasedCredits: getMigratablePurchasedCredits(account),
  };
}
