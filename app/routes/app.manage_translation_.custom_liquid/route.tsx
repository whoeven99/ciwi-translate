import {
  Alert,
  Flex,
  Input,
  Layout,
  Space,
  Spin,
  Table,
  Typography,
} from "antd";
import { SearchOutlined } from "@ant-design/icons";
import Button from "~/ui/components/AppButton";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import { Page, Pagination, Select } from "@shopify/polaris";
import { SaveBar } from "@shopify/app-bridge-react";
import { useTranslation } from "react-i18next";
import { useSelector } from "react-redux";
import { SingleTextTranslate } from "~/api/translateV4Client";
import ManageTranslationFieldRow from "~/components/manageTranslationFieldRow";
import SingleTranslateAction from "~/components/singleTranslateAction";
import SideMenu from "~/components/sideMenu/sideMenu";
import { useSingleTranslateQuotaGate } from "~/hooks/useSingleTranslateQuotaGate";
import { globalStore } from "~/globalStore";
import { getItemOptions } from "../app.manage_translation/route";
import { manageTranslationLanguageLoader } from "~/server/manageTranslation/manageTranslationRoute.server";
import {
  deleteLiquidCompat,
  insertLiquidCompat,
  selectLiquidCompat,
  type LiquidTableRow,
} from "./liquidClient";
import UpdateCustomTransModal from "./components/updateCustomTransModal";
import {
  getTranslateV4ErrorMessage,
  TRANSLATE_V4_ERROR_KEYS,
} from "~/utils/translateV4Errors";

const { Content, Sider } = Layout;
const { Title } = Typography;
const PAGE_SIZE = 10;

export const loader = manageTranslationLanguageLoader;

type FieldRecord = {
  key: string;
  resource: string;
  default_language: string;
  translated: string;
  shopifyKey: string;
  type: string;
};

type ConfirmItem = {
  id: string;
  value: string;
  sourceText: string;
  languageCode: string;
};

const SEARCH_DEBOUNCE_MS = 300;

