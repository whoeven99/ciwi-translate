import {
  json,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import {
  listLiquidPage,
  createLiquidDo,
  updateLiquidDo,
  deleteLiquidDo,
  toggleLiquidReplacementMethod,
} from "~/server/translateV4/liquidRule.server";
import {
  buildTranslateV4Error,
  TRANSLATE_V4_ERROR_KEYS,
} from "~/utils/translateV4Errors";

function ok(response: unknown) {
  return json({ success: true, errorCode: null, errorMsg: null, response });
}
function fail(errorKey: keyof typeof TRANSLATE_V4_ERROR_KEYS) {
  const error = buildTranslateV4Error(TRANSLATE_V4_ERROR_KEYS[errorKey]);
  return json(
    {
      success: false,
      errorCode: error.errorCode,
      errorMsg: error.errorMsg,
      response: null,
    },
    { status: error.status },
  );
}

function resolveListLanguage(
  languageCode?: string | null,
  language?: string | null,
): string {
  return (languageCode || language || "").trim();
}

async function listLiquidJson(
  shop: string,
  languageCode: string,
  q: string,
  page: number,
  pageSize: number,
) {
  if (!languageCode) {
    return ok({ rows: [], hasNext: false });
  }
  return ok(
    await listLiquidPage({
      shop,
      languageCode,
      q,
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : 10,
    }),
  );
}

/** GET 兼容：认 languageCode 或页面同名 language；缺语言返回空列表，不 400。 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const languageCode = resolveListLanguage(
    url.searchParams.get("languageCode"),
    url.searchParams.get("language"),
  );
  const q = url.searchParams.get("q") ?? "";
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = Number(url.searchParams.get("pageSize") ?? "10");
  try {
    return await listLiquidJson(
      session.shop,
      languageCode,
      q,
      page,
      pageSize,
    );
  } catch (err) {
    console.error("[liquid] list failed:", err);
    return fail("LIQUID_LIST_FAILED");
  }
};

/**
 * POST /api/translate-v4/liquid —— Liquid 列表 / 增删改。
 * body: { intent: "list"|"insert"|"update"|"delete"|"toggleReplacementMethod", ... }
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const body = (await request.json().catch(() => ({}))) as {
    intent?: string;
    id?: string;
    ids?: string[];
    sourceText?: string;
    targetText?: string;
    languageCode?: string;
    language?: string;
    q?: string;
    page?: number;
    pageSize?: number;
    replacementMethod?: boolean;
  };

  try {
    switch (body.intent) {
      case "list": {
        const languageCode = resolveListLanguage(
          body.languageCode,
          body.language,
        );
        return await listLiquidJson(
          shop,
          languageCode,
          body.q ?? "",
          Number(body.page ?? 1),
          Number(body.pageSize ?? 10),
        );
      }
      case "insert": {
        if (!body.sourceText || !body.targetText || !body.languageCode) {
          return fail("LIQUID_REQUIRED_FIELDS");
        }
        const row = await createLiquidDo(shop, {
          sourceText: body.sourceText,
          targetText: body.targetText,
          languageCode: body.languageCode,
          replacementMethod: body.replacementMethod,
        });
        if (row === "duplicate") {
          return fail("LIQUID_DUPLICATE_RULE");
        }
        return ok(row);
      }
      case "update": {
        if (!body.id) return fail("LIQUID_ID_REQUIRED");
        if (!body.sourceText || !body.targetText || !body.languageCode) {
          return fail("LIQUID_REQUIRED_FIELDS");
        }
        const row = await updateLiquidDo(shop, body.id, {
          sourceText: body.sourceText,
          targetText: body.targetText,
          languageCode: body.languageCode,
          replacementMethod: body.replacementMethod,
        });
        if (row === "duplicate") {
          return fail("LIQUID_DUPLICATE_RULE");
        }
        if (!row) return fail("LIQUID_NOT_FOUND");
        return ok(row);
      }
      case "delete": {
        const ids = (body.ids ?? []).filter((x) => typeof x === "string" && x);
        if (!ids.length) return fail("INVALID_REQUEST");
        const deleted = await deleteLiquidDo(shop, ids);
        if (!deleted.length) return fail("LIQUID_NOT_FOUND");
        return ok(deleted);
      }
      case "toggleReplacementMethod": {
        if (!body.id) return fail("LIQUID_ID_REQUIRED");
        const next = await toggleLiquidReplacementMethod(shop, body.id);
        if (next == null) return fail("LIQUID_NOT_FOUND");
        return ok(next);
      }
      default:
        return fail("UNKNOWN_ACTION");
    }
  } catch (err) {
    console.error("[liquid] action failed:", err);
    return fail("LIQUID_SAVE_FAILED");
  }
};
