import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useFetcher } from "@remix-run/react";
import { Page, BlockStack, Button, Text } from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import { message } from "~/ui/message";
import { reportClientLog } from "~/utils/clientLog";
import { createTranslateV4Tasks } from "~/lib/createTranslateV4Tasks";
import { expandV2ModuleKeys } from "~/server/translateV4/moduleCatalog";
import { DEFAULT_AI_MODEL } from "~/routes/app.translate-v4/constants";
import type { OnboardingSummary } from "../types";
import { PreparingStep, type PreparingPhase } from "./PreparingStep";
import { RecommendationStep } from "./RecommendationStep";

type Step = "preparing" | "recommendation";
type PrimaryCtaKind = "create" | "trial" | "upgrade" | "configure";

function resolvePrimaryCta(summary: OnboardingSummary): PrimaryCtaKind {
  const hasTargets = summary.locales.suggestedTargets.length > 0;
  if (!hasTargets) return "configure";
  const needsMore =
    summary.estimate?.needsMoreCredits ??
    summary.bootstrap.remainingCredits <= 0;
  if (!needsMore) return "create";
  return summary.bootstrap.isNew === true ? "trial" : "upgrade";
}

export function OnboardingFlow({ summary }: { summary: OnboardingSummary }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const [hydrated, setHydrated] = useState(false);
  const [step, setStep] = useState<Step>("preparing");
  const [phase, setPhase] = useState<PreparingPhase>("boot");
  const [creating, setCreating] = useState(false);
  const viewedRef = useRef(false);
  const prepareStartedRef = useRef(false);

  const primaryCta = useMemo(() => resolvePrimaryCta(summary), [summary]);

  useEffect(() => {
    setHydrated(true);
  }, []);

  const track = useCallback(
    (event: string, context?: Record<string, unknown>) => {
      void reportClientLog(
        {
          event,
          kind: "action",
          level: "info",
          status: "success",
          shop: summary.shop,
          route: "/app/onboarding",
          context,
        },
        { beacon: true },
      );
    },
    [summary.shop],
  );

  useEffect(() => {
    if (viewedRef.current) return;
    viewedRef.current = true;
    track("onboarding_viewed", { primaryCta });
  }, [track, primaryCta]);

  useEffect(() => {
    if (step !== "preparing" || prepareStartedRef.current) return;
    prepareStartedRef.current = true;

    let cancelled = false;

    void (async () => {
      setPhase("locales");
      await new Promise((resolve) => window.setTimeout(resolve, 220));
      if (cancelled) return;

      setPhase("market");
      await new Promise((resolve) => window.setTimeout(resolve, 220));
      if (cancelled) return;

      setPhase("recommendation");
      await new Promise((resolve) => window.setTimeout(resolve, 180));
      if (cancelled) return;

      setPhase("done");
      setStep("recommendation");
      track("onboarding_preparing_completed", {
        marketCount: summary.markets.length,
        suggestedTargets: summary.locales.suggestedTargets,
      });
      track("onboarding_recommendation_viewed", {
        marketCount: summary.markets.length,
        suggestedTargets: summary.locales.suggestedTargets,
        primaryCta,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [primaryCta, step, summary.locales.suggestedTargets, summary.markets.length, track]);

  const postIntent = useCallback(
    (intent: "skip" | "complete" | "trial") => {
      fetcher.submit({ intent }, { method: "POST" });
    },
    [fetcher],
  );

  const handleSkip = useCallback(() => {
    track("onboarding_skipped");
    postIntent("skip");
    navigate("/app/translate-v4");
  }, [navigate, postIntent, track]);

  const handleConfigureLanguages = useCallback(() => {
    track("onboarding_configure_languages");
    navigate("/app/language");
  }, [navigate, track]);

  const handleTrialOrUpgrade = useCallback(() => {
    track(
      primaryCta === "trial"
        ? "onboarding_trial_clicked"
        : "onboarding_upgrade_clicked",
    );
    postIntent("trial");
    navigate("/app/pricing");
  }, [navigate, postIntent, primaryCta, track]);

  const handleCreateTask = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      const targetOptions = summary.locales.availableTargets.map((target) => ({
        value: target.value,
        label: target.label,
      }));
      const result = await createTranslateV4Tasks({
        source: summary.locales.source,
        targets: summary.locales.suggestedTargets,
        modules: expandV2ModuleKeys(summary.recommendation.suggestedModuleKeys),
        aiModel: DEFAULT_AI_MODEL,
        isCover: false,
        isHandle: false,
        targetOptions,
        shop: summary.shop,
      });

      if (result.validationError) {
        message.warning(t("onboarding.action.createInvalid"));
        setCreating(false);
        return;
      }
      if (result.created.length === 0) {
        message.error(t("onboarding.action.createFailed"));
        setCreating(false);
        return;
      }

      track("onboarding_task_created", {
        created: result.created.length,
        failed: result.failed.length,
      });
      message.success(t("onboarding.action.createSuccess"));
      postIntent("complete");
      navigate("/app/translate-v4");
    } catch (error) {
      console.error("[onboarding] create task failed:", error);
      message.error(t("onboarding.action.createFailed"));
      setCreating(false);
    }
  }, [creating, navigate, postIntent, summary, t, track]);

  const handlePrimary = useCallback(() => {
    switch (primaryCta) {
      case "create":
        void handleCreateTask();
        return;
      case "trial":
      case "upgrade":
        handleTrialOrUpgrade();
        return;
      case "configure":
        handleConfigureLanguages();
        return;
      default:
        return;
    }
  }, [handleConfigureLanguages, handleCreateTask, handleTrialOrUpgrade, primaryCta]);

  if (!hydrated) {
    return (
      <Page>
        <PreparingStep summary={summary} phase="boot" />
      </Page>
    );
  }

  return (
    <Page>
      <BlockStack gap="500">
        {step === "recommendation" ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto 1fr",
              alignItems: "center",
              gap: "12px",
              paddingBottom: "8px",
            }}
          >
            <div style={{ justifySelf: "start" }}>
              <Button variant="plain" onClick={handleSkip}>
                {t("onboarding.action.skip")}
              </Button>
            </div>
            <Text as="h1" variant="headingLg" alignment="center">
              {t("onboarding.pageTitle")}
            </Text>
            <div style={{ justifySelf: "end" }}>
              <Button
                variant="primary"
                size="large"
                loading={creating && primaryCta === "create"}
                onClick={handlePrimary}
              >
                {t("onboarding.action.translateNow")}
              </Button>
            </div>
          </div>
        ) : null}

        {step === "preparing" ? (
          <PreparingStep summary={summary} phase={phase} />
        ) : (
          <RecommendationStep summary={summary} />
        )}
      </BlockStack>
    </Page>
  );
}
