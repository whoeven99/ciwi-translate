import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { cleanupBillingOnUninstall } from "~/server/billing/subscription/cleanupOnUninstall.server";
import {
  snapshotShopForUninstall,
  type UninstallShopSnapshot,
} from "~/server/billing/uninstallSnapshot.server";
import {
  handleTsfPurchaseWebhook,
  handleTsfSubscriptionWebhook,
} from "~/server/billing/webhooks/handleBillingWebhook.server";
import { scheduleUninstallWinbackEmail } from "~/server/billing/email/uninstallEmail.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, session, admin, payload } =
    await authenticate.webhook(request);

  if (!admin && topic !== "SHOP_REDACT") {
    throw new Response();
  }

  console.log(`${shop} ${topic} webhooks: ${payload}`);

  switch (topic) {
    case "APP_UNINSTALLED": {
      // 无论如何必须返回 200，删除失败只记日志不阻断响应。
      // 先快照（订阅/额度/大小）→ 清本地订阅 → 软删 Account / 删 Session
      // → 异步发卸载飞书（未发挽回邮件时末行补原因）+ 挽回 SES。
      let snapshot: UninstallShopSnapshot | null = null;
      try {
        snapshot = await snapshotShopForUninstall(shop);
      } catch (e) {
        console.error("APP_UNINSTALLED: snapshot failed", e);
      }
      try {
        await cleanupBillingOnUninstall({
          shop,
          accessToken: session?.accessToken,
          attemptShopifyCancel: false,
        });
      } catch (e) {
        console.error("APP_UNINSTALLED: billing cleanup failed", e);
      }
      try {
        await db.account.updateMany({
          where: { shop },
          data: { deletedAt: new Date() },
        });
      } catch (e) {
        console.error("APP_UNINSTALLED: account soft-delete failed", e);
      }
      try {
        if (session) {
          await db.session.deleteMany({ where: { shop } });
        }
      } catch (e) {
        console.error("APP_UNINSTALLED: session delete failed", e);
      }
      // 快照飞书 + 挽回邮件都在 schedule 里发出（未发时在卸载飞书末行补原因），不挡 200。
      scheduleUninstallWinbackEmail({
        shop,
        payload,
        snapshot,
      });
      return new Response(null, { status: 200 });
    }

    case "APP_PURCHASES_ONE_TIME_UPDATE":
      // 先 ACK，后台入账：Shopify 看板响应时间只计到 200；账本本身幂等，失败靠 worker reconcile。
      void handleTsfPurchaseWebhook({
        shop,
        accessToken: session?.accessToken,
        payload,
      }).catch((error) => {
        console.error("Error processing purchase:", error);
      });
      return new Response(null, { status: 200 });

    case "APP_SUBSCRIPTIONS_UPDATE":
      // 先 ACK，后台入账：避免同步等 Shopify GraphQL + Turso 把 p50 拖到 1s+。
      void handleTsfSubscriptionWebhook({
        shop,
        accessToken: session?.accessToken,
        payload,
      }).catch((error) => {
        console.error("Error APP_SUBSCRIPTIONS_UPDATE:", error);
      });
      return new Response(null, { status: 200 });

    case "CUSTOMERS_DATA_REQUEST":
    case "CUSTOMERS_REDACT":
      break;

    case "SHOP_REDACT": {
      // 无论如何必须返回 200，删除失败只记日志不阻断响应
      try {
        await cleanupBillingOnUninstall({
          shop,
          accessToken: session?.accessToken,
          attemptShopifyCancel: true,
        });
      } catch (e) {
        console.error("SHOP_REDACT: billing cleanup failed", e);
      }
      try {
        await db.account.updateMany({
          where: { shop },
          data: { deletedAt: new Date() },
        });
      } catch (e) {
        console.error("SHOP_REDACT: account soft-delete failed", e);
      }
      try {
        if (session) {
          await db.session.deleteMany({ where: { shop } });
        }
      } catch (e) {
        console.error("SHOP_REDACT: session delete failed", e);
      }
      return new Response(null, { status: 200 });
    }

    default:
      throw new Response("Unhandled webhook topic", { status: 404 });
  }

  throw new Response();
};
