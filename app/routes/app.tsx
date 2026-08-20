import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Link,
  Outlet,
  useLoaderData,
  useLocation,
  useRouteError,
} from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { authenticate } from "../shopify.server";
import { GoogleAnalyticClickReport } from "~/api/googleAnalyticsClient";
import { queryShopLanguages } from "~/api/admin";
import type { ShopLocalesType } from "~/routes/app.language/route";
import {
  bootstrapLocalesFromLoaded,
  type AppBootstrapData,
} from "~/server/appBootstrap.server";
import { resolveBillingBinding } from "~/server/billing/index.server";
import { scheduleTsfWelcomeEmail } from "~/server/billing/email/welcomeEmail.server";
import { scheduleFirstInstallFeishuNotify } from "~/server/billing/lifecycleFeishuNotify.server";
import { enqueueShopScan } from "~/server/shopScan/trigger.server";
import {
  loadShopLocalesForTranslation,
  type LoadedShopLocales,
} from "~/server/translateV4/shopLocales.server";
import { ensureShopV4Settings } from "~/server/translateV4/migration.server";
import { syncShopTargetLocalesFromShopify } from "~/server/translateV4/targetLocale.server";
import { Profiler, Suspense, lazy, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useIdleReady } from "~/hooks/useIdleReady";

import { ConfigProvider } from "antd";
import { useDispatch, useSelector } from "react-redux";
import type { Dispatch } from "@reduxjs/toolkit";
import {
  setChars,
  setIsNew,
  setPlan,
  setSource,
  setShop,
  setTotalChars,
  setTrialCredits,
  setUpdateTime,
  setUserConfigIsLoading,
} from "~/store/modules/userConfig";
import { setLanguageTableData } from "~/store/modules/languageTableData";
import { globalStore } from "~/globalStore";
import { shouldRevalidateAppShell } from "~/lib/routeShouldRevalidate";
import { appAntdTheme } from "~/ui/theme";
import { isProductionNodeEnv } from "~/config/nodeEnv.server";
import {
  isPerfDebugEnabled,
  logReactProfilerRender,
  markPerfEnd,
  markPerfStart,
} from "~/utils/perf";
import {
  OPEN_CREDITS_PURCHASE_MODAL_EVENT,
  type CreditsPurchaseModalContext,
} from "~/utils/creditsPurchaseModal";
import { refreshBillingBootstrap } from "~/utils/billingBootstrap";
import {
  parseBillingReturn,
  stripBillingReturnParams,
} from "~/utils/billingReturn";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

const LazySupportChatWidget = lazy(() =>
  import("~/components/SupportChatWidget").then((module) => ({
    default: module.SupportChatWidget,
  })),
);
const LazyPaymentModal = lazy(() => import("~/components/paymentModal"));

type AppBootstrapLocales = {
  source: { code: string; name: string };
  targets: Array<{
    locale: string;
    name: string;
    primary: boolean;
    published: boolean;
  }>;
};

/** 嵌套页（translate-v4）复用的语言列表，避免子 loader 再鉴权/再打 Shopify。 */
export type AppShellShopLocales = {
  primaryLocale: string;
  localeOptions: LoadedShopLocales["localeOptions"];
};

const EMPTY_SHOP_LOCALES: AppShellShopLocales = {
  primaryLocale: "en",
  localeOptions: [],
};

