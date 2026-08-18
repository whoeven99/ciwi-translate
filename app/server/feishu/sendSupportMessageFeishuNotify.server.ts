import { sendFeishuTextMessage } from "./sendFeishuTextMessage.server";
import type { SupportImageAttachment } from "~/server/support/supportAttachments.server";

const LOG = "[Feishu][SupportMsg]";
const CONTENT_MAX_LENGTH = 500;
const FIELD_FALLBACK = "（未提供）";

export type SendSupportMessageFeishuNotifyParams = {
  shop: string;
  content: string;
  attachments?: SupportImageAttachment[];
  contactEmail?: string | null;
  shopEmail?: string | null;
  unreadForOps?: number;
  at?: Date;
};

function truncate(value: string | null | undefined, maxLength: number): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return FIELD_FALLBACK;
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength)}…`;
}

function formatOpsNotifyTime(at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";

  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

function resolveAdminSupportUrl(): string | null {
  const base = process.env.ADMIN_BASE_URL?.trim();
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/translate-v4-support`;
}

function formatMessageBody(
  content: string,
  attachments: SupportImageAttachment[] | undefined,
): string {
  const text = content.trim();
  const imageLines =
    attachments?.filter((item) => item.type === "image").map((item) => item.url) ?? [];
  if (text && imageLines.length > 0) {
    return `${truncate(text, CONTENT_MAX_LENGTH - 40)}\n[图片] ${imageLines.join("\n")}`;
  }
  if (imageLines.length > 0) {
    return `[图片]\n${imageLines.join("\n")}`;
  }
  return truncate(text, CONTENT_MAX_LENGTH);
}

export function buildSupportMessageNotify(
  params: SendSupportMessageFeishuNotifyParams,
): string {
  const contact = params.contactEmail?.trim();
  const shopEmail = params.shopEmail?.trim();
  const adminUrl = resolveAdminSupportUrl();

  const lines = [
    "💬 收到新的翻译客服消息",
    "",
    "来源: 翻译 v4",
    `店铺: ${params.shop}`,
    `联系邮箱: ${truncate(contact || shopEmail, 200)}${contact ? "" : shopEmail ? "（账户邮箱）" : ""}`,
    `消息: ${formatMessageBody(params.content, params.attachments)}`,
    `时间: ${formatOpsNotifyTime(params.at ?? new Date())}`,
  ];
  if (typeof params.unreadForOps === "number" && params.unreadForOps > 1) {
    lines.push(`未读: 共 ${params.unreadForOps} 条待回复`);
  }
  lines.push("");
  lines.push(
    adminUrl
      ? `👉 请到 Admin「翻译 v4 客服」回复：${adminUrl}`
      : "👉 请到 Admin「翻译 v4 客服」页面回复",
  );
  return lines.join("\n");
}

/** 商家在翻译 v4 客服面板发消息后，通知运营飞书群。失败不阻断消息发送。 */
export async function sendSupportMessageFeishuNotify(
  params: SendSupportMessageFeishuNotifyParams,
): Promise<void> {
  const message = buildSupportMessageNotify(params);
  const result = await sendFeishuTextMessage(message);
  console.info(
    `${LOG} after-send shop=${params.shop} ok=${result.ok} skipped=${"skipped" in result ? result.skipped : false}`,
  );
}
