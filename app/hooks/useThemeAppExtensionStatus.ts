import { useEffect, useState } from "react";
import {
  fetchThemeAppExtensions,
  resolveThemeEmbedStatus,
  type ThemeEmbedLoadStatus,
} from "~/lib/themeAppExtensions";

export type { ThemeEmbedLoadStatus };

export function useThemeAppExtensionStatus(embedHandle: string): ThemeEmbedLoadStatus {
  const [status, setStatus] = useState<ThemeEmbedLoadStatus>("loading");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const extensions = await fetchThemeAppExtensions();
        if (cancelled) return;
        if (extensions == null) {
          setStatus("unknown");
          return;
        }
        setStatus(resolveThemeEmbedStatus(extensions, embedHandle));
      } catch {
        if (!cancelled) setStatus("unknown");
      }
    };

    void load();

    const onFocus = () => {
      if (document.visibilityState === "hidden") return;
      void load();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [embedHandle]);

  return status;
}
