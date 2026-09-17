import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { listCreditUsage } from "~/server/billing/quota/listCreditUsage.server";

/**
 * GET /api/billing/credit-usage?take=&cursor= —— 本店积分明细
 * （CreditUsage 消耗 + BillingLog 商户可感知入账）。
 * 返回 { ok, items, nextCursor }；cursor 为 `u:{id}` / `b:{id}`。
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const takeRaw = url.searchParams.get("take");
  const take = takeRaw ? Number(takeRaw) : undefined;
  const cursor = url.searchParams.get("cursor");

  const result = await listCreditUsage({
    shop: session.shop,
    take: Number.isFinite(take) ? take : undefined,
    cursor,
  });

  return json({ ok: true as const, ...result });
};
