/**
 * 卸载挽回邮件：按分群发腾讯云 SES，并同步发一条元数据飞书（不含邮件正文）。
 * 收件人只从 APP_UNINSTALLED payload 取（卸载后 token 已失效）。
 */

import prisma from "../../../db.server";
import {
  formatUsNumber,
  sendTencentTemplateEmail,
} from "../../email/tencentSes.server";
import { sendFeishuTextMessage } from "../../feishu/sendFeishuTextMessage.server";
import { listV4JobSummaryDocs } from "../../translateV4/cosmos.server";
import { getTranslateV4RedisClient } from "../../translateV4/redis.server";
import { ACTIVE_V4_STATUSES } from "../../translateV4/types";
import {
  formatUninstallFeishuMessage,
  type UninstallShopSnapshot,
} from "../uninstallSnapshot.server";
import { BILLING_LOG_EVENT } from "../types.server";

const LOG = "[uninstallEmail]";

const TEMPLATE_NEVER_FIRST = 212616;
const TEMPLATE_PAID_INCOMPLETE = 212617;
const TEMPLATE_REMAINING_CREDITS = 212612;

const SUBJECT =
  "Want to give Ciwi another try? We can help";

const IDEMPOTENCY_TTL_SEC = 7 * 24 * 3600;
const IDEMPOTENCY_KEY_PREFIX = "tsf:uninstall-email:";

export type UninstallWinbackKind =
  | "paid_incomplete"
  | "never_first"
  | "remaining_credits";

const KIND_META: Record<
  UninstallWinbackKind,
  { templateId: number; label: string; emoji: string }
> = {
  paid_incomplete: {
    templateId: TEMPLATE_PAID_INCOMPLETE,
    label: "已付费未完成",
    emoji: "⚠️",
  },
  never_first: {
    templateId: TEMPLATE_NEVER_FIRST,
    label: "未完成首次翻译",
    emoji: "👋",
  },
  remaining_credits: {
    templateId: TEMPLATE_REMAINING_CREDITS,
    label: "剩余积分",
    emoji: "💎",
  },
};

