import { sendFeishuTextMessage } from "../feishu/sendFeishuTextMessage.server";

export type CreditMigrationFeishuParams = {
  shop: string;
  amount: number;
  transferId: string;
  ok: boolean;
  errorCode?: string;
  rolledBack?: boolean;
  tsfUsedBefore?: number;
  tsfUsedAfter?: number;
  sparkPurchasedBefore?: number;
  sparkPurchasedAfter?: number;
};

function formatNumber(n: number | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US");
}

export function buildCreditMigrationFeishuMessage(
  params: CreditMigrationFeishuParams,
): string {
  const lines = [
    params.ok ? "积分迁移到 Spark · 成功" : "积分迁移到 Spark · 失败",
    "",
    `店铺: ${params.shop}`,
    `数量: ${formatNumber(params.amount)}（1:1，仅购买积分：总额−订阅−试用−已用）`,
    `结果: ${params.ok ? "成功" : "失败"}`,
  ];
  if (!params.ok && params.errorCode) {
    lines.push(`errorCode: ${params.errorCode}`);
  }
  if (params.rolledBack) {
    lines.push("Spark 已回滚");
  }
  if (params.ok || params.tsfUsedBefore != null) {
    lines.push(
      `翻译已使用: ${formatNumber(params.tsfUsedBefore)} → ${formatNumber(params.tsfUsedAfter)}`,
    );
  }
  if (params.sparkPurchasedBefore != null || params.sparkPurchasedAfter != null) {
    lines.push(
      `Spark 加量: ${formatNumber(params.sparkPurchasedBefore)} → ${formatNumber(params.sparkPurchasedAfter)}`,
    );
  }
  lines.push(`transferId: ${params.transferId}`);
  lines.push(`时间: ${new Date().toISOString()}`);
  return lines.join("\n");
}

/** 异步飞书；失败只打日志，不抛。 */
export function scheduleCreditMigrationFeishuNotify(
  params: CreditMigrationFeishuParams,
): void {
  void sendFeishuTextMessage(buildCreditMigrationFeishuMessage(params)).then(
    (result) => {
      if (!result.ok && !("skipped" in result && result.skipped)) {
        console.warn(
          `[credit-migration] feishu failed shop=${params.shop} transferId=${params.transferId}`,
          result,
        );
      }
    },
    (error) => {
      console.warn(
        `[credit-migration] feishu unhandled shop=${params.shop} transferId=${params.transferId}`,
        error,
      );
    },
  );
}
