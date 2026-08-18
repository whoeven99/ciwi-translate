/**
 * 首屏 LCP 归因日志。
 *
 * 背景：`/web-vitals-metrics` 过去只记一个 LCP 数字，看到 4400ms 也无法判断慢在
 * 「文档首字节 / 阻塞 CSS / JS 下载 / 客户端补数据」哪一段，调优只能靠猜。这里把
 * LCP 元素、各阶段时间点、资源冷热、网络档位、首屏 API 落地时刻一起上报到 `/log`，
 * 服务端再输出可 grep 的 `[perf][lcp]` 单行（见 `app/routes/log.tsx`）。
 *
 * 约束：
 * - 不采集任何元素文本内容。首屏之外的页面（如 manage_translation）LCP 元素可能是
 *   商户商品文案，只记标签 / class / 尺寸，足够定位到组件。
 * - 全部在 LCP 结算后（首次交互 / 页面隐藏 / 兜底超时）用 sendBeacon 发出，不占首屏。
 */

import { reportClientLog } from "~/utils/clientLog";

/** LCP 在「首次交互」时由 Chrome 定格；两者都没发生时的兜底上报时刻。 */
const FALLBACK_REPORT_DELAY_MS = 12_000;
const ELEMENT_PATH_DEPTH = 4;
const MAX_CLASS_COUNT = 3;
/** 首屏关心的接口前缀：用于判断「骨架屏换成真实内容」是否发生在 LCP 之后。 */
const TRACKED_API_PREFIXES = ["/api/", "/locales/"];

type ReportReason = "interaction" | "hidden" | "timeout";

type LargestContentfulPaintEntry = PerformanceEntry & {
  size?: number;
  renderTime?: number;
  loadTime?: number;
  url?: string;
  element?: Element | null;
};

type NetworkInformationLike = {
  effectiveType?: string;
  rtt?: number;
  downlink?: number;
  saveData?: boolean;
};

function roundMs(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.round(value);
}

/** 只取标签 / id / class / nth-child，不取文本，避免把商户内容写进日志。 */
function describeElementPath(element: Element | null | undefined): string | null {
  if (!element) return null;

  const segments: string[] = [];
  let node: Element | null = element;
  let depth = 0;

  while (node && depth < ELEMENT_PATH_DEPTH) {
    const tag = node.tagName.toLowerCase();
    let segment = tag;

    if (node.id) {
      segment += `#${node.id}`;
    } else {
      const classes = Array.from(node.classList).slice(0, MAX_CLASS_COUNT);
      if (classes.length > 0) segment += `.${classes.join(".")}`;
    }

    const parent: Element | null = node.parentElement;
    if (parent && !node.id) {
      const index = Array.prototype.indexOf.call(parent.children, node);
      if (index >= 0) segment += `:nth-child(${index + 1})`;
    }

    segments.unshift(segment);
    if (node.id) break;
    node = parent;
    depth += 1;
  }

  return segments.join(" > ") || null;
}

function describeLcpElement(entry: LargestContentfulPaintEntry | null) {
  const element = entry?.element ?? null;
  if (!element) return null;

  const rect = element.getBoundingClientRect();
  return {
    tag: element.tagName.toLowerCase(),
    path: describeElementPath(element),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    /** Chrome 的 LCP 面积（图片按显示尺寸，文本按文本块并集）。 */
    paintSize: typeof entry?.size === "number" ? entry.size : null,
  };
}

function collectNavigationTiming() {
  const [nav] = performance.getEntriesByType(
    "navigation",
  ) as PerformanceNavigationTiming[];
  if (!nav) return null;

  return {
    type: nav.type,
    /** 首字节：文档请求在服务端 + 网络往返上花掉的时间。 */
    ttfbMs: roundMs(nav.responseStart),
    documentDownloadMs: roundMs(nav.responseEnd - nav.responseStart),
    domContentLoadedMs: roundMs(nav.domContentLoadedEventEnd),
    loadEventMs: roundMs(nav.loadEventEnd),
    documentTransferBytes: nav.transferSize || null,
    documentDecodedBytes: nav.decodedBodySize || null,
  };
}

function collectPaintTiming() {
  const fcp = performance
    .getEntriesByType("paint")
    .find((entry) => entry.name === "first-contentful-paint");
  return roundMs(fcp?.startTime);
}

/**
 * 资源汇总。`transferSize === 0 && decodedBodySize > 0` 表示命中浏览器缓存 ——
 * 这是区分「首次安装冷加载」和「回访热加载」的关键字段，两者 LCP 能差 3 倍。
 */
function collectResourceSummary() {
  const resources = performance.getEntriesByType(
    "resource",
  ) as PerformanceResourceTiming[];

  const summary = {
    scriptCount: 0,
    scriptBytes: 0,
    scriptCachedCount: 0,
    styleCount: 0,
    styleBytes: 0,
    styleCachedCount: 0,
    slowestBlockingMs: 0,
    slowestBlockingName: null as string | null,
  };
  const apiTimings: Record<string, number> = {};

  for (const resource of resources) {
    const isCached =
      resource.transferSize === 0 && resource.decodedBodySize > 0;
    const isScript =
      resource.initiatorType === "script" || /\.js(\?|$)/.test(resource.name);
    const isStyle =
      resource.initiatorType === "link" || /\.css(\?|$)/.test(resource.name);

    if (isScript) {
      summary.scriptCount += 1;
      summary.scriptBytes += resource.transferSize || 0;
      if (isCached) summary.scriptCachedCount += 1;
    } else if (isStyle) {
      summary.styleCount += 1;
      summary.styleBytes += resource.transferSize || 0;
      if (isCached) summary.styleCachedCount += 1;
    }

    if ((isScript || isStyle) && resource.responseEnd > summary.slowestBlockingMs) {
      summary.slowestBlockingMs = resource.responseEnd;
      summary.slowestBlockingName = shortResourceName(resource.name);
    }

    // 首屏客户端补数据（覆盖率 / 任务 / 额度）落地时刻，用于判断是否拖到了 LCP 之后。
    const path = safePathname(resource.name);
    if (path && TRACKED_API_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      const responseEnd = roundMs(resource.responseEnd);
      if (responseEnd != null) apiTimings[path] = responseEnd;
    }
  }

  return {
    ...summary,
    slowestBlockingMs: roundMs(summary.slowestBlockingMs),
    apiTimings: Object.keys(apiTimings).length > 0 ? apiTimings : undefined,
  };
}

