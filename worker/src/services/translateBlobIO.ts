import type { TranslationFieldCost } from "@ciwi/translation-core/llm-translate";
import { blobExists, blobListPaths, blobRead, blobWrite } from "./blobV4.js";

/** One translated Shopify resource — same shape as a chunk array element. */
export type TranslatedResourceItem = {
  resourceId: string;
  translations: Array<{
    key: string;
    originalValue: string;
    translatedValue: string;
    digest: string;
    status?: "translated" | "fallback";
    /** Per-field LLM/Google/cache cost metadata for Admin inspection. */
    cost?: TranslationFieldCost;
  }>;
};

const RESOURCES_DIR = "resources";

/** Stable blob file name for a Shopify GID (no path separators). */
export function encodeResourceIdForBlob(resourceId: string): string {
  return Buffer.from(resourceId, "utf8").toString("base64url");
}

/** Inverse of encodeResourceIdForBlob; path or bare `*.json` name both accepted. */
export function decodeResourceIdFromBlobPath(pathOrName: string): string | null {
  const base = pathOrName.split("/").pop();
  if (!base || !base.endsWith(".json")) return null;
  const encoded = base.slice(0, -".json".length);
  if (!encoded) return null;
  try {
    return Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

export function translatedResourceBlobPath(
  blobPrefix: string,
  module: string,
  resourceId: string,
): string {
  return `${blobPrefix}/translate/${module}/${RESOURCES_DIR}/${encodeResourceIdForBlob(resourceId)}.json`;
}

function isLegacyChunkPath(path: string): boolean {
  return path.endsWith(".json") && !path.includes(`/${RESOURCES_DIR}/`);
}

/** Write one resource checkpoint — idempotent overwrite, safe under parallel workers. */
export async function writeTranslatedResourceBlob(
  blobPrefix: string,
  module: string,
  item: TranslatedResourceItem,
): Promise<void> {
  await blobWrite(translatedResourceBlobPath(blobPrefix, module, item.resourceId), item);
}

export async function readTranslatedResourceBlob(
  blobPrefix: string,
  module: string,
  resourceId: string,
): Promise<TranslatedResourceItem | null> {
  return blobRead<TranslatedResourceItem>(translatedResourceBlobPath(blobPrefix, module, resourceId));
}

/** Resource IDs with incremental checkpoints under a module. */
/** 每资源一个 blob，按资源数量做并发读，避免写回 Phase 1 串行读上千个 blob 卡几分钟。 */
const BLOB_READ_CONCURRENCY = Math.max(
  1,
  Number(process.env.BLOB_READ_CONCURRENCY) || 32,
);

async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

/**
 * List checkpointed resource IDs under a module.
 *
 * Only ListBlobs + filename decode — no download/JSON.parse. File names are
 * base64url(resourceId); downloading every blob just to read resourceId was
 * O(resources) egress/CPU per call and exploded on large shops.
 */
export async function listTranslatedResourceIds(
  blobPrefix: string,
  module: string,
): Promise<Set<string>> {
  const prefix = `${blobPrefix}/translate/${module}/${RESOURCES_DIR}/`;
  const paths = await blobListPaths(prefix);
  const ids = new Set<string>();
  for (const path of paths) {
    const id = decodeResourceIdFromBlobPath(path);
    if (id) ids.add(id);
  }
  return ids;
}

/**
 * Stream translated resources for one module, in batches.
 *
 * 写回不能把全店译文一次读进内存（大店会把 Worker 顶到 OOM），所以按批产出，
 * 调用方处理完一批即可释放。
 *
 * `skipResourceId` 在**下载之前**生效：per-resource blob 的文件名就是
 * base64url(resourceId)，续跑时已写回的资源连内容都不必下载。
 *
 * Per-resource blobs win over legacy chunk arrays when both exist.
 */
export async function* iterateTranslatedItemsForModule(
  blobPrefix: string,
  module: string,
  opts?: {
    batchSize?: number;
    skipResourceId?: (resourceId: string) => boolean;
  },
): AsyncGenerator<TranslatedResourceItem[]> {
  const batchSize = Math.max(1, opts?.batchSize ?? 500);
  const skip = opts?.skipResourceId;
  /** per-resource blob 覆盖到的 id；legacy chunk 里的同 id 旧值要让位。 */
  const seenIds = new Set<string>();

  const resourcePrefix = `${blobPrefix}/translate/${module}/${RESOURCES_DIR}/`;
  const resPaths: string[] = [];
  for (const path of await blobListPaths(resourcePrefix)) {
    if (!path.endsWith(".json")) continue;
    const id = decodeResourceIdFromBlobPath(path);
    // 先登记再过滤：被跳过的资源同样要挡住 legacy chunk 的旧值。
    if (id) seenIds.add(id);
    if (id && skip?.(id)) continue;
    resPaths.push(path);
  }

  for (let i = 0; i < resPaths.length; i += batchSize) {
    const items = await mapConcurrent(
      resPaths.slice(i, i + batchSize),
      BLOB_READ_CONCURRENCY,
      (path) => blobRead<TranslatedResourceItem>(path),
    );
    const batch = items.filter(
      (item): item is TranslatedResourceItem => !!item?.resourceId,
    );
    if (batch.length) yield batch;
  }

  // 旧版整块 chunk（数量少）：一个文件含多个资源，按累计资源数切批。
  const chunkPaths = (
    await blobListPaths(`${blobPrefix}/translate/${module}/`)
  ).filter(isLegacyChunkPath);
  let carry: TranslatedResourceItem[] = [];
  for (let i = 0; i < chunkPaths.length; i += BLOB_READ_CONCURRENCY) {
    const chunks = await mapConcurrent(
      chunkPaths.slice(i, i + BLOB_READ_CONCURRENCY),
      BLOB_READ_CONCURRENCY,
      (path) => blobRead<TranslatedResourceItem[]>(path),
    );
    for (const chunk of chunks) {
      if (!chunk) continue;
      for (const item of chunk) {
        if (!item?.resourceId || seenIds.has(item.resourceId)) continue;
        seenIds.add(item.resourceId);
        if (skip?.(item.resourceId)) continue;
        carry.push(item);
      }
    }
    while (carry.length >= batchSize) {
      yield carry.slice(0, batchSize);
      carry = carry.slice(batchSize);
    }
  }
  if (carry.length) yield carry;
}

/**
 * Load every translated resource for one module at once.
 * 仅用于结果规模可控的场景；写回请走 `iterateTranslatedItemsForModule`。
 */
export async function loadTranslatedItemsForModule(
  blobPrefix: string,
  module: string,
): Promise<TranslatedResourceItem[]> {
  const out: TranslatedResourceItem[] = [];
  for await (const batch of iterateTranslatedItemsForModule(blobPrefix, module)) {
    out.push(...batch);
  }
  return out;
}

type InitResource = { resourceId: string; fields: Array<{ key: string; value: string }> };

/**
 * When a chunk fully completes, assemble the legacy chunk-XX.json from
 * per-resource checkpoints (init order preserved).
 */
export async function assembleLegacyChunkBlob(
  blobPrefix: string,
  module: string,
  initChunk: InitResource[],
): Promise<TranslatedResourceItem[]> {
  const chunk: TranslatedResourceItem[] = [];
  for (const initRes of initChunk) {
    const item =
      (await readTranslatedResourceBlob(blobPrefix, module, initRes.resourceId)) ??
      null;
    if (item) chunk.push(item);
  }
  return chunk;
}

/** True when every init resource in the chunk has a checkpoint blob. */
export async function isChunkFullyCheckpointed(
  blobPrefix: string,
  module: string,
  initChunk: InitResource[],
): Promise<boolean> {
  for (const res of initChunk) {
    if (!res.fields?.length) continue;
    if (!(await blobExists(translatedResourceBlobPath(blobPrefix, module, res.resourceId)))) {
      return false;
    }
  }
  return initChunk.some((r) => (r.fields?.length ?? 0) > 0);
}
