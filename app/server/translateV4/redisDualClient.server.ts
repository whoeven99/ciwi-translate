/**
 * Azure Redis → Render Key Value 迁移包装。
 *
 * Env:
 *   RENDER_KV          Render KV URL（服务内用 Internal；本地/Agent 用 External）
 *   REDIS_DUAL_WRITE   true/1/yes → cache 写双端；hint/shop_scan list 永不双写
 *   REDIS_CUTOVER      逗号分隔 token（tm,items_count,...）或 all/*；命中则读写走 secondary
 *
 * Sole-client mode: REDIS_DUAL_WRITE off + REDIS_CUTOVER=all → 只连 RENDER_KV，
 * 不再创建 REDIS_URL / REDIS_URL_V4 client（可删 Azure Redis）。
 *
 * KEEP IN SYNC with worker/src/services/redisDualClient.ts
 */

export type RedisLike = {
  get(key: string): Promise<string | null>;
  mget(keys: string[]): Promise<(string | null)[]>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  hget(key: string, field: string): Promise<string | null>;
  hset(key: string, ...args: unknown[]): Promise<unknown>;
  hgetall(key: string): Promise<Record<string, string>>;
  hdel(key: string, ...fields: string[]): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  lpush(key: string, ...values: string[]): Promise<number>;
  rpush(key: string, ...values: string[]): Promise<number>;
  lpop(key: string): Promise<string | null>;
  ltrim(key: string, start: number, stop: number): Promise<string>;
  ping(): Promise<string>;
  pipeline(): RedisPipelineLike;
  multi(): RedisMultiLike;
  on?(event: string, listener: (...args: unknown[]) => void): unknown;
  quit?(): Promise<string>;
  disconnect?(): void;
};

export type RedisPipelineLike = {
  get(key: string): RedisPipelineLike;
  hget(key: string, field: string): RedisPipelineLike;
  hgetall(key: string): RedisPipelineLike;
  hset(key: string, ...args: unknown[]): RedisPipelineLike;
  hdel(key: string, ...fields: string[]): RedisPipelineLike;
  set(key: string, value: string, ...args: unknown[]): RedisPipelineLike;
  del(...keys: string[]): RedisPipelineLike;
  expire(key: string, seconds: number): RedisPipelineLike;
  lpush(key: string, ...values: string[]): RedisPipelineLike;
  rpush(key: string, ...values: string[]): RedisPipelineLike;
  lpop(key: string): RedisPipelineLike;
  ltrim(key: string, start: number, stop: number): RedisPipelineLike;
  exec(): Promise<Array<[Error | null, unknown]> | null>;
};

export type RedisMultiLike = {
  hset(key: string, ...args: unknown[]): RedisMultiLike;
  expire(key: string, seconds: number): RedisMultiLike;
  hdel(key: string, ...fields: string[]): RedisMultiLike;
  set(key: string, value: string, ...args: unknown[]): RedisMultiLike;
  del(...keys: string[]): RedisMultiLike;
  exec(): Promise<Array<[Error | null, unknown]> | null>;
};

export const CUTOVER_TOKEN_PREFIXES: Record<string, string[]> = {
  tm: ["tm:v5:"],
  items_count: ["tsf:items_count:"],
  progress: ["translate:v4:progress:"],
  control: ["translate:v4:control:"],
  auto_scan: ["translate:v4:auto_scan:"],
  hints: ["translate:v4:hint:"],
  shop_scan: ["tsf:shop_scan:"],
  keystat: ["translate:v4:keystat:", "translate:v4:keystatlog:"],
};

/** List 族：永不双写（push/pop 只走当前源）。 */
const LIST_PREFIXES = ["translate:v4:hint:", "tsf:shop_scan:"] as const;

function envFlagTrue(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function parseCutoverPrefixes(): { all: boolean; prefixes: string[] } {
  const raw = process.env.REDIS_CUTOVER?.trim() ?? "";
  if (!raw) return { all: false, prefixes: [] };
  const tokens = raw
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.some((t) => t === "*" || t === "all")) {
    return {
      all: true,
      prefixes: Object.values(CUTOVER_TOKEN_PREFIXES).flat(),
    };
  }
  const prefixes: string[] = [];
  for (const t of tokens) {
    const mapped = CUTOVER_TOKEN_PREFIXES[t];
    if (mapped) prefixes.push(...mapped);
  }
  return { all: false, prefixes };
}

export function isListKey(key: string): boolean {
  return LIST_PREFIXES.some((p) => key.startsWith(p));
}

