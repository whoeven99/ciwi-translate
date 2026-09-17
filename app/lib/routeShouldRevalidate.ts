import type { ShouldRevalidateFunction } from "@remix-run/react";

/** 与 `APP_NAV_ITEMS.pricing` 同值；此处不 import appNav，方便 node:test 直接跑。 */
const PRICING_PATH = "/app/pricing";

/**
 * 嵌入式 App 内：同页点击 / focus 会触发 Remix 重跑 loader，经 App Bridge authenticated fetch。
 * 统计 fetcher 并发时服务端繁忙易导致 `TypeError: Failed to fetch` → 整页 ErrorBoundary。
 *
 * 规则：URL 未变不重验；子路由 POST（fetcher action）不重验父 shell loader；
 * SPA 进定价不重验父级，避免把已有 shopLocales 冲成空。
 */
export const shouldRevalidateAppShell: ShouldRevalidateFunction = ({
  formMethod,
  formAction,
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
}) => {
  if (
    formMethod === "POST" &&
    formAction &&
    formAction !== "/app" &&
    !formAction.endsWith("/app")
  ) {
    return false;
  }

  if (nextUrl.pathname === PRICING_PATH) {
    return false;
  }

  if (
    currentUrl.pathname === nextUrl.pathname &&
    currentUrl.search === nextUrl.search
  ) {
    return false;
  }

  return defaultShouldRevalidate;
};

/** 管理翻译页：数据走 fetcher，loader 仅提供 searchTerm，无需在 POST / 同页交互后重验。 */
export const shouldRevalidateManageTranslation: ShouldRevalidateFunction = ({
  formMethod,
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
}) => {
  if (formMethod === "POST") {
    return false;
  }

  if (
    currentUrl.pathname === nextUrl.pathname &&
    currentUrl.search === nextUrl.search
  ) {
    return false;
  }

  return defaultShouldRevalidate;
};