function maskEmail(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.indexOf("@");
  if (at <= 0) return "(invalid)";
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function logDetail(phase: string, payload: Record<string, unknown>): void {
  console.info(`${LOG} ${phase} ${JSON.stringify(payload)}`);
}

export function parseUninstallWebhookContact(payload: unknown): {
  email: string | null;
  customerName: string;
} {
  const body =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const email =
    asNonEmptyString(body.email) || asNonEmptyString(body.customer_email);
  const customerName = asNonEmptyString(body.shop_owner) || "there";
  return { email, customerName };
}

function isIncompleteJobStatus(status: string): boolean {
  if (status === "PAUSED" || status === "FAILED" || status === "CREATED") {
    return true;
  }
  return (ACTIVE_V4_STATUSES as string[]).includes(status);
}

export function resolveUninstallWinbackKind(input: {
  everPaid: boolean;
  hasCompleted: boolean;
  hasIncomplete: boolean;
  remainingCredits: number;
}): UninstallWinbackKind | null {
  if (input.everPaid && input.hasIncomplete) return "paid_incomplete";
  if (input.remainingCredits > 0) return "remaining_credits";
  if (!input.hasCompleted) return "never_first";
  return null;
}

export function formatUninstallKindTitle(
  shop: string,
  kind: UninstallWinbackKind,
): string {
  const meta = KIND_META[kind];
  return `${meta.emoji} 店铺卸载 · ${meta.label}：${shop}`;
}

async function loadUsageStatuses(shop: string): Promise<string[]> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ status: string }>>(
      "SELECT status FROM TranslateV4JobUsage WHERE shop = ?",
      shop,
    );
    return rows.map((row) => row.status);
  } catch (err) {
    console.warn(
      `${LOG} usage query failed shop=${shop}`,
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

async function loadWinbackSignals(shop: string): Promise<{
  everPaid: boolean;
  hasCompleted: boolean;
  hasIncomplete: boolean;
}> {
  const [paidLog, usageStatuses, jobs] = await Promise.all([
    prisma.billingLog
      .findFirst({
        where: {
          shop,
          eventType: {
            in: [
              BILLING_LOG_EVENT.SUBSCRIPTION_ACTIVATED,
              BILLING_LOG_EVENT.TOKEN_PACK_PURCHASED,
            ],
          },
        },
        select: { id: true },
      })
      .catch((err) => {
        console.warn(
          `${LOG} billingLog query failed shop=${shop}`,
          err instanceof Error ? err.message : err,
        );
        return null;
      }),
    loadUsageStatuses(shop),
    listV4JobSummaryDocs(shop, 50),
  ]);

  const allStatuses = [...usageStatuses, ...jobs.map((job) => job.status)];

  return {
    everPaid: Boolean(paidLog),
    hasCompleted: allStatuses.some((status) => status === "COMPLETED"),
    hasIncomplete: allStatuses.some((status) => isIncompleteJobStatus(status)),
  };
}

async function claimUninstallEmailSlot(shop: string): Promise<boolean> {
  try {
    const redis = getTranslateV4RedisClient();
    const result = await redis.set(
      `${IDEMPOTENCY_KEY_PREFIX}${shop}`,
      "1",
      "EX",
      IDEMPOTENCY_TTL_SEC,
      "NX",
    );
    return result === "OK";
  } catch (err) {
    console.warn(
      `${LOG} idempotency claim failed shop=${shop}; sending anyway`,
      err instanceof Error ? err.message : err,
    );
    return true;
  }
}

async function sendUninstallSnapshotFeishu(
  shop: string,
  snapshot: UninstallShopSnapshot | null,
  options?: {
    kind?: UninstallWinbackKind | null;
    skipReason?: string;
  },
): Promise<void> {
  const kind = options?.kind ?? null;
  const title = kind
    ? formatUninstallKindTitle(shop, kind)
    : `🛑 店铺卸载：${shop}`;
  const base = snapshot ? formatUninstallFeishuMessage(snapshot, title) : title;
  const message = options?.skipReason
    ? `${base}\n挽回邮件：未发（${options.skipReason}）`
    : base;
  const result = await sendFeishuTextMessage(message);
  if (!result.ok && !("skipped" in result && result.skipped)) {
    console.warn(`${LOG} uninstall feishu failed shop=${shop}`, result);
  }
}

async function notifyWinbackFeishu(params: {
  shop: string;
  kind: UninstallWinbackKind;
  to: string;
  remainingCreditsLabel: string;
  sesOk: boolean;
}): Promise<void> {
  const meta = KIND_META[params.kind];
  const message = [
    `${meta.emoji} 卸载挽回邮件 · ${meta.label}`,
    `店铺：${params.shop}`,
    `收件人：${maskEmail(params.to)}`,
    `分群：${meta.label}`,
    `模板：${meta.templateId}`,
    `SES：${params.sesOk ? "ok" : "failed"}`,
    `剩余积分：${params.remainingCreditsLabel}`,
    `标题：${SUBJECT}`,
  ].join("\n");

  const result = await sendFeishuTextMessage(message);
  if (!result.ok && !("skipped" in result && result.skipped)) {
    console.warn(`${LOG} feishu failed shop=${params.shop}`, result);
  }
}

async function deliverWinback(params: {
  shop: string;
  kind: UninstallWinbackKind;
  email: string;
  customerName: string;
  remainingCreditsLabel: string;
}): Promise<void> {
  const meta = KIND_META[params.kind];
  const sesOk = await sendTencentTemplateEmail({
    templateId: meta.templateId,
    subject: SUBJECT,
    to: params.email,
    templateData: {
      customer_name: params.customerName,
      remaining_credits: params.remainingCreditsLabel,
    },
  });

  logDetail("ses-result", {
    shop: params.shop,
    kind: params.kind,
    templateId: meta.templateId,
    to: maskEmail(params.email),
    ok: sesOk,
  });

  await notifyWinbackFeishu({
    shop: params.shop,
    kind: params.kind,
    to: params.email,
    remainingCreditsLabel: params.remainingCreditsLabel,
    sesOk,
  });
}

async function resolveKindOrNotifySkip(params: {
  shop: string;
  payload: unknown;
  snapshot: UninstallShopSnapshot | null;
}): Promise<{
  kind: UninstallWinbackKind;
  email: string;
  customerName: string;
  remainingCreditsLabel: string;
} | null> {
  const contact = parseUninstallWebhookContact(params.payload);
  const remainingCredits = Math.max(0, params.snapshot?.remainingCredits ?? 0);
  const remainingCreditsLabel = formatUsNumber(remainingCredits);

  logDetail("send-start", {
    shop: params.shop,
    hasEmail: Boolean(contact.email),
    to: contact.email ? maskEmail(contact.email) : null,
    remainingCredits,
  });

  const signals = await loadWinbackSignals(params.shop).catch((error) => {
    console.error(`${LOG} classify failed shop=${params.shop}`, error);
    return null;
  });
  if (!signals) {
    await sendUninstallSnapshotFeishu(params.shop, params.snapshot, {
      skipReason: "分类失败",
    });
    return null;
  }

  const kind = resolveUninstallWinbackKind({ ...signals, remainingCredits });
  logDetail("classified", {
    shop: params.shop,
    kind,
    ...signals,
    remainingCredits,
  });
  if (!kind) {
    console.info(`${LOG} skip reason=no_segment shop=${params.shop}`);
    await sendUninstallSnapshotFeishu(params.shop, params.snapshot, {
      skipReason: "已完成翻译且无剩余积分",
    });
    return null;
  }

  if (!contact.email) {
    console.warn(`${LOG} skip reason=no_recipient shop=${params.shop}`);
    await sendUninstallSnapshotFeishu(params.shop, params.snapshot, {
      kind,
      skipReason: "payload 无店铺邮箱",
    });
    return null;
  }

  return {
    kind,
    email: contact.email,
    customerName: contact.customerName,
    remainingCreditsLabel,
  };
}

async function runWinbackAfterClaim(params: {
  shop: string;
  payload: unknown;
  snapshot: UninstallShopSnapshot | null;
}): Promise<void> {
  const resolved = await resolveKindOrNotifySkip(params);
  if (!resolved) return;

  await sendUninstallSnapshotFeishu(params.shop, params.snapshot, {
    kind: resolved.kind,
  });
  await deliverWinback({
    shop: params.shop,
    kind: resolved.kind,
    email: resolved.email,
    customerName: resolved.customerName,
    remainingCreditsLabel: resolved.remainingCreditsLabel,
  });
}

async function sendUninstallWinbackEmail(params: {
  shop: string;
  payload: unknown;
  snapshot: UninstallShopSnapshot | null;
}): Promise<void> {
  const shop = params.shop.trim();
  if (!shop) {
    console.warn(`${LOG} skip reason=empty_shop`);
    return;
  }

  const claimed = await claimUninstallEmailSlot(shop);
  if (!claimed) {
    console.info(`${LOG} skip reason=duplicate shop=${shop}`);
    // 幂等只挡 SES；7 天内再卸仍发卸载飞书，避免测试店反复装卸时运营侧静默。
    await sendUninstallSnapshotFeishu(shop, params.snapshot, {
      skipReason: "7 天内已发过",
    });
    return;
  }

  try {
    await runWinbackAfterClaim({
      shop,
      payload: params.payload,
      snapshot: params.snapshot,
    });
  } catch (error) {
    console.error(`${LOG} unhandled after claim shop=${shop}`, error);
    await sendUninstallSnapshotFeishu(shop, params.snapshot, {
      skipReason: "分类失败",
    });
  }
}

/** APP_UNINSTALLED 后异步触发：卸载飞书 + 挽回邮件，不阻塞 webhook 200。 */
export function scheduleUninstallWinbackEmail(params: {
  shop: string;
  payload: unknown;
  snapshot: UninstallShopSnapshot | null;
}): void {
  void sendUninstallWinbackEmail(params).catch((error) => {
    console.error(`${LOG} unhandled shop=${params.shop}`, error);
  });
}
