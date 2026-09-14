import {
  getTranslateV4ErrorDefaultMessage,
  TRANSLATE_V4_ERROR_KEYS,
} from "~/utils/translateV4Errors";
import { openCreditsPurchaseModal } from "~/utils/creditsPurchaseModal";

const SINGLE_TRANSLATE_NO_CREDITS_ERROR = "v4.create.noCreditsPricing";

type SingleTextTranslateArgs = {
  shopName: string;
  source: string;
  target: string;
  resourceType: string;
  context: string;
  key: string;
  type: string;
  resourceId: string | null;
  customPrompt?: string;
  aiModel?: string;
};

export const SingleTextTranslate = async (args: SingleTextTranslateArgs) => {
  try {
    const customPrompt = args.customPrompt ?? "";
    const res = await fetch("/api/translate-v4/single", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...args, customPrompt }),
    });
    const data = await res.json();
    const rawErrorKey =
      typeof data?.errorMsg === "string" ? data.errorMsg : undefined;
    const quotaBlocked = rawErrorKey === SINGLE_TRANSLATE_NO_CREDITS_ERROR;

    if (!data?.success && data?.errorMsg) {
      const errorMsg = String(data.errorMsg).trim();
      if (quotaBlocked) {
        openCreditsPurchaseModal({
          kind: "single_translate",
          target: args.target,
          fieldKey: args.key,
          estimatedCredits: null,
          currentRemainingCredits: null,
          shortfallCredits: null,
          state: "missing",
        });
      }
      if (errorMsg.startsWith("v4.")) {
        return { ...data, errorMsg };
      }
      return {
        ...data,
        errorKey: rawErrorKey,
        quotaBlocked,
        status: res.status,
        errorMsg: getTranslateV4ErrorDefaultMessage(
          errorMsg,
          TRANSLATE_V4_ERROR_KEYS.SINGLE_TRANSLATE_FAILED,
        ),
      };
    }
    return {
      ...data,
      errorKey: rawErrorKey,
      quotaBlocked,
      status: res.status,
    };
  } catch (error) {
    console.error("Error SingleTextTranslate:", error);
    return {
      success: false,
      errorCode: 50000,
      errorMsg: getTranslateV4ErrorDefaultMessage(
        TRANSLATE_V4_ERROR_KEYS.SINGLE_TRANSLATE_FAILED,
      ),
      response: "",
    };
  }
};
