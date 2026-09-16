import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { listCreditUsage } from "~/server/billing/quota/listCreditUsage.server";

/**
 * GET /api/billing/credit-usage?take=&cursor= —— 本店 CreditUsage 消费列表。
 * 返回 { ok, items, nextCursor }。
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
