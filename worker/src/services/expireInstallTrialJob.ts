import { isShuttingDown } from "../shutdown.js";
import {
  expireInstallTrialCreditsIfDue,
  hasTsfDbCredentials,
  tsfExecute,
} from "./tsfDb.js";

const LOG = "[installTrialExpiry]";

/** 单次最多结算店数，剩余顺延到下一轮 12h。 */
const DEFAULT_MAX_PER_RUN = 200;
/** 店与店之间间隔，削平 Turso 突发写。 */
const DEFAULT_SHOP_DELAY_MS = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const n = Number(process.env[name]);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function getMaxPerRun(): number {
  return envInt("INSTALL_TRIAL_EXPIRY_MAX_PER_RUN", DEFAULT_MAX_PER_RUN, 1, 2000);
}

function getShopDelayMs(): number {
  return envInt("INSTALL_TRIAL_EXPIRY_DELAY_MS", DEFAULT_SHOP_DELAY_MS, 0, 5_000);
}

export async function runInstallTrialExpiryScan(): Promise<void> {
  if (!hasTsfDbCredentials()) {
    console.log(`${LOG} TSF Turso 未配置，跳过`);
    return;
  }

  const maxPerRun = getMaxPerRun();
  const delayMs = getShopDelayMs();
  const nowIso = new Date().toISOString();
  const rs = await tsfExecute({
    sql: `SELECT shop FROM Account
          WHERE deletedAt IS NULL
            AND trialCreditsExpiresAt IS NOT NULL
            AND trialCreditsExpiresAt <= ?
            AND trialCredits > 0
          ORDER BY trialCreditsExpiresAt ASC
          LIMIT ?`,
    args: [nowIso, maxPerRun],
  });
  const shops = rs.rows.map((row) => String(row.shop ?? "")).filter(Boolean);
  const truncated = shops.length >= maxPerRun;

  let expired = 0;
  let errors = 0;
  for (let i = 0; i < shops.length; i += 1) {
    if (isShuttingDown()) break;
    const shop = shops[i];
    if (!shop) continue;
    try {
      const did = await expireInstallTrialCreditsIfDue(shop);
      if (did) expired += 1;
    } catch (err) {
      errors += 1;
      console.error(`${LOG} failed shop=${shop}`, err);
    }
    if (delayMs > 0 && i < shops.length - 1) {
      if (isShuttingDown()) break;
      await sleep(delayMs);
    }
  }

  console.log(
    `${LOG} scanned=${shops.length} expired=${expired} errors=${errors} maxPerRun=${maxPerRun} truncated=${truncated ? 1 : 0}`,
  );
}
