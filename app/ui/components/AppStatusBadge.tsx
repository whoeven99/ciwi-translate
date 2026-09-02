import type { CSSProperties } from "react";
import { Badge } from "@shopify/polaris";

type AppStatusTone = "neutral" | "info" | "success" | "caution" | "critical";

interface AppStatusBadgeProps {
  tone?: AppStatusTone;
  children: string;
  style?: CSSProperties;
}

const toneMap: Record<
  AppStatusTone,
  "info" | "success" | "warning" | "critical" | undefined
> = {
  neutral: undefined,
  info: "info",
  success: "success",
  caution: "warning",
  critical: "critical",
};

export default function AppStatusBadge({
  tone = "neutral",
  children,
  style,
}: AppStatusBadgeProps) {
  return (
    <span style={{ display: "inline-flex", ...style }}>
      <Badge tone={toneMap[tone]}>{children}</Badge>
    </span>
  );
}
