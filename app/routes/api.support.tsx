import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import {
  getConversationForShop,
  appendShopMessage,
  setContactEmailForShop,
} from "~/server/support/supportStore.server";

/** 翻译v4 商家端客服面板：GET 拉会话+消息（轮询），POST 发消息 / 留邮箱。数据读写 TSF 本库。 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const markSeen = new URL(request.url).searchParams.get("markSeen") === "true";
  const conversation = await getConversationForShop(
    session.shop,
    session.email ?? null,
    { markSeen },
  );
  return json({ ok: true, conversation });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const body = (await request.json().catch(() => ({}))) as {
    intent?: string;
    content?: string;
    email?: string;
    locale?: string;
    attachments?: unknown;
  };

  try {
    if (body.intent === "setEmail") {
      await setContactEmailForShop(session.shop, body.email ?? "", session.email ?? null);
      return json({ ok: true });
    }

    if (body.intent === "send") {
      const content = body.content ?? "";
      const attachments = body.attachments;
      const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
      if (!content.trim() && !hasAttachments) {
        return json({ ok: false, error: "消息内容不能为空" }, { status: 400 });
      }
      const message = await appendShopMessage(
        session.shop,
        content,
        session.email ?? null,
        { clientLocale: body.locale, attachments },
      );
      return json({ ok: true, message });
    }

    return json({ ok: false, error: "unsupported intent" }, { status: 400 });
  } catch (error) {
    console.error("[api.support] action failed:", error);
    return json(
      { ok: false, error: error instanceof Error ? error.message : "未知错误" },
      { status: 500 },
    );
  }
};