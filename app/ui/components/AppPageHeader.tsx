import type { CSSProperties, ReactNode } from "react";
import { Text } from "@shopify/polaris";

interface AppPageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  extra?: ReactNode;
  style?: CSSProperties;
}

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "var(--p-space-400)",
  flexWrap: "wrap",
  padding: "2px 0",
};

const titleWrapStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--p-space-100)",
  minWidth: 0,
  flex: 1,
  maxWidth: 760,
};

export default function AppPageHeader({
  title,
  description,
  extra,
  style,
}: AppPageHeaderProps) {
  return (
    <div style={{ ...headerStyle, ...style }}>
      <div style={titleWrapStyle}>
        <Text as="h1" variant="headingXl">
          {title}
        </Text>
        {description ? (
          <Text as="p" variant="bodyMd" tone="subdued">
            {description}
          </Text>
        ) : null}
      </div>
      {extra ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {extra}
        </div>
      ) : null}
    </div>
  );
}
