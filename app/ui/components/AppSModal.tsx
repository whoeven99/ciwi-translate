import { useEffect, useId, useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";

export type AppSModalAction = {
  content: string;
  onAction: () => void;
  loading?: boolean;
  disabled?: boolean;
  tone?: "auto" | "critical";
};

type SModalSize = "small" | "small-100" | "base" | "large" | "large-100";

type SModalHost = HTMLElement & {
  showOverlay: () => void;
  hideOverlay: () => void;
};

type SButtonHost = HTMLElement & {
  loading?: boolean;
  disabled?: boolean;
};

type Props = {
  open: boolean;
  heading: string;
  onClose: () => void;
  children: ReactNode;
  size?: SModalSize;
  primaryAction?: AppSModalAction | null;
  secondaryActions?: AppSModalAction[];
};

async function waitForSModal() {
  if (typeof customElements === "undefined") return;
  if (customElements.get("s-modal")) return;
  await customElements.whenDefined("s-modal");
}

export function AppSModal({
  open,
  heading,
  onClose,
  children,
  size = "base",
  primaryAction,
  secondaryActions,
}: Props) {
  const reactId = useId().replace(/:/g, "");
  const modalRef = useRef<SModalHost | null>(null);
  const skipNextHide = useRef(false);

  useLayoutEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        await waitForSModal();
      } catch {
        return;
      }
      if (cancelled) return;
      const host = modalRef.current;
      if (!host || typeof host.showOverlay !== "function") return;
      if (open) {
        skipNextHide.current = false;
        host.showOverlay();
        return;
      }
      skipNextHide.current = true;
      host.hideOverlay();
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    return () => {
      const el = modalRef.current;
      if (el && typeof el.hideOverlay === "function") {
        try {
          el.hideOverlay();
        } catch {
          // element already detached
        }
      }
    };
  }, []);

  useEffect(() => {
    const el = modalRef.current;
    if (!el) return;

    const handleAfterHide = () => {
      if (skipNextHide.current) {
        skipNextHide.current = false;
        return;
      }
      onClose();
    };

    el.addEventListener("afterhide", handleAfterHide);
    return () => el.removeEventListener("afterhide", handleAfterHide);
  }, [onClose]);

  return (
    <s-modal
      ref={modalRef as never}
      id={`app-s-modal-${reactId}`}
      heading={heading}
      size={size}
    >
      {open ? children : null}
      {primaryAction ? (
        <ModalSlotButton
          slot="primary-action"
          variant="primary"
          action={primaryAction}
        />
      ) : null}
      {(secondaryActions ?? []).map((action, index) => (
        <ModalSlotButton
          key={`${action.content}-${index}`}
          slot="secondary-actions"
          variant="secondary"
          action={action}
        />
      ))}
    </s-modal>
  );
}

function ModalSlotButton({
  slot,
  variant,
  action,
}: {
  slot: "primary-action" | "secondary-actions";
  variant: "primary" | "secondary";
  action: AppSModalAction;
}) {
  const ref = useRef<SButtonHost | null>(null);
  const onActionRef = useRef(action.onAction);
  onActionRef.current = action.onAction;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handleClick = (event: Event) => {
      event.preventDefault();
      if (action.disabled || action.loading) return;
      onActionRef.current();
    };
    el.addEventListener("click", handleClick);
    return () => el.removeEventListener("click", handleClick);
  }, [action.disabled, action.loading]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.loading = Boolean(action.loading);
    el.disabled = Boolean(action.disabled);
  }, [action.loading, action.disabled]);

  return (
    <s-button
      ref={ref as never}
      slot={slot}
      variant={variant}
      tone={action.tone}
    >
      {action.content}
    </s-button>
  );
}
