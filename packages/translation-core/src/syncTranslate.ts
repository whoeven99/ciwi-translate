import { createHash } from "node:crypto";
import {
  isGoogleUsageModel,
  translateResources,
  type EngineUsage,
  type TranslateItem,
} from "./llmTranslate.js";

/** 与批量任务默认模型一致（Cosmos job.aiModel 未指定时的回退）。 */
export function resolveDefaultAiModel(): string {
  return (
    process.env.DEEPSEEK_MODEL?.trim() ||
    process.env.Gpt_Model?.trim() ||
    "deepseek-v4-flash"
  );
}

function fieldDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function sumUsageByEngine(usage: EngineUsage): {
  llmTokens: number;
  googleCredits: number;
} {
  let llmTokens = 0;
  let googleCredits = 0;
  for (const [model, row] of Object.entries(usage)) {
    const n = row.tokens ?? 0;
    if (isGoogleUsageModel(model)) googleCredits += n;
    else llmTokens += n;
  }
  return { llmTokens, googleCredits };
}

export type TranslateSingleFieldArgs = {
  shop: string;
  target: string;
  text: string;
  /** 源语言 locale；影响 alreadyInTarget / TM value cache。默认 en。 */
  source?: string;
  aiModel?: string;
  /** 店铺画像上下文：注入 system prompt，仅用于引导风格/术语，不直接出现在输出中。 */
  profileBlock?: string;
  /** 字段 key，影响 handle 路由与 classifyField。默认 value。 */
  fieldKey?: string;
  shopifyType?: string;
  /** 用户自定义提示词：描述本次翻译方向/风格，注入 system prompt。 */
  customPrompt?: string;
};

export type TranslateSingleFieldResult = {
  translatedText: string;
  /** LLM API 原始 token 合计（未乘 QUOTA_TOKEN_MULTIPLIER）。 */
  usedTokens: number;
  /** Google 已换算的商户积分（chars×GOOGLE_CREDITS_PER_CHAR，不再乘模型系数）。 */
  googleCredits: number;
  status: "translated" | "fallback";
  /** 额度软停：非异常，调用方应停止继续花费。 */
  quotaStopped?: boolean;
};

/**
 * 单字段同步翻译 —— 与自动任务 translateWorker 共用 translateResources 管线：
 * TM 缓存、Google/LLM 路由、HTML/JSON/list 分类、术语表、质量校验与 fallback 重试。
 */
export async function translateSingleField(
  args: TranslateSingleFieldArgs,
): Promise<TranslateSingleFieldResult> {
  const text = args.text ?? "";
  if (!text.trim()) {
    return { translatedText: text, usedTokens: 0, googleCredits: 0, status: "translated" };
  }

  const source = (args.source ?? "en").trim() || "en";
  const target = args.target.trim();
  const fieldKey = args.fieldKey?.trim() || "value";
  const aiModel = args.aiModel?.trim() || resolveDefaultAiModel();

  console.log("[single] request", {
    shop: args.shop,
    source,
    target,
    fieldKey,
    shopifyType: args.shopifyType,
    aiModel,
    original: text,
    hasProfileBlock: Boolean(args.profileBlock?.trim()),
    customPrompt: args.customPrompt ?? "",
  });

  const item: TranslateItem = {
    key: fieldKey,
    value: text,
    digest: fieldDigest(text),
    shopifyType: args.shopifyType,
  };

  const { resources, usage, quotaStopped } = await translateResources(
    [{ resourceId: "__single__", fields: [item] }],
    source,
    target,
    aiModel,
    args.shop,
    undefined,
    undefined,
    undefined,
    {
      profileBlock: args.profileBlock,
      customPrompt: args.customPrompt,
      // 管理翻译页手动点击：不读缓存、强制 LLM，译后写回 TM。
      skipCacheRead: true,
      skipCacheWrite: false,
      logSingleTranslate: true,
    },
  );

  const result = resources[0]?.results[0];
  const translatedText = result?.translatedValue ?? text;
  const status = result?.status ?? "fallback";
  const { llmTokens: usedTokens, googleCredits } = sumUsageByEngine(usage);

  // 管理页单条：质量校验/拼装后的最终译文（完整不截断）。
  console.log("[single] result", {
    shop: args.shop,
    source,
    target,
    fieldKey,
    shopifyType: args.shopifyType,
    aiModel,
    original: text,
    translated: translatedText,
    status,
    hasProfileBlock: Boolean(args.profileBlock?.trim()),
    prompt: args.customPrompt ?? "",
    usedTokens,
    googleCredits,
    quotaStopped: Boolean(quotaStopped),
  });

  return {
    translatedText,
    usedTokens,
    googleCredits,
    status,
    quotaStopped: quotaStopped || undefined,
  };
}
