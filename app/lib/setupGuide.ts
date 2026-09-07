import type { ThemeEmbedLoadStatus } from "./themeAppExtensions";

export const SETUP_GUIDE_TASK_IDS = ["translate", "glossary", "thirdParty"] as const;
export type SetupGuideTaskId = (typeof SETUP_GUIDE_TASK_IDS)[number];

export type SetupGuideInput = {
  hasV4Job: boolean;
  hasOpenedCreateFlow: boolean;
  hasGlossary: boolean;
  embedStatus: ThemeEmbedLoadStatus;
  hasIncludeLiquidJob: boolean;
};

export type SetupGuideState = {
  completedCount: number;
  totalCount: 3;
  translate: {
    complete: boolean;
    steps: {
      clickTranslate: boolean;
      configureTask: boolean;
    };
  };
  glossary: {
    complete: boolean;
    steps: {
      addRule: boolean;
    };
  };
  thirdParty: {
    complete: boolean;
    steps: {
      themeEmbed: boolean;
      includeLiquid: boolean;
    };
  };
};

export function buildSetupGuideState(input: SetupGuideInput): SetupGuideState {
  const translateComplete = input.hasV4Job;
  const glossaryComplete = input.hasGlossary;
  const themeEmbed = input.embedStatus === "active";
  const includeLiquid = input.hasIncludeLiquidJob;
  const thirdPartyComplete = themeEmbed && includeLiquid;

  return {
    completedCount:
      Number(translateComplete) + Number(glossaryComplete) + Number(thirdPartyComplete),
    totalCount: 3,
    translate: {
      complete: translateComplete,
      steps: {
        clickTranslate: translateComplete || input.hasOpenedCreateFlow,
        configureTask: translateComplete,
      },
    },
    glossary: {
      complete: glossaryComplete,
      steps: {
        addRule: glossaryComplete,
      },
    },
    thirdParty: {
      complete: thirdPartyComplete,
      steps: {
        themeEmbed,
        includeLiquid,
      },
    },
  };
}

export function shouldAutoDismissSetupGuide(state: SetupGuideState): boolean {
  return (
    state.translate.complete &&
    state.glossary.complete &&
    state.thirdParty.complete
  );
}

export function firstIncompleteSetupGuideTask(state: SetupGuideState): SetupGuideTaskId {
  if (!state.translate.complete) return "translate";
  if (!state.glossary.complete) return "glossary";
  return "thirdParty";
}
