import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { estimateCreateTaskCredits } from "~/server/translateV4/creditEstimate.server";

/**
 * POST /api/translate-v4/estimate
 * body: { modules, targets, isCover, untranslatedRatioByLocale? }
 * 展示用上限粗估，不替代 create-task quota guard。
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ ok: false, error: "method not allowed" }, { status: 405 });
  }

  const { session } = await authenticate.admin(request);
  const body = (await request.json().catch(() => ({}))) as {
    modules?: unknown;
    targets?: unknown;
    isCover?: unknown;
    includeLiquid?: unknown;
    untranslatedRatioByLocale?: unknown;
  };

  const modules = Array.isArray(body.modules)
    ? body.modules.filter((m): m is string => typeof m === "string")
    : [];
  const targets = Array.isArray(body.targets)
    ? body.targets.filter((t): t is string => typeof t === "string")
    : [];
  const isCover = Boolean(body.isCover);
  const includeLiquid = Boolean(body.includeLiquid);

  let untranslatedRatioByLocale: Record<string, number | null> | undefined;
  if (
    body.untranslatedRatioByLocale &&
    typeof body.untranslatedRatioByLocale === "object" &&
    !Array.isArray(body.untranslatedRatioByLocale)
  ) {
    untranslatedRatioByLocale = {};
    for (const [locale, ratio] of Object.entries(
      body.untranslatedRatioByLocale as Record<string, unknown>,
    )) {
      if (typeof ratio === "number" && Number.isFinite(ratio)) {
        untranslatedRatioByLocale[locale] = ratio;
      } else if (ratio === null) {
        untranslatedRatioByLocale[locale] = null;
      }
    }
  }

  try {
    const estimate = await estimateCreateTaskCredits({
      shop: session.shop,
      v2ModuleKeys: modules,
      targets,
      isCover,
      includeLiquid,
      untranslatedRatioByLocale,
    });
    return json({ ok: true, estimate });
  } catch (err) {
    console.error("[translateV4] estimate failed:", err);
    return json({ ok: false, error: "estimate failed" }, { status: 500 });
  }
};
