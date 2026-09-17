import { CosmosClient, type Container } from "@azure/cosmos";
import { sameTranslationLocale } from "./locale";
import {
  ACTIVE_V4_STATUSES,
  EMPTY_V4_METRICS,
  type TranslationV4Job,
  type TranslationV4Metrics,
  type TranslationV4Status,
} from "./types";

/**
 * TsFrontend 专用 Cosmos 访问层，指向 Spark worker 消费的同一个 `translation_v4_jobs` 容器。
 *
 * 环境变量统一带 `_V4` 后缀，与 TSF 既有配置隔离：
 *   COSMOS_ENDPOINT_V4 / COSMOS_KEY_V4
 *   COSMOS_TRANSLATION_DATABASE_ID_V4         （默认 "translation"）
 *   COSMOS_TRANSLATION_V4_JOBS_CONTAINER_V4   （默认 "translation_v4_jobs"）
 *
 * 分区键为 shopName。
 */
let _client: CosmosClient | null = null;

function stripLegacyJobSecrets(job: TranslationV4Job): TranslationV4Job {
  const clean = { ...job } as TranslationV4Job & Record<string, unknown>;
  delete clean.shopifyAccessToken;
  return clean;
}

function getClient(): CosmosClient {
  if (!_client) {
    const endpoint = process.env.COSMOS_ENDPOINT_V4?.trim();
    const key = process.env.COSMOS_KEY_V4?.trim();
    if (!endpoint || !key) {
      throw new Error("COSMOS_ENDPOINT_V4 与 COSMOS_KEY_V4 必填");
    }
    _client = new CosmosClient({ endpoint, key });
  }
  return _client;
}

function getContainer(): Container {
  const dbId =
    process.env.COSMOS_TRANSLATION_DATABASE_ID_V4?.trim() || "translation";
  const containerId =
    process.env.COSMOS_TRANSLATION_V4_JOBS_CONTAINER_V4?.trim() ||
    "translation_v4_jobs";
  return getClient().database(dbId).container(containerId);
}

export async function createV4Job(
  input: Omit<
    TranslationV4Job,
    | "metrics"
    | "claimedBy"
    | "claimedAt"
    | "lastHeartbeat"
    | "errorMessage"
    | "errorStage"
    | "createdAt"
    | "updatedAt"
    | "aiModelUsed"
    | "aiProvider"
    | "engineUsage"
  > & { metrics?: Partial<TranslationV4Metrics> },
): Promise<TranslationV4Job> {
  const now = new Date().toISOString();
  const doc = stripLegacyJobSecrets({
    ...input,
    metrics: { ...EMPTY_V4_METRICS, ...input.metrics },
    aiModelUsed: null,
    aiProvider: null,
    engineUsage: null,
    claimedBy: null,
    claimedAt: null,
    lastHeartbeat: null,
    errorMessage: null,
    errorStage: null,
    createdAt: now,
    updatedAt: now,
  } as TranslationV4Job);
  await getContainer().items.upsert(doc);
  return doc;
}

export async function getV4Job(
  shopName: string,
  jobId: string,
): Promise<TranslationV4Job | null> {
  try {
    const { resource } = await getContainer()
      .item(jobId, shopName)
      .read<TranslationV4Job>();
    return resource ? stripLegacyJobSecrets(resource) : null;
  } catch {
    return null;
  }
}

/** 删除一个 v4 任务文档（partition key = shopName）。不存在视为成功。 */
export async function deleteV4Job(shopName: string, jobId: string): Promise<void> {
  try {
    await getContainer().item(jobId, shopName).delete();
  } catch (err) {
    // 404（已不存在）视为成功；其它错误抛出
    const code = (err as { code?: number })?.code;
    if (code !== 404) throw err;
  }
}

/** 同 shop + source + target 是否存在阻塞态任务（用于创建前互斥）。 */
export async function existsBlockingV4Job(
  shopName: string,
  source: string,
  target: string,
  blockingStatuses: TranslationV4Status[] = ACTIVE_V4_STATUSES,
): Promise<boolean> {
  if (!blockingStatuses.length) return false;

  try {
    const { resources } = await getContainer()
      .items.query<TranslationV4Job>(
        {
          query:
            "SELECT c.source, c.target, c.status FROM c WHERE c.shopName = @shopName AND ARRAY_CONTAINS(@blockingStatuses, c.status)",
          parameters: [
            { name: "@shopName", value: shopName },
            { name: "@blockingStatuses", value: blockingStatuses },
          ],
        },
        { partitionKey: shopName },
      )
      .fetchAll();

    return resources.some(
      (job) =>
        sameTranslationLocale(job.source, source) &&
        sameTranslationLocale(job.target, target),
    );
  } catch {
    return false;
  }
}

