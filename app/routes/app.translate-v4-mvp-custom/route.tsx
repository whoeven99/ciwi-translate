import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useLocation, useNavigate, useSearchParams } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { BlockStack, Button, InlineStack, Page, Text } from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import { useSelector } from "react-redux";
import { message } from "~/ui/message";
import { authenticate } from "~/shopify.server";
import type { RootState } from "~/store";
import { loadShopLocalesForTranslation } from "~/server/translateV4/shopLocales.server";
import type { CoverageSummary } from "~/server/translateV4/coverage.server";
import {
  AI_MODEL_OPTIONS,
  DEFAULT_AI_MODEL,
  DEFAULT_MODULE_KEYS,
} from "~/routes/app.translate-v4/constants";
import {
  buildUntranslatedRatioByLocale,
  useCreateTaskEstimate,
} from "~/routes/app.translate-v4/useCreateTaskEstimate";
import { formatV4CreateTasksMessage, translateV4Message } from "~/routes/app.translate-v4/v4I18n";
import { localeRegionCode } from "~/routes/app.translate-v4/localeDisplay";
import { CreateTaskCard } from "~/routes/app.translate-v4/components/CreateTaskCard";
import { CreateTaskConfirmModal } from "~/routes/app.translate-v4/components/CreateTaskConfirmModal";
import { v4ContentStyle } from "~/routes/app.translate-v4/v4Styles";
import { expandV2ModuleKeys } from "~/server/translateV4/moduleCatalog";
import {
  createTranslateV4Tasks,
  type ShopLocaleOption,
} from "~/lib/createTranslateV4Tasks";
import { normalizeShopQuota, type ShopQuota } from "~/lib/translationQuota";
import { shouldBlockCreateTaskByCredits } from "~/lib/createTranslateQuotaGuard";
import { openCreditsPurchaseModal } from "~/utils/creditsPurchaseModal";
import { buildCreateTaskCreditsPurchaseContext } from "~/utils/creditsPurchaseTaskContext";
import {
  clearCreateTaskDraft,
  loadCreateTaskDraft,
  saveCreateTaskDraft,
} from "~/utils/createTaskDraft";
import {
  parseBillingReturn,
  stripBillingReturnParams,
} from "~/utils/billingReturn";

const EMPTY_COVERAGE: CoverageSummary = {
  languageCount: 0,
  translatedItems: 0,
  totalItems: 0,
  overallPercent: null,
  locales: [],
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  let locales: ShopLocaleOption[] = [];
  let primaryLocale = "en";

  try {
    const loaded = await loadShopLocalesForTranslation({
      shop: session.shop,
      accessToken: session.accessToken as string,
    });
    locales = loaded.localeOptions;
    primaryLocale = loaded.primaryLocale;
  } catch (err) {
    console.error("[translate-v4-mvp-custom] load locales failed:", err);
  }

  return json({
    shop: session.shop,
    locales,
    primaryLocale,
  });
};

async function readJsonResponse<T = unknown>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(`Empty response body (${res.status})`);
  }
  return JSON.parse(text) as T;
}

