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
import { useEffect, useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import {
  useFetcher,
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

const initialLocalization = {
  languages: [
    {
      iso_code: "en",
      name: "English",
      localeName: "English",
      flag: "/flags/GB.webp",
      selected: true,
    },
    {
      iso_code: "kr",
      name: "Korean",
      localeName: "한국어",
      flag: "/flags/KR.webp",
      selected: false,
    },
    {
      iso_code: "fr",
      name: "French",
      localeName: "Français",
      flag: "/flags/FR.webp",
      selected: false,
    },
  ],
  currencies: [
    {
      iso_code: "USD",
      symbol: "$",
      localeName: "USD",
      selected: true,
    },
    {
      iso_code: "EUR",
      symbol: "€",
      localeName: "EUR",
      selected: false,
    },
    {
      iso_code: "CNY",
      symbol: "¥",
      localeName: "CNY",
      selected: false,
    },
  ],
};

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
  const [isGeoLocationEnabled, setIsGeoLocationEnabled] = useState(false);
  const [isIncludedFlag, setIsIncludedFlag] = useState(true);
  const [languageSelector, setLanguageSelector] = useState(true);
  const [currencySelector, setCurrencySelector] = useState(true);
  const [fontColor, setFontColor] = useState("#303030");
  const [backgroundColor, setBackgroundColor] = useState("#ffffff");
  const [optionBorderColor, setOptionBorderColor] = useState("#d4d4d8");
  const [selectorPosition, setSelectorPosition] = useState("top_left");
  const [positionData, setPositionData] = useState<string>("0");
  const [isTransparent, setIsTransparent] = useState(false);
  const [isLanguageOpen, setIsLanguageOpen] = useState(false);
  const [isCurrencyOpen, setIsCurrencyOpen] = useState(false);
  const [isSelectorOpen, setIsSelectorOpen] = useState(false);
  const [localization, setLocalization] = useState(initialLocalization);
  const [originalData, setOriginalData] = useState<SwitcherEditData>();
  const [editData, setEditData] = useState<SwitcherEditData>({
    shopName: "",
    includedFlag: false,
    languageSelector: false,
    currencySelector: false,
    ipOpen: false,
    fontColor: "",
    backgroundColor: "",
    buttonColor: "",
    buttonBackgroundColor: "",
    optionBorderColor: "",
    selectorPosition: "",
    positionData: "0",
    isTransparent: false,
    autoLiquidCollect: true,
  });
  const [selectedLanguage, setSelectedLanguage] = useState<any>(
    localization.languages.find((language) => language.selected),
  );
  const [selectedCurrency, setSelectedCurrency] = useState<any>(
    localization.currencies.find((currency) => currency.selected),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [showWarnModal, setShowWarnModal] = useState(false);
  const [saveAlert, setSaveAlert] = useState<string>("");
  const [switcherEnableCardOpen, setSwitcherEnableCardOpen] =
    useState<boolean>(false);
  const [cardLoading, setCardLoading] = useState<boolean>(true);
  const [updateLoading, setUpdateLoading] = useState<boolean>(false);
  const { report } = useReport();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { plan } = useSelector((state: any) => state.userConfig);

  const fetcher = useFetcher<any>();
  const initFetcher = useFetcher<any>();
  const themeFetcher = useFetcher<any>();

  useEffect(() => {
    const switcherEnableCardOpen = localStorage.getItem(
      "switcherEnableCardOpen",
    );
    if (switcherEnableCardOpen) {
      setSwitcherEnableCardOpen(switcherEnableCardOpen === "true");
    }
    themeFetcher.submit(
      {
        theme: JSON.stringify(true),
      },
      {
        method: "post",
        action: withEmbeddedSearch("/app/currency", location.search),
      },
    );
    initFetcher.submit(
      {},
      {
        method: "post",
        action: "/currencyInit",
      },
    );
    const getSwitcherConfig = async () => {
      const data = await loadSwitcherConfigCompat({
        migrated,
        shop,
      });
      const initData = buildSwitcherEditDefaults(shop);
      if (data?.success && data.response) {
        const filteredResponse = Object.fromEntries(
          Object.entries(data.response).filter(([_, value]) => value !== null),
        );
        const res = {
          ...initData,
          ...filteredResponse,
        };
        setOriginalData(res);
        setIsIncludedFlag(res.includedFlag);
        setLanguageSelector(res.languageSelector);
        setCurrencySelector(res.currencySelector);
        setIsGeoLocationEnabled(res.ipOpen);
        setFontColor(res.fontColor);
        setBackgroundColor(res.backgroundColor);
        setOptionBorderColor(res.optionBorderColor);
        setSelectorPosition(res.selectorPosition);
        setPositionData(res.positionData);
        setIsTransparent(res.isTransparent);
        setEditData(res);
        setIsLoading(false);
      } else {
        setOriginalData(initData);
        setIsIncludedFlag(initData.includedFlag);
        setLanguageSelector(initData.languageSelector);
        setCurrencySelector(initData.currencySelector);
        setIsGeoLocationEnabled(initData.ipOpen);
        setFontColor(initData.fontColor);
        setBackgroundColor(initData.backgroundColor);
        setOptionBorderColor(initData.optionBorderColor);
        setSelectorPosition(initData.selectorPosition);
        setPositionData(initData.positionData);
        setIsTransparent(initData.isTransparent);
        setEditData(initData);
        setIsLoading(false);
      }
    };

    getSwitcherConfig();
    fetcher.submit(
      {
        log: `${shop} 目前在切换器页面`,
      },
      {
        method: "POST",
        action: "/log",
      },
    );
  }, [fetcher, initFetcher, location.search, migrated, shop, themeFetcher]);

  useEffect(() => {
    if (themeFetcher.data) {
      const switcherData =
        themeFetcher.data.data.nodes[0].files.nodes[0]?.body?.content;
      const jsonString = switcherData.replace(/\/\*[\s\S]*?\*\//g, "").trim();
      const blocks = JSON.parse(jsonString).current?.blocks;
      if (blocks) {
        const switcherJson: any = Object.values(blocks).find(
          (block: any) => block.type === ciwiSwitcherBlocksId,
        );
        if (switcherJson) {
          if (!switcherJson.disabled) {
            setSwitcherEnableCardOpen(false);
            localStorage.setItem("switcherEnableCardOpen", "false");
          } else {
            setSwitcherEnableCardOpen(true);
            localStorage.setItem("switcherEnableCardOpen", "true");
          }
        }
      }

      setCardLoading(false);
    }
  }, [ciwiSwitcherBlocksId, themeFetcher.data]);

  useEffect(() => {
    if (
      originalData &&
      editData.shopName &&
      JSON.stringify(editData) !== JSON.stringify(originalData)
    ) {
      shopify.saveBar.show("switcher-save-bar");
    } else {
      shopify.saveBar.hide("switcher-save-bar");
    }
  }, [editData, originalData]);

  const handleEditData = (updates: Partial<SwitcherEditData>) => {
    // 更新对应的状态
    Object.entries(updates).forEach(([key, value]) => {
      switch (key) {
        case "isTransparent":
          setIsTransparent(value as boolean);
          break;
        case "includedFlag":
          setIsIncludedFlag(value as boolean);
          break;
        case "languageSelector":
          setLanguageSelector(value as boolean);
          break;
        case "currencySelector":
          setCurrencySelector(value as boolean);
          break;
        case "fontColor":
          setFontColor(value as string);
          break;
        case "backgroundColor":
          setBackgroundColor(value as string);
          break;
        case "optionBorderColor":
          setOptionBorderColor(value as string);
          break;
        case "selectorPosition":
          setSelectorPosition(value as string);
          break;
        case "positionData":
          setPositionData(value as string);
          break;
      }
    });

    // 更新 editData
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
    });

    if (!nextLanguageSelector && nextCurrencySelector) {
      setIsIncludedFlag(false);
      handleEditData({
        includedFlag: false,
      });
    }

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

  const handleLanguageClick = () => {
    setIsLanguageOpen(!isLanguageOpen);
    setIsCurrencyOpen(false);
  };

  const handleCurrencyClick = () => {
    setIsCurrencyOpen(!isCurrencyOpen);
    setIsLanguageOpen(false);
  };

  const handleSelectorClick = () => {
    setIsSelectorOpen(!isSelectorOpen);
    setIsLanguageOpen(false);
    setIsCurrencyOpen(false);
    setSelectedLanguage(
      localization.languages.find((language) => language.selected),
    );

    setSelectedCurrency(
      localization.currencies.find((currency) => currency.selected),
    );
  };

  const handleCancelClick = () => {
    setIsSelectorOpen(!isSelectorOpen);
    setIsLanguageOpen(false);
    setIsCurrencyOpen(false);
  };

  const handleOptionClick = (value: string) => {
    setIsLanguageOpen(false);
    setIsCurrencyOpen(false);

    if (
      localization.languages.find((language) => language.iso_code === value)
    ) {
      localization.languages.forEach((language) => {
        if (language.iso_code !== value) {
          language.selected = false;
        } else {
          language.selected = true;
          setSelectedLanguage(language);
        }
      });
      setLocalization({ ...localization });
    } else if (
      localization.currencies.find((currency) => currency.iso_code === value)
    ) {
      localization.currencies.forEach((currency) => {
        if (currency.iso_code !== value) {
          currency.selected = false;
        } else {
          currency.selected = true;
          setSelectedCurrency(currency);
        }
      });
      setLocalization({ ...localization });
    }
    setIsSelectorOpen(false);
  };

  const handleIpOpenChange = (checked: boolean) => {
    if (!plan?.type) {
      return;
    }
    if (plan?.type !== "Free" || !checked) {
      setIsGeoLocationEnabled(checked);
      setEditData((prev) => ({
        ...prev,
        ipOpen: checked,
      }));
    } else {
      setIsGeoLocationEnabled(false);
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
    setUpdateLoading(true);
    setSaveAlert("");
    const data = await saveSwitcherConfigCompat({
      migrated,
      shop,
      data: editData,
    });
    if (data?.success && data.response != undefined) {
      setOriginalData(data.response);
      setEditData(data.response);
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
    setUpdateLoading(false);
    fetcher.submit(
      {
        log: `${shop} 切换器配置修改数据保存成功`,
      },
      {
        method: "POST",
        action: "/log",
      },
    );
  };

  const handleCancel = () => {
    shopify.saveBar.hide("switcher-save-bar");
    setSaveAlert("");
    if (originalData) {
      setIsIncludedFlag(originalData.includedFlag);
      setLanguageSelector(originalData.languageSelector);
      setCurrencySelector(originalData.currencySelector);
      setIsGeoLocationEnabled(originalData.ipOpen);
      setFontColor(originalData.fontColor);
      setBackgroundColor(originalData.backgroundColor);
      setOptionBorderColor(originalData.optionBorderColor);
      setSelectorPosition(originalData.selectorPosition);
      setPositionData(originalData.positionData);
      setEditData(originalData);
    }
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
          disabled={updateLoading}
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
                      className={showPaidPlanHint ? defaultStyles.Switch_disable : ""}
                      checked={isGeoLocationEnabled}
                      onChange={handleIpOpenChange}
                    />
                  </div>
                  <div style={rowBetweenStyle}>
                    <div className={styles.switcher_row_label}>
                      <Text strong>{t("Match currency by market")}</Text>
                    </div>
                    <Switch
                      checked={currencySelector}
                      onChange={(checked) => {
                        applySelectorType(languageSelector, checked);
                      }}
                    />
                  </div>
                  <div style={rowBetweenStyle}>
                    <div className={styles.switcher_row_label}>
                      <Text strong>{t("Switch by browser language")}</Text>
                    </div>
                    <Switch
                      checked={languageSelector}
                      onChange={(checked) => {
                        applySelectorType(checked, currencySelector);
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
                          <Text strong>{t("Include flag")}</Text>
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
                    top:
                      selectorPosition === "top_left" ||
                      selectorPosition === "top_right"
                        ? ((Number(positionData) * 81) / 100).toString() + "%"
                        : (
                            ((100 - Number(positionData)) * 81) /
                            100
                          ).toString() + "%",
                    height: "auto",
                    display: "block",
                    zIndex: "1000",
                    color: fontColor,
                  }}
                >
                  <div
                    id="ciwi-container"
                    style={{
                      minWidth: "100px",
                      position: "absolute", // 改为绝对定位
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
                      background: backgroundColor,
                      border: `1px solid ${optionBorderColor}`,
                      borderRadius: "8px",
                      transform: "none", // 移除transform，使用left/right定位
                      height: "auto",
                      display: isTransparent ? "none" : "block",
                      zIndex: "2",
                    }}
                  >
                    {isSelectorOpen && (
                      <div
                        id="selector-box"
                        style={{
                          position: "absolute",
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
                          background: backgroundColor,
                          border: `1px solid ${optionBorderColor}`,
                          padding: "10px",
                          borderRadius: "8px",
                          height:
                            languageSelector === currencySelector
                              ? "140px"
                              : "90px",
                          marginBottom: "1px",
                          width: "100%",
                          display: "flex",
                          flexDirection: "column",
                          gap: "10px",
                        }}
                      >
                        <div className={styles.close_button_wrapper}>
                          <button
                            onClick={handleCancelClick}
                            className={styles.selector_box_close_button}
                            id="selector-box-close-button"
                          >
                            <CloseIcon color={fontColor} />
                          </button>
                        </div>
                        <div
                          style={{
                            display: `${languageSelector || (!languageSelector && !currencySelector) ? "block" : "none"}`,
                            gap: "10px",
                          }}
                        >
                          <div
                            className={styles.custom_selector}
                            data-type="language"
                            onClick={handleLanguageClick}
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
                                    src={
                                      localization.languages.find(
                                        (language) => language.selected,
                                      )?.flag
                                    }
                                    alt=""
                                    width="25%"
                                    height="25%"
                                  />
                                )}
                                <span
                                  className={styles.selected_text}
                                  data-type="language"
                                >
                                  {
                                    localization.languages.find(
                                      (language) => language.selected,
                                    )?.localeName
                                  }
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
                                display: isLanguageOpen ? "block" : "none",
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
                                {localization.languages.map((language) => (
                                  <div
                                    className={styles.option_item}
                                    data-value={language.iso_code}
                                    data-type="language"
                                    onClick={() =>
                                      handleOptionClick(language.iso_code)
                                    }
                                    key={language.iso_code}
                                  >
                                    {isIncludedFlag && (
                                      <img
                                        className={styles.country_flag}
                                        src={language.flag}
                                        alt=""
                                        width="25%"
                                        height="25%"
                                      />
                                    )}
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
                            display: `${currencySelector || (!languageSelector && !currencySelector) ? "block" : "none"}`,
                            marginBottom: "10px",
                          }}
                        >
                          <div
                            className={styles.custom_selector}
                            data-type="currency"
                            onClick={handleCurrencyClick}
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
                                  {
                                    localization.currencies.find(
                                      (currency) => currency.selected,
                                    )?.localeName
                                  }
                                  (
                                  {
                                    localization.currencies.find(
                                      (currency) => currency.selected,
                                    )?.symbol
                                  }
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
                                display: isCurrencyOpen ? "block" : "none",
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
                                {localization.currencies.map((currency) => (
                                  <div
                                    className={styles.option_item}
                                    data-value={currency.iso_code}
                                    data-type="currency"
                                    key={currency.iso_code}
                                    onClick={() =>
                                      handleOptionClick(currency.iso_code)
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
                      </div>
                    )}
                    <div
                      id="main-box"
                      className={styles.main_box}
                      style={{
                        justifyContent: isIncludedFlag ? "" : "center",
                        background: backgroundColor,
                      }}
                      onClick={handleSelectorClick}
                    >
                      {isIncludedFlag && (
                        <img
                          className={styles.country_flag}
                          src={selectedLanguage?.flag}
                          alt=""
                          width="25%"
                          height="25%"
                        />
                      )}
                      <span id="display-text" className={styles.main_box_text}>
                        {(languageSelector && currencySelector) ||
                        (!languageSelector && !currencySelector)
                          ? selectedLanguage?.localeName +
                            " / " +
                            selectedCurrency?.localeName
                          : languageSelector
                            ? selectedLanguage?.localeName
                            : selectedCurrency?.localeName}
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
