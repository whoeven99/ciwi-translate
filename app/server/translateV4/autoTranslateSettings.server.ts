import prisma from "~/db.server";
import { shopSlotIndex } from "./autoScanSchedule.server";
import {
  AUTO_TRANSLATE_V2_MODULE_KEYS,
  isValidAutoTranslateHour,
  normalizeAutoTranslateV2Modules,
  type TranslateV2ModuleKey,
} from "./moduleCatalog";
import { ensureShopV4Settings } from "./migration.server";
import {
  clampAutoTranslateIntervalHours,
  defaultAutoTranslateIntervalHours,
  filterV2ModulesForPlan,
  resolveShopPlanEntitlements,
  type AutoTranslateIntervalHours,
  type PlanEntitlements,
} from "~/server/billing/planEntitlements.server";

export type AutoTranslateShopSettings = {
  /** 0–23（展示/保存用；DB null 时回退为 hash 槽位） */
  hour: number;
  /** 商户所选间隔（已按套餐钳制） */
  intervalHours: AutoTranslateIntervalHours;
  /** 套餐允许的间隔选项 */
  allowedIntervalHours: readonly AutoTranslateIntervalHours[];
  /** 已解析的 v2 keys；DB null 时回退默认 auto 集 */
  modules: TranslateV2ModuleKey[];
  hourPersisted: boolean;
  intervalPersisted: boolean;
  modulesPersisted: boolean;
};

function parseStoredModules(raw: unknown): TranslateV2ModuleKey[] | null {
  return normalizeAutoTranslateV2Modules(raw);
}

function resolveModules(
  stored: TranslateV2ModuleKey[] | null,
  entitlements: PlanEntitlements,
): TranslateV2ModuleKey[] {
  const base = stored ?? [...AUTO_TRANSLATE_V2_MODULE_KEYS];
  let modules = filterV2ModulesForPlan(
    base,
    entitlements,
  ) as TranslateV2ModuleKey[];
  if (modules.length === 0) {
    modules = filterV2ModulesForPlan(
      AUTO_TRANSLATE_V2_MODULE_KEYS,
      entitlements,
    ) as TranslateV2ModuleKey[];
  }
  return modules;
}

/** 读取整店自动更新设置；null 字段按存量行为解析默认值（不写库）。 */
export async function getAutoTranslateShopSettings(
  shop: string,
): Promise<AutoTranslateShopSettings> {
  const [row, entitlements] = await Promise.all([
    prisma.shopTranslationSettings.findUnique({
      where: { shop },
      select: {
        autoTranslateHour: true,
        autoTranslateIntervalHours: true,
        autoTranslateModules: true,
      },
    }),
    resolveShopPlanEntitlements(shop),
  ]);

  const storedModules = parseStoredModules(row?.autoTranslateModules);
  const hourPersisted = isValidAutoTranslateHour(row?.autoTranslateHour);
  const intervalPersisted =
    row?.autoTranslateIntervalHours != null &&
    Number.isInteger(row.autoTranslateIntervalHours);
  const modulesPersisted = Boolean(storedModules);

  return {
    hour: hourPersisted
      ? (row!.autoTranslateHour as number)
      : shopSlotIndex(shop),
    intervalHours: clampAutoTranslateIntervalHours(
      intervalPersisted
        ? row!.autoTranslateIntervalHours
        : defaultAutoTranslateIntervalHours(entitlements),
      entitlements,
    ),
    allowedIntervalHours: entitlements.allowedAutoTranslateIntervalHours,
    modules: resolveModules(storedModules, entitlements),
    hourPersisted,
    intervalPersisted,
    modulesPersisted,
  };
}

export type SetAutoTranslateShopSettingsInput = {
  hour: number;
  intervalHours: number;
  modules: string[];
};

/**
 * 保存整店自动更新：对齐时刻 + 间隔 + 模块。
 */
export async function setAutoTranslateShopSettings(
  shop: string,
  input: SetAutoTranslateShopSettingsInput,
): Promise<AutoTranslateShopSettings> {
  if (!isValidAutoTranslateHour(input.hour)) {
    throw new Error("INVALID_AUTO_TRANSLATE_HOUR");
  }
  const entitlements = await resolveShopPlanEntitlements(shop);
  const intervalHours = clampAutoTranslateIntervalHours(
    input.intervalHours,
    entitlements,
  );
  const normalized = normalizeAutoTranslateV2Modules(input.modules);
  if (!normalized) {
    throw new Error("INVALID_AUTO_TRANSLATE_MODULES");
  }
  const modules = filterV2ModulesForPlan(
    normalized,
    entitlements,
  ) as TranslateV2ModuleKey[];
  if (modules.length === 0) {
    throw new Error("INVALID_AUTO_TRANSLATE_MODULES");
  }

  await ensureShopV4Settings(shop);
  await prisma.shopTranslationSettings.update({
    where: { shop },
    data: {
      autoTranslateHour: input.hour,
      autoTranslateIntervalHours: intervalHours,
      autoTranslateModules: modules,
    },
  });

  return {
    hour: input.hour,
    intervalHours,
    allowedIntervalHours: entitlements.allowedAutoTranslateIntervalHours,
    modules,
    hourPersisted: true,
    intervalPersisted: true,
    modulesPersisted: true,
  };
}
