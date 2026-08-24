import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import {
  buildSlsPutLogsRequest,
  buildSlsSignatureMessage,
  encodeSlsLogGroup,
  isLlmOutputLogEnabled,
  readSlsConfig,
  resolveSlsEndpointHost,
  truncateLlmOutput,
} from "./llmOutputLog.js";

describe("isLlmOutputLogEnabled", () => {
  it("is off unless TRANSLATE_LLM_OUTPUT_LOG is exactly true", () => {
    assert.equal(isLlmOutputLogEnabled({}), false);
    assert.equal(isLlmOutputLogEnabled({ TRANSLATE_LLM_OUTPUT_LOG: "1" }), false);
    assert.equal(isLlmOutputLogEnabled({ TRANSLATE_LLM_OUTPUT_LOG: "TRUE" }), false);
    assert.equal(isLlmOutputLogEnabled({ TRANSLATE_LLM_OUTPUT_LOG: "true" }), true);
  });
});

describe("resolveSlsEndpointHost", () => {
  it("strips protocol and fills region-only hosts", () => {
    assert.equal(
      resolveSlsEndpointHost("https://cn-hangzhou.log.aliyuncs.com/", "cn-shanghai"),
      "cn-hangzhou.log.aliyuncs.com",
    );
    assert.equal(
      resolveSlsEndpointHost("cn-hangzhou", "ignored"),
      "cn-hangzhou.log.aliyuncs.com",
    );
  });
});

describe("readSlsConfig", () => {
  it("requires all Aliyun keys", () => {
    assert.equal(readSlsConfig({ ALIBABA_CLOUD_PROJECT: "p" }), null);
    const cfg = readSlsConfig({
      ALIBABA_CLOUD_ACCESS_KEY_ID: "id",
      ALIBABA_CLOUD_ACCESS_KEY_SECRET: "secret",
      ALIBABA_CLOUD_ENDPOINT: "cn-hangzhou.log.aliyuncs.com",
      ALIBABA_CLOUD_LOGSTORE: "store",
      ALIBABA_CLOUD_PROJECT: "proj",
      ALIBABA_CLOUD_REGION: "cn-hangzhou",
    });
    assert.deepEqual(cfg, {
      accessKeyId: "id",
      accessKeySecret: "secret",
      endpointHost: "cn-hangzhou.log.aliyuncs.com",
      logstore: "store",
      project: "proj",
    });
  });
});

describe("encodeSlsLogGroup", () => {
  it("encodes a single log content pair", () => {
    const buf = encodeSlsLogGroup({
      time: 1,
      contents: { a: "b" },
    });
    assert.equal(
      buf.toString("hex"),
      "0a0a080112060a0161120162",
    );
  });
});

describe("buildSlsPutLogsRequest", () => {
  it("signs gzip protobuf PutLogs", () => {
    const raw = encodeSlsLogGroup({ time: 1, contents: { a: "b" } });
    const date = "Mon, 24 Aug 2026 02:00:00 GMT";
    const req = buildSlsPutLogsRequest(
      {
        accessKeyId: "akid",
        accessKeySecret: "secret",
        endpointHost: "cn-hangzhou.log.aliyuncs.com",
        logstore: "store",
        project: "proj",
      },
      raw,
      date,
    );
    assert.equal(
      req.url,
      "https://proj.cn-hangzhou.log.aliyuncs.com/logstores/store/shards/lb",
    );
    assert.equal(req.headers["Content-Type"], "application/x-protobuf");
    assert.equal(req.headers["x-log-compresstype"], "gzip");
    assert.equal(req.headers["x-log-bodyrawsize"], String(raw.length));
    const message = buildSlsSignatureMessage({
      contentMd5: req.headers["Content-MD5"] ?? "",
      contentType: "application/x-protobuf",
      date,
      logHeaders: {
        "x-log-apiversion": req.headers["x-log-apiversion"] ?? "",
        "x-log-bodyrawsize": req.headers["x-log-bodyrawsize"] ?? "",
        "x-log-compresstype": req.headers["x-log-compresstype"] ?? "",
        "x-log-signaturemethod": req.headers["x-log-signaturemethod"] ?? "",
      },
      resource: "/logstores/store/shards/lb",
    });
    const expected = createHmac("sha1", "secret").update(message, "utf8").digest("base64");
    assert.equal(req.headers.Authorization, `LOG akid:${expected}`);
  });
});

describe("truncateLlmOutput", () => {
  it("keeps short output intact", () => {
    assert.deepEqual(truncateLlmOutput("hi"), { output: "hi", truncated: false });
  });
});
