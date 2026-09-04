import {
  Alert,
  Card,
  Checkbox,
  Divider,
  Flex,
  Layout,
  Space,
  Spin,
  Table,
} from "antd";
import Button from "~/ui/components/AppButton";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import { Page, Pagination, Select } from "@shopify/polaris";
import { SaveBar } from "@shopify/app-bridge-react";
import { useContextualSaveBar } from "~/hooks/useContextualSaveBar";
import { runAfterSaveBarLeave } from "~/lib/saveBarNavigation";
import { useTranslation } from "react-i18next";
import { useSelector } from "react-redux";
import { SingleTextTranslate } from "~/api/translateV4Client";
import ManageTranslationFieldRow from "~/components/manageTranslationFieldRow";
import SingleTranslateAction from "~/components/singleTranslateAction";
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

const { Content } = Layout;
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
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [loadingItems, setLoadingItems] = useState<string[]>([]);
  const [successTranslatedKey, setSuccessTranslatedKey] = useState<string[]>(
    [],
  );
  const [translatedValues, setTranslatedValues] = useState<
    Record<string, string>
  >({});
  const [confirmData, setConfirmData] = useState<
    { id: string; value: string }[]
  >([]);
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
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const data = await selectLiquidCompat({
        migrated,
        shop: globalStore?.shop || "",
      });
      if (cancelled) return;
      if (data.success) {
        setDataSource(data.response ?? []);
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
    };
  }, [t]);

  const languageRows = useMemo(
    () => dataSource.filter((row) => row.languageCode === selectedLanguage),
    [dataSource, selectedLanguage],
  );

  const resourceData = useMemo<FieldRecord[]>(
    () =>
      languageRows.map((row) => ({
        key: row.key,
        resource: t("value"),
        default_language: row.sourceText,
        translated: row.targetText,
        shopifyKey: "custom_liquid",
        type: "MULTI_LINE_TEXT_FIELD",
      })),
    [languageRows, t],
  );

  const pagedData = useMemo(
    () =>
      resourceData.slice(
        (currentPage - 1) * PAGE_SIZE,
        currentPage * PAGE_SIZE,
      ),
    [resourceData, currentPage],
  );

  useEffect(() => {
    setCurrentPage(1);
    setSelectedRowKeys([]);
    setConfirmData([]);
    setSuccessTranslatedKey([]);
  }, [selectedLanguage]);

  useEffect(() => {
    setTranslatedValues((prev) => {
      const next = { ...prev };
      for (const row of languageRows) {
        if (confirmData.some((item) => item.id === row.key)) continue;
        next[row.key] = row.targetText ?? "";
      }
      return next;
    });
  }, [languageRows, confirmData]);

  useContextualSaveBar("save-bar", confirmData.length > 0);

  const hasSelected = selectedRowKeys.length > 0;
  const currentPageKeys = pagedData.map((item) => item.key);
  const allCurrentPageSelected =
    currentPageKeys.length > 0 &&
    currentPageKeys.every((key) => selectedRowKeys.includes(key));
  const someCurrentPageSelected = currentPageKeys.some((key) =>
    selectedRowKeys.includes(key),
  );

  const handleInputChange = (record: FieldRecord, value: string) => {
    setTranslatedValues((prev) => ({ ...prev, [record.key]: value }));
    setConfirmData((prev) => {
      const index = prev.findIndex((item) => item.id === record.key);
      if (index !== -1) {
        const next = [...prev];
        next[index] = { ...next[index], value };
        return next;
      }
      return [...prev, { id: record.key, value }];
    });
  };

  const handleLanguageChange = (language: string) => {
    runAfterSaveBarLeave(() => {
      setSelectedLanguage(language);
      navigate(`/app/manage_translation/custom_liquid?language=${language}`);
    });
  };

  const handleItemChange = (item: string) => {
    runAfterSaveBarLeave(() => {
      setSelectedItem(item);
      navigate(`/app/manage_translation/${item}?language=${selectedLanguage}`);
    });
  };

  const handleDelete = async () => {
    setPageAlert("");
    const data = await deleteLiquidCompat({
      migrated,
      shop: globalStore?.shop || "",
      ids: selectedRowKeys,
    });
    if (data.success) {
      const deletedIds = (data.response ?? []).map(String);
      setDataSource((prev) =>
        prev.filter((row) => !deletedIds.includes(row.key)),
      );
      setSelectedRowKeys([]);
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
        const row = dataSource.find((entry) => entry.key === item.id);
        if (!row) continue;
        const data = await insertLiquidCompat({
          migrated,
          id: item.id,
          shop: globalStore?.shop || "",
          sourceText: row.sourceText,
          targetText: item.value,
          languageCode: row.languageCode,
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
      shopify.toast.show(t("Saved successfully"));
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    setConfirmData([]);
    setSuccessTranslatedKey([]);
    setTranslatedValues(
      Object.fromEntries(
        languageRows.map((row) => [row.key, row.targetText ?? ""]),
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
    <Flex align="flex-start" gap={8}>
      <Checkbox
        checked={selectedRowKeys.includes(record.key)}
        onChange={(e) => {
          setSelectedRowKeys(
            e.target.checked
              ? [...selectedRowKeys, record.key]
              : selectedRowKeys.filter((key) => key !== record.key),
          );
        }}
        style={{ marginTop: 4 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
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
      </div>
    </Flex>
  );

  const resourceColumns = [
    {
      title: t("Resource"),
      key: "resource",
      render: (_: unknown, record: FieldRecord) => renderManageField(record),
    },
  ];

  const onCancel = () => {
    runAfterSaveBarLeave(() => {
      navigate(`/app/manage_translation?language=${selectedLanguage}`);
    });
  };

  const hasPrevious = currentPage > 1;
  const hasNext = currentPage * PAGE_SIZE < resourceData.length;

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
        <button onClick={handleDiscard}>{t("Discard")}</button>
      </SaveBar>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          justifyContent: "flex-end",
          marginBottom: "15px",
        }}
      >
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
      <Flex
        align="center"
        justify="space-between"
        style={{ width: "100%", marginBottom: 12 }}
      >
        <Flex align="center" gap="middle">
          <Button onClick={handleDelete} disabled={!hasSelected || loading}>
            {t("Delete")}
          </Button>
          {hasSelected
            ? `${t("Selected")} ${selectedRowKeys.length} ${t("items")}`
            : null}
        </Flex>
        <Button type="primary" onClick={() => setCreateOpen(true)}>
          {t("Create rule")}
        </Button>
      </Flex>
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
        ) : (
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
                <Card
                  title={
                    <Checkbox
                      checked={allCurrentPageSelected}
                      indeterminate={
                        someCurrentPageSelected && !allCurrentPageSelected
                      }
                      onChange={(e) =>
                        setSelectedRowKeys(
                          e.target.checked
                            ? [
                                ...selectedRowKeys.filter(
                                  (key) => !currentPageKeys.includes(key),
                                ),
                                ...currentPageKeys,
                              ]
                            : selectedRowKeys.filter(
                                (key) => !currentPageKeys.includes(key),
                              ),
                        )
                      }
                    >
                      {t("Resource")}
                    </Checkbox>
                  }
                >
                  <Space direction="vertical" style={{ width: "100%" }}>
                    {pagedData.map((item) => (
                      <Space
                        key={item.key}
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
              </Space>
            ) : (
              <Table
                columns={resourceColumns}
                dataSource={pagedData}
                pagination={false}
                rowKey="key"
              />
            )}
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                padding: "12px 0",
              }}
            >
              {(hasPrevious || hasNext) && (
                <Pagination
                  hasPrevious={hasPrevious}
                  onPrevious={() => setCurrentPage((page) => page - 1)}
                  hasNext={hasNext}
                  onNext={() => setCurrentPage((page) => page + 1)}
                />
              )}
            </div>
          </Content>
        )}
      </Layout>
      <UpdateCustomTransModal
        migrated={migrated}
        dataSource={dataSource}
        languageCode={selectedLanguage}
        title={t("Create rule")}
        open={createOpen}
        setIsModalHide={() => setCreateOpen(false)}
        handleUpdateDataSource={(row) => {
          setDataSource((prev) => [row, ...prev]);
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
