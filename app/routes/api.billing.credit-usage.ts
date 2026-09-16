import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { listCreditUsage } from "~/server/billing/quota/listCreditUsage.server";

/**
 * GET /api/billing/credit-usage —— 本周期积分使用情况（汇总 + 明细分页）。
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
