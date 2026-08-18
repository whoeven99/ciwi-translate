/**
 * Onboarding 展示层类型（无服务端依赖，可被客户端组件安全 import）。
 * 服务端聚合逻辑见 `app/server/onboarding/onboarding.server.ts`。
 */
export type OnboardingStatus =
  | "not_started"
  | "preparing"
  | "recommended"
  | "skipped"
  | "completed";

export type OnboardingLocaleOption = {
  value: string;
  label: string;
  published: boolean;
};

export type OnboardingMarket = {
  name: string;
  handle: string;
  status: string;
  baseCurrency: string | null;
  locales: string[];
};

export type SerializedOnboardingState = {
  shop: string;
  status: OnboardingStatus;
  firstEnteredAt: string | null;
  skippedAt: string | null;
  completedAt: string | null;
  startedTrialFromOnboarding: boolean;
  createdFirstTaskFromOnboarding: boolean;
  recommendedTargets: string[];
  recommendedModules: string[];
  estimateCredits: number | null;
  estimateMinutes: number | null;
  sourceScanId: string | null;
};

export type OnboardingSummary = {
  shop: string;
  onboardingState: SerializedOnboardingState | null;
  bootstrap: {
    planType: string;
    isNew: boolean | null;
    isInFreePlanTime: boolean;
    remainingCredits: number;
  };
  locales: {
    source: string;
    availableTargets: OnboardingLocaleOption[];
    suggestedTargets: string[];
  };
  markets: OnboardingMarket[];
  recommendation: {
    suggestedModuleKeys: string[];
    reasons: string[];
    localizationNotes: Array<{ locale: string; label: string; note: string }>;
    shopProfile: {
      industry: string | null;
      brandTone: string | null;
      description: string | null;
    } | null;
  };
  estimate: {
    credits: number | null;
    minutes: number | null;
    isUpperBound: boolean;
    needsMoreCredits: boolean;
  } | null;
};
