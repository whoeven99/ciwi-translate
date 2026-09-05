import {
  Card,
  Divider,
  Layout,
  Result,
  Space,
  Spin,
  Table,
  Typography,
} from "antd";
import Button from "~/ui/components/AppButton";
import { useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData, useNavigate } from "@remix-run/react"; // 引入 useNavigate
import { Page, Pagination, Select } from "@shopify/polaris";
import { ActionFunctionArgs } from "@remix-run/node";
import { queryNextTransType, queryPreviousTransType } from "~/api/admin";
import { SingleTextTranslate } from "~/api/translateV4Client";
import { registerManageTranslations } from "~/server/shopify/translations.server";
import ManageTranslationFieldRow from "~/components/manageTranslationFieldRow";
import SingleTranslateAction from "~/components/singleTranslateAction";
import { isManageTranslationOutdated } from "~/utils/manageTranslationState";
import { useSingleTranslateQuotaGate } from "~/hooks/useSingleTranslateQuotaGate";

import { authenticate } from "~/shopify.server";
import { useTranslation } from "react-i18next";
import { useSelector } from "react-redux";
import { SaveBar } from "@shopify/app-bridge-react";
import { useContextualSaveBar } from "~/hooks/useContextualSaveBar";
import { runAfterSaveBarLeave } from "~/lib/saveBarNavigation";
import { globalStore } from "~/globalStore";
import { useConsumableFetcherData } from "~/hooks/useConsumableFetcherData";
import { getItemOptions } from "../app.manage_translation/route";
import {
  getManageTranslationLanguage,
  manageTranslationLanguageLoader,
} from "~/server/manageTranslation/manageTranslationRoute.server";
import {
  buildManageActionErrorResponse,
  getManageTranslationLoadErrorMessage,
  logManageTranslationGraphQLErrorDetail,
} from "~/utils/manageTranslationErrors";
import {
  applyManageResourceTranslationUpdates,
  splitManageSaveResults,
} from "~/utils/manageSave";
import SideMenu from "~/components/sideMenu/sideMenu";

const { Sider, Content } = Layout;

const { Title } = Typography;

export const loader = manageTranslationLanguageLoader;

export const action = async ({ request }: ActionFunctionArgs) => {
  const searchTerm = getManageTranslationLanguage(request);

  const adminAuthResult = await authenticate.admin(request);
  const { shop, accessToken } = adminAuthResult.session;
  const { admin } = adminAuthResult;

  const formData = await request.formData();
  const startCursor = JSON.parse(formData.get("startCursor") as string);
  const endCursor = JSON.parse(formData.get("endCursor") as string);
  const confirmData: any[] = JSON.parse(formData.get("confirmData") as string);
  const refreshResourceIds: string[] = JSON.parse(
    (formData.get("refreshResourceIds") as string) || "[]",
  );
  if (startCursor) {
    try {
      const response = await queryPreviousTransType({
        shop,
        accessToken: accessToken as string,
        resourceType: "COLLECTION",
        startCursor: startCursor.cursor,
        locale: searchTerm || "",
      });
      console.log(`应用日志: ${shop} 翻译管理-集合页面翻到上一页`);

      return {
        success: true,
        errorCode: 0,
        errorMsg: "",
        response,
      };
    } catch (error) {
      return buildManageActionErrorResponse(error, { response: undefined });
    }
  }

  if (endCursor) {
    try {
      const response = await queryNextTransType({
        shop,
        accessToken: accessToken as string,
        resourceType: "COLLECTION",
        endCursor: endCursor.cursor,
        locale: searchTerm || "",
      });
      console.log(`应用日志: ${shop} 翻译管理-集合页面翻到下一页`);

      return {
        success: true,
        errorCode: 0,
        errorMsg: "",
        response,
      };
    } catch (error) {
      return buildManageActionErrorResponse(error, { response: undefined });
    }
  }

  if (refreshResourceIds.length > 0) {
    try {
      const response = await admin.graphql(
        `#graphql
          query refreshCollectionResources($resourceIds: [ID!]!, $locale: String!) {
            translatableResourcesByIds(resourceIds: $resourceIds, first: 250) {
              nodes {
                resourceId
                translatableContent {
                  key
                  digest
                  locale
                  type
                  value
                }
                translations(locale: $locale) {
                  key
                  value
                  outdated
                }
              }
            }
          }`,
        {
          variables: {
            resourceIds: refreshResourceIds,
            locale: searchTerm || "",
          },
        },
      );
      const data = await response.json();

      return {
        success: true,
        errorCode: 0,
        errorMsg: "",
        response: {
          nodes: data.data?.translatableResourcesByIds?.nodes || [],
          pageInfo: null,
        },
      };
    } catch (error) {
      logManageTranslationGraphQLErrorDetail("Error refreshing current page", error);
      return buildManageActionErrorResponse(error, { response: undefined });
    }
  }

  if (confirmData) {
    const data = await registerManageTranslations({
      admin,
      shop,
      confirmData,
    });

    return {
      success: true,
      errorCode: 0,
      errorMsg: "",
      response: data,
    };
  }

  return buildManageActionErrorResponse();
};