function parseListParam(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBooleanParam(value: string | null): boolean {
  return value === "1" || value === "true";
}

export default function TranslateV4MvpCustomRoute() {
  const { t } = useTranslation();
  const { shop, locales, primaryLocale } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const plan = useSelector((state: RootState) => state.userConfig.plan);
  const isNew = useSelector((state: RootState) => state.userConfig.isNew);
  const billingDraftRestoredRef = useRef(false);

  const targetOptions = useMemo(
    () =>
      locales.filter((locale) => locale.value !== primaryLocale) as ShopLocaleOption[],
    [locales, primaryLocale],
  );

  const validTargets = useMemo(
    () => new Set(targetOptions.map((option) => option.value)),
    [targetOptions],
  );
  const validModules = useMemo(() => new Set<string>(DEFAULT_MODULE_KEYS), []);

  const initialTargets = useMemo(() => {
    const parsed = parseListParam(searchParams.get("targets")).filter((item) =>
      validTargets.has(item),
    );
    return parsed.length > 0 ? parsed : targetOptions.map((item) => item.value);
  }, [searchParams, targetOptions, validTargets]);

  const initialModules = useMemo(() => {
    const parsed = parseListParam(searchParams.get("modules")).filter((item) =>
      validModules.has(item),
    );
    return parsed.length > 0 ? parsed : DEFAULT_MODULE_KEYS;
  }, [searchParams, validModules]);

  const initialAiModel = useMemo(() => {
    const value = searchParams.get("aiModel");
    if (value && AI_MODEL_OPTIONS.some((item) => item.value === value)) {
      return value;
    }
    return DEFAULT_AI_MODEL;
  }, [searchParams]);

  const [coverage, setCoverage] = useState<CoverageSummary>(EMPTY_COVERAGE);
  const [, setCoverageLoading] = useState(true);
  const [quota, setQuota] = useState<ShopQuota | null>(null);
  const [, setQuotaLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createConfirmOpen, setCreateConfirmOpen] = useState(false);
  const [targets, setTargets] = useState<string[]>(initialTargets);
  const [modules, setModules] = useState<string[]>(initialModules);
  const [aiModel, setAiModel] = useState<string>(initialAiModel);
  const [isCover, setIsCover] = useState(parseBooleanParam(searchParams.get("isCover")));
  const [isHandle, setIsHandle] = useState(parseBooleanParam(searchParams.get("isHandle")));
  const [includeLiquid, setIncludeLiquid] = useState(
    parseBooleanParam(searchParams.get("includeLiquid")),
  );

  const normalizedQuota = useMemo(() => normalizeShopQuota(quota), [quota]);
  const remainingCredits = normalizedQuota?.remaining ?? null;
  const planType = plan?.type?.trim() || null;
  const normalizedPlanType = planType?.trim().toLowerCase() || "";
  const hasPaidPlan =
    normalizedPlanType !== "" && normalizedPlanType !== "free";
  const createDisabledMessage =
    normalizedQuota == null ? t("v4.create.quotaUnavailable") : null;
  const createShouldGateByCredits = shouldBlockCreateTaskByCredits({
    remainingCredits,
  });
  const createQuotaGatePending = createShouldGateByCredits && isNew == null;
  const createQuotaGateMode: "trial" | "pricing" | null =
    createShouldGateByCredits && isNew != null
      ? isNew
        ? "trial"
        : "pricing"
      : null;
  const untranslatedRatioByLocale = useMemo(
    () => buildUntranslatedRatioByLocale(coverage.locales),
    [coverage.locales],
  );

  const taskEstimate = useCreateTaskEstimate({
    modules,
    targets,
    isCover,
    includeLiquid,
    untranslatedRatioByLocale,
    remainingCredits,
  });
  const createConfirmScenario:
    | "ready"
    | "insufficient_paid"
    | "insufficient_trial"
    | "insufficient_pricing" =
    taskEstimate.needsMoreCredits
      ? hasPaidPlan
        ? "insufficient_paid"
        : createQuotaGateMode === "trial"
          ? "insufficient_trial"
          : "insufficient_pricing"
      : "ready";

  const persistCreateTaskDraft = useCallback(() => {
    saveCreateTaskDraft(shop, {
      targets,
      modules,
      aiModel,
      isCover,
      isHandle,
    });
  }, [aiModel, isCover, isHandle, modules, shop, targets]);

  const refreshCoverage = useCallback(async () => {
    setCoverageLoading(true);
    try {
      const res = await fetch(
        `/api/translate-v4/coverage?shopName=${encodeURIComponent(shop)}&cache=1`,
      );
      const data = await readJsonResponse<{ ok?: boolean; summary?: CoverageSummary }>(res);
      if (data.ok && data.summary) {
        setCoverage(data.summary);
      }
    } catch (err) {
      console.error("[translate-v4-mvp-custom] refresh coverage failed:", err);
      message.error(t("v4.actionFailedRetry"));
    } finally {
      setCoverageLoading(false);
    }
  }, [shop, t]);

  const refreshQuota = useCallback(async () => {
    setQuotaLoading(true);
    try {
      const res = await fetch(
        `/api/translate-v4/quota?shopName=${encodeURIComponent(shop)}`,
      );
      const data = await readJsonResponse<{ ok?: boolean; quota?: ShopQuota | null }>(res);
      if (data.ok) {
        setQuota(data.quota ?? null);
      }
    } catch (err) {
      console.error("[translate-v4-mvp-custom] refresh quota failed:", err);
    } finally {
      setQuotaLoading(false);
    }
  }, [shop]);

  useEffect(() => {
    void Promise.all([refreshCoverage(), refreshQuota()]);
  }, [refreshCoverage, refreshQuota]);

  useEffect(() => {
    if (billingDraftRestoredRef.current) return;
    const billing = parseBillingReturn(location.search);
    if (!billing) return;
    billingDraftRestoredRef.current = true;

    const cleanedPath = stripBillingReturnParams(
      `${location.pathname}${location.search}${location.hash}`,
    );
    navigate(cleanedPath, { replace: true });

    const draft = loadCreateTaskDraft(shop);
    if (!draft) return;

    const allowedTargets = new Set(targetOptions.map((option) => option.value));
    const restoredTargets = draft.targets.filter((locale) =>
      allowedTargets.has(locale),
    );
    const allowedModules = new Set<string>(DEFAULT_MODULE_KEYS);
    const restoredModules = draft.modules.filter((mod) =>
      allowedModules.has(mod),
    );
    const allowedModels = new Set(AI_MODEL_OPTIONS.map((option) => option.value));
    const restoredModel = allowedModels.has(draft.aiModel)
      ? draft.aiModel
      : DEFAULT_AI_MODEL;

    if (restoredTargets.length > 0) setTargets(restoredTargets);
    if (restoredModules.length > 0) setModules(restoredModules);
    setAiModel(restoredModel);
    setIsCover(draft.isCover);
    setIsHandle(draft.isHandle);
    setCreateConfirmOpen(true);
    void refreshQuota();
    message.info(t("v4.create.draftRestored"));
  }, [
    location.hash,
    location.pathname,
    location.search,
    navigate,
    refreshQuota,
    shop,
    t,
    targetOptions,
  ]);

  const handleCreateRequest = useCallback(() => {
    if (createQuotaGatePending) {
      message.info(
        t("Checking your trial eligibility. Please try again in a moment."),
      );
      return;
    }

    setCreateConfirmOpen(true);
  }, [createQuotaGatePending, t]);

  const handleCreateConfirm = useCallback(async () => {
    if (createQuotaGatePending) {
      message.info(
        t("Checking your trial eligibility. Please try again in a moment."),
      );
      return;
    }
    if (createQuotaGateMode !== null) return;
    if (remainingCredits == null) {
      message.info(t("v4.create.quotaUnavailable"));
      return;
    }

    setCreateConfirmOpen(false);
    clearCreateTaskDraft(shop);
    setCreating(true);
    try {
      const result = await createTranslateV4Tasks({
        source: primaryLocale,
        targets,
        modules: expandV2ModuleKeys(modules),
        aiModel,
        isCover,
        isHandle,
        includeLiquid,
        targetOptions,
        shop,
      });

      if (result.validationError) {
        message.warning(translateV4Message(result.validationError, t));
        return;
      }

      const resultMessage = formatV4CreateTasksMessage(result, t, localeRegionCode);
      if (result.created.length > 0) {
        message.success(resultMessage);
        if (result.failed.length > 0) {
          message.warning(
            result.failed
              .map(
                (item) =>
                  `${localeRegionCode(item.target)}: ${translateV4Message(item.error, t)}`,
              )
              .join("；"),
            6,
          );
        }
        navigate("/app/translate-v4-mvp?tab=queue");
      } else {
        message.error(resultMessage);
      }
    } catch (err) {
      console.error("[translate-v4-mvp-custom] create tasks failed:", err);
      message.error(t("v4.createFailedRetry"));
    } finally {
      setCreating(false);
    }
  }, [
    aiModel,
    createQuotaGateMode,
    createQuotaGatePending,
    includeLiquid,
    isCover,
    isHandle,
    modules,
    navigate,
    primaryLocale,
    remainingCredits,
    shop,
    t,
    targetOptions,
    targets,
  ]);

  return (
    <Page>
      <TitleBar title={t("v4Mvp.customPage.title")} />
      <div style={v4ContentStyle}>
        <BlockStack gap="500">
          <BlockStack gap="200">
            <InlineStack gap="300" blockAlign="center">
              <Button onClick={() => navigate("/app/translate-v4-mvp")}>
                {t("v4Mvp.customPage.back")}
              </Button>
              <Text as="h1" variant="headingLg">
                {t("v4Mvp.customPage.title")}
              </Text>
            </InlineStack>
            <Text as="p" tone="subdued" variant="bodyMd">
              {t("v4Mvp.customPage.subtitle")}
            </Text>
          </BlockStack>

          <CreateTaskCard
            targetOptions={targetOptions}
            targets={targets}
            onTargetsChange={setTargets}
            modules={modules}
            onModulesChange={setModules}
            creating={creating}
            createDisabled={normalizedQuota == null}
            disabledMessage={createDisabledMessage}
            onCreate={handleCreateRequest}
            aiModel={aiModel}
            onAiModelChange={setAiModel}
            isCover={isCover}
            onIsCoverChange={setIsCover}
            isHandle={isHandle}
            onIsHandleChange={setIsHandle}
            includeLiquid={includeLiquid}
            onIncludeLiquidChange={setIncludeLiquid}
            estimate={taskEstimate}
          />
        </BlockStack>
      </div>
      <CreateTaskConfirmModal
        open={createConfirmOpen}
        creating={creating}
        targetOptions={targetOptions}
        targets={targets}
        modules={modules}
        aiModel={aiModel}
        isCover={isCover}
        isHandle={isHandle}
        includeLiquid={includeLiquid}
        sourceLocale={primaryLocale}
        estimate={taskEstimate}
        scenario={createConfirmScenario}
        quotaOfferMode={hasPaidPlan ? "paid" : isNew === true ? "trial" : "pricing"}
        onClose={() => setCreateConfirmOpen(false)}
        onConfirmCreate={handleCreateConfirm}
        onBeforeBilling={persistCreateTaskDraft}
        onBuyCredits={(detailedCredits) => {
          setCreateConfirmOpen(false);
          openCreditsPurchaseModal(
            buildCreateTaskCreditsPurchaseContext({
              estimatedCredits:
                detailedCredits ?? taskEstimate?.estimatedCredits ?? null,
              currentRemainingCredits: remainingCredits,
              targetsCount: targets.length,
              modulesCount: modules.length,
            }),
          );
        }}
      />
    </Page>
  );
}
