export type TranslationCoreRedisPipeline = {
  hset(key: string, values: Record<string, string | number>): TranslationCoreRedisPipeline;
  expire(key: string, seconds: number): TranslationCoreRedisPipeline;
  rpush(key: string, value: string): TranslationCoreRedisPipeline;
  ltrim(key: string, start: number, stop: number): TranslationCoreRedisPipeline;
  exec(): Promise<unknown>;
};

export type TranslationCoreRedis = {
  get(key: string): Promise<string | null>;
  /** Batch read. Result aligns with `keys` by index. Safe on single-instance Redis/Valkey only. */
  mget(keys: string[]): Promise<(string | null)[]>;
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>;
  pipeline(): TranslationCoreRedisPipeline;
};

export type TranslationCoreGlossaryRow = {
  sourceText: string;
  targetText: string | null;
  rangeCode?: string | null;
  caseSensitive?: boolean;
};

export type TranslationCoreRuntime = {
  getRedis: () => TranslationCoreRedis;
  loadGlossaryRows: (
    shopName: string,
    target: string,
  ) => Promise<TranslationCoreGlossaryRow[]>;
};

let runtime: Partial<TranslationCoreRuntime> = {};

export function configureTranslationCore(
  next: Partial<TranslationCoreRuntime>,
): void {
  runtime = { ...runtime, ...next };
}

export function getTranslationCoreRedis(): TranslationCoreRedis {
  if (!runtime.getRedis) {
    throw new Error("translation-core Redis adapter is not configured");
  }
  return runtime.getRedis();
}

export function hasTranslationCoreGlossaryLoader(): boolean {
  return Boolean(runtime.loadGlossaryRows);
}

export async function loadTranslationCoreGlossaryRows(
  shopName: string,
  target: string,
): Promise<TranslationCoreGlossaryRow[]> {
  return runtime.loadGlossaryRows?.(shopName, target) ?? [];
}
