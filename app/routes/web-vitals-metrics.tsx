import { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";

/**
 * 兼容保留。现行上报路径是 `/log`（`app/utils/lcpDiagnostics.ts` 用 sendBeacon 发送
 * `shopify_web_vitals` 与 `lcp_diagnostics`）：这里要过 `authenticate.admin`，用
 * fetcher.submit 提交还会触发 Remix 全量 loader revalidate。
 */

export const action = async ({ request }: ActionFunctionArgs) => {
  const adminAuthResult = await authenticate.admin(request);
  const { shop } = adminAuthResult.session;
  const formData = await request.formData();
  const metrics = JSON.parse(formData.get("metrics") as string);
  //   const metrics = await request.json();
  const LCPdata = metrics?.metrics?.find((item: any) => item?.name == "LCP");
  console.log("LCPdata: ", LCPdata);

  if (LCPdata) console.log(`${shop} received LCP:`, LCPdata?.value);
  return {
    body: "Metrics received",
  };
};
