import { Page } from "@shopify/polaris";
import { Space, Select, Typography, Flex } from "antd";
import Button from "~/ui/components/AppButton";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";
import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import type { LanguagesDataType, ShopLocalesType } from "../app.language/route";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { useSelector } from "react-redux";
import { saveTranslatedImageFromUrl } from "~/server/picture/picture.server";
import { translateProductImage } from "~/server/picture/translateImage.server";
import {
  getManageTranslationLocaleSnapshotFromCache,
  invalidateAllItemsCountForLocale,
  refreshManageTranslationLocaleSummary,
  type ManageTranslationLocaleSnapshot,
} from "~/server/translateV4/itemsCount.server";
import { authenticate } from "~/shopify.server";
import NoLanguageSetCard from "~/components/noLanguageSetCard";
import { useTranslation } from "react-i18next";
import ManageTranslationsCard from "./components/manageTranslationsCard";
import ScrollNotice from "~/components/ScrollNotice";
import { ReloadOutlined } from "@ant-design/icons";
import useReport from "scripts/eventReport";
import { globalStore } from "~/globalStore";
import { shouldRevalidateManageTranslation } from "~/lib/routeShouldRevalidate";
import { onTranslationStatsUpdated } from "~/lib/translationStatsSync";
import { sameTranslationLocale } from "~/server/translateV4/locale";
import AppPageHeader from "~/ui/components/AppPageHeader";
import AppSubpageTitleBar, {
  useAppHomeBackAction,
} from "~/ui/components/AppSubpageTitleBar";
import AppSectionCard from "~/ui/components/AppSectionCard";
import {
  type ClientLogTrace,
  finishClientLogTrace,
  reportClientLog,
  startClientLogTrace,
} from "~/utils/clientLog";
import { logManageTranslationGraphQLErrorDetail } from "~/utils/manageTranslationErrors";

const { Text } = Typography;
interface TableDataType {
  key: string;
  title: string;
  allTranslatedItems?: number | undefined;
  allItems?: number | undefined;
  sync_status: boolean;
  navigation: string;
  withoutCount: boolean;
}

type LocaleSummary = ManageTranslationLocaleSnapshot;

type RowCountRef = { type?: string; module?: string };

function buildDataRow(
  key: string,
  title: string,
  navigation: string,
  snapshot: LocaleSummary | null,
  locale: string,
  loading: boolean,
  countRef?: RowCountRef,
  opts?: { sync_status?: boolean },
): TableDataType {
  const withoutCount = !countRef;
  const row: TableDataType = {
    key,
    title,
    navigation,
    sync_status: opts?.sync_status ?? false,
    withoutCount,
  };
  if (withoutCount) return row;
  if (loading || !snapshot || snapshot.locale !== locale) return row;
  const counts = countRef.module
    ? snapshot.byModule[countRef.module]
    : countRef.type
      ? snapshot.byType[countRef.type]
      : undefined;
  if (!counts) return row;
  return {
    ...row,
    allTranslatedItems: counts.translated,
    allItems: counts.total,
  };
}

function safeParseFormJson(value: FormDataEntryValue | null): unknown {
  if (value == null || value === "") return null;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const searchTerm = url.searchParams.get("language");

  return json({
    searchTerm: searchTerm || "",
  });
};

export const shouldRevalidate = shouldRevalidateManageTranslation;

