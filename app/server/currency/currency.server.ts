import prisma from "~/db.server";
import currencyLocaleData from "~/utils/currency-locale-data";
import {
  buildTranslateV4Error,
  TRANSLATE_V4_ERROR_KEYS,
  type TranslateV4ErrorKey,
} from "~/utils/translateV4Errors";
import { type BaseResponse } from "~/server/storefront/response.server";
import { invalidateStorefrontCache } from "~/server/storefront/cache.server";

type CurrencyLocaleInfo = {
  currencyName?: string;
  symbol?: string;
  locale?: string;
};

type CurrencyRow = {
  id: number;
  shop: string;
  currencyName: string;
  currencyCode: string;
  rounding: string | null;
  exchangeRate: string | null;
  primaryStatus: number;
};

export type CurrencyPayload = {
  id: number;
  shopName: string;
  currencyName: string;
  currencyCode: string;
  rounding: string | null;
  exchangeRate: string | number | null;
  primaryStatus: number;
  symbol?: string;
};

export type CurrencyTableRow = {
  key: number;
  currency: string;
  rounding: string | null;
  exchangeRate: string | number | null;
  currencyCode: string;
  primaryStatus: number;
  symbol?: string;
};

type CurrencyWriteInput = {
  shop: string;
  currencyName?: string | null;
  currencyCode?: string | null;
  rounding?: string | number | null;
  exchangeRate?: string | number | null;
  primaryStatus?: number | null;
};

type CurrencyUpdateInput = {
  shop: string;
  id: number | string;
  rounding?: string | number | null;
  exchangeRate?: string | number | null;
};

const RATE_BASE = "EUR";
const RATE_TTL_MS = 2 * 24 * 60 * 60 * 1000;

function ok<T>(response: T): BaseResponse<T> {
  return { success: true, errorCode: 0, errorMsg: "", response };
}

function fail<T>(errorKey: TranslateV4ErrorKey, response: T): BaseResponse<T> {
  const error = buildTranslateV4Error(errorKey);
  return {
    success: false,
    errorCode: error.errorCode,
    errorMsg: error.errorMsg,
    response,
  };
}

function normalizeCurrencyCode(code: string | null | undefined): string {
  return String(code ?? "").trim().toUpperCase();
}

function nullableString(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  return String(value);
}

function localeInfo(code: string): CurrencyLocaleInfo | undefined {
  return (currencyLocaleData as Record<string, CurrencyLocaleInfo>)[code];
}

function toCurrencyPayload(row: CurrencyRow): CurrencyPayload {
  const code = normalizeCurrencyCode(row.currencyCode);
  return {
    id: row.id,
    shopName: row.shop,
    currencyName: row.currencyName,
    currencyCode: code,
    rounding: row.rounding,
    exchangeRate: row.exchangeRate,
    primaryStatus: row.primaryStatus,
    symbol: localeInfo(code)?.symbol ?? "-",
  };
}

export function toCurrencyTableRow(item: CurrencyPayload): CurrencyTableRow {
  return {
    key: item.id,
    currency: item.currencyName,
    rounding: item.rounding,
    exchangeRate: item.exchangeRate,
    currencyCode: item.currencyCode,
    primaryStatus: item.primaryStatus,
    symbol: item.symbol,
  };
}

function rateApiKey(): string {
  return (
    process.env.FIXER_API_KEY?.trim() ||
    process.env.RATE_API_KEY?.trim() ||
    process.env.RATE_KEY?.trim() ||
    process.env.RATE_KEY_VAULT?.trim() ||
    ""
  );
}

