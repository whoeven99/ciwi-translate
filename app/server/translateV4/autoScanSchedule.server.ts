import { getTranslateV4RedisClient } from "./redis.server";

/** 与 Spark worker redisV4 / scheduler 共用。 */
export const AUTO_SCAN_LAST_AT_KEY = "translate:v4:auto_scan:last_at";

/** 与 Spark worker scheduler 一致：未配置环境变量时默认 1 小时扫描。 */
export const AUTO_TRANSLATE_INTERVAL_MS_DEFAULT = 60 * 60_000;

/** 单店两次自动建任务批次的最小间隔（默认 3 小时；与 worker AUTO_TRANSLATE_SHOP_COOLDOWN_MS 一致）。 */
export const AUTO_TRANSLATE_SHOP_COOLDOWN_MS_DEFAULT = 3 * 60 * 60_000;

/** 自动扫描对齐的时区（展示与调度一致，默认北京时间）。 */
export const AUTO_TRANSLATE_SCHEDULE_TZ_DEFAULT = "Asia/Shanghai";

/** 整点分钟（0 = 每小时 :00，如 11:00、12:00）。 */
export const AUTO_TRANSLATE_SCHEDULE_MINUTE_DEFAULT = 0;

export function getAutoTranslateIntervalMs(): number {
  const n = Number(process.env.AUTO_TRANSLATE_INTERVAL_MS);
  return n > 0 ? n : AUTO_TRANSLATE_INTERVAL_MS_DEFAULT;
}

export function getAutoTranslateShopCooldownMs(): number {
  const n = Number(process.env.AUTO_TRANSLATE_SHOP_COOLDOWN_MS);
  return n > 0 ? n : AUTO_TRANSLATE_SHOP_COOLDOWN_MS_DEFAULT;
}

export function getAutoTranslateScheduleTimezone(): string {
  return (
    process.env.AUTO_TRANSLATE_SCHEDULE_TZ?.trim() ||
    AUTO_TRANSLATE_SCHEDULE_TZ_DEFAULT
  );
}

export function getAutoTranslateScheduleMinute(): number {
  const n = Number(process.env.AUTO_TRANSLATE_SCHEDULE_MINUTE);
  if (!Number.isFinite(n) || n < 0 || n > 59) {
    return AUTO_TRANSLATE_SCHEDULE_MINUTE_DEFAULT;
  }
  return Math.floor(n);
}

/**
 * 把一个店稳定映射到 [0, slotsPerDay) 的槽位（FNV-1a）。
 * 与 worker `shopSlotIndex` 同算法，供存量 hour 回填 / UI 默认值。
 */
export function shopSlotIndex(shop: string, slotsPerDay = 24): number {
  const slots = Math.max(1, Math.min(1440, Math.floor(slotsPerDay)));
  let hash = 0x811c9dc5;
  for (let i = 0; i < shop.length; i++) {
    hash ^= shop.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % slots;
}

export async function readAutoScanLastAt(): Promise<string | null> {
  try {
    const v = await getTranslateV4RedisClient().get(AUTO_SCAN_LAST_AT_KEY);
    return v?.trim() || null;
  } catch {
    return null;
  }
}

function timezoneOffsetMs(at: Date, timeZone: string): number {
  const utc = Date.parse(at.toLocaleString("en-US", { timeZone: "UTC" }));
  const tz = Date.parse(at.toLocaleString("en-US", { timeZone }));
  return tz - utc;
}

function tzYmdHm(
  at: Date,
  timeZone: string,
): { y: number; m: number; d: number; h: number; min: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const pick = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return {
    y: pick("year"),
    m: pick("month"),
    d: pick("day"),
    h: pick("hour"),
    min: pick("minute"),
  };
}

function utcFromTzLocal(
  y: number,
  m: number,
  d: number,
  h: number,
  min: number,
  timeZone: string,
): Date {
  let guess = Date.UTC(y, m - 1, d, h, min, 0, 0);
  for (let i = 0; i < 4; i++) {
    const p = tzYmdHm(new Date(guess), timeZone);
    if (p.y === y && p.m === m && p.d === d && p.h === h && p.min === min) {
      return new Date(guess);
    }
    const offset = timezoneOffsetMs(new Date(guess), timeZone);
    guess = Date.UTC(y, m - 1, d, h, min, 0, 0) - offset;
  }
  return new Date(guess);
}

/**
 * 下一轮全局自动扫描时刻：按配置时区对齐到整点（默认每小时 :00 北京时间）。
 * 单店实际建任务还受 AUTO_TRANSLATE_SHOP_COOLDOWN_MS（默认 3h）约束。
 */
export function resolveNextClockAlignedScanAt(
  now = new Date(),
  intervalMs = getAutoTranslateIntervalMs(),
  timeZone = getAutoTranslateScheduleTimezone(),
  scheduleMinute = getAutoTranslateScheduleMinute(),
): Date {
  const interval = Math.max(60_000, intervalMs);
  const cur = tzYmdHm(now, timeZone);
  let slot = utcFromTzLocal(
    cur.y,
    cur.m,
    cur.d,
    cur.h,
    scheduleMinute,
    timeZone,
  );

  while (slot.getTime() <= now.getTime() + 1000) {
    const p = tzYmdHm(new Date(slot.getTime() + interval), timeZone);
    slot = utcFromTzLocal(p.y, p.m, p.d, p.h, scheduleMinute, timeZone);
  }

  return slot;
}

export function msUntilNextClockAlignedScan(
  now = new Date(),
  intervalMs = getAutoTranslateIntervalMs(),
  timeZone = getAutoTranslateScheduleTimezone(),
  scheduleMinute = getAutoTranslateScheduleMinute(),
): number {
  const next = resolveNextClockAlignedScanAt(
    now,
    intervalMs,
    timeZone,
    scheduleMinute,
  );
  return Math.max(1000, next.getTime() - now.getTime());
}

/** 已开自动翻译的语言：返回下次扫描 ISO 时间（整点对齐，与 Worker 调度一致）。 */
export async function resolveNextAutoUpdateAt(
  autoTranslate: boolean,
): Promise<string | null> {
  if (!autoTranslate) return null;
  return resolveNextClockAlignedScanAt().toISOString();
}
