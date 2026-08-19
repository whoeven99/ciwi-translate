import { json, type ActionFunctionArgs } from "@remix-run/node";

type StructuredLogPayload = {
  event?: string;
  action?: string;
  level?: "info" | "warn" | "error";
  kind?: "event" | "action" | "exception" | "network";
  status?: "start" | "success" | "failure";
  shop?: string;
  route?: string;
  url?: string;
  traceId?: string;
  message?: string;
  durationMs?: number;
  timestamp?: string;
  context?: Record<string, unknown>;
  error?: {
    name?: string;
    message?: string;
    stack?: string;
    status?: number;
    statusText?: string;
    data?: unknown;
  };
};

function safeJsonStringify(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ serializationError: true });
  }
}

async function readPayload(request: Request): Promise<StructuredLogPayload> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const jsonBody = (await request.json().catch(() => null)) as
      | StructuredLogPayload
      | null;
    if (jsonBody && typeof jsonBody === "object") return jsonBody;
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return {
      event: "client_log_invalid_payload",
      level: "warn",
      kind: "event",
      status: "failure",
      message: "Missing request payload",
    };
  }

  const rawPayload = formData.get("payload");
  if (typeof rawPayload === "string" && rawPayload.trim()) {
    try {
      const parsed = JSON.parse(rawPayload) as StructuredLogPayload;
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      return {
        event: "client_log_invalid_payload",
        level: "warn",
        kind: "event",
        status: "failure",
        message: "Invalid log payload JSON",
      };
    }
  }

  const legacyLog = formData.get("log");
  return {
    event: "legacy_client_log",
    level: "info",
    kind: "event",
    status: "success",
    message: typeof legacyLog === "string" ? legacyLog : "Legacy client log",
    context: {
      legacy: true,
    },
  };
}

function pickNumber(source: Record<string, unknown> | undefined, key: string) {
  const value = source?.[key];
  return typeof value === "number" ? value : null;
}

/**
 * LCP 归因的可 grep 单行。用 `[perf][lcp]` 前缀 + 紧凑 JSON，方便直接在 Render
 * 日志里按前缀过滤，并由 `scripts/lcp-trend.mjs` 解析成分位数与归因分布。
 */
function buildLcpSummaryLine(payload: StructuredLogPayload): string | null {
  if (payload.event !== "lcp_diagnostics") return null;

  const context = payload.context ?? {};
  const navigation = context.navigation as Record<string, unknown> | undefined;
  const resources = context.resources as Record<string, unknown> | undefined;
  const environment = context.environment as Record<string, unknown> | undefined;
  const element = context.element as Record<string, unknown> | undefined;

  const scriptCount = pickNumber(resources, "scriptCount");
  const scriptCachedCount = pickNumber(resources, "scriptCachedCount");
  const coldLoad =
    scriptCount != null && scriptCachedCount != null
      ? scriptCachedCount < scriptCount / 2
      : null;

  return `[perf][lcp] ${safeJsonStringify({
    shop: payload.shop,
    route: payload.route,
    lcpMs: pickNumber(context, "lcpMs"),
    fcpMs: pickNumber(context, "fcpMs"),
    ttfbMs: pickNumber(navigation, "ttfbMs"),
    domContentLoadedMs: pickNumber(navigation, "domContentLoadedMs"),
    navType: navigation?.type,
    coldLoad,
    scriptBytes: pickNumber(resources, "scriptBytes"),
    slowestBlockingMs: pickNumber(resources, "slowestBlockingMs"),
    slowestBlocking: resources?.slowestBlockingName,
    element: element?.path ?? element?.tag ?? null,
    elementSize: pickNumber(element, "paintSize"),
    effectiveType: environment?.effectiveType,
    rttMs: pickNumber(environment, "rttMs"),
    reason: context.reportReason,
  })}`;
}

function shouldDropClientLog(payload: StructuredLogPayload): boolean {
  const consoleArgs = Array.isArray(payload.context?.consoleArgs)
    ? payload.context.consoleArgs
    : [];
  const consoleText = consoleArgs
    .map((item) => (typeof item === "string" ? item : safeJsonStringify(item)))
    .join(" ");
  const errorMessage = payload.error?.message || "";

  return /Unexpected value for attribute "loading" on <button>/i.test(
    `${consoleText} ${errorMessage}`,
  );
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const url = new URL(request.url);
  const payload = await readPayload(request);
  if (shouldDropClientLog(payload)) {
    return json({ ok: true, dropped: true });
  }
  const record = {
    source: "frontend",
    timestamp: payload.timestamp || new Date().toISOString(),
    event: payload.event || "client_log",
    action: payload.action,
    level: payload.level || "info",
    kind: payload.kind || "event",
    status: payload.status,
    shop: payload.shop,
    traceId: payload.traceId,
    route: payload.route,
    url: payload.url,
    message: payload.message,
    durationMs: payload.durationMs,
    request: {
      method: request.method,
      path: url.pathname,
      userAgent: request.headers.get("user-agent") || undefined,
      referer: request.headers.get("referer") || undefined,
      requestId: request.headers.get("x-request-id") || undefined,
      forwardedFor: request.headers.get("x-forwarded-for") || undefined,
    },
    context: payload.context,
    error: payload.error,
  };

  const lcpSummaryLine = buildLcpSummaryLine(payload);
  if (lcpSummaryLine) console.log(lcpSummaryLine);

  const line = `[client-log] ${safeJsonStringify(record)}`;
  if (record.level === "error") console.error(line);
  else if (record.level === "warn") console.warn(line);
  else console.log(line);

  return json({ ok: true });
};
