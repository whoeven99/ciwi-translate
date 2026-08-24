import { createHash, createHmac } from "node:crypto";
import { deflateSync } from "node:zlib";

const LOG_PREFIX = "[llm-out]";
const API_VERSION = "0.6.0";
const MAX_OUTPUT_CHARS = 64_000;
const SLS_TIMEOUT_MS = 10_000;
/** Default per-call sample rate when `TRANSLATE_LLM_OUTPUT_LOG=true`. */
const DEFAULT_SAMPLE = 0.3;

export type LlmOutputLogRecord = {
  shopName?: string;
  model: string;
  raw: string;
  tokens: number;
  requestId?: string;
};

export type SlsConfig = {
  accessKeyId: string;
  accessKeySecret: string;
  endpointHost: string;
  logstore: string;
  project: string;
};

type LlmOutputPayload = {
  shop: string;
  model: string;
  requestId: string;
  tokens: number;
  output: string;
  truncated: boolean;
  sample: string;
};

let slsConfigWarned = false;

export function isLlmOutputLogEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.TRANSLATE_LLM_OUTPUT_LOG?.trim() === "true";
}

export function readLlmOutputLogSample(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.TRANSLATE_LLM_OUTPUT_LOG_SAMPLE?.trim();
  if (!raw) return DEFAULT_SAMPLE;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_SAMPLE;
  return Math.min(1, Math.max(0, n));
}

export function shouldSampleLlmOutput(
  env: NodeJS.ProcessEnv = process.env,
  random: () => number = Math.random,
): boolean {
  return random() < readLlmOutputLogSample(env);
}

export function resolveSlsEndpointHost(endpoint: string, region: string): string {
  let host = endpoint.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!host) host = region.trim();
  if (host && !host.includes(".")) {
    host = `${host}.log.aliyuncs.com`;
  }
  return host;
}

export function readSlsConfig(
  env: NodeJS.ProcessEnv = process.env,
): SlsConfig | null {
  const accessKeyId = env.ALIBABA_CLOUD_ACCESS_KEY_ID?.trim() ?? "";
  const accessKeySecret = env.ALIBABA_CLOUD_ACCESS_KEY_SECRET?.trim() ?? "";
  const endpoint = env.ALIBABA_CLOUD_ENDPOINT?.trim() ?? "";
  const logstore = env.ALIBABA_CLOUD_LOGSTORE?.trim() ?? "";
  const project = env.ALIBABA_CLOUD_PROJECT?.trim() ?? "";
  const region = env.ALIBABA_CLOUD_REGION?.trim() ?? "";
  const endpointHost = resolveSlsEndpointHost(endpoint, region);
  if (!accessKeyId || !accessKeySecret || !endpointHost || !logstore || !project) {
    return null;
  }
  return { accessKeyId, accessKeySecret, endpointHost, logstore, project };
}

export function truncateLlmOutput(raw: string): { output: string; truncated: boolean } {
  if (raw.length <= MAX_OUTPUT_CHARS) return { output: raw, truncated: false };
  return { output: raw.slice(0, MAX_OUTPUT_CHARS), truncated: true };
}

