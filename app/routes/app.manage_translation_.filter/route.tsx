import {
  Card,
  Divider,
  Layout,
  Result,
  Space,
  Spin,
  Table,
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

const { Content } = Layout;

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
        resourceType: "FILTER",
        startCursor: startCursor.cursor,
        locale: searchTerm || "",
      });
      console.log(`应用日志: ${shop} 翻译管理-筛选器页面翻到上一页`);

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
        resourceType: "FILTER",
        endCursor: endCursor.cursor,
        locale: searchTerm || "",
      });
      console.log(`应用日志: ${shop} 翻译管理-筛选器页面翻到下一页`);

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
            query refreshFilterResources($resourceIds: [ID!]!, $locale: String!) {
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

  const [filtersData, setFiltersData] = useState<any[]>([]);
  const [resourceData, setResourceData] = useState<any[]>([]);
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
  const [selectedItem, setSelectedItem] = useState<string>("filter");
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
        log: `${globalStore?.shop} 目前在翻译管�?筛选器页面`,
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
    if (filtersData) {
      const data = generateMenuItemsArray(filtersData);
      setResourceData(data);
      setLoadingItems([]);
      setConfirmData([]);
      setSuccessTranslatedKey([]);
      setTranslatedValues({});
    }
  }, [filtersData]);

  useEffect(() => {
    if (dataFetcher.data) {
      if (dataFetcher.data?.success) {
        const newData = dataFetcher.data.response?.nodes;
        if (Array.isArray(newData)) {
          // Sort by resourceId to ensure stable order
          newData.sort((a, b) => (a.resourceId > b.resourceId ? 1 : -1));
          setFiltersData(newData);
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
      setFiltersData((prev) =>
        applyManageResourceTranslationUpdates(prev, successfulItems),
      );
    }

    if (failedItems.length === 0) {
      shopify.toast.show(t("Saved successfully"));
      fetcher.submit(
        {
          log: `${globalStore?.shop} 翻译管理-筛选器页面修改数据保存成功`,
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

  const renderTranslateAction = (record: any) => {
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
        isOutdated={isManageTranslationOutdated(filtersData, record?.resourceId, record?.shopifyKey)}

        onSubmit={({ customPrompt, aiModel }) => {
          handleTranslate({
            resourceType: "FILTER",
            record,
            handleInputChange,
            customPrompt,
            aiModel,
          });
        }}
      />
    );
  };

  const renderManageField = (record: any, stacked = false) => {
    if (!record) return null;

    return (
      <ManageTranslationFieldRow
        record={record}
        isSuccess={successTranslatedKey?.includes(record?.key as string)}
        translatedValues={translatedValues}
        setTranslatedValues={setTranslatedValues}
        handleInputChange={handleInputChange}
        isRtl={searchTerm === "ar"}
        stacked={stacked}
        sourceLabel={t("Default Language")}
        translatedLabel={t("Translated")}
        action={renderTranslateAction(record)}
      />
    );
  };

  const resourceColumns = [
    {
      title: t("Resource"),
      key: "resource",
      render: (_: any, record: any) => renderManageField(record),
    },
  ];

  const generateMenuItemsArray = (items: any) => {
    return items.flatMap((item: any, index: number) => {
      if (item?.translatableContent.length !== 0) {
        // 创建当前项的对象
        const currentItem = {
          key: `label_${item?.resourceId}_${index}`,
          resourceId: item?.resourceId,
          shopifyKey: "label",
          index,
          resource: t("label"),
          digest: item?.translatableContent[0]?.digest || "",
          type: item?.translatableContent[0]?.type || "",
          default_language: item?.translatableContent[0]?.value || "",
          translated: item?.translations[0]?.value,
        };
        return currentItem.default_language !== "" ? [currentItem] : [];
      }
      return [];
    });
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
        log: `${globalStore?.shop} 从翻译管�?筛选器页面点击单行翻译`,
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
            log: `${globalStore?.shop} 从翻译管�?筛选器页面点击单行翻译返回结果 ${data?.response}`,
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
          action: `/app/manage_translation/filter?language=${language}`,
        },
      ); // 提交表单请求
      isManualChangeRef.current = true;
      setSelectedLanguage(language);
      navigate(`/app/manage_translation/filter?language=${language}`);
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
          action: `/app/manage_translation/filter?language=${searchTerm}`,
        },
      ); // 提交表单请求
    });
  };

  const refreshCurrentPageData = () => {
    const currentResourceIds = filtersData
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
        action: `/app/manage_translation/filter?language=${selectedLanguage}`,
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
          action: `/app/manage_translation/filter?language=${searchTerm}`,
        },
      ); // 提交表单请求
    });
  };

  const handleConfirm = () => {
    const formData = new FormData();
    formData.append("confirmData", JSON.stringify(confirmData)); // 将选中的语言作为字符串发�?
    confirmFetcher.submit(formData, {
      method: "post",
      action: `/app/manage_translation/filter?language=${searchTerm}`,
    }); // 提交表单请求
    fetcher.submit(
      {
        log: `${globalStore?.shop} 提交翻译管理-筛选器页面修改数据`,
      },
      {
        method: "POST",
        action: "/log",
      },
    );
  };

  const handleDiscard = () => {
    setFiltersData([...filtersData]);
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
      title={t("Filters")}
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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          flexGrow: 2,
          justifyContent: "flex-end",
          marginBottom: "15px",
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
        ) : filtersData.length ? (
          <Content
            style={{
              paddingLeft: isMobile ? "16px" : "0",
              minHeight: "70vh",
              display: "flex",
              flexDirection: "column",
              overflow: "auto",
            }}
          >
            {isMobile ? (
              <Space direction="vertical" style={{ width: "100%" }}>
                <Card title={t("Resource")}>
                  <Space direction="vertical" style={{ width: "100%" }}>
                    {resourceData.map((item: any, index: number) => (
                      <Space
                        key={item?.key || index}
                        direction="vertical"
                        size="small"
                        style={{ width: "100%" }}
                      >
                        {renderManageField(item, true)}
                        <Divider style={{ margin: "8px 0" }} />
                      </Space>
                    ))}
                  </Space>
                </Card>
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
                style={{ display: "flex" }}
              >
                <Table
                  columns={resourceColumns}
                  dataSource={resourceData}
                  pagination={false}
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
            )}
          </Content>
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