export async function listV4Jobs(
  shopName: string,
  limit = 50,
): Promise<TranslationV4Job[]> {
  try {
    const { resources } = await getContainer()
      .items.query<TranslationV4Job>(
        {
          query:
            "SELECT * FROM c WHERE c.shopName = @shopName ORDER BY c.createdAt DESC OFFSET 0 LIMIT @limit",
          parameters: [
            { name: "@shopName", value: shopName },
            { name: "@limit", value: limit },
          ],
        },
        { partitionKey: shopName },
      )
      .fetchAll();
    return resources.map(stripLegacyJobSecrets);
  } catch {
    return [];
  }
}

/**
 * 任务列表/进度汇总用得到的字段子集。列表页每次都要拉最多 50 条文档，
 * `SELECT *` 会连 `profileBlock`（店铺画像 prompt）、`blobPrefix` 等一起搬回来，
 * 白白拖慢首页文档的 TTFB。
 */
export type V4JobSummaryDoc = Pick<
  TranslationV4Job,
  | "id"
  | "status"
  | "source"
  | "target"
  | "modules"
  | "includeLiquid"
  | "aiModel"
  | "taskSource"
  | "metrics"
  | "stageTimings"
  | "errorMessage"
  | "errorStage"
  | "pauseAfterWriteback"
  | "createdAt"
  | "updatedAt"
>;

const V4_JOB_SUMMARY_SELECT = [
  "c.id",
  "c.status",
  "c.source",
  "c.target",
  "c.modules",
  "c.includeLiquid",
  "c.aiModel",
  "c.taskSource",
  "c.metrics",
  "c.stageTimings",
  "c.errorMessage",
  "c.errorStage",
  "c.pauseAfterWriteback",
  "c.createdAt",
  "c.updatedAt",
].join(", ");

/** 与 {@link listV4Jobs} 同序同过滤，但只取汇总字段。写路径仍走 `updateV4Job` 全量读改写。 */
export async function listV4JobSummaryDocs(
  shopName: string,
  limit = 50,
): Promise<V4JobSummaryDoc[]> {
  try {
    const { resources } = await getContainer()
      .items.query<V4JobSummaryDoc>(
        {
          query: `SELECT ${V4_JOB_SUMMARY_SELECT} FROM c WHERE c.shopName = @shopName ORDER BY c.createdAt DESC OFFSET 0 LIMIT @limit`,
          parameters: [
            { name: "@shopName", value: shopName },
            { name: "@limit", value: limit },
          ],
        },
        { partitionKey: shopName },
      )
      .fetchAll();
    return resources;
  } catch {
    return [];
  }
}

export type UpdateV4JobInput = Partial<
  Pick<
    TranslationV4Job,
    | "status"
    | "claimedBy"
    | "claimedAt"
    | "lastHeartbeat"
    | "metrics"
    | "errorMessage"
    | "errorStage"
    | "blobPrefix"
    | "pauseAfterWriteback"
    | "aiModelUsed"
    | "aiProvider"
    | "engineUsage"
  >
>;

export async function updateV4Job(
  shopName: string,
  jobId: string,
  updates: UpdateV4JobInput,
): Promise<TranslationV4Job | null> {
  try {
    const { resource: existing, etag } = await getContainer()
      .item(jobId, shopName)
      .read<TranslationV4Job>();
    if (!existing) return null;
    const updated = stripLegacyJobSecrets({
      ...stripLegacyJobSecrets(existing),
      ...updates,
      updatedAt: new Date().toISOString(),
    } as TranslationV4Job);
    const { resource: saved } = await getContainer()
      .item(jobId, shopName)
      .replace<TranslationV4Job>(updated, {
        accessCondition: { type: "IfMatch", condition: etag! },
      });
    return saved ? stripLegacyJobSecrets(saved) : updated;
  } catch {
    return null;
  }
}
