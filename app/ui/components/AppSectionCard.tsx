import type { CSSProperties, ReactNode } from "react";
import { Card } from "antd";

interface AppSectionCardProps {
  title?: ReactNode;
  description?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  bodyPadding?: string;
  className?: string;
  style?: CSSProperties;
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
}: AppSectionCardProps) {
  const hasHeader = title || description || extra;

  return (
    <Card
      className={className}
      style={{
        width: "100%",
        border: "1px solid var(--app-color-border-secondary)",
        boxShadow: "var(--app-shadow-card)",
        background: "var(--app-color-surface)",
        borderRadius: "var(--app-radius-lg)",
        ...style,
      }}
      styles={{
        body: {
          padding: bodyPadding,
        },
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: hasHeader ? "var(--app-space-300)" : 0,
        }}
      >
        {hasHeader ? (
          <div style={headerRowStyle}>
            <div style={titleWrapStyle}>
              {title ? <h3 style={titleStyle}>{title}</h3> : null}
              {description ? <p style={descriptionStyle}>{description}</p> : null}
            </div>
            {extra ? <div>{extra}</div> : null}
          </div>
        ) : null}
        {children}
      </div>
    </Card>
  );
}
