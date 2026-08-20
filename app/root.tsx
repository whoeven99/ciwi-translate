import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
} from "@remix-run/react";
import { Provider } from "react-redux";
import store from "./store";
import { useEffect, useLayoutEffect, useRef } from "react";
import { createHead } from "remix-island";
import { globalStore } from "./globalStore";
import { patchToastDeduplication } from "./ui/message";
import { reportClientError } from "./utils/clientLog";
import {
  observeLcpDiagnostics,
  reportShopifyWebVitals,
} from "./utils/lcpDiagnostics";
import {
  sanitizeEmbeddedAppHref,
  sanitizeEmbeddedAppPath,
} from "./lib/sanitizeEmbeddedAppPath";

import "./styles.css";

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

function isNetworkFetchError(error: unknown): boolean {
  const { name, message, stack } = getErrorDetails(error);
  if (typeof message !== "string") return false;
  if (/failed to fetch/i.test(message)) return true;
  return (
    name === "TypeError" &&
    /fetch/i.test(message) &&
    typeof stack === "string" &&
    /app-bridge|chrome-extension/i.test(stack)
  );
}

function getErrorDetails(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    return {
      name: typeof value.name === "string" ? value.name : undefined,
      message: typeof value.message === "string" ? value.message : undefined,
      stack: typeof value.stack === "string" ? value.stack : undefined,
    };
  }
  if (typeof error === "string") {
    return {
      name: undefined,
      message: error,
      stack: undefined,
    };
  }
  return {
    name: undefined,
    message: undefined,
    stack: undefined,
  };
}

function isAbortLikeError(error: unknown): boolean {
  const { name, message } = getErrorDetails(error);
  if (name === "AbortError") return true;
  if (!message) return false;
  return /signal is aborted without reason|aborted|aborterror/i.test(message);
}

function isShopifyIdTokenNoise(error: unknown): boolean {
  const { message, stack } = getErrorDetails(error);
  return (
    /idtoken unavailable|failed to fetch an idtoken/i.test(message ?? "") ||
    (/shopifycloud\/app-bridge\.js/i.test(stack ?? "") &&
      /idtoken/i.test(`${message ?? ""} ${stack ?? ""}`))
  );
}

function isLibraryDeprecationWarningMessage(message: string | undefined): boolean {
  if (!message) return false;
  return /\[rc-collapse\].*`children` will be removed in next major version.*use `items` instead/i.test(
    message,
  );
}

function isStaleAssetUrl(url: string | undefined): boolean {
  if (!url) return false;
  return /\/assets\/(route|manifest|entry\.client|root)-.*\.(js|css)(\?|$)/i.test(
    url,
  );
}

function isStaleChunkError(error: unknown): boolean {
  const { name, message, stack } = getErrorDetails(error);
  const text = `${name ?? ""} ${message ?? ""} ${stack ?? ""}`;
  return (
    /ChunkLoadError/i.test(text) ||
    /Loading chunk [\w-]+ failed/i.test(text) ||
    /Failed to fetch dynamically imported module/i.test(text) ||
    /Importing a module script failed/i.test(text) ||
    /Failed to load module script/i.test(text) ||
    /\/assets\/(route|manifest|entry\.client|root)-.*\.js/i.test(text)
  );
}

function reloadOnceForStaleAssets(reason: string, url?: string) {
  if (typeof window === "undefined") return false;
  const key = "ciwi:stale-assets-reloaded";
  const existing = window.sessionStorage.getItem(key);
  if (existing) return false;
  window.sessionStorage.setItem(
    key,
    JSON.stringify({
      reason,
      url,
      at: Date.now(),
    }),
  );
  window.location.reload();
  return true;
}

function isIgnorableClientNoiseError(error: unknown): boolean {
  const { message } = getErrorDetails(error);
  return (
    isNetworkFetchError(error) ||
    isStaleChunkError(error) ||
    isAbortLikeError(error) ||
    isShopifyIdTokenNoise(error) ||
    isLibraryDeprecationWarningMessage(message) ||
    /Unexpected value for attribute "loading" on <button>/i.test(message ?? "")
  );
}

