import prisma from "~/db.server";
import { shopSlotIndex } from "./autoScanSchedule.server";
import {
  AUTO_TRANSLATE_V2_MODULE_KEYS,
  isValidAutoTranslateHour,
  normalizeAutoTranslateV2Modules,
  type TranslateV2ModuleKey,
} from "./moduleCatalog";
import { ensureShopV4Settings } from "./migration.server";

export type AutoTranslateShopSettings = {
  /** 0–23（展示/保存用；DB null 时回退为 hash 槽位） */
  hour: number;
  /** 已解析的 v2 keys；DB null 时回退默认 auto 集 */
  modules: TranslateV2ModuleKey[];
  /** DB 是否已持久化 hour */
  hourPersisted: boolean;
  /** DB 是否已持久化 modules */
  modulesPersisted: boolean;
};

function parseStoredModules(raw: unknown): TranslateV2ModuleKey[] | null {
  return normalizeAutoTranslateV2Modules(raw);
}

/** 读取整店自动更新设置；null 字段按存量行为解析默认值（不写库）。 */
export async function getAutoTranslateShopSettings(
  shop: string,
): Promise<AutoTranslateShopSettings> {
  const row = await prisma.shopTranslationSettings.findUnique({
    where: { shop },
    select: {
      autoTranslateHour: true,
      autoTranslateModules: true,
    },
  });

  const storedModules = parseStoredModules(row?.autoTranslateModules);
  const hourPersisted = isValidAutoTranslateHour(row?.autoTranslateHour);
  const modulesPersisted = Boolean(storedModules);

  return {
    hour: hourPersisted
      ? (row!.autoTranslateHour as number)
      : shopSlotIndex(shop),
    modules: storedModules ?? [...AUTO_TRANSLATE_V2_MODULE_KEYS],
    hourPersisted,
    modulesPersisted,
  };
}

export type SetAutoTranslateShopSettingsInput = {
  hour: number;
  modules: string[];
};

/**
 * 保存整店自动更新小时 + 模块。
 * 校验：hour 0..23；modules ⊆ auto 可选集且至少 1 个。
 */
export async function setAutoTranslateShopSettings(
  shop: string,
  input: SetAutoTranslateShopSettingsInput,
): Promise<AutoTranslateShopSettings> {
  if (!isValidAutoTranslateHour(input.hour)) {
    throw new Error("INVALID_AUTO_TRANSLATE_HOUR");
  }
  const modules = normalizeAutoTranslateV2Modules(input.modules);
  if (!modules) {
    throw new Error("INVALID_AUTO_TRANSLATE_MODULES");
  }

  await ensureShopV4Settings(shop);
  await prisma.shopTranslationSettings.update({
    where: { shop },
    data: {
      autoTranslateHour: input.hour,
      autoTranslateModules: modules,
    },
  });

  return {
    hour: input.hour,
    modules,
    hourPersisted: true,
    modulesPersisted: true,
  };
}
