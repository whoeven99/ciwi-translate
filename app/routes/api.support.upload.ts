import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import {
  MAX_SUPPORT_IMAGE_BYTES,
  uploadSupportChatImageFile,
} from "~/server/support/supportAttachments.server";

/** POST /api/support/upload — multipart file → COS CDN URL（客服发图，P0 单张）。 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size <= 0) {
      return json({ ok: false, error: "file required" }, { status: 400 });
    }
    if (file.size > MAX_SUPPORT_IMAGE_BYTES) {
      return json({ ok: false, error: "image too large" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const attachment = await uploadSupportChatImageFile({
      shop: session.shop,
      buffer,
      contentType: file.type || "image/jpeg",
      filename: file.name || undefined,
      size: file.size,
    });

    return json({ ok: true, attachment });
  } catch (error) {
    console.error("[api.support.upload] failed:", error);
    const message = error instanceof Error ? error.message : "upload failed";
    const status = message.includes("too large") || message.includes("format") ? 400 : 500;
    return json({ ok: false, error: message }, { status });
  }
};