function getHtmlErrorStatusCode(error: unknown): string | null {
  const { message } = getErrorDetails(error);
  if (!message || !/<!doctype html/i.test(message)) return null;
  const titleMatch = message.match(/<title>\s*(\d{3})\s*<\/title>/i);
  if (titleMatch?.[1]) return titleMatch[1];
  const headingMatch = message.match(/<h1[^>]*>\s*(\d{3})\s*<\/h1>/i);
  return headingMatch?.[1] ?? null;
}

function shouldIgnoreConsoleErrorReport(args: unknown[]): boolean {
  const firstArg = typeof args[0] === "string" ? args[0] : "";
  const errorArg = args.find((item) => item instanceof Error) ?? args[1];
  const normalizedArgs = args
    .map((item) => {
      if (typeof item === "string") return item;
      if (item instanceof Error) return item.message;
      return "";
    })
    .filter(Boolean)
    .join(" ");
  return (
    /failed to fetch an idtoken|idtoken unavailable/i.test(normalizedArgs) ||
    isLibraryDeprecationWarningMessage(normalizedArgs) ||
    /Unexpected value for attribute "loading" on <button>/i.test(normalizedArgs) ||
    ((/^\[translateV4\] refresh coverage from cache failed:/i.test(firstArg) ||
      /^\[app\] bootstrap java fetch failed:/i.test(firstArg) ||
      /^Fetch request failed:/i.test(firstArg)) &&
      (isNetworkFetchError(errorArg) || isAbortLikeError(errorArg)))
  );
}

