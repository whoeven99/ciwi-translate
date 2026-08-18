/**
 * Worker 侧店铺终身首次订阅飞书通知。
 * 文案对齐 App uninstallSnapshot formatFirstSubscribeFeishuMessage。
 * 仅当 BillingLog SUBSCRIPTION_ACTIVATED 恰好 1 条时发送（webhook 漏报兜底）。
 */

import { sendFeishuTextMessage } from "./feishuNotify.js";
import { getTsfDb } from "./tsfDb.js";
import { getTotalCredits } from "./accountBalance.js";

const LOG = "[lifecycleFeishu:subscribe]";

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function intervalLabel(interval: string | null | undefined): string {
  if (interval === "MONTHLY") return "月付";
  if (interval === "ANNUAL") return "年付";
  return "—";
}

function asText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function asNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 刚写入一条 SUBSCRIPTION_ACTIVATED 后调用。
 * 该 shop 该事件不是恰好 1 条则跳过（换套餐 / 再订 / 与 App webhook 重复入账）。
 */
export async function notifyLifetimeFirstSubscribeFeishu(
  shop: string,
): Promise<void> {
  const db = getTsfDb();
  const countRes = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM BillingLog
          WHERE shop = ? AND eventType = 'SUBSCRIPTION_ACTIVATED'`,
    args: [shop],
  });
  const activatedCount = asNumber(countRes.rows[0]?.n);
  if (activatedCount !== 1) {
    console.info(
      `${LOG} skip shop=${shop} activatedCount=${activatedCount}`,
    );
    return;
  }

  const [accRes, subRes] = await Promise.all([
    db.execute({
      sql: `SELECT subscriptionCredits, purchasedCredits, trialCredits, usedCredits
            FROM Account WHERE shop = ? LIMIT 1`,
      args: [shop],
    }),
    db.execute({
      sql: `SELECT status, planKey, billingInterval
            FROM AppSubscription WHERE shop = ? LIMIT 1`,
      args: [shop],
    }),
  ]);

  const acc = accRes.rows[0];
  const sub = subRes.rows[0];
  const subscribed = asText(sub?.status) === "ACTIVE";
  let planName = "Free";
  if (sub) {
    const planKey = asText(sub.planKey) ?? "Unknown";
    const catalog = await db.execute({
      sql: `SELECT shopifyPlanName, displayName FROM PlanCatalog
            WHERE planKey = ? LIMIT 1`,
      args: [planKey],
    });
    const row = catalog.rows[0];
    planName =
      asText(row?.shopifyPlanName) ||
      asText(row?.displayName) ||
      planKey;
    if (!subscribed) {
      planName = `${planName}（${asText(sub.status) ?? "UNKNOWN"}）`;
    }
  }

  const subscribeLine = subscribed
    ? `订阅：是 · ${planName}`
    : sub
      ? `订阅：否 · ${planName}`
      : `订阅：否 · Free`;

  let quotaLine = "额度：未知";
  if (acc) {
    const subscriptionCredits = asNumber(acc.subscriptionCredits);
    const purchasedCredits = asNumber(acc.purchasedCredits);
    const trialCredits = asNumber(acc.trialCredits);
    const usedCredits = asNumber(acc.usedCredits);
    const totalCredits = getTotalCredits({
      subscriptionCredits,
      purchasedCredits,
      trialCredits,
    });
    const remainingCredits = Math.max(0, totalCredits - usedCredits);
    const pools = [
      `订阅 ${formatNumber(subscriptionCredits)}`,
      `加量 ${formatNumber(purchasedCredits)}`,
      `试用 ${formatNumber(trialCredits)}`,
    ].join(" + ");
    quotaLine =
      `额度：剩余 ${formatNumber(remainingCredits)}` +
      `（总 ${formatNumber(totalCredits)} / 已用 ${formatNumber(usedCredits)}；${pools}）`;
  }

  const text = [
    `💰 首次订阅：${shop}`,
    subscribeLine,
    `计费周期：${intervalLabel(asText(sub?.billingInterval))}`,
    quotaLine,
    "大小：未知",
  ].join("\n");

  const result = await sendFeishuTextMessage(text);
  if (!result.ok && !("skipped" in result && result.skipped)) {
    console.warn(`${LOG} send failed shop=${shop}`, result);
  }
}
