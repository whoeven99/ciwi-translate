import type { CSSProperties, MouseEventHandler, ReactNode } from "react";
import { Button } from "@shopify/polaris";

export type AppButtonProps = {
  type?: "primary" | "default" | "dashed" | "text" | "link";
  size?: "large" | "middle" | "small";
  loading?: boolean;
  disabled?: boolean;
  danger?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  icon?: ReactNode;
  htmlType?: "button" | "submit" | "reset";
  block?: boolean;
  id?: string;
};

function polarisVariant(
  type: AppButtonProps["type"],
): "primary" | "secondary" | "plain" {
  if (type === "primary") return "primary";
  if (type === "text" || type === "link") return "plain";
  return "secondary";
}

function polarisSize(size: AppButtonProps["size"]): "slim" | "medium" | "large" {
  if (size === "small") return "slim";
  if (size === "large") return "large";
  return "medium";
}

export default function AppButton({
  type = "default",
  size = "middle",
  loading,
  disabled,
  danger,
  onClick,
  children,
  className,
  style,
  icon,
  htmlType,
  block,
  id,
}: AppButtonProps) {
  const fullWidth = Boolean(block || style?.width === "100%");
  const label =
    icon != null ? (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {icon}
        {children}
      </span>
    ) : (
      children
    );

  const button = (
    <Button
      id={id}
      variant={polarisVariant(type)}
      size={polarisSize(size)}
      loading={loading}
      disabled={disabled}
      tone={danger ? "critical" : undefined}
      onClick={onClick}
      submit={htmlType === "submit"}
      fullWidth={fullWidth}
    >
      {label as string}
    </Button>
  );

  const { width: _ignoredWidth, ...restStyle } = style ?? {};
  void _ignoredWidth;
  const wrapStyle =
    className || Object.keys(restStyle).length > 0 ? restStyle : undefined;
  if (!className && wrapStyle == null) return button;

  return (
    <span
      className={["app-button", className].filter(Boolean).join(" ")}
      style={wrapStyle}
    >
      {button}
    </span>
  );
}
