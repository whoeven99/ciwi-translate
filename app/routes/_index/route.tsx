import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import { SHOPIFY_APP_STORE_LISTING_URL } from "~/lib/shopifyAppHandle.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  throw redirect(SHOPIFY_APP_STORE_LISTING_URL);
};

export default function Index() {
  return null;
}
