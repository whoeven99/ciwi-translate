/**
 * Shared Shopify Bulk Operations primitives (submit / poll / cancel / JSONL stream
 * / sliding-window queue). Used by translation init and shop scan metrics.
 *
 * Env (shared; INIT_BULK_* kept as backward-compatible aliases):
 *   SHOPIFY_BULK_SUBMIT_WINDOW / INIT_BULK_SUBMIT_WINDOW (default 5)
 *   SHOPIFY_BULK_POLL_MS / INIT_BULK_POLL_MS (default 1000)
 *   SHOPIFY_BULK_DOWNLOAD_CONCURRENCY / INIT_BULK_DOWNLOAD_CONCURRENCY (default 5)
 *   SHOPIFY_BULK_TIMEOUT_MS / INIT_BULK_TIMEOUT_MS (default 6h)
 *   SHOPIFY_BULK_SUBMIT_MAX_RETRIES (default 24; slot busy / throttle)
 *
 * Fatal: missing Turso offline Session aborts the whole shop queue (no poll
 * spin / no requeue) — typical after APP_UNINSTALLED mid-init.
 */
import { createInterface } from "readline";
import { Readable } from "stream";
import { isNoOfflineTokenError } from "./shopAccessToken.js";
import { shopifyGraphql } from "./shopifyFetch.js";

const LOG = "[shopifyBulk]";

export type BulkStatus =
  | "CREATED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELED"
  | "CANCELING";

export type ShopifyBulkJob = {
  /** Unique key for in-flight tracking */
  id: string;
  /** Shopify TranslatableResourceType enum value */
  resourceType: string;
  locale: string;
};

export type ShopifyBulkJobOutcome = {
  job: ShopifyBulkJob;
} & (
  | { mode: "jsonl"; url: string }
  | { mode: "empty" }
  | { mode: "fallback"; reason: string }
);

export type BulkJsonlResourceLine = {
  resourceId?: string;
  id?: string;
  translations?: Array<{
    key: string;
    value?: string | null;
    outdated?: boolean | null;
  }>;
  translatableContent?: Array<{
    key: string;
    value: string;
    digest?: string;
    locale?: string;
    type?: string | null;
  }>;
  __parentId?: string;
};

function envNumber(
  primary: string,
  alias: string,
  fallback: number,
  clamp?: { min?: number; max?: number },
): number {
  const raw =
    process.env[primary]?.trim() || process.env[alias]?.trim() || "";
  const n = Number(raw);
  let value = Number.isFinite(n) && n > 0 ? n : fallback;
  if (clamp?.min != null) value = Math.max(clamp.min, value);
  if (clamp?.max != null) value = Math.min(clamp.max, value);
  return value;
}

export function getBulkSubmitWindow(): number {
  return envNumber("SHOPIFY_BULK_SUBMIT_WINDOW", "INIT_BULK_SUBMIT_WINDOW", 5, {
    min: 1,
    max: 5,
  });
}

export function getBulkPollMs(): number {
  return envNumber("SHOPIFY_BULK_POLL_MS", "INIT_BULK_POLL_MS", 1_000, {
    min: 250,
  });
}

export function getBulkDownloadConcurrency(): number {
  return envNumber(
    "SHOPIFY_BULK_DOWNLOAD_CONCURRENCY",
    "INIT_BULK_DOWNLOAD_CONCURRENCY",
    5,
    { min: 1, max: 5 },
  );
}

export function getBulkTimeoutMs(): number {
  return envNumber(
    "SHOPIFY_BULK_TIMEOUT_MS",
    "INIT_BULK_TIMEOUT_MS",
    6 * 60 * 60 * 1_000,
    { min: 60_000 },
  );
}

export function getBulkSubmitMaxRetries(): number {
  return envNumber("SHOPIFY_BULK_SUBMIT_MAX_RETRIES", "", 24, {
    min: 1,
    max: 120,
  });
}

