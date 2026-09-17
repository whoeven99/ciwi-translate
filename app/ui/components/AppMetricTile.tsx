import type { CSSProperties, ReactNode } from "react";
import { BlockStack, Text } from "@shopify/polaris";
import { appColors, appRadius } from "~/ui/tokens";

interface AppMetricTileProps {
  label: ReactNode;
  value: ReactNode;
  /** 数值下方的补充说明，例如同比或口径提示。 */
  caption?: ReactNode;
  style?: CSSProperties;
}

const tileStyle: CSSProperties = {
  padding: 14,
  borderRadius: appRadius.lg,
  border: `1px solid ${appColors.borderSecondary}`,
  background: appColors.surface,
};

/** 概览/报告页的单个指标格：小标签在上，大数值在下。 */
export default function AppMetricTile({
  label,
  value,
  caption,
  style,
}: AppMetricTileProps) {
  return (
    <div style={{ ...tileStyle, ...style }}>
      <BlockStack gap="100">
        <Text as="span" tone="subdued" variant="bodySm">
          {label}
        </Text>
        <Text as="p" variant="headingLg">
          {value}
        </Text>
        {caption ? (
          <Text as="span" tone="subdued" variant="bodySm">
            {caption}
          </Text>
        ) : null}
      </BlockStack>
    </div>
  );
}
