import { useEffect, useMemo, useState } from "react";
import { Alert, Flex, Input, Modal, Space, Typography } from "antd";
import Button from "~/ui/components/AppButton";
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
  dataSource: LiquidTableRow[];
  languageCode: string;
  title: string;
  open: boolean;
  setIsModalHide: () => void;
  handleUpdateDataSource: (row: LiquidTableRow) => void;
}

const UpdateCustomTransModal: React.FC<UpdateCustomTransModalProps> = ({
  migrated,
  dataSource,
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
    const duplicate = dataSource.some(
      (item) =>
        item.sourceText === sourceText && item.languageCode === languageCode,
    );
    if (duplicate) {
      setModalAlert({
        type: "warning",
        message: t("You cannot add two conflicting rules."),
      });
      return;
    }

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
      setModalAlert({
        type: "error",
        message: getTranslateV4ErrorMessage(
          t,
          data.errorMsg,
          TRANSLATE_V4_ERROR_KEYS.LIQUID_SAVE_FAILED,
        ),
      });
    }
    setSubmitting(false);
  };

  return (
    <Modal
      title={title}
      open={open}
      onCancel={handleCloseModal}
      centered
      footer={[
        <Space key="updateCustomTransModal_footer">
          <Button onClick={handleCloseModal}>{t("Cancel")}</Button>
          <Button
            onClick={handleConfirm}
            type="primary"
            disabled={confirmDisabled}
            loading={submitting}
          >
            {t("Save")}
          </Button>
        </Space>,
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
        <Flex
          gap={8}
          justify="center"
          align="flex-start"
          style={{ width: "100%" }}
        >
          <Input
            placeholder={t("Please enter original text")}
            value={sourceText}
            onChange={(e) => {
              setModalAlert(null);
              setSourceText(e.target.value);
            }}
            disabled={submitting}
          />
          <Text style={{ margin: "0 8px", lineHeight: "32px" }}>{t("to")}</Text>
          <Input
            placeholder={t("Please enter escaped text")}
            value={targetText}
            onChange={(e) => {
              setModalAlert(null);
              setTargetText(e.target.value);
            }}
            disabled={submitting}
          />
        </Flex>
      </Space>
    </Modal>
  );
};

export default UpdateCustomTransModal;
