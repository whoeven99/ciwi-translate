import {
  CREDIT_MIGRATION_SIGNATURE_HEADER,
  CREDIT_MIGRATION_TIMESTAMP_HEADER,
  signCreditMigrationBody,
} from "./sparkCreditMigrationHmac.server";

export type SparkGrantOk = {
  ok: true;
  alreadyApplied: boolean;
  shop: string;
  transferId: string;
  amount: number;
  purchasedBefore: number;
  purchasedAfter: number;
  usedTokens: number;
};

export type SparkGrantErr = {
  ok: false;
  errorCode:
    | "SPARK_NOT_INSTALLED"
    | "INVALID_AMOUNT"
    | "ALREADY_ROLLED_BACK"
    | "UNAUTHORIZED"
    | "NOT_CONFIGURED"
    | "GRANT_FAILED";
  shop?: string;
  transferId?: string;
};

export type SparkRollbackResult =
  | {
      ok: true;
      alreadyApplied: boolean;
      amount: number;
      purchasedBefore: number;
      purchasedAfter: number;
    }
  | { ok: false; errorCode: string };

function resolveConfig(env: NodeJS.ProcessEnv = process.env): {
  url: string;
  secret: string;
} | null {
  const url = env.SPARK_CREDIT_MIGRATION_URL?.trim();
  const secret = env.SPARK_CREDIT_MIGRATION_SECRET?.trim();
  if (!url || !secret) return null;
  return { url, secret };
}

async function postSpark(
  action: "grant" | "rollback",
  payload: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const config = resolveConfig();
  if (!config) {
    return {
      status: 503,
      body: { ok: false, errorCode: "NOT_CONFIGURED" },
    };
  }

  const rawBody = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const signature = signCreditMigrationBody(config.secret, timestamp, rawBody);
  const res = await fetch(config.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [CREDIT_MIGRATION_TIMESTAMP_HEADER]: timestamp,
      [CREDIT_MIGRATION_SIGNATURE_HEADER]: signature,
    },
    body: rawBody,
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body };
}

export function isSparkMigrationConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveConfig(env) !== null;
}

export async function grantCreditsOnSpark(params: {
  shop: string;
  amount: number;
  transferId: string;
}): Promise<SparkGrantOk | SparkGrantErr> {
  try {
    const { body } = await postSpark("grant", {
      action: "grant",
      shop: params.shop,
      amount: params.amount,
      transferId: params.transferId,
    });
    if (body.ok === true) {
      return body as SparkGrantOk;
    }
    const errorCode = String(body.errorCode ?? "GRANT_FAILED") as SparkGrantErr["errorCode"];
    return {
      ok: false,
      errorCode:
        errorCode === "SPARK_NOT_INSTALLED" ||
        errorCode === "INVALID_AMOUNT" ||
        errorCode === "ALREADY_ROLLED_BACK" ||
        errorCode === "UNAUTHORIZED" ||
        errorCode === "NOT_CONFIGURED"
          ? errorCode
          : "GRANT_FAILED",
      shop: params.shop,
      transferId: params.transferId,
    };
  } catch (error) {
    console.error(
      `[credit-migration] spark grant failed shop=${params.shop} transferId=${params.transferId}`,
      error,
    );
    return {
      ok: false,
      errorCode: "GRANT_FAILED",
      shop: params.shop,
      transferId: params.transferId,
    };
  }
}

export async function rollbackCreditsOnSpark(params: {
  shop: string;
  transferId: string;
}): Promise<SparkRollbackResult> {
  try {
    const { body } = await postSpark("rollback", {
      action: "rollback",
      shop: params.shop,
      transferId: params.transferId,
    });
    if (body.ok === true) {
      return body as SparkRollbackResult;
    }
    return {
      ok: false,
      errorCode: String(body.errorCode ?? "ROLLBACK_FAILED"),
    };
  } catch (error) {
    console.error(
      `[credit-migration] spark rollback failed shop=${params.shop} transferId=${params.transferId}`,
      error,
    );
    return { ok: false, errorCode: "ROLLBACK_FAILED" };
  }
}
