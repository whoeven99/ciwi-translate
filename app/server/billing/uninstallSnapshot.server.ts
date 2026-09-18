import prisma from "../../db.server";
import { getAccountQuota } from "./quota/getAccountQuota.server";
import {
  APP_SUBSCRIPTION_STATUS,
  BILLING_INTERVAL,
  BILLING_LOG_EVENT,
} from "./types.server";
import { readShopSizeProfile } from "../shopScan/shopSizeProfile.server";

export type UninstallShopSnapshot = {
  shop: string;
  /** 本地是否有 ACTIVE 订阅行。 */
  subscribed: boolean;
  /** 套餐展示名，如 Basic；未订阅为 Free。 */
  planName: string;
  status: string | null;
  billingInterval: string | null;
  billingIntervalLabel: string;
  remainingCredits: number | null;
  totalCredits: number | null;
  usedCredits: number | null;
  subscriptionCredits: number | null;
  purchasedCredits: number | null;
  trialCredits: number | null;
  sizeTier: string | null;
  dataSizeKB: number | null;
};

function intervalLabel(interval: string | null | undefined): string {
  if (interval === BILLING_INTERVAL.MONTHLY) return "月付";
  if (interval === BILLING_INTERVAL.ANNUAL) return "年付";
  return "—";
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

const SUBSCRIPTION_LOG_EVENTS = [
  BILLING_LOG_EVENT.SUBSCRIPTION_ACTIVATED,
  BILLING_LOG_EVENT.SUBSCRIPTION_RENEWED,
  BILLING_LOG_EVENT.SUBSCRIPTION_CANCELLED,
] as const;

/** 只认卸载前后 webhook 乱序窗口，避免把上个月已取消的套餐当成当前计划。 */
const SUBSCRIPTION_LOG_FALLBACK_MAX_AGE_MS = 15 * 60 * 1000;

async function resolvePlanDisplay(planKey: string): Promise<{
  planName: string;
  billingInterval: string | null;
}> {
  try {
    const catalog = await prisma.planCatalog.findUnique({ where: { planKey } });
    return {
      planName:
        catalog?.shopifyPlanName?.trim() ||
        catalog?.displayName?.trim() ||
        planKey ||
        "Unknown",
      billingInterval: catalog?.billingInterval ?? null,
    };
  } catch (err) {
    console.warn(`[uninstall snapshot] PlanCatalog failed planKey=${planKey}`, err);
    return { planName: planKey || "Unknown", billingInterval: null };
  }
}

function terminalStatusFromLog(
  eventType: string,
  metadata: unknown,
): string {
  if (eventType === BILLING_LOG_EVENT.SUBSCRIPTION_CANCELLED) {
    const meta =
      metadata && typeof metadata === "object"
        ? (metadata as Record<string, unknown>)
        : null;
    const raw = typeof meta?.status === "string" ? meta.status.trim() : "";
    if (raw) return raw;
  }
  return APP_SUBSCRIPTION_STATUS.CANCELLED;
}

/** 订阅行已被 cancel 删掉时，用 15 分钟内的订阅流水补套餐（卸载 webhook 常晚于 CANCELLED）。 */
async function resolvePlanFromBillingLog(shop: string): Promise<{
  planName: string;
  status: string;
  billingInterval: string | null;
} | null> {
  try {
    const since = new Date(Date.now() - SUBSCRIPTION_LOG_FALLBACK_MAX_AGE_MS);
    const log = await prisma.billingLog.findFirst({
      where: {
        shop,
        eventType: { in: [...SUBSCRIPTION_LOG_EVENTS] },
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      select: { eventType: true, planKey: true, metadata: true },
    });
    if (!log?.planKey) return null;
    const display = await resolvePlanDisplay(log.planKey);
    const status = terminalStatusFromLog(log.eventType, log.metadata);
    return {
      planName: `${display.planName}（${status}）`,
      status,
      billingInterval: display.billingInterval,
    };
  } catch (err) {
    console.warn(`[uninstall snapshot] BillingLog fallback failed shop=${shop}`, err);
    return null;
  }
}

/**
 * 卸载清理前快照：订阅/套餐、计费周期、额度、店铺大小档位。
 * 任一部分失败不影响其它字段（best-effort）。
 * 无 AppSubscription 时回查 15 分钟内 BillingLog，避免 CANCELLED webhook 抢先删行后显示 Free。
 */
export async function snapshotShopForUninstall(
  shop: string,
): Promise<UninstallShopSnapshot> {
  const [sub, quota, size] = await Promise.all([
    prisma.appSubscription.findUnique({ where: { shop } }).catch((err) => {
      console.warn(`[uninstall snapshot] AppSubscription failed shop=${shop}`, err);
      return null;
    }),
    getAccountQuota(shop).catch((err) => {
      console.warn(`[uninstall snapshot] quota failed shop=${shop}`, err);
      return null;
    }),
    readShopSizeProfile(shop),
  ]);

  let planName = "Free";
  let subscribed = false;
  let status: string | null = null;
  let billingInterval: string | null = null;

  if (sub) {
    status = sub.status;
    billingInterval = sub.billingInterval;
    subscribed = sub.status === APP_SUBSCRIPTION_STATUS.ACTIVE;
    const display = await resolvePlanDisplay(sub.planKey);
    planName = display.planName;
    if (!subscribed) {
      planName = `${planName}（${sub.status}）`;
    }
  } else {
    const fromLog = await resolvePlanFromBillingLog(shop);
    if (fromLog) {
      planName = fromLog.planName;
      status = fromLog.status;
      billingInterval = fromLog.billingInterval;
    }
  }

  return {
    shop,
    subscribed,
    planName,
    status,
    billingInterval,
    billingIntervalLabel: intervalLabel(billingInterval),
    remainingCredits: quota?.remainingCredits ?? null,
    totalCredits: quota?.totalCredits ?? null,
    usedCredits: quota?.usedCredits ?? null,
    subscriptionCredits: quota?.subscriptionCredits ?? null,
    purchasedCredits: quota?.purchasedCredits ?? null,
    trialCredits: quota?.trialCredits ?? null,
    sizeTier: size?.sizeTier ?? null,
    dataSizeKB: size?.dataSizeKB ?? null,
  };
}

/** 安装 / 首次订阅 / 卸载共用的订阅·周期·额度·大小行。 */
export function formatShopBillingFeishuLines(
  snap: UninstallShopSnapshot,
): string[] {
  const subscribeLine = snap.subscribed
    ? `订阅：是 · ${snap.planName}`
    : snap.status
      ? `订阅：否 · ${snap.planName}`
      : `订阅：否 · Free`;

  let quotaLine = "额度：未知";
  if (
    snap.remainingCredits != null &&
    snap.totalCredits != null &&
    snap.usedCredits != null
  ) {
    const pools = [
      snap.subscriptionCredits != null
        ? `订阅 ${formatNumber(snap.subscriptionCredits)}`
        : null,
      snap.purchasedCredits != null
        ? `加量 ${formatNumber(snap.purchasedCredits)}`
        : null,
      snap.trialCredits != null
        ? `试用 ${formatNumber(snap.trialCredits)}`
        : null,
    ]
      .filter(Boolean)
      .join(" + ");
    quotaLine =
      `额度：剩余 ${formatNumber(snap.remainingCredits)}` +
      `（总 ${formatNumber(snap.totalCredits)} / 已用 ${formatNumber(snap.usedCredits)}` +
      (pools ? `；${pools}` : "") +
      `）`;
  }

  const sizeLine =
    snap.sizeTier != null
      ? `大小：${snap.sizeTier}${
          snap.dataSizeKB != null
            ? `（约 ${formatNumber(snap.dataSizeKB)}KB）`
            : ""
        }`
      : "大小：未知";

  return [
    subscribeLine,
    `计费周期：${snap.billingIntervalLabel}`,
    quotaLine,
    sizeLine,
  ];
}

function formatLifecycleFeishuMessage(
  title: string,
  snap: UninstallShopSnapshot,
): string {
  return [title, ...formatShopBillingFeishuLines(snap)].join("\n");
}

/** 组装卸载飞书纯文本（用清理前快照，避免清理后额度/订阅已空）。 */
export function formatUninstallFeishuMessage(
  snap: UninstallShopSnapshot,
  title?: string,
): string {
  return formatLifecycleFeishuMessage(
    title ?? `🛑 店铺卸载：${snap.shop}`,
    snap,
  );
}

/** 店铺终身第一次创建 Account 时的安装飞书文案。 */
export function formatInstallFeishuMessage(
  snap: UninstallShopSnapshot,
): string {
  return formatLifecycleFeishuMessage(`✅ 店铺安装：${snap.shop}`, snap);
}

/** 店铺终身第一条 SUBSCRIPTION_ACTIVATED 时的飞书文案。 */
export function formatFirstSubscribeFeishuMessage(
  snap: UninstallShopSnapshot,
): string {
  return formatLifecycleFeishuMessage(`💰 首次订阅：${snap.shop}`, snap);
}
