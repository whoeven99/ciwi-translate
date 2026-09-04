import type { ThemeEmbedLoadStatus } from "./themeAppExtensions";

export type SetupGuideInput = {
  hasV4Job: boolean;
  hasOpenedCreateFlow: boolean;
  hasCurrency: boolean;
  ipOpen: boolean;
  embedStatus: ThemeEmbedLoadStatus;
  hasAutoTranslate: boolean;
};

export type SetupGuideState = {
  completedCount: number;
  totalCount: 3;
  translate: {
    complete: boolean;
    visible: boolean;
    steps: {
      clickTranslate: boolean;
      configureTask: boolean;
    };
  };
  switcher: {
    complete: boolean;
    visible: true;
    enabled: boolean;
    steps: {
      currency: boolean;
      themeEmbed: boolean;
      ipOpen: boolean;
    };
  };
  autoTranslate: {
    complete: boolean;
    visible: boolean;
  };
};

export function buildSetupGuideState(input: SetupGuideInput): SetupGuideState {
  const translateComplete = input.hasV4Job;
  const switcherEnabled = input.embedStatus === "active";
  const autoComplete = input.hasAutoTranslate;

  return {
    completedCount:
      Number(translateComplete) + Number(switcherEnabled) + Number(autoComplete),
    totalCount: 3,
    translate: {
      complete: translateComplete,
      visible: !translateComplete,
      steps: {
        clickTranslate: translateComplete || input.hasOpenedCreateFlow,
        configureTask: translateComplete,
      },
    },
    switcher: {
      complete: switcherEnabled,
      visible: true,
      enabled: switcherEnabled,
      steps: {
        currency: input.hasCurrency,
        themeEmbed: switcherEnabled,
        ipOpen: input.ipOpen,
      },
    },
    autoTranslate: {
      complete: autoComplete,
      visible: !autoComplete,
    },
  };
}
