import { useRef, useState } from "react";
import { InputNumber, Modal, Skeleton, Space, Statistic, Typography, message } from "antd";
import Button from "~/ui/components/AppButton";
import { useTranslation } from "react-i18next";
import "../style.css";

const { Title, Text } = Typography;

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
  const { t } = useTranslation();
  const [migrateOpen, setMigrateOpen] = useState(false);
  const [migrateAmount, setMigrateAmount] = useState<number | null>(null);
  const [migrateAll, setMigrateAll] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const transferIdRef = useRef<string>("");

  const purchased = Math.max(0, Math.floor(purchasedCredits));
  const migratable = Math.max(0, Math.floor(migratablePurchasedCredits));
  const consumed = Math.max(0, purchased - migratable);
  const canMigrate = migratable >= 1;

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
                <Button onClick={onBuyCredits}>{t("Buy credits")}</Button>
                {sparkCreditMigrationEnabled ? (
                  <Button onClick={openMigrate}>{t("pricing.migrate.button")}</Button>
                ) : null}
              </Space>
            </div>
          </div>
        )}
      </div>

      {sparkCreditMigrationEnabled ? (
        <Modal
          title={t("pricing.migrate.title")}
          open={migrateOpen}
          onCancel={closeMigrate}
          onOk={() => void submitMigrate()}
          okText={t("pricing.migrate.confirm")}
          cancelText={t("pricing.migrate.cancel")}
          confirmLoading={migrating}
          okButtonProps={{ disabled: !canMigrate }}
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
        </Modal>
      ) : null}
    </div>
  );
};

export default AcountInfoCard;
