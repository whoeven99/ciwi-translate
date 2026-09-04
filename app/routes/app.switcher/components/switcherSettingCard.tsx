import { CloseOutlined } from "@ant-design/icons";
import { Space, Skeleton } from "antd";
import Button from "~/ui/components/AppButton";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import useReport from "scripts/eventReport";
import AppSectionCard from "~/ui/components/AppSectionCard";
import AppStatusBadge from "~/ui/components/AppStatusBadge";
import { useThemeAppExtensionStatus } from "~/hooks/useThemeAppExtensionStatus";
import {
  CIWI_SWITCHER_EMBED_HANDLE,
  buildSwitcherThemeEditorUrl,
} from "~/lib/themeAppExtensions";

interface SwitcherSettingCardProps {
  visible: boolean;
  shop: string;
  ciwiSwitcherId: string;
}

const SwitcherSettingCard: React.FC<SwitcherSettingCardProps> = ({
  visible,
  shop,
  ciwiSwitcherId,
}) => {
  const [dismissed, setDismissed] = useState(false);
  const status = useThemeAppExtensionStatus(CIWI_SWITCHER_EMBED_HANDLE);
  const loading = status === "loading";
  const isCompleted = status === "active";
  const themeEditorUrl = buildSwitcherThemeEditorUrl(shop, ciwiSwitcherId);

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
    if (themeEditorUrl) {
      window.open(themeEditorUrl, "_blank", "noopener,noreferrer");
    }
  };

  const shouldShow = visible && !dismissed;

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
          {loading ? null : (
            <AppStatusBadge tone={isCompleted ? "success" : "caution"}>
              {t(isCompleted ? "Completed" : "Uncompleted")}
            </AppStatusBadge>
          )}
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
            <Button type="primary" onClick={handleOpenThemeEditor}>
              {t("Activate plugin")}
            </Button>
          </div>
          <p
            style={{
              margin: 0,
              color: "var(--app-color-text-secondary)",
              fontSize: "var(--app-font-size-body)",
              lineHeight: "20px",
            }}
          >
            {t(
              "Jump to the current Shopify theme editor and Shopify will open the Ciwi switcher app block for you. Then enable it and click Save.",
            )}
          </p>
        </Space>
      ) : null}
    </AppSectionCard>
  );
};

export default SwitcherSettingCard;