const Index = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { searchTerm } = useLoaderData<typeof loader>();
  const { handleSingleTranslateFailure, quotaGateModal } =
    useSingleTranslateQuotaGate();
  const languageTableData = useSelector(
    (state: any) => state.languageTableData.rows,
  );
  const fetcher = useFetcher<any>();
  const loadingItemsRef = useRef<string[]>([]);

  const [isMobile, setIsMobile] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pageAlert, setPageAlert] = useState("");
  const [dataSource, setDataSource] = useState<LiquidTableRow[]>([]);
  const [selectedRuleKey, setSelectedRuleKey] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [loadingItems, setLoadingItems] = useState<string[]>([]);
  const [successTranslatedKey, setSuccessTranslatedKey] = useState<string[]>(
    [],
  );
  const [translatedValues, setTranslatedValues] = useState<
    Record<string, string>
  >({});
  const [confirmData, setConfirmData] = useState<ConfirmItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [languageOptions, setLanguageOptions] = useState<
    { label: string; value: string }[]
  >([]);
  const [selectedLanguage, setSelectedLanguage] = useState(searchTerm || "");
  const [selectedItem, setSelectedItem] = useState("custom_liquid");
  const itemOptions = getItemOptions(t);
  const migrated = true;

  useEffect(() => {
    fetcher.submit(
      { log: `${globalStore?.shop} 目前在自定义翻译页面` },
      { method: "POST", action: "/log" },
    );
    const onResize = () => setIsMobile(window.innerWidth < 768);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadingItemsRef.current = loadingItems;
  }, [loadingItems]);

  useEffect(() => {
    if (!languageTableData) return;
    setLanguageOptions(
      languageTableData
        .filter((item: any) => !item.primary)
        .map((item: any) => ({
          label: item.name,
          value: item.locale,
        })),
    );
  }, [languageTableData]);

  useEffect(() => {
    if (!languageOptions.length) return;
    if (
      selectedLanguage &&
      languageOptions.some((item) => item.value === selectedLanguage)
    ) {
      return;
    }
    const next = languageOptions[0]?.value;
    if (next) {
      setSelectedLanguage(next);
      navigate(`/app/manage_translation/custom_liquid?language=${next}`, {
        replace: true,
      });
    }
  }, [languageOptions, selectedLanguage, navigate]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(searchInput.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedQuery]);

  useEffect(() => {
    if (!selectedLanguage) {
      if (!languageOptions.length) {
        setLoading(true);
        return;
      }
      setLoading(false);
      setDataSource([]);
      setHasNext(false);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const data = await selectLiquidCompat({
        languageCode: selectedLanguage,
        ...(debouncedQuery ? { q: debouncedQuery } : {}),
        page: currentPage,
        pageSize: PAGE_SIZE,
        signal: controller.signal,
      });
      if (cancelled || data.aborted) return;
      if (data.success) {
        setDataSource(data.response ?? []);
        setHasNext(Boolean(data.hasNext));
        setPageAlert("");
      } else {
        setPageAlert(
          getTranslateV4ErrorMessage(
            t,
            data.errorMsg,
            TRANSLATE_V4_ERROR_KEYS.LIQUID_LIST_FAILED,
          ),
        );
      }
      setLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [selectedLanguage, languageOptions.length, debouncedQuery, currentPage, t]);

  const resourceData = useMemo<FieldRecord[]>(
    () =>
      dataSource.map((row) => ({
        key: row.key,
        resource: t("value"),
        default_language: row.sourceText,
        translated: row.targetText,
        shopifyKey: "custom_liquid",
        type: "MULTI_LINE_TEXT_FIELD",
      })),
    [dataSource, t],
  );

  const pagedData = resourceData;

  const menuData = useMemo(
    () =>
      dataSource.map((row) => ({
        key: row.key,
        label: row.sourceText || t("value"),
      })),
    [dataSource, t],
  );

  useEffect(() => {
    if (!dataSource.length) {
      setSelectedRuleKey("");
      return;
    }
    if (!dataSource.some((row) => row.key === selectedRuleKey)) {
      setSelectedRuleKey(dataSource[0].key);
    }
  }, [dataSource, selectedRuleKey]);

  const selectedRecord =
    pagedData.find((item) => item.key === selectedRuleKey) ?? pagedData[0];

  useEffect(() => {
    setCurrentPage(1);
    setConfirmData([]);
    setSuccessTranslatedKey([]);
    shopify.saveBar.hide("save-bar");
  }, [selectedLanguage]);

  useEffect(() => {
    setTranslatedValues((prev) => {
      const next = { ...prev };
      for (const row of dataSource) {
        if (confirmData.some((item) => item.id === row.key)) continue;
        next[row.key] = row.targetText ?? "";
      }
      return next;
    });
  }, [dataSource, confirmData]);

  useEffect(() => {
    if (confirmData.length > 0) {
      shopify.saveBar.show("save-bar");
    } else {
      shopify.saveBar.hide("save-bar");
    }
  }, [confirmData]);

  const handleMenuChange = (key: string) => {
    if (confirmData.length > 0) {
      shopify.saveBar.leaveConfirmation();
      return;
    }
    shopify.saveBar.hide("save-bar");
    setSelectedRuleKey(key);
  };

  const handleInputChange = (record: FieldRecord, value: string) => {
    setTranslatedValues((prev) => ({ ...prev, [record.key]: value }));
    setConfirmData((prev) => {
      const index = prev.findIndex((item) => item.id === record.key);
      const nextItem: ConfirmItem = {
        id: record.key,
        value,
        sourceText: record.default_language,
        languageCode: selectedLanguage,
      };
      if (index !== -1) {
        const next = [...prev];
        next[index] = nextItem;
        return next;
      }
      return [...prev, nextItem];
    });
  };

  const handleLanguageChange = (language: string) => {
    if (confirmData.length > 0) {
      shopify.saveBar.leaveConfirmation();
      return;
    }
    shopify.saveBar.hide("save-bar");
    setSelectedLanguage(language);
    navigate(`/app/manage_translation/custom_liquid?language=${language}`);
  };

  const handleItemChange = (item: string) => {
    if (confirmData.length > 0) {
      shopify.saveBar.leaveConfirmation();
      return;
    }
    shopify.saveBar.hide("save-bar");
    setSelectedItem(item);
    navigate(`/app/manage_translation/${item}?language=${selectedLanguage}`);
  };

  const handleDelete = async () => {
    if (!selectedRuleKey) return;
    setPageAlert("");
    const data = await deleteLiquidCompat({
      migrated,
      shop: globalStore?.shop || "",
      ids: [selectedRuleKey],
    });
    if (data.success) {
      const deletedIds = (data.response ?? []).map(String);
      setDataSource((prev) =>
        prev.filter((row) => !deletedIds.includes(row.key)),
      );
      shopify.toast.show(t("Delete successfully"));
    } else {
      setPageAlert(
        getTranslateV4ErrorMessage(
          t,
          data.errorMsg,
          TRANSLATE_V4_ERROR_KEYS.LIQUID_DELETE_FAILED,
        ),
      );
    }
  };

  const handleConfirm = async () => {
    setSaving(true);
    setPageAlert("");
    try {
      for (const item of confirmData) {
        const data = await insertLiquidCompat({
          migrated,
          id: item.id,
          shop: globalStore?.shop || "",
          sourceText: item.sourceText,
          targetText: item.value,
          languageCode: item.languageCode,
        });
        if (!data.success) {
          setPageAlert(
            getTranslateV4ErrorMessage(
              t,
              data.errorMsg,
              TRANSLATE_V4_ERROR_KEYS.LIQUID_SAVE_FAILED,
            ),
          );
          return;
        }
        setDataSource((prev) =>
          prev.map((entry) =>
            entry.key === item.id
              ? { ...entry, targetText: item.value, status: "DONE" }
              : entry,
          ),
        );
      }
      setConfirmData([]);
      setSuccessTranslatedKey([]);
      shopify.saveBar.hide("save-bar");
      shopify.toast.show(t("Saved successfully"));
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    shopify.saveBar.hide("save-bar");
    setConfirmData([]);
    setSuccessTranslatedKey([]);
    setTranslatedValues(
      Object.fromEntries(
        dataSource.map((row) => [row.key, row.targetText ?? ""]),
      ),
    );
  };

  const handleTranslate = async ({
    record,
    customPrompt,
    aiModel,
  }: {
    record: FieldRecord;
    customPrompt?: string;
    aiModel?: string;
  }) => {
    fetcher.submit(
      {
        log: `${globalStore?.shop} 从翻译管理-自定义 Liquid 页面点击单行翻译`,
      },
      { method: "POST", action: "/log" },
    );
    setLoadingItems((prev) => [...prev, record.key]);
    const data = await SingleTextTranslate({
      shopName: globalStore?.shop || "",
      source: globalStore?.source || "",
      target: selectedLanguage || "",
      resourceType: "ONLINE_STORE_THEME",
      context: record.default_language,
      key: record.shopifyKey,
      type: record.type,
      resourceId: null,
      customPrompt,
      aiModel,
    });
    if (data?.success) {
      if (loadingItemsRef.current.includes(record.key)) {
        handleInputChange(record, data.response);
        setSuccessTranslatedKey((prev) => [...prev, record.key]);
        shopify.toast.show(t("Translated successfully"));
      }
    } else {
      handleSingleTranslateFailure(data?.errorMsg);
    }
    setLoadingItems((prev) => prev.filter((item) => item !== record.key));
  };

  const renderTranslateAction = (record: FieldRecord) => (
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
      loading={loadingItems.includes(record.key)}
      existingTranslation={translatedValues[record.key] ?? record.translated}
      sourceText={record.default_language}
      targetLocale={selectedLanguage}
      fieldKey={record.shopifyKey}
      isOutdated={false}
      onSubmit={({ customPrompt, aiModel }) => {
        void handleTranslate({ record, customPrompt, aiModel });
      }}
    />
  );

  const renderManageField = (record: FieldRecord, stacked = false) => (
    <ManageTranslationFieldRow
      record={record}
      isSuccess={successTranslatedKey.includes(record.key)}
      translatedValues={translatedValues}
      setTranslatedValues={setTranslatedValues}
      handleInputChange={handleInputChange}
      isRtl={selectedLanguage === "ar"}
      stacked={stacked}
      sourceLabel={t("Default Language")}
      translatedLabel={t("Translated")}
      action={renderTranslateAction(record)}
    />
  );

  const resourceColumns = [
    {
      title: t("Resource"),
      key: "resource",
      render: (_: unknown, record: FieldRecord) => renderManageField(record),
    },
  ];

  const onCancel = () => {
    if (confirmData.length > 0) {
      shopify.saveBar.leaveConfirmation();
      return;
    }
    shopify.saveBar.hide("save-bar");
    navigate(`/app/manage_translation?language=${selectedLanguage}`);
  };

  const hasPrevious = currentPage > 1;
  const hasNextPage = hasNext;

  return (
    <Page
      title={t("Custom Liquid")}
      fullWidth
      backAction={{ onAction: onCancel }}
    >
      <SaveBar id="save-bar">
        <button variant="primary" onClick={handleConfirm} disabled={saving}>
          {t("Save")}
        </button>
        <button onClick={handleDiscard}>{t("Cancel")}</button>
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
          onChange={(e) => setSearchInput(e.target.value)}
          allowClear
          style={{ flex: 1 }}
        />
        <div style={{ width: "160px" }}>
          <Select
            label=""
            options={languageOptions}
            value={selectedLanguage}
            onChange={handleLanguageChange}
          />
        </div>
        <div style={{ width: "160px" }}>
          <Select
            label=""
            options={itemOptions}
            value={selectedItem}
            onChange={handleItemChange}
          />
        </div>
        <Button type="primary" onClick={() => setCreateOpen(true)}>
          {t("Create rule")}
        </Button>
      </div>
      {pageAlert ? (
        <Alert
          type="error"
          showIcon
          message={pageAlert}
          closable
          onClose={() => setPageAlert("")}
          style={{ marginBottom: 12 }}
        />
      ) : null}
      <Layout
        style={{
          overflow: "auto",
          backgroundColor: "var(--p-color-bg)",
          minHeight: "70vh",
        }}
      >
        {loading ? (
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
        ) : pagedData.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "48px 16px",
              color: "var(--p-color-text-secondary)",
              width: "100%",
            }}
          >
            {t("customLiquid.noMatchingRules")}
          </div>
        ) : (
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
                    items={menuData}
                    selectedKeys={selectedRuleKey}
                    onClick={handleMenuChange}
                  />
                  <div style={{ display: "flex", justifyContent: "center" }}>
                    {(hasPrevious || hasNextPage) && (
                      <Pagination
                        hasPrevious={hasPrevious}
                        onPrevious={() =>
                          setCurrentPage((page) => page - 1)
                        }
                        hasNext={hasNextPage}
                        onNext={() => setCurrentPage((page) => page + 1)}
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
                  <Flex justify="space-between" align="center">
                    <Button
                      onClick={handleDelete}
                      disabled={!selectedRuleKey || loading}
                    >
                      {t("Delete")}
                    </Button>
                  </Flex>
                  <Title
                    level={4}
                    style={{
                      margin: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {selectedRecord?.default_language}
                  </Title>
                  {selectedRecord
                    ? renderManageField(selectedRecord, true)
                    : null}
                  <SideMenu
                    items={menuData}
                    selectedKeys={selectedRuleKey}
                    onClick={handleMenuChange}
                  />
                  <div style={{ display: "flex", justifyContent: "center" }}>
                    {(hasPrevious || hasNextPage) && (
                      <Pagination
                        hasPrevious={hasPrevious}
                        onPrevious={() =>
                          setCurrentPage((page) => page - 1)
                        }
                        hasNext={hasNextPage}
                        onNext={() => setCurrentPage((page) => page + 1)}
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
                  <Flex justify="space-between" align="center" gap={8}>
                    <Title
                      level={4}
                      style={{
                        margin: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        flex: 1,
                      }}
                    >
                      {selectedRecord?.default_language}
                    </Title>
                    <Button
                      onClick={handleDelete}
                      disabled={!selectedRuleKey || loading}
                    >
                      {t("Delete")}
                    </Button>
                  </Flex>
                  <Table
                    columns={resourceColumns}
                    dataSource={selectedRecord ? [selectedRecord] : []}
                    pagination={false}
                    rowKey="key"
                    locale={{ emptyText: t("customLiquid.noMatchingRules") }}
                  />
                </Space>
              )}
            </Content>
          </>
        )}
      </Layout>
      <UpdateCustomTransModal
        migrated={migrated}
        languageCode={selectedLanguage}
        title={t("Create rule")}
        open={createOpen}
        setIsModalHide={() => setCreateOpen(false)}
        handleUpdateDataSource={(row) => {
          setDataSource((prev) =>
            [row, ...prev.filter((item) => item.key !== row.key)].slice(
              0,
              PAGE_SIZE,
            ),
          );
          setSelectedRuleKey(row.key);
          setTranslatedValues((prev) => ({
            ...prev,
            [row.key]: row.targetText,
          }));
        }}
      />
      {quotaGateModal}
    </Page>
  );
};

export default Index;