export const action = async ({ request }: ActionFunctionArgs) => {
  const adminAuthResult = await authenticate.admin(request);
  const { shop, accessToken } = adminAuthResult.session;
  const { admin } = adminAuthResult;

  const formData = await request.formData();
  const itemsCountSummary = safeParseFormJson(formData.get("itemsCountSummary")) as
    | { target?: string; forceRefresh?: boolean }
    | null;
  if (itemsCountSummary?.target) {
    const target = itemsCountSummary.target.trim();
    const forceRefresh = itemsCountSummary.forceRefresh === true;
    try {
      if (forceRefresh) {
        await invalidateAllItemsCountForLocale(shop, target);
        const response = await refreshManageTranslationLocaleSummary({
          admin,
          shop,
          locale: target,
        });
        return { success: true, errorCode: 0, errorMsg: "", response };
      }
      const response = await getManageTranslationLocaleSnapshotFromCache(shop, target);
      return { success: true, errorCode: 0, errorMsg: "", response };
    } catch (error) {
      logManageTranslationGraphQLErrorDetail(
        "Error manage_translation refreshItemsCount",
        error,
      );
      return {
        success: false,
        errorCode: 10001,
        errorMsg: "SERVER_ERROR",
        response: null,
      };
    }
  }

  const translateImage = safeParseFormJson(formData.get("translateImage"));
  const replaceTranslateImage = safeParseFormJson(
    formData.get("replaceTranslateImage"),
  );
  switch (true) {
    case !!translateImage:
      try {
        const { sourceLanguage, targetLanguage, imageUrl } = translateImage;
        return await translateProductImage({
          shop,
          imageUrl,
          sourceCode: sourceLanguage,
          targetCode: targetLanguage,
        });
      } catch (error) {
        console.log("Error getImageTranslate", error);
        return {
          success: false,
          errorCode: 10001,
          errorMsg: "SERVER_ERROR",
          response: null,
        };
      }

    case !!replaceTranslateImage:
      try {
        const { url, userPicturesDoJson } = replaceTranslateImage;
        userPicturesDoJson.shopName = shop;
        const response = await saveTranslatedImageFromUrl({
          shop,
          imageUrl: url,
          userPicture: {
            imageId: userPicturesDoJson.imageId,
            imageBeforeUrl: userPicturesDoJson.imageBeforeUrl,
            languageCode: userPicturesDoJson.languageCode,
            altBeforeTranslation:
              userPicturesDoJson.altBeforeTranslation ?? "",
            altAfterTranslation: userPicturesDoJson.altAfterTranslation ?? "",
          },
        });
        return response;
      } catch (error) {
        console.log("error storageImage", error);
        return {
          success: false,
          errorCode: 10001,
          errorMsg: "SERVER_ERROR",
          response: null,
        };
      }

    default:
      // 你可以在这里处理一个默认的情况，如果没有符合的条件
      return {
        success: false,
        errorCode: 10001,
        errorMsg: "SERVER_ERROR",
        response: null,
      };
  }
};

function manageRow(
  key: string,
  title: string,
  navigation: string,
  opts?: { withoutCount?: boolean; sync_status?: boolean },
): TableDataType {
  return {
    key,
    title,
    sync_status: opts?.sync_status ?? false,
    navigation,
    withoutCount: opts?.withoutCount ?? true,
  };
}

