import { redirect } from "@remix-run/node";

import { SHOPIFY_APP_STORE_LISTING_URL } from "~/lib/shopifyAppHandle.server";

export const loader = async () => {
  throw redirect(SHOPIFY_APP_STORE_LISTING_URL);
};

export default function Invite() {
  return null;
}
