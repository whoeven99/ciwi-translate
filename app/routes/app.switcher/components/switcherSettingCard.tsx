import { CloseOutlined } from "@ant-design/icons";
import { Link } from "@shopify/polaris";
import { Space, Typography, Skeleton } from "antd";
import Button from "~/ui/components/AppButton";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import useReport from "scripts/eventReport";
import AppSectionCard from "~/ui/components/AppSectionCard";
import AppStatusBadge from "~/ui/components/AppStatusBadge";
const { Text } = Typography;

interface SwitcherSettingCardProps {
  visible: boolean | undefined;
  loading: boolean;
  shop: string;
  ciwiSwitcherId: string;
}

const SwitcherSettingCard: React.FC<SwitcherSettingCardProps> = ({
  visible,
  loading,
  shop,
  ciwiSwitcherId,
}) => {
  const [visibleState, setVisibleState] = useState(false);
  const blockUrl = `https://${shop}/admin/themes/current/editor?context=apps&activateAppId=${ciwiSwitcherId}/ciwi_I18n_Switcher`;
  const supportUrl =
    "https://ciwi.ai/help-center/ShopifyApp/how-to-enable-the-app-from-shopify-theme-customization-to-apply-the-language-currency-exchange-switcher";

  const { t } = useTranslation();
  const { reportClick } = useReport();
  useEffect(() => {
    if (localStorage.getItem("switcherCard") == "false") {
      setVisibleState(false);
    } else {
      setVisibleState(Boolean(visible));
    }
  }, [visible]);

  const handleClose = () => {
    setVisibleState(false);
    //保存当前的设置
    localStorage.setItem("switcherCard", "false");
  };

  const handleClickHereReport = () => {
    reportClick("switcher_guide_click_theme");
  };

  return (
    <AppSectionCard
      style={{ display: visibleState ? "block" : "none" }}
      title={t("Switcher Configuration Guide")}
      description={t(
        "No extra currency format setup is required. Just enable the storefront switcher in your current theme.",
      )}
      extra={
        <Button type="text" onClick={handleClose}>
          <CloseOutlined />
        </Button>
      }
    >
      {loading ? <Skeleton active paragraph={{ rows: 3 }} /> : null}
      {!loading ? (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 16,
            padding: 16,
            border: "1px solid var(--app-color-border)",
            borderRadius: 12,
            flexWrap: "wrap",
          }}
        >
          <Space
            direction="vertical"
            size={8}
            style={{ display: "flex", flex: "1 1 360px", minWidth: 0 }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <Text strong style={{ color: "var(--app-color-text)" }}>
                {t("Step 1: Enable switcher")}
              </Text>
              {visible ? (
                <AppStatusBadge tone="critical">
                  {t("Uncompleted")}
                </AppStatusBadge>
              ) : (
                <AppStatusBadge tone="success">{t("Completed")}</AppStatusBadge>
              )}
            </div>
            <Text>
              {t(
                "Jump to the current Shopify theme editor and Shopify will open the Ciwi switcher app block for you. Then enable it and click Save.",
              )}
            </Text>
            <Text>
              {t("Please refer to this")}
              <Link url={supportUrl} target="_blank">
                {t("step-by-step guide")}
              </Link>
            </Text>
          </Space>
          <Link url={blockUrl} target="_blank" onClick={handleClickHereReport}>
            <Button type="primary">
              {t("Open current theme and enable switcher")}
            </Button>
          </Link>
        </div>
      ) : null}
    </AppSectionCard>
  );
};

export default SwitcherSettingCard;
