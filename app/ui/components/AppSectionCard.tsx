import type { CSSProperties, ReactNode } from "react";
import { BlockStack, Card, InlineStack, Text } from "@shopify/polaris";

interface AppSectionCardProps {
  title?: ReactNode;
  description?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  bodyPadding?: string;
  style?: CSSProperties;
}

export default function AppSectionCard({
  title,
  description,
  extra,
  children,
  bodyPadding = "16px",
  style,
}: AppSectionCardProps) {
  const hasHeader = title || description || extra;

  return (
    <div style={style}>
      <Card padding="0">
        <div style={{ padding: bodyPadding }}>
          <BlockStack gap={hasHeader ? "300" : "0"}>
            {hasHeader ? (
              <InlineStack align="space-between" blockAlign="start" gap="300" wrap>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--p-space-100)",
                    minWidth: 0,
                    flex: 1,
                  }}
                >
                  {title ? (
                    <Text as="h3" variant="headingSm">
                      {title}
                    </Text>
                  ) : null}
                  {description ? (
                    <Text as="p" variant="bodySm" tone="subdued">
                      {description}
                    </Text>
                  ) : null}
                </div>
                {extra ? <div>{extra}</div> : null}
              </InlineStack>
            ) : null}
            {children}
          </BlockStack>
        </div>
      </Card>
    </div>
  );
}
