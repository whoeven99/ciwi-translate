import { CloseOutlined } from "@ant-design/icons";
import { Link } from "@shopify/polaris";
import { Space, Typography, Skeleton, Divider } from "antd";
import Button from "~/ui/components/AppButton";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import useReport from "scripts/eventReport";
import AppSectionCard from "~/ui/components/AppSectionCard";
import AppStatusBadge from "~/ui/components/AppStatusBadge";
const { Text, Paragraph } = Typography;

interface SwitcherSettingCardProps {
  step1Visible: boolean | undefined;
  step2Visible: boolean | undefined;
  loading: boolean;
  shop: string;
  ciwiSwitcherId: string;
  withMoneyValue: string;
  withoutMoneyValue: string;
}

const SwitcherSettingCard: React.FC<SwitcherSettingCardProps> = ({
  step1Visible,
  step2Visible,
  loading,
  shop,
  ciwiSwitcherId,
  withMoneyValue,
  withoutMoneyValue,
}) => {
  const [visible, setVisible] = useState(false);
  const blockUrl = `https://${shop}/admin/themes/current/editor?context=apps&activateAppId=${ciwiSwitcherId}/ciwi_I18n_Switcher`;
  const supportUrl =
    "https://ciwi.ai/help-center/ShopifyApp/how-to-enable-the-app-from-shopify-theme-customization-to-apply-the-language-currency-exchange-switcher";
  const settingUrl = `https://admin.shopify.com/store/${shop.split(".")[0]}/settings/general`;

  const { t } = useTranslation();
  const { reportClick } = useReport();
  useEffect(() => {
    if (localStorage.getItem("switcherCard") == "false") {
      setVisible(false);
    } else {
      if (step1Visible || step2Visible) {
        setVisible(true);
      }
    }
  }, [step1Visible, step2Visible]);

  const handleClose = () => {
    setVisible(false);
    //保存当前的设置
    localStorage.setItem("switcherCard", "false");
  };
  const handleGoogleReport = () => {
    reportClick("switcher_guide_setup");
  };
  const handleClickHereReport = () => {
    reportClick("switcher_guide_click_theme");
  };
  return (
    <AppSectionCard
      style={{ display: visible ? "block" : "none" }}
      title={t("Switcher Configuration Guide")}
      description={t(
        "Follow these two steps to make the storefront switcher available and styled correctly.",
      )}
      extra={
        <Button type="text" onClick={handleClose}>
          <CloseOutlined />
        </Button>
      }
    >
      {loading ? <Skeleton active paragraph={{ rows: 6 }} /> : null}
      {!loading ? (
        <>
          <Text strong style={{ color: "var(--app-color-text)" }}>
            {t("Step 1: Set up Currency Format")}
          </Text>
          <Space direction="vertical" size="small" style={{ display: "flex" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              {step1Visible ? (
                  <AppStatusBadge tone="caution">
                    {t("Uncompleted")}
                  </AppStatusBadge>
              ) : (
                <AppStatusBadge tone="success">{t("Completed")}</AppStatusBadge>
              )}
              <Link url={settingUrl} target="_blank">
                <Button
                  type="primary"
                  onClick={handleGoogleReport}
                  className="currency-action"
                >
                  {t("Setup")}
                </Button>
              </Link>
            </div>
            <Text>
              {t(
                "To display currency switcher, please follow the instructions below:",
              )}
            </Text>
            <div>
              <Text>{t("1. Go to")}</Text>
              <Link url={settingUrl} target="_blank">
                {t("Settings >> General")}
              </Link>
            </div>
            <Text>
              {t("2. Under the")}
              <strong>{t("'Store defaults'")}</strong>
              {t(
                "section, click Change currency formatting, then change with the code below:",
              )}
            </Text>

            <div>
              <strong>HTML with currency:</strong>
              {withMoneyValue ? (
                <Paragraph
                  copyable={{
                    text: `<span class=ciwi-money>${withMoneyValue}</span>`,
                  }}
                >
                  &lt;span class=ciwi-money&gt;{withMoneyValue}
                  &lt;/span&gt;
                </Paragraph>
              ) : (
                <Skeleton active paragraph={{ rows: 0 }} />
              )}
            </div>

            <div>
              <strong>HTML without currency:</strong>
              {withoutMoneyValue ? (
                <Paragraph
                  copyable={{
                    text: `<span class=ciwi-money>${withoutMoneyValue}</span>`,
                  }}
                >
                  &lt;span class=ciwi-money&gt;{withoutMoneyValue}
                  &lt;/span&gt;
                </Paragraph>
              ) : (
                <Skeleton active paragraph={{ rows: 0 }} />
              )}
            </div>
          </Space>
          <Divider />
          <Text strong style={{ color: "var(--app-color-text)" }}>
            {t("Step 2: Enable switcher")}
          </Text>
          <Space direction="vertical" size="small" style={{ display: "flex" }}>
            <div className="card-header">
              {step2Visible ? (
                  <AppStatusBadge tone="caution">
                    {t("Uncompleted")}
                  </AppStatusBadge>
              ) : (
                <AppStatusBadge tone="success">{t("Completed")}</AppStatusBadge>
              )}
            </div>
            <Text>
              {t("Please")}
              <Link
                url={blockUrl}
                target="_blank"
                onClick={handleClickHereReport}
              >
                {t("Click here")}
              </Link>
              {t(
                "to go to Shopify theme editor >> enable Ciwi_Switcher >> click the Save button in the right corner.",
              )}
            </Text>
            <Text>
              {t("Please refer to this")}
              <Link url={supportUrl} target="_blank">
                {t("step-by-step guide")}
              </Link>
            </Text>
          </Space>
        </>
      ) : null}
    </AppSectionCard>
  );
};

export default SwitcherSettingCard;
