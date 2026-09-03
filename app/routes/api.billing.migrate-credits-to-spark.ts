import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { migrateCreditsToSpark } from "~/server/billing/migrateCreditsToSpark.server";

/**
 * POST /api/billing/migrate-credits-to-spark
 * body: { amount?: number, all?: true, transferId?: string }
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (request.method !== "POST") {
    return json({ ok: false, errorCode: "METHOD_NOT_ALLOWED" }, { status: 405 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    amount?: unknown;
    all?: unknown;
    transferId?: unknown;
  };

  const result = await migrateCreditsToSpark({
    shop: session.shop,
    all: body.all === true,
    amount: body.amount,
    transferId: body.transferId,
  });

  const status = result.ok
    ? 200
    : result.errorCode === "FEATURE_DISABLED"
      ? 403
      : 400;
  return json(result, { status });
};
