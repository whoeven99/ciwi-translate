import type { CSSProperties, ReactNode } from "react";
import { Card } from "@shopify/polaris";

interface AppSectionCardProps {
  title?: ReactNode;
  description?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  bodyPadding?: string;
  className?: string;
  style?: CSSProperties;
  /** 标题与内容更紧，给首页摘要卡用 */
  compact?: boolean;
  /** 在等高校网格里撑满父级高度 */
  fill?: boolean;
}

const headerRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "var(--app-space-300)",
  flexWrap: "wrap",
};

const titleWrapStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  minWidth: 0,
  flex: 1,
};

const titleStyle: CSSProperties = {
  margin: 0,
  color: "var(--app-color-text)",
  fontSize: 14,
  lineHeight: "20px",
  fontWeight: 600,
};

const descriptionStyle: CSSProperties = {
  margin: 0,
  color: "var(--app-color-text-secondary)",
  fontSize: "var(--app-font-size-body)",
  lineHeight: "20px",
  maxWidth: 720,
};

export default function AppSectionCard({
  title,
  description,
  extra,
  children,
  bodyPadding = "16px",
  className,
  style,
  compact = false,
  fill = false,
}: AppSectionCardProps) {
  const hasHeader = title || description || extra;
  const rootClassName = [className, fill ? "app-section-card--fill" : null]
    .filter(Boolean)
    .join(" ") || undefined;

  return (
    <div
      className={rootClassName}
      style={{
        width: "100%",
        ...(fill
          ? { height: "100%", display: "flex", flexDirection: "column" }
          : null),
        ...style,
      }}
    >
      <Card padding="0">
        <div
          style={{
            padding: bodyPadding,
            height: "100%",
            display: "flex",
            flexDirection: "column",
            gap: hasHeader ? (compact ? 6 : "var(--app-space-300)") : 0,
            minHeight: 0,
            flex: fill ? 1 : undefined,
          }}
        >
          {hasHeader ? (
            <div style={headerRowStyle}>
              <div style={{ ...titleWrapStyle, gap: compact ? 2 : 6 }}>
                {title ? <h3 style={titleStyle}>{title}</h3> : null}
                {description ? (
                  <p
                    style={{
                      ...descriptionStyle,
                      ...(compact
                        ? { fontSize: 13, lineHeight: "18px" }
                        : null),
                    }}
                  >
                    {description}
                  </p>
                ) : null}
              </div>
              {extra ? <div>{extra}</div> : null}
            </div>
          ) : null}
          {fill ? (
            <div
              style={{
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
              }}
            >
              {children}
            </div>
          ) : (
            children
          )}
        </div>
      </Card>
    </div>
  );
}
