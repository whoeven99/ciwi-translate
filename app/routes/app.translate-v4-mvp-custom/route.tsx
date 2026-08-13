import { useCallback, useEffect, useMemo, useState } from "react";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate, useSearchParams } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { useSelector } from "react-redux";
import { BlockStack, Page, Text } from "@shopify/polaris";
import { useTranslation } from "react-i18next";
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
import { formatV4CreateTasksMessage } from "~/routes/app.translate-v4/v4I18n";
import { localeRegionCode } from "~/routes/app.translate-v4/localeDisplay";
import { PageHeaderBar } from "~/routes/app.translate-v4/components/SummaryAndHeader";
import { CreateTaskCard } from "~/routes/app.translate-v4/components/CreateTaskCard";
import { v4CardStyle, v4Colors, v4ContentStyle } from "~/routes/app.translate-v4/v4Styles";
import {
  createTranslateV4Tasks,
  type ShopLocaleOption,
} from "~/lib/createTranslateV4Tasks";
import { normalizeShopQuota, type ShopQuota } from "~/lib/translationQuota";

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
  const [searchParams] = useSearchParams();
  const plan = useSelector((state: RootState) => state.userConfig.plan);

  const targetOptions = useMemo(
    () =>
      locales.filter((locale) => locale.value !== primaryLocale) as ShopLocaleOption[],
    [locales, primaryLocale],
  );

  const validTargets = useMemo(
    () => new Set(targetOptions.map((option) => option.value)),
    [targetOptions],
  );
  const validModules = useMemo(() => new Set(DEFAULT_MODULE_KEYS), []);

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

  const [targets, setTargets] = useState<string[]>(initialTargets);
  const [modules, setModules] = useState<string[]>(initialModules);
  const [aiModel, setAiModel] = useState<string>(initialAiModel);
  const [isCover, setIsCover] = useState(parseBooleanParam(searchParams.get("isCover")));
  const [isHandle, setIsHandle] = useState(parseBooleanParam(searchParams.get("isHandle")));
  const [includeLiquid, setIncludeLiquid] = useState(
    parseBooleanParam(searchParams.get("includeLiquid")),
  );

  const planType = plan?.type?.trim() || null;
  const normalizedQuota = useMemo(() => normalizeShopQuota(quota), [quota]);
  const createDisabledMessage =
    normalizedQuota == null ? t("v4.create.quotaUnavailable") : null;
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
    remainingCredits: normalizedQuota?.remaining ?? null,
  });

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

  const handleCreate = useCallback(async () => {
    setCreating(true);
    try {
      const result = await createTranslateV4Tasks({
        source: primaryLocale,
        targets,
        modules,
        aiModel,
        isCover,
        isHandle,
        includeLiquid,
        targetOptions,
        shop,
      });

      const resultMessage = formatV4CreateTasksMessage(result, t, localeRegionCode);
      if (result.created.length > 0) {
        message.success(resultMessage);
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
    includeLiquid,
    isCover,
    isHandle,
    modules,
    navigate,
    primaryLocale,
    shop,
    t,
    targetOptions,
    targets,
  ]);

  return (
    <Page
      backAction={{ content: t("v4Mvp.customPage.back"), onAction: () => navigate("/app/translate-v4-mvp") }}
    >
      <TitleBar title={t("v4.title")} />
      <div style={v4ContentStyle}>
        <BlockStack gap="500">
          <PageHeaderBar credits={normalizedQuota?.remaining ?? null} planType={planType} />

          <div style={customHeroCardStyle}>
            <BlockStack gap="100">
              <Text as="span" variant="bodySm" tone="subdued">
                {t("v4Mvp.customPage.title")}
              </Text>
              <Text as="h2" variant="headingLg">
                {t("v4Mvp.customPage.subtitle")}
              </Text>
            </BlockStack>
          </div>

          <div style={customShellStyle}>
            <CreateTaskCard
              targetOptions={targetOptions}
              targets={targets}
              onTargetsChange={setTargets}
              modules={modules}
              onModulesChange={setModules}
              creating={creating}
              createDisabled={normalizedQuota == null}
              disabledMessage={createDisabledMessage}
              onCreate={() => void handleCreate()}
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
          </div>
        </BlockStack>
      </div>
    </Page>
  );
}

const customHeroCardStyle = {
  ...v4CardStyle,
  padding: "22px 24px",
  background: v4Colors.summaryBg,
  boxShadow: "var(--app-shadow-card-strong)",
} as const;

const customShellStyle = {
  ...v4CardStyle,
  padding: "18px",
  background:
    "linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(250,251,253,0.98) 100%)",
  boxShadow: "var(--app-shadow-card-strong)",
} as const;
