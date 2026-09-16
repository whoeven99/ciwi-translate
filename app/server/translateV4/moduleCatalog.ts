/**
 * v2 翻译模块（UI token）与 v4 Shopify resource module 映射。
 * 对齐 Java `TranslateResourceDTO.TOKEN_MAP` 与 `TaskService.AUTO_TRANSLATE_MAP`。
 */
import type { TranslationV4Module } from "./types";

/** v2 创建任务 UI 选项 key（不含 handle，handle 走 isHandle 开关）。 */
export const V2_MODULE_OPTION_KEYS = [
  "products",
  "collection",
  "article",
  "blog_titles",
  "pages",
  "filters",
  "metaobjects",
  "metadata",
  "policies",
  "navigation",
  "shop",
  "theme",
  "notifications",
  "delivery",
  "shipping",
] as const;

export type TranslateV2ModuleKey = (typeof V2_MODULE_OPTION_KEYS)[number];

/** v2 手动创建任务默认勾选（对齐 app.translate/route.tsx translateSettings3）。 */
export const DEFAULT_V2_MODULE_KEYS: TranslateV2ModuleKey[] = [
  "products",
  "collection",
  "article",
  "blog_titles",
  "pages",
  "filters",
  "metaobjects",
  "metadata",
  "navigation",
  "shop",
  "theme",
  "notifications",
  "delivery",
  "shipping",
];

/** v2 UI 文案（与 v2 翻译页一致）。 */
export const V2_MODULE_LABELS: Record<TranslateV2ModuleKey, string> = {
  products: "产品",
  collection: "商品分类",
  article: "文章",
  blog_titles: "博客标题",
  pages: "页面",
  filters: "筛选器",
  metaobjects: "元对象",
  metadata: "商店元数据",
  policies: "政策",
  navigation: "导航",
  shop: "商店",
  theme: "主题",
  notifications: "电子邮件",
  delivery: "配送",
  shipping: "运输",
};

/** v2 token → v4 Shopify TranslatableResourceType 列表。 */
export const V2_MODULE_TO_V4: Record<TranslateV2ModuleKey, TranslationV4Module[]> = {
  products: ["PRODUCT", "PRODUCT_OPTION", "PRODUCT_OPTION_VALUE"],
  collection: ["COLLECTION"],
  article: ["ARTICLE"],
  blog_titles: ["BLOG"],
  pages: ["PAGE"],
  filters: ["FILTER"],
  metaobjects: ["METAOBJECT"],
  metadata: ["METAFIELD"],
  policies: ["SHOP_POLICY"],
  navigation: ["MENU", "LINK"],
  shop: ["SHOP", "PAYMENT_GATEWAY", "SELLING_PLAN", "SELLING_PLAN_GROUP"],
  theme: [
    "ONLINE_STORE_THEME_JSON_TEMPLATE",
    "ONLINE_STORE_THEME_SECTION_GROUP",
    "ONLINE_STORE_THEME_SETTINGS_CATEGORY",
    "ONLINE_STORE_THEME_SETTINGS_DATA_SECTIONS",
    "ONLINE_STORE_THEME_LOCALE_CONTENT",
  ],
  notifications: ["EMAIL_TEMPLATE"],
  delivery: ["DELIVERY_METHOD_DEFINITION"],
  shipping: ["PACKING_SLIP_TEMPLATE"],
};

/**
 * v4 定时自动翻译模块（不含 EMAIL_TEMPLATE — 邮件请用手动任务勾选「电子邮件」）。
 * Worker 校验清单：worker/scripts/v4-auto-translate-modules.json
 * 注：Spring v2 AUTO_TRANSLATE_MAP 仍含 EMAIL_TEMPLATE。
 * 不含 CUSTOM_LIQUID / includeLiquid（auto 永不带 liquid）。
 */
export const AUTO_TRANSLATE_V4_MODULES: TranslationV4Module[] = [
  "SHOP",
  "MENU",
  "LINK",
  "FILTER",
  "PACKING_SLIP_TEMPLATE",
  "DELIVERY_METHOD_DEFINITION",
  "METAOBJECT",
  "ONLINE_STORE_THEME_JSON_TEMPLATE",
  "ONLINE_STORE_THEME_SECTION_GROUP",
  "ONLINE_STORE_THEME_SETTINGS_CATEGORY",
  "ONLINE_STORE_THEME_SETTINGS_DATA_SECTIONS",
  "COLLECTION",
  "PRODUCT",
  "PRODUCT_OPTION",
  "PRODUCT_OPTION_VALUE",
  "BLOG",
  "ARTICLE",
  "PAGE",
  "METAFIELD",
  "SHOP_POLICY",
  "SELLING_PLAN",
  "SELLING_PLAN_GROUP",
];

