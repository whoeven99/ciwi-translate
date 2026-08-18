import type { ShopLocalesType } from "~/routes/app.language/route";
import type { LoadedShopLocales } from "~/server/translateV4/shopLocales.server";
import { getTsfBootstrapData } from "~/server/billing/bootstrap/getTsfBootstrapData.server";

export type AppBootstrapPlan = {
  id: number;
  type: string;
  feeType: number;
  isInFreePlanTime: boolean;
};

export type AppBootstrapData = {
  plan: AppBootstrapPlan;
  updateTime: string | null;
  chars?: number;
  totalChars?: number;
  /** 试用 / Launch Credits 池余额（有值时 Pricing 账户卡展示）。 */
  trialCredits?: number;
  isNew: boolean | null;
};

/** Build the client bootstrap from the TSF billing and quota ledger. */
export async function loadAppBootstrapData(
  shop: string,
): Promise<AppBootstrapData> {
  return getTsfBootstrapData(shop);
}

export function bootstrapLocalesFromLoaded(loaded: LoadedShopLocales): {
  source: { code: string; name: string };
  targets: ShopLocalesType[];
} {
  const primary = loaded.rows.find((row) => row.primary);
  const source = {
    code: primary?.locale ?? "en",
    name: primary?.name ?? "",
  };
  const targets = loaded.rows
    .filter((row) => !row.primary)
    .map((row) => ({
      locale: row.locale,
      name: row.name,
      primary: row.primary,
      published: row.published,
    }));

  return { source, targets };
}
