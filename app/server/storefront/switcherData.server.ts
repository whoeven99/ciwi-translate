import prisma from "~/db.server";
import {
  SWITCHER_UI_DEFAULTS,
  type SwitcherConfigWriteInput,
} from "~/lib/switcherConstants";
import { invalidateStorefrontCache } from "./cache.server";

export type WidgetConfigResponse = {
  shopName: string;
  languageSelector: boolean;
  currencySelector: boolean;
  ipOpen: boolean;
  browserLanguageOpen: boolean;
  marketCurrencyOpen: boolean;
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
  /** 店铺主语言 iso code（storefront 用于在店面直接跳过主语言页采集）。 */
  primaryLanguage?: string;
};

function str(value: unknown, fallback: string): string {
  return value == null ? fallback : String(value);
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeWriteInput(
  input: Partial<SwitcherConfigWriteInput>,
): SwitcherConfigWriteInput {
  return {
    languageSelector: bool(input.languageSelector, SWITCHER_UI_DEFAULTS.languageSelector),
    currencySelector: bool(input.currencySelector, SWITCHER_UI_DEFAULTS.currencySelector),
    ipOpen: bool(input.ipOpen, SWITCHER_UI_DEFAULTS.ipOpen),
    browserLanguageOpen: bool(
      input.browserLanguageOpen,
      SWITCHER_UI_DEFAULTS.browserLanguageOpen,
    ),
    marketCurrencyOpen: bool(
      input.marketCurrencyOpen,
      SWITCHER_UI_DEFAULTS.marketCurrencyOpen,
    ),
    includedFlag: bool(input.includedFlag, SWITCHER_UI_DEFAULTS.includedFlag),
    fontColor: str(input.fontColor, SWITCHER_UI_DEFAULTS.fontColor),
    backgroundColor: str(input.backgroundColor, SWITCHER_UI_DEFAULTS.backgroundColor),
    buttonColor: str(input.buttonColor, SWITCHER_UI_DEFAULTS.buttonColor),
    buttonBackgroundColor: str(
      input.buttonBackgroundColor,
      SWITCHER_UI_DEFAULTS.buttonBackgroundColor,
    ),
    optionBorderColor: str(input.optionBorderColor, SWITCHER_UI_DEFAULTS.optionBorderColor),
    selectorPosition: str(input.selectorPosition, SWITCHER_UI_DEFAULTS.selectorPosition),
    positionData: str(input.positionData, SWITCHER_UI_DEFAULTS.positionData),
    isTransparent: bool(input.isTransparent, SWITCHER_UI_DEFAULTS.isTransparent),
    // 产品默认开、无商户开关：保存时始终落 true（忽略客户端传入）。
    autoLiquidCollect: true,
  };
}

function toWidgetConfigResponse(
  shop: string,
  config: {
    languageSelector: boolean;
    currencySelector: boolean;
    ipOpen: boolean;
    browserLanguageOpen: boolean;
    marketCurrencyOpen: boolean;
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
  },
): WidgetConfigResponse {
  return {
    shopName: shop,
    languageSelector: config.languageSelector,
    currencySelector: config.currencySelector,
    ipOpen: config.ipOpen,
    browserLanguageOpen: config.browserLanguageOpen,
    marketCurrencyOpen: config.marketCurrencyOpen,
    includedFlag: config.includedFlag,
    fontColor: config.fontColor,
    backgroundColor: config.backgroundColor,
    buttonColor: config.buttonColor,
    buttonBackgroundColor: config.buttonBackgroundColor,
    optionBorderColor: config.optionBorderColor,
    selectorPosition: config.selectorPosition,
    positionData: config.positionData,
    isTransparent: config.isTransparent,
    autoLiquidCollect: config.autoLiquidCollect,
  };
}

/** 从 Prisma 读取完整 Widget 配置；无记录时返回 null。 */
export async function readSwitcherConfigPayload(
  shop: string,
): Promise<WidgetConfigResponse | null> {
  const config = await prisma.switcherConfiguration.findUnique({
    where: { shop },
  });
  if (!config) return null;

  return toWidgetConfigResponse(shop, config);
}

/** 写入 Prisma SwitcherConfiguration 并返回完整 payload。 */
export async function upsertSwitcherConfig(
  shop: string,
  input: Partial<SwitcherConfigWriteInput>,
): Promise<WidgetConfigResponse> {
  const data = normalizeWriteInput(input);
  const now = new Date();

  const config = await prisma.switcherConfiguration.upsert({
    where: { shop },
    create: { shop, ...data, createdAt: now, updatedAt: now },
    update: { ...data, updatedAt: now },
  });

  await invalidateStorefrontCache("switcher", shop);
  return toWidgetConfigResponse(shop, config);
}
