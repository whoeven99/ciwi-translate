import prisma from "../../../db.server";
import { ensureAccount } from "../account/ensureAccount.server";

export type BindingResolution = {
  /** 本次是否新建了 TSF Account（首次判定）。 */
  bound: boolean;
  /** 判定是否落库。 */
  persisted: boolean;
  /** 本次是否从软删除 Account 恢复（卸载后重装）。 */
  restored: boolean;
};

/**
 * 判定并锁定某 shop 的 TSF 账本初始化（幂等）。
 * - 已有 Account：恢复可能的软删除状态并返回。
 * - 无 Account：创建账户，并让调用方触发首次欢迎邮件。
 */
export async function resolveBillingBinding(
  shop: string,
): Promise<BindingResolution> {
  const existing = await prisma.account.findUnique({
    where: { shop },
    select: { shop: true, deletedAt: true },
  });

  await ensureAccount(shop);

  return {
    bound: !existing,
    persisted: true,
    restored: Boolean(existing?.deletedAt),
  };
}
