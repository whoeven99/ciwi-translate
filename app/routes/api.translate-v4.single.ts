import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { evaluateCreateTaskQuotaGuard } from "~/server/billing/quota/createTaskQuotaGuard.server";
import { resolveShopPrimaryLocale } from "~/server/translateV4/shopLocales.server";
import {
  translateSingleText,
  deductQuota,
} from "~/server/translateV4/singleTranslate.server";
import {
  buildTranslateV4Error,
  TRANSLATE_V4_ERROR_KEYS,
} from "~/utils/translateV4Errors";

/**
 * POST /api/translate-v4/single —— 单字段手动翻译（TSF LLM + Java 额度扣减）。
 * 返回对齐页面期望：{ success, response: <译文字符串> }
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const FALLBACK_SOURCE_LOCALE = "en";

  const body = (await request.json().catch(() => ({}))) as {
    source?: string;
    target?: string;
    resourceType?: string;
    context?: string;
    key?: string;
    type?: string;
    resourceId?: string | null;
    customPrompt?: string;
    aiModel?: string;
  };
  const target = (body.target ?? "").trim();
  const text = body.context ?? "";
  let source = body.source?.trim() || "";
  const fieldKey = body.key?.trim() || "value";
  const shopifyType = body.type?.trim() || body.resourceType?.trim();
  // 上限保护：自定义提示词最多 500 字，超出截断，避免撑爆 system prompt。
  const customPrompt = (body.customPrompt ?? "").trim().slice(0, 500);
  const aiModel = body.aiModel?.trim() || "deepseek-v4-flash";
  const requestSummary = {
    shop,
    source,
    target,
    resourceType: body.resourceType?.trim() || null,
    fieldKey,
    shopifyType: shopifyType || null,
    resourceId: body.resourceId ?? null,
    textLength: text.length,
    hasCustomPrompt: customPrompt.length > 0,
    aiModel,
  };

  try {
    if (!source) {
      source =
        (await resolveShopPrimaryLocale({
          shop,
          accessToken: session.accessToken,
        })) ?? "";
    }

    if (!source) {
      source = FALLBACK_SOURCE_LOCALE;
      console.warn("[single] source locale fallback applied", {
        shop,
        fallbackSource: source,
      });
    }

    if (!target) {
      const appError = buildTranslateV4Error(
        TRANSLATE_V4_ERROR_KEYS.SINGLE_TARGET_REQUIRED,
      );
      return json(
        {
          success: false,
          errorCode: appError.errorCode,
          errorMsg: appError.errorMsg,
          response: "",
        },
        { status: appError.status },
      );
    }

    const quotaGuard = await evaluateCreateTaskQuotaGuard(shop);
    if (!quotaGuard.ok) {
      console.warn("[single] quota guard blocked request", {
        ...requestSummary,
        quotaError: quotaGuard.error,
        quotaStatus: quotaGuard.status,
      });
      return json(
        {
          success: false,
          errorCode: 403,
          errorMsg: quotaGuard.error,
          response: "",
        },
        { status: quotaGuard.status },
      );
    }

    let translatedText = "";
    let usedTokens = 0;
    let googleCredits = 0;
    try {
      const result = await translateSingleText({
        shop,
        target,
        text,
        source,
        fieldKey,
        shopifyType,
        aiModel,
        customPrompt,
      });
      translatedText = result.translatedText;
      usedTokens = result.usedTokens;
      googleCredits = result.googleCredits;
    } catch (err) {
      console.error("[single] translate stage failed", requestSummary, err);
      throw err;
    }

    try {
      await deductQuota(
        shop,
        usedTokens,
        {
          target,
          sourceLocale: source,
          fieldKey,
          shopifyType,
          textLength: text.length,
        },
        aiModel,
        googleCredits,
      );
    } catch (err) {
      console.error(
        "[single] quota deduction failed",
        { ...requestSummary, usedTokens },
        err,
      );
      throw err;
    }

    return json({ success: true, response: translatedText });
  } catch (err) {
    console.error(`[single] ${shop} failed`, requestSummary, err);
    const appError = buildTranslateV4Error(
      TRANSLATE_V4_ERROR_KEYS.SINGLE_TRANSLATE_FAILED,
    );
    return json(
      {
        success: false,
        errorCode: appError.errorCode,
        errorMsg: appError.errorMsg,
        response: "",
      },
      { status: appError.status },
    );
  }
};
