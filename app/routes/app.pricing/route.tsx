import { Page } from "@shopify/polaris";
import {
  Space,
  Row,
  Col,
  Card,
  Typography,
  Alert,
  Flex,
  Switch,
  Table,
  Collapse,
  Modal,
} from "antd";
import Button from "~/ui/components/AppButton";
import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CollapseProps } from "antd";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { useFetcher, useLoaderData, useLocation } from "@remix-run/react";
import { isSparkCreditMigrationEnabled } from "~/server/billing/sparkCreditMigrationClient.server";
import type { OptionType } from "~/components/paymentModal";
import { CheckOutlined } from "@ant-design/icons";
import "./style.css";
import {
  mutationAppPurchaseOneTimeCreate,
  mutationAppSubscriptionCreate,
} from "~/api/admin";
import { useDispatch, useSelector } from "react-redux";
import { refreshBillingBootstrap } from "~/utils/billingBootstrap";
import useReport from "scripts/eventReport";
import { globalStore } from "~/globalStore";
import AcountInfoCard from "./components/acountInfoCard";
import AppPageHeader from "~/ui/components/AppPageHeader";
import AppSubpageTitleBar, {
  useAppHomeBackAction,
} from "~/ui/components/AppSubpageTitleBar";
import AppStatusBadge from "~/ui/components/AppStatusBadge";
import {
  type ClientLogTrace,
  finishClientLogTrace,
  reportClientLog,
  startClientLogTrace,
} from "~/utils/clientLog";
import {
  buildBillingReturnPath,
  sanitizeBillingReturnPath,
} from "~/utils/billingReturn";
import { redirectToBillingConfirmation } from "~/utils/billingConfirmation.client";
import { buildShopifyEmbeddedAppReturnUrl } from "~/lib/shopifyAppHandle.server";

const { Title, Text, Link } = Typography;

//计划名与其对应价格Map
const priceTable: Record<
  string,
  { base: number; Premium: number; Pro: number; Basic: number }
> = {
  "500K": { base: 3.99, Premium: 1.99, Pro: 2.99, Basic: 3.59 },
  "1M": { base: 7.99, Premium: 3.99, Pro: 5.99, Basic: 7.19 },
  "2M": { base: 15.99, Premium: 7.99, Pro: 11.99, Basic: 14.39 },
  "3M": { base: 23.99, Premium: 11.99, Pro: 17.99, Basic: 21.79 },
  "5M": { base: 39.99, Premium: 19.99, Pro: 29.99, Basic: 35.99 },
  "10M": { base: 79.99, Premium: 39.99, Pro: 59.99, Basic: 71.99 },
  "20M": { base: 159.99, Premium: 79.99, Pro: 119.99, Basic: 143.99 },
  "30M": { base: 239.99, Premium: 119.99, Pro: 179.99, Basic: 215.99 },
};

/** Shopify Billing 测试模式：BILLING_TEST=true 显式开启，或本地/测试环境自动开启（不产生真实扣费）。 */
const isBillingTestMode = (): boolean =>
  process.env.BILLING_TEST === "true" ||
  process.env.NODE_ENV === "development" ||
  process.env.NODE_ENV === "test";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return { sparkCreditMigrationEnabled: isSparkCreditMigrationEnabled() };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const adminAuthResult = await authenticate.admin(request);
  const { shop, accessToken } = adminAuthResult.session;
  const { admin } = adminAuthResult;

  const formData = await request.formData();
  const payInfo = JSON.parse(formData.get("payInfo") as string);
  const payForPlan = JSON.parse(formData.get("payForPlan") as string);
  const cancelId = JSON.parse(formData.get("cancelId") as string);
  const requestedReturnPath = sanitizeBillingReturnPath(
    formData.get("returnPath")?.toString(),
  );
  switch (true) {
    case !!payInfo:
      try {
        const returnUrl = buildShopifyEmbeddedAppReturnUrl(
          shop,
          requestedReturnPath,
        );
        const res = await mutationAppPurchaseOneTimeCreate({
          shop,
          accessToken: accessToken as string,
          name: payInfo.name,
          price: payInfo.price,
          returnUrl,
          test: isBillingTestMode(),
        });

        if (res) {
          const confirmationUrl =
            res?.data?.appPurchaseOneTimeCreate?.confirmationUrl;

          // tsf 用户入账靠 APP_PURCHASES_ONE_TIME_UPDATE → Turso，不写 Java CharsOrders
          if (confirmationUrl) {
            return {
              success: true,
              response: { confirmationUrl },
            };
          }

          const userErrors =
            res?.data?.appPurchaseOneTimeCreate?.userErrors ?? [];
          return {
            success: false,
            errorCode: 10002,
            errorMsg: userErrors[0]?.message ?? "NO_CONFIRMATION_URL",
            response: null,
          };
        }

        return {
          success: false,
          errorCode: 10001,
          errorMsg: "SERVER_ERROR",
          response: null,
        };
      } catch (error) {
        if (error instanceof Response) {
          throw error;
        }
        console.error("Error payInfo pricing action: ", error);
        return {
          success: false,
          errorCode: 10001,
          errorMsg: "SERVER_ERROR",
          response: null,
        };
      }

    case !!payForPlan:
      try {
        const returnUrl = buildShopifyEmbeddedAppReturnUrl(
          shop,
          requestedReturnPath,
        );
        const res = await mutationAppSubscriptionCreate({
          shop,
          accessToken: accessToken as string,
          name: payForPlan.title,
          yearly: payForPlan.yearly,
          price: {
            amount: payForPlan.yearly
              ? payForPlan.yearlyPrice * 12
              : payForPlan.monthlyPrice,
            currencyCode: "USD",
          },
          trialDays: payForPlan.trialDays,
          returnUrl,
          test: isBillingTestMode(),
        });

        if (res) {
          const confirmationUrl =
            res?.data?.appSubscriptionCreate?.confirmationUrl;

          if (confirmationUrl) {
            return {
              success: true,
              response: { confirmationUrl },
            };
          }

          const userErrors = res?.data?.appSubscriptionCreate?.userErrors ?? [];
          return {
            success: false,
            errorCode: 10002,
            errorMsg: userErrors[0]?.message ?? "NO_CONFIRMATION_URL",
            response: null,
          };
        }

        return {
          success: false,
          errorCode: 10001,
          errorMsg: "SERVER_ERROR",
          response: null,
        };
      } catch (error) {
        if (error instanceof Response) {
          throw error;
        }
        console.error("Error payForPlan pricing action:", error);
        return {
          success: false,
          errorCode: 10001,
          errorMsg: "SERVER_ERROR",
          response: null,
        };
      }

    case !!cancelId:
      try {
        const response = await admin.graphql(
          `#graphql
          mutation AppSubscriptionCancel($id: ID!, $prorate: Boolean) {
            appSubscriptionCancel(id: $id, prorate: $prorate) {
              userErrors {
                field
                message
              }
              appSubscription {
                id
                status
              }
            }
          }`,
          {
            variables: {
              id: cancelId,
            },
          },
        );

        const data = await response.json();
        console.log(`应用日志: ${shop} 取消计划: `, data);
        return data;
      } catch (error) {
        console.error("Error cancelId action:", error);
        return null;
      }
  }
  return null;
};