const logGraphQLErrorDetail = (context: string, error: unknown) => {
  const e = error as any;
  const response = e?.response;
  const responseHeaders =
    typeof response?.headers?.get === "function"
      ? {
          requestId: response.headers.get("x-request-id"),
          apiVersion: response.headers.get("x-shopify-api-version"),
          apiVersionWarning: response.headers.get("x-shopify-api-version-warning"),
        }
      : undefined;

  const graphQLErrorList =
    (Array.isArray(e?.graphQLErrors) && e.graphQLErrors) ||
    (Array.isArray(e?.errors?.graphQLErrors) && e.errors.graphQLErrors) ||
    (Array.isArray(e?.body?.errors) && e.body.errors) ||
    [];

  const graphQLErrors = graphQLErrorList.map((gqlError: any) => ({
    message: gqlError?.message,
    path: gqlError?.path,
    extensions: gqlError?.extensions,
    locations: gqlError?.locations,
  }));
  console.error(`[${context}] GraphQL request failed`, {
    name: e?.name,
    message: e?.message,
    networkStatusCode: e?.networkStatusCode ?? e?.errors?.networkStatusCode,
    response: response
      ? {
          status: response?.status,
          statusText: response?.statusText,
          url: response?.url,
          headers: responseHeaders,
        }
      : undefined,
    stack: e?.stack,
  });
  console.error(
    `[${context}] graphQLErrors_full=${JSON.stringify(graphQLErrors, null, 2)}`,
  );
  graphQLErrors.forEach((item: any, index: number) => {
    console.error(`[${context}] graphQLError[${index}]`, item);
  });
  console.error(
    `[${context}] rawError_full=${JSON.stringify(
      e,
      Object.getOwnPropertyNames(e || {}),
      2,
    )}`,
  );
  console.error(`[${context}] rawError`, e);
};

async function runAppInitialization({
  shop,
}: {
  shop: string;
}) {
  const initLog = "[app:init]";
  try {
    console.info(`${initLog} start shop=${shop}`);
    // 确保 TSF 账户存在；新 TSF 用户只建账户，不在安装时发放试用额度。
    const binding = await resolveBillingBinding(shop);
    console.info(
      `${initLog} billing-resolved shop=${shop} bound=${binding.bound} persisted=${binding.persisted}`,
    );
    scheduleTsfWelcomeEmail(binding, shop, "app-loader-init");
    scheduleFirstInstallFeishuNotify(binding, shop);

    // 安装/首次进 App：计量扫描（源语言总量 + 已发布语言覆盖率），幂等、best-effort。
    void enqueueShopScan({ shop, trigger: "install" }).then((result) => {
      console.info(
        `${initLog} shop-scan shop=${shop} enqueued=${result.enqueued}` +
          (result.scanId ? ` scanId=${result.scanId}` : "") +
          (result.reason ? ` reason=${result.reason}` : ""),
      );
    });

    console.info(`${initLog} done shop=${shop}`);
  } catch (error) {
    console.error(`${initLog} failed shop=${shop}`, error);
    logGraphQLErrorDetail("Error app bootstrap initialization", error);
  }
}

async function loadAppBootstrapLocales({
  shop,
  accessToken,
}: {
  shop: string;
  accessToken?: string;
}): Promise<{
  bootstrap: AppBootstrapLocales;
  shopLocales: AppShellShopLocales;
  loaded: LoadedShopLocales | null;
}> {
  let source = { code: "", name: "" };
  let targets: AppBootstrapLocales["targets"] = [];
  let shopLocales = EMPTY_SHOP_LOCALES;
  let loaded: LoadedShopLocales | null = null;

  try {
    if (accessToken) {
      loaded = await loadShopLocalesForTranslation({ shop, accessToken });
      const mapped = bootstrapLocalesFromLoaded(loaded);
      source = mapped.source;
      targets = mapped.targets;
      shopLocales = {
        primaryLocale: loaded.primaryLocale,
        localeOptions: loaded.localeOptions,
      };
    }
  } catch (error) {
    logGraphQLErrorDetail("Error app bootstrap languages", error);
  }

  return { bootstrap: { source, targets }, shopLocales, loaded };
}

