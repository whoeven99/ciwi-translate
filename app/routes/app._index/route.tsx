import { redirect, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { enqueueShopScan } from "~/server/shopScan/trigger.server";
import { withEmbeddedSearch } from "~/utils/embeddedAction";

/** `/app` 首页统一进入新版 MVP 翻译工作台。 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // 尽早入队 install 计量扫描（幂等）。
  void enqueueShopScan({ shop: session.shop, trigger: "install" }).catch(
    (err) => {
      console.error("[app._index] early install scan enqueue failed:", err);
    },
  );

  return redirect(withEmbeddedSearch("/app/translate-v4-mvp", new URL(request.url).search));
};
