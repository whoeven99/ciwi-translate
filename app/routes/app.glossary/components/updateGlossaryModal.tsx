import { useEffect, useMemo, useState } from "react";
import { Input, Space, Typography, Checkbox, Alert } from "antd";
import { Select as PolarisSelect } from "@shopify/polaris";
import { AppSModal } from "~/ui/components/AppSModal";
import Button from "~/ui/components/AppButton";
import { useFetcher, useNavigate } from "@remix-run/react";
import { useDispatch, useSelector } from "react-redux";
import { ShopLocalesType } from "~/routes/app.language/route";
import { planMapping } from "../route";
import { updateGLossaryTableData } from "~/store/modules/glossaryTableData";
import { useTranslation } from "react-i18next";
import { ExclamationCircleOutlined } from "@ant-design/icons";
import { insertGlossaryCompat, updateGlossaryCompat } from "../glossaryClient";
import {
  getTranslateV4ErrorMessage,
  TRANSLATE_V4_ERROR_KEYS,
} from "~/utils/translateV4Errors";

const { Text } = Typography;

interface GlossaryModalProps {
  id: number;
  title: string;
  isVisible: boolean;
  setIsModalOpen: (visible: boolean) => void;
  shop: string;
  migrated: boolean;
}

const UpdateGlossaryModal: React.FC<GlossaryModalProps> = ({
  id,
  title,
  isVisible,
  setIsModalOpen,
  shop,
  migrated,
}) => {
  const [sourceText, setSourceText] = useState<string>("");
  const [targetText, setTargetText] = useState<string>("");
  const [rangeCode, setRangeCode] = useState<string>("");
  const [checked, setChecked] = useState(false);
  const [shopLocales, setShopLocales] = useState<ShopLocalesType[]>([]);
  const [localeLoadError, setLocaleLoadError] = useState<string>("");
  const [confirmButtonDisable, setConfirmButtonDisable] =
    useState<boolean>(false);
  const [sourceTextError, setSourceTextError] = useState<boolean>(false);
  const [targetTextError, setTargetTextError] = useState<boolean>(false);
  const [rangeCodeError, setRangeCodeError] = useState<boolean>(false);
  const [sourceTextStatus, setSourceTextStatus] = useState<
    "" | "warning" | "error"
  >("");
  const [targetTextStatus, setTargetTextStatus] = useState<
    "" | "warning" | "error"
  >("");
  const [rangeCodeStatus, setRangeCodeStatus] = useState<
    "" | "warning" | "error"
  >("");
  const [sourceTextErrorMsg, setSourceTextErrorMsg] = useState<string>("");
  const [targetTextErrorMsg, setTargetTextErrorMsg] = useState<string>("");
  const [rangeCodeErrorMsg, setRangeCodeErrorMsg] = useState<string>("");
  const [modalAlert, setModalAlert] = useState<{
    type: "warning" | "error";
    message: string;
  } | null>(null);

  const dispatch = useDispatch();
  const { t } = useTranslation();
  const localesFetcher = useFetcher<any>();
  const navigate = useNavigate();
  const dataSource = useSelector((state: any) => state.glossaryTableData.rows);
  const { plan } = useSelector((state: any) => state.userConfig);
  const currentItem = useMemo(
    () => dataSource.find((item: any) => item.key === id),
    [dataSource, id],
  );
  const isCreateMode = id === -1;
  const localeOptions = useMemo(() => {
    const nextOptions = [
      {
        value: "ALL",
        label: "All languages",
      },
      ...shopLocales.map((shopLocale: ShopLocalesType) => ({
        value: shopLocale.locale,
        label: shopLocale.name,
      })),
    ];
    if (
      rangeCode &&
      !nextOptions.find((option) => option.value === rangeCode)
    ) {
      nextOptions.push({
        value: rangeCode,
        label: rangeCode,
      });
    }
    return nextOptions;
  }, [rangeCode, shopLocales]);
  const localesLoading =
    localesFetcher.state !== "idle" && localesFetcher.formData != null;

  useEffect(() => {
    if (!isVisible) return;
    if (currentItem) {
      setSourceText(currentItem.sourceText);
      setTargetText(currentItem.targetText);
      setRangeCode(currentItem.rangeCode || "ALL");
      setChecked(currentItem.type);
    } else {
      setSourceText("");
      setTargetText("");
      setRangeCode("ALL");
      setChecked(false);
    }
    setShopLocales([]);
    setLocaleLoadError("");
    setModalAlert(null);
    localesFetcher.submit(
      { loadLocales: JSON.stringify(true) },
      { method: "POST", action: "/app/glossary" },
    );
  }, [currentItem, isVisible]);

  useEffect(() => {
    if (!localesFetcher.data) return;
    if (localesFetcher.data.success) {
      setShopLocales(localesFetcher.data.response?.shopLocales || []);
      setLocaleLoadError("");
      return;
    }
    setShopLocales([]);
    setLocaleLoadError(
      getTranslateV4ErrorMessage(
        t,
        localesFetcher.data?.errorMsg,
        TRANSLATE_V4_ERROR_KEYS.TARGET_LOCALE_LIST_FAILED,
      ),
    );
  }, [localesFetcher.data, t]);

  const mapLanguageLabel = (locale: string) => {
    if (locale === "ALL") return "All Languages";
    return (
      shopLocales.find((language: ShopLocalesType) => language.locale === locale)
        ?.name || locale
    );
  };

  const handleConfirm = async (id: number) => {
    let isValid = true;
    let isOversizeError = true;
    let isSameRuleError = true;
    // Reset status
    // Validate fields
    if (!sourceText) {
      setSourceTextStatus("error");
      setSourceTextError(true);
      setSourceTextErrorMsg(t("Please enter original text"));
      setModalAlert(null);
      isValid = false;
    }
    if (!targetText) {
      setTargetTextStatus("error");
      setTargetTextError(true);
      setTargetTextErrorMsg(t("Please enter escaped text"));
      setModalAlert(null);
      isValid = false;
    }
    if (
      !rangeCode ||
      !localeOptions.find((option) => option.value === rangeCode)
    ) {
      setRangeCodeStatus("error");
      setRangeCodeError(true);
      setRangeCodeErrorMsg(t("Please select a language"));
      setModalAlert(null);
      isValid = false;
    }
    if (isCreateMode && !localesLoading && shopLocales.length === 0) {
      setModalAlert({
        type: "warning",
        message: t("Add a target language before creating a glossary rule."),
      });
      return;
    }

    if (
      isCreateMode &&
      dataSource.length >= planMapping[plan?.type as keyof typeof planMapping]
    ) {
      isOversizeError = false;
    }

    const source = sourceText + rangeCode;
    dataSource.map((item: any) => {
      const string = item.sourceText + item.rangeCode;
      if (isCreateMode) {
        if (
          source == string ||
          ((item.rangeCode == "ALL" || rangeCode == "ALL") &&
            sourceText == item.sourceText)
        ) {
          isSameRuleError = false;
        }
      } else {
        if (
          (source == string ||
            ((item.rangeCode == "ALL" || rangeCode == "ALL") &&
              sourceText == item.sourceText)) &&
          item.key !== id
        ) {
          isSameRuleError = false;
        }
      }
    });

    if (isValid && isSameRuleError && isOversizeError) {
      setConfirmButtonDisable(true);
      setModalAlert(null);
      setSourceTextStatus("");
      setSourceTextError(false);
      setSourceTextErrorMsg("");
      setTargetTextStatus("");
      setTargetTextError(false);
      setTargetTextErrorMsg("");
      setRangeCodeStatus("");
      setRangeCodeError(false);
      setRangeCodeErrorMsg("");

      try {
        let data;
        if (currentItem) {
          data = await updateGlossaryCompat({
            migrated,
            shop: shop,
            data: {
              key: id,
              sourceText: sourceText,
              targetText: targetText,
              rangeCode: rangeCode,
              type: checked ? 1 : 0,
              status: currentItem?.status,
            },
          });
        } else {
          data = await insertGlossaryCompat({
            migrated,
            shop: shop,
            sourceText: sourceText,
            targetText: targetText,
            rangeCode: rangeCode,
            type: checked ? 1 : 0,
          });
        }

        if (data.success) {
          let res = data.response;
          res = {
            key: res?.id,
            sourceText: res?.sourceText,
            targetText: res?.targetText,
            language: mapLanguageLabel(res?.rangeCode),
            rangeCode: res?.rangeCode,
            type: res?.caseSensitive,
            status: res?.status,
            loading: false,
            createdDate: res?.createdDate,
          };
          dispatch(updateGLossaryTableData(res));
          shopify.toast.show(t("Saved successfully"));
          setConfirmButtonDisable(false);
          handleCloseModal();
        } else {
          const errorMsg = getTranslateV4ErrorMessage(
            t,
            data.errorMsg,
            TRANSLATE_V4_ERROR_KEYS.GLOSSARY_SAVE_FAILED,
          );
          setModalAlert({ type: "error", message: errorMsg });
          setConfirmButtonDisable(false);
        }
      } catch {
        setModalAlert({
          type: "error",
          message: getTranslateV4ErrorMessage(
            t,
            TRANSLATE_V4_ERROR_KEYS.GLOSSARY_SAVE_FAILED,
          ),
        });
        setConfirmButtonDisable(false);
      }
    } else if (!isOversizeError) {
      setModalAlert({
        type: "warning",
        message: t("You can add up to {{count}} translation rules", {
          count: planMapping[plan?.type as keyof typeof planMapping] ?? 10,
        }),
      });
      return;
    } else if (!isSameRuleError) {
      setModalAlert({
        type: "warning",
        message: t("You cannot add two conflicting rules."),
      });
      return;
    }
  };

  const handleCloseModal = () => {
    setSourceText("");
    setTargetText("");
    setRangeCode("");
    setShopLocales([]);
    setLocaleLoadError("");
    setChecked(false);
    setIsModalOpen(false);
    setConfirmButtonDisable(false);
    setSourceTextStatus("");
    setTargetTextStatus("");
    setRangeCodeStatus("");
    setSourceTextError(false);
    setTargetTextError(false);
    setRangeCodeError(false);
    setSourceTextErrorMsg("");
    setTargetTextErrorMsg("");
    setRangeCodeErrorMsg("");
    setModalAlert(null);
  };

  return (
    <AppSModal
      open={isVisible}
      heading={title}
      onClose={handleCloseModal}
      size="base"
      primaryAction={{
        content: t("Save"),
        onAction: () => void handleConfirm(id),
        disabled: confirmButtonDisable,
        loading: confirmButtonDisable,
      }}
      secondaryActions={[
        {
          content: t("Cancel"),
          onAction: handleCloseModal,
        },
      ]}
    >
      <Space direction="vertical" size="middle" style={{ display: "flex" }}>
        {modalAlert ? (
          <Alert
            type={modalAlert.type}
            showIcon
            message={modalAlert.message}
            closable
            onClose={() => setModalAlert(null)}
          />
        ) : null}
        {localeLoadError ? (
          <Alert
            type="warning"
            showIcon
            message={localeLoadError}
            closable
            onClose={() => setLocaleLoadError("")}
          />
        ) : null}
        <Text>{t("Keep translation consistent across your store")}</Text>
        <Space direction="vertical" size="small" style={{ display: "flex" }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              width: "100%",
            }}
          >
            <Input
              placeholder={t("Please enter original text")}
              value={sourceText}
              onChange={(e) => {
                setModalAlert(null);
                setSourceText(e.target.value);
              }}
              status={sourceTextStatus}
            />
            {sourceTextError && (
              <Text type="danger" style={{ marginTop: 2, color: "#8E0A21" }}>
                <ExclamationCircleOutlined
                  style={{
                    display: sourceTextError ? "inline-block" : "none",
                    marginRight: "4px",
                  }}
                />
                {sourceTextErrorMsg}
              </Text>
            )}
          </div>
          <Text
            type="secondary"
            style={{
              display: "block",
              width: "100%",
              textAlign: "center",
              whiteSpace: "nowrap",
            }}
          >
            {t("to")}
          </Text>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              width: "100%",
            }}
          >
            <Input
              placeholder={t("Please enter escaped text")}
              value={targetText}
              onChange={(e) => {
                setModalAlert(null);
                setTargetText(e.target.value);
              }}
              status={targetTextStatus}
            />
            {targetTextError && (
              <Text type="danger" style={{ marginTop: 2, color: "#8E0A21" }}>
                <ExclamationCircleOutlined
                  style={{
                    display: targetTextError ? "inline-block" : "none",
                    marginRight: "4px",
                  }}
                />
                {targetTextErrorMsg}
              </Text>
            )}
          </div>
        </Space>
        <Text strong>{t("Apply for")}</Text>
        <div style={{ display: "flex", flexDirection: "column", width: 200 }}>
          <PolarisSelect
            label={t("Apply for")}
            labelHidden
            options={localeOptions.map((option) => ({
              label: option.label,
              value: option.value,
            }))}
            onChange={(value) => {
              setModalAlert(null);
              setRangeCode(value);
            }}
            value={rangeCode}
            error={rangeCodeError ? rangeCodeErrorMsg : undefined}
            disabled={localesLoading}
          />
          {isCreateMode && !localesLoading && shopLocales.length === 0 ? (
            <Space direction="vertical" size="small" style={{ marginTop: 8 }}>
              <Text type="secondary">
                {t("Add a target language first to create a glossary rule.")}
              </Text>
              <Button onClick={() => navigate("/app/language")}>
                {t("Add Language")}
              </Button>
            </Space>
          ) : null}
        </div>
        <Text strong>{t("Match by")}</Text>
        <Checkbox
          checked={checked}
          onChange={(e) => {
            setChecked(e.target.checked);
          }}
        >
          {t("Case-sensitive")}
        </Checkbox>
      </Space>
    </AppSModal>
  );
};

export default UpdateGlossaryModal;
