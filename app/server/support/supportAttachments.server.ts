import {
  PICTURE_CDN_URL,
  PICTURE_COS_URL,
  uploadSupportChatImage,
} from "../picture/cos.server";

export type SupportImageAttachment = {
  type: "image";
  url: string;
  mime: string;
  size: number;
  name?: string;
};

export type SupportMessagePayload = {
  kind?: string;
  locale?: string;
  attachments?: SupportImageAttachment[];
};

export const MAX_SUPPORT_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_SUPPORT_ATTACHMENTS = 1;
export const SUPPORT_IMAGE_PREVIEW_LABEL = "[Image]";

export function parseSupportMessagePayload(
  raw: string | null | undefined,
): SupportMessagePayload | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as SupportMessagePayload;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function serializeSupportMessagePayload(payload: SupportMessagePayload): string {
  return JSON.stringify(payload);
}

export function attachmentsFromPayload(
  raw: string | null | undefined,
): SupportImageAttachment[] {
  const payload = parseSupportMessagePayload(raw);
  if (!payload?.attachments?.length) return [];
  return payload.attachments.filter(
    (item): item is SupportImageAttachment =>
      item?.type === "image" && typeof item.url === "string" && item.url.length > 0,
  );
}

export function isSupportChatImageUrlForShop(shop: string, url: string): boolean {
  try {
    const parsed = new URL(url);
    const allowedHosts = new Set([
      new URL(PICTURE_COS_URL).host,
      new URL(PICTURE_CDN_URL).host,
    ]);
    if (!allowedHosts.has(parsed.host)) return false;
    return parsed.pathname.includes(`/support-chat/${shop}/`);
  } catch {
    return false;
  }
}

export function normalizeIncomingAttachments(
  shop: string,
  raw: unknown,
): SupportImageAttachment[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  if (raw.length > MAX_SUPPORT_ATTACHMENTS) {
    throw new Error("Too many attachments");
  }

  const normalized: SupportImageAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (record.type !== "image") continue;
    const url = typeof record.url === "string" ? record.url.trim() : "";
    const mime = typeof record.mime === "string" ? record.mime.trim() : "";
    const size = typeof record.size === "number" ? record.size : 0;
    const name = typeof record.name === "string" ? record.name.trim().slice(0, 200) : undefined;
    if (!url || !mime || !isSupportChatImageUrlForShop(shop, url)) {
      throw new Error("Invalid attachment");
    }
    normalized.push({ type: "image", url, mime, size, ...(name ? { name } : {}) });
  }
  return normalized;
}

export function messagePreviewText(
  content: string,
  attachments: SupportImageAttachment[],
): string {
  const text = content.trim();
  if (text && attachments.length > 0) {
    return `${text.slice(0, PREVIEW_TEXT_MAX)} [Image]`.slice(0, PREVIEW_TEXT_MAX);
  }
  if (text) return text.slice(0, PREVIEW_TEXT_MAX);
  if (attachments.length > 0) return SUPPORT_IMAGE_PREVIEW_LABEL;
  return "";
}

const PREVIEW_TEXT_MAX = 120;

export async function uploadSupportChatImageFile(args: {
  shop: string;
  buffer: Buffer;
  contentType: string;
  filename?: string;
  size: number;
}): Promise<SupportImageAttachment> {
  if (args.size <= 0 || args.size > MAX_SUPPORT_IMAGE_BYTES) {
    throw new Error("Image too large");
  }
  const url = await uploadSupportChatImage({
    shop: args.shop,
    buffer: args.buffer,
    contentType: args.contentType,
    filename: args.filename,
  });
  return {
    type: "image",
    url,
    mime: args.contentType,
    size: args.size,
    ...(args.filename ? { name: args.filename.slice(0, 200) } : {}),
  };
}
