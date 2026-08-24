import { CloseOutlined } from "@ant-design/icons";
import { Space, Typography, Skeleton } from "antd";
import Button from "~/ui/components/AppButton";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import useReport from "scripts/eventReport";
import AppSectionCard from "~/ui/components/AppSectionCard";
import AppStatusBadge from "~/ui/components/AppStatusBadge";
const { Text } = Typography;

type SwitcherActivationStatus = "completed" | "uncompleted";

interface SwitcherSettingCardProps {
  visible: boolean;
  loading: boolean;
  status: SwitcherActivationStatus;
  shop: string;
  ciwiSwitcherId: string;
}

const SwitcherSettingCard: React.FC<SwitcherSettingCardProps> = ({
  visible,
  loading,
  status,
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
  const isCompleted = status === "completed";

  return (
    <AppSectionCard
      style={{ display: shouldShow ? "block" : "none" }}
      title={
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <span>{t("Activate Switcher")}</span>
          <AppStatusBadge tone={isCompleted ? "success" : "critical"}>
            {t(isCompleted ? "Completed" : "Uncompleted")}
          </AppStatusBadge>
        </div>
      }
      description={t(
        "Activate the Switcher to automatically switch market, language, and currency by IP, and enable translation for third-party apps and image alt text.",
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
              justifyContent: "flex-end",
            }}
          >
            <a href={blockUrl} target="_blank" rel="noreferrer">
              <Button type="primary" onClick={handleOpenThemeEditor}>
                {t("Activate plugin")}
              </Button>
            </a>
          </div>
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