function keyInCutover(
  key: string,
  cutover: { all: boolean; prefixes: string[] },
): boolean {
  if (cutover.all) return true;
  return cutover.prefixes.some((p) => key.startsWith(p));
}

type Routed = {
  primaryTarget: RedisLike;
  mirror: RedisLike | null;
};

function routeKey(
  key: string,
  azure: RedisLike,
  render: RedisLike,
  dualWrite: boolean,
  cutover: { all: boolean; prefixes: string[] },
): Routed {
  const cut = keyInCutover(key, cutover);
  const primaryTarget = cut ? render : azure;
  const other = cut ? azure : render;
  const dualWriteCache = dualWrite && !isListKey(key);
  return {
    primaryTarget,
    mirror: dualWriteCache ? other : null,
  };
}

let _loggedMissingSecondary = false;

function logSecondaryWriteError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(`[redisDual] secondary write failed: ${msg}`);
}

type PipeCmd =
  | { op: "get"; key: string }
  | { op: "hget"; key: string; field: string }
  | { op: "hgetall"; key: string }
  | { op: "hset"; key: string; args: unknown[] }
  | { op: "hdel"; key: string; fields: string[] }
  | { op: "set"; key: string; value: string; args: unknown[] }
  | { op: "del"; keys: string[] }
  | { op: "expire"; key: string; seconds: number }
  | { op: "lpush"; key: string; values: string[] }
  | { op: "rpush"; key: string; values: string[] }
  | { op: "lpop"; key: string }
  | { op: "ltrim"; key: string; start: number; stop: number };

function cmdKeys(cmd: PipeCmd): string[] {
  if (cmd.op === "del") return cmd.keys;
  return [cmd.key];
}

async function runOnClient(client: RedisLike, cmd: PipeCmd): Promise<unknown> {
  switch (cmd.op) {
    case "get":
      return client.get(cmd.key);
    case "hget":
      return client.hget(cmd.key, cmd.field);
    case "hgetall":
      return client.hgetall(cmd.key);
    case "hset":
      return client.hset(cmd.key, ...cmd.args);
    case "hdel":
      return client.hdel(cmd.key, ...cmd.fields);
    case "set":
      return client.set(cmd.key, cmd.value, ...cmd.args);
    case "del":
      return client.del(...cmd.keys);
    case "expire":
      return client.expire(cmd.key, cmd.seconds);
    case "lpush":
      return client.lpush(cmd.key, ...cmd.values);
    case "rpush":
      return client.rpush(cmd.key, ...cmd.values);
    case "lpop":
      return client.lpop(cmd.key);
    case "ltrim":
      return client.ltrim(cmd.key, cmd.start, cmd.stop);
    default: {
      const _exhaustive: never = cmd;
      return _exhaustive;
    }
  }
}

function isWriteCmd(cmd: PipeCmd): boolean {
  switch (cmd.op) {
    case "get":
    case "hget":
    case "hgetall":
    case "lpop":
      return false;
    case "hset":
    case "hdel":
    case "set":
    case "del":
    case "expire":
    case "lpush":
    case "rpush":
    case "ltrim":
      return true;
    default: {
      const _exhaustive: never = cmd;
      return _exhaustive;
    }
  }
}

class MigratingPipeline implements RedisPipelineLike {
  private cmds: PipeCmd[] = [];

  constructor(private readonly owner: MigratingRedis) {}

  get(key: string): RedisPipelineLike {
    this.cmds.push({ op: "get", key });
    return this;
  }
  hget(key: string, field: string): RedisPipelineLike {
    this.cmds.push({ op: "hget", key, field });
    return this;
  }
  hgetall(key: string): RedisPipelineLike {
    this.cmds.push({ op: "hgetall", key });
    return this;
  }
  hset(key: string, ...args: unknown[]): RedisPipelineLike {
    this.cmds.push({ op: "hset", key, args });
    return this;
  }
  hdel(key: string, ...fields: string[]): RedisPipelineLike {
    this.cmds.push({ op: "hdel", key, fields });
    return this;
  }
  set(key: string, value: string, ...args: unknown[]): RedisPipelineLike {
    this.cmds.push({ op: "set", key, value, args });
    return this;
  }
  del(...keys: string[]): RedisPipelineLike {
    this.cmds.push({ op: "del", keys });
    return this;
  }
  expire(key: string, seconds: number): RedisPipelineLike {
    this.cmds.push({ op: "expire", key, seconds });
    return this;
  }
  lpush(key: string, ...values: string[]): RedisPipelineLike {
    this.cmds.push({ op: "lpush", key, values });
    return this;
  }
  rpush(key: string, ...values: string[]): RedisPipelineLike {
    this.cmds.push({ op: "rpush", key, values });
    return this;
  }
  lpop(key: string): RedisPipelineLike {
    this.cmds.push({ op: "lpop", key });
    return this;
  }
  ltrim(key: string, start: number, stop: number): RedisPipelineLike {
    this.cmds.push({ op: "ltrim", key, start, stop });
    return this;
  }

