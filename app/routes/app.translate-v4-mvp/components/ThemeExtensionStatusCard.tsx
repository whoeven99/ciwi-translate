import { Button, InlineStack } from "@shopify/polaris";
import { useNavigate } from "@remix-run/react";
import { useTranslation } from "react-i18next";
import { APP_NAV_ITEMS } from "~/lib/appNav";
import {
  buildSwitcherThemeEditorUrl,
  type ThemeEmbedLoadStatus,
} from "~/lib/themeAppExtensions";
import {
  switcherThemeEmbedBadgeForStatus,
  switcherThemeEmbedDescriptionForStatus,
  switcherThemeEmbedTitle,
} from "~/lib/switcherThemeEmbedUi";
import { AppSectionCard, AppStatusBadge } from "~/ui/components";
import { SwitcherThemeEmbedActions } from "~/ui/components/SwitcherThemeEmbedActions";

type ThemeExtensionStatusCardProps = {
  shop: string;
  ciwiSwitcherId: string;
  status: ThemeEmbedLoadStatus;
  bodyPadding?: string;
  compact?: boolean;
};

export function ThemeExtensionStatusCard({
  shop,
  ciwiSwitcherId,
  status,
  bodyPadding = "10px 16px",
  compact = true,
}: ThemeExtensionStatusCardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const themeEditorUrl = buildSwitcherThemeEditorUrl(shop, ciwiSwitcherId);

  const badge = switcherThemeEmbedBadgeForStatus(status, t);
  const description = switcherThemeEmbedDescriptionForStatus(status, t);

  return (
    <AppSectionCard
      title={
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <span>{switcherThemeEmbedTitle(t)}</span>
          <AppStatusBadge tone={badge.tone}>{badge.label}</AppStatusBadge>
        </span>
      }
      description={description}
      bodyPadding={bodyPadding}
      compact={compact}
      style={{
        height: "100%",
        flex: 1,
        display: "flex",
        flexDirection: "column",
        boxShadow: "var(--app-shadow-card)",
      }}
    >
      {status === "loading" ? null : (
        <div style={statusCardFooterStyle}>
          <SwitcherThemeEmbedActions
            status={status}
            themeEditorUrl={themeEditorUrl}
            onManage={() => navigate(APP_NAV_ITEMS.switcher)}
            t={t}
          />
        </div>
      )}
    </AppSectionCard>
  );
}

const statusCardFooterStyle = {
  marginTop: "auto",
  display: "flex",
  justifyContent: "flex-end",
} as const;
