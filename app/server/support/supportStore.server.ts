import prisma from "../../db.server";
import { sendSupportMessageFeishuNotify } from "../feishu/sendSupportMessageFeishuNotify.server";
import {
  attachmentsFromPayload,
  messagePreviewText,
  normalizeIncomingAttachments,
  serializeSupportMessagePayload,
  type SupportImageAttachment,
} from "./supportAttachments.server";
import {
  getSupportAutoReplyText,
  resolveSupportAutoReplyLocale,
  SUPPORT_OFF_HOURS_AUTO_REPLY_KIND,
} from "./supportAutoReply.server";

/**
 * 翻译 v4 人工客服存储（TSF 自有 Turso）。
 * 自 Spark Test API 迁回本库：商家端直接读写本地 SupportConversation / SupportMessage。
 * 运营端由 Spark Admin「翻译」Tab 直连本库读写（source=translate-v4）。
 */

/** 一条客服消息的对外形状（商家端 / 运营端共用）。 */
export type SupportMessageDTO = {
  id: string;
  sender: string; // "shop" | "ops"
  senderName: string | null;
  content: string;
  attachments: SupportImageAttachment[];
  createdAt: string;
};

export type SupportConversationDTO = {
  id: string;
  status: string;
  contactEmail: string | null;
  shopEmail: string | null;
  unreadForShop: number;
  messages: SupportMessageDTO[];
};

/** 会话来源固定为翻译 v4。 */
const SOURCE = "translate-v4";

const MAX_MESSAGE_LEN = 4000;
const PREVIEW_LEN = 120;

function toMessageDTO(m: {
  id: string;
  sender: string;
  senderName: string | null;
  content: string;
  payloads: string | null;
  createdAt: Date;
}): SupportMessageDTO {
  return {
    id: m.id,
    sender: m.sender,
    senderName: m.senderName,
    content: m.content,
    attachments: attachmentsFromPayload(m.payloads),
    createdAt: m.createdAt.toISOString(),
  };
}

/** 还没有会话时返回的空态（不落库，避免空会话污染运营收件箱）。 */
function emptyConversationDTO(shopEmail: string | null): SupportConversationDTO {
  return {
    id: "",
    status: "open",
    contactEmail: null,
    shopEmail,
    unreadForShop: 0,
    messages: [],
  };
}

/**
 * 读取某店的客服会话（不存在则返回空态，不创建——会话由商家首次发消息/留邮箱时惰性创建）。
 * markSeen=true（商家真正打开面板）时清运营消息未读，并顺带刷新账户邮箱快照。
 */
export async function getConversationForShop(
  shop: string,
  shopEmail: string | null,
  options: { markSeen?: boolean } = {},
): Promise<SupportConversationDTO> {
  let conversation = await prisma.supportConversation.findUnique({
    where: { shop_source: { shop, source: SOURCE } },
  });

  if (!conversation) {
    return emptyConversationDTO(shopEmail);
  }

  // Shopify 账户邮箱可能变化，保持快照最新（卸载兜底用）
  if (shopEmail && conversation.shopEmail !== shopEmail) {
    conversation = await prisma.supportConversation.update({
      where: { shop_source: { shop, source: SOURCE } },
      data: { shopEmail },
    });
  }

  // 仅当商家真正查看面板（markSeen）时才清运营未读；后台拉徽标时不清。
  if (options.markSeen && conversation.unreadForShop > 0) {
    await prisma.supportConversation.update({
      where: { shop_source: { shop, source: SOURCE } },
      data: { unreadForShop: 0 },
    });
    conversation.unreadForShop = 0;
  }

  const messages = await prisma.supportMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "asc" },
  });

  return {
    id: conversation.id,
    status: conversation.status,
    contactEmail: conversation.contactEmail,
    shopEmail: conversation.shopEmail,
    unreadForShop: conversation.unreadForShop,
    messages: messages.map(toMessageDTO),
  };
}

const OFF_HOURS_AUTO_REPLY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

