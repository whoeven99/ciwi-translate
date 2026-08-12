import { Page } from "@shopify/polaris";
import { useEffect, useMemo, useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import {
  Alert,
  Card,
  Checkbox,
  Flex,
  Pagination,
  Select,
  Skeleton,
  Space,
  Table,
  Typography,
} from "antd";
import Button from "~/ui/components/AppButton";
import { useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import { useTranslation } from "react-i18next";
import {
  getTranslateV4ErrorMessage,
  TRANSLATE_V4_ERROR_KEYS,
} from "~/utils/translateV4Errors";
import { globalStore } from "~/globalStore";
import {
  deleteLiquidCompat,
  selectLiquidCompat,
  toggleLiquidReplacementMethodCompat,
  type LiquidTableRow,
} from "./liquidClient";
import UpdateCustomTransModal from "./components/updateCustomTransModal";
const { Text } = Typography;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const isMobile = request.headers.get("user-agent")?.includes("Mobile");
  return {
    mobile: isMobile as boolean,
  };
};

const Index = () => {
  const { mobile } = useLoaderData<typeof loader>();
  const migrated = true;

  const { t } = useTranslation();
  const navigate = useNavigate();

  //加载状态数组，目前loading表示页面正在加载
  const [loadingArray, setLoadingArray] = useState<string[]>(["loading"]);

  //移动端判断依据
  const [isMobile, setIsMobile] = useState<boolean>(mobile);

  //表格数据源
  const [dataSource, setDataSource] = useState<LiquidTableRow[]>([]);

  //表格多选控制key
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [pageAlert, setPageAlert] = useState<string>("");

  //编辑表单类型及数据控制
  const [createOrEditModal, setCreateOrEditModal] = useState<{
    open: boolean;
    type: "create" | "edit";
    key: string;
  }>({
    open: false,
    type: "create",
    key: "",
  });

  //编辑表单数据源
  const editData = useMemo(() => {
    return dataSource.find((item) => item.key == createOrEditModal.key);
  }, [dataSource, createOrEditModal.key]);

  const hasSelected = useMemo(() => {
    return selectedRowKeys.length > 0;
  }, [selectedRowKeys]);

  //页面管理数据
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

  useEffect(() => {
    fetcher.submit(
      {
        log: `${globalStore?.shop} 目前在自定义翻译页面`,
      },
      {
        method: "POST",
        action: "/log",
      },
    );

    //表格数据初始化方法
    setTimeout(async () => {
      const selectShopNameLiquidData = await selectLiquidCompat({
        migrated,
        shop: globalStore?.shop || "",
      });

      if (selectShopNameLiquidData.success) {
        setDataSource(selectShopNameLiquidData.response ?? []);
        setLoadingArray((prev) => prev.filter((item) => item !== "loading"));
        setPageAlert("");
      } else {
        setPageAlert(
          getTranslateV4ErrorMessage(
            t,
            selectShopNameLiquidData.errorMsg,
            TRANSLATE_V4_ERROR_KEYS.LIQUID_LIST_FAILED,
          ),
        );
        setLoadingArray((prev) => prev.filter((item) => item !== "loading"));
      }
    }, 100);

    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [migrated]);

  //表格数据删除方法
  const handleDelete = async () => {
    setPageAlert("");
    const data = await deleteLiquidCompat({
      migrated,
      shop: globalStore?.shop || "",
      ids: selectedRowKeys,
    });
    if (data.success) {
      const deletedIds = (data.response ?? []).map(String);
      const newData = dataSource.filter(
        (prev) => !deletedIds.includes(prev.key),
      );
      setDataSource(newData);
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
    setSelectedRowKeys([]);
  };

  //表格列管理
  const columns = [
    {
      title: t("Text"),
      dataIndex: "sourceText",
      key: "sourceText",
      width: "22%",
    },
    {
      title: t("Translation text"),
      dataIndex: "targetText",
      key: "targetText",
      width: "22%",
    },
    {
      title: t("Apply for"),
      dataIndex: "languageCode",
      key: "languageCode",
      width: "12%",
    },
    {
      title: t("Status"),
      dataIndex: "status",
      key: "status",
      width: "10%",
      render: (status: string) => status || "DONE",
    },
    {
      title: t("Source"),
      dataIndex: "source",
      key: "source",
      width: "10%",
      render: (source: string) => source || "manual",
    },
    {
      title: t("Replacement method"),
      dataIndex: "languageCode",
      key: "replacementMethod",
      width: "14%",
      render: (_: any, record: any) => {
        return (
          <Select
            options={[
              {
                label: t("Precise replacement"),
                value: true,
              },
              {
                label: t("Fuzzy Replacement"),
                value: false,
              },
            ]}
            style={{ width: "100%" }}
            onChange={() => {
              handleSwitchReplaceMethod({
                id: record?.key,
              });
            }}
            value={record.replacementMethod}
          />
        );
      },
    },
    {
      title: t("Action"),
      dataIndex: "action",
      key: "action",
      width: "10%",
      render: (_: any, record: any) => (
        <Button
          onClick={() =>
            setCreateOrEditModal({
              open: true,
              type: "edit",
              key: record.key,
            })
          }
        >
          {t("Edit")}
        </Button>
      ),
    },
  ];

  //表格行管理
  const rowSelection = {
    selectedRowKeys,
    onChange: (e: any) => setSelectedRowKeys(e),
  };

  //编辑替换方式
  const handleSwitchReplaceMethod = async ({ id }: { id: string }) => {
    setPageAlert("");
    const updateLiquidReplacementMethod =
      await toggleLiquidReplacementMethodCompat({
        migrated,
        shop: globalStore?.shop || "",
        id,
      });
    if (updateLiquidReplacementMethod?.success) {
      const newData = dataSource.map((item) =>
        item.key === id
          ? {
              ...item,
              replacementMethod: !!updateLiquidReplacementMethod?.response,
            }
          : item,
      );
      setDataSource(newData);
    } else {
      setPageAlert(
        getTranslateV4ErrorMessage(
          t,
          updateLiquidReplacementMethod?.errorMsg,
          TRANSLATE_V4_ERROR_KEYS.LIQUID_SAVE_FAILED,
        ),
      );
    }
  };

  //编辑表单数据更新和提交后更新表格方法
  const handleUpdateDataSource = ({
    key,
    sourceText,
    targetText,
    replacementMethod,
    languageCode,
  }: LiquidTableRow & { key?: string }) => {
    setDataSource((prev) => {
      // 查找是否已有该项
      const index =
        key !== undefined ? prev.findIndex((item) => item.key === key) : -1;

      if (index !== -1) {
        // ✅ 更新已有项
        const updated = [...prev];
        updated[index] = {
          ...updated[index],
          sourceText,
          targetText,
          replacementMethod,
          languageCode,
          status: "DONE",
        };
        return updated;
      } else {
        // ✅ 新增到数组最前面
        const newItem: LiquidTableRow = {
          key: key || "",
          sourceText,
          targetText,
          replacementMethod,
          languageCode,
          source: "manual",
          status: "DONE",
        };
        return [newItem, ...prev];
      }
    });
  };

  const onCancel = () => {
    navigate(`/app/manage_translation`); // 跳转到 /app/manage_translation
  };

  return (
    <Page
      title={t("Custom Liquid")}
      backAction={{
        onAction: onCancel,
      }}
    >
      <Space
        direction="vertical"
        size="middle"
        style={{ display: "flex", width: "100%" }}
      >
        {pageAlert ? (
          <Alert
            type="error"
            showIcon
            message={pageAlert}
            closable
            onClose={() => setPageAlert("")}
          />
        ) : null}
        <Flex
          align="center"
          justify="space-between" // 使按钮左右分布
          style={{ width: "100%" }}
        >
          <Flex align="center" gap="middle">
            {loadingArray.includes("loading") ? (
              <Skeleton.Button active />
            ) : (
              <Button onClick={handleDelete} disabled={!hasSelected}>
                {t("Delete")}
              </Button>
            )}
            {hasSelected
              ? `${t("Selected")} ${selectedRowKeys.length} ${t("items")}`
              : null}
          </Flex>
          {loadingArray.includes("loading") ? (
            <Skeleton.Button active />
          ) : (
            <Button
              type="primary"
              onClick={() =>
                setCreateOrEditModal({
                  open: true,
                  type: "create",
                  key: "",
                })
              }
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
                  checked={
                    allCurrentPageSelected && !loadingArray.includes("loading")
                  }
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
                  {t("Custom Liquid")}
                </Checkbox>
              }
              loading={loadingArray.includes("loading")}
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
                      <Text>{item.languageCode}</Text>
                    </Flex>
                    <Flex justify="space-between">
                      <Text>{t("Apply for")}</Text>
                      <Text>
                        {t(
                          item.replacementMethod
                            ? "Precise replacement"
                            : "Fuzzy Replacement",
                        )}
                      </Text>
                    </Flex>
                    <Button
                      style={{ width: "100%" }}
                      onClick={() =>
                        setCreateOrEditModal({
                          open: true,
                          type: "edit",
                          key: item.key,
                        })
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
            loading={loadingArray.includes("loading")}
            dataSource={dataSource}
          />
        )}
      </Space>
      <UpdateCustomTransModal
        migrated={migrated}
        dataSource={dataSource}
        handleUpdateDataSource={handleUpdateDataSource}
        defaultData={editData}
        open={createOrEditModal.open}
        title={t(
          createOrEditModal.type == "create" ? "Create rule" : "Edit rule",
        )}
        setIsModalHide={() =>
          setCreateOrEditModal({
            ...createOrEditModal,
            open: false,
          })
        }
      ></UpdateCustomTransModal>
    </Page>
  );
};

export default Index;
