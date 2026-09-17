import {
  json,
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import {
  markOnboardingCompleted,
  markOnboardingSkipped,
  markOnboardingTrialStarted,
} from "~/server/onboarding/onboarding.server";
import { enqueueShopScan } from "~/server/shopScan/trigger.server";
import { withEmbeddedSearch } from "~/utils/embeddedAction";

/**
 * GET /app/onboarding —— 首次翻译新手引导（暂时关闭，重定向到翻译首页）。
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  void enqueueShopScan({ shop: session.shop, trigger: "install" }).catch(
    (err) => {
      console.error("[onboarding] install scan enqueue failed:", err);
    },
  );

  throw redirect(withEmbeddedSearch("/app", new URL(request.url).search));
};

type OnboardingIntent = "skip" | "complete" | "trial";

/**
 * POST /app/onboarding —— 引导状态流转（只写状态并返回 json，客户端负责跳转，
 * 避免嵌入式 App 内的服务端重定向问题）。
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "") as OnboardingIntent;

  switch (intent) {
    case "skip":
      await markOnboardingSkipped(shop);
      return json({ ok: true, intent });
    case "complete":
      await markOnboardingCompleted(shop, { createdFirstTask: true });
      return json({ ok: true, intent });
    case "trial":
      await markOnboardingTrialStarted(shop);
      return json({ ok: true, intent });
    default:
      return json({ ok: false, error: "unknown intent" }, { status: 400 });
  }
};

export default function OnboardingRoute() {
  return null;
}
