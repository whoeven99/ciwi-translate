import { CloseOutlined } from "@ant-design/icons";
import { Skeleton } from "antd";
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
import {
  switcherThemeEmbedBadgeForStatus,
  switcherThemeEmbedDescriptionForStatus,
  switcherThemeEmbedTitle,
} from "~/lib/switcherThemeEmbedUi";
import { SwitcherThemeEmbedActions } from "~/ui/components/SwitcherThemeEmbedActions";

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
  };

  const shouldShow = visible && !dismissed;
  const badge = switcherThemeEmbedBadgeForStatus(status, t);
  const description = switcherThemeEmbedDescriptionForStatus(status, t);
  const showThemeEditorHint = status === "inactive" || status === "unknown";

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
          <span>{switcherThemeEmbedTitle(t)}</span>
          {loading ? null : (
            <AppStatusBadge tone={badge.tone}>{badge.label}</AppStatusBadge>
          )}
        </div>
      }
      description={description}
      extra={
        <Button type="text" onClick={handleClose}>
          <CloseOutlined />
        </Button>
      }
    >
      {loading ? <Skeleton active paragraph={{ rows: 3 }} /> : null}
      {!loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <SwitcherThemeEmbedActions
              status={status}
              themeEditorUrl={themeEditorUrl}
              showManage={false}
              onOpenThemeEditor={handleOpenThemeEditor}
              t={t}
            />
          </div>
          {showThemeEditorHint ? (
            <p
              style={{
                margin: 0,
                color: "var(--app-color-text-secondary)",
                fontSize: "var(--app-font-size-body)",
                lineHeight: "20px",
              }}
            >
              {t("v4Mvp.themeExtension.themeEditorHint")}
            </p>
          ) : null}
        </div>
      ) : null}
    </AppSectionCard>
  );
};

export default SwitcherSettingCard;
