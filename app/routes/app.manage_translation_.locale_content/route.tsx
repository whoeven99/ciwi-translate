import {
  Card,
  Divider,
  Input,
  Layout,
  Result,
  Space,
  Spin,
  Table,
  List,
} from "antd";
import Button from "~/ui/components/AppButton";
import { useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData, useNavigate } from "@remix-run/react"; // 引入 useNavigate
import { ActionFunctionArgs } from "@remix-run/node";
import { SearchOutlined } from "@ant-design/icons";
import { SingleTextTranslate } from "~/api/translateV4Client";
import { registerManageTranslations } from "~/server/shopify/translations.server";
import { authenticate } from "~/shopify.server";
import ManageTranslationFieldRow from "~/components/manageTranslationFieldRow";
import SingleTranslateAction from "~/components/singleTranslateAction";
import { isManageTranslationOutdated } from "~/utils/manageTranslationState";
import { useSingleTranslateQuotaGate } from "~/hooks/useSingleTranslateQuotaGate";

import { useTranslation } from "react-i18next";
import { useSelector } from "react-redux";
import { SaveBar } from "@shopify/app-bridge-react";
import { useContextualSaveBar } from "~/hooks/useContextualSaveBar";
import { runAfterSaveBarLeave } from "~/lib/saveBarNavigation";
import { Page, Select } from "@shopify/polaris";
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

export const loader = manageTranslationLanguageLoader;