function safePathname(url: string): string | null {
  try {
    return new URL(url, window.location.origin).pathname;
  } catch {
    return null;
  }
}

function shortResourceName(url: string): string {
  const path = safePathname(url);
  if (!path) return url.slice(0, 80);
  const name = path.split("/").pop() || path;
  return name.slice(0, 80);
}

function collectEnvironment() {
  const connection = (
    navigator as Navigator & { connection?: NetworkInformationLike }
  ).connection;

  return {
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    effectiveType: connection?.effectiveType ?? null,
    rttMs: connection?.rtt ?? null,
    downlinkMbps: connection?.downlink ?? null,
    saveData: connection?.saveData ?? null,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
  };
}

/** 一个文档只上报一次，避免 SPA 内跳转或多次触发条件时重复刷日志。 */
let reported = false;

export function observeLcpDiagnostics(): () => void {
  if (typeof window === "undefined") return () => {};
  if (typeof PerformanceObserver === "undefined") return () => {};
  if (typeof performance === "undefined" || !performance.getEntriesByType) {
    return () => {};
  }

  let latestLcp: LargestContentfulPaintEntry | null = null;
  const visibilityStateAtStart = document.visibilityState;
  let observer: PerformanceObserver | null = null;
  let fallbackTimer: number | null = null;

  const cleanup = () => {
    if (fallbackTimer != null) {
      window.clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
    observer?.disconnect();
    observer = null;
    window.removeEventListener("pointerdown", onInteraction, true);
    window.removeEventListener("keydown", onInteraction, true);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("pagehide", onPageHide);
  };

  function flush(reason: ReportReason) {
    if (reported) {
      cleanup();
      return;
    }
    reported = true;

    const lcpMs = roundMs(latestLcp?.renderTime ?? latestLcp?.startTime);
    const navigation = collectNavigationTiming();
    const fcpMs = collectPaintTiming();
    const resources = collectResourceSummary();
    const element = describeLcpElement(latestLcp);

    void reportClientLog(
      {
        event: "lcp_diagnostics",
        action: reason,
        kind: "event",
        level: "info",
        status: "success",
        durationMs: lcpMs ?? undefined,
        message: `LCP ${lcpMs ?? "unknown"}ms`,
        context: {
          reportReason: reason,
          visibilityStateAtStart,
          lcpMs,
          fcpMs,
          lcpImageUrl: latestLcp?.url ? shortResourceName(latestLcp.url) : null,
          lcpResourceLoadMs: roundMs(latestLcp?.loadTime),
          element,
          navigation,
          resources,
          environment: collectEnvironment(),
        },
      },
      { beacon: true },
    );

    cleanup();
  }

  function onInteraction() {
    // Chrome 在首次交互时定格 LCP，此刻的值即最终值。
    flush("interaction");
  }

  function onVisibilityChange() {
    if (document.visibilityState === "hidden") flush("hidden");
  }

  function onPageHide() {
    flush("hidden");
  }

  try {
    observer = new PerformanceObserver((list) => {
      const entries = list.getEntries() as LargestContentfulPaintEntry[];
      if (entries.length > 0) latestLcp = entries[entries.length - 1];
    });
    observer.observe({ type: "largest-contentful-paint", buffered: true });
  } catch {
    // 浏览器不支持 largest-contentful-paint（如 Safari）时静默跳过。
    return () => {};
  }

  window.addEventListener("pointerdown", onInteraction, {
    capture: true,
    once: true,
  });
  window.addEventListener("keydown", onInteraction, {
    capture: true,
    once: true,
  });
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pagehide", onPageHide);
  fallbackTimer = window.setTimeout(
    () => flush("timeout"),
    FALLBACK_REPORT_DELAY_MS,
  );

  return cleanup;
}

/** Shopify App Bridge `webVitals.onReport` 的载荷转成结构化日志。 */
export function reportShopifyWebVitals(metrics: unknown) {
  const list = Array.isArray((metrics as { metrics?: unknown })?.metrics)
    ? ((metrics as { metrics: Array<Record<string, unknown>> }).metrics ?? [])
    : [];

  const values: Record<string, number> = {};
  for (const item of list) {
    const name = typeof item?.name === "string" ? item.name : null;
    const value = typeof item?.value === "number" ? item.value : null;
    if (name && value != null) values[name] = Math.round(value);
  }

  void reportClientLog(
    {
      event: "shopify_web_vitals",
      kind: "event",
      level: "info",
      status: "success",
      durationMs: values.LCP,
      message: `Shopify web vitals LCP ${values.LCP ?? "unknown"}ms`,
      context: values,
    },
    { beacon: true },
  );
}
