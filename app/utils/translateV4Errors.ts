export const TRANSLATE_V4_ERROR_KEYS = {
  INVALID_REQUEST: "INVALID_REQUEST",
  UNKNOWN_ACTION: "UNKNOWN_ACTION",
  INVALID_ID: "INVALID_ID",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  GLOSSARY_REQUIRED_FIELDS: "GLOSSARY_REQUIRED_FIELDS",
  GLOSSARY_ID_REQUIRED: "GLOSSARY_ID_REQUIRED",
  GLOSSARY_NOT_FOUND: "GLOSSARY_NOT_FOUND",
  GLOSSARY_DELETE_FAILED: "GLOSSARY_DELETE_FAILED",
  GLOSSARY_LIST_FAILED: "GLOSSARY_LIST_FAILED",
  GLOSSARY_SAVE_FAILED: "GLOSSARY_SAVE_FAILED",
  LIQUID_REQUIRED_FIELDS: "LIQUID_REQUIRED_FIELDS",
  LIQUID_ID_REQUIRED: "LIQUID_ID_REQUIRED",
  LIQUID_DUPLICATE_RULE: "LIQUID_DUPLICATE_RULE",
  LIQUID_NOT_FOUND: "LIQUID_NOT_FOUND",
  LIQUID_LIST_FAILED: "LIQUID_LIST_FAILED",
  LIQUID_SAVE_FAILED: "LIQUID_SAVE_FAILED",
  LIQUID_DELETE_FAILED: "LIQUID_DELETE_FAILED",
  CURRENCY_CODE_REQUIRED: "CURRENCY_CODE_REQUIRED",
  CURRENCY_NOT_FOUND: "CURRENCY_NOT_FOUND",
  CURRENCY_LIST_FAILED: "CURRENCY_LIST_FAILED",
  CURRENCY_UPDATE_FAILED: "CURRENCY_UPDATE_FAILED",
  CURRENCY_DELETE_FAILED: "CURRENCY_DELETE_FAILED",
  PAGEFLY_LANGUAGE_REQUIRED: "PAGEFLY_LANGUAGE_REQUIRED",
  PAGEFLY_INVALID_ITEMS: "PAGEFLY_INVALID_ITEMS",
  PAGEFLY_LIST_FAILED: "PAGEFLY_LIST_FAILED",
  PAGEFLY_SAVE_FAILED: "PAGEFLY_SAVE_FAILED",
  SWITCHER_LOAD_FAILED: "SWITCHER_LOAD_FAILED",
  SWITCHER_SAVE_FAILED: "SWITCHER_SAVE_FAILED",
  SINGLE_TARGET_REQUIRED: "SINGLE_TARGET_REQUIRED",
  SINGLE_TRANSLATE_FAILED: "SINGLE_TRANSLATE_FAILED",
  TARGET_LOCALE_REQUIRED: "TARGET_LOCALE_REQUIRED",
  TARGET_LOCALE_LIST_FAILED: "TARGET_LOCALE_LIST_FAILED",
  TARGET_LOCALE_SAVE_FAILED: "TARGET_LOCALE_SAVE_FAILED",
  TARGET_LOCALE_AUTO_SETTINGS_INVALID: "TARGET_LOCALE_AUTO_SETTINGS_INVALID",
  LANGUAGE_PUBLISH_PARTIAL_FAILED: "LANGUAGE_PUBLISH_PARTIAL_FAILED",
  LANGUAGE_PUBLISH_FAILED: "LANGUAGE_PUBLISH_FAILED",
} as const;

export type TranslateV4ErrorKey =
  (typeof TRANSLATE_V4_ERROR_KEYS)[keyof typeof TRANSLATE_V4_ERROR_KEYS];

type TranslateV4ErrorDefinition = {
  errorCode: number;
  errorMsg: TranslateV4ErrorKey;
  i18nKey: string;
  defaultMessage: string;
  status: number;
};

const TRANSLATE_V4_ERROR_DEFINITIONS: Record<
  TranslateV4ErrorKey,
  TranslateV4ErrorDefinition
