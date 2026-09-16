import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  isSingleTranslateQuotaError,
  resolveSingleTranslateErrorMessage,
} from "~/lib/singleTranslateQuotaFeedback";
import { TRANSLATE_V4_ERROR_KEYS } from "~/utils/translateV4Errors";
import { CREATE_TASK_INSUFFICIENT_CREDITS_I18N_KEY } from "~/lib/createTranslateQuotaGuard";

function toastQuotaError(
  t: (key: string) => string,
  errorMsg: string,
) {
  if (
    errorMsg === "v4.create.quotaUnavailable" ||
    errorMsg === "v4.create.quotaCheckPending"
  ) {
    shopify.toast.show(t(errorMsg));
    return;
  }
  shopify.toast.show(t(CREATE_TASK_INSUFFICIENT_CREDITS_I18N_KEY));
}

export function useSingleTranslateQuotaGate() {
  const { t } = useTranslation();

  const handleSingleTranslateFailure = useCallback(
    (errorMsg?: string | null) => {
      if (errorMsg && isSingleTranslateQuotaError(errorMsg)) {
        toastQuotaError(t, errorMsg);
        return;
      }

      const message = resolveSingleTranslateErrorMessage(
        t,
        errorMsg,
        TRANSLATE_V4_ERROR_KEYS.SINGLE_TRANSLATE_FAILED,
      );
      shopify.toast.show(message);
    },
    [t],
  );

  return {
    handleSingleTranslateFailure,
    quotaGateModal: null,
    resolveSingleTranslateErrorMessage: (errorMsg?: string | null) =>
      resolveSingleTranslateErrorMessage(
        t,
        errorMsg,
        TRANSLATE_V4_ERROR_KEYS.SINGLE_TRANSLATE_FAILED,
      ),
    openQuotaGateForError: (errorMsg?: string | null) => {
      if (!errorMsg || !isSingleTranslateQuotaError(errorMsg)) return;
      toastQuotaError(t, errorMsg);
    },
  };
}
