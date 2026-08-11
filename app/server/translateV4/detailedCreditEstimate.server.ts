/**
 * 详细额度预估：单 locale × 单 v4 module 拉 Shopify 可译字段，
 * 拆叶子后查 value-TM，只对 miss 字符按 chars×k 估积分。
 */
import "./translationCoreRuntime.server";
import {
  classifyField,
  isGptModel,
  resolveGptModel,
  resolveModel,
} from "@ciwi/translation-core/llm-translate";
import { htmlNodePartsOf } from "@ciwi/translation-core/html-translate";
import {
  extractJsonTextSlots,
  tryParseJsonContainer,
} from "@ciwi/translation-core/json-extract-rules";
import { shouldIncludeFieldV2 } from "@ciwi/translation-core/translation-filter";
import { isTranslatableLeafText } from "@ciwi/translation-core/translate-quality";
import { tmMGetByValue } from "@ciwi/translation-core/translation-memory";
import { getShopCreditQuota } from "~/server/billing/quota/quotaRouter.server";
import { sumPendingLiquidChars } from "./liquidRule.server";
import { estimateCreditsFromChars } from "./creditEstimate.server";
import type { AdminGraphqlClient } from "./itemsCount.server";

const PAGE_SIZE = 250;
const LONG_TEXT_THRESHOLD = Math.max(
  500,
  Number(process.env.TRANSLATE_LONG_TEXT_THRESHOLD) || 3_000,
);
const LONG_TEXT_CHUNK_CHARS = Math.max(
  400,
  Number(process.env.TRANSLATE_LONG_TEXT_CHUNK_CHARS) || 2_500,
);

/** 与 create-task / Worker TM 写入主键对齐的 cacheModel。 */
export function resolveTmCacheModel(aiModel: string): string {
  const m = (aiModel ?? "").trim();
  if (!m || m === "google-translate" || m.toLowerCase().startsWith("google")) {
    return "google-translate";
  }
  if (isGptModel(m)) return resolveGptModel(m);
  return resolveModel(m);
}

const TRANSLATABLE_RESOURCES_QUERY = `#graphql
  query DetailedEstimateTranslatableResources(
    $resourceType: TranslatableResourceType!
    $first: Int!
    $locale: String!
    $after: String
  ) {
    translatableResources(resourceType: $resourceType, first: $first, after: $after) {
      edges {
        node {
          translations(locale: $locale) {
            key
            value
            outdated
          }
          translatableContent {
            key
            value
            type
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }`;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function adminGraphqlJson(
  admin: AdminGraphqlClient,
  query: string,
  variables: Record<string, unknown>,
  retries = 2,
): Promise<any> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await admin.graphql(query, { variables });
      const data = await response.json();
      const errors = data?.errors as Array<{ message?: string }> | undefined;
      if (errors?.length) {
        const msg = errors.map((e) => e.message ?? "GraphQL error").join("; ");
        const throttled = /throttl|rate limit|429/i.test(msg);
        if (throttled && attempt < retries) {
          await sleep(1200 * (attempt + 1));
          continue;
        }
        throw new Error(msg);
      }
      return data;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await sleep(1200 * (attempt + 1));
        continue;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** 与 llmTranslate.splitPlainText 同阈值，避免为 estimate 改 core export。 */
function splitPlainText(text: string): string[] {
  if (text.length <= LONG_TEXT_THRESHOLD) return [text];
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > LONG_TEXT_CHUNK_CHARS) {
    let splitIdx = -1;
    const paraIdx = remaining.lastIndexOf("\n\n", LONG_TEXT_CHUNK_CHARS);
    if (paraIdx >= LONG_TEXT_CHUNK_CHARS * 0.4) splitIdx = paraIdx + 2;
    if (splitIdx < 0) {
      const sentIdx = remaining.lastIndexOf(". ", LONG_TEXT_CHUNK_CHARS);
      if (sentIdx >= LONG_TEXT_CHUNK_CHARS * 0.4) splitIdx = sentIdx + 2;
    }
    if (splitIdx <= 0) {
      const wordIdx = remaining.lastIndexOf(" ", LONG_TEXT_CHUNK_CHARS);
      splitIdx = wordIdx > 0 ? wordIdx : LONG_TEXT_CHUNK_CHARS;
    }
    parts.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }
  if (remaining.length > 0) parts.push(remaining);
  return parts;
}

