import { Button, InlineStack } from "@shopify/polaris";
import type { TFunction } from "i18next";
import { openSwitcherThemeEditor } from "~/lib/themeAppExtensions";

type SwitcherThemeEmbedActionsProps = {
  status: "active" | "inactive" | "unknown";
  themeEditorUrl: string | null;
  t: TFunction;
  onManage?: () => void;
  showManage?: boolean;
  onOpenThemeEditor?: () => void;
};

export function SwitcherThemeEmbedActions({
  status,
  themeEditorUrl,
  t,
  onManage,
  showManage = true,
  onOpenThemeEditor,
}: SwitcherThemeEmbedActionsProps) {
  const openThemeEditor = () => {
    onOpenThemeEditor?.();
    if (themeEditorUrl) {
      openSwitcherThemeEditor(themeEditorUrl);
    }
  };

  if (status === "active") {
    return (
      <InlineStack gap="200" wrap>
        {themeEditorUrl ? (
          <Button variant="secondary" size="slim" onClick={openThemeEditor}>
            {t("v4Mvp.themeExtension.disable")}
          </Button>
        ) : null}
        {showManage && onManage ? (
          <Button variant="secondary" size="slim" onClick={onManage}>
            {t("v4Mvp.themeExtension.manage")}
          </Button>
        ) : null}
      </InlineStack>
    );
  }

  if (themeEditorUrl) {
    return (
      <Button variant="secondary" size="slim" onClick={openThemeEditor}>
        {t("v4Mvp.themeExtension.enable")}
      </Button>
    );
  }

  if (!showManage || !onManage) {
    return null;
  }

  return (
    <Button variant="secondary" size="slim" onClick={onManage}>
      {t("v4Mvp.themeExtension.manage")}
    </Button>
  );
}
