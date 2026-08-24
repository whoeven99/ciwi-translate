import { redirect, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";

/** PageFly 管理页已并入自定义 Liquid；店面旧接口仍保留。 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const url = new URL(request.url);
  const language = url.searchParams.get("language");
  const target = language
    ? `/app/manage_translation/custom_liquid?language=${encodeURIComponent(language)}`
    : "/app/manage_translation/custom_liquid";
  throw redirect(target);
};

export default function PageFlyRedirect() {
  return null;
}
