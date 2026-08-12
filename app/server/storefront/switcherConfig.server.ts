import { ok, fail, type BaseResponse } from "./response.server";
import {
  readSwitcherConfigPayload,
  type WidgetConfigResponse,
} from "./switcherData.server";
import { getOfflineSessionAccessToken } from "~/server/shop/offlineSessionToken.server";
import { resolveShopPrimaryLocale } from "~/server/translateV4/shopLocales.server";

/**
 * 尽力解析店铺主语言（供店面直接跳过主语言页采集）。
 * 走 45s 缓存的 `resolveShopPrimaryLocale`，失败返回 undefined（客户端退回服务端门控）。
 */
async function resolvePrimaryLanguageBestEffort(
  shop: string,
): Promise<string | undefined> {
  try {
    const accessToken = await getOfflineSessionAccessToken(shop);
    if (!accessToken) return undefined;
    const primary = await resolveShopPrimaryLocale({ shop, accessToken });
    return primary ?? undefined;
  } catch (err) {
    console.error(`[switcher] resolve primary language failed shop=${shop}:`, err);
    return undefined;
  }
}

/** Widget 配置读取：全量 v4，从 Prisma 读取。 */
export async function getSwitcherConfig(
  shop: string,
): Promise<BaseResponse<WidgetConfigResponse>> {
  const payload = await readSwitcherConfigPayload(shop);
  if (!payload) {
    return fail(10001, "query error");
  }
  // 自动采集默认开：始终附带主语言，供店面跳过主语言页上报。
  payload.primaryLanguage = await resolvePrimaryLanguageBestEffort(shop);
  return ok(payload);
}
