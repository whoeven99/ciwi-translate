import {
  readSwitcherConfigPayload,
  upsertSwitcherConfig,
} from "./switcherData.server";
import {
  SWITCHER_UI_DEFAULTS,
  type SwitcherConfigWriteInput,
} from "~/lib/switcherConstants";

type SwitcherAdminConfig = SwitcherConfigWriteInput & {
  shopName: string;
};

function toAdminConfig(shop: string, input: SwitcherConfigWriteInput): SwitcherAdminConfig {
  return { shopName: shop, ...input };
}

/** 灰度店 Admin 读：有 Turso 行则返回，否则返回默认配置。 */
export async function getSwitcherConfigForAdmin(shop: string): Promise<SwitcherAdminConfig> {
  const payload = await readSwitcherConfigPayload(shop);
  if (!payload) {
    return toAdminConfig(shop, SWITCHER_UI_DEFAULTS);
  }

  const {
    shopName,
    languageSelector,
    currencySelector,
    ipOpen,
    includedFlag,
    fontColor,
    backgroundColor,
    buttonColor,
    buttonBackgroundColor,
    optionBorderColor,
    selectorPosition,
    positionData,
    isTransparent,
    autoLiquidCollect,
  } = payload;

  return {
    shopName: shopName || shop,
    languageSelector,
    currencySelector,
    ipOpen,
    includedFlag,
    fontColor,
    backgroundColor,
    buttonColor,
    buttonBackgroundColor,
    optionBorderColor,
    selectorPosition,
    positionData,
    isTransparent,
    autoLiquidCollect,
  };
}

/** 灰度店 Admin 写：upsert Turso 并返回与 Java save 一致的 response 字段。 */
export async function saveSwitcherConfigForAdmin(
  shop: string,
  input: Partial<SwitcherConfigWriteInput>,
): Promise<SwitcherAdminConfig> {
  const payload = await upsertSwitcherConfig(shop, input);
  return toAdminConfig(shop, {
    languageSelector: payload.languageSelector,
    currencySelector: payload.currencySelector,
    ipOpen: payload.ipOpen,
    includedFlag: payload.includedFlag,
    fontColor: payload.fontColor,
    backgroundColor: payload.backgroundColor,
    buttonColor: payload.buttonColor,
    buttonBackgroundColor: payload.buttonBackgroundColor,
    optionBorderColor: payload.optionBorderColor,
    selectorPosition: payload.selectorPosition,
    positionData: payload.positionData,
    isTransparent: payload.isTransparent,
    autoLiquidCollect: payload.autoLiquidCollect,
  });
}