> = {
  INVALID_REQUEST: {
    errorCode: 40000,
    errorMsg: "INVALID_REQUEST",
    i18nKey: "v4.error.invalidRequest",
    defaultMessage: "Invalid request.",
    status: 400,
  },
  UNKNOWN_ACTION: {
    errorCode: 40001,
    errorMsg: "UNKNOWN_ACTION",
    i18nKey: "v4.error.unknownAction",
    defaultMessage: "Unsupported action.",
    status: 400,
  },
  INVALID_ID: {
    errorCode: 40002,
    errorMsg: "INVALID_ID",
    i18nKey: "v4.error.invalidId",
    defaultMessage: "Invalid resource identifier.",
    status: 400,
  },
  INTERNAL_ERROR: {
    errorCode: 50000,
    errorMsg: "INTERNAL_ERROR",
    i18nKey: "v4.error.internal",
    defaultMessage: "Action failed. Please try again later.",
    status: 500,
  },
  GLOSSARY_REQUIRED_FIELDS: {
    errorCode: 44100,
    errorMsg: "GLOSSARY_REQUIRED_FIELDS",
    i18nKey: "v4.error.glossaryRequiredFields",
    defaultMessage: "Source text and target text are required.",
    status: 400,
  },
  GLOSSARY_ID_REQUIRED: {
    errorCode: 44101,
    errorMsg: "GLOSSARY_ID_REQUIRED",
    i18nKey: "v4.error.glossaryIdRequired",
    defaultMessage: "Glossary ID is required.",
    status: 400,
  },
  GLOSSARY_NOT_FOUND: {
    errorCode: 44404,
    errorMsg: "GLOSSARY_NOT_FOUND",
    i18nKey: "v4.error.glossaryNotFound",
    defaultMessage: "The glossary rule no longer exists.",
    status: 404,
  },
  GLOSSARY_DELETE_FAILED: {
    errorCode: 44502,
    errorMsg: "GLOSSARY_DELETE_FAILED",
    i18nKey: "v4.error.glossaryDeleteFailed",
    defaultMessage: "Failed to delete glossary rule.",
    status: 500,
  },
  GLOSSARY_LIST_FAILED: {
    errorCode: 44503,
    errorMsg: "GLOSSARY_LIST_FAILED",
    i18nKey: "v4.error.glossaryListFailed",
    defaultMessage: "Failed to load glossary rules.",
    status: 500,
  },
  GLOSSARY_SAVE_FAILED: {
    errorCode: 44504,
    errorMsg: "GLOSSARY_SAVE_FAILED",
    i18nKey: "v4.error.glossarySaveFailed",
    defaultMessage: "Failed to save glossary rule.",
    status: 500,
  },
  LIQUID_REQUIRED_FIELDS: {
    errorCode: 44300,
    errorMsg: "LIQUID_REQUIRED_FIELDS",
    i18nKey: "v4.error.liquidRequiredFields",
    defaultMessage: "Source text, target text, and language are required.",
    status: 400,
  },
  LIQUID_ID_REQUIRED: {
    errorCode: 44301,
    errorMsg: "LIQUID_ID_REQUIRED",
    i18nKey: "v4.error.liquidIdRequired",
    defaultMessage: "Liquid rule ID is required.",
    status: 400,
  },
  LIQUID_DUPLICATE_RULE: {
    errorCode: 44309,
    errorMsg: "LIQUID_DUPLICATE_RULE",
    i18nKey: "v4.error.liquidDuplicateRule",
    defaultMessage: "A liquid rule with the same source text already exists.",
    status: 409,
  },
  LIQUID_NOT_FOUND: {
    errorCode: 44304,
    errorMsg: "LIQUID_NOT_FOUND",
    i18nKey: "v4.error.liquidNotFound",
    defaultMessage: "The liquid rule no longer exists.",
    status: 404,
  },
  LIQUID_LIST_FAILED: {
    errorCode: 44510,
    errorMsg: "LIQUID_LIST_FAILED",
    i18nKey: "v4.error.liquidListFailed",
    defaultMessage: "Failed to load liquid rules.",
    status: 500,
  },
  LIQUID_SAVE_FAILED: {
    errorCode: 44511,
    errorMsg: "LIQUID_SAVE_FAILED",
    i18nKey: "v4.error.liquidSaveFailed",
    defaultMessage: "Failed to save liquid rule.",
    status: 500,
  },
  LIQUID_DELETE_FAILED: {
    errorCode: 44512,
    errorMsg: "LIQUID_DELETE_FAILED",
    i18nKey: "v4.error.liquidDeleteFailed",
    defaultMessage: "Failed to delete liquid rule.",
    status: 500,
  },
  CURRENCY_CODE_REQUIRED: {
    errorCode: 44200,
    errorMsg: "CURRENCY_CODE_REQUIRED",
    i18nKey: "v4.error.currencyCodeRequired",
    defaultMessage: "Currency code is required.",
    status: 400,
  },
  CURRENCY_NOT_FOUND: {
    errorCode: 44204,
    errorMsg: "CURRENCY_NOT_FOUND",
    i18nKey: "v4.error.currencyNotFound",
    defaultMessage: "The currency record no longer exists.",
    status: 404,
  },
  CURRENCY_LIST_FAILED: {
    errorCode: 44520,
    errorMsg: "CURRENCY_LIST_FAILED",
    i18nKey: "v4.error.currencyListFailed",
    defaultMessage: "Failed to load currencies.",
    status: 500,
  },
  CURRENCY_UPDATE_FAILED: {
    errorCode: 44521,
    errorMsg: "CURRENCY_UPDATE_FAILED",
    i18nKey: "v4.error.currencyUpdateFailed",
    defaultMessage: "Failed to update currency.",
    status: 500,
  },
  CURRENCY_DELETE_FAILED: {
    errorCode: 44522,
    errorMsg: "CURRENCY_DELETE_FAILED",
    i18nKey: "v4.error.currencyDeleteFailed",
    defaultMessage: "Failed to delete currency.",
    status: 500,
  },
  PAGEFLY_LANGUAGE_REQUIRED: {
    errorCode: 44600,
    errorMsg: "PAGEFLY_LANGUAGE_REQUIRED",
    i18nKey: "v4.error.pageflyLanguageRequired",
    defaultMessage: "Language code is required.",
    status: 400,
  },
  PAGEFLY_INVALID_ITEMS: {
    errorCode: 44601,
    errorMsg: "PAGEFLY_INVALID_ITEMS",
    i18nKey: "v4.error.pageflyInvalidItems",
    defaultMessage: "No valid PageFly items were provided.",
    status: 400,
  },
  PAGEFLY_LIST_FAILED: {
    errorCode: 44610,
    errorMsg: "PAGEFLY_LIST_FAILED",
    i18nKey: "v4.error.pageflyListFailed",
    defaultMessage: "Failed to load PageFly translations.",
    status: 500,
  },
  PAGEFLY_SAVE_FAILED: {
    errorCode: 44611,
    errorMsg: "PAGEFLY_SAVE_FAILED",
    i18nKey: "v4.error.pageflySaveFailed",
    defaultMessage: "Failed to save PageFly translations.",
    status: 500,
  },
  SWITCHER_LOAD_FAILED: {
    errorCode: 44710,
    errorMsg: "SWITCHER_LOAD_FAILED",
    i18nKey: "v4.error.switcherLoadFailed",
    defaultMessage: "Failed to load switcher configuration.",
    status: 500,
  },
  SWITCHER_SAVE_FAILED: {
    errorCode: 44711,
    errorMsg: "SWITCHER_SAVE_FAILED",
    i18nKey: "v4.error.switcherSaveFailed",
    defaultMessage: "Failed to save switcher configuration.",
    status: 500,
  },
  SINGLE_TARGET_REQUIRED: {
    errorCode: 44800,
    errorMsg: "SINGLE_TARGET_REQUIRED",
    i18nKey: "v4.error.singleTargetRequired",
    defaultMessage: "Target language is required.",
    status: 400,
  },
  SINGLE_TRANSLATE_FAILED: {
    errorCode: 44810,
    errorMsg: "SINGLE_TRANSLATE_FAILED",
    i18nKey: "v4.error.singleTranslateFailed",
    defaultMessage: "Failed to translate this field.",
    status: 500,
  },
  TARGET_LOCALE_REQUIRED: {
    errorCode: 44900,
    errorMsg: "TARGET_LOCALE_REQUIRED",
    i18nKey: "v4.error.targetLocaleRequired",
    defaultMessage: "Locale is required.",
    status: 400,
  },
  TARGET_LOCALE_LIST_FAILED: {
    errorCode: 44910,
    errorMsg: "TARGET_LOCALE_LIST_FAILED",
    i18nKey: "v4.error.targetLocaleListFailed",
    defaultMessage: "Failed to load language settings.",
    status: 500,
  },
  TARGET_LOCALE_SAVE_FAILED: {
    errorCode: 44911,
    errorMsg: "TARGET_LOCALE_SAVE_FAILED",
    i18nKey: "v4.error.targetLocaleSaveFailed",
    defaultMessage: "Failed to update language settings.",
    status: 500,
  },
  TARGET_LOCALE_AUTO_SETTINGS_INVALID: {
    errorCode: 44912,
    errorMsg: "TARGET_LOCALE_AUTO_SETTINGS_INVALID",
    i18nKey: "v4.error.autoSettingsInvalid",
    defaultMessage:
      "Choose a valid update hour (0–23) and at least one auto-translate module.",
    status: 400,
  },
  LANGUAGE_PUBLISH_PARTIAL_FAILED: {
    errorCode: 45010,
    errorMsg: "LANGUAGE_PUBLISH_PARTIAL_FAILED",
    i18nKey: "v4.error.languagePublishPartialFailed",
    defaultMessage:
      "Language publish status was saved, but some domains could not be updated. Please review each domain.",
    status: 500,
  },
  LANGUAGE_PUBLISH_FAILED: {
    errorCode: 45011,
    errorMsg: "LANGUAGE_PUBLISH_FAILED",
    i18nKey: "v4.error.languagePublishFailed",
    defaultMessage:
      "Failed to update language publish settings. Please try again.",
    status: 500,
  },
};

