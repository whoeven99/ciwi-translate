import type { TFunction } from "i18next";
import {
  getTranslateV4ErrorDefinition,
  getTranslateV4ErrorMessage,
  TRANSLATE_V4_ERROR_KEYS,
  type TranslateV4ErrorKey,
} from "~/utils/translateV4Errors";

export const SINGLE_TRANSLATE_QUOTA_ERROR_KEYS = [
  "v4.create.noCreditsPricing",
  "v4.create.noCreditsTrial",
  "v4.create.quotaUnavailable",
  "v4.create.quotaCheckPending",
] as const;

export type SingleTranslateQuotaErrorKey =
  (typeof SINGLE_TRANSLATE_QUOTA_ERROR_KEYS)[number];

export function isSingleTranslateQuotaError(
  errorMsg?: string | null,
): errorMsg is SingleTranslateQuotaErrorKey {
  const key = errorMsg?.trim();
  if (!key) return false;
  return (SINGLE_TRANSLATE_QUOTA_ERROR_KEYS as readonly string[]).includes(key);
}

export function resolveSingleTranslateErrorMessage(
  t: TFunction,
  errorMsg: string | null | undefined,
  fallbackKey: TranslateV4ErrorKey = TRANSLATE_V4_ERROR_KEYS.SINGLE_TRANSLATE_FAILED,
): string {
  const key = errorMsg?.trim();
  if (!key) {
    return getTranslateV4ErrorMessage(t, null, fallbackKey);
  }

  if (isSingleTranslateQuotaError(key)) {
    return t("v4.error.singleQuotaInsufficient");
  }

  if (getTranslateV4ErrorDefinition(key)) {
    return getTranslateV4ErrorMessage(t, key, fallbackKey);
  }

  const translated = t(key);
  if (translated !== key) return translated;

  return getTranslateV4ErrorMessage(t, null, fallbackKey);
}
