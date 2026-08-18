import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { enqueueShopScan } from "~/server/shopScan/trigger.server";
import { loader as translateV4Loader } from "../app.translate-v4/route";

// `/app` 直接渲染翻译页，不再 302 到 `/app/translate-v4`：那一跳会把 app.tsx 的
// loader 完整跑一遍（鉴权 + Shopify 语言查询）再把结果丢弃，纯浪费一个文档往返。
// `/app/translate-v4` 保留为别名。
// 新手引导已暂时关闭；新安装用户直接进入翻译首页。
export { default } from "../app.translate-v4/route";

export const loader = async (args: LoaderFunctionArgs) => {
  const { request } = args;
  const { session } = await authenticate.admin(request);

  // 尽早入队 install 计量扫描（幂等）。
  void enqueueShopScan({ shop: session.shop, trigger: "install" }).catch(
    (err) => {
      console.error("[app._index] early install scan enqueue failed:", err);
    },
  );

  return translateV4Loader(args);
};
