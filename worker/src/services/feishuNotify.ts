/**
 * Worker 侧飞书纯文本通知（客服/运营群）。
 * 对齐 App `sendFeishuTextMessage`：FEISHU_ENABLED + FEISHU_WEBHOOK_URL_SUPPORT。
 * best-effort：失败只打日志，不抛给调用方。
 */

const LOG = "[feishu]";
const SUPPORT_WEBHOOK_ENV = "FEISHU_WEBHOOK_URL_SUPPORT";

export type SendFeishuResult =
  | { ok: true }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; reason: string };

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value.trim() === "") return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return defaultValue;
}

function isFeishuEnabled(): boolean {
  return parseBoolean(process.env.FEISHU_ENABLED, true);
}

function resolveSupportFeishuWebhookUrl(): string | null {
  const url = process.env[SUPPORT_WEBHOOK_ENV]?.trim();
  return url && url.length > 0 ? url : null;
}

/** 向客服飞书群机器人发送纯文本；未配置或关闭时 skipped。 */
export async function sendFeishuTextMessage(
  message: string,
): Promise<SendFeishuResult> {
  try {
    if (!isFeishuEnabled()) {
      console.info(`${LOG} skipped reason=disabled`);
      return { ok: false, skipped: true, reason: "disabled" };
    }

    const webhookUrl = resolveSupportFeishuWebhookUrl();
    if (!webhookUrl) {
      console.info(`${LOG} skipped reason=no_webhook_url`);
      return { ok: false, skipped: true, reason: "no_webhook_url" };
    }

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        msg_type: "text",
        content: { text: message.slice(0, 3900) },
      }),
    });

    const text = await res.text();
    let body: { code?: number; msg?: string; raw?: string };
    try {
      body = JSON.parse(text) as { code?: number; msg?: string };
    } catch {
      body = { raw: text.slice(0, 200) };
    }

    if (!res.ok || (body.code !== undefined && body.code !== 0)) {
      console.error(
        `${LOG} failed httpStatus=${res.status} body=${JSON.stringify(body).slice(0, 400)}`,
      );
      return { ok: false, reason: "webhook_error" };
    }

    console.info(`${LOG} success`);
    return { ok: true };
  } catch (error) {
    console.error(`${LOG} failed`, error);
    return { ok: false, reason: "exception" };
  }
}
