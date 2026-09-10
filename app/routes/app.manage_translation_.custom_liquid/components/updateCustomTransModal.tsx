import { useEffect, useMemo, useState } from "react";
import { Alert, Input, Space, Typography } from "antd";
import { AppSModal } from "~/ui/components/AppSModal";
import { useTranslation } from "react-i18next";
import { globalStore } from "~/globalStore";
import { insertLiquidCompat, type LiquidTableRow } from "../liquidClient";
import {
  getTranslateV4ErrorMessage,
  TRANSLATE_V4_ERROR_KEYS,
} from "~/utils/translateV4Errors";

const { Text } = Typography;

/** 新建规则统一模糊替换，商户不可选。 */
const DEFAULT_REPLACEMENT_METHOD = false;

interface UpdateCustomTransModalProps {
  migrated: boolean;
  languageCode: string;
  title: string;
  open: boolean;
  setIsModalHide: () => void;
  handleUpdateDataSource: (row: LiquidTableRow) => void;
}

const UpdateCustomTransModal: React.FC<UpdateCustomTransModalProps> = ({
  migrated,
  languageCode,
  title,
  open,
  setIsModalHide,
  handleUpdateDataSource,
}) => {
  const { t } = useTranslation();
  const [sourceText, setSourceText] = useState("");
  const [targetText, setTargetText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [modalAlert, setModalAlert] = useState<{
    type: "warning" | "error";
    message: string;
  } | null>(null);

  const confirmDisabled = useMemo(
    () => !languageCode || !sourceText || !targetText || submitting,
    [languageCode, sourceText, targetText, submitting],
  );

  useEffect(() => {
    if (open) {
      setSourceText("");
      setTargetText("");
      setModalAlert(null);
    }
  }, [open, languageCode]);

  const handleCloseModal = () => {
    setModalAlert(null);
    setIsModalHide();
  };

  const handleConfirm = async () => {
    setModalAlert(null);
    setSubmitting(true);
    const data = await insertLiquidCompat({
      migrated,
      shop: globalStore?.shop || "",
      sourceText,
      targetText,
      replacementMethod: DEFAULT_REPLACEMENT_METHOD,
      languageCode,
    });

    if (data.success) {
      handleUpdateDataSource({
        key: String(data.response?.id ?? ""),
        sourceText: String(
          data.response?.liquidBeforeTranslation ?? sourceText,
        ),
        targetText: String(
          data.response?.liquidAfterTranslation ?? targetText,
        ),
        replacementMethod:
          data.response?.replacementMethod ?? DEFAULT_REPLACEMENT_METHOD,
        languageCode: String(data.response?.languageCode ?? languageCode),
        source: "manual",
        status: "DONE",
      });
      shopify.toast.show(t("Saved successfully"));
      setIsModalHide();
    } else {
      const isDuplicate =
        data.errorMsg === TRANSLATE_V4_ERROR_KEYS.LIQUID_DUPLICATE_RULE;
      setModalAlert({
        type: isDuplicate ? "warning" : "error",
        message: getTranslateV4ErrorMessage(
          t,
          data.errorMsg,
          isDuplicate
            ? TRANSLATE_V4_ERROR_KEYS.LIQUID_DUPLICATE_RULE
            : TRANSLATE_V4_ERROR_KEYS.LIQUID_SAVE_FAILED,
        ),
      });
    }
    setSubmitting(false);
  };

  return (
    <AppSModal
      open={open}
      heading={title}
      onClose={handleCloseModal}
      size="base"
      primaryAction={{
        content: t("Save"),
        onAction: () => void handleConfirm(),
        disabled: confirmDisabled,
        loading: submitting,
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
        <Text>{t("Keep translation consistent across your store")}</Text>
        <Space direction="vertical" size="small" style={{ display: "flex" }}>
          <Input
            placeholder={t("Please enter original text")}
            value={sourceText}
            onChange={(e) => {
              setModalAlert(null);
              setSourceText(e.target.value);
            }}
            disabled={submitting}
          />
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
          <Input
            placeholder={t("Please enter escaped text")}
            value={targetText}
            onChange={(e) => {
              setModalAlert(null);
              setTargetText(e.target.value);
            }}
            disabled={submitting}
          />
        </Space>
      </Space>
    </AppSModal>
  );
};

export default UpdateCustomTransModal;
