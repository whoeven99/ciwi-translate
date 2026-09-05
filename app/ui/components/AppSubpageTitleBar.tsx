import { TitleBar } from "@shopify/app-bridge-react";
import { useNavigate } from "@remix-run/react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { confirmLeaveSaveBar } from "~/lib/saveBarNavigation";
import { getTranslatePagePath } from "~/lib/translateNavigation";
import type { AppPageBackAction } from "./AppPageHeader";

type AppSubpageTitleBarProps = {
  title: string;
  parentUrl?: string;
  parentLabel?: string;
};

export function useAppHomeBackAction(
  parentUrl?: string,
  parentLabel?: string,
): AppPageBackAction {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const url = parentUrl ?? getTranslatePagePath();
  const label = parentLabel ?? t("v4.title");

  return useMemo(
    () => ({
      accessibilityLabel: label,
      onAction: () => {
        void confirmLeaveSaveBar().then(() => navigate(url));
      },
    }),
    [label, navigate, url],
  );
}

/** 子页 App Bridge 顶栏：breadcrumb 回到父页（BFS 4.1.1）。首页不要用。 */
export default function AppSubpageTitleBar({
  title,
  parentUrl,
  parentLabel,
}: AppSubpageTitleBarProps) {
  const backAction = useAppHomeBackAction(parentUrl, parentLabel);

  return (
    <TitleBar title={title}>
      <button variant="breadcrumb" onClick={backAction.onAction}>
        {backAction.accessibilityLabel}
      </button>
    </TitleBar>
  );
}
