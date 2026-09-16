/**
 * v4 定时自动翻译模块。
 * 权威列表：worker/scripts/v4-auto-translate-modules.json
 *
 * 刻意不含（仅手动任务）：
 * - EMAIL_TEMPLATE — 勾选「电子邮件」
 * - ONLINE_STORE_THEME_LOCALE_CONTENT — 主题语言内容
 * - CUSTOM_LIQUID / includeLiquid — auto 永不带 liquid
 */
export const AUTO_TRANSLATE_V4_MODULES = [
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
] as const;

export type AutoTranslateV4Module = (typeof AUTO_TRANSLATE_V4_MODULES)[number];

const AUTO_TRANSLATE_V4_MODULE_SET = new Set<string>(AUTO_TRANSLATE_V4_MODULES);

/** 与 App `AUTO_TRANSLATE_V2_MODULE_KEYS` 对齐（不含 notifications / liquid）。 */
export const AUTO_TRANSLATE_V2_MODULE_KEYS = [
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
] as const;

export type AutoTranslateV2ModuleKey =
  (typeof AUTO_TRANSLATE_V2_MODULE_KEYS)[number];

const AUTO_TRANSLATE_V2_MODULE_KEY_SET = new Set<string>(
  AUTO_TRANSLATE_V2_MODULE_KEYS,
);

/** 与 App V2_MODULE_TO_V4 对齐（仅 auto 可选 key）。 */
const V2_MODULE_TO_V4: Record<AutoTranslateV2ModuleKey, string[]> = {
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
  delivery: ["DELIVERY_METHOD_DEFINITION"],
  shipping: ["PACKING_SLIP_TEMPLATE"],
};

export function normalizeAutoTranslateV2Modules(
  keys: unknown,
): AutoTranslateV2ModuleKey[] | null {
  if (!Array.isArray(keys)) return null;
  const out: AutoTranslateV2ModuleKey[] = [];
  const seen = new Set<string>();
  for (const raw of keys) {
    const key = String(raw ?? "").trim();
    if (!key || seen.has(key)) continue;
    if (!AUTO_TRANSLATE_V2_MODULE_KEY_SET.has(key)) continue;
    seen.add(key);
    out.push(key as AutoTranslateV2ModuleKey);
  }
  return out.length > 0 ? out : null;
}

/** 展开并裁剪到 auto 允许的 v4 模块。 */
export function expandAutoTranslateV2ModuleKeys(
  keys: string[],
): AutoTranslateV4Module[] {
  const seen = new Set<string>();
  const result: AutoTranslateV4Module[] = [];
  for (const key of keys) {
    const mods = V2_MODULE_TO_V4[key as AutoTranslateV2ModuleKey];
    if (!mods) continue;
    for (const mod of mods) {
      if (!AUTO_TRANSLATE_V4_MODULE_SET.has(mod) || seen.has(mod)) continue;
      seen.add(mod);
      result.push(mod as AutoTranslateV4Module);
    }
  }
  return result;
}

export function isValidAutoTranslateHour(hour: unknown): hour is number {
  return (
    typeof hour === "number" &&
    Number.isInteger(hour) &&
    hour >= 0 &&
    hour <= 23
  );
}
