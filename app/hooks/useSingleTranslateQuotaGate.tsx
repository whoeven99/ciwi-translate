import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  isSingleTranslateQuotaError,
  resolveSingleTranslateErrorMessage,
} from "~/lib/singleTranslateQuotaFeedback";
import { TRANSLATE_V4_ERROR_KEYS } from "~/utils/translateV4Errors";
import { openCreditsPurchaseModal } from "~/utils/creditsPurchaseModal";

export function useSingleTranslateQuotaGate() {
  const { t } = useTranslation();

  const handleSingleTranslateFailure = useCallback(
    (errorMsg?: string | null) => {
      if (errorMsg && isSingleTranslateQuotaError(errorMsg)) {
        if (errorMsg === "v4.create.noCreditsPricing") {
          openCreditsPurchaseModal();
          return;
        }
        if (errorMsg === "v4.create.noCreditsTrial") {
          shopify.toast.show(t("v4.createTask.confirmTrialTitle"));
          return;
        }
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
      if (errorMsg === "v4.create.noCreditsPricing") {
        openCreditsPurchaseModal();
        return;
      }
      if (errorMsg === "v4.create.noCreditsTrial") {
        shopify.toast.show(t("v4.createTask.confirmTrialTitle"));
      }
    },
  };
}
