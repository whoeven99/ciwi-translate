import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

export type InFlowOption = { label: string; value: string; disabled?: boolean };

type OptionInput = InFlowOption | string;

type Props = {
  label: string;
  options: OptionInput[];
  value: string;
  onChange: (value: string) => void;
  labelHidden?: boolean;
  disabled?: boolean;
  error?: string | boolean;
  placeholder?: string;
  style?: CSSProperties;
  /** 折叠/弹窗关闭时收起菜单。 */
  active?: boolean;
};

function normalizeOptions(options: OptionInput[]): InFlowOption[] {
  return options.map((option) =>
    typeof option === "string" ? { label: option, value: option } : option,
  );
}

/**
 * 商户向单选。菜单画在组件内部（不 portal、不用原生 select），
 * 避免 AppSModal 裁切系统下拉或挡住 Polaris Popover。
 */
export function InFlowSelect({
  label,
  options,
  value,
  onChange,
  labelHidden = false,
  disabled = false,
  error,
  placeholder,
  style,
  active = true,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const items = normalizeOptions(options);
  const selectedLabel =
    items.find((option) => option.value === value)?.label ?? placeholder ?? value;
  const hasError = Boolean(error);
  const errorText = typeof error === "string" ? error : null;
  const showLabel = Boolean(label) && !labelHidden;

  useEffect(() => {
    if (!active || disabled) setOpen(false);
  }, [active, disabled]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (!root || !(event.target instanceof Node)) return;
      if (!root.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} style={{ ...rootStyle, ...style }}>
      {showLabel ? <div style={labelStyle}>{label}</div> : null}
      <button
        type="button"
        aria-label={label || undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (!disabled) setOpen((current) => !current);
        }}
        style={triggerStyle(open, hasError, disabled)}
      >
        <span style={{ minWidth: 0, overflowWrap: "anywhere", textAlign: "left" }}>
          {selectedLabel}
        </span>
        <span
          className={`v4-caret${open ? " v4-caret--open" : ""}`}
          aria-hidden
          style={{ flexShrink: 0 }}
        >
          ⌄
        </span>
      </button>
      {open ? (
        <InFlowOptionList
          label={label}
          value={value}
          options={items}
          onSelect={(next) => {
            onChange(next);
            setOpen(false);
          }}
        />
      ) : null}
      {errorText ? <div style={errorStyle}>{errorText}</div> : null}
    </div>
  );
}

function InFlowOptionList({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value: string;
  options: InFlowOption[];
  onSelect: (value: string) => void;
}) {
  return (
    <div role="listbox" aria-label={label} style={listStyle}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="option"
            aria-selected={selected}
            disabled={option.disabled}
            onClick={() => {
              if (!option.disabled) onSelect(option.value);
            }}
            style={optionStyle(selected, Boolean(option.disabled))}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

const rootStyle: CSSProperties = {
  position: "relative",
  width: "100%",
};

const labelStyle: CSSProperties = {
  marginBottom: 6,
  fontSize: 13,
  fontWeight: 600,
  color: "var(--app-color-text)",
  lineHeight: 1.35,
};

function triggerStyle(open: boolean, hasError: boolean, disabled: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    minHeight: 36,
    gap: 8,
    padding: "8px 12px",
    borderRadius: 8,
    border: `1px solid ${
      hasError
        ? "var(--p-color-border-critical, #ce4a54)"
        : "var(--app-color-border-secondary)"
    }`,
    background: "var(--app-color-surface)",
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "inherit",
    fontSize: 13,
    fontWeight: 500,
    color: "var(--app-color-text)",
    lineHeight: 1.35,
    opacity: disabled ? 0.5 : 1,
    boxShadow: open ? "0 0 0 1px var(--p-color-border, var(--app-color-border-secondary))" : "none",
  };
}

const listStyle: CSSProperties = {
  position: "absolute",
  zIndex: 100,
  left: 0,
  top: "calc(100% + 4px)",
  minWidth: "100%",
  width: "max-content",
  maxWidth: 320,
  maxHeight: 240,
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: 2,
  padding: 6,
  borderRadius: 10,
  border: "1px solid var(--app-color-border-secondary)",
  background: "var(--app-color-surface)",
  boxShadow: "var(--app-shadow-card-strong, 0 18px 40px rgba(15, 23, 42, 0.08))",
};

function optionStyle(selected: boolean, disabled: boolean): CSSProperties {
  return {
    display: "block",
    width: "100%",
    textAlign: "left",
    minHeight: 36,
    padding: "8px 10px",
    border: "none",
    borderRadius: 8,
    background: selected ? "rgba(46, 125, 246, 0.10)" : "transparent",
    color: selected ? "var(--p-color-text-info)" : "var(--app-color-text)",
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "inherit",
    fontSize: 13,
    fontWeight: selected ? 600 : 500,
    lineHeight: 1.35,
    overflowWrap: "anywhere",
    opacity: disabled ? 0.5 : 1,
  };
}

const errorStyle: CSSProperties = {
  marginTop: 6,
  fontSize: 12,
  color: "var(--p-color-text-critical, #8e0a21)",
  lineHeight: 1.35,
};
