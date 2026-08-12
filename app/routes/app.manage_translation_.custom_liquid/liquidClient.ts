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

export async function selectLiquidCompat(_args: {
  migrated?: boolean;
  shop?: string;
}): Promise<{ success: boolean; response?: LiquidTableRow[]; errorMsg?: string }> {
  const res = await fetch("/api/translate-v4/liquid");
  const data = await res.json();
  if (!data.success) return data;
  const rows = (data.response ?? []).map((item: Record<string, unknown>) =>
    mapLiquidDoToRow(item),
  );
  return { success: true, response: rows };
}

export async function insertLiquidCompat(args: {
  migrated?: boolean;
  id?: string;
  shop?: string;
  sourceText: string;
  targetText: string;
  replacementMethod: boolean;
  languageCode: string;
}) {
  if (args.id) {
    return postTsfLiquid({
      intent: "update",
      id: args.id,
      sourceText: args.sourceText,
      targetText: args.targetText,
      replacementMethod: args.replacementMethod,
      languageCode: args.languageCode,
    });
  }
  return postTsfLiquid({
    intent: "insert",
    sourceText: args.sourceText,
    targetText: args.targetText,
    replacementMethod: args.replacementMethod,
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

export async function toggleLiquidReplacementMethodCompat(args: {
  migrated?: boolean;
  shop?: string;
  id: string;
}) {
  return postTsfLiquid({ intent: "toggleReplacementMethod", id: args.id });
}
