import { Button, InlineStack } from "@shopify/polaris";
import { useNavigate } from "@remix-run/react";
import { useTranslation } from "react-i18next";
import { APP_NAV_ITEMS } from "~/lib/appNav";
import {
  buildSwitcherThemeEditorUrl,
  type ThemeEmbedLoadStatus,
} from "~/lib/themeAppExtensions";
import { AppSectionCard, AppStatusBadge } from "~/ui/components";

type ThemeExtensionStatusCardProps = {
  shop: string;
  ciwiSwitcherId: string;
  status: ThemeEmbedLoadStatus;
};

export function ThemeExtensionStatusCard({
  shop,
  ciwiSwitcherId,
  status,
}: ThemeExtensionStatusCardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const themeEditorUrl = buildSwitcherThemeEditorUrl(shop, ciwiSwitcherId);

  const badge = badgeForStatus(status, t);
  const description = descriptionForStatus(status, t);

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
          <span>{t("v4Mvp.themeExtension.title")}</span>
          <AppStatusBadge tone={badge.tone}>{badge.label}</AppStatusBadge>
        </span>
      }
      description={description}
      extra={
        status === "loading" ? null : (
          <StatusCardActions
            status={status}
            themeEditorUrl={themeEditorUrl}
            onManage={() => navigate(APP_NAV_ITEMS.switcher)}
            t={t}
          />
        )
      }
      bodyPadding="20px 24px"
      style={{ boxShadow: "var(--app-shadow-card)" }}
    >
      {null}
    </AppSectionCard>
  );
}

function badgeForStatus(
  status: ThemeEmbedLoadStatus,
  t: ReturnType<typeof useTranslation>["t"],
): { tone: "success" | "info" | "caution"; label: string } {
  if (status === "active") {
    return { tone: "success", label: t("v4Mvp.themeExtension.badgeActive") };
  }
  if (status === "loading") {
    return { tone: "info", label: t("v4Mvp.themeExtension.badgeLoading") };
  }
  if (status === "unknown") {
    return { tone: "caution", label: t("v4Mvp.themeExtension.badgeUnknown") };
  }
  return { tone: "caution", label: t("v4Mvp.themeExtension.badgeInactive") };
}

function descriptionForStatus(
  status: ThemeEmbedLoadStatus,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (status === "active") return t("v4Mvp.themeExtension.descriptionActive");
  if (status === "loading") return t("v4Mvp.themeExtension.descriptionLoading");
  if (status === "unknown") return t("v4Mvp.themeExtension.descriptionUnknown");
  return t("v4Mvp.themeExtension.descriptionInactive");
}

function StatusCardActions({
  status,
  themeEditorUrl,
  onManage,
  t,
}: {
  status: "active" | "inactive" | "unknown";
  themeEditorUrl: string | null;
  onManage: () => void;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  if (status === "active") {
    return (
      <InlineStack gap="200" wrap>
        {themeEditorUrl ? (
          <Button url={themeEditorUrl} external>
            {t("v4Mvp.themeExtension.disable")}
          </Button>
        ) : null}
        <Button onClick={onManage}>{t("v4Mvp.themeExtension.manage")}</Button>
      </InlineStack>
    );
  }

  if (themeEditorUrl) {
    return (
      <Button variant="primary" url={themeEditorUrl} external>
        {t("v4Mvp.themeExtension.enable")}
      </Button>
    );
  }

  return (
    <Button variant="primary" onClick={onManage}>
      {t("v4Mvp.themeExtension.manage")}
    </Button>
  );
}
