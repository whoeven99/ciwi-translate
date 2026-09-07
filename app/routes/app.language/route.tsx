import { Page } from "@shopify/polaris";
import {
  Alert,
  Typography,
  Space,
  Flex,
  Table,
  Switch,
  Modal,
  Skeleton,
  Card,
  Checkbox,
} from "antd";
import Button from "~/ui/components/AppButton";
import {
  useCallback,
  useEffect,
  useState,
  startTransition,
  useMemo,
  useRef,
} from "react";
import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  useFetcher,
  useLoaderData,
  useLocation,
  useNavigate,
} from "@remix-run/react";
import { authenticate } from "~/shopify.server";
import {
  mutationShopLocaleDisable,
  mutationShopLocaleEnable,
  queryPrimaryMarket,
  queryShopLanguages,
} from "~/api/admin";
import { useDispatch, useSelector } from "react-redux";
import {
  setAutoTranslateLoadingState,
  setAutoTranslateState,
  setLanguageTableData,
  updateLanguageTableData,
} from "~/store/modules/languageTableData";
import { sameTranslationLocale } from "~/server/translateV4/locale";
import {
  addTargetLocales,
  deleteTargetLocales,
  syncShopTargetLocalesFromShopify,
} from "~/server/translateV4/targetLocale.server";
import { invalidateShopLocalesCache, loadShopLocalesForTranslation } from "~/server/translateV4/shopLocales.server";
import {
  setAutoTranslateCompat,
  listLanguageCoverageCompat,
} from "./languageClient";
import TranslatedIcon from "~/components/translateIcon";
import { useTranslation } from "react-i18next";
import PrimaryLanguage from "./components/primaryLanguage";
import AddLanguageModal from "./components/addLanguageModal";
import ScrollNotice from "~/components/ScrollNotice";
import DeleteConfirmModal from "./components/deleteConfirmModal";
import PublishModal from "./components/publishModal";
import useReport from "scripts/eventReport";
import isEqual from "lodash/isEqual";
import styles from "./styles.module.css";
import languageLocaleData from "~/utils/language-locale-data";
import { withEmbeddedSearch } from "~/utils/embeddedAction";
import AppPageHeader from "~/ui/components/AppPageHeader";
import AppSubpageTitleBar, {
  useAppHomeBackAction,
} from "~/ui/components/AppSubpageTitleBar";
import AppSectionCard from "~/ui/components/AppSectionCard";
import { getTranslatePagePath } from "~/lib/translateNavigation";
import { message } from "~/ui/message";
import {
  type ClientLogTrace,
  finishClientLogTrace,
  reportClientLog,
  startClientLogTrace,
} from "~/utils/clientLog";
import {
  getTranslateV4ErrorMessage,
  TRANSLATE_V4_ERROR_KEYS,
} from "~/utils/translateV4Errors";
import {
  createTranslateV4Tasks,
  type ShopLocaleOption,
} from "~/lib/createTranslateV4Tasks";
import { normalizeShopQuota } from "~/lib/translationQuota";
import { shouldBlockCreateTaskByCredits } from "~/lib/createTranslateQuotaGuard";
import type { ShopQuota } from "~/lib/translationQuota";
import { DEFAULT_AI_MODEL, DEFAULT_MODULE_KEYS } from "../app.translate-v4/constants";
import { expandV2ModuleKeys } from "~/server/translateV4/moduleCatalog";
import { CreateTaskCard } from "../app.translate-v4/components/CreateTaskCard";
import { CreateTaskQuotaGateModal } from "../app.translate-v4/components/CreateTaskQuotaGateModal";
import {
  formatV4CreateTasksMessage,
  translateV4Message,
} from "../app.translate-v4/v4I18n";
import { localeRegionCode } from "../app.translate-v4/localeDisplay";
import { v4Colors } from "../app.translate-v4/v4Styles";

const { Text } = Typography;

export interface MarketType {
  key: string;
  defaultLocale: string;
  domain: {
    [key: string]: string[];
  };
}

export interface ShopLocalesType {
  locale: string;
  name: string;
  primary: boolean;
  published: boolean;
}

export interface AllLanguagesType {
  key: number;
  isoCode: string;
  name: string;
}

export interface LanguagesDataType {
  key: string;
  name: string;
  src?: string[];
  localeName?: string;
  locale: string;
  primary: boolean;
  status?: number;
  statusDetail?: string;
  autoTranslate?: boolean;
  published: boolean;
  publishLoading?: boolean;
  autoTranslateLoading?: boolean;
}

type LanguageCoverageRow = {
  locale: string;
  translated: number;
  total: number;
  percent: number | null;
  cacheMissing: boolean;
  /** Redis HGETALL 完全无内容 */
  cacheEmpty?: boolean;
  autoTranslate: boolean;
  isTranslating: boolean;
};

function statusFromCoverage(row?: LanguageCoverageRow): number {
  if (!row) return 0;
  if (row.isTranslating) return 2;
  if (row.total > 0 && row.percent === 100) return 1;
  if (row.translated > 0) return 3;
  return 0;
}

function statusDetailFromCoverage(row?: LanguageCoverageRow): string | undefined {
  if (!row || row.total <= 0 || row.percent == null) return undefined;
  return `${row.percent}%`;
}

function buildLanguageRowsFromShopLanguages(
  shopLanguages: ShopLocalesType[],
): LanguagesDataType[] {
  return shopLanguages
    .filter((language) => !language.primary)
    .map((lang) => ({
      key: lang.locale,
      name: lang.name,
      locale: lang.locale,
      primary: false,
      published: lang.published,
      localeName:
        languageLocaleData[lang.locale as keyof typeof languageLocaleData]
          ?.Local || "",
      status: 0,
      countries:
        languageLocaleData[lang.locale as keyof typeof languageLocaleData]
          ?.countries || [],
      autoTranslate: false,
      publishLoading: false,
      autoTranslateLoading: false,
    }));
}

