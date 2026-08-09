import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { withEmbeddedSearch } from "~/utils/embeddedAction";
import { shouldRedirectToOnboarding } from "~/server/onboarding/onboarding.server";
import { enqueueShopScan } from "~/server/shopScan/trigger.server";
import { loader as translateV4Loader } from "../app.translate-v4/route";

// `/app` 直接渲染翻译页，不再 302 到 `/app/translate-v4`：那一跳会把 app.tsx 的
// loader 完整跑一遍（鉴权 + Shopify 语言查询）再把结果丢弃，纯浪费一个文档往返。
// `/app/translate-v4` 保留为别名。引导流程的跳转仍指向别名而不是 `/app`，因为
// OnboardingFlow 的 markOnboarding* 是 fetcher.submit（不 await）后立即 navigate，
// 走带引导判断的 `/app` 会在写入落库前被判回引导页。
export { default } from "../app.translate-v4/route";

export const loader = async (args: LoaderFunctionArgs) => {
  const { request } = args;
  const { session } = await authenticate.admin(request);
  const search = new URL(request.url).search;

  // 尽早入队 install 计量扫描（幂等），让 Worker 在引导页之前就开始跑。
  void enqueueShopScan({ shop: session.shop, trigger: "install" }).catch(
    (err) => {
      console.error("[app._index] early install scan enqueue failed:", err);
    },
  );

  // 引导判断与翻译页数据并行：老店的判断只是一次 Turso 主键查询，不该串进关键路径。
  // 需要引导的新店会白跑一次翻译页 loader，但每店只发生一次。
  const [toOnboarding, data] = await Promise.all([
    // 决策失败一律降级为默认流程，避免阻断入口。
    shouldRedirectToOnboarding(session.shop).catch((err) => {
      console.error("[app._index] onboarding gate failed:", err);
      return false;
    }),
    translateV4Loader(args),
  ]);

  if (toOnboarding) {
    throw redirect(withEmbeddedSearch("/app/onboarding", search));
  }

  return data;
};