async function refreshRatesIfNeeded(): Promise<void> {
  const now = new Date();
  const existing = await prisma.currencyRate.findFirst({
    where: { currencyCode: RATE_BASE, expiresAt: { gt: now } },
    select: { currencyCode: true },
  });
  if (existing) return;

  const key = rateApiKey();
  if (!key) {
    console.warn("[currency] rate API key missing; auto rates remain unavailable");
    return;
  }

  const symbols = Object.keys(currencyLocaleData as Record<string, CurrencyLocaleInfo>)
    .sort()
    .join(",");
  const url = `https://api.apilayer.com/fixer/latest?base=${RATE_BASE}&symbols=${symbols}`;
  const res = await fetch(url, { headers: { apikey: key } });
  if (!res.ok) {
    console.warn("[currency] rate API failed", res.status, await res.text().catch(() => ""));
    return;
  }

  const data = (await res.json().catch(() => null)) as {
    rates?: Record<string, number | string>;
  } | null;
  if (!data?.rates || Object.keys(data.rates).length === 0) {
    console.warn("[currency] rate API returned empty rates");
    return;
  }

  const fetchedAt = now;
  const expiresAt = new Date(now.getTime() + RATE_TTL_MS);
  await prisma.$transaction(
    [
      { currencyCode: RATE_BASE, rate: 1 },
      ...Object.entries(data.rates)
        .map(([currencyCode, rawRate]) => ({
          currencyCode: normalizeCurrencyCode(currencyCode),
          rate: Number(rawRate),
        }))
        .filter((item) => item.currencyCode && Number.isFinite(item.rate)),
    ]
      .map((item) =>
        prisma.currencyRate.upsert({
          where: { currencyCode: item.currencyCode },
          create: {
            currencyCode: item.currencyCode,
            rate: item.rate,
            base: RATE_BASE,
            fetchedAt,
            expiresAt,
          },
          update: {
            rate: item.rate,
            base: RATE_BASE,
            fetchedAt,
            expiresAt,
          },
        }),
      ),
  );
}

async function readRate(currencyCode: string): Promise<number | null> {
  if (normalizeCurrencyCode(currencyCode) === RATE_BASE) return 1;
  await refreshRatesIfNeeded();
  const row = await prisma.currencyRate.findUnique({
    where: { currencyCode: normalizeCurrencyCode(currencyCode) },
    select: { rate: true, expiresAt: true },
  });
  if (!row || row.expiresAt.getTime() <= Date.now()) return null;
  return row.rate;
}

export async function insertCurrency(
  input: CurrencyWriteInput,
): Promise<BaseResponse<CurrencyPayload | undefined>> {
  const currencyCode = normalizeCurrencyCode(input.currencyCode);
  if (!currencyCode) {
    return fail(TRANSLATE_V4_ERROR_KEYS.CURRENCY_CODE_REQUIRED, undefined);
  }

  const currencyName =
    String(input.currencyName ?? "").trim() ||
    localeInfo(currencyCode)?.currencyName ||
    currencyCode;
  const primaryStatus = Number(input.primaryStatus ?? 0) || 0;
  const row = await prisma.currency.upsert({
    where: { shop_currencyCode: { shop: input.shop, currencyCode } },
    create: {
      shop: input.shop,
      currencyName,
      currencyCode,
      rounding: input.rounding == null ? null : nullableString(input.rounding),
      exchangeRate:
        input.exchangeRate == null ? null : nullableString(input.exchangeRate),
      primaryStatus,
    },
    update: {
      currencyName,
      rounding: input.rounding == null ? null : nullableString(input.rounding),
      exchangeRate:
        input.exchangeRate == null ? null : nullableString(input.exchangeRate),
      primaryStatus,
    },
  });

  await invalidateStorefrontCache("currency", input.shop);
  return ok(toCurrencyPayload(row));
}

export async function updateCurrency(
  input: CurrencyUpdateInput,
): Promise<BaseResponse<CurrencyUpdateInput>> {
  const id = Number(input.id);
  if (!Number.isInteger(id)) {
    return fail(TRANSLATE_V4_ERROR_KEYS.INVALID_ID, input);
  }

  const result = await prisma.currency.updateMany({
    where: { id, shop: input.shop },
    data: {
      rounding: nullableString(input.rounding),
      exchangeRate: nullableString(input.exchangeRate),
    },
  });

  if (result.count <= 0) {
    return fail(TRANSLATE_V4_ERROR_KEYS.CURRENCY_NOT_FOUND, input);
  }

  await invalidateStorefrontCache("currency", input.shop);
  return ok({
    ...input,
    id,
    rounding: nullableString(input.rounding),
    exchangeRate: nullableString(input.exchangeRate),
  });
}

