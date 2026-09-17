import { useCallback, useRef, useState } from "react";
import {
  InputNumber,
  Skeleton,
  Space,
  Statistic,
  Table,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import Button from "~/ui/components/AppButton";
import { AppSModal } from "~/ui/components/AppSModal";
import { useTranslation } from "react-i18next";
import {
  formatLocaleRoute,
  localeRegionCode,
} from "~/routes/app.translate-v4/localeDisplay";
import "../style.css";

const { Title, Text } = Typography;

type CreditUsageMetadata = {
  target?: unknown;
  sourceLocale?: unknown;
  sourceCode?: unknown;
  targetCode?: unknown;
  fieldKey?: unknown;
  shopifyType?: unknown;
};

type CreditUsageRow = {
  id: string;
  direction?: "in" | "out";
  source: string;
  credits: number;
  createdAt: string;
  metadata?: CreditUsageMetadata | null;
};

function asLocaleCode(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function asNonEmptyString(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

/** 从来源 metadata 拼语言路由（v4/单字段用 sourceLocale+target；图片用 sourceCode+targetCode）。 */
function formatUsageLocaleDetail(metadata: CreditUsageRow["metadata"]): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const source =
    asLocaleCode(metadata.sourceLocale) || asLocaleCode(metadata.sourceCode);
  const target =
    asLocaleCode(metadata.target) || asLocaleCode(metadata.targetCode);
  if (source && target) return formatLocaleRoute(source, target);
  if (target) return localeRegionCode(target);
  if (source) return localeRegionCode(source);
  return null;
}

/** 单字段额外：模块类型 + 字段 key（过长截断）。 */
function formatSingleFieldDetail(metadata: CreditUsageRow["metadata"]): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const shopifyType = asNonEmptyString(metadata.shopifyType);
  let fieldKey = asNonEmptyString(metadata.fieldKey);
  if (fieldKey.length > 40) {
    fieldKey = `${fieldKey.slice(0, 37)}…`;
  }
  if (shopifyType && fieldKey) return `${shopifyType} / ${fieldKey}`;
  if (shopifyType) return shopifyType;
  if (fieldKey) return fieldKey;
  return null;
}

function formatUsageSourceDetail(
  source: string,
  metadata: CreditUsageRow["metadata"],
): string | null {
  const parts: string[] = [];
  const localeDetail = formatUsageLocaleDetail(metadata);
  if (localeDetail) parts.push(localeDetail);
  if (source === "single") {
    const fieldDetail = formatSingleFieldDetail(metadata);
    if (fieldDetail) parts.push(fieldDetail);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

interface AcountInfoCardProps {
  loading: boolean;
  translation_balance: number;
  /** 试用 / Launch Credits 池；>0 时展示说明。 */
  trialCredits?: number;
  purchasedCredits?: number;
  migratablePurchasedCredits?: number;
  sparkCreditMigrationEnabled?: boolean;
  onBuyCredits: () => void;
  onMigrateSuccess?: () => void;
}

function newTransferId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `mig_${crypto.randomUUID()}`;
  }
  return `mig_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function formatCredits(value: number): string {
  return Math.max(0, Math.floor(value)).toLocaleString();
}

const AcountInfoCard: React.FC<AcountInfoCardProps> = ({
  loading,
  translation_balance,
  trialCredits = 0,
  purchasedCredits = 0,
  migratablePurchasedCredits = 0,
  sparkCreditMigrationEnabled = false,
  onBuyCredits,
  onMigrateSuccess,
}) => {
  const { t, i18n } = useTranslation();
  const [migrateOpen, setMigrateOpen] = useState(false);
  const [migrateAmount, setMigrateAmount] = useState<number | null>(null);
  const [migrateAll, setMigrateAll] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const transferIdRef = useRef<string>("");

  const [usageOpen, setUsageOpen] = useState(false);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState(false);
  const [usageItems, setUsageItems] = useState<CreditUsageRow[]>([]);

  const purchased = Math.max(0, Math.floor(purchasedCredits));
  const migratable = Math.max(0, Math.floor(migratablePurchasedCredits));
  const consumed = Math.max(0, purchased - migratable);
  const canMigrate = migratable >= 1;

  const sourceLabel = useCallback(
    (source: string, metadata?: CreditUsageRow["metadata"]) => {
      const key = `pricing.usage.source.${source}`;
      const translated = t(key);
      const base = translated === key ? source : translated;
      const detail = formatUsageSourceDetail(source, metadata);
      return detail ? `${base} · ${detail}` : base;
    },
    [t],
  );

  const formatUsageTime = useCallback(
    (iso: string) => {
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return iso;
      try {
        return new Intl.DateTimeFormat(i18n.language || undefined, {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        }).format(date);
      } catch {
        return date.toLocaleString();
      }
    },
    [i18n.language],
  );

  const loadUsage = useCallback(async () => {
    setUsageLoading(true);
    setUsageError(false);
    try {
      const res = await fetch("/api/billing/credit-usage?take=20");
      const data = (await res.json()) as {
        ok?: boolean;
        items?: CreditUsageRow[];
      };
      if (!res.ok || !data.ok || !Array.isArray(data.items)) {
        setUsageError(true);
        setUsageItems([]);
        return;
      }
      setUsageItems(data.items);
    } catch {
      setUsageError(true);
      setUsageItems([]);
    } finally {
      setUsageLoading(false);
    }
  }, []);

  const openUsage = () => {
    setUsageOpen(true);
    void loadUsage();
  };

  const closeUsage = () => {
    setUsageOpen(false);
  };

  const usageColumns: ColumnsType<CreditUsageRow> = [
    {
      title: t("pricing.usage.col.time"),
      dataIndex: "createdAt",
      key: "createdAt",
      render: (value: string) => formatUsageTime(value),
    },
    {
      title: t("pricing.usage.col.source"),
      dataIndex: "source",
      key: "source",
      render: (_value: string, row: CreditUsageRow) =>
        sourceLabel(row.source, row.metadata),
    },
    {
      title: t("pricing.usage.col.credits"),
      dataIndex: "credits",
      key: "credits",
      align: "right",
      render: (value: number, row: CreditUsageRow) => {
        const amount = formatCredits(value);
        const isIn = row.direction === "in";
        return (
          <span
            className={
              isIn ? "pricing-usage-credits--in" : "pricing-usage-credits--out"
            }
          >
            {isIn ? `+${amount}` : `-${amount}`}
          </span>
        );
      },
    },
  ];

  const openMigrate = () => {
    transferIdRef.current = newTransferId();
    setMigrateAmount(canMigrate ? migratable : null);
    setMigrateAll(canMigrate);
    setMigrateOpen(true);
  };

  const handleAll = () => {
    setMigrateAmount(migratable);
    setMigrateAll(true);
  };

  const closeMigrate = () => {
    if (migrating) return;
    setMigrateOpen(false);
  };

  const submitMigrate = async () => {
    if (!canMigrate) {
      message.error(t("pricing.migrate.error.INSUFFICIENT"));
      return;
    }
    const body = migrateAll
      ? { all: true as const, transferId: transferIdRef.current }
      : {
          amount: migrateAmount,
          transferId: transferIdRef.current,
        };
    setMigrating(true);
    try {
      const res = await fetch("/api/billing/migrate-credits-to-spark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        errorCode?: string;
      };
      if (data.ok) {
        message.success(t("pricing.migrate.success"));
        setMigrateOpen(false);
        transferIdRef.current = "";
        onMigrateSuccess?.();
        return;
      }
      const code = data.errorCode ?? "GRANT_FAILED";
      const key = `pricing.migrate.error.${code}`;
      const translated = t(key);
      message.error(translated === key ? t("pricing.migrate.error.generic") : translated);
      if (code !== "GRANT_FAILED") {
        transferIdRef.current = newTransferId();
      }
    } catch {
      message.error(t("pricing.migrate.error.generic"));
    } finally {
      setMigrating(false);
    }
  };

  return (
    <div className="pricing-usage-card">
      <div className="pricing-usage-card__header">
        <Title level={4} style={{ margin: 0 }}>
          {t("pricing.availableCredits")}
        </Title>
      </div>
      <div className="pricing-usage-card__content">
        {loading ? (
          <Skeleton
            active
            paragraph={{ rows: 1, width: ["40%"] }}
            title={false}
          />
        ) : (
          <div className="pricing-usage-card__metric-main">
            <Statistic
              value={translation_balance}
              formatter={(value) => Number(value || 0).toLocaleString()}
              suffix={t("Credits")}
            />
            <div className="pricing-usage-card__actions">
              {trialCredits > 0 ? (
                <Text type="secondary">
                  {t("pricing.includesLaunchCredits", {
                    credits: trialCredits.toLocaleString(),
                  })}
                </Text>
              ) : null}
              <Space wrap>
                <Button onClick={openUsage}>{t("pricing.usage.button")}</Button>
                <Button onClick={onBuyCredits}>{t("Buy credits")}</Button>
                {sparkCreditMigrationEnabled ? (
                  <Button onClick={openMigrate}>{t("pricing.migrate.button")}</Button>
                ) : null}
              </Space>
            </div>
          </div>
        )}
      </div>

      <AppSModal
        open={usageOpen}
        heading={t("pricing.usage.title")}
        onClose={closeUsage}
        size="base"
        secondaryActions={[
          {
            content: t("pricing.usage.close"),
            onAction: closeUsage,
          },
        ]}
      >
        {usageError ? (
          <Text type="secondary">{t("pricing.usage.error")}</Text>
        ) : (
          <div className="pricing-usage-history">
            <Table<CreditUsageRow>
              size="small"
              rowKey="id"
              columns={usageColumns}
              dataSource={usageItems}
              loading={usageLoading}
              pagination={false}
              scroll={{ y: 420 }}
              locale={{ emptyText: t("pricing.usage.empty") }}
            />
          </div>
        )}
      </AppSModal>

      {sparkCreditMigrationEnabled ? (
        <AppSModal
          open={migrateOpen}
          heading={t("pricing.migrate.title")}
          onClose={closeMigrate}
          size="base"
          primaryAction={{
            content: t("pricing.migrate.confirm"),
            onAction: () => void submitMigrate(),
            loading: migrating,
            disabled: !canMigrate,
          }}
          secondaryActions={[
            {
              content: t("pricing.migrate.cancel"),
              onAction: closeMigrate,
            },
          ]}
        >
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Text type="secondary">{t("pricing.migrate.help")}</Text>
            <div className="pricing-migrate-breakdown">
              <div className="pricing-migrate-breakdown__row">
                <span>{t("pricing.migrate.row.purchased")}</span>
                <span>{formatCredits(purchased)}</span>
              </div>
              <div className="pricing-migrate-breakdown__row">
                <span>{t("pricing.migrate.row.consumed")}</span>
                <span>− {formatCredits(consumed)}</span>
              </div>
              <div className="pricing-migrate-breakdown__row pricing-migrate-breakdown__row--result">
                <span>{t("pricing.migrate.row.migratable")}</span>
                <span>{formatCredits(migratable)}</span>
              </div>
            </div>
            {canMigrate ? (
              <Space wrap>
                <InputNumber
                  min={1}
                  max={migratable}
                  value={migrateAmount ?? undefined}
                  onChange={(value) => {
                    setMigrateAll(false);
                    setMigrateAmount(typeof value === "number" ? value : null);
                  }}
                  style={{ width: 200 }}
                />
                <Button onClick={handleAll}>{t("pricing.migrate.all")}</Button>
              </Space>
            ) : (
              <Text type="secondary">{t("pricing.migrate.empty")}</Text>
            )}
          </Space>
        </AppSModal>
      ) : null}
    </div>
  );
};

export default AcountInfoCard;
