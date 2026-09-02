import type { CSSProperties, ReactElement, ReactNode } from "react";
import { Button as PolarisButton } from "@shopify/polaris";

type AppButtonType = "primary" | "default" | "text" | "link" | "dashed";
type AppButtonSize = "small" | "middle" | "large";

interface AppButtonProps {
  type?: AppButtonType;
  size?: AppButtonSize;
  danger?: boolean;
  loading?: boolean;
  disabled?: boolean;
  icon?: ReactElement;
  block?: boolean;
  htmlType?: "button" | "submit" | "reset";
  className?: string;
  style?: CSSProperties;
  title?: string;
  onClick?: () => void;
  children?: ReactNode;
}

const VARIANT: Record<AppButtonType, "primary" | "secondary" | "plain"> = {
  primary: "primary",
  default: "secondary",
  text: "plain",
  link: "plain",
  dashed: "secondary",
};

const SIZE: Record<AppButtonSize, "slim" | "medium" | "large"> = {
  small: "slim",
  middle: "medium",
  large: "large",
};

export default function AppButton({
  type = "default",
  size = "middle",
  danger = false,
  loading = false,
  disabled = false,
  icon,
  block = false,
  htmlType,
  className,
  style,
  title,
  onClick,
  children,
}: AppButtonProps) {
  return (
    <span
      className={className}
      style={{ display: "inline-flex", ...style }}
      title={title}
    >
      <PolarisButton
        variant={VARIANT[type]}
        tone={danger ? "critical" : undefined}
        size={SIZE[size]}
        loading={loading}
        disabled={disabled}
        fullWidth={block}
        submit={htmlType === "submit"}
        onClick={onClick}
        icon={icon}
      >
        {children as string}
      </PolarisButton>
    </span>
  );
}
