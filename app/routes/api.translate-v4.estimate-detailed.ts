import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import {
  estimateDetailedLiquidShard,
  estimateDetailedModuleShard,
} from "~/server/translateV4/detailedCreditEstimate.server";
import { loadShopLocalesForTranslation } from "~/server/translateV4/shopLocales.server";
import { DEFAULT_AI_MODEL } from "~/routes/app.translate-v4/constants";

/**
 * POST /api/translate-v4/estimate-detailed
 * body: { target, module, isCover, isHandle?, aiModel?, source? }
 *   module = v4 Shopify resource type, or "__liquid__" for PENDING custom liquid
 * 单分片详细预估（App 侧扫 Shopify + TM）；客户端按语言×模块串行调用。
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ ok: false, error: "method not allowed" }, { status: 405 });
  }

  const { admin, session } = await authenticate.admin(request);
  const body = (await request.json().catch(() => ({}))) as {
    target?: unknown;
    targets?: unknown;
    module?: unknown;
    isCover?: unknown;
    isHandle?: unknown;
    aiModel?: unknown;
    source?: unknown;
  };

  const module =
    typeof body.module === "string" ? body.module.trim().toUpperCase() : "";
  const isCover = Boolean(body.isCover);
  const isHandle = Boolean(body.isHandle);
  const aiModel =
    typeof body.aiModel === "string" && body.aiModel.trim()
      ? body.aiModel.trim()
      : DEFAULT_AI_MODEL;

  if (!module) {
    return json({ ok: false, error: "module required" }, { status: 400 });
  }

  try {
    if (module === "__LIQUID__" || module === "__LIQUID") {
      const targets = Array.isArray(body.targets)
        ? body.targets.filter((t): t is string => typeof t === "string")
        : typeof body.target === "string" && body.target.trim()
          ? [body.target.trim()]
          : [];
      if (targets.length === 0) {
        return json({ ok: false, error: "targets required" }, { status: 400 });
      }
      const shard = await estimateDetailedLiquidShard({
        shop: session.shop,
        targets,
      });
      return json({ ok: true, shard });
    }

    const target =
      typeof body.target === "string" ? body.target.trim() : "";
    if (!target) {
      return json({ ok: false, error: "target required" }, { status: 400 });
    }

    let source =
      typeof body.source === "string" ? body.source.trim() : "";
    if (!source) {
      const locales = await loadShopLocalesForTranslation({
        shop: session.shop,
        accessToken: session.accessToken ?? "",
      });
      source = locales.primaryLocale;
    }

    const shard = await estimateDetailedModuleShard({
      admin,
      shop: session.shop,
      source,
      target,
      module,
      isCover,
      isHandle,
      aiModel,
    });
    return json({ ok: true, shard });
  } catch (err) {
    console.error("[translateV4] estimate-detailed failed:", err);
    return json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "estimate-detailed failed",
      },
      { status: 500 },
    );
  }
};
