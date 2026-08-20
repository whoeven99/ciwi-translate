import { SaveBar, TitleBar } from "@shopify/app-bridge-react";
import { Page } from "@shopify/polaris";
import {
  Alert,
  Card,
  Typography,
  Switch,
  Select,
  ColorPicker,
  Slider,
  Popconfirm,
  Modal,
} from "antd";
import Button from "~/ui/components/AppButton";
import { useTranslation } from "react-i18next";
import {
  getTranslateV4ErrorMessage,
  TRANSLATE_V4_ERROR_KEYS,
} from "~/utils/translateV4Errors";
import styles from "./styles.module.css";
import { useEffect, useMemo, useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import {
  useLoaderData,
  useLocation,
  useNavigate,
} from "@remix-run/react";
import { authenticate } from "~/shopify.server";
import {
  loadSwitcherConfigCompat,
  saveSwitcherConfigCompat,
  buildSwitcherEditDefaults,
  type SwitcherEditData,
} from "./switcherClient";
import { useSelector } from "react-redux";
import { InfoCircleOutlined } from "@ant-design/icons";
import defaultStyles from "../styles/defaultStyles.module.css";
import useReport from "scripts/eventReport";
import CloseIcon from "~/components/icon/closeIcon";
import { withEmbeddedSearch } from "~/utils/embeddedAction";
import SwitcherSettingCard from "./components/switcherSettingCard";
import AppPageHeader from "~/ui/components/AppPageHeader";
import AppSectionCard from "~/ui/components/AppSectionCard";
import AppStatusBadge from "~/ui/components/AppStatusBadge";

const { Text, Title } = Typography;

type PreviewLanguageOption = {
  iso_code: string;
  name: string;
  localeName: string;
};

type PreviewCurrencyOption = {
  iso_code: string;
  symbol: string;
  localeName: string;
};

type PreviewMenuType = "language" | "currency";

const pageContentStackStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 16,
};

const sectionContentStackStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 16,
};

const rowBetweenStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
};

const fieldColumnStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 8,
};

const previewLanguages: PreviewLanguageOption[] = [
  {
    iso_code: "en",
    name: "English",
    localeName: "English",
  },
  {
    iso_code: "kr",
    name: "Korean",
    localeName: "한국어",
  },
  {
    iso_code: "fr",
    name: "French",
    localeName: "Français",
  },
];

const previewCurrencies: PreviewCurrencyOption[] = [
  {
    iso_code: "USD",
    symbol: "$",
    localeName: "USD",
  },
  {
    iso_code: "EUR",
    symbol: "€",
    localeName: "EUR",
  },
  {
    iso_code: "CNY",
    symbol: "¥",
    localeName: "CNY",
  },
];

const previewMarketCountryByCurrency: Record<string, string> = {
  USD: "US",
  EUR: "FR",
  CNY: "CN",
};

function buildPreviewFlagUrl(countryCode: string): string {
  const normalizedCountryCode = countryCode.trim().toUpperCase();
  return `https://img.bogdatech.com/app/${normalizedCountryCode}.webp`;
}

const switcherComparableKeys: Array<keyof SwitcherEditData> = [
  "shopName",
  "includedFlag",
  "languageSelector",
  "currencySelector",
  "ipOpen",
  "browserLanguageOpen",
  "marketCurrencyOpen",
  "fontColor",
  "backgroundColor",
  "buttonColor",
  "buttonBackgroundColor",
  "optionBorderColor",
  "selectorPosition",
  "positionData",
  "isTransparent",
  "autoLiquidCollect",
];

function buildResolvedSwitcherData(
  shop: string,
  response?: Partial<SwitcherEditData> | null,
): SwitcherEditData {
  const defaults = buildSwitcherEditDefaults(shop);
  if (!response) return defaults;

  const filteredResponse = Object.fromEntries(
    Object.entries(response).filter(([_, value]) => value !== null),
  ) as Partial<SwitcherEditData>;

  return {
    ...defaults,
    ...filteredResponse,
    shopName: filteredResponse.shopName || shop,
  };
}

function areSwitcherConfigsEqual(
  left: SwitcherEditData,
  right: SwitcherEditData,
): boolean {
  return switcherComparableKeys.every((key) => left[key] === right[key]);
}

