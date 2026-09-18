/**
 * 单字段手动翻译积分预估：拼与线上一致的 system prompt（含 glossary / profile），
 * 再按字符粗估 token，最后按模型 × 额度系数（DeepSeek 默认 1）。
 */
import "./translationCoreRuntime.server";
import {
  estimateSingleTranslateLlmTokens,
  loadGlossaryEntries,
  selectGlossaryLinesForTexts,
} from "@ciwi/translation-core";
import { loadShopProfilePromptBlock } from "./shopProfileContext.server";
import { llmTokensToQuotaCredits } from "./quotaMultiplier.server";

export type SingleTranslateCreditEstimate = {
  estimatedCredits: number;
  estimatedTokens: number;
  inputTokens: number;
  outputTokens: number;
  systemPromptChars: number;
  userMessageChars: number;
};

export async function estimateSingleTranslateCredits(args: {
  shop: string;
  sourceText: string;
  target: string;
  fieldKey?: string;
  customPrompt?: string;
  aiModel?: string;
}): Promise<SingleTranslateCreditEstimate> {
  const sourceText = args.sourceText ?? "";
  const target = args.target.trim();
  if (!sourceText.trim() || !target) {
    return {
      estimatedCredits: 0,
      estimatedTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      systemPromptChars: 0,
      userMessageChars: 0,
    };
  }

  const [profileBlock, glossaryEntries] = await Promise.all([
    loadShopProfilePromptBlock(args.shop),
    loadGlossaryEntries(args.shop, target),
  ]);
  // 与线上一致：只有文本命中的术语才进 prompt，否则预估会虚高。
  const glossaryLines = selectGlossaryLinesForTexts(glossaryEntries, [sourceText]);

  const tokenEst = estimateSingleTranslateLlmTokens({
    sourceText,
    target,
    fieldKey: args.fieldKey,
    glossaryLines,
    profileBlock,
    customPrompt: args.customPrompt,
  });

  return {
    estimatedCredits: llmTokensToQuotaCredits(
      tokenEst.estimatedTokens,
      args.aiModel,
    ),
    estimatedTokens: tokenEst.estimatedTokens,
    inputTokens: tokenEst.inputTokens,
    outputTokens: tokenEst.outputTokens,
    systemPromptChars: tokenEst.systemPromptChars,
    userMessageChars: tokenEst.userMessageChars,
  };
}
