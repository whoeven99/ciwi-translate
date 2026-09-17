import { Typography } from "antd";
import { useTranslation } from "react-i18next";
import { useSelector } from "react-redux";

const { Text } = Typography;

const PrimaryLanguage = () => {
  const { t } = useTranslation();

  //用户默认语言数据
  const { source } = useSelector((state: any) => state.userConfig);

  return (
    <span>
      <Text>{t("Your store's default language:")} </Text>
      <Text strong>{source?.name ? source.name : ""}</Text>
    </span>
  );
};

export default PrimaryLanguage;
