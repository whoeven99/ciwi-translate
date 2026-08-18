import type { Dispatch } from "@reduxjs/toolkit";
import {
  setChars,
  setIsNew,
  setPlan,
  setTotalChars,
  setTrialCredits,
  setUpdateTime,
} from "~/store/modules/userConfig";
import type { AppBootstrapData } from "~/server/appBootstrap.server";

export async function refreshBillingBootstrap(
  dispatch: Dispatch,
  previousTotalChars?: number,
): Promise<void> {
  const retryDelaysMs = [0, 600, 1200, 2000, 3000];

  for (const delayMs of retryDelaysMs) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    try {
      const res = await fetch("/api/app-bootstrap");
      const data = (await res.json()) as {
        ok?: boolean;
        bootstrap?: AppBootstrapData;
      };
      if (!data.ok || !data.bootstrap) continue;

      const bootstrap = data.bootstrap;
      dispatch(setPlan({ plan: bootstrap.plan }));
      dispatch(setChars({ chars: bootstrap.chars }));
      dispatch(setTotalChars({ totalChars: bootstrap.totalChars }));
      dispatch(setTrialCredits({ trialCredits: bootstrap.trialCredits ?? 0 }));
      if (bootstrap.updateTime) {
        dispatch(setUpdateTime({ updateTime: bootstrap.updateTime }));
      } else {
        dispatch(setUpdateTime({ updateTime: "" }));
      }
      if (bootstrap.isNew !== null && bootstrap.isNew !== undefined) {
        dispatch(setIsNew({ isNew: bootstrap.isNew }));
      }

      if (
        previousTotalChars === undefined ||
        bootstrap.totalChars !== previousTotalChars
      ) {
        return;
      }
    } catch {
      // Billing webhook settlement can lag a little after the hosted confirmation.
    }
  }
}
