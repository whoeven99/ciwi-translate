import type { CSSProperties, ReactNode } from "react";
import { BlockStack, InlineStack, Text } from "@shopify/polaris";
import { appColors, appRadius } from "~/ui/tokens";

export interface AppMobileListCardRow {
  key: string;
  label: ReactNode;
  value: ReactNode;
}

interface AppMobileListCardProps {
  title: ReactNode;
  rows?: AppMobileListCardRow[];
  /** 卡片底部的操作区，通常是一到两个按钮。 */
  actions?: ReactNode;
  style?: CSSProperties;
}

const cardStyle: CSSProperties = {
  padding: 14,
  borderRadius: appRadius.lg,
  border: `1px solid ${appColors.borderSecondary}`,
  background: appColors.surface,
};

/**
 * 窄屏下替代表格行的卡片。标签文案由调用方传入，便于走 i18n。
 */
export default function AppMobileListCard({
  title,
  rows = [],
  actions,
  style,
}: AppMobileListCardProps) {
  return (
    <div style={{ ...cardStyle, ...style }}>
      <BlockStack gap="200">
        <Text as="h4" variant="headingSm">
          {title}
        </Text>
        {rows.map((row) => (
          <InlineStack key={row.key} align="space-between" blockAlign="center">
            <Text as="span" variant="bodySm">
              {row.label}
            </Text>
            {row.value}
          </InlineStack>
        ))}
        {actions ? <InlineStack gap="200">{actions}</InlineStack> : null}
      </BlockStack>
    </div>
  );
}