const Index = () => {
  const { searchTerm } = useLoaderData<typeof loader>();

  const { t } = useTranslation();
  const homeBackAction = useAppHomeBackAction();

  const { reportClick } = useReport();

  const { source } = useSelector((state: any) => state.userConfig);

  const languageTableData: LanguagesDataType[] = useSelector(
    (state: any) => state.languageTableData.rows,
  );

  const loading = useMemo(() => {
    return !source?.code;
  }, [source]);

  const selectOptions = useMemo(() => {
    const newArray = languageTableData?.map((language: ShopLocalesType) => ({
      label: language?.name,
      value: language?.locale,
    }));

    return newArray || [];
  }, [languageTableData]);

  const [currentLocale, setCurrentLocale] = useState<string>("");
  const [localeSummary, setLocaleSummary] = useState<LocaleSummary | null>(null);

  const summaryFetcher = useFetcher<any>();

  const refreshStatsTraceRef = useRef<ClientLogTrace | null>(null);
  const loadedSummaryLocaleRef = useRef<string | null>(null);
  const pendingForceRefreshRef = useRef(false);

  const fetchLocaleSummary = useCallback(
    (target: string, forceRefresh = false) => {
      if (!target) return;
      if (forceRefresh) pendingForceRefreshRef.current = true;
      const formData = new FormData();
      formData.append(
        "itemsCountSummary",
        JSON.stringify({ target, forceRefresh }),
      );
      summaryFetcher.submit(formData, {
        method: "post",
        action: "/app/manage_translation",
      });
    },
    [summaryFetcher],
  );

  const isSummaryLoading = summaryFetcher.state !== "idle";

  const productsDataSource = useMemo(
    () => [
      buildDataRow(
        "products",
        t("Products"),
        "product",
        localeSummary,
        currentLocale,
        isSummaryLoading,
        { type: "PRODUCT" },
        { sync_status: true },
      ),
      buildDataRow(
        "collections",
        t("Collections"),
        "collection",
        localeSummary,
        currentLocale,
        isSummaryLoading,
        { type: "COLLECTION" },
        { sync_status: true },
      ),
    ],
    [localeSummary, currentLocale, isSummaryLoading, t],
  );

  const onlineStoreThemeDataSource = useMemo(
    () => [
      buildDataRow(
        "locale_content",
        t("Locale Content"),
        "locale_content",
        localeSummary,
        currentLocale,
        isSummaryLoading,
        { module: "ONLINE_STORE_THEME_LOCALE_CONTENT" },
      ),
      manageRow("json_template", t("Json Template"), "json_template"),
      manageRow("section_group", t("Section Group"), "section_group"),
      manageRow("settings_category", t("Settings Category"), "settings_category"),
      manageRow(
        "settings_data_sections",
        t("Settings Data Sections"),
        "settings_data_sections",
      ),
    ],
    [localeSummary, currentLocale, isSummaryLoading, t],
  );

  const onlineStoreDataSource = useMemo(
    () => [
      buildDataRow("shop", t("Shop"), "shop", localeSummary, currentLocale, isSummaryLoading, {
        type: "SHOP",
      }),
      buildDataRow("pages", t("Pages"), "page", localeSummary, currentLocale, isSummaryLoading, {
        type: "PAGE",
      }),
      buildDataRow(
        "metaobjects",
        t("Metaobjects"),
        "metaobject",
        localeSummary,
        currentLocale,
        isSummaryLoading,
        { type: "METAOBJECT" },
      ),
      buildDataRow(
        "navigation",
        t("Navigation"),
        "navigation",
        localeSummary,
        currentLocale,
        isSummaryLoading,
        { type: "LINK" },
      ),
      buildDataRow(
        "store_metadata",
        t("Metafield"),
        "metafield",
        localeSummary,
        currentLocale,
        isSummaryLoading,
        { type: "METAFIELD" },
      ),
    ],
    [localeSummary, currentLocale, isSummaryLoading, t],
  );

  const blogAndArticleDataSource = useMemo(
    () => [
      buildDataRow(
        "articles",
        t("Articles"),
        "article",
        localeSummary,
        currentLocale,
        isSummaryLoading,
        { type: "ARTICLE" },
      ),
      buildDataRow(
        "blog_titles",
        t("Blog titles"),
        "blog",
        localeSummary,
        currentLocale,
        isSummaryLoading,
        { type: "BLOG" },
      ),
    ],
    [localeSummary, currentLocale, isSummaryLoading, t],
  );

  const imageDataSource = useMemo(
    () => [
      manageRow("product_images", t("Product images"), "productImage"),
      manageRow("product_image_alt", t("Product image alt text"), "productImageAlt"),
    ],
    [t],
  );

  const settingsDataSource = useMemo(
    () => [
      buildDataRow(
        "policies",
        t("Policies"),
        "policy",
        localeSummary,
        currentLocale,
        isSummaryLoading,
        { type: "SHOP_POLICY" },
      ),
      buildDataRow(
        "email",
        t("Email"),
        "email",
        localeSummary,
        currentLocale,
        isSummaryLoading,
        { type: "EMAIL_TEMPLATE" },
      ),
      buildDataRow(
        "shipping",
        t("Shipping"),
        "shipping",
        localeSummary,
        currentLocale,
        isSummaryLoading,
        { type: "PACKING_SLIP_TEMPLATE" },
      ),
      buildDataRow(
        "delivery",
        t("Delivery"),
        "delivery",
        localeSummary,
        currentLocale,
        isSummaryLoading,
        { type: "DELIVERY_METHOD_DEFINITION" },
      ),
    ],
    [localeSummary, currentLocale, isSummaryLoading, t],
  );

  const liquidAndThirdPartyAppsDataSource = useMemo(
    () => [manageRow("custom_liquid", t("Custom Liquid"), "custom_liquid")],
    [t],
  );


  useEffect(() => {
    void reportClientLog(
      {
        event: "manage_translation_page_view",
        shop: globalStore?.shop,
        level: "info",
        kind: "event",
        status: "success",
        message: `${globalStore?.shop} 目前在翻译管理页面`,
        context: {
          legacy: true,
        },
      },
      { beacon: true },
    );
  }, []);

  useEffect(() => {
    if (languageTableData?.length) {
      const newArray = languageTableData?.map((language: ShopLocalesType) => ({
        label: language?.name,
        value: language?.locale,
      }));

      const findValue = newArray?.find((item) => item.value == searchTerm);

      if (findValue && searchTerm) {
        setCurrentLocale(searchTerm);
      } else {
        setCurrentLocale(newArray[0]?.value);
      }
    }
  }, [languageTableData, searchTerm]);

  useEffect(() => {
    if (!currentLocale) return;
    if (loadedSummaryLocaleRef.current === currentLocale) return;
    loadedSummaryLocaleRef.current = currentLocale;
    fetchLocaleSummary(currentLocale, false);
  }, [currentLocale, fetchLocaleSummary]);

  /** v4 任务完成后读 Redis 缓存刷新当前语言汇总。 */
  useEffect(() => {
    return onTranslationStatsUpdated((detail) => {
      if (
        !currentLocale ||
        !sameTranslationLocale(detail.target, currentLocale)
      ) {
        return;
      }
      fetchLocaleSummary(currentLocale, false);
    });
  }, [currentLocale, fetchLocaleSummary]);

  useEffect(() => {
    if (summaryFetcher.state !== "idle" || !summaryFetcher.data) return;
    const data = summaryFetcher.data;
    if (data.success && data.response) {
      setLocaleSummary(data.response as LocaleSummary);
      if (pendingForceRefreshRef.current) {
        pendingForceRefreshRef.current = false;
        finishClientLogTrace(refreshStatsTraceRef.current, {
          status: "success",
          context: { locale: currentLocale },
        });
        refreshStatsTraceRef.current = null;
        shopify.toast.show(t("Translation statistics refreshed"));
      }
      return;
    }
    if (pendingForceRefreshRef.current) {
      pendingForceRefreshRef.current = false;
      finishClientLogTrace(refreshStatsTraceRef.current, {
        level: "warn",
        status: "failure",
        message: data?.errorMsg || "Failed to refresh statistics",
        context: { locale: currentLocale },
      });
      refreshStatsTraceRef.current = null;
      shopify.toast.show(t("Failed to refresh statistics"));
    }
  }, [summaryFetcher.data, summaryFetcher.state, currentLocale, t]);

  const handleRefreshStats = () => {
    if (!currentLocale || !source?.code) return;
    refreshStatsTraceRef.current = startClientLogTrace({
      event: "manage_refresh_statistics",
      action: "refresh_statistics",
      shop: globalStore?.shop,
      context: {
        locale: currentLocale,
        source: source.code,
      },
    });
    reportClick("manage_refresh_stats");
    fetchLocaleSummary(currentLocale, true);
  };

  const summaryDisplay = useMemo(() => {
    if (isSummaryLoading && !localeSummary) return t("Syncing");
    if (!localeSummary || localeSummary.locale !== currentLocale) return "—";
    if (localeSummary.total <= 0) return "—";
    const pct =
      localeSummary.percent != null ? ` (${localeSummary.percent}%)` : "";
    return `${localeSummary.translated.toLocaleString()} / ${localeSummary.total.toLocaleString()}${pct}`;
  }, [currentLocale, isSummaryLoading, localeSummary, t]);

  return (
    <Page>
      <AppSubpageTitleBar title={t("Manage Translation")} />
      <ScrollNotice
        text={t(
          "Welcome to our app! If you have any questions, feel free to email us at support@ciwi.ai, and we will respond as soon as possible.",
        )}
      />
      {loading || !!selectOptions?.length ? (
        <div className="manage-page">
          <div className="manage-page__inner">
            <Space
              direction="vertical"
              size="middle"
              style={{ display: "flex" }}
            >
              <AppPageHeader
                title={t("Manage Translation")}
                backAction={homeBackAction}
              />
              <AppSectionCard bodyPadding="16px">
                <div className="manage-header">
                  <div className="manage-header-left">
                    <Text strong>{t("Localized content:")}</Text>
                    <Select
                      options={selectOptions}
                      value={currentLocale}
                      onChange={(value) => {
                        loadedSummaryLocaleRef.current = null;
                        setLocaleSummary(null);
                        setCurrentLocale(value);
                      }}
                      style={{ minWidth: "200px" }}
                    />
                    <Button
                      icon={<ReloadOutlined />}
                      onClick={handleRefreshStats}
                      loading={isSummaryLoading}
                      disabled={!currentLocale || !source?.code}
                    >
                      {t("Refresh statistics")}
                    </Button>
                  </div>
                </div>
              </AppSectionCard>
              <AppSectionCard bodyPadding="16px 20px">
                <Flex align="center" gap={24} wrap="wrap">
                  <Flex vertical gap={4}>
                    <Text type="secondary">{t("Items Translated")}</Text>
                    <Text strong style={{ fontSize: 20 }}>
                      {summaryDisplay}
                    </Text>
                  </Flex>
                </Flex>
              </AppSectionCard>
              <div className="manage-content-wrap">
                <div className="manage-content-left">
                  <div className="manage-card-grid">
                    <ManageTranslationsCard
                      cardTitle={t("Products")}
                      dataSource={productsDataSource}
                      currentLocale={currentLocale}
                    />
                    <ManageTranslationsCard
                      cardTitle={t("Online Store Theme")}
                      dataSource={onlineStoreThemeDataSource}
                      currentLocale={currentLocale}
                    />
                    <ManageTranslationsCard
                      cardTitle={t("Online Store")}
                      dataSource={onlineStoreDataSource}
                      currentLocale={currentLocale}
                    />
                    <ManageTranslationsCard
                      cardTitle={t("Blogs and articles")}
                      dataSource={blogAndArticleDataSource}
                      currentLocale={currentLocale}
                    />
                    <ManageTranslationsCard
                      cardTitle={t("Images data")}
                      dataSource={imageDataSource}
                      currentLocale={currentLocale}
                    />
                    <ManageTranslationsCard
                      cardTitle={t("Settings")}
                      dataSource={settingsDataSource}
                      currentLocale={currentLocale}
                    />
                    <ManageTranslationsCard
                      cardTitle={t("Liquid & Third-Party Apps")}
                      dataSource={liquidAndThirdPartyAppsDataSource}
                      currentLocale={currentLocale}
                    />
                  </div>
                </div>
                {/* <div className="manage-content-right"></div> */}
              </div>
            </Space>
          </div>
        </div>
      ) : (
        <NoLanguageSetCard />
      )}
    </Page>
  );
};

export const getItemOptions = (t: (key: string) => string) => [
  { label: t("Products"), value: "product" },
  { label: t("Collection"), value: "collection" },
  { label: t("Json Template"), value: "json_template" },
  { label: t("Locale Content"), value: "locale_content" },
  { label: t("Section Group"), value: "section_group" },
  { label: t("Settings Category"), value: "settings_category" },
  { label: t("Settings Data Sections"), value: "settings_data_sections" },
  { label: t("Shop"), value: "shop" },
  { label: t("Metafield"), value: "metafield" },
  { label: t("Custom Liquid"), value: "custom_liquid" },
  { label: t("Articles"), value: "article" },
  { label: t("Blog titles"), value: "blog" },
  { label: t("Pages"), value: "page" },
  { label: t("Filters"), value: "filter" },
  { label: t("Metaobjects"), value: "metaobject" },
  { label: t("Navigation"), value: "navigation" },
  { label: t("Email"), value: "email" },
  { label: t("Policies"), value: "policy" },
  { label: t("Product images"), value: "productImage" },
  { label: t("Product image alt text"), value: "productImageAlt" },
  { label: t("Delivery"), value: "delivery" },
  { label: t("Shipping"), value: "shipping" },
];

export default Index;