export async function deleteCurrency(
  shop: string,
  id: number | string,
): Promise<BaseResponse<number | undefined>> {
  const currencyId = Number(id);
  if (!Number.isInteger(currencyId)) {
    return fail(TRANSLATE_V4_ERROR_KEYS.INVALID_ID, undefined);
  }

  const result = await prisma.currency.deleteMany({
    where: { id: currencyId, shop },
  });

  if (result.count <= 0) {
    return fail(TRANSLATE_V4_ERROR_KEYS.CURRENCY_NOT_FOUND, undefined);
  }

  await invalidateStorefrontCache("currency", shop);
  return ok(currencyId);
}

export async function getCurrencyByShopName(
  shop: string,
): Promise<BaseResponse<CurrencyPayload[]>> {
  const rows = await prisma.currency.findMany({
    where: { shop },
    orderBy: [{ primaryStatus: "desc" }, { id: "asc" }],
  });
  if (rows.length === 0) return ok([]);
  return ok(rows.map(toCurrencyPayload));
}

export async function getCurrencyTableByShopName(
  shop: string,
): Promise<BaseResponse<CurrencyTableRow[]>> {
  const result = await getCurrencyByShopName(shop);
  if (!result.success || !Array.isArray(result.response)) {
    return fail(TRANSLATE_V4_ERROR_KEYS.CURRENCY_LIST_FAILED, []);
  }
  return ok(result.response.map(toCurrencyTableRow));
}

export async function initCurrency(
  shop: string,
): Promise<BaseResponse<CurrencyPayload | "">> {
  const row = await prisma.currency.findFirst({
    where: { shop, primaryStatus: 1 },
    orderBy: { id: "asc" },
  });
  return ok(row ? toCurrencyPayload(row) : "");
}

export async function updateDefaultCurrency(
  input: CurrencyWriteInput,
): Promise<BaseResponse<CurrencyPayload | undefined>> {
  const currencyCode = normalizeCurrencyCode(input.currencyCode);
  if (!currencyCode) {
    return fail(TRANSLATE_V4_ERROR_KEYS.CURRENCY_CODE_REQUIRED, undefined);
  }

  const currencyName =
    String(input.currencyName ?? "").trim() ||
    localeInfo(currencyCode)?.currencyName ||
    currencyCode;

  const row = await prisma.$transaction(async (tx) => {
    await tx.currency.deleteMany({
      where: {
        shop: input.shop,
        OR: [{ currencyCode }, { primaryStatus: 1 }],
      },
    });
    return tx.currency.create({
      data: {
        shop: input.shop,
        currencyName,
        currencyCode,
        rounding: input.rounding == null ? null : nullableString(input.rounding),
        exchangeRate:
          input.exchangeRate == null ? null : nullableString(input.exchangeRate),
        primaryStatus: 1,
      },
    });
  });

  await invalidateStorefrontCache("currency", input.shop);
  return ok(toCurrencyPayload(row));
}

export async function getCurrencyCacheData(
  shop: string,
  currencyCodeInput: string,
  fromCurrencyCodeInput?: string,
): Promise<BaseResponse<CurrencyPayload | undefined>> {
  const currencyCode = normalizeCurrencyCode(currencyCodeInput);
  const row = await prisma.currency.findUnique({
    where: { shop_currencyCode: { shop, currencyCode } },
  });
  if (!row) return fail(TRANSLATE_V4_ERROR_KEYS.CURRENCY_NOT_FOUND, undefined);

  const payload = toCurrencyPayload(row);
  const hasManualRate =
    payload.exchangeRate !== null && payload.exchangeRate !== "Auto";
  if (hasManualRate) {
    return ok(payload);
  }

  const fromCurrencyCode = normalizeCurrencyCode(fromCurrencyCodeInput);
  let baseCurrencyCode = fromCurrencyCode;

  if (!baseCurrencyCode) {
    const primary = await prisma.currency.findFirst({
      where: { shop, primaryStatus: 1 },
      select: { currencyCode: true },
    });
    baseCurrencyCode = normalizeCurrencyCode(primary?.currencyCode);
  }
  if (!baseCurrencyCode) return ok(payload);
  if (baseCurrencyCode === currencyCode) {
    payload.exchangeRate = 1;
    return ok(payload);
  }

  const [fromRate, toRate] = await Promise.all([
    readRate(baseCurrencyCode),
    readRate(currencyCode),
  ]);
  if (fromRate && toRate) {
    payload.exchangeRate = toRate / fromRate;
  }

  return ok(payload);
}