function encodeVarint(value: number): Buffer {
  const bytes: number[] = [];
  let n = value >>> 0;
  while (n > 0x7f) {
    bytes.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  bytes.push(n);
  return Buffer.from(bytes);
}

function tag(field: number, wire: number): Buffer {
  return encodeVarint((field << 3) | wire);
}

function encodeString(field: number, value: string): Buffer {
  const data = Buffer.from(value, "utf8");
  return Buffer.concat([tag(field, 2), encodeVarint(data.length), data]);
}

function encodeUint32(field: number, value: number): Buffer {
  return Buffer.concat([tag(field, 0), encodeVarint(value)]);
}

function encodeEmbedded(field: number, message: Buffer): Buffer {
  return Buffer.concat([tag(field, 2), encodeVarint(message.length), message]);
}

function encodeContent(key: string, value: string): Buffer {
  return Buffer.concat([encodeString(1, key), encodeString(2, value)]);
}

function encodeLog(time: number, contents: Record<string, string>): Buffer {
  const parts: Buffer[] = [encodeUint32(1, time)];
  for (const [key, value] of Object.entries(contents)) {
    parts.push(encodeEmbedded(2, encodeContent(key, value)));
  }
  return Buffer.concat(parts);
}

export function encodeSlsLogGroup(opts: {
  time: number;
  contents: Record<string, string>;
  topic?: string;
  source?: string;
}): Buffer {
  const parts: Buffer[] = [encodeEmbedded(1, encodeLog(opts.time, opts.contents))];
  if (opts.topic) parts.push(encodeString(3, opts.topic));
  if (opts.source) parts.push(encodeString(4, opts.source));
  return Buffer.concat(parts);
}

export function buildSlsSignatureMessage(opts: {
  contentMd5: string;
  contentType: string;
  date: string;
  logHeaders: Record<string, string>;
  resource: string;
}): string {
  const canonicalHeaders = Object.keys(opts.logHeaders)
    .sort()
    .map((key) => `${key}:${opts.logHeaders[key]}`)
    .join("\n");
  return [
    "POST",
    opts.contentMd5,
    opts.contentType,
    opts.date,
    canonicalHeaders,
    opts.resource,
  ].join("\n");
}

function md5UpperHex(body: Buffer): string {
  return createHash("md5").update(body).digest("hex").toUpperCase();
}

function signSls(secret: string, message: string): string {
  return createHmac("sha1", secret).update(message, "utf8").digest("base64");
}

export function buildSlsPutLogsRequest(
  cfg: SlsConfig,
  rawProtobuf: Buffer,
  date: string,
): { url: string; headers: Record<string, string>; body: Buffer } {
  const body = deflateSync(rawProtobuf);
  const contentType = "application/x-protobuf";
  const contentMd5 = md5UpperHex(body);
  const resource = `/logstores/${cfg.logstore}/shards/lb`;
  const logHeaders = {
    "x-log-apiversion": API_VERSION,
    "x-log-bodyrawsize": String(rawProtobuf.length),
    "x-log-compresstype": "deflate",
    "x-log-signaturemethod": "hmac-sha1",
  };
  const message = buildSlsSignatureMessage({
    contentMd5,
    contentType,
    date,
    logHeaders,
    resource,
  });
  const signature = signSls(cfg.accessKeySecret, message);
  return {
    url: `https://${cfg.project}.${cfg.endpointHost}${resource}`,
    headers: {
      Accept: "application/json",
      Authorization: `LOG ${cfg.accessKeyId}:${signature}`,
      "Content-MD5": contentMd5,
      "Content-Type": contentType,
      Date: date,
      ...logHeaders,
    },
    body,
  };
}

async function putSlsLog(cfg: SlsConfig, payload: LlmOutputPayload): Promise<void> {
  const rawProtobuf = encodeSlsLogGroup({
    time: Math.floor(Date.now() / 1000),
    contents: {
      shop: payload.shop,
      model: payload.model,
      requestId: payload.requestId,
      tokens: String(payload.tokens),
      output: payload.output,
      truncated: payload.truncated ? "1" : "0",
      sample: payload.sample,
    },
    topic: "llm-out",
    source: process.env.RENDER_SERVICE_NAME?.trim() || "ciwi",
  });
  const req = buildSlsPutLogsRequest(cfg, rawProtobuf, new Date().toUTCString());
  const res = await fetch(req.url, {
    method: "POST",
    headers: req.headers,
    body: new Uint8Array(req.body),
    signal: AbortSignal.timeout(SLS_TIMEOUT_MS),
  });
  if (res.ok) return;
  const detail = await res.text().catch(() => "");
  throw new Error(`HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
}

export function llmOutputLogDest(
  env: NodeJS.ProcessEnv = process.env,
): "off" | "sls" | "stdout" {
  if (!isLlmOutputLogEnabled(env)) return "off";
  return readSlsConfig(env) ? "sls" : "stdout";
}

export function logLlmOutput(
  record: LlmOutputLogRecord,
  env: NodeJS.ProcessEnv = process.env,
  random: () => number = Math.random,
): void {
  const dest = llmOutputLogDest(env);
  if (dest === "off") return;
  if (!shouldSampleLlmOutput(env, random)) return;
  const sample = readLlmOutputLogSample(env);
  const { output, truncated } = truncateLlmOutput(record.raw);
  const payload: LlmOutputPayload = {
    shop: record.shopName ?? "",
    model: record.model,
    requestId: record.requestId ?? "",
    tokens: record.tokens,
    output,
    truncated,
    sample: String(sample),
  };
  if (dest === "stdout") {
    if (!slsConfigWarned) {
      slsConfigWarned = true;
      console.warn(`${LOG_PREFIX} SLS env incomplete, stdout only`);
    }
    console.log(`${LOG_PREFIX} ${JSON.stringify(payload)}`);
    return;
  }
  const cfg = readSlsConfig(env);
  if (!cfg) return;
  void putSlsLog(cfg, payload).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`${LOG_PREFIX} SLS put failed: ${msg}`);
  });
}
