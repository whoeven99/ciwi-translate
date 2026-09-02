import { Banner, Button } from "@shopify/polaris";
import { useEffect, useState } from "react";
import { useNavigate } from "@remix-run/react";
import { useTranslation } from "react-i18next";

type ThemeEmbedStatus = "enabled" | "disabled" | "missing" | "unknown";

/**
 * 首页首屏展示 Switcher theme app embed 的启用状态，
 * 满足 Shopify 审核 4.2.3「homepage 需说明 theme app block/embed 状态」的要求。
 */
export function ThemeEmbedStatusBanner() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [status, setStatus] = useState<ThemeEmbedStatus>("unknown");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/theme-embed-status", { method: "POST" })
      .then((res) => res.json().catch(() => null))
      .then((data) => {
        if (cancelled) return;
        setStatus(data?.status ?? "unknown");
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("unknown");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // 加载中或无法判定时静默，避免首页出现无意义的占位。
  if (loading || status === "unknown") return null;

  const tone = status === "enabled" ? "success" : "warning";
  const title =
    status === "enabled"
      ? t("themeEmbed.status.enabled")
      : status === "disabled"
        ? t("themeEmbed.status.disabled")
        : t("themeEmbed.status.missing");

  return (
    <div style={{ marginBottom: 18 }}>
      <Banner
        tone={tone}
        title={title}
        action={
          <Button
            variant={status === "enabled" ? "secondary" : "primary"}
            onClick={() => navigate("/app/switcher")}
          >
            {t("themeEmbed.status.manage")}
          </Button>
        }
      >
        {status === "enabled"
          ? t("themeEmbed.status.enabledDetail")
          : t("themeEmbed.status.actionDetail")}
      </Banner>
    </div>
  );
}
