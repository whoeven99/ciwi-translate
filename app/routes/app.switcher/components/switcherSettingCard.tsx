import { CloseOutlined } from "@ant-design/icons";
import { Space, Typography, Skeleton } from "antd";
import Button from "~/ui/components/AppButton";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import useReport from "scripts/eventReport";
import AppSectionCard from "~/ui/components/AppSectionCard";
import AppStatusBadge from "~/ui/components/AppStatusBadge";
const { Text, Paragraph } = Typography;

interface SwitcherSettingCardProps {
  visible: boolean;
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
  const [dismissed, setDismissed] = useState(false);
  const blockUrl = `https://${shop}/admin/themes/current/editor?context=apps&activateAppId=${ciwiSwitcherId}/ciwi_I18n_Switcher`;

  const { t } = useTranslation();
  const { reportClick } = useReport();

  useEffect(() => {
    setDismissed(localStorage.getItem("switcherCard") === "false");
  }, []);

  const handleClose = () => {
    setDismissed(true);
    localStorage.setItem("switcherCard", "false");
  };

  const handleOpenThemeEditor = () => {
    reportClick("switcher_guide_click_theme");
  };

  const shouldShow = visible && !dismissed;

  return (
    <AppSectionCard
      style={{ display: shouldShow ? "block" : "none" }}
      title={t("Switcher Configuration Guide")}
      description={t(
        "Enable the storefront switcher in your current theme so shoppers can switch language and currency.",
      )}
      extra={
        <Button type="text" onClick={handleClose}>
          <CloseOutlined />
        </Button>
      }
    >
      {loading ? <Skeleton active paragraph={{ rows: 3 }} /> : null}
      {!loading ? (
        <Space direction="vertical" size="middle" style={{ display: "flex" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <AppStatusBadge tone="critical">{t("Uncompleted")}</AppStatusBadge>
            <a href={blockUrl} target="_blank" rel="noreferrer">
              <Button type="primary" onClick={handleOpenThemeEditor}>
                {t("Open current theme and enable switcher")}
              </Button>
            </a>
          </div>
          <Paragraph style={{ marginBottom: 0 }}>
            {t(
              "No extra currency format setup is required. Just enable the storefront switcher in your current theme.",
            )}
          </Paragraph>
          <Text style={{ color: "var(--app-color-text-secondary)" }}>
            {t(
              "Jump to the current Shopify theme editor and Shopify will open the Ciwi switcher app block for you. Then enable it and click Save.",
            )}
          </Text>
        </Space>
      ) : null}
    </AppSectionCard>
  );
};

export default SwitcherSettingCard;