  async exec(): Promise<Array<[Error | null, unknown]> | null> {
    const out: Array<[Error | null, unknown]> = [];
    for (const cmd of this.cmds) {
      try {
        const keys = cmdKeys(cmd);
        if (cmd.op === "del" && keys.length > 1) {
          let total = 0;
          for (const k of keys) {
            const n = (await this.owner._writeOrRead(
              k,
              { op: "del", keys: [k] },
              true,
            )) as number;
            total += Number(n) || 0;
          }
          out.push([null, total]);
          continue;
        }
        const key = keys[0]!;
        const result = await this.owner._writeOrRead(key, cmd, isWriteCmd(cmd));
        out.push([null, result]);
      } catch (e) {
        out.push([e instanceof Error ? e : new Error(String(e)), null]);
      }
    }
    return out;
  }
}

class MigratingMulti implements RedisMultiLike {
  private cmds: PipeCmd[] = [];

  constructor(private readonly owner: MigratingRedis) {}

  hset(key: string, ...args: unknown[]): RedisMultiLike {
    this.cmds.push({ op: "hset", key, args });
    return this;
  }
  expire(key: string, seconds: number): RedisMultiLike {
    this.cmds.push({ op: "expire", key, seconds });
    return this;
  }
  hdel(key: string, ...fields: string[]): RedisMultiLike {
    this.cmds.push({ op: "hdel", key, fields });
    return this;
  }
  set(key: string, value: string, ...args: unknown[]): RedisMultiLike {
    this.cmds.push({ op: "set", key, value, args });
    return this;
  }
  del(...keys: string[]): RedisMultiLike {
    this.cmds.push({ op: "del", keys });
    return this;
  }

  async exec(): Promise<Array<[Error | null, unknown]> | null> {
    const pipe = new MigratingPipeline(this.owner);
    for (const c of this.cmds) {
      switch (c.op) {
        case "hset":
          pipe.hset(c.key, ...c.args);
          break;
        case "expire":
          pipe.expire(c.key, c.seconds);
          break;
        case "hdel":
          pipe.hdel(c.key, ...c.fields);
          break;
        case "set":
          pipe.set(c.key, c.value, ...c.args);
          break;
        case "del":
          pipe.del(...c.keys);
          break;
        default:
          break;
      }
    }
    return pipe.exec();
  }
}

class MigratingRedis implements RedisLike {
  private readonly dualWrite: boolean;
  private cutoverCache: { all: boolean; prefixes: string[]; at: number } | null =
    null;

  constructor(
    private readonly azure: RedisLike,
    private readonly render: RedisLike,
  ) {
    this.dualWrite = envFlagTrue("REDIS_DUAL_WRITE");
  }

  private cutover(): { all: boolean; prefixes: string[] } {
    const now = Date.now();
    if (!this.cutoverCache || now - this.cutoverCache.at > 2_000) {
      const parsed = parseCutoverPrefixes();
      this.cutoverCache = { ...parsed, at: now };
    }
    return this.cutoverCache;
  }

  /** @internal pipeline/multi 使用 */
  async _writeOrRead(
    key: string,
    cmd: PipeCmd,
    isWrite: boolean,
  ): Promise<unknown> {
    const routed = routeKey(
      key,
      this.azure,
      this.render,
      this.dualWrite,
      this.cutover(),
    );
    const result = await runOnClient(routed.primaryTarget, cmd);
    if (isWrite && routed.mirror) {
      try {
        await runOnClient(routed.mirror, cmd);
      } catch (e) {
        logSecondaryWriteError(e);
      }
    }
    return result;
  }

  async get(key: string): Promise<string | null> {
    return (await this._writeOrRead(
      key,
      { op: "get", key },
      false,
    )) as string | null;
  }

  /**
   * 路由是按 key 决定的，同一批 key 不保证落在同一实例，所以这里逐 key 复用 get
   * 的路由而不是真的发一条 MGET。sole mode 下 core 拿到的是原生 ioredis（真批量），
   * 这个实现只是双写期的正确性兜底——缺了它 translation-core 的 TM 批量读会整批
   * 当成 miss。
   */
  async mget(keys: string[]): Promise<(string | null)[]> {
    if (keys.length === 0) return [];
    return Promise.all(keys.map((key) => this.get(key)));
  }