function runWhenIdle(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  if ("requestIdleCallback" in window) {
    const id = window.requestIdleCallback(callback, { timeout: 3000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = globalThis.setTimeout(callback, 1500);
  return () => globalThis.clearTimeout(id);
}

function appendExternalScript(id: string, src: string) {
  if (document.getElementById(id)) return;
  const script = document.createElement("script");
  script.id = id;
  script.src = src;
  script.async = true;
  script.setAttribute("crossorigin", "*");
  document.body.appendChild(script);
}

function loadAnalyticsScripts() {
  if (document.getElementById("ciwi-gtm-loader")) return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ "gtm.start": new Date().getTime(), event: "gtm.js" });
  window.gtag =
    window.gtag ||
    function gtag() {
      window.dataLayer.push(arguments);
    };
  window.gtag("js", new Date());
  window.gtag("config", "G-F1BN24YVJN");
  window.gtag("event", "conversion", {
    send_to: "AW-11460630366/7Dj1CNvO4cYaEN6u7dgq",
    value: 1.0,
    currency: "USD",
  });
  appendExternalScript(
    "ciwi-gtm-loader",
    "https://www.googletagmanager.com/gtm.js?id=GTM-NVPT5XDV",
  );
}

function summarizeConsoleArg(value: unknown) {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
    };
  }
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value == null
  ) {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

export function ErrorBoundary() {
  const error = useRouteError();
  const loggedRef = useRef(false);
  const recoverableHref =
    typeof window === "undefined"
      ? null
      : sanitizeEmbeddedAppHref(
          `${window.location.pathname}${window.location.search}${window.location.hash}`,
        );

  useLayoutEffect(() => {
    if (!recoverableHref) return;
    window.location.replace(recoverableHref);
  }, [recoverableHref]);

  const htmlErrorStatusCode = getHtmlErrorStatusCode(error);
  let errorCode = "500";
  if (isRouteErrorResponse(error)) {
    errorCode = error.status.toString();
  } else if (htmlErrorStatusCode) {
    errorCode = htmlErrorStatusCode;
  } else if (isNetworkFetchError(error)) {
    errorCode = "503";
  }

  // 错误信息映射
  const errorMessages: {
    [key: string]: { title: string; message: string; solution: string };
  } = {
    "400": {
      title: "Bad Request",
      message:
        "The request could not be understood by the server due to malformed syntax.",
      solution: `Please click the Ciwi-Translator option in the app navigation bar again`,
    },
    "401": {
      title: "Unauthorized",
      message:
        "Authentication is required and has failed or has not been provided.",
      solution: `Please  click the Ciwi-Translator option in the app navigation bar again`,
    },
    "403": {
      title: "Forbidden",
      message: "You don't have permission to access this resource.",
      solution: `Please click the Ciwi-Translator option in the app navigation bar again`,
    },
    "404": {
      title: "Not Found",
      message: "The requested resource could not be found.",
      solution: `Please click the Ciwi-Translator option in the app navigation bar again`,
    },
    "500": {
      title: "Internal Server Error",
      message:
        "The server encountered an unexpected condition that prevented it from fulfilling the request.",
      solution: "Please refresh the page",
    },
    "502": {
      title: "Bad Gateway",
      message:
        "The server received an invalid response from the upstream server.",
      solution: "Please refresh the page",
    },
    "503": {
      title: "Service Unavailable",
      message: "The server is currently unavailable.",
      solution: "Please refresh the page",
    },
    "504": {
      title: "Gateway Timeout",
      message:
        "The server did not receive a timely response from the upstream server.",
      solution: "Please refresh the page",
    },
  };

  const currentError = errorMessages[errorCode] || errorMessages["500"];

  if (!recoverableHref) {
    console.error("Root Error:", error);
  }

  useEffect(() => {
    if (loggedRef.current) return;
    if (
      typeof window !== "undefined" &&
      sanitizeEmbeddedAppPath(window.location.pathname)
    ) {
      return;
    }
    loggedRef.current = true;
    void reportClientError("root_error_boundary", error, {
      shop: globalStore.shop,
      route:
        typeof window === "undefined"
          ? undefined
          : `${window.location.pathname}${window.location.search}`,
      message: currentError.title,
      context: {
        errorCode,
        htmlErrorStatusCode,
        isRouteErrorResponse: isRouteErrorResponse(error),
        isNetworkFetchError: isNetworkFetchError(error),
      },
    });
  }, [currentError.title, error, errorCode]);


  // 服务器端渲染时直接返回基础结构
  return (
    <>
      <Head />
      <div id="root">
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            minHeight: "100vh",
            background: "#f5f5f5",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 500,
              textAlign: "center",
              padding: "24px",
            }}
          >
            <h1 style={{ fontSize: 72, margin: "24px 0" }}>{errorCode}</h1>
            <h2 style={{ margin: "24px 0" }}>{currentError.title}</h2>
            <p
              style={{
                display: "block",
                marginBottom: "24px",
                fontSize: 16,
              }}
            >
              {currentError.message}
            </p>
            <p
              style={{
                display: "block",
                marginBottom: "24px",
                fontSize: 16,
              }}
            >
              Please click the "Ciwi-Translator" option in the app navigation
              bar again
            </p>
          </div>
        </div>
        <ScrollRestoration />
        <Scripts />
      </div>
    </>
  );
}

