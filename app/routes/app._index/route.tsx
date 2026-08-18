import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { withEmbeddedSearch } from "~/utils/embeddedAction";

/** `/app` 首页统一进入新版 MVP 翻译工作台。 */
export const loader = ({ request }: LoaderFunctionArgs) => {
  const search = new URL(request.url).search;
  return redirect(withEmbeddedSearch("/app/translate-v4-mvp", search));
};
