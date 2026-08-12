/** Switcher 配置字段（不含 shopName），Admin、店面、Prisma 共用。 */
export type SwitcherConfigWriteInput = {
  languageSelector: boolean;
  currencySelector: boolean;
  ipOpen: boolean;
  includedFlag: boolean;
  fontColor: string;
  backgroundColor: string;
  buttonColor: string;
  buttonBackgroundColor: string;
  optionBorderColor: string;
  selectorPosition: string;
  positionData: string;
  isTransparent: boolean;
  autoLiquidCollect: boolean;
};

export type SwitcherEditData = SwitcherConfigWriteInput & {
  shopName: string;
};

/** Admin 页与 getData 失败时的默认配置。 */
export const SWITCHER_UI_DEFAULTS: SwitcherConfigWriteInput = {
  includedFlag: true,
  languageSelector: true,
  currencySelector: true,
  ipOpen: false,
  fontColor: "#303030",
  backgroundColor: "#ffffff",
  buttonColor: "#ffffff",
  buttonBackgroundColor: "#f6f6f7",
  optionBorderColor: "#d4d4d8",
  selectorPosition: "bottom_left",
  positionData: "10",
  isTransparent: false,
  autoLiquidCollect: true,
};

export function buildSwitcherEditDefaults(shop: string): SwitcherEditData {
  return { shopName: shop, ...SWITCHER_UI_DEFAULTS };
}
