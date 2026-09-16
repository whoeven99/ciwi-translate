import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { listCreditUsage } from "~/server/billing/quota/listCreditUsage.server";

/**
 * GET /api/billing/credit-usage —— 历史积分使用情况（不按当前账期切割）。
 * 首屏：消耗汇总/明细分页 + BillingLog 正数入账（已获汇总与明细）。
 * 带 cursor 的 load-more 只翻消耗，已获字段为空。
 * query: cursor? pageSize?（默认 20）
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor")?.trim() || undefined;
  const pageSize = Number(url.searchParams.get("pageSize") ?? "20");

  try {
    const data = await listCreditUsage({
      shop: session.shop,
      cursor,
      pageSize,
    });
    return json({ ok: true as const, ...data });
  } catch (err) {
    console.error("[credit-usage] list failed:", err);
    return json({ ok: false as const }, { status: 500 });
  }
};