function collectLeafTexts(
  key: string,
  value: string,
  shopifyType?: string | null,
): string[] {
  const klass = classifyField(key, value, shopifyType ?? undefined);
  if (klass === "skip") return [];
  if (klass === "html" || klass === "liquid_html") {
    const leaves: string[] = [];
    for (const parts of htmlNodePartsOf(value).nodeParts) {
      for (const part of parts) {
        if (isTranslatableLeafText(part)) leaves.push(part);
      }
    }
    return leaves;
  }
  if (klass === "json") {
    const root = tryParseJsonContainer(value);
    if (root === undefined) return [];
    const leaves: string[] = [];
    for (const slot of extractJsonTextSlots(root)) {
      if (slot.isHtml) {
        for (const parts of htmlNodePartsOf(slot.text).nodeParts) {
          for (const part of parts) {
            if (isTranslatableLeafText(part)) leaves.push(part);
          }
        }
      } else if (isTranslatableLeafText(slot.text)) {
        leaves.push(slot.text);
      }
    }
    return leaves;
  }
  if (klass === "list") {
    try {
      const list = JSON.parse(value) as Array<string | null>;
      if (!Array.isArray(list)) return [];
      const leaves: string[] = [];
      for (const el of list) {
        if (!el) continue;
        if (classifyField(key, el) === "html" || /<[a-z][\s\S]*>/i.test(el)) {
          for (const parts of htmlNodePartsOf(el).nodeParts) {
            for (const part of parts) {
              if (isTranslatableLeafText(part)) leaves.push(part);
            }
          }
        } else if (isTranslatableLeafText(el)) {
          leaves.push(el);
        }
      }
      return leaves;
    } catch {
      return [];
    }
  }
  return splitPlainText(value).filter((p) => isTranslatableLeafText(p));
}

export type DetailedEstimateShardResult = {
  target: string;
  module: string;
  missChars: number;
  hitChars: number;
  missLeaves: number;
  hitLeaves: number;
  estimatedCredits: number;
  remainingCredits: number;
};

/**
 * 扫描一个 v4 module：filter → 拆叶 → TM → miss 字符估积分。
 * 同 module 内按唯一 leaf 文本去重（对齐 pool 去重后再打 LLM）。
 */
export async function estimateDetailedModuleShard(args: {
  admin: AdminGraphqlClient;
  shop: string;
  source: string;
  target: string;
  module: string;
  isCover: boolean;
  isHandle: boolean;
  aiModel: string;
}): Promise<DetailedEstimateShardResult> {
  const {
    admin,
    shop,
    source,
    target,
    module,
    isCover,
    isHandle,
    aiModel,
  } = args;
  const cacheModel = resolveTmCacheModel(aiModel);
  const uniqueLeaves = new Set<string>();
  let after: string | null = null;

  for (;;) {
    const data = await adminGraphqlJson(admin, TRANSLATABLE_RESOURCES_QUERY, {
      resourceType: module,
      first: PAGE_SIZE,
      locale: target,
      after,
    });
    const conn = data?.data?.translatableResources;
    const edges: Array<{
      node: {
        translations?: Array<{
          key: string;
          value?: string | null;
          outdated?: boolean | null;
        }> | null;
        translatableContent?: Array<{
          key: string;
          value: string;
          type?: string | null;
        }> | null;
      };
    }> = conn?.edges ?? [];

    for (const edge of edges) {
      const node = edge.node;
      const translations = node.translations ?? [];
      for (const content of node.translatableContent ?? []) {
        const includable = shouldIncludeFieldV2(
          { key: content.key, value: content.value, type: content.type },
          translations,
          { module, isCover, isHandle },
        );
        if (!includable) continue;
        for (const leaf of collectLeafTexts(
          content.key,
          content.value,
          content.type,
        )) {
          uniqueLeaves.add(leaf);
        }
      }
    }

    if (!conn?.pageInfo?.hasNextPage) break;
    after = conn.pageInfo.endCursor ?? null;
    if (!after) break;
  }

  const leaves = [...uniqueLeaves];
  let hitChars = 0;
  let missChars = 0;
  let hitLeaves = 0;
  let missLeaves = 0;

  if (leaves.length > 0) {
    const hits = await tmMGetByValue(
      leaves.map((sourceText) => ({ sourceText, model: cacheModel })),
      source,
      target,
    );
    for (let i = 0; i < leaves.length; i++) {
      const text = leaves[i]!;
      const len = text.length;
      if (hits[i] != null) {
        hitChars += len;
        hitLeaves += 1;
      } else {
        missChars += len;
        missLeaves += 1;
      }
    }
  }

  const estimatedCredits =
    missChars > 0 ? estimateCreditsFromChars(missChars) : 0;
  const quota = await getShopCreditQuota(shop).catch(() => null);
  const remainingCredits = Math.max(0, Math.floor(quota?.remaining ?? 0));

  return {
    target,
    module,
    missChars,
    hitChars,
    missLeaves,
    hitLeaves,
    estimatedCredits,
    remainingCredits,
  };
}

/** 自定义 Liquid PENDING 字符（无叶子 TM，整段按 miss 估）。 */
export async function estimateDetailedLiquidShard(args: {
  shop: string;
  targets: string[];
}): Promise<DetailedEstimateShardResult> {
  const liquidChars = await sumPendingLiquidChars(args.shop, args.targets).catch(
    () => 0,
  );
  const estimatedCredits =
    liquidChars > 0 ? estimateCreditsFromChars(liquidChars) : 0;
  const quota = await getShopCreditQuota(args.shop).catch(() => null);
  const remainingCredits = Math.max(0, Math.floor(quota?.remaining ?? 0));
  return {
    target: args.targets.join(",") || "*",
    module: "__liquid__",
    missChars: liquidChars,
    hitChars: 0,
    missLeaves: liquidChars > 0 ? 1 : 0,
    hitLeaves: 0,
    estimatedCredits,
    remainingCredits,
  };
}
