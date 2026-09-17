import { redirect, type LoaderFunctionArgs } from "@remix-run/node";
import { sanitizeEmbeddedAppPath } from "~/lib/sanitizeEmbeddedAppPath";

/**
 * Catch leftover `/app/*` paths. Used to recover
 * `/app/manage_translation&icon=data:image...` (no leading `?`) which does not
 * match `app.manage_translation`. `entry.server` is too late — Remix has already
 * matched routes before it runs.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const cleaned = sanitizeEmbeddedAppPath(url.pathname);
  if (cleaned) {
    throw redirect(`${cleaned}${url.search}`);
  }
  throw new Response("Not Found", { status: 404, statusText: "Not Found" });
}

export default function AppSplat() {
  return null;
}
