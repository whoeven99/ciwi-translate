import { Page } from "@shopify/polaris";
import { useEffect, useMemo, useRef, useState } from "react";
import { authenticate } from "~/shopify.server";
import { ActionFunctionArgs, json, LoaderFunctionArgs } from "@remix-run/node";
import {
  Card,
  Checkbox,
  Flex,
  Modal,
  Pagination,
  Popconfirm,
  Skeleton,
  Space,
  Switch,
  Table,
  Typography,
} from "antd";
import Button from "~/ui/components/AppButton";
import AppSectionCard from "~/ui/components/AppSectionCard";
import AppPageHeader from "~/ui/components/AppPageHeader";
import AppSubpageTitleBar, {
  useAppHomeBackAction,
} from "~/ui/components/AppSubpageTitleBar";
import { useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import { queryShopLanguages } from "~/api/admin";
import {
  listGlossaryPagePayload,
  deleteGlossaryDo,
} from "~/server/translateV4/glossary.server";
import { updateGlossaryCompat } from "./glossaryClient";
import { useDispatch, useSelector } from "react-redux";
import {
  setGLossaryStatusLoadingState,
  setGLossaryTableData,
} from "~/store/modules/glossaryTableData";
import UpdateGlossaryModal from "./components/updateGlossaryModal";
import { InfoCircleOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import ScrollNotice from "~/components/ScrollNotice";
import defaultStyles from "../styles/defaultStyles.module.css";
import styles from "../app.language/styles.module.css";
import useReport from "scripts/eventReport";
import { globalStore } from "~/globalStore";
import {
  type ClientLogTrace,
  finishClientLogTrace,
  startClientLogTrace,
} from "~/utils/clientLog";
import {
  buildTranslateV4Error,
  getTranslateV4ErrorMessage,
  TRANSLATE_V4_ERROR_KEYS,
} from "~/utils/translateV4Errors";
const { Text } = Typography;

export interface GLossaryDataType {
  key: number;
  sourceText: string;
  targetText: string;
  language: string;
  rangeCode: string;
  type: number;
  status: number;
  loading: boolean;
  createdDate: string;
}

export const planMapping = {
  Free: 200,
  Basic: 200,
  Pro: 200,
  Premium: 500,
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const isMobile = request.headers.get("user-agent")?.includes("Mobile");
  return {
    mobile: isMobile as boolean,
  };
};

function parseJsonFormField<T>(formData: FormData, key: string): T | undefined {
  const value = formData.get(key);
  if (typeof value !== "string") return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const adminAuthResult = await authenticate.admin(request);
  const { shop, accessToken } = adminAuthResult.session;

  try {
    const formData = await request.formData();
    const loading = parseJsonFormField<boolean>(formData, "loading");
    const loadLocales = parseJsonFormField<boolean>(formData, "loadLocales");
    const deleteInfo =
      parseJsonFormField<number[]>(formData, "deleteInfo") ?? [];
    switch (true) {
      case !!loading:
        try {
          const response = await listGlossaryPagePayload(shop);
          return { success: true, errorCode: null, errorMsg: null, response };
        } catch (error) {
          console.error("Error glossary loading:", error);
          const appError = buildTranslateV4Error(
            TRANSLATE_V4_ERROR_KEYS.GLOSSARY_LIST_FAILED,
          );
          return {
            success: false,
            errorCode: appError.errorCode,
            errorMsg: appError.errorMsg,
            response: undefined,
          };
        }
      case !!loadLocales:
        try {
          const shopLanguages = await queryShopLanguages({
            shop,
            accessToken: accessToken as string,
          });
          const shopLocales = Array.isArray(shopLanguages)
            ? shopLanguages.filter(
                (language: {
                  locale: string;
                  name: string;
                  primary?: boolean;
                  published?: boolean;
                }) => !language.primary,
              )
            : [];
          return {
            success: true,
            errorCode: null,
            errorMsg: null,
            response: { shopLocales },
          };
        } catch (error) {
          console.error("Error glossary locales loading:", error);
          const appError = buildTranslateV4Error(
            TRANSLATE_V4_ERROR_KEYS.TARGET_LOCALE_LIST_FAILED,
          );
          return {
            success: false,
            errorCode: appError.errorCode,
            errorMsg: appError.errorMsg,
            response: undefined,
          };
        }
      case !!deleteInfo: {
        const ids = Array.isArray(deleteInfo)
          ? deleteInfo.map((x) => Number(x)).filter((id) => !Number.isNaN(id))
          : [];
        try {
          if (ids.length > 0) {
            await deleteGlossaryDo(shop, ids);
            return json({
              success: true,
              errorCode: null,
              errorMsg: null,
              data: ids.map((id) => ({
                status: "fulfilled",
                value: { success: true, response: { id } },
              })),
            });
          }
        } catch (error) {
          console.error("Error glossary loading:", error);
          const appError = buildTranslateV4Error(
            TRANSLATE_V4_ERROR_KEYS.GLOSSARY_DELETE_FAILED,
          );
          return json(
            {
              success: false,
              errorCode: appError.errorCode,
              errorMsg: appError.errorMsg,
              data: ids.map((id) => ({
                status: "fulfilled",
                value: {
                  success: false,
                  errorMsg: appError.errorMsg,
                  response: { id },
                },
              })),
            },
            { status: appError.status },
          );
        }
      }
      default:
        // 你可以在这里处理一个默认的情况，如果没有符合的条件
        const appError = buildTranslateV4Error(
          TRANSLATE_V4_ERROR_KEYS.INVALID_REQUEST,
        );
        return json(
          {
            success: false,
            errorCode: appError.errorCode,
            errorMsg: appError.errorMsg,
            data: [],
          },
          { status: appError.status },
        );
    }
  } catch (error) {
    console.error("Error action glossary:", error);
    const appError = buildTranslateV4Error(
      TRANSLATE_V4_ERROR_KEYS.INTERNAL_ERROR,
    );
    return json(
      {
        success: false,
        errorCode: appError.errorCode,
        errorMsg: appError.errorMsg,
        data: [],
      },
      { status: appError.status },
    );
  }
};

const Index = () => {
  const { mobile } = useLoaderData<typeof loader>();
  const migrated = true;
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { plan } = useSelector((state: any) => state.userConfig);
  const dataSource = useSelector((state: any) => state.glossaryTableData.rows);

  const [title, setTitle] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [deleteLoading, setDeleteLoading] = useState<boolean>(false);
  const [isMobile, setIsMobile] = useState<boolean>(mobile);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]); //表格多选控制key
  const [isGlossaryModalOpen, setIsGlossaryModalOpen] =
    useState<boolean>(false);
  const [glossaryModalId, setGlossaryModalId] = useState<number>(-1);
  const [upgradeModalContent, setUpgradeModalContent] = useState<{
    title: string;
    body: string;
  } | null>(null);
  const hasSelected = useMemo(() => {
    return selectedRowKeys.length > 0;
  }, [selectedRowKeys]);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10; // 每页显示5条，可自定义
  const pagedData = useMemo(
    () =>
      dataSource.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [dataSource, currentPage, pageSize],
  );
  const currentPageKeys = useMemo(
    () => pagedData.map((item: any) => item.key),
    [pagedData],
  );
  const allCurrentPageSelected = useMemo(
    () => currentPageKeys.every((key: any) => selectedRowKeys.includes(key)),
    [currentPageKeys, selectedRowKeys],
  );
  const someCurrentPageSelected = useMemo(
    () => currentPageKeys.some((key: any) => selectedRowKeys.includes(key)),
    [currentPageKeys, selectedRowKeys],
  );

  const fetcher = useFetcher<any>();
  const loadingFetcher = useFetcher<any>();
  const deleteFetcher = useFetcher<any>();
  const deleteTraceRef = useRef<ClientLogTrace | null>(null);
  const handledDeleteResponseRef = useRef<any>(null);
  const { t } = useTranslation();
  const homeBackAction = useAppHomeBackAction();
  const { reportClick, report } = useReport();
  useEffect(() => {
    loadingFetcher.submit(
      { loading: JSON.stringify(true) },
      { method: "POST" },
    );
    fetcher.submit(
      {
        log: `${globalStore?.shop} 目前在术语表页面`,
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
    if (loadingFetcher.data) {
      if (loadingFetcher.data?.success) {
        dispatch(
          setGLossaryTableData(
            loadingFetcher.data?.response?.glossaryTableData || [],
          ),
        );
      }
      setLoading(false);
    }
  }, [loadingFetcher.data]);

  useEffect(() => {
    if (deleteFetcher.data) {
      if (handledDeleteResponseRef.current === deleteFetcher.data) {
        return;
      }
      handledDeleteResponseRef.current = deleteFetcher.data;

      const results = Array.isArray(deleteFetcher.data?.data)
        ? deleteFetcher.data.data
        : [];
      let newData = [...dataSource];
      const failedIds: Array<string | number> = [];
      const failedMessages: string[] = [];

      results.forEach((res: any) => {
        if (res.value?.success) {
          newData = newData.filter(
            (item: GLossaryDataType) => item.key !== res.value.response.id,
          );
        } else {
          failedIds.push(res.value?.response?.id ?? "unknown");
          failedMessages.push(
            getTranslateV4ErrorMessage(
              t,
              res.value?.errorMsg,
              TRANSLATE_V4_ERROR_KEYS.GLOSSARY_DELETE_FAILED,
            ),
          );
        }
      });

      if (!results.length) {
        failedMessages.push(
          getTranslateV4ErrorMessage(
            t,
            deleteFetcher.data?.errorMsg,
            TRANSLATE_V4_ERROR_KEYS.GLOSSARY_DELETE_FAILED,
          ),
        );
      }

      finishClientLogTrace(deleteTraceRef.current, {
        level: failedIds.length > 0 || !results.length ? "warn" : "info",
        status: failedIds.length > 0 || !results.length ? "failure" : "success",
        context: {
          selectedCount: selectedRowKeys.length,
          failedIds,
        },
      });
      deleteTraceRef.current = null;

      if (newData.length !== dataSource.length) {
        dispatch(setGLossaryTableData(newData));
        setSelectedRowKeys([]);
      }

      setDeleteLoading(false);

      if (failedMessages.length) {
        failedMessages.forEach((message) => shopify.toast.show(message));
      }
      if (newData.length !== dataSource.length) {
        shopify.toast.show(t("Delete successfully"));
      }
    }
  }, [dataSource, deleteFetcher.data, dispatch, selectedRowKeys.length, t]);

  const handleDelete = () => {
    deleteTraceRef.current = startClientLogTrace({
      event: "glossary_delete_rules",
      action: "delete_rules",
      shop: globalStore?.shop,
      context: {
        selectedRowKeys,
      },
    });
    const formData = new FormData();
    formData.append("deleteInfo", JSON.stringify(selectedRowKeys)); // 将选中的语言作为字符串发送
    deleteFetcher.submit(formData, { method: "post", action: "/app/glossary" }); // 提交表单请求
    setDeleteLoading(true);
  };

  const handleApplication = async (key: number) => {
    const row = dataSource.find((item: any) => item.key === key);
    const trace = startClientLogTrace({
      event: "glossary_toggle_rule",
      action: row?.status === 0 ? "enable_rule" : "disable_rule",
      shop: globalStore?.shop,
      context: {
        glossaryId: key,
        previousStatus: row?.status,
      },
    });
    if (row.status === 0) {
      const activeItemsCount = dataSource.filter(
        (item: any) => item.status === 1,
      ).length;
      if (
        activeItemsCount >= planMapping[plan?.type as keyof typeof planMapping]
      ) {
        finishClientLogTrace(trace, {
          level: "warn",
          status: "failure",
          message: "Glossary term limit reached",
        });
        modalShowForPlan();
        return;
      }
    }

    dispatch(setGLossaryStatusLoadingState({ key, loading: true }));

    const updateInfo = {
      ...row,
      type: row.type ? 1 : 0,
      status: row.status === 0 ? 1 : 0,
    };

    try {
      const data = await updateGlossaryCompat({
        migrated,
        shop: globalStore?.shop || "",
        data: updateInfo,
      });

      if (data?.success) {
        shopify.toast.show(t("Saved successfully"));
        finishClientLogTrace(trace, {
          status: "success",
          context: {
            glossaryId: data.response.id,
            nextStatus: data.response.status,
          },
        });
        dispatch(
          setGLossaryStatusLoadingState({
            key: data.response.id,
            loading: false,
            status: data.response.status,
          }),
        );
        return;
      }

      const errorMsg = getTranslateV4ErrorMessage(
        t,
        data?.errorMsg,
        TRANSLATE_V4_ERROR_KEYS.GLOSSARY_SAVE_FAILED,
      );
      shopify.toast.show(errorMsg);
      finishClientLogTrace(trace, {
        level: "warn",
        status: "failure",
        message: errorMsg,
        context: {
          glossaryId: data?.response?.id ?? key,
        },
      });
      dispatch(
        setGLossaryStatusLoadingState({
          key: data?.response?.id ?? key,
          loading: false,
        }),
      );
    } catch {
      const errorMsg = getTranslateV4ErrorMessage(
        t,
        TRANSLATE_V4_ERROR_KEYS.GLOSSARY_SAVE_FAILED,
      );
      shopify.toast.show(errorMsg);
      finishClientLogTrace(trace, {
        level: "warn",
        status: "failure",
        message: errorMsg,
        context: {
          glossaryId: key,
        },
      });
      dispatch(
        setGLossaryStatusLoadingState({
          key,
          loading: false,
        }),
      );
    }
  };

  const handleIsModalOpen = (title: string, key: number) => {
    if (!plan?.type) {
      return;
    }
    if (
      title === "Create rule" &&
      dataSource.length >= planMapping[plan?.type as keyof typeof planMapping]
    ) {
      modalShowForPlan();
    } else {
      setTitle(t(title));
      setGlossaryModalId(key);
      setIsGlossaryModalOpen(true); // 打开Modal
    }
    reportClick("glossary_list_edit");
  };

  const modalShowForPlan = () => {
    const currentPlanLimit =
      planMapping[plan?.type as keyof typeof planMapping] || 0;
    if (currentPlanLimit === 0) {
      setUpgradeModalContent({
        title: t("Feature Unavailable"),
        body: t("This feature is available only with the paid plan."),
      });
    } else {
      setUpgradeModalContent({
        title: t("You’ve reached your term limit"),
        body: t(
          "You’ve added all the terms allowed in your current plan.To keep building your glossary and improve translation accuracy, upgrade to a higher plan for more capacity.",
        ),
      });
    }
  };

  const columns = [
    {
      title: t("Status"),
      dataIndex: "status",
      key: "status",
      width: "10%",
      render: (_: any, record: any) => (
        <Switch
          checked={record?.status}
          onClick={() => {
            handleApplication(record.key);
            report(
              { status: !record?.status ? 1 : 0 },
              {
                action: "/app",
                method: "post",
                eventType: "click",
              },
              "glossary_list_status",
            );
          }}
          loading={record.loading} // 使用每个项的 loading 状态
        />
      ),
    },
    {
      title: t("Text"),
      dataIndex: "sourceText",
      key: "sourceText",
      width: "20%",
    },
    {
      title: t("Translation text"),
      dataIndex: "targetText",
      key: "targetText",
      width: "20%",
    },
    {
      title: t("Apply for"),
      dataIndex: "language",
      key: "language",
      width: "20%",
      render: (_: any, record: any) => (
        <Text>{record.language || record.rangeCode || "-"}</Text>
      ),
    },
    {
      title: t("Case"),
      dataIndex: "type",
      key: "type",
      width: "15%",
      render: (_: any, record: any) => {
        return record.type ? (
          <Text>{t("Case-sensitive")}</Text>
        ) : (
          <Text>{t("Case-insensitive")}</Text>
        );
      },
    },
    {
      title: t("Action"),
      dataIndex: "action",
      key: "action",
      width: "15%",
      render: (_: any, record: any) => (
        <Button onClick={() => handleIsModalOpen(t("Edit rules"), record.key)}>
          {t("Edit")}
        </Button>
      ),
    },
  ];

  const rowSelection = {
    selectedRowKeys,
    onChange: (e: any) => setSelectedRowKeys(e),
  };

  const showGlossaryEmptyState = !loading && dataSource.length === 0;

  return (
    <Page>
      <AppSubpageTitleBar title={t("Glossary")} />
      <ScrollNotice
        text={t(
          "Welcome to our app! If you have any questions, feel free to email us at support@ciwi.ai, and we will respond as soon as possible.",
        )}
      />
      <Space direction="vertical" size="middle" style={{ display: "flex" }}>
        <AppPageHeader
          title={t("Glossary")}
          backAction={homeBackAction}
          description={t(
            "Create translation rules for certain words and phrases",
          )}
        />
        {showGlossaryEmptyState ? (
          <AppSectionCard
            title={t("No glossary rules yet")}
            description={t(
              "Create your first glossary rule to keep brand terms and key phrases translated consistently.",
            )}
            style={{
              textAlign: "center",
              width: "100%",
            }}
          >
            <Space direction="vertical" size="large">
              <Button
                type="primary"
                onClick={() => {
                  if (
                    planMapping[plan?.type as keyof typeof planMapping] === 0
                  ) {
                    modalShowForPlan();
                    return;
                  }
                  handleIsModalOpen("Create rule", -1);
                }}
              >
                {t("Create rule")}
              </Button>
            </Space>
          </AppSectionCard>
        ) : (
          <div className={styles.languageTable_action}>
            <Flex
              align="center"
              justify="space-between" // 使按钮左右分布
              style={{ width: "100%", marginBottom: "16px" }}
            >
              <Flex align="center" gap="middle">
                {loading ? (
                  <Skeleton.Button active />
                ) : (
                  <Button
                    onClick={handleDelete}
                    disabled={!hasSelected}
                    loading={deleteLoading}
                  >
                    {t("Delete")}
                  </Button>
                )}
                {hasSelected
                  ? `${t("Selected")}${selectedRowKeys.length}${t("items")}`
                  : null}
              </Flex>
              {planMapping[plan?.type as keyof typeof planMapping] === 0 ? (
                <div
                  style={{ display: "flex", alignItems: "center", gap: "8px" }}
                >
                  <Popconfirm
                    title=""
                    description={t(
                      "Upgrade to a paid plan to unlock this feature",
                    )}
                    trigger="hover"
                    showCancel={false}
                    okText={t("Upgrade")}
                    onConfirm={() => navigate("/app/pricing")}
                  >
                    <InfoCircleOutlined />
                  </Popconfirm>
                  <Button
                    className={defaultStyles.Button_disable}
                    onClick={modalShowForPlan}
                  >
                    {t("Create rule")}
                  </Button>
                </div>
              ) : loading ? (
                <Skeleton.Button active />
              ) : (
                <Button
                  type="primary"
                  onClick={() => handleIsModalOpen("Create rule", -1)}
                >
                  {t("Create rule")}
                </Button>
              )}
            </Flex>
            {isMobile ? (
              <>
                <Card
                  title={
                    <Checkbox
                      checked={allCurrentPageSelected && !loading}
                      indeterminate={
                        someCurrentPageSelected && !allCurrentPageSelected
                      }
                      onChange={(e) =>
                        setSelectedRowKeys(
                          e.target.checked
                            ? [
                                ...currentPageKeys,
                                ...selectedRowKeys.filter(
                                  (key) => !currentPageKeys.includes(key),
                                ),
                              ]
                            : [
                                ...selectedRowKeys.filter(
                                  (key) => !currentPageKeys.includes(key),
                                ),
                              ],
                        )
                      }
                    >
                      {t("Glossary")}
                    </Checkbox>
                  }
                  loading={loading}
                >
                  {pagedData.map((item: any) => (
                    <Card.Grid key={item.key} style={{ width: "100%" }}>
                      <Space
                        direction="vertical"
                        size="middle"
                        style={{ width: "100%" }}
                      >
                        <Flex justify="space-between">
                          <Checkbox
                            checked={selectedRowKeys.includes(item.key)}
                            onChange={(e: any) => {
                              setSelectedRowKeys(
                                e.target.checked
                                  ? [...selectedRowKeys, item.key]
                                  : selectedRowKeys.filter(
                                      (key) => key !== item.key,
                                    ),
                              );
                            }}
                          >
                            {t("Text")}{" "}
                          </Checkbox>
                          <Text>{item.sourceText}</Text>
                        </Flex>
                        <Flex justify="space-between">
                          <Text>{t("Translation text")}</Text>
                          <Text>{item.targetText}</Text>
                        </Flex>
                        <Flex justify="space-between">
                          <Text>{t("Apply for")}</Text>
                          <Text>{item.language || item.rangeCode || "-"}</Text>
                        </Flex>
                        <Flex justify="space-between">
                          <Text>{t("Case")}</Text>
                          {item.type ? (
                            <Text>{t("Case-sensitive")}</Text>
                          ) : (
                            <Text>{t("Case-insensitive")}</Text>
                          )}
                        </Flex>
                        <Flex justify="space-between">
                          <Text>{t("Status")}</Text>
                          <Switch
                            checked={item?.status}
                            onClick={() => handleApplication(item.key)}
                            loading={item.loading} // 使用每个项的 loading 状态
                          />
                        </Flex>
                        <Button
                          style={{ width: "100%" }}
                          onClick={() =>
                            handleIsModalOpen(t("Edit rules"), item.key)
                          }
                        >
                          {t("Edit")}
                        </Button>
                      </Space>
                    </Card.Grid>
                  ))}
                </Card>
                <div
                  style={{
                    display: "flex",
                    background: "#fff",
                    padding: "12px 0",
                    textAlign: "center",
                    justifyContent: "center",
                  }}
                >
                  <Pagination
                    current={currentPage}
                    pageSize={pageSize}
                    total={dataSource.length}
                    onChange={(page) => setCurrentPage(page)}
                  />
                </div>
              </>
            ) : (
              <Table
                rowSelection={rowSelection}
                columns={columns}
                loading={deleteLoading || loading}
                dataSource={dataSource}
              />
            )}
          </div>
        )}
      </Space>
      <UpdateGlossaryModal
        id={glossaryModalId}
        title={title}
        isVisible={isGlossaryModalOpen}
        setIsModalOpen={setIsGlossaryModalOpen}
        shop={globalStore?.shop || ""}
        migrated={migrated}
      />
      <Modal
        title={upgradeModalContent?.title}
        open={!!upgradeModalContent}
        onCancel={() => setUpgradeModalContent(null)}
        centered
        width={700}
        footer={
          <Space>
            <Button onClick={() => setUpgradeModalContent(null)}>
              {t("v4.quotaGate.maybeLater")}
            </Button>
            <Button type="primary" onClick={() => navigate("/app/pricing")}>
              {t("Upgrade plan")}
            </Button>
          </Space>
        }
      >
        <Text>{upgradeModalContent?.body}</Text>
      </Modal>
    </Page>
  );
};

export default Index;
