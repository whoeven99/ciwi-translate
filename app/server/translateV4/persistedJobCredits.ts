/**
 * 创建任务写入 Cosmos 的单语言额度上限（字符×k，无覆盖率缩放）。
 * Shopify 模块与自定义 Liquid 分开 ceil 后再相加，对齐确认弹窗口径。
 */
export function resolvePersistedJobCredits(args: {
  hasShopifyModules: boolean;
  includeLiquid: boolean;
  shopifyChars: number;
  liquidChars: number;
  creditsFromChars: (chars: number) => number;
}): number | null {
  if (!args.hasShopifyModules && !args.includeLiquid) return null;
  let credits = 0;
  if (args.hasShopifyModules) {
    credits += args.creditsFromChars(Math.max(0, args.shopifyChars));
  }
  if (args.includeLiquid) {
    credits += args.creditsFromChars(Math.max(0, args.liquidChars));
  }
  return credits > 0 ? credits : null;
}
