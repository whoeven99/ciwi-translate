import {
  json,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import {
  setAutoTranslate,
} from "~/server/translateV4/targetLocale.server";
import {
  getAutoTranslateShopSettings,
  setAutoTranslateShopSettings,
} from "~/server/translateV4/autoTranslateSettings.server";
import { listLanguageStatusFromV4 } from "~/server/translateV4/languageStatus.server";
import {
  buildTranslateV4Error,
  TRANSLATE_V4_ERROR_KEYS,
} from "~/utils/translateV4Errors";

/**
 * GET /api/translate-v4/target-locale —— 列出本店每语言状态 + 整店 auto 设置。
 * 返回形状对齐 Java GetLanguageList：{ success, response, autoSettings }
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  try {
    const [rows, autoSettings] = await Promise.all([
      listLanguageStatusFromV4(session.shop),
      getAutoTranslateShopSettings(session.shop),
    ]);
    return json({
      success: true,
      response: rows,
      autoSettings: {
        hour: autoSettings.hour,
        modules: autoSettings.modules,
      },
    });
  } catch (err) {
    console.error("[target-locale] list failed:", err);
    const appError = buildTranslateV4Error(
      TRANSLATE_V4_ERROR_KEYS.TARGET_LOCALE_LIST_FAILED,
    );
    return json(
      {
        success: false,
        errorCode: appError.errorCode,
        errorMsg: appError.errorMsg,
        response: [],
      },
      { status: appError.status },
    );
  }
};

/**
 * POST /api/translate-v4/target-locale
 * - { intent: "setAuto", locale, autoTranslate }
 * - { intent: "setAutoSettings", hour, modules }
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const body = (await request.json().catch(() => ({}))) as {
    intent?: string;
    locale?: string;
    autoTranslate?: boolean;
    hour?: number;
    modules?: string[];
  };

  try {
    if (body.intent === "setAuto") {
      if (!body.locale) {
        const appError = buildTranslateV4Error(
          TRANSLATE_V4_ERROR_KEYS.TARGET_LOCALE_REQUIRED,
        );
        return json(
          {
            success: false,
            errorCode: appError.errorCode,
            errorMsg: appError.errorMsg,
          },
          { status: appError.status },
        );
      }
      await setAutoTranslate(session.shop, body.locale, Boolean(body.autoTranslate));
      return json({ success: true, response: { locale: body.locale, autoTranslate: !!body.autoTranslate } });
    }

    if (body.intent === "setAutoSettings") {
      try {
        const saved = await setAutoTranslateShopSettings(session.shop, {
          hour: Number(body.hour),
          modules: Array.isArray(body.modules) ? body.modules : [],
        });
        return json({
          success: true,
          response: {
            hour: saved.hour,
            modules: saved.modules,
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg === "INVALID_AUTO_TRANSLATE_HOUR" ||
          msg === "INVALID_AUTO_TRANSLATE_MODULES"
        ) {
          const appError = buildTranslateV4Error(
            TRANSLATE_V4_ERROR_KEYS.TARGET_LOCALE_AUTO_SETTINGS_INVALID,
          );
          return json(
            {
              success: false,
              errorCode: appError.errorCode,
              errorMsg: appError.errorMsg,
            },
            { status: appError.status },
          );
        }
        throw err;
      }
    }

    const appError = buildTranslateV4Error(
      TRANSLATE_V4_ERROR_KEYS.UNKNOWN_ACTION,
    );
    return json(
      {
        success: false,
        errorCode: appError.errorCode,
        errorMsg: appError.errorMsg,
      },
      { status: appError.status },
    );
  } catch (err) {
    console.error("[target-locale] action failed:", err);
    const appError = buildTranslateV4Error(
      TRANSLATE_V4_ERROR_KEYS.TARGET_LOCALE_SAVE_FAILED,
    );
    return json(
      {
        success: false,
        errorCode: appError.errorCode,
        errorMsg: appError.errorMsg,
      },
      { status: appError.status },
    );
  }
};