export default function App() {
  // 从 loader 数据中获取国际化语言代码
  useEffect(() => {
    // GTM 初始化脚本
    return runWhenIdle(loadAnalyticsScripts);
  }, []);

  useEffect(() => {
    // LCP 归因日志（元素 / 阶段耗时 / 冷热缓存 / 网络档位）走 sendBeacon → `/log`。
    // Shopify 的 web vitals 也改走同一通道：原先的 fetcher.submit 会在每次上报后触发
    // Remix 全量 loader revalidate，等于把鉴权和 Shopify 语言查询再跑一遍。
    const stopLcpDiagnostics = observeLcpDiagnostics();
    if (typeof shopify !== "undefined" && shopify?.webVitals?.onReport) {
      shopify.webVitals.onReport(reportShopifyWebVitals);
    }
    return stopLcpDiagnostics;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let cleanup = () => {};
    let patchTimer: number | null = null;

    const tryPatchToast = () => {
      const hasToast = Boolean(
        (globalThis as { shopify?: { toast?: { show?: unknown } } }).shopify?.toast
          ?.show,
      );
      if (!hasToast) return false;
      cleanup = patchToastDeduplication(1500);
      return true;
    };

    if (!tryPatchToast()) {
      patchTimer = window.setInterval(() => {
        if (tryPatchToast() && patchTimer != null) {
          window.clearInterval(patchTimer);
          patchTimer = null;
        }
      }, 500);
    }

    return () => {
      if (patchTimer != null) window.clearInterval(patchTimer);
      cleanup();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleResourceError = (event: Event) => {
      const target = event.target as
        | HTMLScriptElement
        | HTMLLinkElement
        | null;
      const resourceUrl =
        (typeof target?.src === "string" && target.src) ||
        (typeof target?.href === "string" && target.href) ||
        undefined;
      if (!isStaleAssetUrl(resourceUrl)) return;
      if (reloadOnceForStaleAssets("resource_error", resourceUrl)) return;
      void reportClientError("stale_asset_resource_error", resourceUrl, {
        shop: globalStore.shop,
        route: `${window.location.pathname}${window.location.search}`,
      });
    };

    const handleError = (event: ErrorEvent) => {
      if (isStaleChunkError(event.error ?? event.message)) {
        if (
          reloadOnceForStaleAssets(
            "window_error",
            typeof event.filename === "string" ? event.filename : undefined,
          )
        ) {
          return;
        }
      }
      if (isIgnorableClientNoiseError(event.error ?? event.message)) return;
      void reportClientError("window_error", event.error ?? event.message, {
        shop: globalStore.shop,
        route: `${window.location.pathname}${window.location.search}`,
        context: {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        },
      });
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (isStaleChunkError(event.reason)) {
        if (reloadOnceForStaleAssets("unhandled_rejection")) return;
      }
      if (isIgnorableClientNoiseError(event.reason)) return;
      void reportClientError("unhandled_rejection", event.reason, {
        shop: globalStore.shop,
        route: `${window.location.pathname}${window.location.search}`,
        context: {
          reasonType: typeof event.reason,
        },
      });
    };

    window.addEventListener("error", handleResourceError, true);
    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    return () => {
      window.removeEventListener("error", handleResourceError, true);
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const originalConsoleError = console.error.bind(console);
    let reporting = false;

    console.error = (...args: unknown[]) => {
      originalConsoleError(...args);
      if (reporting || shouldIgnoreConsoleErrorReport(args)) return;
      reporting = true;
      const errorArg = args.find((item) => item instanceof Error) ?? args[0];
      void reportClientError("console_error", errorArg, {
        shop: globalStore.shop,
        route: `${window.location.pathname}${window.location.search}`,
        context: {
          consoleArgs: args.slice(0, 5).map(summarizeConsoleArg),
        },
      }).finally(() => {
        reporting = false;
      });
    };

    return () => {
      console.error = originalConsoleError;
    };
  }, []);

  return (
    // 使用 Redux Provider 包装整个应用（用于状态管理，必须）,删除后很多功能无法使用
    <>
      <Provider store={store}>
        <Head />
        <noscript>
          <iframe
            src="https://www.googletagmanager.com/ns.html?id=GTM-NVPT5XDV"
            title="Google Tag Manager"
            height="0"
            width="0"
            style={{ display: "none", visibility: "hidden" }}
          ></iframe>
        </noscript>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </Provider>
    </>
  );
}

export const Head = createHead(() => (
  <>
    <meta charSet="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <link rel="icon" href="/favicon.ico" sizes="any" />
    <link rel="preconnect" href="https://cdn.shopify.com/" />
    <link
      rel="stylesheet"
      href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
    />
    <Meta />
    <Links />
  </>
));