async function hasRecentOffHoursAutoReply(conversationId: string): Promise<boolean> {
  const since = new Date(Date.now() - OFF_HOURS_AUTO_REPLY_COOLDOWN_MS);
  const existing = await prisma.supportMessage.findFirst({
    where: {
      conversationId,
      sender: "ops",
      payloads: { contains: SUPPORT_OFF_HOURS_AUTO_REPLY_KIND },
      createdAt: { gte: since },
    },
    select: { id: true },
  });
  return existing != null;
}

/** 非工作时间自动回复（24 小时内仅一次）。 */
async function appendOffHoursAutoReply(
  conversationId: string,
  shopMessageContent: string,
  clientLocale: string | null | undefined,
): Promise<void> {
  if (await hasRecentOffHoursAutoReply(conversationId)) return;

  const locale = resolveSupportAutoReplyLocale(shopMessageContent, clientLocale);
  const autoContent = getSupportAutoReplyText(locale);

  const autoMessage = await prisma.supportMessage.create({
    data: {
      conversationId,
      sender: "ops",
      senderName: "Support",
      content: autoContent,
      payloads: JSON.stringify({ kind: SUPPORT_OFF_HOURS_AUTO_REPLY_KIND, locale }),
    },
  });

  await prisma.supportConversation.update({
    where: { id: conversationId },
    data: {
      lastMessage: autoContent.slice(0, PREVIEW_LEN),
      lastMessageAt: autoMessage.createdAt,
      unreadForShop: { increment: 1 },
    },
  });
}

/** 商家发送一条消息：追加 + 累计运营未读 + 刷新预览。 */
export async function appendShopMessage(
  shop: string,
  rawContent: string,
  shopEmail: string | null,
  options: {
    clientLocale?: string | null;
    attachments?: unknown;
  } = {},
): Promise<SupportMessageDTO> {
  const content = rawContent.trim().slice(0, MAX_MESSAGE_LEN);
  const attachments = normalizeIncomingAttachments(shop, options.attachments);
  if (!content && attachments.length === 0) {
    throw new Error("消息内容不能为空");
  }

  const conversation = await prisma.supportConversation.upsert({
    where: { shop_source: { shop, source: SOURCE } },
    create: { shop, source: SOURCE, shopEmail: shopEmail || null },
    update: shopEmail ? { shopEmail } : {},
  });

  const preview = messagePreviewText(content, attachments);
  const payloads =
    attachments.length > 0
      ? serializeSupportMessagePayload({ attachments })
      : null;

  const message = await prisma.supportMessage.create({
    data: {
      conversationId: conversation.id,
      sender: "shop",
      content,
      payloads,
    },
  });

  const updated = await prisma.supportConversation.update({
    where: { shop_source: { shop, source: SOURCE } },
    data: {
      lastMessage: preview.slice(0, PREVIEW_LEN),
      lastMessageAt: message.createdAt,
      unreadForOps: { increment: 1 },
      status: "open",
    },
  });

  await appendOffHoursAutoReply(
    conversation.id,
    content || preview,
    options.clientLocale,
  );

  void sendSupportMessageFeishuNotify({
    shop,
    content,
    attachments,
    contactEmail: updated.contactEmail,
    shopEmail: updated.shopEmail,
    unreadForOps: updated.unreadForOps,
    at: message.createdAt,
  }).catch((error) => {
    console.error("[support] feishu notify failed:", error);
  });

  return toMessageDTO(message);
}

/** 商家在聊天框留下/更新联系邮箱。 */
export async function setContactEmailForShop(
  shop: string,
  rawEmail: string,
  shopEmail: string | null,
): Promise<void> {
  const email = rawEmail.trim().slice(0, 320);
  await prisma.supportConversation.upsert({
    where: { shop_source: { shop, source: SOURCE } },
    create: {
      shop,
      source: SOURCE,
      contactEmail: email || null,
      shopEmail: shopEmail || null,
    },
    update: { contactEmail: email || null },
  });
}
