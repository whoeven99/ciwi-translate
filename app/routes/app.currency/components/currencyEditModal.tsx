import { useEffect, useMemo, useState } from "react";
import { Alert, InputNumber, Space, Typography } from "antd";
import { Select as PolarisSelect } from "@shopify/polaris";
import { AppSModal } from "~/ui/components/AppSModal";
import { useFetcher } from "@remix-run/react";
import { CurrencyDataType } from "../route";
import { useDispatch, useSelector } from "react-redux";
import { updateTableData } from "~/store/modules/currencyDataTable";
import { useTranslation } from "react-i18next";
import { ExclamationCircleOutlined } from "@ant-design/icons";
import {
  getTranslateV4ErrorMessage,
  TRANSLATE_V4_ERROR_KEYS,
} from "~/utils/translateV4Errors";
import { useConsumableFetcherData } from "~/hooks/useConsumableFetcherData";

const { Title, Text } = Typography;

interface CurrencyEditModalProps {
  isVisible: boolean;
  setIsModalOpen: (visible: boolean) => void;
  selectedRow: CurrencyDataType | undefined;
  defaultCurrencyCode: string;
}

const CurrencyEditModal: React.FC<CurrencyEditModalProps> = ({
  isVisible,
  setIsModalOpen,
  selectedRow,
  defaultCurrencyCode,
}) => {
  const dispatch = useDispatch();
  const { t } = useTranslation();

  const exRateColumns = useMemo(
    () => [
      { value: "Auto", label: t("Auto") },
      { value: "Manual Rate", label: t("Manual Rate") },
    ],
    [t],
  );
  const roundingColumns = useMemo(
    () => [
      { value: "", label: t("Disable") },
      { value: "0", label: t("No decimal") },
      { value: "1.00", label: `1.00 (${t("Recommend")})` },
      { value: "0.99", label: "0.99" },
      { value: "0.95", label: "0.95" },
      { value: "0.75", label: "0.75" },
      { value: "0.5", label: "0.50" },
      { value: "0.25", label: "0.25" },
    ],
    [t],
  );

  const [exRateSelectValue, setExRateSelectValue] = useState<string>();
  const [roundingSelectValue, setRoundingSelectValue] = useState<string>();
  const [exRateValue, setExRateValue] = useState<number>(0);
  const [updateFetcherLoading, setUpdateFetcherLoading] =
    useState<boolean>(false);
  const [saveButtonDisable, setSaveButtonDisable] = useState<boolean>(true);
  const [exRateError, setExRateError] = useState<boolean>(false);
  const [exRateErrorMsg, setExRateErrorMsg] = useState<string>("");
  const [exRateStatus, setExRateStatus] = useState<"warning" | "error" | "">(
    "",
  );
  const [modalError, setModalError] = useState<string>("");

  const updateFetcher = useFetcher<any>();
  const dataSource = useSelector((state: any) => state.currencyTableData.rows);
  const title = `${t("Edit")} ${selectedRow?.currency}`;
  const { consume: consumeUpdateResponse, reset: resetUpdateResponse } =
    useConsumableFetcherData<any>();

  useEffect(() => {
    const data = consumeUpdateResponse(updateFetcher.data);
    if (data) {
      if (data?.success) {
        const newData = data.response;
        const oldData: CurrencyDataType = dataSource.find(
          (row: CurrencyDataType) => row.key === newData.id,
        );
        const updatedRows: CurrencyDataType[] = [
          {
            key: oldData.key,
            currency: oldData.currency,
            currencyCode: oldData.currencyCode,
            rounding: newData.rounding,
            exchangeRate: newData.exchangeRate,
          },
        ];
        dispatch(updateTableData(updatedRows));
        shopify.toast.show(t("Saved successfully"));
        setIsModalOpen(false);
        setUpdateFetcherLoading(false);
        setExRateSelectValue(undefined);
        setRoundingSelectValue(undefined);
        setExRateValue(0);
        setModalError("");
      } else {
        const errorMsg = getTranslateV4ErrorMessage(
          t,
          data?.errorMsg,
          TRANSLATE_V4_ERROR_KEYS.CURRENCY_UPDATE_FAILED,
        );
        setExRateError(true);
        setExRateErrorMsg(errorMsg);
        setExRateStatus("error");
        setUpdateFetcherLoading(false);
        setModalError(errorMsg);
      }
    }
  }, [
    consumeUpdateResponse,
    dataSource,
    dispatch,
    setIsModalOpen,
    t,
    updateFetcher.data,
  ]);

  useEffect(() => {
    if (selectedRow?.exchangeRate === "Auto") {
      setExRateSelectValue("Auto");
    } else {
      setExRateSelectValue("Manual Rate");
      if (
        selectedRow?.exchangeRate !== null &&
        typeof Number(selectedRow?.exchangeRate) === "number"
      ) {
        setExRateValue(Number(selectedRow?.exchangeRate));
      }
    }
    setRoundingSelectValue(selectedRow?.rounding);
  }, [isVisible]);

  useEffect(() => {
    if (isVisible) {
      if (
        exRateSelectValue === "Manual Rate" &&
        (Number.isNaN(exRateValue) || exRateValue === null)
      ) {
        setSaveButtonDisable(true);
      } else if (
        (exRateSelectValue === "Manual Rate" &&
          !Number.isNaN(exRateValue) &&
          exRateValue !== null &&
          saveButtonDisable === true) ||
        (exRateSelectValue === "Auto" && saveButtonDisable === true)
      ) {
        setSaveButtonDisable(false);
      }
      setExRateStatus("");
    }
  }, [exRateSelectValue, exRateValue, isVisible]);

  const handleConfirm = () => {
    resetUpdateResponse();
    setUpdateFetcherLoading(true);
    setModalError("");
    if (exRateSelectValue === "Auto") {
      updateFetcher.submit(
        {
          updateCurrencies: JSON.stringify({
            id: selectedRow?.key,
            rounding: roundingSelectValue,
            exchangeRate: "Auto",
          }),
        },
        {
          method: "post",
          action: "/app/currency",
        },
      ); // 提交表单请求
    } else if (exRateSelectValue === "Manual Rate") {
      if (exRateValue > 2147483647) {
        setExRateError(true);
        setExRateErrorMsg(t("Exchange rate must be less than 2147483647"));
        setExRateStatus("error");
        setUpdateFetcherLoading(false);
        return;
      }

      if (exRateValue < 0 || typeof exRateValue !== "number") {
        setExRateError(true);
        setExRateErrorMsg(t("Exchange rate must be a positive number"));
        setExRateStatus("error");
        setUpdateFetcherLoading(false);
        return;
      }
      setExRateError(false);
      setExRateErrorMsg("");
      setModalError("");

      updateFetcher.submit(
        {
          updateCurrencies: JSON.stringify({
            id: selectedRow?.key,
            rounding: roundingSelectValue,
            exchangeRate: exRateValue,
          }),
        },
        {
          method: "post",
          action: "/app/currency",
        },
      ); // 提交表单请求
    }
  };

  const handleCloseModal = () => {
    setIsModalOpen(false); // 关闭Modal
    setExRateSelectValue(undefined);
    setRoundingSelectValue(undefined);
    setExRateError(false);
    setExRateErrorMsg("");
    setExRateStatus("");
    setExRateValue(0);
    setUpdateFetcherLoading(false);
    setModalError("");
  };

  const handleExRateSelectChange = (value: string) => {
    setModalError("");
    setExRateSelectValue(value);
  };

  const handleRoundingSelectChange = (value: string) => {
    setModalError("");
    setRoundingSelectValue(value);
  };

  return (
    <AppSModal
      open={isVisible}
      heading={title}
      onClose={handleCloseModal}
      size="base"
      primaryAction={{
        content: t("Save"),
        onAction: handleConfirm,
        disabled: saveButtonDisable || updateFetcherLoading,
        loading: updateFetcherLoading,
      }}
      secondaryActions={[
        {
          content: t("Cancel"),
          onAction: handleCloseModal,
        },
      ]}
    >
      <Space direction="vertical" size="middle" style={{ display: "flex" }}>
        {modalError ? (
          <Alert
            type="error"
            showIcon
            message={modalError}
            closable
            onClose={() => setModalError("")}
          />
        ) : null}
        <div>
          <Title level={5}>{t("Exchange rate")}</Title>
          <PolarisSelect
            label={t("Exchange rate")}
            labelHidden
            options={exRateColumns}
            value={exRateSelectValue ?? ""}
            onChange={handleExRateSelectChange}
          />
          {exRateSelectValue === "Auto" && (
            <div style={{ marginBottom: "8px" }}>
              {selectedRow?.currency}
              {t("will fluctuate based on market rates.")}.
            </div>
          )}
        </div>
        {exRateSelectValue !== "Auto" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Text>1 {defaultCurrencyCode} =</Text>
              <InputNumber
                placeholder={t("Please enter Exchange rate")}
                value={exRateValue}
                style={{ width: 120 }}
                onChange={(e) => {
                  setModalError("");
                  setExRateValue(e || 0);
                }}
                status={exRateStatus}
              />
              <Text>{selectedRow?.currencyCode}</Text>
            </div>
            {/* 错误提示放在下方，并且与输入框左对齐 */}
            <div
              style={{
                marginLeft: "60px", // 80px(标签宽度) + 8px(间距)
                visibility: exRateError ? "visible" : "hidden",
              }}
            >
              <Text type="danger">
                <ExclamationCircleOutlined style={{ marginRight: "4px" }} />
                {t(exRateErrorMsg)}
              </Text>
            </div>
          </div>
        )}
      </Space>
      <div>
        <Title level={5}>{t("Rounding")}</Title>
        <PolarisSelect
          label={t("Rounding")}
          labelHidden
          options={roundingColumns}
          value={roundingSelectValue ?? ""}
          onChange={handleRoundingSelectChange}
        />
      </div>
    </AppSModal>
  );
};

export default CurrencyEditModal;