export function getTranslateV4ErrorDefinition(
  errorKey: TranslateV4ErrorKey | string | null | undefined,
) {
  if (!errorKey) return null;
  return (
    TRANSLATE_V4_ERROR_DEFINITIONS[
      errorKey as keyof typeof TRANSLATE_V4_ERROR_DEFINITIONS
    ] ?? null
  );
}

export function buildTranslateV4Error(
  errorKey: TranslateV4ErrorKey,
  overrides?: Partial<Pick<TranslateV4ErrorDefinition, "status">>,
) {
  const definition = TRANSLATE_V4_ERROR_DEFINITIONS[errorKey];
  return {
    ...definition,
    ...overrides,
  };
}

export function getTranslateV4ErrorMessage(
  t: (key: string) => string,
  errorMsg: string | null | undefined,
  fallbackKey: TranslateV4ErrorKey = TRANSLATE_V4_ERROR_KEYS.INTERNAL_ERROR,
) {
  const definition =
    getTranslateV4ErrorDefinition(errorMsg) ??
    getTranslateV4ErrorDefinition(fallbackKey);
  if (!definition) return t("v4.actionFailedRetry");

  const translated = t(definition.i18nKey);
  return translated === definition.i18nKey
    ? definition.defaultMessage
    : translated;
}

export function getTranslateV4ErrorDefaultMessage(
  errorMsg: string | null | undefined,
  fallbackKey: TranslateV4ErrorKey = TRANSLATE_V4_ERROR_KEYS.INTERNAL_ERROR,
) {
  const definition =
    getTranslateV4ErrorDefinition(errorMsg) ??
    getTranslateV4ErrorDefinition(fallbackKey);
  return definition?.defaultMessage ?? "Action failed. Please try again later.";
}
