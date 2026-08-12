/**
 * 创建任务展示用额度粗估（上限口径）。
 * 公式：credits ≈ ceil(chars × k) × 语言数；默认 k=1.6（历史手动任务约 80% 覆盖）。
 * 与 worker 实扣（LLM token × QUOTA_TOKEN_MULTIPLIER）不是同一公式。
 */
import { getLatestShopScanJob } from "~/server/shopScan/cosmos.server";
import { getShopCreditQuota } from "~/server/billing/quota/quotaRouter.server";
import { expandV2ModuleKeys } from "./moduleCatalog";
import { sumPendingLiquidChars } from "./liquidRule.server";

/** 历史上限系数：credits ≈ ceil(sourceChars × k)。 */
const ESTIMATE_CREDITS_PER_CHAR = Number(
  process.env.TRANSLATE_ESTIMATE_CREDITS_PER_CHAR?.trim() || "1.6",
);

/** 无 scan 时：每个 v2 模块粗估字符（偏保守）。 */
const FALLBACK_CHARS_PER_V2_MODULE = 20_000;

/** 增量模式：未知覆盖率时不缩放，展示为上限；已知时下限 15%。 */
const INCREMENTAL_MIN_RATIO = 0.15;

export function estimateCreditsFromChars(chars: number): number {
  if (chars <= 0) return 0;
  const k = Number.isFinite(ESTIMATE_CREDITS_PER_CHAR)
    ? ESTIMATE_CREDITS_PER_CHAR
    : 1.6;
  return Math.max(1, Math.ceil(chars * k));
}

export type CreateTaskCreditEstimate = {
  estimatedCredits: number | null;
  remainingCredits: number;
  usedShopScan: boolean;
  /** 上限文案：默认 true（k=1.6 为覆盖绝大部分情况的上限口径） */
  isUpperBound: boolean;
  needsMoreCredits: boolean;
};

function sumCharsForModules(
  moduleStats: Record<string, { items?: number; chars?: number }> | undefined,
  v4Modules: string[],
): { chars: number; hitCount: number } {
  if (!moduleStats || typeof moduleStats !== "object") {
    return { chars: 0, hitCount: 0 };
  }
  let chars = 0;
  let hitCount = 0;
  for (const mod of v4Modules) {
    const row = moduleStats[mod];
    if (row && typeof row.chars === "number" && row.chars > 0) {
      chars += row.chars;
      hitCount += 1;
    }
  }
  return { chars, hitCount };
}

function fallbackChars(
  moduleStats: Record<string, { items?: number; chars?: number }> | undefined,
  v2ModuleKeys: string[],
  v4Modules: string[],
): number {
  const productChars = moduleStats?.PRODUCT?.chars;
  if (typeof productChars === "number" && productChars > 0) {
    // 有商品字符但所选模块未命中：按模块数量相对 PRODUCT 三件套粗扩。
    const scale = Math.max(1, v4Modules.length / 3);
    return Math.ceil(productChars * scale);
  }
  return Math.max(1, v2ModuleKeys.length) * FALLBACK_CHARS_PER_V2_MODULE;
}

/**
 * 按所选 v2 模块 + 目标语言数粗估创建任务额度（上限口径）。
 * untranslatedRatioByLocale：0=已全译，1=全未译；缺省则增量模式不缩放。
 */
export async function estimateCreateTaskCredits(args: {
  shop: string;
  v2ModuleKeys: string[];
  targets: string[];
  isCover: boolean;
  includeLiquid?: boolean;
  untranslatedRatioByLocale?: Record<string, number | null>;
}): Promise<CreateTaskCreditEstimate> {
  const targets = args.targets.map((t) => t.trim()).filter(Boolean);
  const v2ModuleKeys = [
    ...new Set(args.v2ModuleKeys.map((k) => k.trim()).filter(Boolean)),
  ];
  const includeLiquid = Boolean(args.includeLiquid);

  const quota = await getShopCreditQuota(args.shop).catch(() => null);
  const remainingCredits = Math.max(0, Math.floor(quota?.remaining ?? 0));

  if (targets.length === 0 || (v2ModuleKeys.length === 0 && !includeLiquid)) {
    return {
      estimatedCredits: null,
      remainingCredits,
      usedShopScan: false,
      isUpperBound: true,
      needsMoreCredits: false,
    };
  }

  let usedShopScan = false;
  let estimated = 0;

  if (v2ModuleKeys.length > 0) {
    const v4Modules = expandV2ModuleKeys(v2ModuleKeys);
    const scan = await getLatestShopScanJob(args.shop).catch(() => null);
    const moduleStats = scan?.summary?.moduleStats;
    const { chars: scannedChars, hitCount } = sumCharsForModules(
      moduleStats,
      v4Modules,
    );

    usedShopScan = hitCount > 0;
    let chars =
      hitCount > 0
        ? scannedChars
        : fallbackChars(moduleStats, v2ModuleKeys, v4Modules);
    if (hitCount === 0 && typeof moduleStats?.PRODUCT?.chars === "number") {
      usedShopScan = true;
    }

    estimated = estimateCreditsFromChars(chars) * targets.length;

    if (!args.isCover) {
      const ratios = targets.map((locale) => {
        const raw = args.untranslatedRatioByLocale?.[locale];
        return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
      });
      const known = ratios.filter((r): r is number => r != null);
      if (known.length > 0) {
        const avg =
          known.reduce((sum, r) => sum + Math.min(1, Math.max(0, r)), 0) /
          known.length;
        const scale = Math.max(INCREMENTAL_MIN_RATIO, avg);
        estimated = Math.max(1, Math.ceil(estimated * scale));
      }
    }
  }

  if (includeLiquid) {
    const liquidChars = await sumPendingLiquidChars(args.shop, targets).catch(
      () => 0,
    );
    if (liquidChars > 0) {
      estimated += estimateCreditsFromChars(liquidChars);
    }
  }

  if (estimated <= 0) {
    return {
      estimatedCredits: null,
      remainingCredits,
      usedShopScan,
      isUpperBound: true,
      needsMoreCredits: false,
    };
  }

  const estimatedCredits = Math.max(1, Math.floor(estimated));
  return {
    estimatedCredits,
    remainingCredits,
    usedShopScan,
    // k=1.6 本身是上限校准；文案统一用「上限约」
    isUpperBound: true,
    needsMoreCredits:
      remainingCredits >= 0 && estimatedCredits > remainingCredits,
  };
}

/**
 * 创建任务时写入 Cosmos 的单语言额度上限（字符×k，无覆盖率缩放）。
 * 与确认弹窗公式同源字符口径，但不乘未译比例、不乘多语言。
 */
export async function estimatePersistedJobCredits(args: {
  shop: string;
  v4Modules: string[];
}): Promise<number | null> {
  const v4Modules = [
    ...new Set(args.v4Modules.map((m) => m.trim().toUpperCase()).filter(Boolean)),
  ];
  if (v4Modules.length === 0) return null;

  const scan = await getLatestShopScanJob(args.shop).catch(() => null);
  const moduleStats = scan?.summary?.moduleStats;
  const { chars: scannedChars, hitCount } = sumCharsForModules(
    moduleStats,
    v4Modules,
  );
  const chars =
    hitCount > 0
      ? scannedChars
      : fallbackChars(moduleStats, [], v4Modules);
  return estimateCreditsFromChars(chars);
}
