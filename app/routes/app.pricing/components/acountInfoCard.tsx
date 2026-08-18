import { Skeleton, Statistic, Typography } from "antd";
import Button from "~/ui/components/AppButton";
import { useTranslation } from "react-i18next";
import "../style.css";

const { Title, Text } = Typography;

interface AcountInfoCardProps {
  loading: boolean;
  translation_balance: number;
  /** 试用 / Launch Credits 池；>0 时展示说明。 */
  trialCredits?: number;
  onBuyCredits: () => void;
}

const AcountInfoCard: React.FC<AcountInfoCardProps> = ({
  loading,
  translation_balance,
  trialCredits = 0,
  onBuyCredits,
}) => {
  const { t } = useTranslation();

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
            {trialCredits > 0 ? (
              <Text type="secondary">
                {t("pricing.includesLaunchCredits", {
                  credits: trialCredits.toLocaleString(),
                })}
              </Text>
            ) : null}
            <Button onClick={onBuyCredits}>{t("Buy credits")}</Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AcountInfoCard;