  async set(key: string, value: string, ...args: unknown[]): Promise<unknown> {
    return this._writeOrRead(key, { op: "set", key, value, args }, true);
  }

  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    if (keys.length === 1) {
      return (await this._writeOrRead(
        keys[0]!,
        { op: "del", keys },
        true,
      )) as number;
    }
    let total = 0;
    for (const k of keys) {
      total += Number(
        (await this._writeOrRead(k, { op: "del", keys: [k] }, true)) || 0,
      );
    }
    return total;
  }

  async hget(key: string, field: string): Promise<string | null> {
    return (await this._writeOrRead(
      key,
      { op: "hget", key, field },
      false,
    )) as string | null;
  }

  async hset(key: string, ...args: unknown[]): Promise<unknown> {
    return this._writeOrRead(key, { op: "hset", key, args }, true);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return ((await this._writeOrRead(key, { op: "hgetall", key }, false)) ??
      {}) as Record<string, string>;
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    return (await this._writeOrRead(
      key,
      { op: "hdel", key, fields },
      true,
    )) as number;
  }

  async expire(key: string, seconds: number): Promise<number> {
    return (await this._writeOrRead(
      key,
      { op: "expire", key, seconds },
      true,
    )) as number;
  }

  async lpush(key: string, ...values: string[]): Promise<number> {
    return (await this._writeOrRead(
      key,
      { op: "lpush", key, values },
      true,
    )) as number;
  }

  async rpush(key: string, ...values: string[]): Promise<number> {
    return (await this._writeOrRead(
      key,
      { op: "rpush", key, values },
      true,
    )) as number;
  }

  async lpop(key: string): Promise<string | null> {
    return (await this._writeOrRead(key, { op: "lpop", key }, false)) as
      | string
      | null;
  }

  async ltrim(key: string, start: number, stop: number): Promise<string> {
    return (await this._writeOrRead(
      key,
      { op: "ltrim", key, start, stop },
      true,
    )) as string;
  }

  async ping(): Promise<string> {
    const cut = this.cutover();
    if (cut.all) return this.render.ping();
    return this.azure.ping();
  }

  pipeline(): RedisPipelineLike {
    return new MigratingPipeline(this);
  }

  multi(): RedisMultiLike {
    return new MigratingMulti(this);
  }

  on(event: string, listener: (...args: unknown[]) => void): unknown {
    this.azure.on?.(event, listener);
    this.render.on?.(event, listener);
    return this;
  }

  async quit(): Promise<string> {
    await Promise.allSettled([this.azure.quit?.(), this.render.quit?.()]);
    return "OK";
  }

  disconnect(): void {
    this.azure.disconnect?.();
    this.render.disconnect?.();
  }
}

/** Render KV URL（`RENDER_KV`）。 */
export function getRenderKvUrl(): string | undefined {
  return process.env.RENDER_KV?.trim() || undefined;
}

/**
 * 已全量切到 Render 且关闭双写：只建 RENDER_KV 一个 client，不读 REDIS_URL*。
 */
export function isRenderKvSoleClientMode(): boolean {
  return !envFlagTrue("REDIS_DUAL_WRITE") && parseCutoverPrefixes().all;
}

export function warnIfMigrationEnvIncomplete(): void {
  if (_loggedMissingSecondary) return;
  const kv = getRenderKvUrl();
  if (isRenderKvSoleClientMode() && !kv) {
    _loggedMissingSecondary = true;
    console.warn(
      "[redisDual] sole mode (REDIS_CUTOVER=all, REDIS_DUAL_WRITE off) but RENDER_KV missing",
    );
    return;
  }
  if (
    (envFlagTrue("REDIS_DUAL_WRITE") || process.env.REDIS_CUTOVER?.trim()) &&
    !kv
  ) {
    _loggedMissingSecondary = true;
    console.warn(
      "[redisDual] REDIS_DUAL_WRITE/REDIS_CUTOVER set but RENDER_KV missing; using primary only",
    );
  }
}

export function wrapRedisPair<T extends RedisLike>(
  primary: T,
  secondary: T,
): T {
  console.info(
    `[redisDual] enabled dualWrite=${envFlagTrue("REDIS_DUAL_WRITE")} cutover=${process.env.REDIS_CUTOVER?.trim() || "(empty)"}`,
  );
  return new MigratingRedis(primary, secondary) as unknown as T;
}
