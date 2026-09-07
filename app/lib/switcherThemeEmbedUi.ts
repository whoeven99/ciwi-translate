import type { TFunction } from "i18next";
import type { ThemeEmbedLoadStatus } from "~/lib/themeAppExtensions";

export type SwitcherThemeEmbedBadge = {
  tone: "success" | "info" | "caution";
  label: string;
};

export function switcherThemeEmbedBadgeForStatus(
  status: ThemeEmbedLoadStatus,
  t: TFunction,
): SwitcherThemeEmbedBadge {
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

export function switcherThemeEmbedDescriptionForStatus(
  status: ThemeEmbedLoadStatus,
  t: TFunction,
): string {
  if (status === "active") return t("v4Mvp.themeExtension.descriptionActive");
  if (status === "loading") return t("v4Mvp.themeExtension.descriptionLoading");
  if (status === "unknown") return t("v4Mvp.themeExtension.descriptionUnknown");
  return t("v4Mvp.themeExtension.descriptionInactive");
}

export function switcherThemeEmbedTitle(t: TFunction): string {
  return t("v4Mvp.themeExtension.title");
}
