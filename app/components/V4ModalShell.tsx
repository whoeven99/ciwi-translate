import { Modal } from "@shopify/polaris";
import type { ReactNode } from "react";

export type ModalAction = {
  content: string;
  onAction?: () => void;
  loading?: boolean;
  disabled?: boolean;
  destructive?: boolean;
};

interface V4ModalShellProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  primaryAction?: ModalAction;
  secondaryActions?: ModalAction[];
  size?: "small" | "large";
}

/**
 * 统一模态框外壳：基于 Polaris Modal（嵌入式环境下渲染为 Shopify ui-modal），
 * 主次操作按钮通过 primaryAction / secondaryActions slot 提供，符合 4.1.6。
 */
export function V4ModalShell({
  open,
  onClose,
  title,
  children,
  primaryAction,
  secondaryActions,
  size = "small",
}: V4ModalShellProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size={size}
      primaryAction={primaryAction}
      secondaryActions={secondaryActions}
    >
      {children}
    </Modal>
  );
}