function extractSwitcherCardVisibility(
  payload: unknown,
  ciwiSwitcherBlocksId: string,
): boolean | null {
  const content =
    (payload as any)?.data?.nodes?.[0]?.files?.nodes?.[0]?.body?.content;

  if (typeof content !== "string" || !content.trim()) {
    return null;
  }

  try {
    const sanitized = content.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    const blocks = JSON.parse(sanitized)?.current?.blocks;
    if (!blocks || typeof blocks !== "object") {
      return null;
    }

    const switcherBlock = Object.values(blocks).find(
      (block: any) => block?.type === ciwiSwitcherBlocksId,
    ) as { disabled?: boolean } | undefined;

    if (!switcherBlock || typeof switcherBlock.disabled !== "boolean") {
      return null;
    }

    return switcherBlock.disabled;
  } catch {
    return null;
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const adminAuthResult = await authenticate.admin(request);
  const { shop } = adminAuthResult.session;
  return {
    shop,
    migrated: true,
    ciwiSwitcherId: process.env.SHOPIFY_CIWI_SWITCHER_ID as string,
    ciwiSwitcherBlocksId: process.env.SHOPIFY_CIWI_SWITCHER_THEME_ID as string,
  };
};

const Index = () => {
  const { shop, migrated, ciwiSwitcherId, ciwiSwitcherBlocksId } =
    useLoaderData<typeof loader>();
  const defaultEditData = useMemo(() => buildSwitcherEditDefaults(shop), [shop]);
  const [originalData, setOriginalData] =
    useState<SwitcherEditData>(defaultEditData);
  const [editData, setEditData] = useState<SwitcherEditData>(defaultEditData);
  const [isSelectorOpen, setIsSelectorOpen] = useState(false);
  const [activePreviewMenu, setActivePreviewMenu] =
    useState<PreviewMenuType | null>(null);
  const [selectedLanguageCode, setSelectedLanguageCode] = useState(
    previewLanguages[0].iso_code,
  );
  const [selectedCurrencyCode, setSelectedCurrencyCode] = useState(
    previewCurrencies[0].iso_code,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [showWarnModal, setShowWarnModal] = useState(false);
  const [saveAlert, setSaveAlert] = useState<string>("");
  const [loadAlert, setLoadAlert] = useState(false);
  const [switcherEnableCardOpen, setSwitcherEnableCardOpen] =
    useState<boolean>(false);
  const [cardLoading, setCardLoading] = useState<boolean>(true);
  const [updateLoading, setUpdateLoading] = useState<boolean>(false);
  const { report } = useReport();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { plan } = useSelector((state: any) => state.userConfig);
  const isGeoLocationEnabled = editData.ipOpen;
  const isIncludedFlag = editData.includedFlag;
  const languageSelector = editData.languageSelector;
  const currencySelector = editData.currencySelector;
  const fontColor = editData.fontColor;
  const backgroundColor = editData.backgroundColor;
  const optionBorderColor = editData.optionBorderColor;
  const selectorPosition = editData.selectorPosition;
  const positionData = editData.positionData;
  const isTransparent = editData.isTransparent;
  const isBrowserLanguageEnabled = editData.browserLanguageOpen;
  const isMarketCurrencyEnabled = editData.marketCurrencyOpen;
  const showLanguagePreview =
    languageSelector || (!languageSelector && !currencySelector);
  const showCurrencyPreview =
    currencySelector || (!languageSelector && !currencySelector);
  const shouldUseSidebarWidget = !languageSelector && !currencySelector;
  const activeSelectorCount =
    Number(Boolean(showLanguagePreview)) + Number(Boolean(showCurrencyPreview));
  const isDirectSelectorPreview =
    activeSelectorCount === 1 && !shouldUseSidebarWidget;
  const isFloatingSelectorPreview =
    activeSelectorCount > 1 && !shouldUseSidebarWidget;
  const isOverlaySelectorPreview =
    isFloatingSelectorPreview || shouldUseSidebarWidget;
  const isSelectorBoxVisible = isDirectSelectorPreview || isSelectorOpen;
  const selectedLanguage = useMemo(
    () =>
      previewLanguages.find(
        (language) => language.iso_code === selectedLanguageCode,
      ) ?? previewLanguages[0],
    [selectedLanguageCode],
  );
  const selectedCurrency = useMemo(
    () =>
      previewCurrencies.find(
        (currency) => currency.iso_code === selectedCurrencyCode,
      ) ?? previewCurrencies[0],
    [selectedCurrencyCode],
  );
  const previewMarketFlagUrl = useMemo(() => {
    const previewMarketCountryCode =
      previewMarketCountryByCurrency[selectedCurrencyCode] ?? "GB";
    return buildPreviewFlagUrl(previewMarketCountryCode);
  }, [selectedCurrencyCode]);
  const selectorPreviewOffset = useMemo(() => {
    const rawValue = Number(positionData);
    const normalizedValue = Number.isFinite(rawValue)
      ? Math.min(Math.max(rawValue, 0), 100)
      : 0;

    return selectorPosition === "top_left" || selectorPosition === "top_right"
      ? `${(normalizedValue * 81) / 100}%`
      : `${((100 - normalizedValue) * 81) / 100}%`;
  }, [positionData, selectorPosition]);
  const previewDisplayText = useMemo(() => {
    if (showLanguagePreview && showCurrencyPreview) {
      return `${selectedLanguage.localeName} / ${selectedCurrency.localeName}`;
    }

    if (showLanguagePreview) {
      return selectedLanguage.localeName;
    }

    return selectedCurrency.localeName;
  }, [
    selectedCurrency.localeName,
    selectedLanguage.localeName,
    showCurrencyPreview,
    showLanguagePreview,
  ]);
  const previewSelectorBoxStyle = useMemo(() => {
    if (isDirectSelectorPreview) {
      return {
        position: "static" as const,
        padding: 0,
        border: "none",
        borderRadius: 0,
        boxShadow: "none",
        width: "100%",
        display: "flex",
        flexDirection: "column" as const,
        gap: 10,
        background: "transparent",
      };
    }

    return {
      position: "absolute" as const,
      bottom:
        selectorPosition === "bottom_left" || selectorPosition === "bottom_right"
          ? "100%"
          : "auto",
      top:
        selectorPosition === "top_left" || selectorPosition === "top_right"
          ? "100%"
          : "auto",
      background: backgroundColor,
      border: `1px solid ${optionBorderColor}`,
      padding: "10px",
      borderRadius: "8px",
      marginBottom: "1px",
      width: shouldUseSidebarWidget ? "180px" : "100%",
      display: isSelectorBoxVisible ? "flex" : "none",
      flexDirection: "column" as const,
      gap: "10px",
      boxShadow: "0 14px 32px rgba(15, 23, 42, 0.14)",
    };
  }, [
    backgroundColor,
    isDirectSelectorPreview,
    isSelectorBoxVisible,
    optionBorderColor,
    selectorPosition,
    shouldUseSidebarWidget,
  ]);
  const previewNativeSelectorWrapperStyle = useMemo(
    () => ({
      width: "100%",
      position: "relative" as const,
      borderRadius: "10px",
      overflow: "hidden",
      border: `1px solid ${optionBorderColor}`,
      background: backgroundColor,
      boxSizing: "border-box" as const,
    }),
    [backgroundColor, optionBorderColor],
  );
  const previewNativeSelectorStyle = useMemo(
    () => ({
      display: "flex",
      alignItems: "center",
      width: "100%",
      minHeight: "44px",
      padding: isIncludedFlag ? "0 38px 0 42px" : "0 38px 0 14px",
      boxSizing: "border-box" as const,
      fontSize: "14px",
      lineHeight: 1.4,
      color: fontColor,
      whiteSpace: "nowrap" as const,
      overflow: "hidden",
      textOverflow: "ellipsis",
      position: "relative" as const,
    }),
    [fontColor, isIncludedFlag],
  );
  const previewNativeCurrencyStyle = useMemo(
    () => ({
      ...previewNativeSelectorStyle,
      padding: "0 38px 0 14px",
    }),
    [previewNativeSelectorStyle],
  );
  const previewNativeArrowStyle = {
    position: "absolute" as const,
    top: "50%",
    right: 14,
    width: 8,
    height: 8,
    borderRight: "1.5px solid rgba(17, 24, 39, 0.68)",
    borderBottom: "1.5px solid rgba(17, 24, 39, 0.68)",
    transform: "translateY(-65%) rotate(45deg)",
    pointerEvents: "none" as const,
  };
  const previewNativeFlagStyle = {
    position: "absolute" as const,
    left: 14,
    top: "50%",
    width: 18,
    height: 13,
    objectFit: "cover" as const,
    borderRadius: 3,
    transform: "translateY(-50%)",
    boxShadow: "0 0 0 1px rgba(15, 23, 42, 0.06)",
  };
  const isDirty = useMemo(
    () => !areSwitcherConfigsEqual(editData, originalData),
    [editData, originalData],
  );

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    const getSwitcherConfig = async () => {
      setIsLoading(true);
      setLoadAlert(false);

      try {
        const data = await loadSwitcherConfigCompat({
          migrated,
          shop,
          signal: controller.signal,
        });
        if (!active) return;

        const nextData = data?.success
          ? buildResolvedSwitcherData(shop, data.response)
          : defaultEditData;

        setOriginalData(nextData);
        setEditData(nextData);
        setLoadAlert(!data?.success);
      } catch (error) {
        if (!active || controller.signal.aborted) {
          return;
        }

        setOriginalData(defaultEditData);
        setEditData(defaultEditData);
        setLoadAlert(true);
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void getSwitcherConfig();

    return () => {
      active = false;
      controller.abort();
    };
  }, [defaultEditData, migrated, shop]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    const cachedVisibility = localStorage.getItem("switcherEnableCardOpen");
    if (cachedVisibility) {
      setSwitcherEnableCardOpen(cachedVisibility === "true");
    }

    const loadSwitcherGuide = async () => {
      setCardLoading(true);

      try {
        const formData = new FormData();
        formData.append("theme", JSON.stringify(true));

        const response = await fetch(
          withEmbeddedSearch("/app/currency", location.search),
          {
            method: "POST",
            body: formData,
            signal: controller.signal,
          },
        );
        const payload = await response.json().catch(() => null);
        if (!active) return;

        const nextVisible = extractSwitcherCardVisibility(
          payload,
          ciwiSwitcherBlocksId,
        );

        if (typeof nextVisible === "boolean") {
          setSwitcherEnableCardOpen(nextVisible);
          localStorage.setItem("switcherEnableCardOpen", String(nextVisible));
        }
      } catch (error) {
        if (!active || controller.signal.aborted) {
          return;
        }
      } finally {
        if (active) {
          setCardLoading(false);
        }
      }
    };

    void loadSwitcherGuide();

    return () => {
      active = false;
      controller.abort();
    };
  }, [ciwiSwitcherBlocksId, location.search]);

  useEffect(() => {
    if (isDirty) {
      shopify.saveBar.show("switcher-save-bar");
    } else {
      shopify.saveBar.hide("switcher-save-bar");
    }
  }, [isDirty]);

  useEffect(() => {
    return () => {
      shopify.saveBar.hide("switcher-save-bar");
    };
  }, []);

  useEffect(() => {
    if (isTransparent) {
      setIsSelectorOpen(false);
      setActivePreviewMenu(null);
    }
  }, [isTransparent]);

  useEffect(() => {
    setIsSelectorOpen(false);
    setActivePreviewMenu(null);
  }, [isDirectSelectorPreview, shouldUseSidebarWidget, isFloatingSelectorPreview]);

  const handleEditData = (updates: Partial<SwitcherEditData>) => {
    setEditData((prev) => ({
      ...prev,
      ...updates,
    }));
  };

  const applySelectorType = (
    nextLanguageSelector: boolean,
    nextCurrencySelector: boolean,
  ) => {
    handleEditData({
      languageSelector: nextLanguageSelector,
      currencySelector: nextCurrencySelector,
      includedFlag:
        !nextLanguageSelector && nextCurrencySelector
          ? false
          : editData.includedFlag,
    });

    const status =
      nextLanguageSelector && nextCurrencySelector
        ? 0
        : nextLanguageSelector
          ? 1
          : !nextLanguageSelector && !nextCurrencySelector
            ? 3
            : 2;

    report(
      {
        status,
      },
      {
        action: "/app",
        method: "post",
        eventType: "click",
      },
      "switcher_type",
    );
  };

  const handlePreviewMenuClick = (menu: PreviewMenuType) => {
    setActivePreviewMenu((current) => (current === menu ? null : menu));
  };

  const handleSelectorClick = () => {
    if (!isOverlaySelectorPreview) {
      return;
    }

    setIsSelectorOpen((prev) => !prev);
    setActivePreviewMenu(null);
  };

  const handleCancelClick = () => {
    setIsSelectorOpen(false);
    setActivePreviewMenu(null);
  };

  const handleOptionClick = (menu: PreviewMenuType, value: string) => {
    if (menu === "language") {
      setSelectedLanguageCode(value);
    } else {
      setSelectedCurrencyCode(value);
    }

    setActivePreviewMenu(null);
    if (isOverlaySelectorPreview) {
      setIsSelectorOpen(false);
    }
  };

  const handleIpOpenChange = (checked: boolean) => {
    if (!plan?.type) {
      return;
    }
    if (plan?.type !== "Free" || !checked) {
      handleEditData({ ipOpen: checked });
    } else {
      setShowWarnModal(true);
    }
    report(
      {
        status: checked ? 1 : 0,
      },
      {
        action: "/app",
        method: "post",
        eventType: "click",
      },
      "switcher_ip_geolocation",
    );
  };

  const handleSave = async () => {
    if (!isDirty) {
      return;
    }

    setUpdateLoading(true);
    setSaveAlert("");
    try {
      const data = await saveSwitcherConfigCompat({
        migrated,
        shop,
        data: editData,
      });

      if (data?.success && data.response !== undefined) {
        const nextData = buildResolvedSwitcherData(shop, data.response);
        setOriginalData(nextData);
        setEditData(nextData);
        setLoadAlert(false);
        shopify.toast.show(t("Switcher configuration updated successfully"));
      } else {
        setSaveAlert(
          getTranslateV4ErrorMessage(
            t,
            data?.errorMsg,
            TRANSLATE_V4_ERROR_KEYS.SWITCHER_SAVE_FAILED,
          ),
        );
      }
    } finally {
      setUpdateLoading(false);
    }
  };

  const handleCancel = () => {
    setSaveAlert("");
    setEditData(originalData);
  };

  const switcherPositionOptions = [
    {
      label: t("Top Left"),
      value: "top_left",
    },
    {
      label: t("Top Right"),
      value: "top_right",
    },
    {
      label: t("Bottom Left"),
      value: "bottom_left",
    },
    {
      label: t("Bottom Right"),
      value: "bottom_right",
    },
  ];

  const switcherOptions = [
    {
      label: t("Language Switcher"),
      value: "language",
    },
    {
      label: t("Currency Switcher"),
      value: "currency",
    },
    {
      label: t("Language and Currency Switcher"),
      value: "language_and_currency",
    },
    {
      label: t("Sidebar Widget"),
      value: "sidebar widget",
    },
  ];

  const switcherTypeValue =
    languageSelector && currencySelector
      ? "language_and_currency"
      : languageSelector
        ? "language"
        : !languageSelector && !currencySelector
          ? "sidebar widget"
          : "currency";

  const showPaidPlanHint =
    plan?.type == "Free" || typeof plan?.type === "undefined";

  return (
    <Page>
      <SaveBar id="switcher-save-bar">
        <button
          variant="primary"
          onClick={handleSave}
          disabled={updateLoading || !isDirty}
        >
          {updateLoading ? t("Saving...") : t("Save")}
        </button>
        <button onClick={handleCancel}>{t("Cancel")}</button>
      </SaveBar>
      <TitleBar title={t("Switcher")} />
      <div style={pageContentStackStyle}>
        <AppPageHeader
          title={t("Switcher")}
        />
        <SwitcherSettingCard
          visible={switcherEnableCardOpen}
          loading={cardLoading}
          shop={shop}
          ciwiSwitcherId={ciwiSwitcherId}
        />
        <div className={styles.switcher_container}>
          <div className={styles.switcher_editor}>
            <div style={sectionContentStackStyle}>
              {loadAlert ? (
                <Alert
                  type="warning"
                  showIcon
                  message={t(
                    "Unable to load the latest switcher settings. You can continue editing with the default values.",
                  )}
                  closable
                  onClose={() => setLoadAlert(false)}
                />
              ) : null}
              {saveAlert ? (
                <Alert
                  type="error"
                  showIcon
                  message={saveAlert}
                  closable
                  onClose={() => setSaveAlert("")}
                />
              ) : null}
              <AppSectionCard
                title={t("Auto adaptation settings")}
                extra={
                  showPaidPlanHint ? (
                    <Popconfirm
                      title=""
                      description={t(
                        "This feature is available only with the paid plan.",
                      )}
                      trigger="hover"
                      showCancel={false}
                      okText={t("Upgrade")}
                      onConfirm={() => navigate("/app/pricing")}
                    >
                      <Button type="text" icon={<InfoCircleOutlined />}>
                        {t("Paid feature")}
                      </Button>
                    </Popconfirm>
                  ) : null
                }
              >
                <div style={sectionContentStackStyle}>
                  <div style={rowBetweenStyle}>
                    <div className={styles.switcher_row_label}>
                      <Text strong>{t("Match market by IP")}</Text>
                    </div>
                    <Switch
                      className={
                        showPaidPlanHint ? defaultStyles.Switch_disable : ""
                      }
                      checked={isGeoLocationEnabled}
                      onChange={handleIpOpenChange}
                    />
                  </div>
                  <div style={rowBetweenStyle}>
                    <div className={styles.switcher_row_label}>
                      <Text strong>{t("Match currency by market")}</Text>
                    </div>
                    <Switch
                      checked={isMarketCurrencyEnabled}
                      onChange={(checked) => {
                        handleEditData({ marketCurrencyOpen: checked });
                      }}
                    />
                  </div>
                  <div style={rowBetweenStyle}>
                    <div className={styles.switcher_row_label}>
                      <Text strong>{t("Switch by browser language")}</Text>
                    </div>
                    <Switch
                      checked={isBrowserLanguageEnabled}
                      onChange={(checked) => {
                        handleEditData({ browserLanguageOpen: checked });
                      }}
                    />
                  </div>
                  <div style={rowBetweenStyle}>
                    <div className={styles.switcher_row_label}>
                      <Text strong>{t("Auto-translate third-party apps")}</Text>
                    </div>
                    <AppStatusBadge tone="success">{t("Always on")}</AppStatusBadge>
                  </div>
                </div>
              </AppSectionCard>
              <AppSectionCard
                title={t("Switcher style settings")}
              >
                <div style={sectionContentStackStyle}>
                  <div style={rowBetweenStyle}>
                    <div className={styles.switcher_row_label}>
                      <Text strong>{t("Hide visible switcher")}</Text>
                    </div>
                    <Switch
                      checked={isTransparent}
                      onChange={() => {
                        handleEditData({ isTransparent: !isTransparent });
                        report(
                          {
                            status: !isTransparent ? 1 : 0,
                          },
                          {
                            action: "/app",
                            method: "post",
                            eventType: "click",
                          },
                          "switcher_ip_visible",
                        );
                      }}
                    />
                  </div>
                  {!isTransparent ? (
                    <>
                      <div style={fieldColumnStyle}>
                        <Text style={{ display: "block" }}>
                          {t("Selector type")}
                        </Text>
                        <Select
                          options={switcherOptions}
                          style={{ width: "100%" }}
                          value={switcherTypeValue}
                          onChange={(value) => {
                            switch (value) {
                              case "sidebar widget":
                                applySelectorType(false, false);
                                break;
                              case "language_and_currency":
                                applySelectorType(true, true);
                                break;
                              case "language":
                                applySelectorType(true, false);
                                break;
                              case "currency":
                                applySelectorType(false, true);
                                break;
                            }
                          }}
                        />
                      </div>
                      <div style={rowBetweenStyle}>
                        <div className={styles.switcher_row_label}>
                          <Text strong>{t("Show current market flag")}</Text>
                          <Text
                            style={{
                              display: "block",
                              color: "var(--app-color-text-secondary)",
                              marginTop: 4,
                            }}
                          >
                            {currencySelector && !languageSelector
                              ? t(
                                  "Currency-only mode does not display a flag. Switch to a selector type that has a visible flag slot to enable this setting.",
                                )
                              : t(
                                  "Display the current market flag in the switcher trigger and language selector.",
                                )}
                          </Text>
                        </div>
                        <Switch
                          disabled={!languageSelector && currencySelector}
                          checked={isIncludedFlag}
                          onChange={(checked) => {
                            handleEditData({ includedFlag: checked });
                            report(
                              {
                                status: checked ? 1 : 0,
                              },
                              {
                                action: "/app",
                                method: "post",
                                eventType: "click",
                              },
                              "switcher_style_flag",
                            );
                          }}
                        />
                      </div>
                      <div className={styles.switcher_style_fields}>
                        <div style={fieldColumnStyle}>
                          <Text>{t("Font Color:")}</Text>
                          <ColorPicker
                            style={{ alignSelf: "flex-start" }}
                            value={fontColor}
                            onChange={(e) =>
                              handleEditData({ fontColor: e.toHexString() })
                            }
                            showText
                          />
                        </div>
                        <div style={fieldColumnStyle}>
                          <Text>{t("Background Color:")}</Text>
                          <ColorPicker
                            style={{ alignSelf: "flex-start" }}
                            value={backgroundColor}
                            onChange={(e) =>
                              handleEditData({ backgroundColor: e.toHexString() })
                            }
                            showText
                          />
                        </div>
                        <div style={fieldColumnStyle}>
                          <Text>{t("Option Border Color:")}</Text>
                          <ColorPicker
                            style={{ alignSelf: "flex-start" }}
                            value={optionBorderColor}
                            onChange={(e) =>
                              handleEditData({ optionBorderColor: e.toHexString() })
                            }
                            showText
                          />
                        </div>
                      </div>
                      <div style={fieldColumnStyle}>
                        <Text style={{ display: "block" }}>
                          {t("Selector position:")}
                        </Text>
                        <Select
                          options={switcherPositionOptions}
                          style={{ width: "100%" }}
                          value={selectorPosition}
                          onChange={(value) =>
                            handleEditData({ selectorPosition: value })
                          }
                        />
                      </div>
                    </>
                  ) : null}
                  <div style={fieldColumnStyle}>
                    <Text style={{ display: "block" }}>
                      {t("Selector position data:")}
                    </Text>
                    <Slider
                      value={Number(positionData)}
                      onChange={(e) =>
                        handleEditData({ positionData: e.toString() })
                      }
                    />
                  </div>
                </div>
              </AppSectionCard>
            </div>
          </div>
          <div className={styles.switcher_preview}>
            <Card
              loading={isLoading}
              style={{
                height: "100%",
                border: "none",
                boxShadow: "var(--app-shadow-card)",
              }}
            >
              <Title
                level={5}
                style={{ fontSize: 14, color: "var(--app-color-text)" }}
              >
                {t("Preview")}
              </Title>
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  height: "400px",
                  border: "1px solid var(--app-color-border-secondary)",
                  borderRadius: "8px",
                  background: "var(--app-color-surface-secondary)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "32px",
                    background: "rgba(15, 23, 42, 0.04)",
                    display: "flex",
                    alignItems: "center",
                    padding: "0 12px",
                    gap: "6px",
                  }}
                >
                  <div
                    style={{
                      width: "12px",
                      height: "12px",
                      borderRadius: "50%",
                      background: "#ff5f57",
                    }}
                  />
                  <div
                    style={{
                      width: "12px",
                      height: "12px",
                      borderRadius: "50%",
                      background: "#febc2e",
                    }}
                  />
                  <div
                    style={{
                      width: "12px",
                      height: "12px",
                      borderRadius: "50%",
                      background: "#28c840",
                    }}
                  />
                </div>
                <div
                  style={{
                    position: "relative",
                    top: selectorPreviewOffset,
                    height: "auto",
                    display: "block",
                    zIndex: "1000",
                    color: fontColor,
                  }}
                >
                  <div
                    id="ciwi-container"
                    style={{
                      minWidth: shouldUseSidebarWidget
                        ? "30px"
                        : isDirectSelectorPreview
                          ? "180px"
                          : "100px",
                      width: shouldUseSidebarWidget
                        ? "30px"
                        : isDirectSelectorPreview
                          ? "180px"
                          : "auto",
                      position: "absolute",
                      left:
                        selectorPosition === "top_left" ||
                        selectorPosition === "bottom_left"
                          ? "0"
                          : "auto",
                      right:
                        selectorPosition === "top_right" ||
                        selectorPosition === "bottom_right"
                          ? "0"
                          : "auto",
                      background:
                        shouldUseSidebarWidget || isDirectSelectorPreview
                          ? "transparent"
                          : backgroundColor,
                      border:
                        shouldUseSidebarWidget || isDirectSelectorPreview
                          ? "none"
                          : `1px solid ${optionBorderColor}`,
                      borderRadius:
                        shouldUseSidebarWidget || isDirectSelectorPreview
                          ? 0
                          : "8px",
                      transform: "none",
                      height: "auto",
                      display: isTransparent ? "none" : "block",
                      zIndex: "2",
                    }}
                  >
                    {isSelectorBoxVisible ? (
                      <div
                        id="selector-box"
                        style={previewSelectorBoxStyle}
                      >
                        {!isDirectSelectorPreview ? (
                          <div className={styles.close_button_wrapper}>
                            <button
                              onClick={handleCancelClick}
                              className={styles.selector_box_close_button}
                              id="selector-box-close-button"
                            >
                              <CloseIcon color={fontColor} />
                            </button>
                          </div>
                        ) : null}
                        {isDirectSelectorPreview ? (
                          <>
                            {showLanguagePreview ? (
                              <div style={previewNativeSelectorWrapperStyle}>
                                {isIncludedFlag ? (
                                  <img
                                    src={previewMarketFlagUrl}
                                    alt=""
                                    style={previewNativeFlagStyle}
                                  />
                                ) : null}
                                <div style={previewNativeSelectorStyle}>
                                  {selectedLanguage.localeName}
                                </div>
                                <div style={previewNativeArrowStyle} />
                              </div>
                            ) : null}
                            {showCurrencyPreview ? (
                              <div style={previewNativeSelectorWrapperStyle}>
                                <div style={previewNativeCurrencyStyle}>
                                  {selectedCurrency.localeName} ({selectedCurrency.symbol})
                                </div>
                                <div style={previewNativeArrowStyle} />
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <>
                            <div
                              style={{
                                display: showLanguagePreview ? "block" : "none",
                                gap: "10px",
                              }}
                            >
                              <div
                                className={styles.custom_selector}
                                data-type="language"
                                onClick={() => handlePreviewMenuClick("language")}
                              >
                                <div
                                  className={styles.selector_header}
                                  data-type="language"
                                  style={{
                                    backgroundColor: backgroundColor,
                                    border: `1px solid ${optionBorderColor}`,
                                  }}
                                >
                                  <div
                                    className={styles.selected_option}
                                    data-type="language"
                                  >
                                    {isIncludedFlag && (
                                      <img
                                        className={styles.country_flag}
                                        src={previewMarketFlagUrl}
                                        alt=""
                                        width="25%"
                                        height="25%"
                                      />
                                    )}
                                    <span
                                      className={styles.selected_text}
                                      data-type="language"
                                    >
                                      {selectedLanguage.localeName}
                                    </span>
                                  </div>
                                  <img
                                    id="currency-arrow-icon"
                                    className={styles.arrow_icon}
                                    src="/arrow.svg"
                                    alt="Arrow Icon"
                                    width="25%"
                                    height="25%"
                                  />
                                </div>
                                <div
                                  className={styles.options_container}
                                  data-type="language"
                                  style={{
                                    bottom:
                                      selectorPosition === "bottom_left" ||
                                      selectorPosition === "bottom_right"
                                        ? "100%"
                                        : "auto",
                                    top:
                                      selectorPosition === "top_left" ||
                                      selectorPosition === "top_right"
                                        ? "100%"
                                        : "auto",
                                    display:
                                      activePreviewMenu === "language"
                                        ? "block"
                                        : "none",
                                    backgroundColor: backgroundColor,
                                    zIndex: "2000",
                                  }}
                                >
                                  <div
                                    className={styles.options_list}
                                    style={{
                                      backgroundColor: backgroundColor,
                                      border: `1px solid ${optionBorderColor}`,
                                    }}
                                  >
                                    {previewLanguages.map((language) => (
                                      <div
                                        className={styles.option_item}
                                        data-value={language.iso_code}
                                        data-type="language"
                                        onClick={() =>
                                          handleOptionClick(
                                            "language",
                                            language.iso_code,
                                          )
                                        }
                                        key={language.iso_code}
                                      >
                                        <span className={styles.option_text}>
                                          {language.localeName}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </div>
                            <div
                              style={{
                                display: showCurrencyPreview ? "block" : "none",
                                marginBottom: "10px",
                              }}
                            >
                              <div
                                className={styles.custom_selector}
                                data-type="currency"
                                onClick={() => handlePreviewMenuClick("currency")}
                              >
                                <div
                                  className={styles.selector_header}
                                  data-type="currency"
                                  style={{
                                    backgroundColor: backgroundColor,
                                    border: `1px solid ${optionBorderColor}`,
                                  }}
                                >
                                  <div
                                    className={styles.selected_option}
                                    data-type="currency"
                                  >
                                    <span
                                      className={styles.selected_text}
                                      data-type="currency"
                                    >
                                      {selectedCurrency.localeName}
                                      (
                                      {selectedCurrency.symbol}
                                      )
                                    </span>
                                  </div>
                                  <img
                                    id="currency-arrow-icon"
                                    className={styles.arrow_icon}
                                    src="/arrow.svg"
                                    alt="Arrow Icon"
                                    width="25%"
                                    height="25%"
                                  />
                                </div>

                                <div
                                  className={styles.options_container}
                                  data-type="currency"
                                  style={{
                                    backgroundColor: backgroundColor,
                                    zIndex: "2000",
                                    display:
                                      activePreviewMenu === "currency"
                                        ? "block"
                                        : "none",
                                    bottom:
                                      selectorPosition === "bottom_left" ||
                                      selectorPosition === "bottom_right"
                                        ? "100%"
                                        : "auto",
                                    top:
                                      selectorPosition === "top_left" ||
                                      selectorPosition === "top_right"
                                        ? "100%"
                                        : "auto",
                                  }}
                                >
                                  <div
                                    className={styles.options_list}
                                    style={{
                                      backgroundColor: backgroundColor,
                                      border: `1px solid ${optionBorderColor}`,
                                    }}
                                  >
                                    {previewCurrencies.map((currency) => (
                                      <div
                                        className={styles.option_item}
                                        data-value={currency.iso_code}
                                        data-type="currency"
                                        key={currency.iso_code}
                                        onClick={() =>
                                          handleOptionClick(
                                            "currency",
                                            currency.iso_code,
                                          )
                                        }
                                      >
                                        <span className={styles.option_text}>
                                          {currency.localeName}
                                        </span>
                                        <span className={styles.currency_code}>
                                          ({currency.symbol})
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    ) : null}
                    {isFloatingSelectorPreview ? (
                      <div
                        id="main-box"
                        className={styles.main_box}
                        style={{
                          justifyContent: isIncludedFlag ? "" : "center",
                          background: backgroundColor,
                        }}
                        onClick={handleSelectorClick}
                      >
                        {isIncludedFlag ? (
                          <img
                            className={styles.country_flag}
                            src={previewMarketFlagUrl}
                            alt=""
                            width="25%"
                            height="25%"
                          />
                        ) : null}
                        <span id="display-text" className={styles.main_box_text}>
                          {previewDisplayText}
                        </span>
                        <img
                          id="mainbox-arrow-icon"
                          className={styles.mainarrow_icon}
                          src="/arrow.svg"
                          alt="Arrow Icon"
                          width="25px"
                          height="25%"
                        />
                      </div>
                    ) : null}
                    {shouldUseSidebarWidget ? (
                      <div
                        id="translate-float-btn"
                        onClick={handleSelectorClick}
                        style={{
                          display: "flex",
                          width: "30px",
                          minHeight: "112px",
                          position: "absolute",
                          alignItems:
                            selectorPosition === "top_left" ||
                            selectorPosition === "bottom_left"
                              ? "flex-end"
                              : "flex-start",
                          justifyContent:
                            selectorPosition === "top_left" ||
                            selectorPosition === "bottom_left"
                              ? "flex-end"
                              : "flex-start",
                          left:
                            selectorPosition === "top_left" ||
                            selectorPosition === "bottom_left"
                              ? "0"
                              : "auto",
                          right:
                            selectorPosition === "top_right" ||
                            selectorPosition === "bottom_right"
                              ? "0"
                              : "auto",
                          cursor: "pointer",
                        }}
                      >
                        <div
                          id="translate-float-btn-text"
                          style={{
                            display: "block",
                            padding: "0 18px",
                            fontSize: "14px",
                            lineHeight: "30px",
                            height: "30px",
                            fontWeight: 700,
                            overflow: "hidden",
                            transform: "rotate(90deg)",
                            transformOrigin: "right top",
                            position: "absolute",
                            right: 0,
                            whiteSpace: "nowrap",
                            userSelect: "none",
                            color: fontColor,
                            background: backgroundColor,
                            border:
                              selectorPosition === "top_left" ||
                              selectorPosition === "bottom_left"
                                ? `1px solid ${optionBorderColor}`
                                : `1px solid ${optionBorderColor}`,
                            borderRadius:
                              selectorPosition === "top_left" ||
                              selectorPosition === "bottom_left"
                                ? "8px 8px 0 0"
                                : "0 0 8px 8px",
                          }}
                        >
                          <span>Translate</span>
                        </div>
                        {isIncludedFlag ? (
                          <img
                            id="translate-float-btn-icon"
                            src={previewMarketFlagUrl}
                            alt=""
                            width="28"
                            height="20"
                            style={{
                              borderRadius: "3px",
                              boxShadow: "0 1px 4px rgba(0, 0, 0, 0.08)",
                              position: "relative",
                              top: 36,
                            }}
                          />
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>
        <Modal
          title={t("Feature Unavailable")}
          open={showWarnModal}
          onCancel={() => setShowWarnModal(false)}
          centered
          width={700}
          footer={
            <Button type="primary" onClick={() => navigate("/app/pricing")}>
              {t("Upgrade")}
            </Button>
          }
        >
          <Text>{t("This feature is available only with the paid plan.")}</Text>
        </Modal>
      </div>
    </Page>
  );
};

export default Index;
