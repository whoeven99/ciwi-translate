import { useFetcher } from "@remix-run/react";
import { Alert, Flex, Space, Switch, Table, Typography } from "antd";
import { AppSModal } from "~/ui/components/AppSModal";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDispatch, useSelector } from "react-redux";
import type { LanguagesDataType, MarketType } from "../route";
import styles from "../styles.module.css";
import {
  getTranslateV4ErrorMessage,
  TRANSLATE_V4_ERROR_KEYS,
} from "~/utils/translateV4Errors";
import {
  setPublishLoadingState,
  setPublishState,
} from "~/store/modules/languageTableData";
import { globalStore } from "~/globalStore";
import { useConsumableFetcherData } from "~/hooks/useConsumableFetcherData";

const { Text } = Typography;

interface MarketDataType {
  key: string;
  domain: string;
  originalPublishStatus: boolean;
  published: boolean;
}

interface PublishModalProps {
  publishLangaugeCode: string;
  markets: MarketType[];
  setMarkets: (e: MarketType[]) => void;
  isVisible: boolean;
  setIsModalOpen: (visible: boolean) => void;
}

const PublishModal: React.FC<PublishModalProps> = ({
  publishLangaugeCode,
  markets,
  setMarkets,
  isVisible,
  setIsModalOpen,
}) => {
  const languageData: LanguagesDataType[] = useSelector(
    (state: any) => state.languageTableData.rows,
  );
  const selectedLanguage = useMemo(() => {
    return languageData.find((item) => item.locale == publishLangaugeCode);
  }, [languageData, publishLangaugeCode]);

  const [published, setPublished] = useState<boolean>(false);
  const [dataSource, setDataSource] = useState<MarketDataType[]>([]);
  const [modalAlert, setModalAlert] = useState<{
    type: "warning" | "error";
    message: string;
  } | null>(null);
  const { t } = useTranslation();
  const dispatch = useDispatch();

  const fetcher = useFetcher<any>();
  const publishFetcher = useFetcher<any>();
  const { consume: consumePublishResponse, reset: resetPublishResponse } =
    useConsumableFetcherData<any>();
  const handleCloseModal = () => {
    setModalAlert(null);
    setIsModalOpen(false);
  };

  useEffect(() => {
    const data = consumePublishResponse(publishFetcher.data);
    if (!data) {
      return;
    }

    dispatch(
      setPublishLoadingState({
        locale: publishLangaugeCode,
        loading: false,
      }),
    );

    if (data?.success) {
      const errorMsg = data?.errorMsg;
      const shopLocaleUpdate = data?.response?.shopLocaleUpdate;
      const webPresenceUpdate = data?.response?.webPresenceUpdate;

      if (webPresenceUpdate?.length) {
        const updatedMarkets = [...markets];

        webPresenceUpdate?.forEach((market: any) => {
          const webpresenceId =
            market?.value?.data?.webPresenceUpdate?.webPresence?.id;
          const defaultLocale =
            market?.value?.data?.webPresenceUpdate?.webPresence?.defaultLocale
              ?.locale;
          const host =
            market?.value?.data?.webPresenceUpdate?.webPresence?.domain?.host;
          const locales =
            market?.value?.data?.webPresenceUpdate?.webPresence?.domain
              ?.localization?.alternateLocales;

          if (webpresenceId && locales && host) {
            const existingIndex = updatedMarkets.findIndex(
              (m) => m.key === webpresenceId,
            );

            if (existingIndex >= 0) {
              updatedMarkets[existingIndex] = {
                ...updatedMarkets[existingIndex],
                domain: {
                  ...updatedMarkets[existingIndex].domain,
                  [host]: locales,
                },
              };
            } else {
              updatedMarkets.push({
                key: webpresenceId,
                defaultLocale,
                domain: {
                  [host]: locales,
                },
              });
            }
          }
        });

        setMarkets(updatedMarkets);
      }

      if (shopLocaleUpdate?.length) {
        const shopLocale =
          shopLocaleUpdate[0]?.value?.data?.shopLocaleUpdate?.shopLocale;
        if (shopLocale) {
          dispatch(
            setPublishLoadingState({
              locale: shopLocale.locale,
              loading: false,
            }),
          );
          dispatch(
            setPublishState({
              locale: shopLocale.locale,
              published: shopLocale.published,
            }),
          );
          if (published) {
            fetcher.submit(
              {
                log: `${globalStore?.shop} 发布语言${shopLocale?.locale}`,
              },
              {
                method: "POST",
                action: "/log",
              },
            );
          } else {
            fetcher.submit(
              {
                log: `${globalStore?.shop} 取消发布语言${shopLocale?.locale}`,
              },
              {
                method: "POST",
                action: "/log",
              },
            );
          }
        }
      }
      if (errorMsg) {
        setModalAlert({
          type: "warning",
          message: getTranslateV4ErrorMessage(
            t,
            errorMsg,
            TRANSLATE_V4_ERROR_KEYS.LANGUAGE_PUBLISH_PARTIAL_FAILED,
          ),
        });
        return;
      }

      setModalAlert(null);
      shopify.toast.show(t("Save successfully"));
      setIsModalOpen(false);
      return;
    }
    setModalAlert({
      type: "error",
      message: getTranslateV4ErrorMessage(
        t,
        data?.errorMsg,
        TRANSLATE_V4_ERROR_KEYS.LANGUAGE_PUBLISH_FAILED,
      ),
    });
  }, [
    consumePublishResponse,
    dispatch,
    publishFetcher.data,
    publishLangaugeCode,
    t,
  ]);

  useEffect(() => {
    if (!publishLangaugeCode) return;
    setDataSource(
      markets.flatMap((market) =>
        Object.entries(market.domain).map(([host, locales]) => ({
          key: market.key,
          defaultLocale: market.defaultLocale,
          domain: host,
          originalPublishStatus: (locales as string[]).includes(
            publishLangaugeCode,
          ),
          published: (locales as string[]).includes(publishLangaugeCode),
        })),
      ),
    );
    setPublished(selectedLanguage?.published || false);
    setModalAlert(null);
  }, [markets, publishLangaugeCode, isVisible]);

  const columns = [
    {
      title: t("Domain"),
      dataIndex: "domain",
      key: "domain",
    },
    {
      title: t("Publish"),
      dataIndex: "publish",
      key: "publish",
      render: (_: any, record: any) => {
        if (record?.defaultLocale == publishLangaugeCode)
          return <Text>{t("Default")}</Text>;
        return (
          <Switch
            checked={record.published}
            onChange={(checked) => {
              setModalAlert(null);
              setDataSource(
                dataSource.map((item) =>
                  item.key === record.key
                    ? {
                        ...item,
                        published: checked,
                      }
                    : item,
                ),
              );
            }}
          />
        );
      },
    },
  ];

  const onSave = () => {
    resetPublishResponse();
    setModalAlert(null);
    let publishInfo = null;
    let webPresencesData = null;
    if (selectedLanguage) {
      if (selectedLanguage.published != published) {
        publishInfo = {
          locale: publishLangaugeCode,
          shopLocale: { published },
        };
      }
    }

    webPresencesData = dataSource.map((item) => {
      // 找到对应的 market
      const market = markets.find((m) => m.key === item.key);
      // 找到 domain 的 value（数组）
      let locales: string[] = [];
      if (market) {
        // 取出 domain 的第一个键值对（因为你的结构是 { [host]: string[] }，通常只有一个 host）
        const domainLocales = Object.values(market.domain)[0] || [];
        locales = [...domainLocales];
      }
      if (item.published) {
        // published 为 true，确保 languageCode 存在且去重
        if (!locales.includes(publishLangaugeCode)) {
          locales.push(publishLangaugeCode);
        }
        // 去重（其实上面已保证唯一，但更保险）
        locales = Array.from(new Set(locales));
      } else {
        // published 为 false，确保 languageCode 不存在
        locales = locales.filter((l) => l !== publishLangaugeCode);
      }
      return {
        id: item.key,
        alternateLocales: locales,
        publishedCode: publishLangaugeCode,
      };
    });

    publishFetcher.submit(
      {
        publishInfo: JSON.stringify(publishInfo),
        webPresencesData: JSON.stringify(webPresencesData),
      },
      {
        method: "POST",
        action: "/publishAction",
      },
    );
  };

  return (
    <AppSModal
      open={isVisible}
      heading={t("publishModal.title", {
        languageName: selectedLanguage?.localeName,
      })}
      onClose={handleCloseModal}
      size="base"
      primaryAction={{
        content: t("Save"),
        onAction: onSave,
        disabled:
          dataSource.every(
            (item) => item.originalPublishStatus == item.published,
          ) && published == selectedLanguage?.published,
        loading: publishFetcher.state == "submitting",
      }}
      secondaryActions={[
        {
          content: t("Cancel"),
          onAction: handleCloseModal,
        },
      ]}
    >
      <Space
        direction="vertical"
        size={"large"}
        style={{ width: "100%", margin: "12px 0 0" }}
      >
        {modalAlert ? (
          <Alert
            type={modalAlert.type}
            showIcon
            message={modalAlert.message}
            closable
            onClose={() => setModalAlert(null)}
          />
        ) : null}
        <Flex justify="space-between" align="center">
          <Text strong>{t("Language Publishing Status")}</Text>
          <Switch
            value={published}
            onChange={(e) => {
              setModalAlert(null);
              setPublished(e);
            }}
          />
        </Flex>
        <div className={styles.publishModal_webpresence_card}>
          <Text strong>{t("Publish to Selected Domains")}</Text>
          <Table
            dataSource={dataSource}
            columns={columns}
            rowKey={(record) => record.key ?? record.domain}
            pagination={false}
          />
        </div>
      </Space>
    </AppSModal>
  );
};

export default PublishModal;
