export type LiquidTableRow = {
  key: string;
  sourceText: string;
  targetText: string;
  replacementMethod: boolean;
  languageCode: string;
  source: string;
  status: string;
};

function mapLiquidDoToRow(item: Record<string, unknown>): LiquidTableRow {
  return {
    key: String(item?.id ?? ""),
    sourceText: String(item?.liquidBeforeTranslation ?? ""),
    targetText: String(item?.liquidAfterTranslation ?? ""),
    replacementMethod: Boolean(item?.replacementMethod),
    languageCode: String(item?.languageCode ?? ""),
    source: String(item?.source ?? "manual"),
    status: String(item?.status ?? "DONE"),
  };
}

async function postTsfLiquid(body: Record<string, unknown>) {
  const res = await fetch("/api/translate-v4/liquid", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function selectLiquidCompat(args: {
  languageCode: string;
  q?: string;
  page?: number;
  pageSize?: number;
  signal?: AbortSignal;
}): Promise<{
  success: boolean;
  aborted?: boolean;
  response?: LiquidTableRow[];
  hasNext?: boolean;
  errorMsg?: string;
}> {
  const params = new URLSearchParams();
  params.set("languageCode", args.languageCode);
  if (args.q) params.set("q", args.q);
  params.set("page", String(args.page ?? 1));
  params.set("pageSize", String(args.pageSize ?? 10));
  try {
    const res = await fetch(`/api/translate-v4/liquid?${params.toString()}`, {
      signal: args.signal,
    });
    const data = await res.json();
    if (!data.success) return data;
    const payload = (data.response ?? {}) as {
      rows?: Record<string, unknown>[];
      hasNext?: boolean;
    };
    const rows = (payload.rows ?? []).map((item) => mapLiquidDoToRow(item));
    return { success: true, response: rows, hasNext: Boolean(payload.hasNext) };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { success: false, aborted: true };
    }
    throw err;
  }
}

export async function insertLiquidCompat(args: {
  migrated?: boolean;
  id?: string;
  shop?: string;
  sourceText: string;
  targetText: string;
  replacementMethod?: boolean;
  languageCode: string;
}) {
  if (args.id) {
    return postTsfLiquid({
      intent: "update",
      id: args.id,
      sourceText: args.sourceText,
      targetText: args.targetText,
      languageCode: args.languageCode,
      ...(args.replacementMethod != null
        ? { replacementMethod: args.replacementMethod }
        : {}),
    });
  }
  return postTsfLiquid({
    intent: "insert",
    sourceText: args.sourceText,
    targetText: args.targetText,
    replacementMethod: args.replacementMethod ?? false,
    languageCode: args.languageCode,
  });
}

export async function deleteLiquidCompat(args: {
  migrated?: boolean;
  shop?: string;
  ids: string[];
}) {
  return postTsfLiquid({ intent: "delete", ids: args.ids });
}