const AUTO_TRANSLATE_V4_MODULE_SET = new Set<string>(AUTO_TRANSLATE_V4_MODULES);

/**
 * 商户可选的自动更新 v2 模块（不含 notifications / liquid）。
 * 展开后会与 AUTO_TRANSLATE_V4_MODULES 求交（如 theme 去掉 LOCALE_CONTENT）。
 */
export const AUTO_TRANSLATE_V2_MODULE_KEYS: TranslateV2ModuleKey[] = [
  "products",
  "collection",
  "article",
  "blog_titles",
  "pages",
  "filters",
  "metaobjects",
  "metadata",
  "policies",
  "navigation",
  "shop",
  "theme",
  "delivery",
  "shipping",
];

export const AUTO_TRANSLATE_V2_MODULE_KEY_SET = new Set<string>(
  AUTO_TRANSLATE_V2_MODULE_KEYS,
);

/** v4 module 展示名（任务详情、进度条等）。 */
export const V4_MODULE_LABELS: Record<TranslationV4Module, string> = {
  PRODUCT: "产品",
  PRODUCT_OPTION: "商品选项",
  PRODUCT_OPTION_VALUE: "商品选项值",
  COLLECTION: "商品系列",
  ONLINE_STORE_THEME_APP_EMBED: "主题 App 嵌入",
  ONLINE_STORE_THEME_JSON_TEMPLATE: "主题模板",
  ONLINE_STORE_THEME_SECTION_GROUP: "主题区块组",
  ONLINE_STORE_THEME_SETTINGS_CATEGORY: "主题设置分类",
  ONLINE_STORE_THEME_SETTINGS_DATA_SECTIONS: "主题设置",
  ONLINE_STORE_THEME_LOCALE_CONTENT: "主题语言内容",
  MENU: "导航菜单",
  LINK: "链接",
  DELIVERY_METHOD_DEFINITION: "配送方式",
  FILTER: "筛选器",
  METAFIELD: "元字段",
  METAOBJECT: "元对象",
  PAYMENT_GATEWAY: "支付网关",
  SELLING_PLAN: "销售计划",
  SELLING_PLAN_GROUP: "销售计划组",
  SHOP: "店铺信息",
  ARTICLE: "博客文章",
  BLOG: "博客",
  PAGE: "页面",
  SHOP_POLICY: "政策",
  EMAIL_TEMPLATE: "电子邮件",
  PACKING_SLIP_TEMPLATE: "运输",
};

export function expandV2ModuleKeys(keys: string[]): TranslationV4Module[] {
  const seen = new Set<TranslationV4Module>();
  const result: TranslationV4Module[] = [];
  for (const key of keys) {
    const mods = V2_MODULE_TO_V4[key as TranslateV2ModuleKey];
    if (!mods) continue;
    for (const mod of mods) {
      if (!seen.has(mod)) {
        seen.add(mod);
        result.push(mod);
      }
    }
  }
  return result;
}

/** 展开并裁剪到 auto 允许的 v4 模块（不含 EMAIL / LOCALE_CONTENT / liquid）。 */
export function expandAutoTranslateV2ModuleKeys(
  keys: string[],
): TranslationV4Module[] {
  return expandV2ModuleKeys(keys).filter((mod) =>
    AUTO_TRANSLATE_V4_MODULE_SET.has(mod),
  );
}

/** 校验并规范化商户所选 auto 模块；非法 key 丢弃；空则 null。 */
export function normalizeAutoTranslateV2Modules(
  keys: unknown,
): TranslateV2ModuleKey[] | null {
  if (!Array.isArray(keys)) return null;
  const out: TranslateV2ModuleKey[] = [];
  const seen = new Set<string>();
  for (const raw of keys) {
    const key = String(raw ?? "").trim();
    if (!key || seen.has(key)) continue;
    if (!AUTO_TRANSLATE_V2_MODULE_KEY_SET.has(key)) continue;
    seen.add(key);
    out.push(key as TranslateV2ModuleKey);
  }
  return out.length > 0 ? out : null;
}

export function isValidAutoTranslateHour(hour: unknown): hour is number {
  return (
    typeof hour === "number" &&
    Number.isInteger(hour) &&
    hour >= 0 &&
    hour <= 23
  );
}

/** v2 手动创建任务默认展开的 v4 modules。 */
export function defaultManualV4Modules(): TranslationV4Module[] {
  return expandV2ModuleKeys(DEFAULT_V2_MODULE_KEYS);
}
