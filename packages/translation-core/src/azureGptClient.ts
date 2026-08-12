/** Azure OpenAI (GPT) chat client — separate from DeepSeek key pool. */

import {
  AzureContentPolicyError,
  isAzureContentPolicyResponse,
  LlmRateLimitError,
  LlmTimeoutError,
  retryAfterMsFromResponse,
} from "./llmErrors.js";
import type { ApiUsageShape, ChatMessage } from "./deepseekClient.js";
import { requestIdFromHeaders, usageFromApi } from "./deepseekClient.js";

const GPT_ENDPOINT = (
  process.env.Gpt_Endpoint?.trim() || "https://eastus.api.cognitive.microsoft.com"
).replace(/\/+$/, "");
const GPT_API_VERSION = process.env.Gpt_ApiVersion?.trim() || "2024-10-21";
const GPT_DEFAULT_MODEL = process.env.Gpt_Model?.trim() || "gpt-4.1-nano";
const GPT_CONCURRENCY = Math.max(1, Number(process.env.GPT_CONCURRENCY) || 8);

/** Azure chat body 采样字段；`undefined` 表示不写入请求（用模型默认）。 */
export type GptChatSampling = {
  temperature?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
};

/** 精确模型覆盖（优先于前缀规则）。 */
const GPT_SAMPLING_BY_MODEL: Record<string, GptChatSampling> = {
  "gpt-4.1-nano": { temperature: 0.1, frequencyPenalty: 0, presencePenalty: 0 },
  "gpt-4.1-mini": { temperature: 0.1, frequencyPenalty: 0, presencePenalty: 0 },
  // gpt-5.6：Azure 仅支持默认 temperature(=1)；penalty 一并省略以免 400。
  "gpt-5.6-luna": {},
  "gpt-5.6-terra": {},
};

const GPT_SAMPLING_LEGACY_4X: GptChatSampling = {
  temperature: 0.1,
  frequencyPenalty: 0,
  presencePenalty: 0,
};

/** 解析某 GPT deployment 的采样配置（精确名 → 前缀 → 4.x 默认）。 */
export function resolveGptChatSampling(model: string): GptChatSampling {
  const key = model.trim().toLowerCase();
  if (!key) return GPT_SAMPLING_LEGACY_4X;
  const exact = GPT_SAMPLING_BY_MODEL[key];
  if (exact) return exact;
  if (key.startsWith("gpt-5.6") || key.startsWith("gpt-5.")) return {};
  return GPT_SAMPLING_LEGACY_4X;
}

/** 组装 Azure chat/completions JSON body（按模型省略不支持的采样字段）。 */
export function buildGptChatRequestBody(
  model: string,
  messages: ChatMessage[],
): Record<string, unknown> {
  const sampling = resolveGptChatSampling(model);
  const body: Record<string, unknown> = {
    messages,
    response_format: { type: "json_object" },
  };
  if (sampling.temperature !== undefined) body.temperature = sampling.temperature;
  if (sampling.frequencyPenalty !== undefined) {
    body.frequency_penalty = sampling.frequencyPenalty;
  }
  if (sampling.presencePenalty !== undefined) {
    body.presence_penalty = sampling.presencePenalty;
  }
  return body;
}

function gptApiKey(): string | null {
  return process.env.Gpt_ApiKey?.trim() || null;
}
export function gptConfigured(): boolean {
  return Boolean(gptApiKey());
}
/** 该 aiModel 是否走 GPT（gpt-* 前缀）且已配置 key。 */
export function isGptModel(aiModel: string | undefined | null): boolean {
  return gptConfigured() && /^gpt[-.]/i.test((aiModel ?? "").trim());
}
/** 规范化 gpt 模型名（空/非法回退默认 nano）。 */
export function resolveGptModel(aiModel: string | undefined | null): string {
  const m = (aiModel ?? "").trim();
  return /^gpt[-.]/i.test(m) ? m : GPT_DEFAULT_MODEL;
}

// 简易并发闸（Azure OpenAI 按 TPM/RPM 限流，保守并发 + 429 退避足矣）。
let _gptInFlight = 0;
const _gptWaiters: Array<() => void> = [];
async function gptAcquire(): Promise<void> {
  if (_gptInFlight < GPT_CONCURRENCY) {
    _gptInFlight++;
    return;
  }
  await new Promise<void>((resolve) => _gptWaiters.push(resolve));
  _gptInFlight++;
}
function gptRelease(): void {
  _gptInFlight--;
  const next = _gptWaiters.shift();
  if (next) next();
}

/** 非流式调用 Azure OpenAI chat completions，带 429 重试。返回原始 content + token。 */
export async function callAzureOpenAIChat(
  model: string,
  messages: ChatMessage[],
  timeoutMs: number,
): Promise<{
  raw: string;
  tokens: number;
  inputTokens?: number;
  outputTokens?: number;
  promptCacheHitTokens?: number;
  promptCacheMissTokens?: number;
  requestId?: string;
}> {
  const key = gptApiKey();
  if (!key) throw new Error("Gpt_ApiKey 未配置");
  const url = `${GPT_ENDPOINT}/openai/deployments/${encodeURIComponent(model)}/chat/completions?api-version=${GPT_API_VERSION}`;

  await gptAcquire();
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(new LlmTimeoutError("hard")),
        timeoutMs,
      );
      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "api-key": key },
          body: JSON.stringify(buildGptChatRequestBody(model, messages)),
          signal: controller.signal,
        });
        if (resp.status === 429) {
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, retryAfterMsFromResponse(resp, 5)));
            continue;
          }
          throw new LlmRateLimitError(resp);
        }
        if (!resp.ok) {
          const body = await resp.text();
          if (isAzureContentPolicyResponse(resp.status, body)) {
            throw new AzureContentPolicyError();
          }
          throw new Error(`LLM HTTP ${resp.status}: ${body}`);
        }
        const j = (await resp.json()) as {
          id?: string;
          choices?: Array<{ message?: { content?: string | null } }>;
          usage?: ApiUsageShape;
        };
        const u = usageFromApi(j.usage);
        return {
          raw: j.choices?.[0]?.message?.content || "{}",
          tokens: u.tokens,
          inputTokens: u.inputTokens,
          outputTokens: u.outputTokens,
          promptCacheHitTokens: u.promptCacheHitTokens,
          promptCacheMissTokens: u.promptCacheMissTokens,
          requestId:
            (typeof j.id === "string" && j.id.trim()) || requestIdFromHeaders(resp.headers) || undefined,
        };
      } catch (e) {
        if (controller.signal.aborted && controller.signal.reason instanceof LlmTimeoutError) {
          throw controller.signal.reason;
        }
        if (attempt < 2 && !(e instanceof LlmRateLimitError)) {
          // 短暂网络抖动重试一次；解析/超时类交给上层 gatherTranslations 拆分重试。
        }
        throw e;
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error("GPT retries exhausted");
  } finally {
    gptRelease();
  }
}