const Index = () => {
  const { t, i18n } = useTranslation();
  const dispatch = useDispatch();
  const location = useLocation();
  const homeBackAction = useAppHomeBackAction();
  const { sparkCreditMigrationEnabled = false } = useLoaderData<typeof loader>() ?? {};

  const getPlanDisplayLabel = (planName: string | null | undefined) => {
    switch (planName) {
      case "Free":
        return t("pricing.plan.free");
      case "Basic":
        return t("pricing.plan.basic");
      case "Pro":
        return t("pricing.plan.pro");
      case "Premium":
        return t("pricing.plan.premium");
      default:
        return planName ?? "";
    }
  };

  const {
    plan,
    updateTime,
    chars,
    totalChars,
    trialCredits,
    purchasedCredits,
    migratablePurchasedCredits,
    isNew,
  } = useSelector((state: any) => state.userConfig);

  const { reportClick, report } = useReport();
  const billingReturnBasePath = useMemo(() => {
    const requestedReturnPath = new URLSearchParams(location.search).get(
      "returnPath",
    );
    if (requestedReturnPath) {
      return sanitizeBillingReturnPath(requestedReturnPath);
    }
    return `${location.pathname}${location.search}${location.hash}`;
  }, [location.hash, location.pathname, location.search]);
  const creditsBillingReturnPath = useMemo(
    () =>
      buildBillingReturnPath(billingReturnBasePath, {
        kind: "credits",
        previousTotalChars:
          typeof totalChars === "number" ? totalChars : undefined,
      }),
    [billingReturnBasePath, totalChars],
  );
  const planBillingReturnPath = useMemo(
    () =>
      buildBillingReturnPath(billingReturnBasePath, {
        kind: "plan",
        previousTotalChars:
          typeof totalChars === "number" ? totalChars : undefined,
      }),
    [billingReturnBasePath, totalChars],
  );

  //价格选项数组
  const creditOptions: OptionType[] = useMemo(
    () => [
      {
        key: "option-1",
        name: "500K",
        Credits: 500000,
        price: eNumPlanType({
          planType: plan?.type,
          optionName: "500K",
          isInTrial: plan?.isInFreePlanTime,
        }),
      },
      {
        key: "option-2",
        name: "1M",
        Credits: 1000000,
        price: eNumPlanType({
          planType: plan?.type,
          optionName: "1M",
          isInTrial: plan?.isInFreePlanTime,
        }),
      },
      {
        key: "option-3",
        name: "2M",
        Credits: 2000000,
        price: eNumPlanType({
          planType: plan?.type,
          optionName: "2M",
          isInTrial: plan?.isInFreePlanTime,
        }),
      },
      {
        key: "option-4",
        name: "3M",
        Credits: 3000000,
        price: eNumPlanType({
          planType: plan?.type,
          optionName: "3M",
          isInTrial: plan?.isInFreePlanTime,
        }),
      },
      {
        key: "option-5",
        name: "5M",
        Credits: 5000000,
        price: eNumPlanType({
          planType: plan?.type,
          optionName: "5M",
          isInTrial: plan?.isInFreePlanTime,
        }),
      },
      {
        key: "option-6",
        name: "10M",
        Credits: 10000000,
        price: eNumPlanType({
          planType: plan?.type,
          optionName: "10M",
          isInTrial: plan?.isInFreePlanTime,
        }),
      },
      {
        key: "option-7",
        name: "20M",
        Credits: 20000000,
        price: eNumPlanType({
          planType: plan?.type,
          optionName: "20M",
          isInTrial: plan?.isInFreePlanTime,
        }),
      },
      {
        key: "option-8",
        name: "30M",
        Credits: 30000000,
        price: eNumPlanType({
          planType: plan?.type,
          optionName: "30M",
          isInTrial: plan?.isInFreePlanTime,
        }),
      },
    ],
    [plan],
  );

  //当前选择价格
  const [selectedOptionKey, setSelectedOption] = useState<string>("option-1");

  //是否为年费计划
  const [yearly, setYearly] = useState(false);

  //各种加载状态
  const [isLoading, setIsLoading] = useState(true);
  const [creditsRefreshing, setCreditsRefreshing] = useState(false);
  const [buyButtonLoading, setBuyButtonLoading] = useState<boolean>(false);
  const [payForPlanButtonLoading, setPayForPlanButtonLoading] =
    useState<string>("");
  const [localNextPaymentText, setLocalNextPaymentText] = useState<
    string | null
  >(null);

  //各个表单开启状态
  const [addCreditsModalOpen, setAddCreditsModalOpen] = useState(false);
  const [cancelPlanWarnModal, setCancelPlanWarnModal] = useState(false);

  const [selectedPayPlanOption, setSelectedPayPlanOption] = useState<any>();

  const isQuotaExceeded = useMemo(
    () => chars >= totalChars && totalChars > 0,
    [chars, totalChars],
  );

  const planCancelFetcher = useFetcher<any>();
  const payFetcher = useFetcher<any>();
  const payForPlanFetcher = useFetcher<any>();
  const payCreditsTraceRef = useRef<ClientLogTrace | null>(null);
  const payPlanTraceRef = useRef<ClientLogTrace | null>(null);
  const cancelPlanTraceRef = useRef<ClientLogTrace | null>(null);
  const cancelRefreshHandledRef = useRef(false);
  const payCreditsSubmittingRef = useRef(false);
  const payPlanSubmittingRef = useRef(false);
  const payCreditsAwaitingResponseRef = useRef(false);
  const payPlanAwaitingResponseRef = useRef(false);

  useEffect(() => {
    setIsLoading(false);
    void reportClientLog(
      {
        event: "pricing_page_view",
        shop: globalStore?.shop,
        level: "info",
        kind: "event",
        status: "success",
        message: `${globalStore?.shop} 目前在付费页面`,
        context: {
          legacy: true,
        },
      },
      { beacon: true },
    );
  }, []);

  useEffect(() => {
    if (!updateTime || plan?.type === "Free") {
      setLocalNextPaymentText(null);
      return;
    }

    const nextPaymentTime = new Date(updateTime);
    if (Number.isNaN(nextPaymentTime.getTime())) {
      setLocalNextPaymentText(null);
      return;
    }

    setLocalNextPaymentText(
      new Intl.DateTimeFormat(i18n.resolvedLanguage || undefined, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(nextPaymentTime),
    );
  }, [i18n.resolvedLanguage, plan?.type, updateTime]);

  useEffect(() => {
    if (payFetcher.state === "submitting" || payFetcher.state === "loading") {
      payCreditsAwaitingResponseRef.current = true;
      return;
    }

    if (payFetcher.state !== "idle") return;

    if (!payFetcher.data) {
      if (
        payCreditsSubmittingRef.current &&
        payCreditsAwaitingResponseRef.current
      ) {
        payCreditsSubmittingRef.current = false;
        payCreditsAwaitingResponseRef.current = false;
        setBuyButtonLoading(false);
      }
      return;
    }

    payCreditsAwaitingResponseRef.current = false;
    const confirmationUrl = payFetcher.data?.response?.confirmationUrl as
      | string
      | undefined;
    const succeeded = Boolean(payFetcher.data?.success && confirmationUrl);

    if (payCreditsTraceRef.current) {
      finishClientLogTrace(payCreditsTraceRef.current, {
        level: succeeded ? "info" : "warn",
        status: succeeded ? "success" : "failure",
        message: payFetcher.data?.errorMsg,
        context: {
          errorCode: payFetcher.data?.errorCode,
          hasConfirmationUrl: Boolean(confirmationUrl),
        },
      });
      payCreditsTraceRef.current = null;
    }

    payCreditsSubmittingRef.current = false;
    setBuyButtonLoading(false);

    if (succeeded && confirmationUrl) {
      redirectToBillingConfirmation(confirmationUrl);
    }
  }, [payFetcher.state, payFetcher.data]);

  useEffect(() => {
    if (
      payForPlanFetcher.state === "submitting" ||
      payForPlanFetcher.state === "loading"
    ) {
      payPlanAwaitingResponseRef.current = true;
      return;
    }

    if (payForPlanFetcher.state !== "idle") return;

    if (!payForPlanFetcher.data) {
      if (
        payPlanSubmittingRef.current &&
        payPlanAwaitingResponseRef.current
      ) {
        payPlanSubmittingRef.current = false;
        payPlanAwaitingResponseRef.current = false;
        setPayForPlanButtonLoading("");
      }
      return;
    }

    payPlanAwaitingResponseRef.current = false;
    const confirmationUrl = payForPlanFetcher.data?.response?.confirmationUrl as
      | string
      | undefined;
    const succeeded = Boolean(
      payForPlanFetcher.data?.success && confirmationUrl,
    );

    if (payPlanTraceRef.current) {
      finishClientLogTrace(payPlanTraceRef.current, {
        level: succeeded ? "info" : "warn",
        status: succeeded ? "success" : "failure",
        message: payForPlanFetcher.data?.errorMsg,
        context: {
          errorCode: payForPlanFetcher.data?.errorCode,
          hasConfirmationUrl: Boolean(confirmationUrl),
        },
      });
      payPlanTraceRef.current = null;
    }

    payPlanSubmittingRef.current = false;
    setPayForPlanButtonLoading("");

    if (succeeded && confirmationUrl) {
      redirectToBillingConfirmation(confirmationUrl);
    }
  }, [payForPlanFetcher.state, payForPlanFetcher.data]);

  useEffect(() => {
    if (!planCancelFetcher.data || cancelRefreshHandledRef.current) return;
    cancelRefreshHandledRef.current = true;

    if (cancelPlanTraceRef.current) {
      finishClientLogTrace(cancelPlanTraceRef.current, {
        status: "success",
        context: {
          planType: plan?.type,
        },
      });
      cancelPlanTraceRef.current = null;
    }

    setCancelPlanWarnModal(false);
    setCreditsRefreshing(true);
    const previousTotalChars = totalChars;
    void refreshBillingBootstrap(dispatch, previousTotalChars).finally(() => {
      setCreditsRefreshing(false);
    });
  }, [dispatch, plan?.type, planCancelFetcher.data, totalChars]);

  const plans = useMemo(
    () => [
      {
        title: "Basic",
        yearlyTitle: "Basic - Yearly",
        monthlyPrice: 7.99,
        yearlyPrice: 6.39,
        yearlyBillingAmount: 76.68,
        buttonText:
          plan.type === "Basic" && yearly === !!(plan.feeType === 2)
            ? t("pricing.current_plan")
            : t("pricing.get_start"),
        fitLabel: t("适合刚开始做多语言运营、需要基础商品与页面翻译的店铺"),
        disabled: plan.type === "Basic" && yearly === !!(plan.feeType === 2),
        features: [
          t("{{credits}} credits/month", { credits: "1,500,000" }),
          t("pricing.launchCredits", { credits: "4,000,000" }),
          t("Glossary ({{count}} entries)", { count: 10 }),
          t("basic_features1"),
          t("basic_features2"),
          t("basic_features3"),
          t("basic_features4"),
          t("basic_features5"),
          t("basic_features6"),
          t("basic_features7"),
          t("basic_features8"),
          t("basic_features9"),
        ],
      },
      {
        title: "Pro",
        yearlyTitle: "Pro - Yearly",
        monthlyPrice: 19.99,
        yearlyPrice: 15.99,
        yearlyBillingAmount: 191.88,
        buttonText:
          plan.type === "Pro" && yearly === !!(plan.feeType === 2)
            ? t("pricing.current_plan")
            : t("pricing.get_start"),
        fitLabel: t("适合稳定扩展多个语言市场、持续更新商品内容的店铺"),
        disabled: plan.type === "Pro" && yearly === !!(plan.feeType === 2),
        features: [
          t("all in Basic Plan"),
          t("{{credits}} credits/month", { credits: "3,000,000" }),
          t("pricing.launchCredits", { credits: "8,000,000" }),
          t("Glossary ({{count}} entries)", { count: 50 }),
          t("pro_features1"),
          t("pro_features2"),
          t("pro_features3"),
          t("pro_features4"),
          t("pro_features5"),
          t("pro_features6"),
          t("pro_features7"),
          t("pro_features8"),
        ],
      },
      {
        title: "Premium",
        yearlyTitle: "Premium - Yearly",
        monthlyPrice: 39.99,
        yearlyPrice: 31.99,
        yearlyBillingAmount: 383.88,
        buttonText:
          plan.type === "Premium" && yearly === !!(plan.feeType === 2)
            ? t("pricing.current_plan")
            : t("pricing.get_start"),
        fitLabel: t("适合高频上新、多区域运营和更重度翻译协作的团队"),
        disabled: plan.type === "Premium" && yearly === !!(plan.feeType === 2),
        isRecommended: true,
        features: [
          t("all in Pro Plan"),
          t("{{credits}} credits/month", { credits: "8,000,000" }),
          t("pricing.launchCredits", { credits: "16,000,000" }),
          t("Glossary ({{count}} entries)", { count: 100 }),
          t("premium_features1"),
          t("premium_features2"),
          t("premium_features3"),
          t("premium_features4"),
          t("premium_features5"),
          t("premium_features6"),
          t("premium_features7"),
          t("premium_features8"),
          t("premium_features9"),
        ],
      },
    ],
    [plan, yearly, t],
  );

  const tableData = useMemo(
    () => [
      {
        key: 0,
        features: t("Monthly Payment"),
        free: "0",
        basic: "7.99",
        pro: "19.99",
        premium: "39.99",
        type: "text",
      },
      {
        key: 1,
        features: t("Annual payment discount"),
        free: "",
        basic: "20%",
        pro: "20%",
        premium: "20%",
        type: "text",
      },
      {
        key: 2,
        features: t("Monthly payment after discount"),
        free: "",
        basic: "6.39",
        pro: "15.99",
        premium: "31.99",
        type: "text",
      },
      {
        key: 3,
        features: t("Annual payment after discount"),
        free: "",
        basic: "76.68",
        pro: "191.88",
        premium: "383.88",
        type: "text",
      },
      {
        key: 4,
        features: t("Monthly points gift"),
        free: "0",
        basic: t("{{credits}} credits/month", { credits: "1,500,000" }),
        pro: t("{{credits}} credits/month", { credits: "3,000,000" }),
        premium: t("{{credits}} credits/month", { credits: "8,000,000" }),
        type: "text",
      },
      {
        key: "launch_credits",
        features: t("pricing.launchCreditsRow"),
        free: "—",
        basic: "4,000,000",
        pro: "8,000,000",
        premium: "16,000,000",
        type: "text",
      },
      {
        key: 5,
        features: t("Glossary"),
        free: "",
        basic: "10",
        pro: "50",
        premium: "100",
        type: "text",
      },
      {
        key: 6,
        features: t("Points purchase discount"),
        free: "0%",
        basic: "10%",
        pro: "25%",
        premium: "50%",
        type: "text",
      },
      {
        key: 7,
        features: t("Automatic translation updates"),
        free: "",
        basic: t("support"),
        pro: t("support"),
        premium: t("support"),
        type: "text",
      },
      {
        key: 8,
        features: t("Manual Editor"),
        free: t("support"),
        basic: t("support"),
        pro: t("support"),
        premium: t("support"),
        type: "text",
      },
      {
        key: 9,
        features: t("Automatic IP switching"),
        free: "",
        basic: t("support"),
        pro: t("support"),
        premium: t("support"),
        type: "text",
      },
      {
        key: 10,
        features: t("Third-party app translation"),
        free: "",
        basic: t("support"),
        pro: t("support"),
        premium: t("support"),
        type: "text",
      },
      {
        key: 11,
        features: t("Image Translation"),
        free: "",
        basic: t("support"),
        pro: t("support"),
        premium: t("support"),
        type: "text",
      },
      {
        key: 12,
        features: t("Private API support"),
        free: t("support"),
        basic: t("support"),
        pro: t("support"),
        premium: t("support"),
        type: "text",
      },
      {
        key: 13,
        features: t("Private API call limits"),
        free: "30,000",
        basic: "300,000",
        pro: "800,000",
        premium: "3,000,000",
        type: "text",
      },
      {
        key: 14,
        features: t("Manual support"),
        free: "",
        basic: t("support"),
        pro: t("support"),
        premium: t("1v1 support"),
        type: "text",
      },
    ],
    [t],
  );

  const collapseData: CollapseProps["items"] = useMemo(
    () => [
      {
        key: 1,
        label: t("Can I get a discount on my plan?"),
        children: t(
          "Yes. You'll save 20% when you choose yearly billing. Discount applies automatically at checkout.",
        ),
      },
      {
        key: 2,
        label: t("Can I get a refund?"),
        children: t(
          "No. We do not offer refunds. You can cancel anytime to stop future billing, and your plan will remain active until the end of the billing period.",
        ),
      },
      {
        key: 3,
        label: t("What happens when I run out of credits?"),
        children: t(
          "You'll need to purchase extra credits to keep creating content. You won't lose access to features, only to credit-based actions.",
        ),
      },
      {
        key: 4,
        label: t("Do unused credits carry over?"),
        children: t(
          "Plan credits reset at the end of each billing cycle. But if you cancel or downgrade, any unused credits stay active for 3 more months.",
        ),
      },
      {
        key: 5,
        label: t("Do extra credits affect my plan or features?"),
        children: t(
          "No. Plan credits come with your subscription and reset monthly. Extra credits are only used when plan credits run out, and they never expire. They don't unlock new features or raise limits.",
        ),
      },
      {
        key: 6,
        label: t("What happens if I upgrade my plan?"),
        children: t(
          "You get your new plan's credits and features right away. Any remaining credits from your previous plan won't carry over.",
        ),
      },
      {
        key: 7,
        label: t("Will I lose credits if I cancel or downgrade?"),
        children: t(
          "No. Your unused credits stay available for 3 months. But you'll only have access to the features included in your new (lower) plan.",
        ),
      },
      {
        key: 8,
        label: t("How many credits do actions use?"),
        children: t(
          "We calculate usage at 1 credit per word. However, if AI model is used, the consumption of prompt tokens also needs to be included—each request requires approximately an additional 80 credits. If you would like to know the estimated cost of a translation task, please feel free to contact customer support.",
        ),
      },
    ],
    [t],
  );

  const paidPlanColSpan = useMemo(() => {
    if (plans.length <= 1) return 24;
    if (plans.length === 2) return 12;
    if (plans.length === 3) return 8;
    return 6;
  }, [plans.length]);

  const comparisonFeatureColWidth = 168;
  const comparisonPlanColWidth = 220;
  const comparisonTableScrollX =
    comparisonFeatureColWidth + comparisonPlanColWidth * 4;

  const columns = [
    {
      title: t("Features"),
      dataIndex: "features",
      key: "features",
      width: comparisonFeatureColWidth,
      fixed: "left" as const,
      className: "pricing-comparison-table__feature",
    },
    {
      title: getPlanDisplayLabel("Free"),
      dataIndex: "free",
      key: "free",
      width: comparisonPlanColWidth,
      className: "pricing-comparison-table__plan",
      render: (_: any, record: any) => {
        switch (true) {
          case record.type === "credits":
            return <Text>{record.free}</Text>;
          case record.type === "boolean":
            return <Text>{record.free ? "√" : "×"}</Text>;
          default:
            return <Text>{record.free}</Text>;
        }
      },
    },
    {
      title: getPlanDisplayLabel("Basic"),
      dataIndex: "basic",
      key: "basic",
      width: comparisonPlanColWidth,
      className: "pricing-comparison-table__plan",
      render: (_: any, record: any) => {
        switch (true) {
          case record.type === "credits":
            return <Text>{record.basic}</Text>;
          case record.type === "boolean":
            return <Text>{record.basic ? "√" : "×"}</Text>;
          default:
            return <Text>{record.basic}</Text>;
        }
      },
    },
    {
      title: getPlanDisplayLabel("Pro"),
      dataIndex: "pro",
      key: "pro",
      width: comparisonPlanColWidth,
      className: "pricing-comparison-table__plan",
      render: (_: any, record: any) => {
        switch (true) {
          case record.type === "credits":
            return <Text>{record.pro}</Text>;
          case record.type === "boolean":
            return <Text>{record.pro ? "√" : "×"}</Text>;
          default:
            return <Text>{record.pro}</Text>;
        }
      },
    },
    {
      title: getPlanDisplayLabel("Premium"),
      dataIndex: "premium",
      key: "premium",
      width: comparisonPlanColWidth,
      className: "pricing-comparison-table__plan",
      render: (_: any, record: any) => {
        switch (true) {
          case record.type === "credits":
            return <Text>{record.premium}</Text>;
          case record.type === "boolean":
            return <Text>{record.premium ? "√" : "×"}</Text>;
          default:
            return <Text>{record.premium}</Text>;
        }
      },
    },
  ];

  const handleSetYearlyReport = () => {
    setYearly(!yearly);
    report(
      {
        status: yearly ? 0 : 1,
      },
      {
        action: "/app",
        method: "post",
        eventType: "click",
      },
      "pricing_plan_yearly_switcher",
    );
  };

  const handleCancelPlan = async () => {
    cancelRefreshHandledRef.current = false;
    cancelPlanTraceRef.current = startClientLogTrace({
      event: "pricing_cancel_plan",
      action: "cancel_plan",
      shop: globalStore?.shop,
      context: {
        planType: plan?.type,
      },
    });
    try {
      const res = await fetch(
        `/api/billing/active-subscription?shopName=${encodeURIComponent(
          globalStore?.shop as string,
        )}`,
      );
      const data = await res.json();
      if (data?.ok && data?.subscriptionId) {
        planCancelFetcher.submit(
          {
            cancelId: JSON.stringify(data.subscriptionId),
          },
          { method: "POST" },
        );
        return;
      }
      finishClientLogTrace(cancelPlanTraceRef.current, {
        level: "warn",
        status: "failure",
        message: "Failed to load latest active subscription",
      });
      cancelPlanTraceRef.current = null;
    } catch (error) {
      finishClientLogTrace(cancelPlanTraceRef.current, {
        level: "error",
        status: "failure",
        error,
      });
      cancelPlanTraceRef.current = null;
    }
  };

  const handleOpenAddCreditsModal = () => {
    setAddCreditsModalOpen(true);
    reportClick("pricing_balance_add");
  };

  const handlePayForCredits = () => {
    setBuyButtonLoading(true);
    payCreditsSubmittingRef.current = true;
    payCreditsAwaitingResponseRef.current = false;
    const selectedOption = creditOptions.find(
      (item) => item.key === selectedOptionKey,
    );
    payCreditsTraceRef.current = startClientLogTrace({
      event: "pricing_buy_credits",
      action: "buy_credits",
      shop: globalStore?.shop,
      context: {
        optionKey: selectedOption?.key,
        optionName: selectedOption?.name,
        amount: selectedOption?.price.currentPrice,
        currencyCode: selectedOption?.price.currencyCode,
      },
    });

    const payInfo = {
      name: selectedOption?.name,
      price: {
        amount: selectedOption?.price.currentPrice,
        currencyCode: selectedOption?.price.currencyCode,
      },
    };
    const formData = new FormData();
    formData.append("payInfo", JSON.stringify(payInfo));
    formData.append("returnPath", creditsBillingReturnPath);
    payFetcher.submit(formData, {
      method: "POST",
    });
  };

  const handlePayForPlan = ({
    plan,
    trialDays,
    id,
  }: {
    plan: any;
    trialDays: number;
    id: string;
  }) => {
    setPayForPlanButtonLoading(id);
    payPlanSubmittingRef.current = true;
    payPlanAwaitingResponseRef.current = false;
    payPlanTraceRef.current = startClientLogTrace({
      event: "pricing_buy_plan",
      action: "buy_plan",
      shop: globalStore?.shop,
      context: {
        planTitle: plan?.title,
        yearly,
        trialDays,
      },
    });
    setSelectedPayPlanOption({ ...plan, yearly, trialDays });
    payForPlanFetcher.submit(
      {
        payForPlan: JSON.stringify({ ...plan, yearly, trialDays }),
        returnPath: planBillingReturnPath,
      },
      { method: "POST" },
    );
    reportClick(trialDays !== 5 ? "pricing_plan_start" : "pricing_plan_trial");
  };

  return (
    <Page>
      <AppSubpageTitleBar title={t("Pricing")} />
      <div className="pricing-page">
        <div className="pricing-page__inner">
          <Space direction="vertical" size="large" style={{ display: "flex" }}>
            <AppPageHeader
              title={t("Pricing")}
              backAction={homeBackAction}
              extra={
                plan.type ? (
                  <div className="pricing-page__plan-meta">
                    <div className="app-status-cluster">
                      <AppStatusBadge tone="info">
                        {getPlanDisplayLabel(plan.type)}
                      </AppStatusBadge>
                    </div>
                    {localNextPaymentText ? (
                      <Text className="pricing-page__next-payment" type="secondary">
                        {t("Next payment")}: {localNextPaymentText}
                      </Text>
                    ) : null}
                  </div>
                ) : null
              }
            />

            <AcountInfoCard
              loading={isLoading || creditsRefreshing}
              translation_balance={totalChars - chars || 0}
              trialCredits={typeof trialCredits === "number" ? trialCredits : 0}
              purchasedCredits={
                typeof purchasedCredits === "number" ? purchasedCredits : 0
              }
              migratablePurchasedCredits={
                typeof migratablePurchasedCredits === "number"
                  ? migratablePurchasedCredits
                  : 0
              }
              sparkCreditMigrationEnabled={sparkCreditMigrationEnabled}
              onBuyCredits={handleOpenAddCreditsModal}
              onMigrateSuccess={() => {
                void refreshBillingBootstrap(dispatch);
              }}
            />

            {isQuotaExceeded && (
              <Alert
                message={t("The quota has been used up")}
                type="warning"
                showIcon
              />
            )}
            <section className="pricing-section" id="pricing-plans">
              <div className="pricing-section__header">
                <div className="pricing-section__title-wrap">
                  <h2 className="pricing-section__title">{t("Plans")}</h2>
                </div>
                <Flex align="center" gap={8} wrap="wrap">
                  <Text type="secondary">{t("Monthly")}</Text>
                  <Switch checked={yearly} onChange={handleSetYearlyReport} />
                  <Text strong>{t("Yearly")}</Text>
                  <div className="yearly_save">
                    <Text strong>{t("Save 20%")}</Text>
                  </div>
                </Flex>
              </div>
              <Row gutter={[16, 16]}>
                {plans.map((item, index) => (
                  <Col
                    key={item.title}
                    xs={24}
                    sm={24}
                    md={12}
                    lg={paidPlanColSpan}
                    style={{
                      display: "flex",
                      width: "100%",
                    }}
                  >
                    <Card
                      className={`pricing-plan-card ${
                        item.disabled
                          ? "pricing-plan-card--current"
                          : item.isRecommended &&
                              plan.type === "Free" &&
                              plan.id
                            ? "pricing-plan-card--recommended"
                            : ""
                      }`}
                      style={{
                        flex: 1,
                        height: "100%",
                        display: "flex",
                        flexDirection: "column",
                        position: "relative",
                        minWidth: "220px",
                      }}
                      styles={{
                        body: {
                          flex: 1,
                          display: "flex",
                          flexDirection: "column",
                          padding: "20px",
                        },
                      }}
                      loading={!plan.id}
                    >
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-start",
                          gap: "12px",
                        }}
                      >
                        {item.disabled ? (
                          <AppStatusBadge tone="info">
                            {t("Current plan")}
                          </AppStatusBadge>
                        ) : item.isRecommended &&
                          plan.type === "Free" &&
                          plan.id ? (
                          <AppStatusBadge tone="caution">
                            {t("Recommended")}
                          </AppStatusBadge>
                        ) : null}
                        <div>
                          <Title level={4} style={{ margin: 0 }}>
                            {(() => {
                              const planLabel = getPlanDisplayLabel(item.title);
                              return yearly
                                ? t("pricing.plan.yearlyLabel", {
                                    plan: planLabel,
                                    period: t("pricing.plan.yearly"),
                                  })
                                : planLabel;
                            })()}
                          </Title>
                        </div>
                        <div>
                          <Text className="pricing-plan-card__price">
                            ${yearly ? item.yearlyPrice : item.monthlyPrice}
                          </Text>
                          <Text className="pricing-plan-card__unit">
                            {t("/month")}
                          </Text>
                        </div>
                      </div>
                      {yearly && (
                        <div className="pricing-plan-card__billing-note">
                          <strong>{t("Yearly billing")}</strong>
                          <div>
                            {t("$ {{amount}} billed once a year", {
                              amount: item.yearlyBillingAmount.toFixed(2),
                            })}
                          </div>
                        </div>
                      )}
                      <Button
                        id={`${item.title}-${yearly ? "yearly" : "month"}-${index}-0`}
                        className="pricing-plan-card__primary-action"
                        type={
                          item.isRecommended && !isNew ? "primary" : "default"
                        }
                        block
                        disabled={item.disabled || selectedPayPlanOption}
                        style={{ marginBottom: "20px" }}
                        onClick={() =>
                          handlePayForPlan({
                            plan: item,
                            trialDays: 0,
                            id: `${item.title}-${yearly ? "yearly" : "month"}-${index}-0`,
                          })
                        }
                        loading={
                          payForPlanButtonLoading ==
                          `${item.title}-${yearly ? "yearly" : "month"}-${index}-0`
                        }
                      >
                        {item.buttonText}
                      </Button>
                      {isNew && plan.type === "Free" && item.title === "Basic" ? (
                        <Button
                          id={`${item.title}-${yearly ? "yearly" : "month"}-${index}-5`}
                          type="default"
                          block
                          disabled={item.disabled || selectedPayPlanOption}
                          style={{ marginBottom: "20px" }}
                          onClick={() =>
                            handlePayForPlan({
                              plan: item,
                              trialDays: 5,
                              id: `${item.title}-${yearly ? "yearly" : "month"}-${index}-5`,
                            })
                          }
                          loading={
                            payForPlanButtonLoading ==
                            `${item.title}-${yearly ? "yearly" : "month"}-${index}-5`
                          }
                        >
                          {t("Free trial")}
                        </Button>
                      ) : null}
                      <div style={{ flex: 1 }}>
                        {item.features.map((feature, idx) => (
                          <div key={idx} className="pricing-plan-card__feature">
                            <CheckOutlined
                              style={{
                                color: "var(--p-color-text-success)",
                                fontSize: "12px",
                              }}
                            />
                            <Text style={{ fontSize: "13px" }}>{feature}</Text>
                          </div>
                        ))}
                      </div>
                    </Card>
                  </Col>
                ))}
              </Row>
              <div className="pricing-plan-downgrade">
                {plan.type === "Free" ? (
                  <Text type="secondary">
                    {t("You are currently on the free plan.")}
                  </Text>
                ) : (
                  <Text type="secondary">
                    {t("Looking for the free plan?")}{" "}
                    <Link
                      onClick={() => {
                        setCancelPlanWarnModal(true);
                        reportClick("pricing_plan_downgrade");
                      }}
                    >
                      {t("Switch to free plan")}
                    </Link>
                  </Text>
                )}
              </div>
            </section>
            <section className="pricing-section pricing-section--compact">
              <div className="pricing-section__header">
                <div className="pricing-section__title-wrap">
                  <h2 className="pricing-section__title">
                    {t("Compare plans")}
                  </h2>
                  <p className="pricing-comparison-scroll-hint">
                    {t("pricing.compare.scrollHint")}
                  </p>
                </div>
              </div>
              <div className="pricing-comparison-table-wrap">
                <Table
                  className="pricing-comparison-table"
                  dataSource={tableData}
                  columns={columns}
                  rowKey={(record) => String(record.key)}
                  pagination={false}
                  scroll={{ x: comparisonTableScrollX }}
                />
              </div>
            </section>
            <section className="pricing-section pricing-section--compact">
              <div className="pricing-section__header">
                <div className="pricing-section__title-wrap">
                  <h2 className="pricing-section__title">{t("FAQs")}</h2>
                </div>
              </div>
              <Collapse
                items={collapseData}
                onChange={() => {
                  reportClick("pricing_faq_click");
                }}
              />
            </section>
          </Space>
        </div>
      </div>
      <Modal
        title={t("Buy Credits")}
        open={addCreditsModalOpen}
        width={900}
        centered
        onCancel={() => setAddCreditsModalOpen(false)}
        footer={null}
      >
        <Space direction="vertical" size="small" style={{ width: "100%" }}>
          <div
            style={{
              textAlign: "left",
              display: "flex",
              alignItems: "flex-end",
              marginBottom: 10,
            }}
          >
            {/* <Title level={4} style={{ marginBottom: 0, marginRight: 10 }}>
              {t("Buy Credits")}
            </Title> */}
            <Text style={{ fontWeight: "bold" }}>
              {plan.type === "Premium"
                ? t("discountText.premium")
                : plan.type === "Pro"
                  ? t("discountText.pro")
                  : plan.type === "Basic"
                    ? t("discountText.basic")
                    : t("discountText.free")}
            </Text>
          </div>
          <Row gutter={[16, 16]}>
            {creditOptions.map((option) => (
              <Col key={option.key} xs={12} sm={12} md={6} lg={6} xl={6}>
                <Card
                  hoverable
                  style={{
                    textAlign: "center",
                    borderColor: "transparent",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    alignItems: "center",
                    height: "150px",
                    background:
                      JSON.stringify(selectedOptionKey) ===
                      JSON.stringify(option.key)
                        ? "var(--app-color-surface-selected)"
                        : "var(--app-color-surface)",
                    boxShadow: "var(--app-shadow-card)",
                  }}
                  onClick={() => setSelectedOption(option.key)}
                >
                  <Text
                    style={{
                      fontSize: "16px",
                      fontWeight: 500,
                      display: "block",
                      marginBottom: "8px",
                    }}
                  >
                    {option.Credits.toLocaleString()} {t("Credits")}
                  </Text>
                  {(plan.type === "Premium" ||
                    plan.type === "Pro" ||
                    plan.type === "Basic") &&
                  !plan?.isInFreePlanTime ? (
                    <>
                      <Title
                        level={3}
                        style={{
                          margin: 0,
                          color: "var(--app-color-text)",
                          fontWeight: 700,
                        }}
                      >
                        ${option.price.currentPrice.toFixed(2)}
                      </Title>
                      <Text
                        delete
                        type="secondary"
                        style={{ fontSize: "14px" }}
                      >
                        ${option.price.comparedPrice.toFixed(2)}
                      </Text>
                    </>
                  ) : (
                    <Title
                      level={3}
                      style={{
                        margin: 0,
                        color: "var(--app-color-text)",
                        fontWeight: 700,
                      }}
                    >
                      ${option.price.currentPrice.toFixed(2)}
                    </Title>
                  )}
                </Card>
              </Col>
            ))}
          </Row>
          <Flex align="center" justify="center">
            <Space direction="vertical" align="center">
              <Text type="secondary" style={{ margin: "16px 0 8px 0" }}>
                {t("Total pay")}: $
                {selectedOptionKey
                  ? creditOptions
                      .find((item) => item.key === selectedOptionKey)
                      ?.price.currentPrice.toFixed(2)
                  : "0.00"}
              </Text>
              <Button
                type="primary"
                size="large"
                disabled={!selectedOptionKey}
                loading={buyButtonLoading}
                onClick={handlePayForCredits}
              >
                {t("Buy now")}
              </Button>
            </Space>
          </Flex>
        </Space>
      </Modal>
      <Modal
        title={t("Cancel paid plan?")}
        open={cancelPlanWarnModal}
        centered
        onCancel={() => setCancelPlanWarnModal(false)}
        footer={
          <Flex align="end" justify="end" gap={10}>
            <Button
              loading={planCancelFetcher.state == "submitting"}
              onClick={handleCancelPlan}
            >
              {t("Switch to free plan")}
            </Button>
            <Button
              type="primary"
              onClick={() => setCancelPlanWarnModal(false)}
            >
              {t("Keep paid plan")}
            </Button>
          </Flex>
        }
      >
        <Text>
          {t(
            "Moving to the free plan will turn off key features. Are you sure you want to switch?",
          )}
        </Text>
      </Modal>
    </Page>
  );
};

export default Index;

//根据计划类型返回价格数据
export const eNumPlanType = ({
  planType,
  optionName,
  isInTrial,
}: {
  planType: string;
  optionName: string;
  isInTrial: boolean;
}) => {
  const findTableData = priceTable[optionName];

  if (!findTableData)
    return {
      currentPrice: 239.99,
      comparedPrice: 239.99,
      currencyCode: "USD",
    };

  // 免费期 = base 原价
  if (isInTrial) {
    return {
      currentPrice: findTableData.base,
      comparedPrice: findTableData.base,
      currencyCode: "USD",
    };
  }

  // 未知类型 → base
  const map: Record<string, number> = {
    Premium: findTableData.Premium,
    Pro: findTableData.Pro,
    Basic: findTableData.Basic,
  };

  const currentPrice = map[planType ?? ""] ?? findTableData.base;

  return {
    currentPrice,
    comparedPrice: findTableData.base,
    currencyCode: "USD",
  };
};
