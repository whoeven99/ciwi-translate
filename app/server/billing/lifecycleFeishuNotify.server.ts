/**
 * 店铺终身首次安装 / 首次订阅飞书通知（客服群，对齐卸载）。
 * 不阻断 loader / webhook；失败只打日志。
 */

import prisma from "../../db.server";
import { sendFeishuTextMessage } from "../feishu/sendFeishuTextMessage.server";
import type { BindingResolution } from "./binding/resolveBillingBinding.server";
import { BILLING_LOG_EVENT } from "./types.server";
import {
  formatFirstSubscribeFeishuMessage,
  formatInstallFeishuMessage,
  snapshotShopForUninstall,
} from "./uninstallSnapshot.server";

const LOG_INSTALL = "[lifecycleFeishu:install]";
const LOG_SUBSCRIBE = "[lifecycleFeishu:subscribe]";

async function sendLifecycleFeishu(
  log: string,
  shop: string,
  text: string,
): Promise<void> {
  const result = await sendFeishuTextMessage(text);
  if (!result.ok && !("skipped" in result && result.skipped)) {
    console.warn(`${log} send failed shop=${shop}`, result);
  }
}

async function notifyFirstInstall(shop: string): Promise<void> {
  const snap = await snapshotShopForUninstall(shop);
  await sendLifecycleFeishu(
    LOG_INSTALL,
    shop,
    formatInstallFeishuMessage(snap),
  );
}

async function notifyFirstSubscribeIfLifetimeFirst(
  shop: string,
): Promise<void> {
  const activatedCount = await prisma.billingLog.count({
    where: { shop, eventType: BILLING_LOG_EVENT.SUBSCRIPTION_ACTIVATED },
  });
  if (activatedCount !== 1) {
    console.info(
      `${LOG_SUBSCRIBE} skip shop=${shop} activatedCount=${activatedCount}`,
    );
    return;
  }

  const snap = await snapshotShopForUninstall(shop);
  await sendLifecycleFeishu(
    LOG_SUBSCRIBE,
    shop,
    formatFirstSubscribeFeishuMessage(snap),
  );
}

/** bound: true（终身第一次建 Account）时异步发安装通知；重装不发。 */
export function scheduleFirstInstallFeishuNotify(
  binding: BindingResolution,
  shop: string,
): void {
  if (!binding.bound) return;

  void notifyFirstInstall(shop).catch((error) => {
    console.error(`${LOG_INSTALL} unhandled shop=${shop}`, error);
  });
}

/**
 * 入账 SUBSCRIPTION_ACTIVATED 之后调用。
 * 仅当该 shop 该事件恰好 1 条时发（终身第一次）；换套餐 / 再订 / 重放不发。
 */
export function scheduleFirstSubscribeFeishuNotify(shop: string): void {
  void notifyFirstSubscribeIfLifetimeFirst(shop).catch((error) => {
    console.error(`${LOG_SUBSCRIBE} unhandled shop=${shop}`, error);
  });
}
