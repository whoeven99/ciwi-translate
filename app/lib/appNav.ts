/** NavMenu `rel="home"`。不要用 `/app`：它是所有嵌入路由的前缀，会抢走子页高亮（BFS 4.1.4）。 */
export const APP_NAV_HOME = "/app/translate-v4-mvp";

export const APP_NAV_ITEMS = {
  language: "/app/language",
  manageTranslation: "/app/manage_translation",
  currency: "/app/currency",
  switcher: "/app/switcher",
  glossary: "/app/glossary",
  shopProfile: "/app/shop-profile",
  pricing: "/app/pricing",
} as const;

export type AppNavItemHref = (typeof APP_NAV_ITEMS)[keyof typeof APP_NAV_ITEMS];

/** 可见导航项。子页 pathname 必须等于该项或落在 `href/` 之下，Admin 才会高亮父级。 */
export const APP_NAV_PARENT_PREFIXES: readonly AppNavItemHref[] = [
  APP_NAV_ITEMS.language,
  APP_NAV_ITEMS.manageTranslation,
  APP_NAV_ITEMS.currency,
  APP_NAV_ITEMS.switcher,
  APP_NAV_ITEMS.glossary,
  APP_NAV_ITEMS.shopProfile,
  APP_NAV_ITEMS.pricing,
];

function matchesNavPrefix(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** 当前路径应对应的可见导航 href；首页/history/custom 等返回 null。 */
export function parentNavHrefFor(pathname: string): AppNavItemHref | null {
  let best: AppNavItemHref | null = null;
  for (const href of APP_NAV_PARENT_PREFIXES) {
    if (!matchesNavPrefix(pathname, href)) continue;
    if (!best || href.length > best.length) best = href;
  }
  return best;
}