const Index = () => {
  const { t } = useTranslation();
  const { handleSingleTranslateFailure, quotaGateModal } = useSingleTranslateQuotaGate();
  const navigate = useNavigate();
  const languageTableData = useSelector(
    (state: any) => state.languageTableData.rows,
  );

  const { searchTerm } = useLoaderData<typeof loader>();

  const isManualChangeRef = useRef(true);
  const loadingItemsRef = useRef<string[]>([]);

  const fetcher = useFetcher<any>();
  const dataFetcher = useFetcher<any>();
  const confirmFetcher = useFetcher<any>();
  const { consume: consumeConfirmResponse } =
    useConsumableFetcherData<any>();

  const [isLoading, setIsLoading] = useState(true);

  const [menuData, setMenuData] = useState<any[]>([]);
  const [collectionsData, setCollectionsData] = useState<any[]>([]);
  const [resourceData, setResourceData] = useState<any[]>([]);
  const [SeoData, setSeoData] = useState<any[]>([]);
  const [selectCollectionKey, setSelectCollectionKey] = useState<string>("");
  const [confirmData, setConfirmData] = useState<any[]>([]);
  const [loadingItems, setLoadingItems] = useState<string[]>([]);
  const [successTranslatedKey, setSuccessTranslatedKey] = useState<string[]>(
    [],
  );
  const [translatedValues, setTranslatedValues] = useState<{
    [key: string]: string;
  }>({});
  const itemOptions = getItemOptions(t);
  const [languageOptions, setLanguageOptions] = useState<
    { label: string; value: string }[]
  >([]);
  const [selectedLanguage, setSelectedLanguage] = useState<string>(
    searchTerm || "",
  );
  const [selectedItem, setSelectedItem] = useState<string>("collection");
  const [pageInfo, setPageInfo] = useState<{
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor: string;
    endCursor: string;
  }>({
    hasPreviousPage: false,
    hasNextPage: false,
    startCursor: "",
    endCursor: "",
  });
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    dataFetcher.submit(
      {
        endCursor: JSON.stringify({
          cursor: "",
          searchTerm: searchTerm,
        }),
      },
      {
        method: "POST",
      },
    );
    fetcher.submit(
      {
        log: `${globalStore?.shop} 目前在翻译管�?集合页面`,
      },
      {
        method: "POST",
        action: "/log",
      },
    );
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    loadingItemsRef.current = loadingItems;
  }, [loadingItems]);

  useEffect(() => {
    if (languageTableData) {
      setLanguageOptions(
        languageTableData
          .filter((item: any) => !item.primary)
          .map((item: any) => ({
            label: item.name,
            value: item.locale,
          })),
      );
    }
  }, [languageTableData]);

  useEffect(() => {
    if (collectionsData) {
      const selectedData = collectionsData.find(
        (item: any) => item?.resourceId == selectCollectionKey,
      );
      setResourceData(
        [
          {
            key: `title_${selectedData?.resourceId}_0`,
            resourceId: selectedData?.resourceId,
            shopifyKey: "title",
            resource: t("Title"),
            digest:
              selectedData?.translatableContent?.find(
                (item: any) => item.key == "title",
              )?.digest || "",
            type:
              selectedData?.translatableContent?.find(
                (item: any) => item.key == "title",
              )?.type || "",
            default_language:
              selectedData?.translatableContent?.find(
                (item: any) => item.key == "title",
              )?.value || "",
            translated: selectedData?.translations?.find(
              (item: any) => item.key == "title",
            )?.value,
          },
          {
            key: `body_html_${selectedData?.resourceId}_1`,
            resourceId: selectedData?.resourceId,
            shopifyKey: "body_html",
            resource: t("Description"),
            digest:
              selectedData?.translatableContent?.find(
                (item: any) => item.key == "body_html",
              )?.digest || "",
            type:
              selectedData?.translatableContent?.find(
                (item: any) => item.key == "body_html",
              )?.type || "",
            default_language:
              selectedData?.translatableContent?.find(
                (item: any) => item.key == "body_html",
              )?.value || "",
            translated: selectedData?.translations?.find(
              (item: any) => item.key == "body_html",
            )?.value,
          },
        ].filter((item) => item.default_language),
      );
      setSeoData(
        [
          {
            key: `handle_${selectedData?.resourceId}_0`,
            resourceId: selectedData?.resourceId,
            shopifyKey: "handle",
            resource: t("URL handle"),
            digest:
              selectedData?.translatableContent?.find(
                (item: any) => item.key == "handle",
              )?.digest || "",
            type:
              selectedData?.translatableContent?.find(
                (item: any) => item.key == "handle",
              )?.type || "",
            default_language:
              selectedData?.translatableContent?.find(
                (item: any) => item.key == "handle",
              )?.value || "",
            translated: selectedData?.translations?.find(
              (item: any) => item.key == "handle",
            )?.value,
          },
          {
            key: `meta_title_${selectedData?.resourceId}_1`,
            resourceId: selectedData?.resourceId,
            shopifyKey: "meta_title",
            resource: t("Meta title"),
            digest:
              selectedData?.translatableContent?.find(
                (item: any) => item.key == "meta_title",
              )?.digest || "",
            type:
              selectedData?.translatableContent?.find(
                (item: any) => item.key == "meta_title",
              )?.type || "",
            default_language:
              selectedData?.translatableContent?.find(
                (item: any) => item.key == "meta_title",
              )?.value || "",
            translated: selectedData?.translations?.find(
              (item: any) => item.key == "meta_title",
            )?.value,
          },
          {
            key: `meta_description_${selectedData?.resourceId}_2`,
            resourceId: selectedData?.resourceId,
            shopifyKey: "meta_description",
            resource: t("Meta description"),
            digest:
              selectedData?.translatableContent?.find(
                (item: any) => item.key == "meta_description",
              )?.digest || "",
            type:
              selectedData?.translatableContent?.find(
                (item: any) => item.key == "meta_description",
              )?.type || "",
            default_language:
              selectedData?.translatableContent?.find(
                (item: any) => item.key == "meta_description",
              )?.value || "",
            translated: selectedData?.translations?.find(
              (item: any) => item.key == "meta_description",
            )?.value,
          },
        ].filter((item) => item.default_language),
      );
      setConfirmData([]);
      setSuccessTranslatedKey([]);
      setTranslatedValues({});
    }
  }, [selectCollectionKey, collectionsData]);

  useEffect(() => {
    if (dataFetcher.data) {
      if (dataFetcher.data?.success) {
        const newData = dataFetcher.data.response?.nodes;
        if (Array.isArray(newData)) {
          // Sort by resourceId to ensure stable order
          newData.sort((a, b) => (a.resourceId > b.resourceId ? 1 : -1));
          const menuData = exMenuData(newData);
          setMenuData(menuData);
          setCollectionsData(newData);
          setSelectCollectionKey(newData[0]?.resourceId);
        }
        const newPageInfo = dataFetcher.data.response?.pageInfo;

        if (newPageInfo) setPageInfo(newPageInfo);
        isManualChangeRef.current = false; // 重置
        setTimeout(() => {
          setIsLoading(false);
        }, 100);
      }
    }
  }, [dataFetcher.data]);
  useEffect(() => {
    if (!dataFetcher.data || dataFetcher.data.success) return;
    setIsLoading(false);
    shopify.toast.show(
      getManageTranslationLoadErrorMessage(t, dataFetcher.data?.errorMsg),
    );
  }, [dataFetcher.data, t]);

  useEffect(() => {
    const data = consumeConfirmResponse(confirmFetcher.data);
    if (!data?.success) return;

    const { failedItems, successfulItems, hasInvalidDigestError } =
      splitManageSaveResults(data.response);

    if (successfulItems.length) {
      setCollectionsData((prev) =>
        applyManageResourceTranslationUpdates(prev, successfulItems),
      );
    }

    if (failedItems.length === 0) {
      shopify.toast.show(t("Saved successfully"));
      fetcher.submit(
        {
          log: `${globalStore?.shop} 翻译管理-集合页面修改数据保存成功`,
        },
        {
          method: "POST",
          action: "/log",
        },
      );
    } else {
      shopify.toast.show(t("Some items saved failed"));
      if (hasInvalidDigestError || successfulItems.length > 0) {
        refreshCurrentPageData();
      }
    }

    setConfirmData([]);
    setSuccessTranslatedKey([]);
  }, [confirmFetcher.data, consumeConfirmResponse, fetcher, t]);

  useContextualSaveBar("save-bar", confirmData.length > 0);

  const renderTranslateAction = (record: any, resourceType: string) => {
    if (!record) return null;

    return (
      <SingleTranslateAction
        triggerProps={{
          type: "default",
          size: "small",
          style: {
            height: 22,
            paddingInline: 6,
            fontWeight: 500,
            fontSize: 12,
            lineHeight: 1,
            color: "var(--app-accent-primary)",
            borderColor: "var(--app-accent-primary)",
            borderRadius: 6,
            backgroundColor: "var(--p-color-bg-surface)",
            whiteSpace: "nowrap",
          },
        }}
        loading={loadingItems.includes(record?.key || "")}
        existingTranslation={
          translatedValues[record?.key || ""] ?? record?.translated
        }
        sourceText={record?.default_language ?? ""}
        targetLocale={searchTerm || ""}
        fieldKey={record?.shopifyKey || record?.key || "value"}
        isOutdated={isManageTranslationOutdated(collectionsData, record?.resourceId, record?.shopifyKey)}

        onSubmit={({ customPrompt, aiModel }) => {
          handleTranslate({
            resourceType,
            record,
            handleInputChange,
            customPrompt,
            aiModel,
          });
        }}
      />
    );
  };

  const renderManageField = (
    record: any,
    resourceType: string,
    options?: {
      isHtml?: boolean;
      stacked?: boolean;
    },
  ) => {
    if (!record) return null;

    return (
      <ManageTranslationFieldRow
        record={record}
        isHtml={options?.isHtml}
        isSuccess={successTranslatedKey?.includes(record?.key as string)}
        translatedValues={translatedValues}
        setTranslatedValues={setTranslatedValues}
        handleInputChange={handleInputChange}
        isRtl={searchTerm === "ar"}
        stacked={options?.stacked}
        sourceLabel={t("Default Language")}
        translatedLabel={t("Translated")}
        action={renderTranslateAction(record, resourceType)}
      />
    );
  };

  const renderMobileSection = (
    title: string,
    data: any[],
    resourceType: string,
    options?: {
      isHtml?: (record: any) => boolean;
    },
  ) => {
    if (!Array.isArray(data) || data[0] === undefined) return null;

    return (
      <Card title={title}>
        <Space direction="vertical" style={{ width: "100%" }}>
          {data.map((item: any, index: number) => (
            <Space
              key={item?.key || index}
              direction="vertical"
              size="small"
              style={{ width: "100%" }}
            >
              {renderManageField(item, resourceType, {
                isHtml: options?.isHtml?.(item) ?? false,
                stacked: true,
              })}
              <Divider style={{ margin: "8px 0" }} />
            </Space>
          ))}
        </Space>
      </Card>
    );
  };

  const resourceColumns = [
    {
      title: t("Resource"),
      key: "resource",
      render: (_: any, record: any) =>
        renderManageField(record, "COLLECTION", {
          isHtml: record?.shopifyKey == "body_html",
        }),
    },
  ];

  const SEOColumns = [
    {
      title: "SEO",
      key: "resource",
      render: (_: any, record: any) => renderManageField(record, "COLLECTION"),
    },
  ];

  const exMenuData = (menuData: any) => {
    const data = menuData.map((item: any) => ({
      key: item?.resourceId,
      label: item?.translatableContent.find((item: any) => item.key === "title")
        .value,
    }));
    return data;
  };

  const handleInputChange = (record: any, value: string) => {
    setTranslatedValues((prev) => ({
      ...prev,
      [record?.key]: value, // 更新对应�?key
    }));
    setConfirmData((prevData) => {
      const existingItemIndex = prevData.findIndex(
        (item) => item.id === record?.key,
      );
      if (existingItemIndex !== -1) {
        // 如果 key 存在，更新其对应�?value
        const updatedConfirmData = [...prevData];
        updatedConfirmData[existingItemIndex] = {
          ...updatedConfirmData[existingItemIndex],
          value: value,
        };
        return updatedConfirmData;
      } else {
        const newItem = {
          id: record?.key,
          resourceId: record?.resourceId,
          locale: globalStore?.source || "",
          key: record?.shopifyKey,
          value: value, // 初始为空字符�?
          translatableContentDigest: record?.digest,
          target: searchTerm || "",
        };

        return [...prevData, newItem]; // 将新数据添加�?confirmData �?
      }
    });
  };

  const handleTranslate = async ({
    resourceType,
    record,
    handleInputChange,
    customPrompt,
    aiModel,
  }: {
    resourceType: string;
    record: any;
    handleInputChange: (record: any, value: string) => void;
    customPrompt?: string;
    aiModel?: string;
  }) => {
    fetcher.submit(
      {
        log: `${globalStore?.shop} 从翻译管�?集合页面点击单行翻译`,
      },
      {
        method: "POST",
        action: "/log",
      },
    );
    setLoadingItems((prev) => [...prev, record?.key]);

    const data = await SingleTextTranslate({
      shopName: globalStore?.shop || "",
      source: globalStore?.source || "",
      target: searchTerm || "",
      resourceType: resourceType,
      context: record?.default_language,
      key: record?.shopifyKey,
      type: record?.type,
      resourceId: record?.resourceId,
      customPrompt,
      aiModel,
    });
    if (data?.success) {
      if (loadingItemsRef.current.includes(record?.key)) {
        handleInputChange(record, data.response);
        setSuccessTranslatedKey((prev) => [...prev, record?.key]);
        shopify.toast.show(t("Translated successfully"));
        fetcher.submit(
          {
            log: `${globalStore?.shop} 从翻译管�?集合页面点击单行翻译返回结果 ${data?.response}`,
          },
          {
            method: "POST",
            action: "/log",
          },
        );
      }
    } else {
      handleSingleTranslateFailure(data.errorMsg);
    }
    setLoadingItems((prev) => prev.filter((item) => item !== record?.key));
  };

  const handleLanguageChange = (language: string) => {
    runAfterSaveBarLeave(() => {
      setIsLoading(true);
      dataFetcher.submit(
        {
          endCursor: JSON.stringify({
            cursor: "",
            searchTerm: searchTerm,
          }),
        },
        {
          method: "post",
          action: `/app/manage_translation/collection?language=${language}`,
        },
      ); // 提交表单请求
      isManualChangeRef.current = true;
      setSelectedLanguage(language);
      navigate(`/app/manage_translation/collection?language=${language}`);
    });
  };

  const handleItemChange = (item: string) => {
    runAfterSaveBarLeave(() => {
      setIsLoading(true);
      isManualChangeRef.current = true;
      setSelectedItem(item);
      navigate(`/app/manage_translation/${item}?language=${searchTerm}`);
    });
  };

  const onPrevious = () => {
    runAfterSaveBarLeave(() => {
      dataFetcher.submit(
        {
          startCursor: JSON.stringify({
            cursor: pageInfo.startCursor,
            searchTerm: searchTerm,
          }),
        },
        {
          method: "post",
          action: `/app/manage_translation/collection?language=${searchTerm}`,
        },
      ); // 提交表单请求
    });
  };

  const refreshCurrentPageData = () => {
    const currentResourceIds = collectionsData
      .map((item: any) => item?.resourceId)
      .filter(Boolean);

    if (currentResourceIds.length === 0) return;

    setIsLoading(true);
    dataFetcher.submit(
      {
        refreshResourceIds: JSON.stringify(currentResourceIds),
      },
      {
        method: "post",
        action: `/app/manage_translation/collection?language=${selectedLanguage}`,
      },
    );
  };
  const onNext = () => {
    runAfterSaveBarLeave(() => {
      dataFetcher.submit(
        {
          endCursor: JSON.stringify({
            cursor: pageInfo.endCursor,
            searchTerm: searchTerm,
          }),
        },
        {
          method: "post",
          action: `/app/manage_translation/collection?language=${searchTerm}`,
        },
      ); // 提交表单请求
    });
  };

  const handleMenuChange = (key: string) => {
    runAfterSaveBarLeave(() => {
      setSelectCollectionKey(key);
    });
  };

  const handleConfirm = () => {
    const formData = new FormData();
    formData.append("confirmData", JSON.stringify(confirmData)); // 将选中的语言作为字符串发�?
    confirmFetcher.submit(formData, {
      method: "post",
      action: `/app/manage_translation/collection?language=${searchTerm}`,
    }); // 提交表单请求
    fetcher.submit(
      {
        log: `${globalStore?.shop} 提交翻译管理-集合页面修改数据`,
      },
      {
        method: "POST",
        action: "/log",
      },
    );
  };

  const handleDiscard = () => {
    const selectedData = collectionsData.find(
      (item: any) => item?.resourceId == selectCollectionKey,
    );
    setResourceData(
      [
        {
          key: `title_${selectedData?.resourceId}_0`,
          resourceId: selectedData?.resourceId,
          shopifyKey: "title",
          resource: t("Title"),
          digest:
            selectedData?.translatableContent?.find(
              (item: any) => item.key == "title",
            )?.digest || "",
          type:
            selectedData?.translatableContent?.find(
              (item: any) => item.key == "title",
            )?.type || "",
          default_language:
            selectedData?.translatableContent?.find(
              (item: any) => item.key == "title",
            )?.value || "",
          translated: selectedData?.translations?.find(
            (item: any) => item.key == "title",
          )?.value,
        },
        {
          key: `body_html_${selectedData?.resourceId}_1`,
          resourceId: selectedData?.resourceId,
          shopifyKey: "body_html",
          resource: t("Description"),
          digest:
            selectedData?.translatableContent?.find(
              (item: any) => item.key == "body_html",
            )?.digest || "",
          type:
            selectedData?.translatableContent?.find(
              (item: any) => item.key == "body_html",
            )?.type || "",
          default_language:
            selectedData?.translatableContent?.find(
              (item: any) => item.key == "body_html",
            )?.value || "",
          translated: selectedData?.translations?.find(
            (item: any) => item.key == "body_html",
          )?.value,
        },
      ].filter((item) => item.default_language),
    );
    setSeoData(
      [
        {
          key: `handle_${selectedData?.resourceId}_0`,
          resourceId: selectedData?.resourceId,
          shopifyKey: "handle",
          resource: t("URL handle"),
          digest:
            selectedData?.translatableContent?.find(
              (item: any) => item.key == "handle",
            )?.digest || "",
          type:
            selectedData?.translatableContent?.find(
              (item: any) => item.key == "handle",
            )?.type || "",
          default_language:
            selectedData?.translatableContent?.find(
              (item: any) => item.key == "handle",
            )?.value || "",
          translated: selectedData?.translations?.find(
            (item: any) => item.key == "handle",
          )?.value,
        },
        {
          key: `meta_title_${selectedData?.resourceId}_1`,
          resourceId: selectedData?.resourceId,
          shopifyKey: "meta_title",
          resource: t("Meta title"),
          digest:
            selectedData?.translatableContent?.find(
              (item: any) => item.key == "meta_title",
            )?.digest || "",
          type:
            selectedData?.translatableContent?.find(
              (item: any) => item.key == "meta_title",
            )?.type || "",
          default_language:
            selectedData?.translatableContent?.find(
              (item: any) => item.key == "meta_title",
            )?.value || "",
          translated: selectedData?.translations?.find(
            (item: any) => item.key == "meta_title",
          )?.value,
        },
        {
          key: `meta_description_${selectedData?.resourceId}_2`,
          resourceId: selectedData?.resourceId,
          shopifyKey: "meta_description",
          resource: t("Meta description"),
          digest:
            selectedData?.translatableContent?.find(
              (item: any) => item.key == "meta_description",
            )?.digest || "",
          type:
            selectedData?.translatableContent?.find(
              (item: any) => item.key == "meta_description",
            )?.type || "",
          default_language:
            selectedData?.translatableContent?.find(
              (item: any) => item.key == "meta_description",
            )?.value || "",
          translated: selectedData?.translations?.find(
            (item: any) => item.key == "meta_description",
          )?.value,
        },
      ].filter((item) => item.default_language),
    );
    setConfirmData([]);
    setSuccessTranslatedKey([]);
  };

  const onCancel = () => {
    runAfterSaveBarLeave(() => {
      navigate(`/app/manage_translation?language=${searchTerm}`); // 跳转�?/app/manage_translation
    });
  };

  return (
    <Page
      title={t("Collections")}
      fullWidth={true}
      backAction={{
        onAction: onCancel,
      }}
    >
      <SaveBar id="save-bar">
        <button
          variant="primary"
          onClick={handleConfirm}
          disabled={confirmFetcher.state === "submitting"}
        >
          {t("Save")}
        </button>
        <button onClick={handleDiscard}>{t("Discard")}</button>
      </SaveBar>
      <Layout
        style={{
          overflow: "auto",
          backgroundColor: "var(--p-color-bg)",
          minHeight: "70vh",
        }}
      >
        {isLoading ? (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              height: "100%",
            }}
          >
            <Spin />
          </div>
        ) : collectionsData.length ? (
          <>
            {!isMobile && (
              <Sider
                style={{
                  height: "100%",
                  minHeight: "70vh",
                  display: "flex",
                  flexDirection: "column",
                  overflow: "auto",
                  backgroundColor: "var(--p-color-bg)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    flex: 1,
minHeight: 0,
justifyContent: "space-between",
                  }}
                >
                  <SideMenu
                    items={menuData}
                    selectedKeys={selectCollectionKey}
                    onClick={handleMenuChange}
                  />
                  <div style={{ display: "flex", justifyContent: "center" }}>
                    {(pageInfo.hasPreviousPage || pageInfo.hasNextPage) && (
                      <Pagination
                        hasPrevious={pageInfo.hasPreviousPage}
                        onPrevious={onPrevious}
                        hasNext={pageInfo.hasNextPage}
                        onNext={onNext}
                      />
                    )}
                  </div>
                </div>
              </Sider>
            )}
            <Content
              style={{
                paddingLeft: isMobile ? "16px" : "24px",
                minHeight: "70vh",
                display: "flex",
                flexDirection: "column",
                overflow: "auto",
              }}
            >
              {isMobile ? (
                <Space direction="vertical" style={{ width: "100%" }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <Title
                      level={4}
                      style={{
                        margin: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {
                        menuData!.find(
                          (item: any) => item.key === selectCollectionKey,
                        )?.label
                      }
                    </Title>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        flexGrow: 2,
                        justifyContent: "flex-end",
                      }}
                    >
                      <div
                        style={{
                          width: "100px",
                        }}
                      >
                        <Select
                          label={""}
                          options={languageOptions}
                          value={selectedLanguage}
                          onChange={(value) => handleLanguageChange(value)}
                        />
                      </div>
                      <div
                        style={{
                          width: "100px",
                        }}
                      >
                        <Select
                          label={""}
                          options={itemOptions}
                          value={selectedItem}
                          onChange={(value) => handleItemChange(value)}
                        />
                      </div>
                    </div>
                  </div>
                  {renderMobileSection(
                    t("Resource"),
                    resourceData,
                    "COLLECTION",
                    {
                      isHtml: (record) => record?.shopifyKey == "body_html",
                    },
                  )}
                  {renderMobileSection(t("SEO"), SeoData, "COLLECTION")}
                  <SideMenu
                    items={menuData}
                    selectedKeys={selectCollectionKey}
                    onClick={handleMenuChange}
                  />
                  <div style={{ display: "flex", justifyContent: "center" }}>
                    {(pageInfo.hasPreviousPage || pageInfo.hasNextPage) && (
                      <Pagination
                        hasPrevious={pageInfo.hasPreviousPage}
                        onPrevious={onPrevious}
                        hasNext={pageInfo.hasNextPage}
                        onNext={onNext}
                      />
                    )}
                  </div>
                </Space>
              ) : (
                <Space
                  direction="vertical"
                  size="large"
                  style={{ width: "100%" }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <Title
                      level={4}
                      style={{
                        margin: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {
                        menuData!.find(
                          (item: any) => item.key === selectCollectionKey,
                        )?.label
                      }
                    </Title>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        flexGrow: 2,
                        justifyContent: "flex-end",
                      }}
                    >
                      <div
                        style={{
                          width: "150px",
                        }}
                      >
                        <Select
                          label={""}
                          options={languageOptions}
                          value={selectedLanguage}
                          onChange={(value) => handleLanguageChange(value)}
                        />
                      </div>
                      <div
                        style={{
                          width: "150px",
                        }}
                      >
                        <Select
                          label={""}
                          options={itemOptions}
                          value={selectedItem}
                          onChange={(value) => handleItemChange(value)}
                        />
                      </div>
                    </div>
                  </div>
                  <Table
                    columns={resourceColumns}
                    dataSource={resourceData}
                    pagination={false}
                  />
                  <Table
                    columns={SEOColumns}
                    dataSource={SeoData}
                    pagination={false}
                  />
                </Space>
              )}
            </Content>
          </>
        ) : (
          <Result
            title={t("The specified fields were not found in the store.")}
            extra={
              <Button type="primary" onClick={onCancel}>
                {t("Yes")}
              </Button>
            }
          />
        )}
      </Layout>
      {quotaGateModal}
    </Page>
  );
};

export default Index;