function applyCoverageToLanguageRows(
  rows: LanguagesDataType[],
  coverageRows: LanguageCoverageRow[],
): LanguagesDataType[] {
  return rows.map((lang) => {
    const coverageRow = coverageRows.find((row) =>
      sameTranslationLocale(row.locale, lang.locale),
    );
    return {
      ...lang,
      status: statusFromCoverage(coverageRow),
      statusDetail: statusDetailFromCoverage(coverageRow),
      autoTranslate: coverageRow?.autoTranslate ?? false,
    };
  });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const adminAuthResult = await authenticate.admin(request);
  const { shop, accessToken } = adminAuthResult.session;

  const isMobile = request.headers.get("user-agent")?.includes("Mobile");

  let shopLanguages: ShopLocalesType[] = [];
  try {
    const loaded = await loadShopLocalesForTranslation({
      shop,
      accessToken: accessToken as string,
    });
    shopLanguages = loaded.rows.map((row) => ({
      locale: row.locale,
      name: row.name,
      primary: row.primary,
      published: row.published,
    }));
    void syncShopTargetLocalesFromShopify(
      shop,
      loaded.rows.map((row) => ({
        locale: row.locale,
        primary: row.primary,
      })),
      loaded.primaryLocale,
    ).catch((syncErr) => {
      console.error("[language] loader syncShopTargetLocales failed:", syncErr);
    });
  } catch (err) {
    console.error("[language] loader shopLanguages failed:", err);
  }

  return json({
    mobile: isMobile as boolean,
    shop,
    shopLanguages,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const adminAuthResult = await authenticate.admin(request);
  const { admin } = adminAuthResult;
  const { shop, accessToken } = adminAuthResult.session;
  const formData = await request.formData();
  const loading = JSON.parse(formData.get("loading") as string);
  const primaryMarket = JSON.parse(formData.get("primaryMarket") as string);
  const webPresences = JSON.parse(formData.get("webPresences") as string);
  const addLanguages = JSON.parse(formData.get("addLanguages") as string); // 获取语言数组
  const deleteData = JSON.parse(formData.get("deleteData") as string);

  switch (true) {
    case !!loading:
      try {
        const data: ShopLocalesType[] = await queryShopLanguages({
          shop: shop,
          accessToken: accessToken as string,
        });
        const primaryLocale = data.find((lang) => lang.primary)?.locale;
        if (primaryLocale) {
          void syncShopTargetLocalesFromShopify(
            shop,
            data.map((lang) => ({
              locale: lang.locale,
              primary: lang.primary,
            })),
            primaryLocale,
          ).catch((syncErr) => {
            console.error("[language] syncShopTargetLocales failed:", syncErr);
          });
        }
        return {
          success: true,
          errorCode: 0,
          errorMsg: "",
          response: data,
        };
      } catch (error) {
        console.error("Error loading language:", error);
        return {
          success: true,
          errorCode: 0,
          errorMsg: "",
          response: [],
        };
      }

    case !!primaryMarket:
      try {
        const response = await queryPrimaryMarket({
          shop,
          accessToken: accessToken as string,
        });
        return json({
          success: true,
          errorCode: 0,
          errorMsg: "",
          response,
        });
      } catch (error) {
        console.error("Error primaryMarket language:", error);
      }

    case !!webPresences:
      try {
        const response = await admin.graphql(
          `#graphql
            query {
              webPresences(first: 10) {
                nodes {
                  id
                  defaultLocale{
                    locale
                  }
                  domain {
                    id
                    host
                    localization {
                      alternateLocales
                    }           
                  }
                }
              }
            }`,
        );

        const data = await response.json();

        console.log(`${shop} marketsData: `, data.data?.webPresences?.nodes);

        return json({
          success: true,
          errorCode: 0,
          errorMsg: "",
          response: data.data?.webPresences?.nodes,
        });
      } catch (error) {
        console.error("Error webPresences language:", error);
        return {
          success: false,
          errorCode: 0,
          errorMsg: "",
          dresponse: [],
        };
      }

    case !!addLanguages:
      try {
        const targets = addLanguages?.selectedLanguages || [];
        const data = await mutationShopLocaleEnable({
          shop,
          accessToken: accessToken as string,
          source: addLanguages?.primaryLanguage || "",
          targets,
        }); // 处理逻辑
        // 语言已变更，清掉 v4 首页的语言列表缓存
        invalidateShopLocalesCache(shop);

        if (data?.length > 0) {
          const successLocales = data
            .filter(
              (item): item is PromiseFulfilledResult<{ locale: string }> =>
                item.status === "fulfilled" && Boolean(item.value),
            )
            .map((item) => (item.value as { locale: string }).locale)
            .filter(Boolean);

          // 迁移自 Spring /translate/insertShopTranslateInfo：写入 TSF ShopTargetLocale
          if (successLocales.length > 0) {
            await addTargetLocales(shop, successLocales);
          }

          return {
            success: true,
            errorCode: 0,
            errorMsg: "",
            response: data
              .filter(
                (item): item is PromiseFulfilledResult<unknown> =>
                  item.status === "fulfilled" && Boolean(item.value),
              )
              .map((item) => item.value),
          };
        } else {
          return {
            success: false,
            errorCode: 0,
            errorMsg: "",
            response: [],
          };
        }
      } catch (error) {
        console.error("Error addLanguages language:", error);
        return {
          success: false,
          errorCode: 0,
          errorMsg: "",
          response: [],
        };
      }

    case !!deleteData:
      try {
        const targets = Array.isArray(deleteData?.targets) ? deleteData.targets : [];
        if (targets.length > 0) {
          const promise = deleteData.targets.map(
            async (item: LanguagesDataType) => {
              return mutationShopLocaleDisable({
                shop,
                accessToken: accessToken as string,
                language: item,
              });
            },
          );
          const data = await Promise.allSettled(promise);
          // 语言已变更，清掉 v4 首页的语言列表缓存
          invalidateShopLocalesCache(shop);

          // 迁移过的店：同步清掉 TSF 的目标语言行，避免 worker 继续给已删语言建任务
          try {
            await deleteTargetLocales(
              shop,
              targets.map((t: LanguagesDataType) => t.locale).filter(Boolean),
            );
          } catch (syncError) {
            console.error("[language] deleteTargetLocales failed:", syncError);
          }

          return json({ success: true, data });
        }
        return json({ success: true, data: [] });
      } catch (error) {
        console.error("Error deleteData language:", error);
        return json({ error: "Error deleteData language" }, { status: 500 });
      }
    default:
      // 你可以在这里处理一个默认的情况，如果没有符合的条件
      return json({ success: false, message: "Invalid data" });
  }
};

const Index = () => {
  const { shop, mobile, shopLanguages: loaderShopLanguages } =
    useLoaderData<typeof loader>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const homeBackAction = useAppHomeBackAction();
  const dispatch = useDispatch();
  const { plan, source, isNew } = useSelector((state: any) => ({
    plan: state.userConfig?.plan,
    source: state.userConfig?.source,
    isNew: state.userConfig?.isNew ?? null,
  }));

  const dataSource: LanguagesDataType[] = useSelector(
    (state: any) => state.languageTableData.rows,
  );

  const languageTableDataLocale = useMemo(() => {
    return dataSource?.map((item: any) => item?.locale) || [];
  }, [dataSource]);

  const prevLocaleDataRef = useRef<string[]>();
  const deleteTraceRef = useRef<ClientLogTrace | null>(null);
  const handledDeleteResponseRef = useRef<any>(null);
  const pollFailureLoggedRef = useRef(false);
  const skipWebPresencesResyncRef = useRef(true);
  const coverageRequestRef = useRef<Promise<void> | null>(null);
  const [markets, setMarkets] = useState<MarketType[]>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]); //表格多选控制key
  const [isLanguageModalOpen, setIsLanguageModalOpen] = useState(false); // 控制Modal显示的状态
  const [deleteloading, setDeleteLoading] = useState(false);
  const [loading, setLoading] = useState<boolean>(
    () => loaderShopLanguages.length === 0,
  );
  const [isMobile, setIsMobile] = useState<boolean>(mobile);
  const [dontPromptAgain, setDontPromptAgain] = useState(false);
  const [deleteConfirmModalVisible, setDeleteConfirmModalVisible] =
    useState(false);
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const [publishModalLanguageCode, setPublishModalLanguageCode] =
    useState<string>("");
  const [showWarnModal, setShowWarnModal] = useState(false);
  const [autoTranslateAlert, setAutoTranslateAlert] = useState<string>("");
  const [translateModalOpen, setTranslateModalOpen] = useState(false);
  const [translateTargets, setTranslateTargets] = useState<string[]>([]);
  const [translateModuleKeys, setTranslateModuleKeys] =
    useState<string[]>(DEFAULT_MODULE_KEYS);
  const [translateAiModel, setTranslateAiModel] =
    useState<string>(DEFAULT_AI_MODEL);
  const [translateIsCover, setTranslateIsCover] = useState(false);
  const [translateIsHandle, setTranslateIsHandle] = useState(false);
  const [translateCreating, setTranslateCreating] = useState(false);
  const [translateQuotaGateMode, setTranslateQuotaGateMode] = useState<
    "trial" | "pricing" | null
  >(null);
  const [quota, setQuota] = useState<ShopQuota | null>(null);
  const [strictQuotaGate, setStrictQuotaGate] = useState(false);
  const normalizedQuota = useMemo(() => normalizeShopQuota(quota), [quota]);
  const createDisabledMessage =
    normalizedQuota == null ? t("v4.create.quotaUnavailable") : null;
  const hasSelected = useMemo(
    () => selectedRowKeys.length > 0,
    [selectedRowKeys],
  );
  const someCurrentPageSelected = useMemo(
    () => dataSource.some((item: any) => selectedRowKeys.includes(item.key)),
    [dataSource, selectedRowKeys],
  );
  const allCurrentPageSelected = useMemo(
    () =>
      dataSource.length > 0 &&
      dataSource.every((item: any) => selectedRowKeys.includes(item.key)),
    [dataSource, selectedRowKeys],
  );

  const fetcher = useFetcher<any>();
  const loadingFetcher = useFetcher<any>();
  const deleteFetcher = useFetcher<any>();
  const webPresencesFetcher = useFetcher<any>();
  const { reportClick, report } = useReport();
  const location = useLocation();
  const planType = plan?.type?.trim() || null;

  const targetOptions = useMemo<ShopLocaleOption[]>(
    () =>
      dataSource.map((item) => ({
        value: item.locale,
        label: item.localeName ? `${item.name} (${item.localeName})` : item.name,
      })),
    [dataSource],
  );

  const refreshQuota = useCallback(async (): Promise<{
    remainingCredits: number | null;
    strictQuotaGate: boolean;
  } | null> => {
    try {
      const res = await fetch(
        `/api/translate-v4/quota?shopName=${encodeURIComponent(shop)}`,
      );
      const data = await res.json();
      if (data?.ok) {
        const nextQuota = normalizeShopQuota(data.quota as ShopQuota | null);
        const nextStrict = Boolean(data.strictQuotaGate);
        setQuota(nextQuota);
        setStrictQuotaGate(nextStrict);
        return {
          remainingCredits: nextQuota?.remaining ?? null,
          strictQuotaGate: nextStrict,
        };
      }
    } catch (error) {
      console.error("[language] refresh v4 quota failed:", error);
    }
    return null;
  }, [shop]);

  const applyCoverageToRows = useCallback(
    async (baseRows: LanguagesDataType[]) => {
      if (coverageRequestRef.current) {
        await coverageRequestRef.current;
        return;
      }
      const targets = baseRows.map((row) => row.locale).filter(Boolean);
      coverageRequestRef.current = (async () => {
        try {
          const coverageData = await listLanguageCoverageCompat({ targets });
          const coverageRows = (coverageData?.summary?.locales ??
            []) as LanguageCoverageRow[];
          dispatch(
            setLanguageTableData(applyCoverageToLanguageRows(baseRows, coverageRows)),
          );

          // Turso 未写入覆盖率（且 Redis 回退也空）：与「刷新统计」同效，按语言逐个 refresh=1
          const emptyLocales = coverageRows
            .filter((row) => row.cacheEmpty)
            .map((row) => row.locale);
          if (emptyLocales.length > 0) {
            void (async () => {
              try {
                let latestRows = coverageRows;
                for (const locale of emptyLocales) {
                  const refreshed = await listLanguageCoverageCompat({
                    targets,
                    forceRefresh: true,
                    refreshLocales: [locale],
                  });
                  latestRows = (refreshed?.summary?.locales ??
                    latestRows) as LanguageCoverageRow[];
                  dispatch(
                    setLanguageTableData(
                      applyCoverageToLanguageRows(baseRows, latestRows),
                    ),
                  );
                }
              } catch (error) {
                console.error(
                  "[language] background coverage refresh failed:",
                  error,
                );
              }
            })();
          }
        } catch (error) {
          console.error("[language] load coverage status failed:", error);
          dispatch(setLanguageTableData(baseRows));
        } finally {
          setLoading(false);
          coverageRequestRef.current = null;
        }
      })();
      await coverageRequestRef.current;
    },
    [dispatch],
  );

  const hydrateLanguageRows = useCallback(
    (shopLanguages: ShopLocalesType[]) => {
      const baseRows = buildLanguageRowsFromShopLanguages(shopLanguages);
      dispatch(setLanguageTableData(baseRows));
      setLoading(false);
      void applyCoverageToRows(baseRows);
    },
    [applyCoverageToRows, dispatch],
  );

  useEffect(() => {
    if (loaderShopLanguages.length > 0) {
      hydrateLanguageRows(loaderShopLanguages);
    }

    if (loaderShopLanguages.length === 0) {
      const formData = new FormData();
      formData.append("loading", JSON.stringify(true));
      loadingFetcher.submit(formData, {
        method: "post",
        action: withEmbeddedSearch("/app/language", location.search),
      });
    }

    webPresencesFetcher.submit(
      {
        webPresences: JSON.stringify(true),
      },
      {
        method: "POST",
        action: withEmbeddedSearch("/app/language", location.search),
      },
    );
    fetcher.submit(
      {
        log: `${shop} 目前在语言页面`,
      },
      {
        method: "POST",
        action: "/log",
      },
    );
    if (localStorage.getItem("dontPromptAgain")) {
      setDontPromptAgain(true);
    }
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    handleResize();
    window.addEventListener("resize", handleResize);

    const quotaTimer = window.setTimeout(() => {
      void refreshQuota();
    }, 0);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.clearTimeout(quotaTimer);
    };
  }, []);

  useEffect(() => {
    if (skipWebPresencesResyncRef.current) {
      skipWebPresencesResyncRef.current = false;
      return;
    }
    // 如果数据和上一次完全一样，就不触发
    if (
      isEqual(prevLocaleDataRef.current, languageTableDataLocale) ||
      !dataSource?.length
    ) {
      return;
    }

    prevLocaleDataRef.current = languageTableDataLocale;

    webPresencesFetcher.submit(
      {
        webPresences: JSON.stringify(true),
      },
      {
        method: "POST",
        action: withEmbeddedSearch("/app/language", location.search),
      },
    );
  }, [dataSource, languageTableDataLocale, location.search]);

  useEffect(() => {
    if (webPresencesFetcher.data?.success) {
      let newMarketArray: MarketType[] = [];
      webPresencesFetcher.data.response?.forEach((market: any) => {
        if (market?.id && market?.domain) {
          newMarketArray.push({
            key: market?.id,
            defaultLocale: market?.defaultLocale?.locale,
            domain: {
              [market?.domain?.host]:
                market?.domain?.localization?.alternateLocales,
            },
          });
        }
      });
      setMarkets(newMarketArray);
    }
  }, [webPresencesFetcher.data]);

  useEffect(() => {
    if (loadingFetcher.data) {
      if (loadingFetcher.data.success) {
        const shopLanguages = loadingFetcher.data.response as ShopLocalesType[];
        hydrateLanguageRows(shopLanguages);
      }
    }
  }, [hydrateLanguageRows, loadingFetcher.data]);

  useEffect(() => {
    if (deleteFetcher.data) {
      if (handledDeleteResponseRef.current === deleteFetcher.data) {
        return;
      }
      handledDeleteResponseRef.current = deleteFetcher.data;

      const settledResults = Array.isArray(deleteFetcher.data?.data)
        ? deleteFetcher.data.data
        : [];
      const deletedLocales = settledResults.reduce(
        (acc: any[], item: any) => {
          if (item.status === "fulfilled" && item.value) {
            acc.push(item.value);
          } else {
            shopify.toast.show(
              t("Delete failed"),
            );
          }
          return acc;
        },
        [],
      );
      const failedTargets = settledResults
        .filter((item: any) => item.status !== "fulfilled")
        .map((item: any) => item.reason ?? "unknown");
      if (!deleteFetcher.data?.success && settledResults.length === 0) {
        failedTargets.push(deleteFetcher.data?.error ?? "unknown");
      }
      // 从 data 中过滤掉成功删除的数据
      const newData = dataSource.filter(
        (item) => !deletedLocales.includes(item.locale),
      );
      // 更新表格数据
      if (newData.length !== dataSource.length) {
        dispatch(setLanguageTableData(newData));
      }
      // 清空已选中项
      setSelectedRowKeys([]);
      // 结束加载状态
      setDeleteLoading(false);
      finishClientLogTrace(deleteTraceRef.current, {
        level: failedTargets.length > 0 ? "warn" : "info",
        status: failedTargets.length > 0 ? "failure" : "success",
        context: {
          deletedLocales,
          failedTargets,
        },
      });
      deleteTraceRef.current = null;
      if (deletedLocales.length > 0) {
        shopify.toast.show(t("Delete successfully"));
        fetcher.submit(
          {
            log: `${shop} 删除语言${deletedLocales.join(",")}`,
          },
          {
            method: "POST",
            action: "/log",
          },
        );
      }
    }
  }, [dataSource, deleteFetcher.data, dispatch, fetcher, shop, t]);

  useEffect(() => {
    if (!dataSource?.some((item: any) => item.status === 2)) return;
    if (!source?.code) return;

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stablePollCount = 0;
    let lastStatusSignature = dataSource
      .map((item) => `${item.locale}:${item.status ?? ""}`)
      .join("|");

    const scheduleNextPoll = () => {
      const delay =
        typeof document !== "undefined" && document.hidden
          ? 30_000
          : Math.min(30_000, 3_000 * 2 ** Math.min(stablePollCount, 3));
      timer = setTimeout(() => {
        void pollV4LanguageStatus();
      }, delay);
    };

    const pollV4LanguageStatus = async () => {
      if (disposed) return;
      if (typeof document !== "undefined" && document.hidden) {
        scheduleNextPoll();
        return;
      }

      try {
        const targets = dataSource.map((lang) => lang.locale).filter(Boolean);
        const coverageData = await listLanguageCoverageCompat({ targets });
        const rows = (coverageData?.summary?.locales ?? []) as LanguageCoverageRow[];
        const nextStatusSignature = dataSource
          .map((lang) => {
            const row = rows.find((r) =>
              sameTranslationLocale(r.locale, lang.locale),
            );
            return `${lang.locale}:${statusFromCoverage(row)}`;
          })
          .join("|");

        stablePollCount =
          nextStatusSignature === lastStatusSignature ? stablePollCount + 1 : 0;
        lastStatusSignature = nextStatusSignature;

        let hasPendingStatus = false;
        const updates: LanguagesDataType[] = [];
        for (const lang of dataSource) {
          const row = rows.find((r) =>
            sameTranslationLocale(r.locale, lang.locale),
          );
          const nextStatus = row ? statusFromCoverage(row) : lang.status;
          const nextStatusDetail = statusDetailFromCoverage(row);
          if (nextStatus === 2) hasPendingStatus = true;
          if (
            lang.status !== nextStatus ||
            lang.statusDetail !== nextStatusDetail
          ) {
            updates.push({
              locale: lang.locale,
              status: nextStatus,
              statusDetail: nextStatusDetail,
            } as LanguagesDataType);
          }
        }

        if (updates.length > 0) {
          dispatch(updateLanguageTableData(updates));
        }

        if (pollFailureLoggedRef.current) {
          pollFailureLoggedRef.current = false;
          void reportClientLog({
            event: "language_poll_v4_status",
            action: "poll_status",
            shop,
            kind: "action",
            level: "info",
            status: "success",
            context: {
              localeCount: rows.length,
            },
          });
        }

        if (hasPendingStatus) {
          scheduleNextPoll();
        }
      } catch (error) {
        console.error("[language] poll v4 language status failed:", error);
        if (!pollFailureLoggedRef.current) {
          pollFailureLoggedRef.current = true;
          void reportClientLog({
            event: "language_poll_v4_status",
            action: "poll_status",
            shop,
            kind: "network",
            level: "error",
            status: "failure",
            error:
              error instanceof Error
                ? {
                    name: error.name,
                    message: error.message,
                    stack: error.stack,
                  }
                : {
                    message: String(error),
                  },
            context: {
              source: source.code,
            },
          });
        }
        stablePollCount += 1;
        scheduleNextPoll();
      }
    };

    timer = setTimeout(() => {
      void pollV4LanguageStatus();
    }, 3000);
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [dataSource, source?.code, shop, dispatch]);

  const columns = [
    {
      title: t("Language"),
      dataIndex: "language",
      key: "language",
      width: "30%",
      render: (_: any, record: any) => {
        return (
          <Text>
            {record.name}({record.localeName})
          </Text>
        );
      },
    },
    {
      title: t("Status"),
      dataIndex: "status",
      key: "status",
      width: "20%",
      render: (_: any, record: any) => {
        return (
          <TranslatedIcon
            status={record.status}
            detail={record.statusDetail}
          />
        );
      },
    },
    {
      title: t("Publish"),
      dataIndex: "published",
      key: "published",
      width: "10%",
      render: (_: any, record: any) => (
        <Switch
          checked={
            record.published &&
            markets?.some((item) => {
              // console.log("item: ", item);
              // console.log("record: ", record);

              return (
                Object.keys(item.domain).some((key) => {
                  // 检查 domain[key] 数组中是否包含 record?.locale
                  return item.domain[key].includes(record?.locale);
                }) || item.defaultLocale == record?.locale
              );
            })
          }
          onChange={(checked) => handlePublishChange(record.locale, checked)}
          loading={record.publishLoading} // 使用每个项的 loading 状态
        />
      ),
    },
    {
      title: t("Auto translation"),
      dataIndex: "autoTranslate",
      key: "autoTranslate",
      width: "15%",
      render: (_: any, record: any) => (
        <Switch
          checked={record.autoTranslate}
          onChange={(checked) =>
            handleAutoUpdateTranslationChange(record.locale, checked)
          }
          loading={record.autoTranslateLoading} // 使用每个项的 loading 状态
        />
      ),
    },
    {
      title: t("Action"),
      dataIndex: "action",
      key: "action",
      width: "25%",
      render: (_: any, record: any) => (
        <Space>
          <Button
            onClick={() => openTranslateModal([record.locale])}
            style={{ width: "100px" }}
            type="primary"
          >
            {record?.status === 1 ? t("Update") : t("Translate")}
          </Button>
          <Button onClick={() => navigateToManage(record.locale)}>
            {t("Manage")}
          </Button>
        </Space>
      ),
    },
  ];

  const openTranslateModal = (selectedLanguageCode: string[]) => {
    const nextTargets = selectedLanguageCode.filter((locale) =>
      targetOptions.some((option) => option.value === locale),
    );
    setTranslateTargets(nextTargets);
    setTranslateModuleKeys(DEFAULT_MODULE_KEYS);
    setTranslateAiModel(DEFAULT_AI_MODEL);
    setTranslateIsCover(false);
    setTranslateIsHandle(false);
    setTranslateModalOpen(true);
    void refreshQuota();
    fetcher.submit(
      {
        log: `${shop} 前往翻译${selectedLanguageCode?.join(",")}, 从语言页面点击`,
      },
      {
        method: "POST",
        action: "/log",
      },
    );
    reportClick("language_list_translate");
  };

  const handleCreateTranslateTasks = useCallback(async () => {
    if (!source?.code) {
      message.warning(t("Primary language not found"));
      return;
    }

    // 创建前刷新额度，避免语言页仍用过期余额绕过 gate。
    const freshQuota = await refreshQuota();
    const remainingCredits =
      freshQuota?.remainingCredits ?? normalizedQuota?.remaining ?? null;
    if (remainingCredits == null) {
      message.info(t("v4.create.quotaUnavailable"));
      return;
    }
    const shouldGateByCredits = shouldBlockCreateTaskByCredits({
      remainingCredits,
    });

    if (shouldGateByCredits) {
      if (isNew === null) {
        message.info(
          t("Checking your trial eligibility. Please try again in a moment."),
        );
        return;
      }
      setTranslateModalOpen(false);
      setTranslateQuotaGateMode(isNew ? "trial" : "pricing");
      return;
    }

    setTranslateCreating(true);
    try {
      const result = await createTranslateV4Tasks({
        source: source.code,
        targets: translateTargets,
        modules: expandV2ModuleKeys(translateModuleKeys),
        aiModel: translateAiModel,
        isCover: translateIsCover,
        isHandle: translateIsHandle,
        targetOptions,
        shop,
      });

      if (result.validationError) {
        message.warning(translateV4Message(result.validationError, t));
        return;
      }

      const summary = formatV4CreateTasksMessage(result, t, localeRegionCode);
      if (result.created.length === 0) {
        // 服务端额度拒绝时走升级/试用引导，与首页一致。
        if (
          result.failed.some(
            (item) =>
              item.error === "v4.create.noCreditsPricing" ||
              item.error === "v4.create.noCreditsTrial",
          )
        ) {
          if (isNew === null) {
            message.info(
              t(
                "Checking your trial eligibility. Please try again in a moment.",
              ),
            );
            return;
          }
          setTranslateModalOpen(false);
          setTranslateQuotaGateMode(isNew ? "trial" : "pricing");
          return;
        }
        message.error(summary);
        return;
      }

      if (result.failed.length > 0) {
        message.warning(summary, 4);
      } else {
        message.success(summary);
      }

      setTranslateModalOpen(false);
      navigate(getTranslatePagePath(), {
        state: {
          from: "/app/language",
          focusTaskQueue: true,
          spotlightTaskIds: result.created.map((item) => item.jobId),
        },
      });
    } catch (error) {
      console.error("[language] create v4 task failed:", error);
      message.error(t("v4.createFailedRetry"));
    } finally {
      setTranslateCreating(false);
    }
  }, [
    isNew,
    navigate,
    normalizedQuota?.remaining,
    refreshQuota,
    shop,
    source?.code,
    t,
    targetOptions,
    translateAiModel,
    translateIsCover,
    translateIsHandle,
    translateModuleKeys,
    translateTargets,
  ]);

  const navigateToManage = (selectedLanguageCode: string) => {
    navigate(`/app/manage_translation?language=${selectedLanguageCode}`);
    fetcher.submit(
      {
        log: `${shop} 前往管理${selectedLanguageCode}, 从语言页面点击`,
      },
      {
        method: "POST",
        action: "/log",
      },
    );
    reportClick("language_list_manage");
  };

  const handleOpenModal = () => {
    reportClick("language_navi_add");
    if (dataSource.length === 20) {
      setShowWarnModal(true);
      return;
    }
    startTransition(() => {
      setIsLanguageModalOpen((prev) => !prev); // 你的状态更新逻辑
    });
  };

  const handlePublishChange = (locale: string, checked: boolean) => {
    const row = dataSource.find((item: any) => item.locale === locale);
    if (row) {
      setPublishModalLanguageCode(row?.locale);
      setIsPublishModalOpen(true);
    }
    report(
      {
        status: checked ? 1 : 0,
      },
      {
        action: "/app",
        method: "post",
        eventType: "click",
      },
      "language_list_publish",
    );
  };

  const handleAutoUpdateTranslationChange = async (
    locale: string,
    checked: boolean,
  ) => {
    const trace = startClientLogTrace({
      event: "language_toggle_auto_translate",
      action: checked ? "enable_auto_translate" : "disable_auto_translate",
      shop,
      context: {
        locale,
      },
    });
    if (!plan) {
      finishClientLogTrace(trace, {
        level: "warn",
        status: "failure",
        message: "Plan not loaded",
      });
      return;
    }
    dispatch(setAutoTranslateLoadingState({ locale, loading: true }));
    const row = dataSource.find((item: any) => item.locale === locale);
    if (!row) {
      dispatch(setAutoTranslateLoadingState({ locale, loading: false }));
      finishClientLogTrace(trace, {
        level: "warn",
        status: "failure",
        message: "Language row not found",
        context: {
          locale,
        },
      });
      return;
    }
    try {
      setAutoTranslateAlert("");
      const data = await setAutoTranslateCompat({
        target: row.locale,
        autoTranslate: checked,
      });
      dispatch(setAutoTranslateLoadingState({ locale, loading: false }));
      if (data?.success) {
        dispatch(setAutoTranslateState({ locale, autoTranslate: checked }));
        finishClientLogTrace(trace, {
          status: "success",
          context: {
            locale: row.locale,
            autoTranslate: checked,
          },
        });
        shopify.toast.show(t("Auto translate updated successfully"));
        fetcher.submit(
          {
            log: `${shop} 自动翻译${checked ? "开启" : "关闭"}${row?.locale}`,
          },
          {
            method: "POST",
            action: "/log",
          },
        );
      } else {
        const errorMsg = getTranslateV4ErrorMessage(
          t,
          data?.errorMsg,
          TRANSLATE_V4_ERROR_KEYS.TARGET_LOCALE_SAVE_FAILED,
        );
        finishClientLogTrace(trace, {
          level: "warn",
          status: "failure",
          message: errorMsg,
          context: {
            locale: row.locale,
            autoTranslate: checked,
          },
        });
        setAutoTranslateAlert(errorMsg);
      }
    } catch (error) {
      dispatch(setAutoTranslateLoadingState({ locale, loading: false }));
      setAutoTranslateAlert(
        getTranslateV4ErrorMessage(
          t,
          TRANSLATE_V4_ERROR_KEYS.TARGET_LOCALE_SAVE_FAILED,
        ),
      );
      finishClientLogTrace(trace, {
        level: "error",
        status: "failure",
        error,
        context: {
          locale,
          autoTranslate: checked,
        },
      });
    }
    report(
      {
        status: checked ? 1 : 0,
      },
      {
        action: "/app",
        method: "post",
        eventType: "click",
      },
      "language_list_auto_translate",
    );
  };

  const handleDelete = () => {
    setDeleteConfirmModalVisible(false);
    if (dontPromptAgain) {
      localStorage.setItem("dontPromptAgain", "true");
    }
    const targets = dataSource.filter((item: LanguagesDataType) =>
      selectedRowKeys.includes(item.key),
    );

    const formData = new FormData();
    formData.append(
      "deleteData",
      JSON.stringify({
        targets: targets,
        primaryLanguageCode: source?.code,
      }),
    ); // 将选中的语言作为字符串发送
    deleteTraceRef.current = startClientLogTrace({
      event: "language_delete",
      action: "delete_languages",
      shop,
      context: {
        targets: targets.map((item) => item.locale),
      },
    });
    deleteFetcher.submit(formData, { method: "post", action: "/app/language" }); // 提交表单请求
    setDeleteLoading(true);
    reportClick("language_list_delete");
  };

  const rowSelection = {
    selectedRowKeys,
    onChange: (e: any) => {
      setSelectedRowKeys(e);
    },
  };

  const PreviewClick = () => {
    const shopUrl = `https://${shop}`;
    window.open(shopUrl, "_blank", "noopener,noreferrer");
    reportClick("language_list_preview_store");
  };

  return (
    <Page>
      <AppSubpageTitleBar title={t("Language")} />
      <ScrollNotice
        text={t(
          "Welcome to our app! If you have any questions, feel free to email us at support@ciwi.ai, and we will respond as soon as possible.",
        )}
      />
      <div className={styles.languagePage}>
        <div className={styles.languagePageInner}>
          <Space direction="vertical" size="middle" style={{ display: "flex" }}>
            <AppPageHeader
              title={t("Languages")}
              description={<PrimaryLanguage />}
              backAction={homeBackAction}
            />
            <AppSectionCard bodyPadding="16px" style={{ width: "100%" }}>
              <div className={styles.languageTable_action}>
                <div className={styles.languageToolbar}>
                  <Flex align="center" gap="middle" wrap="wrap">
                    <Button
                      disabled={!hasSelected}
                      loading={deleteloading}
                      onClick={() => {
                        if (dontPromptAgain) {
                          handleDelete();
                        } else {
                          setDeleteConfirmModalVisible(true);
                        }
                      }}
                    >
                      {t("Delete")}
                    </Button>
                    <Text style={{ color: "var(--app-color-text-secondary)" }}>
                      {hasSelected
                        ? `${t("Selected")} ${selectedRowKeys.length} ${t("items")}`
                        : null}
                    </Text>
                  </Flex>
                  {loading ? (
                    <Space wrap>
                      <Skeleton.Button active />
                      <Skeleton.Button active />
                    </Space>
                  ) : (
                    <Space wrap>
                      {!isMobile && (
                        <Button type="default" onClick={PreviewClick}>
                          {t("Preview store")}
                        </Button>
                      )}
                      <Button type="primary" onClick={handleOpenModal}>
                        {t("Add Language")}
                      </Button>
                    </Space>
                  )}
                </div>
                {autoTranslateAlert ? (
                  <Alert
                    type="error"
                    showIcon
                    message={autoTranslateAlert}
                    closable
                    onClose={() => setAutoTranslateAlert("")}
                  />
                ) : null}
                {isMobile ? (
                  <Card
                    className={styles.languageMobileCard}
                    title={
                      <Checkbox
                        checked={allCurrentPageSelected && !loading}
                        indeterminate={
                          someCurrentPageSelected && !allCurrentPageSelected
                        }
                        onChange={(e: any) =>
                          setSelectedRowKeys(
                            e.target.checked
                              ? dataSource.map((item) => item.key)
                              : [],
                          )
                        }
                      >
                        {t("Languages")}
                      </Checkbox>
                    }
                    loading={loading}
                    style={{ border: "none", boxShadow: "none" }}
                  >
                    {dataSource.map((item: any) => (
                      <Card.Grid key={item.key} style={{ width: "100%" }}>
                        <Space
                          direction="vertical"
                          size="middle"
                          style={{ width: "100%" }}
                        >
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
                            {item.name}
                          </Checkbox>
                          <div>
                            <TranslatedIcon
                              status={item.status}
                              detail={item.statusDetail}
                            />
                          </div>
                          <Flex justify="space-between">
                            <Text>{t("Publish")}</Text>
                            <Switch
                              checked={item.published}
                              onChange={(checked) =>
                                handlePublishChange(item.locale, checked)
                              }
                            />
                          </Flex>
                          <Flex justify="space-between">
                            <Text>{t("Auto translation")}</Text>
                            <Switch
                              checked={item.autoTranslate}
                              onChange={(checked) =>
                                handleAutoUpdateTranslationChange(
                                  item.locale,
                                  checked,
                                )
                              }
                            />
                          </Flex>
                          <Button
                            type="primary"
                            style={{ width: "100%" }}
                            onClick={() => openTranslateModal([item.locale])}
                          >
                            {t("Translate")}
                          </Button>
                          <Button
                            style={{ width: "100%" }}
                            onClick={() => {
                              navigate(
                                `/app/manage_translation?language=${item?.locale}`,
                              );
                            }}
                          >
                            {t("Manage")}
                          </Button>
                        </Space>
                      </Card.Grid>
                    ))}
                  </Card>
                ) : (
                  <Table
                    className={styles.languageTable}
                    rowSelection={rowSelection}
                    columns={columns}
                    dataSource={dataSource}
                    rowKey={(record) => record.key ?? record.locale}
                    loading={deleteloading || loading}
                  />
                )}
              </div>
            </AppSectionCard>
          </Space>
        </div>
      </div>
      <AddLanguageModal
        shop={shop}
        isVisible={isLanguageModalOpen}
        setIsModalOpen={setIsLanguageModalOpen}
        languageLocaleData={languageLocaleData}
      />
      <Modal
        open={translateModalOpen}
        onCancel={() => setTranslateModalOpen(false)}
        footer={null}
        centered
        destroyOnHidden
        width={760}
        closeIcon={
          <span
            aria-hidden
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 24,
              height: 24,
              fontSize: 18,
              color: v4Colors.textMuted,
              lineHeight: 1,
            }}
          >
            ×
          </span>
        }
        styles={{
          content: {
            padding: 0,
            overflow: "hidden",
            borderRadius: 20,
            border: `1px solid ${v4Colors.cardBorder}`,
            background: v4Colors.cardBg,
            boxShadow: "var(--app-shadow-card-strong)",
          },
          body: {
            padding: 0,
            maxHeight: "min(720px, calc(100vh - 96px))",
            overflowY: "auto",
          },
        }}
      >
        <CreateTaskCard
          targetOptions={targetOptions}
          targets={translateTargets}
          onTargetsChange={setTranslateTargets}
          modules={translateModuleKeys}
          onModulesChange={setTranslateModuleKeys}
          creating={translateCreating}
          createDisabled={normalizedQuota == null}
          disabledMessage={createDisabledMessage}
          onCreate={handleCreateTranslateTasks}
          aiModel={translateAiModel}
          onAiModelChange={setTranslateAiModel}
          isCover={translateIsCover}
          onIsCoverChange={setTranslateIsCover}
          isHandle={translateIsHandle}
          onIsHandleChange={setTranslateIsHandle}
          advancedDefaultOpen
          submitPlacement="footer-center"
        />
      </Modal>
      <DeleteConfirmModal
        isVisible={deleteConfirmModalVisible}
        setVisible={setDeleteConfirmModalVisible}
        setDontPromptAgain={setDontPromptAgain}
        langauges={selectedRowKeys.map((key) =>
          dataSource.find((item: any) => item?.key === key),
        )}
        handleDelete={handleDelete}
        text={t(
          "Are you sure to delete this language? After deletion, the translation data will be deleted together",
        )}
      />
      <Modal
        title={t("The 20 language limit has been reached")}
        open={showWarnModal}
        onCancel={() => setShowWarnModal(false)}
        centered
        width={700}
        footer={
          <Space>
            <Button onClick={() => setShowWarnModal(false)}>{t("OK")}</Button>
          </Space>
        }
      >
        <Text>
          {t(
            "Based on Shopify's language limit, you can only add up to 20 languages.Please delete some languages and then continue.",
          )}
        </Text>
      </Modal>
      <PublishModal
        markets={markets}
        setMarkets={setMarkets}
        isVisible={isPublishModalOpen}
        setIsModalOpen={setIsPublishModalOpen}
        publishLangaugeCode={publishModalLanguageCode}
      />
      <CreateTaskQuotaGateModal
        open={translateQuotaGateMode !== null}
        mode={translateQuotaGateMode ?? "pricing"}
        onClose={() => setTranslateQuotaGateMode(null)}
      />
    </Page>
  );
};

export default Index;
