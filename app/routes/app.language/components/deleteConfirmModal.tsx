import { Checkbox } from "antd";
import { useTranslation } from "react-i18next";
import { AppSModal } from "~/ui/components/AppSModal";
import { Text } from "@shopify/polaris";

interface DeleteConfirmModalProps {
  isVisible: boolean;
  setVisible: (visible: boolean) => void;
  setDontPromptAgain: (dontPromptAgain: boolean) => void;
  handleDelete: () => void;
  langauges: any;
  text: string;
}

const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  isVisible,
  setVisible,
  setDontPromptAgain,
  handleDelete,
  langauges = [],
  text,
}) => {
  const { t } = useTranslation();
  const heading =
    langauges.length > 1
      ? t("Delete {{count}} languages", { count: langauges.length })
      : t("Delete {{item}}", { item: langauges[0]?.name });

  return (
    <AppSModal
      open={isVisible}
      heading={heading}
      onClose={() => setVisible(false)}
      size="small"
      primaryAction={{
        content: t("Yes"),
        onAction: handleDelete,
        tone: "critical",
      }}
      secondaryActions={[
        {
          content: t("No"),
          onAction: () => setVisible(false),
        },
      ]}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <Text as="p">{text}</Text>
        <Checkbox onChange={(e) => setDontPromptAgain(e.target.checked)}>
          {t("Don’t prompt again next time")}
        </Checkbox>
      </div>
    </AppSModal>
  );
};

export default DeleteConfirmModal;