function applyBootstrapToStore(
  dispatch: Dispatch,
  bootstrap: AppBootstrapData,
) {
  dispatch(setPlan({ plan: bootstrap.plan }));
  if (bootstrap.updateTime) {
    dispatch(setUpdateTime({ updateTime: bootstrap.updateTime }));
  }
  dispatch(setChars({ chars: bootstrap.chars }));
  dispatch(setTotalChars({ totalChars: bootstrap.totalChars }));
  dispatch(setTrialCredits({ trialCredits: bootstrap.trialCredits ?? 0 }));
  if (bootstrap.isNew !== null) {
    dispatch(setIsNew({ isNew: bootstrap.isNew }));
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const reqStart = Date.now();
  const perfDebug = new URL(request.url).searchParams.get("perf") === "1";
  const adminAuthResult = await authenticate.admin(request);
  const authMs = Date.now() - reqStart;
  const { shop, accessToken } = adminAuthResult.session;
  const localeStart = Date.now();
  const { bootstrap, shopLocales, loaded } = await loadAppBootstrapLocales({
    shop,
    accessToken: accessToken as string | undefined,
  });
  const localeMs = Date.now() - localeStart;

  // 语言同步 / v4 settings 不参与壳层渲染；放在父级一次完成，子页不再重复鉴权后执行。
  if (loaded) {
    void syncShopTargetLocalesFromShopify(
      shop,
      loaded.rows,
      loaded.primaryLocale,
    ).catch((syncErr) => {
      console.error("[app] syncShopTargetLocales failed:", syncErr);
    });
    void ensureShopV4Settings(shop, loaded.primaryLocale).catch((err) => {
      console.error("[app] ensureShopV4Settings failed:", err);
    });
  }

  void runAppInitialization({
    shop,
  });

  if (perfDebug) {
    console.log(
      `[perf][loader] app ${JSON.stringify({
        shop,
        authMs,
        localeMs,
        totalMs: Date.now() - reqStart,
        localeCount: shopLocales.localeOptions.length,
      })}`,
    );
  }

  return json({
    shop,
    apiKey: process.env.SHOPIFY_API_KEY || "",
    bootstrap,
    shopLocales,
    showShopProfilePage: !isProductionNodeEnv(),
    perfDebug,
  });
};

export const shouldRevalidate = shouldRevalidateAppShell;

export const action = async ({ request }: ActionFunctionArgs) => {
  const adminAuthResult = await authenticate.admin(request);
  const { shop, accessToken } = adminAuthResult.session;
  const { admin } = adminAuthResult;

  try {
    const formData = await request.formData();
    const init = JSON.parse(formData.get("init") as string);
    const languageInit = JSON.parse(formData.get("languageInit") as string);
    const languageData = JSON.parse(formData.get("languageData") as string);
    const googleAnalytics = JSON.parse(
      formData.get("googleAnalytics") as string,
    );
    const qualityEvaluation = JSON.parse(
      formData.get("qualityEvaluation") as string,
    );
    const findWebPixelId = JSON.parse(formData.get("findWebPixelId") as string);
    if (init) {
      try {
        await resolveBillingBinding(shop);
        return null;
      } catch (error) {
        logGraphQLErrorDetail("Error loading app", error);
        return null;
      }
    }

    if (languageInit) {
      try {
        await resolveBillingBinding(shop);
        return null;
      } catch (error) {
        logGraphQLErrorDetail("Error languageInit app", error);
        return null;
      }
    }

    if (languageData) {
      try {
        const shopLanguagesIndex: ShopLocalesType[] = await queryShopLanguages({
          shop,
          accessToken: accessToken as string,
        });
        const shopPrimaryLanguage = shopLanguagesIndex?.filter(
          (language) => language?.primary,
        );
        const shopLanguagesWithoutPrimaryIndex = shopLanguagesIndex?.filter(
          (language) => !language.primary,
        );

        return {
          success: true,
          errorCode: 0,
          errorMsg: "",
          response: {
            source: shopPrimaryLanguage[0] || undefined,
            targets: shopLanguagesWithoutPrimaryIndex || [],
          },
        };
      } catch (error) {
        logGraphQLErrorDetail("Error languageData app", error);
        return {
          success: false,
          errorCode: 10001,
          errorMsg: "SERVER_ERROR",
          response: null,
        };
      }
    }

    if (googleAnalytics) {
      try {
        const { data, eventType, timestamp, name } = googleAnalytics;
        const response = await GoogleAnalyticClickReport(
          { ...data, eventType, timestamp, shopName: shop },
          name,
        );
        return json({
          data: {
            success: response,
            message: `${name} ${eventType} success googleAnalytics`,
          },
        });
      } catch (error) {
        logGraphQLErrorDetail("Error googleAnalytics app", error);
        return json({
          data: {
            success: false,
            message: "Error googleAnalytics app",
          },
        });
      }
    }

    if (qualityEvaluation) {
      try {
        const mutationResponse = await admin.graphql(
          `
        #graphql
          mutation webPixelCreate($webPixel: WebPixelInput!){
            webPixelCreate(webPixel: $webPixel) {
              userErrors {
                code
                field
                message
              }
              webPixel {
                id
                settings
              }
            }
          }
        `,
          {
            variables: {
              webPixel: {
                settings: JSON.stringify({
                  shopName: shop,
                }),
              },
            },
          },
        );
        if (!mutationResponse.ok) {
          console.error("Request failed", mutationResponse);
          return;
        }
        const data = (await mutationResponse.json()) as any;
        if (data.errors) {
          console.error("GraphQL 错误: ", data.errors);
          return {
            success: false,
            response: {
              errorCode: 2,
            },
          };
        }

        if (data.data.webPixelCreate.userErrors.length > 0) {
          console.error("业务错误: ", data.data.webPixelCreate.userErrors);
          return {
            success: false,
            response: {
              errorCode: 3,
            },
          };
        }
        return {
          success: true,
          response: data,
        };
      } catch (error) {
        logGraphQLErrorDetail(`${shop} getOrderData failed`, error);
        return {
          success: false,
          response: {
            errorCode: 1,
          },
        };
      }
    }

    if (findWebPixelId) {
      try {
        const query = `
          query {
            webPixel {
              id
              settings
            }
          }
        `;
        const response = await admin.graphql(query);
        if (!response.ok) {
          return {
            success: false,
            errorCode: response.status,
            errorMsg: response.statusText,
            response: null,
          };
        }

        const data = (await response.json()) as any;
        console.log("findWebPixelId data", data);

        // 再看 GraphQL 层面是否有错误
        if (data.errors) {
          return {
            success: false,
            errorCode: 10002,
            errorMsg: data.errors.map((e: any) => e.message).join(", "),
            response: data,
          };
        }

        return {
          success: true,
          response: data,
        };
      } catch (error) {
        logGraphQLErrorDetail(`${shop} findWebPixel failed`, error);
        return {
          success: false,
          errorCode: 10001,
          errorMsg: "SERVER_ERROR",
          response: null,
        };
      }
    }


    return json({ success: false, message: "Invalid data" });
  } catch (error) {
    logGraphQLErrorDetail("Error action app", error);
    return json({ error: "Error action app" }, { status: 500 });
  }
};

export default function App() {
  const { apiKey, shop, bootstrap, showShopProfilePage, perfDebug } =
    useLoaderData<typeof loader>();
  const [isClient, setIsClient] = useState(false);
  const supportChatReady = useIdleReady();
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentPurchaseContext, setPaymentPurchaseContext] =
    useState<CreditsPurchaseModalContext | null>(null);
  const [perfDebugEnabled, setPerfDebugEnabled] = useState(perfDebug);

  const { t } = useTranslation();
  const dispatch = useDispatch();
  const location = useLocation();
  const totalChars = useSelector((state: any) => state.userConfig.totalChars);

  useEffect(() => {
    if (isPerfDebugEnabled()) {
      setPerfDebugEnabled(true);
    }
  }, []);

  useEffect(() => {
    setIsClient(true);
    const bootstrapPerfStart = markPerfStart("app.bootstrap.fetch");
    globalStore.shop = shop as string;
    globalStore.translateV4ExpressBeta = true;
    globalStore.source = bootstrap.source.code;

    dispatch(setShop({ shop }));
    dispatch(setSource({ source: bootstrap.source }));
    dispatch(setLanguageTableData(
      bootstrap.targets.map((language) => ({
        ...language,
        key: language.locale,
      })),
    ));

    let cancelled = false;
    dispatch(setUserConfigIsLoading({ isLoading: true }));

    void fetch("/api/app-bootstrap")
      .then(async (res) => {
        const data = (await res.json()) as {
          ok?: boolean;
          bootstrap?: AppBootstrapData;
        };
        markPerfEnd("app.bootstrap.fetch", bootstrapPerfStart, {
          ok: Boolean(data?.ok),
          status: res.status,
        });
        if (cancelled || !data?.ok || !data.bootstrap) return;
        applyBootstrapToStore(dispatch, data.bootstrap);
      })
      .catch((err) => {
        // Bootstrap data is non-blocking; fetch failures should not pollute exception telemetry.
        console.warn("[app] bootstrap fetch failed:", err);
        markPerfEnd("app.bootstrap.fetch", bootstrapPerfStart, {
          failed: true,
        });
      })
      .finally(() => {
        if (!cancelled) {
          dispatch(setUserConfigIsLoading({ isLoading: false }));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [bootstrap, dispatch, shop]);

  useEffect(() => {
    if (!isClient) return;

    const handleOpenCreditsPurchaseModal = (
      event: Event,
    ) => {
      const detail = (event as CustomEvent<CreditsPurchaseModalContext | null>)
        .detail;
      setPaymentPurchaseContext(detail ?? null);
      setShowPaymentModal(true);
    };

    window.addEventListener(
      OPEN_CREDITS_PURCHASE_MODAL_EVENT,
      handleOpenCreditsPurchaseModal,
    );

    return () => {
      window.removeEventListener(
        OPEN_CREDITS_PURCHASE_MODAL_EVENT,
        handleOpenCreditsPurchaseModal,
      );
    };
  }, [isClient]);

  useEffect(() => {
    if (!isClient) return;

    const billingReturn = parseBillingReturn(location.search);
    if (!billingReturn) return;

    const cleanedPath = stripBillingReturnParams(
      `${location.pathname}${location.search}${location.hash}`,
    );
    window.history.replaceState({}, "", cleanedPath);

    if (billingReturn.kind !== "credits") {
      return;
    }

    void refreshBillingBootstrap(
      dispatch,
      billingReturn.previousTotalChars ?? totalChars,
    );
  }, [
    dispatch,
    isClient,
    location.hash,
    location.pathname,
    location.search,
    totalChars,
  ]);

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <ConfigProvider
        theme={appAntdTheme}
        getPopupContainer={() => document.body}
      >
        <Profiler
          id="app-shell"
          onRender={(id, phase, actualDuration, baseDuration, startTime, commitTime) => {
            if (!perfDebugEnabled) return;
            logReactProfilerRender(
              id,
              phase,
              actualDuration,
              baseDuration,
              startTime,
              commitTime,
            );
          }}
        >
          <NavMenu>
            <Link to="/app" rel="home">
              {t("v4.title")}
            </Link>
            {isClient && (
              <>
                <Link to="/app/language">{t("Language")}</Link>
                <Link to="/app/manage_translation">
                  {t("Manage Translation")}
                </Link>
                <Link to="/app/currency">{t("Currency")}</Link>
                <Link to="/app/switcher">{t("Switcher")}</Link>
                <Link to="/app/glossary">{t("Glossary")}</Link>
                {showShopProfilePage ? (
                  <Link to="/app/shop-profile">{t("Shop Profile")}</Link>
                ) : null}
                <Link to="/app/pricing">{t("Pricing")}</Link>
              </>
            )}
          </NavMenu>
          <Outlet />
        </Profiler>
        {isClient && showPaymentModal ? (
          <Suspense fallback={null}>
            <LazyPaymentModal
              visible={showPaymentModal}
              setVisible={setShowPaymentModal}
              purchaseContext={paymentPurchaseContext}
            />
          </Suspense>
        ) : null}
        {isClient && supportChatReady ? (
          <Suspense fallback={null}>
            <LazySupportChatWidget />
          </Suspense>
        ) : null}
      </ConfigProvider>
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
