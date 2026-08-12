import { tsfExecute, hasTsfDbCredentials } from "./tsfDb.js";
import { isShuttingDown } from "../shutdown.js";

const LOG = "[autoLiquidRetention]";

const DEFAULT_RETENTION_DAYS = 90;
const DEFAULT_MINUTE = 55;
const DEFAULT_INTERVAL_MS = 60 * 60_000;
const DEFAULT_TZ = "Asia/Shanghai";
const DEFAULT_MAX_PER_RUN = 500;
const DEFAULT_ROW_DELAY_MS = 20;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function envBool(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw == null || raw === "") return defaultValue;
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") return false;
  if (raw === "1" || raw === "true" || raw === "on" || raw === "yes") return true;
  return defaultValue;
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const n = Number(process.env[name]);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function isAutoLiquidRetentionEnabled(): boolean {
  return envBool("AUTO_LIQUID_RETENTION_ENABLED", true);
}

export function getAutoLiquidRetentionDays(): number {
  return envInt("AUTO_LIQUID_RETENTION_DAYS", DEFAULT_RETENTION_DAYS, 7, 730);
}

export function getAutoLiquidRetentionTimezone(): string {
  return process.env.AUTO_LIQUID_RETENTION_TZ?.trim() || DEFAULT_TZ;
}

export function getAutoLiquidRetentionMinute(): number {
  return envInt("AUTO_LIQUID_RETENTION_MINUTE", DEFAULT_MINUTE, 0, 59);
}

export function getAutoLiquidRetentionIntervalMs(): number {
  return envInt(
    "AUTO_LIQUID_RETENTION_INTERVAL_MS",
    DEFAULT_INTERVAL_MS,
    60_000,
    24 * 60 * 60_000,
  );
}

function getMaxPerRun(): number {
  return envInt("AUTO_LIQUID_RETENTION_MAX_PER_RUN", DEFAULT_MAX_PER_RUN, 1, 5000);
}

function getRowDelayMs(): number {
  return envInt("AUTO_LIQUID_RETENTION_DELAY_MS", DEFAULT_ROW_DELAY_MS, 0, 2000);
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

export function resolveNextAutoLiquidRetentionAt(now = new Date()): Date {
  const timeZone = getAutoLiquidRetentionTimezone();
  const scheduleMinute = getAutoLiquidRetentionMinute();
  const intervalMs = getAutoLiquidRetentionIntervalMs();
  const cur = tzYmdHm(now, timeZone);
  let slot = utcFromTzLocal(cur.y, cur.m, cur.d, cur.h, scheduleMinute, timeZone);

  while (slot.getTime() <= now.getTime() + 1000) {
    const p = tzYmdHm(new Date(slot.getTime() + intervalMs), timeZone);
    slot = utcFromTzLocal(p.y, p.m, p.d, p.h, scheduleMinute, timeZone);
  }
  return slot;
}

export function msUntilNextAutoLiquidRetention(now = new Date()): number {
  return Math.max(1000, resolveNextAutoLiquidRetentionAt(now).getTime() - now.getTime());
}

/**
 * Slow-delete old source=auto **PENDING** LiquidRule rows (未被翻译的僵尸采集行).
 * 只删 auto+PENDING；DONE（店面替换在用）与 TRANSLATING（任务占用中）保留；
 * 绝不删 source=manual。
 */
export async function cleanupOldAutoLiquidRules(): Promise<{ deleted: number }> {
  if (!isAutoLiquidRetentionEnabled()) {
    console.log(`${LOG} skipped (disabled)`);
    return { deleted: 0 };
  }
  if (!hasTsfDbCredentials()) {
    console.log(`${LOG} skipped (no Turso credentials)`);
    return { deleted: 0 };
  }

  const days = getAutoLiquidRetentionDays();
  const maxPerRun = getMaxPerRun();
  const delayMs = getRowDelayMs();
  console.log(`${LOG} start retentionDays=${days} maxPerRun=${maxPerRun}`);

  const rs = await tsfExecute({
    sql: `SELECT id FROM LiquidRule
          WHERE source = 'auto'
            AND status = 'PENDING'
            AND updatedAt < datetime('now', ?)
          ORDER BY updatedAt ASC
          LIMIT ?`,
    args: [`-${days} days`, maxPerRun],
  });

  const ids = rs.rows.map((r) => String(r.id)).filter(Boolean);
  let deleted = 0;
  for (const id of ids) {
    if (isShuttingDown()) break;
    try {
      // 二次兜底：仅删 auto+PENDING，避免竞态中该行已被任务领走（TRANSLATING）或已 DONE。
      const del = await tsfExecute({
        sql: `DELETE FROM LiquidRule WHERE id = ? AND source = 'auto' AND status = 'PENDING'`,
        args: [id],
      });
      deleted += del.rowsAffected ?? 0;
    } catch (err) {
      console.warn(`${LOG} delete failed id=${id}`, err);
    }
    if (delayMs > 0) await sleep(delayMs);
  }

  console.log(`${LOG} done deleted=${deleted}/${ids.length}`);
  return { deleted };
}