/** Shopify bulk submit errors that should wait and retry instead of immediate fallback. */
export function isRetriableBulkSubmitError(message: string): boolean {
  return (
    /already in progress|OPERATION_ALREADY_RUNNING|bulk operation is already running/i.test(
      message,
    ) ||
    /THROTTLED|429|rate limit|Too many requests/i.test(message) ||
    /HTTP.*502|HTTP.*503|HTTP.*504|ETIMEDOUT|ECONNRESET/i.test(message)
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function escapeGraphqlString(value: string): string {
  return JSON.stringify(value);
}

/** Inner query embedded in bulkOperationRunQuery — locale must be inlined. */
export function buildTranslatableResourcesBulkQuery(
  resourceType: string,
  targetLocale: string,
): string {
  return `{
  translatableResources(resourceType: ${resourceType}) {
    edges {
      node {
        resourceId
        translations(locale: ${escapeGraphqlString(targetLocale)}) {
          key
          value
          outdated
        }
        translatableContent {
          key
          value
          digest
          locale
          type
        }
      }
    }
  }
}`;
}

export async function submitTranslatableResourcesBulk(
  shopDomain: string,
  resourceType: string,
  targetLocale: string,
): Promise<string> {
  const inner = buildTranslatableResourcesBulkQuery(resourceType, targetLocale);
  const mutation = `
mutation BulkTranslatableResources($query: String!) {
  bulkOperationRunQuery(query: $query) {
    bulkOperation { id status }
    userErrors { field message code }
  }
}`;

  const data = (await shopifyGraphql(shopDomain, mutation, {
    query: inner,
  })) as {
    bulkOperationRunQuery: {
      bulkOperation: { id: string; status: string } | null;
      userErrors: Array<{ field?: string[]; message: string; code?: string }>;
    };
  };

  const payload = data.bulkOperationRunQuery;
  const errors = payload?.userErrors ?? [];
  if (errors.length > 0) {
    throw new Error(
      `${LOG} bulkOperationRunQuery userErrors: ${JSON.stringify(errors)}`,
    );
  }
  const opId = payload?.bulkOperation?.id;
  if (!opId) {
    throw new Error(`${LOG} bulkOperationRunQuery returned no operation id`);
  }
  return opId;
}

export async function pollBulkOperation(
  shopDomain: string,
  operationId: string,
): Promise<{
  status: BulkStatus;
  errorCode: string | null;
  url: string | null;
  objectCount: string | null;
}> {
  const query = `
query BulkPoll($id: ID!) {
  bulkOperation(id: $id) {
    id
    status
    errorCode
    objectCount
    url
    partialDataUrl
  }
}`;

  const data = (await shopifyGraphql(shopDomain, query, {
    id: operationId,
  })) as {
    bulkOperation: {
      id: string;
      status: BulkStatus;
      errorCode?: string | null;
      objectCount?: string | null;
      url?: string | null;
      partialDataUrl?: string | null;
    } | null;
  };

  const op = data.bulkOperation;
  if (!op) {
    throw new Error(`${LOG} bulkOperation not found id=${operationId}`);
  }
  return {
    status: op.status,
    errorCode: op.errorCode ?? null,
    url: op.url ?? op.partialDataUrl ?? null,
    objectCount: op.objectCount ?? null,
  };
}

export async function cancelBulkOperation(
  shopDomain: string,
  operationId: string,
): Promise<void> {
  const mutation = `
mutation BulkCancel($id: ID!) {
  bulkOperationCancel(id: $id) {
    bulkOperation { id status }
    userErrors { field message }
  }
}`;
  try {
    await shopifyGraphql(shopDomain, mutation, { id: operationId });
  } catch (e) {
    console.warn(
      `${LOG} cancel failed op=${operationId}: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
}

export function isResourceJsonlLine(row: BulkJsonlResourceLine): boolean {
  if (row.__parentId) return false;
  const resourceId = row.resourceId ?? row.id;
  return Boolean(resourceId && Array.isArray(row.translatableContent));
}

/**
 * Stream-download a bulk JSONL URL and invoke onLine for each resource row.
 *
 * Optional yieldEveryLines / yieldMs deliberately slow CPU-bound parse (shop
 * scan) so the event loop stays responsive and metrics stay flatter.
 */
export async function streamBulkJsonlResources(args: {
  url: string;
  onLine: (row: BulkJsonlResourceLine) => void | Promise<void>;
  onHeartbeat?: () => Promise<void>;
  logLabel?: string;
  /** Pause after every N resource lines (0 = never). */
  yieldEveryLines?: number;
  /** Sleep duration when yielding (ms). */
  yieldMs?: number;
}): Promise<void> {
  const {
    url,
    onLine,
    onHeartbeat,
    logLabel = "?",
    yieldEveryLines = 0,
    yieldMs = 0,
  } = args;
  const resp = await fetch(url);
  if (!resp.ok || !resp.body) {
    throw new Error(
      `${LOG} JSONL download HTTP ${resp.status} label=${logLabel}`,
    );
  }

  const nodeStream = Readable.fromWeb(
    resp.body as import("stream/web").ReadableStream<Uint8Array>,
  );
  const rl = createInterface({ input: nodeStream, crlfDelay: Infinity });
  let lastHeartbeat = 0;
  let resourceLines = 0;

  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let row: BulkJsonlResourceLine;
      try {
        row = JSON.parse(trimmed) as BulkJsonlResourceLine;
      } catch {
        console.warn(`${LOG} skip invalid JSONL line label=${logLabel}`);
        continue;
      }

      if (!isResourceJsonlLine(row)) continue;

      const maybePromise = onLine(row);
      if (maybePromise) await maybePromise;

      resourceLines++;
      if (
        yieldEveryLines > 0 &&
        yieldMs > 0 &&
        resourceLines % yieldEveryLines === 0
      ) {
        await sleep(yieldMs);
      }

      const now = Date.now();
      if (onHeartbeat && now - lastHeartbeat > 15_000) {
        lastHeartbeat = now;
        await onHeartbeat();
      }
    }
  } finally {
    rl.close();
    nodeStream.destroy();
  }
}

type InFlightBulk = {
  job: ShopifyBulkJob;
  operationId: string;
  submittedAt: number;
};

/**
 * Sliding-window bulk submit + poll; completed jobs are handed to processOutcome
 * with download concurrency limiting. Failures become mode:"fallback" when
 * fallbackOnFailure is true; when false and retryOnFailure is true, the job is
 * re-queued up to submitMaxRetries; otherwise accumulate and throw at the end.
 */
export async function runShopifyBulkJobQueue(args: {
  shopDomain: string;
  jobs: ShopifyBulkJob[];
  onHeartbeat: () => Promise<void>;
  isShutdown?: () => boolean;
  /** default true */
  fallbackOnFailure?: boolean;
  /** Re-submit failed jobs when fallbackOnFailure is false (default false). */
  retryOnFailure?: boolean;
  processOutcome: (outcome: ShopifyBulkJobOutcome) => Promise<void>;
  /**
   * Fired when a job leaves the local queue for its first submit attempt
   * (including submit retries). Init UI uses this so merchants see "querying"
   * while Shopify bulk is CREATED/RUNNING — not only after JSONL is ready.
   */
  onJobSubmit?: (job: ShopifyBulkJob) => Promise<void>;
  logPrefix?: string;
  /** Override shared SHOPIFY_BULK_SUBMIT_WINDOW (clamped 1–5). */
  submitWindow?: number;
  /** Override shared SHOPIFY_BULK_DOWNLOAD_CONCURRENCY (clamped 1–5). */
  downloadConcurrency?: number;
}): Promise<void> {
  const {
    shopDomain,
    jobs,
    onHeartbeat,
    isShutdown = () => false,
    fallbackOnFailure = true,
    retryOnFailure = false,
    processOutcome,
    onJobSubmit,
    logPrefix = LOG,
  } = args;

  const submitWindow = Math.min(
    5,
    Math.max(1, args.submitWindow ?? getBulkSubmitWindow()),
  );
  const pollMs = getBulkPollMs();
  const downloadConcurrency = Math.min(
    5,
    Math.max(1, args.downloadConcurrency ?? getBulkDownloadConcurrency()),
  );
  const timeoutMs = getBulkTimeoutMs();
  const submitMaxRetries = getBulkSubmitMaxRetries();

  const queue = [...jobs];
  const inFlight = new Map<string, InFlightBulk>();
  const outcomeQueue: ShopifyBulkJobOutcome[] = [];
  const jobRetryCounts = new Map<string, number>();
  let activeProcessors = 0;
  const processorWaiters: Array<() => void> = [];
  const processorTasks: Promise<void>[] = [];
  const errors: string[] = [];

  const wakeProcessor = () => {
    const next = processorWaiters.shift();
    if (next) next();
  };

  const acquireProcessor = async () => {
    while (activeProcessors >= downloadConcurrency) {
      await new Promise<void>((resolve) => processorWaiters.push(resolve));
    }
    activeProcessors++;
  };

  const releaseProcessor = () => {
    activeProcessors--;
    wakeProcessor();
  };

  const runProcessor = (outcome: ShopifyBulkJobOutcome) => {
    const task = (async () => {
      await acquireProcessor();
      try {
        if (isShutdown()) {
          throw new Error("shutdown: bulk queue yielding for deploy");
        }
        await onHeartbeat();
        await processOutcome(outcome);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (
          retryOnFailure &&
          !fallbackOnFailure &&
          outcome.mode !== "fallback" &&
          !isShutdown()
        ) {
          failOrFallback(outcome.job, `process ${msg}`);
          await submitAvailable();
          return;
        }
        errors.push(`${outcome.job.id}: ${msg}`);
        console.error(
          `${logPrefix} process failed id=${outcome.job.id}: ${msg}`,
        );
      } finally {
        releaseProcessor();
      }
    })();
    processorTasks.push(task);
  };

  const enqueueOutcome = (outcome: ShopifyBulkJobOutcome) => {
    outcomeQueue.push(outcome);
    while (outcomeQueue.length > 0) {
      runProcessor(outcomeQueue.shift()!);
    }
  };

  const failOrFallback = (job: ShopifyBulkJob, reason: string) => {
    // 卸载 / Session 丢失：fallback 与 requeue 都会再次撞 token，直接记失败。
    if (isNoOfflineTokenError(reason)) {
      errors.push(`${job.id}: ${reason}`);
      return;
    }
    if (fallbackOnFailure) {
      enqueueOutcome({ job, mode: "fallback", reason });
      return;
    }
    const attempts = jobRetryCounts.get(job.id) ?? 0;
    if (retryOnFailure && attempts + 1 < submitMaxRetries && !isShutdown()) {
      jobRetryCounts.set(job.id, attempts + 1);
      console.warn(
        `${logPrefix} requeue id=${job.id} attempt=${attempts + 1}/${submitMaxRetries - 1}: ${reason}`,
      );
      queue.push(job);
      return;
    }
    errors.push(`${job.id}: ${reason}`);
  };

  /** 整店无 token：清掉 inFlight + 待提交队列，避免 poll 空转至 timeout。 */
  const abortQueueForNoOfflineToken = (reason: string) => {
    console.warn(
      `${logPrefix} abort shop=${shopDomain} reason=no_offline_token inFlight=${inFlight.size} queued=${queue.length}`,
    );
    for (const [id, op] of [...inFlight.entries()]) {
      inFlight.delete(id);
      failOrFallback(op.job, reason);
    }
    while (queue.length > 0) {
      failOrFallback(queue.shift()!, reason);
    }
  };

  const submitOneWithRetry = async (job: ShopifyBulkJob): Promise<void> => {
    // Announce before the first attempt so UI reflects Shopify bulk wait time.
    try {
      await onJobSubmit?.(job);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`${logPrefix} onJobSubmit failed id=${job.id}: ${msg}`);
    }
    for (let attempt = 1; attempt <= submitMaxRetries; attempt++) {
      if (isShutdown()) {
        throw new Error("shutdown: bulk queue yielding for deploy");
      }
      try {
        console.log(
          `${logPrefix} submit id=${job.id} type=${job.resourceType} locale=${job.locale} shop=${shopDomain} attempt=${attempt}/${submitMaxRetries}`,
        );
        const operationId = await submitTranslatableResourcesBulk(
          shopDomain,
          job.resourceType,
          job.locale,
        );
        inFlight.set(job.id, {
          job,
          operationId,
          submittedAt: Date.now(),
        });
        console.log(`${logPrefix} submitted id=${job.id} op=${operationId}`);
        return;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (isNoOfflineTokenError(msg)) {
          console.warn(`${logPrefix} submit failed id=${job.id}: ${msg}`);
          failOrFallback(job, msg);
          abortQueueForNoOfflineToken(msg);
          return;
        }
        if (
          isRetriableBulkSubmitError(msg) &&
          attempt < submitMaxRetries &&
          !isShutdown()
        ) {
          console.warn(
            `${logPrefix} submit retry id=${job.id} attempt=${attempt}/${submitMaxRetries}: ${msg}`,
          );
          await sleep(pollMs);
          continue;
        }
        console.warn(`${logPrefix} submit failed id=${job.id}: ${msg}`);
        failOrFallback(job, `submit ${msg}`);
        return;
      }
    }
  };

  const submitAvailable = async () => {
    while (inFlight.size < submitWindow && queue.length > 0) {
      if (isShutdown()) {
        throw new Error("shutdown: bulk queue yielding for deploy");
      }
      const job = queue.shift()!;
      await submitOneWithRetry(job);
      await onHeartbeat();
    }
  };

  try {
    await submitAvailable();

    while (inFlight.size > 0 || queue.length > 0) {
      if (isShutdown()) {
        for (const [, op] of inFlight) {
          await cancelBulkOperation(shopDomain, op.operationId);
        }
        throw new Error("shutdown: bulk queue yielding for deploy");
      }

      await onHeartbeat();

      for (const [id, op] of [...inFlight.entries()]) {
        let polled;
        try {
          polled = await pollBulkOperation(shopDomain, op.operationId);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`${logPrefix} poll error id=${id}: ${msg}`);
          if (isNoOfflineTokenError(msg)) {
            // 原先 continue 会让 inFlight 永远不空 → 每秒刷日志直到 6h timeout。
            inFlight.delete(id);
            failOrFallback(op.job, msg);
            abortQueueForNoOfflineToken(msg);
            break;
          }
          continue;
        }

        if (polled.status === "COMPLETED") {
          inFlight.delete(id);
          console.log(
            `${logPrefix} completed id=${id} objects=${polled.objectCount ?? "?"} url=${polled.url ? "yes" : "null"}`,
          );
          if (polled.url) {
            enqueueOutcome({ job: op.job, mode: "jsonl", url: polled.url });
          } else {
            enqueueOutcome({ job: op.job, mode: "empty" });
          }
          await submitAvailable();
          continue;
        }

        if (
          polled.status === "FAILED" ||
          polled.status === "CANCELED" ||
          polled.status === "CANCELING"
        ) {
          inFlight.delete(id);
          console.warn(
            `${logPrefix} op ${polled.status} id=${id} errorCode=${polled.errorCode ?? "null"}`,
          );
          failOrFallback(
            op.job,
            `bulk ${polled.status} ${polled.errorCode ?? ""}`.trim(),
          );
          await submitAvailable();
          continue;
        }

        if (Date.now() - op.submittedAt > timeoutMs) {
          console.warn(
            `${logPrefix} timeout id=${id} op=${op.operationId}`,
          );
          await cancelBulkOperation(shopDomain, op.operationId);
          inFlight.delete(id);
          failOrFallback(op.job, "bulk timeout");
          await submitAvailable();
        }
      }

      if (inFlight.size > 0 || queue.length > 0) {
        await sleep(pollMs);
      }
    }

    await Promise.all(processorTasks);

    if (errors.length > 0) {
      throw new Error(`${logPrefix} job failures: ${errors.join("; ")}`);
    }
  } catch (e) {
    for (const [, op] of inFlight) {
      await cancelBulkOperation(shopDomain, op.operationId);
    }
    throw e;
  }
}