export const action = async ({ request }: ActionFunctionArgs) => {
  const searchTerm = getManageTranslationLanguage(request);

  const adminAuthResult = await authenticate.admin(request);
  const { shop } = adminAuthResult.session;
  const { admin } = adminAuthResult;

  const formData = await request.formData();
  const loading: any = JSON.parse(formData.get("loading") as string);
  const confirmData: any[] = JSON.parse(formData.get("confirmData") as string);
  const refreshResourceIds: string[] = JSON.parse(
    (formData.get("refreshResourceIds") as string) || "[]",
  );
  if (loading) {
    try {
      const response = await admin.graphql(
          `#graphql
            query {     
              translatableResources(resourceType: ONLINE_STORE_THEME_LOCALE_CONTENT, first: 1) {
                nodes {
                  resourceId
                  translatableContent {
                    digest
                    key
                    locale
                    type
                    value
                  }
                  translations(locale: "${loading?.searchTerm || searchTerm}") {
                    value
                    outdated
                    key
                  }
                }
              }
            }`,
      );

      const data = await response.json();

      return {
        success: true,
        errorCode: 0,
        errorMsg: "",
        response: data?.data?.translatableResources || [],
      };
    } catch (error) {
      logManageTranslationGraphQLErrorDetail("Error manage theme loading", error);
      return buildManageActionErrorResponse(error, { response: null });
    }
  }

  if (refreshResourceIds.length > 0) {
    try {
      const response = await admin.graphql(
          `#graphql
            query refreshLocaleContentResources($resourceIds: [ID!]!, $locale: String!) {
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
  const [menuData, setMenuData] = useState<any>(null);
  const [selectedThemeKey, setSelectedThemeKey] = useState<string>("");
  const [themesData, setThemesData] = useState<any[]>([]);
  const [filteredThemesData, setFilteredThemesData] = useState<any>([]);
  const [resourceData, setResourceData] = useState<any>([]);
  const [searchInput, setSearchInput] = useState("");
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
  const [selectedItem, setSelectedItem] = useState<string>("locale_content");
  const [isMobile, setIsMobile] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    dataFetcher.submit(
      {
        loading: JSON.stringify({}),
      },
      {
        method: "POST",
      },
    );
    fetcher.submit(
      {
        log: `${globalStore?.shop} 目前在翻译管�?主题页面`,
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
    if (dataFetcher.data) {
      if (dataFetcher.data?.success) {
        const newData = dataFetcher.data?.response?.nodes || [];
        if (Array.isArray(newData)) {
          const menuData = exMenuData(newData);
          setMenuData(menuData);
          setThemesData(newData);
          setFilteredThemesData(newData);
          setSelectedThemeKey(menuData[0]?.key);
        }
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
    const filterMenuData = exMenuData(filteredThemesData) || [];

    setMenuData(filterMenuData);

    const findIndex = filterMenuData.find(
      (item: any) => item.key == selectedThemeKey,
    );

    if (!findIndex) {
      setSelectedThemeKey(filterMenuData[0]?.key);
      return;
    }

    setResourceData(generateMenuItemsArray(filteredThemesData));
  }, [filteredThemesData]);

  useEffect(() => {
    setResourceData(generateMenuItemsArray(filteredThemesData));
    setConfirmData([]);
    setSuccessTranslatedKey([]);
    if (currentPage !== 1) setCurrentPage(1);
  }, [selectedThemeKey]);

  useEffect(() => {
    const data = consumeConfirmResponse(confirmFetcher.data);
    if (!data?.success) return;

    const { failedItems, successfulItems, hasInvalidDigestError } =
      splitManageSaveResults(data.response);

    if (successfulItems.length) {
      setThemesData((prev: any[]) =>
        applyManageResourceTranslationUpdates(prev, successfulItems),
      );
      setFilteredThemesData((prev: any[]) =>
        applyManageResourceTranslationUpdates(prev, successfulItems),
      );
    }

    if (failedItems.length === 0) {
      shopify.toast.show(t("Saved successfully"));
      fetcher.submit(
        {
          log: `${globalStore?.shop} 翻译管理-主题页面修改数据保存成功`,
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
        isOutdated={isManageTranslationOutdated(filteredThemesData, record?.resourceId, record?.shopifyKey)}

        onSubmit={({ customPrompt, aiModel }) => {
          handleTranslate({
            resourceType: "ONLINE_STORE_THEME_LOCALE_CONTENT",
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

  const exMenuData = (data: any) => {
    const seen = new Set<string>();

    return data[0]?.translatableContent
      ?.map(({ key }: { key: string }) => {
        const parts = key.split(".");
        const first = parts[0];
        const second = parts[1];
        const rawLabel =
          first === "shopify" || first === "section"
            ? (second ?? first)
            : first;

        // �?首字母大�?
        const label = rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1);

        return { key: rawLabel, label };
      })
      .filter((item: any) => {
        if (seen.has(item.label)) return false;
        seen.add(item.label);
        return true;
      });
  };

  const generateMenuItemsArray = (items: any) => {
    return items[0]?.translatableContent?.flatMap(
      (item: any, index: number) => {
        // 创建当前项的对象
        if (!item?.value) return [];
        const parts = item?.key.split(".");
        const first = parts[0];
        const second = parts[1];
        const label =
          first === "shopify" || first === "section"
            ? (second ?? first)
            : first;
        if (label !== selectedThemeKey) return [];
        const currentItem = {
          key: `${item?.key}_${items[0]?.resourceId}_${index}`,
          resourceId: items[0]?.resourceId,
          shopifyKey: item?.key,
          resource: item?.key,
          digest: item?.digest || "",
          type: item?.type || "",
          default_language: item?.value || "",
          translated: items[0]?.translations?.find(
            (translation: any) => translation.key == item?.key,
          )?.value,
        };
        return [currentItem];
      },
    );
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
        log: `${globalStore?.shop} 从翻译管�?主题页面点击单行翻译`,
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
            log: `${globalStore?.shop} 从翻译管�?主题页面点击单行翻译返回结果 ${data?.response}`,
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

  const refreshCurrentPageData = () => {
    const currentResourceIds = themesData
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
        action: `/app/manage_translation/locale_content?language=${selectedLanguage}`,
      },
    );
  };
  const handleLanguageChange = (language: string) => {
    runAfterSaveBarLeave(() => {
      setIsLoading(true);
      dataFetcher.submit(
        {
          loading: JSON.stringify({
            searchTerm: language,
          }),
        },
        {
          method: "POST",
        },
      );
      isManualChangeRef.current = true;
      setSelectedLanguage(language);
      navigate(`/app/manage_translation/locale_content?language=${language}`);
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

  const handleMenuChange = (key: string) => {
    runAfterSaveBarLeave(() => {
      setSelectedThemeKey(key);
    });
  };

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchInput(value);
    const filteredData = [
      {
        ...themesData[0],
        translatableContent: themesData[0]?.translatableContent?.filter(
          (theme: any) =>
            typeof theme.value === "string" &&
            theme.value.toLowerCase().includes(value.toLowerCase()),
        ),
      },
    ];
    setFilteredThemesData(filteredData);
    if (currentPage !== 1) setCurrentPage(1);
  };

  const handleConfirm = () => {
    const formData = new FormData();
    formData.append("confirmData", JSON.stringify(confirmData)); // 将选中的语言作为字符串发�?
    confirmFetcher.submit(formData, {
      method: "post",
    }); // 提交表单请求
    fetcher.submit(
      {
        log: `${globalStore?.shop} 提交翻译管理-主题页面修改数据`,
      },
      {
        method: "POST",
        action: "/log",
      },
    );
  };

  const handleDiscard = () => {
    setFilteredThemesData([...filteredThemesData]); // 使用展开运算符创建新数组引用
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
      title={t("Locale Content")}
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
          marginBottom: "15px",
          gap: "8px",
        }}
      >
        <Input
          placeholder={t("Search...")}
          prefix={<SearchOutlined />}
          value={searchInput}
          onChange={handleSearch}
        />
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
        ) : Array.isArray(menuData) && menuData?.length ? (
          <>
            {!isMobile && (
              <Sider
                style={{
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
                    defaultSelectedKeys={menuData[0]?.key}
                    items={menuData}
                    selectedKeys={selectedThemeKey}
                    onClick={handleMenuChange}
                  />
                </div>
              </Sider>
            )}
            <Content
              style={{
                paddingLeft: isMobile ? "0" : "24px",
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
                      {resourceData.length > 20 && (
                        <List
                          itemLayout="vertical"
                          style={{ listStyle: "none" }}
                          pagination={{
                            onChange: (page) => {
                              if (page !== currentPage) {
                                runAfterSaveBarLeave(() => {
                                  setCurrentPage(page);
                                });
                              }
                            },
                            pageSize: 10,
                            total: resourceData.length,
                            current: currentPage,
                            showSizeChanger: false,
                          }}
                          dataSource={resourceData}
                          renderItem={(item: any) => (
                            <List.Item key={item.key}>
                              <Space
                                direction="vertical"
                                size="small"
                                style={{ width: "100%" }}
                              >
                                {renderManageField(item, true)}
                                <Divider style={{ margin: "8px 0" }} />
                              </Space>
                            </List.Item>
                          )}
                        />
                      )}
                    </Space>
                  </Card>
                  <SideMenu
                    defaultSelectedKeys={menuData[0]?.key}
                    items={menuData}
                    selectedKeys={selectedThemeKey}
                    onClick={handleMenuChange}
                  />
                </Space>
              ) : (
                <Space
                  direction="vertical"
                  size="middle"
                  style={{ display: "flex" }}
                >
                  <Table
                    columns={resourceColumns}
                    dataSource={resourceData}
                    pagination={{
                      current: currentPage,
                      position: ["bottomCenter"],
                      showSizeChanger: false,
                      onChange: (page) => {
                        if (page !== currentPage) {
                          runAfterSaveBarLeave(() => {
                            setCurrentPage(page);
                          });
                        }
                      },
                    }}
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
