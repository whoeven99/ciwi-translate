import { useFetcher } from "@remix-run/react";
import { Alert, Flex, Space, Switch, Table, Typography } from "antd";
import { AppSModal } from "~/ui/components/AppSModal";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
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
  defaultLocale?: string;
  originalPublishStatus: boolean;
  published: boolean;
}

interface PublishModalProps {
  publishLangaugeCode: string;
  markets: MarketType[];
  setMarkets: Dispatch<SetStateAction<MarketType[]>>;
  isVisible: boolean;
  setIsModalOpen: (visible: boolean) => void;
}

function mergeWebPresenceUpdates(
  current: MarketType[],
  webPresenceUpdate: any[],
): MarketType[] {
  if (!webPresenceUpdate?.length) return current;
  const updatedMarkets = [...current];

  for (const market of webPresenceUpdate) {
    const webpresenceId =
      market?.value?.data?.webPresenceUpdate?.webPresence?.id;
    const defaultLocale =
      market?.value?.data?.webPresenceUpdate?.webPresence?.defaultLocale
        ?.locale;
    const host =
      market?.value?.data?.webPresenceUpdate?.webPresence?.domain?.host;
    const locales =
      market?.value?.data?.webPresenceUpdate?.webPresence?.domain?.localization
        ?.alternateLocales;

    if (!webpresenceId || !locales || !host) continue;

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
        domain: { [host]: locales },
      });
    }
  }

  return updatedMarkets;
}

function joinPublishAlert(base: string, userErrors?: string[]): string {
  const detail = (userErrors ?? []).filter(Boolean).join(" ");
  return detail ? `${base} ${detail}` : base;
}

function buildDomainRows(
  marketRows: MarketType[],
  locale: string,
): MarketDataType[] {
  return marketRows.flatMap((market) =>
    Object.entries(market.domain).map(([host, locales]) => ({
      key: market.key,
      defaultLocale: market.defaultLocale,
      domain: host,
      originalPublishStatus: (locales as string[]).includes(locale),
      published: (locales as string[]).includes(locale),
    })),
  );
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
  const [domainSyncKey, setDomainSyncKey] = useState(0);
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
  const wasVisibleRef = useRef(false);
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

    const shopLocaleUpdate = data?.response?.shopLocaleUpdate ?? [];
    const webPresenceUpdate = data?.response?.webPresenceUpdate ?? [];
    const userErrors = data?.response?.userErrors ?? [];
    const shopLocale =
      shopLocaleUpdate?.[0]?.value?.data?.shopLocaleUpdate?.shopLocale;

    if (webPresenceUpdate.length) {
      setMarkets((current) =>
        mergeWebPresenceUpdates(current, webPresenceUpdate),
      );
    }
    setDomainSyncKey((key) => key + 1);

    if (shopLocale) {
      dispatch(
        setPublishState({
          locale: shopLocale.locale,
          published: shopLocale.published,
        }),
      );
      setPublished(Boolean(shopLocale.published));
      fetcher.submit(
        {
          log: `${globalStore?.shop} ${
            shopLocale.published ? "发布" : "取消发布"
          }语言${shopLocale.locale}`,
        },
        {
          method: "POST",
          action: "/log",
        },
      );
    }

    if (data?.success && !data?.errorMsg) {
      setModalAlert(null);
      shopify.toast.show(t("Save successfully"));
      setIsModalOpen(false);
      return;
    }

    const fallbackKey = data?.success
      ? TRANSLATE_V4_ERROR_KEYS.LANGUAGE_PUBLISH_PARTIAL_FAILED
      : TRANSLATE_V4_ERROR_KEYS.LANGUAGE_PUBLISH_FAILED;
    setModalAlert({
      type: data?.success ? "warning" : "error",
      message: joinPublishAlert(
        getTranslateV4ErrorMessage(t, data?.errorMsg, fallbackKey),
        userErrors,
      ),
    });
  }, [
    consumePublishResponse,
    dispatch,
    fetcher,
    publishFetcher.data,
    publishLangaugeCode,
    setIsModalOpen,
    setMarkets,
    t,
  ]);

  useEffect(() => {
    if (!publishLangaugeCode) return;
    setDataSource(buildDomainRows(markets, publishLangaugeCode));
  }, [markets, publishLangaugeCode, domainSyncKey]);

  useEffect(() => {
    const justOpened = isVisible && !wasVisibleRef.current;
    wasVisibleRef.current = isVisible;
    if (!justOpened || !publishLangaugeCode) return;
    setPublished(Boolean(selectedLanguage?.published));
    setModalAlert(null);
  }, [isVisible, publishLangaugeCode, selectedLanguage?.published]);

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
    if (selectedLanguage) {
      if (selectedLanguage.published != published) {
        publishInfo = {
          locale: publishLangaugeCode,
          shopLocale: { published },
        };
      }
    }

    const webPresencesData = dataSource
      .filter((item) => item.originalPublishStatus !== item.published)
      .map((item) => {
        const market = markets.find((m) => m.key === item.key);
        let locales: string[] = market
          ? [...(Object.values(market.domain)[0] || [])]
          : [];
        if (item.published) {
          if (!locales.includes(publishLangaugeCode)) {
            locales.push(publishLangaugeCode);
          }
          locales = Array.from(new Set(locales));
        } else {
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
