import { useBlocker } from "@remix-run/react";
import { useEffect, useRef } from "react";
import {
  confirmLeaveSaveBar,
  getAppBridgeSaveBar,
} from "~/lib/saveBarNavigation";

/** App Bridge CSB：dirty 时展示，Remix 离开前必须先 Save / Discard。 */
export function useContextualSaveBar(id: string, isDirty: boolean) {
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;

  useEffect(() => {
    const saveBar = getAppBridgeSaveBar();
    if (!saveBar) {
      return;
    }
    if (isDirty) {
      void saveBar.show(id);
    } else {
      void saveBar.hide(id);
    }
  }, [id, isDirty]);

  useEffect(() => {
    return () => {
      if (dirtyRef.current) {
        return;
      }
      void getAppBridgeSaveBar()?.hide(id);
    };
  }, [id]);

  const blocker = useBlocker(isDirty);

  useEffect(() => {
    if (blocker.state !== "blocked") {
      return;
    }
    let cancelled = false;
    void confirmLeaveSaveBar()
      .then(() => {
        if (!cancelled && blocker.state === "blocked") {
          blocker.proceed();
        }
      })
      .catch(() => {
        if (!cancelled && blocker.state === "blocked") {
          blocker.reset();
        }
      });
    return () => {
      cancelled = true;
    };
  }, [blocker]);
}
