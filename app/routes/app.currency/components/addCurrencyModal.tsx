import { useEffect, useState } from "react";
import { Input, Table, Space, Typography } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { AppSModal } from "~/ui/components/AppSModal";
import SelectedTag from "../../../components/selectedTag";
import { useDispatch, useSelector } from "react-redux";
import type { CurrencyDataType, CurrencyType } from "../route";
import { updateTableData } from "~/store/modules/currencyDataTable";
import { useTranslation } from "react-i18next";
import { AddCurrencyV4 } from "~/api/currencyV4";
import {
  getTranslateV4ErrorMessage,
  TRANSLATE_V4_ERROR_KEYS,
} from "~/utils/translateV4Errors";

const { Text } = Typography;

interface AddCurrencyModalProps {
  shop: string;
  isVisible: boolean;
  setIsModalOpen: (visible: boolean) => void;
  addCurrencies: CurrencyType[];
  defaultCurrencyCode: string;
}

const AddCurrencyModal: React.FC<AddCurrencyModalProps> = ({
  isVisible,
  setIsModalOpen,
  addCurrencies,
  defaultCurrencyCode,
}) => {
  const defaultData = addCurrencies.filter(
    (item: CurrencyType) => item.currencyCode != defaultCurrencyCode,
  );
  const [allSelectedKeys, setAllSelectedKeys] = useState<React.Key[]>([]); // 保存所有选中的key
  const [searchInput, setSearchInput] = useState("");
  const [filteredCurrencies, setFilteredCurrencies] = useState<CurrencyType[]>(
    [],
  );
  const [allSelectedCurrency, setAllSelectedCurrency] = useState<
    CurrencyType[]
  >([]);
  const [addLoading, setAddLoading] = useState<boolean>(false);
  const selectedCurrency: CurrencyDataType[] = useSelector(
    (state: any) => state.currencyTableData.rows,
  );
  const selectedCurrenciesSet = new Set(
    selectedCurrency.map((cur) => cur.currencyCode),
  );
  const dispatch = useDispatch();
  const { t } = useTranslation();

  useEffect(() => {
    if (addCurrencies.length) {
      setFilteredCurrencies(defaultData);
    }
  }, [addCurrencies]);

  useEffect(() => {
    // 更新语言状态
    const updatedCurrencies = defaultData.map((cur) => {
      if (selectedCurrenciesSet.has(cur.currencyCode)) {
        // 检查是否是默认语言
        const isPrimary = cur.currencyCode === defaultCurrencyCode;

        return { ...cur, state: isPrimary ? "Primary" : "Added" }; // 根据 primary 设置状态
      }
      return { ...cur, state: "" }; // 其他语言的默认状态
    });

    // 根据状态排序
    const sortedFilteredCurrencies = updatedCurrencies.sort((a, b) => {
      const aSelected = selectedCurrenciesSet.has(a.currencyCode) ? 1 : -1; // 将已选语言放前面
      const bSelected = selectedCurrenciesSet.has(b.currencyCode) ? 1 : -1;
      return aSelected - bSelected;
    });

    // 更新过滤后的语言状态
    setFilteredCurrencies(sortedFilteredCurrencies);
  }, [selectedCurrency, isVisible]);

  useEffect(() => {
    const addedCurrencies = allSelectedKeys
      .map((key) => defaultData.find((cur) => cur.key === key))
      .filter(Boolean) as CurrencyType[];

    setAllSelectedCurrency(addedCurrencies);
  }, [allSelectedKeys]);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchInput(value);
    if (value.trim() === "") {
      // 当搜索框为空时，恢复初始排序
      const updatedCurrencies = defaultData.map((cur) => {
        const isPrimary = selectedCurrency.some(
          (sl) => sl.currencyCode === defaultCurrencyCode,
        );
        const state = selectedCurrenciesSet.has(cur.currencyCode)
          ? isPrimary
            ? "Primary"
            : "Added"
          : ""; // 更新语言状态
        return { ...cur, state };
      });

      const sortedFilteredCurrencies = updatedCurrencies.sort((a, b) => {
        const aSelected = selectedCurrenciesSet.has(a.currencyCode) ? 1 : -1;
        const bSelected = selectedCurrenciesSet.has(b.currencyCode) ? 1 : -1;
        return aSelected - bSelected;
      });

      setFilteredCurrencies(sortedFilteredCurrencies);
      return;
    }
    const filteredData = defaultData
      .map((cur) => {
        const isPrimary = selectedCurrenciesSet.has(cur.currencyCode);
        return {
          ...cur,
          state: isPrimary
            ? cur.currencyCode === defaultCurrencyCode
              ? "Primary"
              : "Added"
            : "",
        };
      })
      .filter(
        (cur) =>
          cur.currencyName.toLowerCase().includes(value.toLowerCase()) ||
          cur.currencyCode.toLowerCase().includes(value.toLowerCase()),
      );

    setFilteredCurrencies(filteredData);
  };

  const handleRowSelectionChange = (
    newSelectedRowKeys: React.Key[],
    e: CurrencyType[],
  ) => {
    const addKeys = [...new Set([...allSelectedKeys, ...newSelectedRowKeys])];
    const removedKeys = filteredCurrencies
      .filter((cur) => !e.includes(cur))
      .map((cur) => cur.key);
    const updateKeys = addKeys.filter(
      (item) => !removedKeys.includes(Number(item)),
    );

    setAllSelectedKeys(updateKeys);
  };

  // 确认选择 -> 触发 action
  const handleConfirm = async () => {
    setAddLoading(true);
    const promises = allSelectedCurrency.map((currency: any) =>
      AddCurrencyV4({
        currencyName: currency.currencyName,
        currencyCode: currency.currencyCode,
        primaryStatus: currency?.primaryStatus || 0,
      }),
    );
    const data = await Promise.allSettled(promises);
    if (data?.length) {
      let hasSuccess = false;
      const failedMessages: string[] = [];

      data.forEach((res: any) => {
        if (res?.status === "fulfilled" && res?.value?.success) {
          hasSuccess = true;
          const data = [
            {
              key: res.value.response.id, // 将 id 转换为 key
              currency: res.value.response.currencyName, // 将 currencyName 作为 currencyName
              rounding: res.value.response.rounding,
              exchangeRate: res.value.response.exchangeRate,
              currencyCode: res.value.response.currencyCode,
              primaryStatus: res.value.response.primaryStatus,
            },
          ];
          dispatch(updateTableData(data));
        } else {
          const errorMsg =
            res?.status === "fulfilled"
              ? getTranslateV4ErrorMessage(
                  t,
                  res?.value?.errorMsg,
                  TRANSLATE_V4_ERROR_KEYS.INTERNAL_ERROR,
                )
              : getTranslateV4ErrorMessage(
                  t,
                  TRANSLATE_V4_ERROR_KEYS.INTERNAL_ERROR,
                );
          failedMessages.push(errorMsg);
        }
      });

      if (hasSuccess) {
        shopify.toast.show(t("Add success"));
        setFilteredCurrencies(defaultData);
        setAllSelectedKeys([]);
        setSearchInput("");
        setAllSelectedCurrency([]);
        setIsModalOpen(false);
      }

      failedMessages.forEach((message) => shopify.toast.show(message));
    } else {
      shopify.toast.show(
        getTranslateV4ErrorMessage(t, TRANSLATE_V4_ERROR_KEYS.INTERNAL_ERROR),
      );
    }
    setAddLoading(false);
  };

  const handleCloseModal = () => {
    setAllSelectedKeys([]);
    setSearchInput("");
    setFilteredCurrencies(defaultData);
    setAllSelectedCurrency([]);
    setIsModalOpen(false);
  };

  const handleRemoveCurrency = (key: React.Key) => {
    setAllSelectedKeys((prevKeys) =>
      prevKeys.filter((selectedKey) => selectedKey !== key),
    );
    setAllSelectedCurrency((prevCurrencies) =>
      prevCurrencies.filter((cur) => cur.key !== key),
    );
  };

  // 表格的行选择配置
  const rowSelection = {
    selectedRowKeys: allSelectedKeys.filter((key) =>
      defaultData.some((cur) => cur.key === key),
    ), // Filter selected keys based on current filtered languages
    onChange: handleRowSelectionChange,
    getCheckboxProps: (record: any) => ({
      disabled: selectedCurrenciesSet.has(record.currencyCode), // Disable checkbox if the language is already selected
    }),
  };

  const columns = [
    {
      title: t("Currency"),
      dataIndex: "currencyName",
      key: "currencyName",
      width: "60%",
      render: (_: any, record: any) => {
        return (
          <Text>
            {record.currencyName}({record.currencyCode})
          </Text>
        );
      },
    },
    {
      title: t("Relevant region(s)"),
      dataIndex: "src",
      key: "src",
      width: "20%",
      render: (_: any, record: any) => {
        return (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "left",
              alignItems: "left",
              gap: "10px",
            }}
          >
            {record.locale && (
              <img
                key={record.currencyCode} // 为每个 img 标签添加唯一的 key 属性
                src={record.locale}
                alt={`${record.currencyName} flag`}
                style={{
                  width: "30px",
                  height: "auto",
                  border: "1px solid #888",
                  borderRadius: "2px",
                }}
              />
            )}
          </div>
        );
      },
    },
    {
      title: t("Status"),
      dataIndex: "state",
      key: "state",
      width: "20%",
    },
  ];

  return (
    <AppSModal
      open={isVisible}
      heading={t("Select Currencies")}
      onClose={handleCloseModal}
      size="large"
      primaryAction={{
        content: t("Add"),
        onAction: () => void handleConfirm(),
        disabled: allSelectedKeys.length === 0,
        loading: addLoading,
      }}
      secondaryActions={[
        {
          content: t("Cancel"),
          onAction: handleCloseModal,
        },
      ]}
    >
      <Input
        placeholder={t("Search currencies...")}
        prefix={<SearchOutlined />}
        value={searchInput}
        onChange={handleSearch}
        style={{ marginBottom: 16 }}
      />

      <Space wrap style={{ marginBottom: 16 }}>
        {allSelectedKeys.map((key) => {
          const currency = defaultData.find(
            (cur) => cur.key === key,
          )?.currencyName;
          return (
            <SelectedTag
              key={key}
              item={currency!}
              onRemove={() => handleRemoveCurrency(key)}
            />
          );
        })}
      </Space>
      <Table
        rowSelection={rowSelection}
        dataSource={filteredCurrencies}
        loading={addLoading}
        columns={columns}
        rowKey="key"
        pagination={{
          pageSize: 10,
          position: ["bottomCenter"],
          showSizeChanger: false,
        }}
      />
    </AppSModal>
  );
};

export default AddCurrencyModal;
