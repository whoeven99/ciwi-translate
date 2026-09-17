import { useEffect } from "react";
import { V4_REFRESH_TASKS_EVENT } from "~/utils/resumeTaskAfterBilling";

/** Refresh task list immediately after billing return auto-resume. */
export function useV4BillingTaskResumeRefresh(
  refresh: () => void | Promise<void>,
): void {
  useEffect(() => {
    const handler = () => {
      void refresh();
    };
    window.addEventListener(V4_REFRESH_TASKS_EVENT, handler);
    return () => {
      window.removeEventListener(V4_REFRESH_TASKS_EVENT, handler);
    };
  }, [refresh]);
}
