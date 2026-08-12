import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildGptChatRequestBody,
  resolveGptChatSampling,
} from "./llmTranslate.js";

describe("resolveGptChatSampling", () => {
  it("keeps low temperature for gpt-4.1 models", () => {
    assert.deepEqual(resolveGptChatSampling("gpt-4.1-nano"), {
      temperature: 0.1,
      frequencyPenalty: 0,
      presencePenalty: 0,
    });
    assert.deepEqual(resolveGptChatSampling("gpt-4.1-mini"), {
      temperature: 0.1,
      frequencyPenalty: 0,
      presencePenalty: 0,
    });
  });

  it("omits sampling fields for gpt-5.6 models", () => {
    assert.deepEqual(resolveGptChatSampling("gpt-5.6-luna"), {});
    assert.deepEqual(resolveGptChatSampling("gpt-5.6-terra"), {});
  });

  it("falls back by prefix for unknown gpt-5 / gpt-4 ids", () => {
    assert.deepEqual(resolveGptChatSampling("gpt-5.6-future"), {});
    assert.deepEqual(resolveGptChatSampling("gpt-4.1-future"), {
      temperature: 0.1,
      frequencyPenalty: 0,
      presencePenalty: 0,
    });
  });
});

describe("buildGptChatRequestBody", () => {
  const messages = [{ role: "user" as const, content: "hi" }];

  it("includes temperature for 4.1", () => {
    const body = buildGptChatRequestBody("gpt-4.1-nano", messages);
    assert.equal(body.temperature, 0.1);
    assert.equal(body.frequency_penalty, 0);
    assert.equal(body.presence_penalty, 0);
    assert.deepEqual(body.response_format, { type: "json_object" });
    assert.deepEqual(body.messages, messages);
  });

  it("omits temperature and penalties for 5.6", () => {
    const body = buildGptChatRequestBody("gpt-5.6-luna", messages);
    assert.equal("temperature" in body, false);
    assert.equal("frequency_penalty" in body, false);
    assert.equal("presence_penalty" in body, false);
    assert.deepEqual(body.response_format, { type: "json_object" });
    assert.deepEqual(body.messages, messages);
  });
});
