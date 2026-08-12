import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { BlockStack, Button, Checkbox, Select } from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import { v4Colors, v4CardStyle } from "../v4Styles";
import {
  AI_MODEL_OPTIONS,
  CREATE_TASK_MODULE_LABELS,
  CREATE_TASK_MODULE_OPTIONS,
} from "../constants";
import { localeRegionCode, localeShortName } from "../localeDisplay";
import type { ShopLocaleOption } from "~/lib/createTranslateV4Tasks";
import { getV4AiModelLabel, getV4ModuleLabel } from "../v4I18n";
import type { CreateTaskEstimateView } from "../useCreateTaskEstimate";

export type { CreateTaskEstimateView };

type Props = {
  targetOptions: ShopLocaleOption[];
  targets: string[];
  onTargetsChange: (values: string[]) => void;
  modules: string[];
  onModulesChange: (values: string[]) => void;
  creating: boolean;
  onCreate: () => void;
  aiModel: string;
  onAiModelChange: (v: string) => void;
  isCover: boolean;
  onIsCoverChange: (v: boolean) => void;
  isHandle: boolean;
  onIsHandleChange: (v: boolean) => void;
  includeLiquid: boolean;
  onIncludeLiquidChange: (v: boolean) => void;
  advancedDefaultOpen?: boolean;
  submitPlacement?: "header" | "footer-center";
  createDisabled?: boolean;
  disabledMessage?: string | null;
  estimate?: CreateTaskEstimateView | null;
};

type TargetOption = { value: string; label: string; regionCode: string };

export function CreateTaskCard({
  targetOptions,
  targets,
  onTargetsChange,
  modules,
  onModulesChange,
  creating,
  onCreate,
  aiModel,
  onAiModelChange,
  isCover,
  onIsCoverChange,
  isHandle,
  onIsHandleChange,
  includeLiquid,
  onIncludeLiquidChange,
  advancedDefaultOpen = true,
  submitPlacement = "header",
  createDisabled = false,
  disabledMessage = null,
  estimate = null,
}: Props) {
  const { t } = useTranslation();
  const canCreate =
    targets.length > 0 &&
    (modules.length > 0 || includeLiquid) &&
    !creating &&
    !createDisabled;
  const [advancedOpen, setAdvancedOpen] = useState(advancedDefaultOpen);

  // 顺序固定（按名称），避免点选时 chip 跳动。
  const localeChips = useMemo<TargetOption[]>(
    () =>
      [...targetOptions]
        .map((opt) => ({
          value: opt.value,
          label: localeShortName(opt.value, opt.label),
          regionCode: localeRegionCode(opt.value),
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [targetOptions],
  );

  const aiModelOptions = useMemo(
    () =>
      AI_MODEL_OPTIONS.map((option) => ({
        ...option,
        label: getV4AiModelLabel(option.value, t),
      })),
    [t],
  );

  // 翻译内容改为内联多选 chip：顺序固定（避免点选时跳动），选中态与上方语言同色。
  const moduleChips = CREATE_TASK_MODULE_OPTIONS.map((mod) => ({
    value: mod,
    label: getV4ModuleLabel(mod, t) || CREATE_TASK_MODULE_LABELS[mod] || mod,
  }));
  const allTargetValues = localeChips.map((locale) => locale.value);
  const allModuleValues = moduleChips.map((mod) => mod.value);
  const allTargetsSelected =
    allTargetValues.length > 0 && allTargetValues.every((value) => targets.includes(value));
  const someTargetsSelected = targets.length > 0 && !allTargetsSelected;
  const allModulesSelected =
    allModuleValues.length > 0 && allModuleValues.every((value) => modules.includes(value));
  const someModulesSelected = modules.length > 0 && !allModulesSelected;

  const toggleTarget = (value: string) => {
    onTargetsChange(
      targets.includes(value)
        ? targets.filter((item) => item !== value)
        : [...targets, value],
    );
  };

  const toggleModule = (value: string) => {
    onModulesChange(
      modules.includes(value)
        ? modules.filter((m) => m !== value)
        : [...modules, value],
    );
  };

  const toggleAllTargets = () => {
    onTargetsChange(allTargetsSelected ? [] : allTargetValues);
  };

  const toggleAllModules = () => {
    onModulesChange(allModulesSelected ? [] : allModuleValues);
  };

  const submitButton = (
    <div
      style={{
        maxWidth: "100%",
        minWidth: submitPlacement === "footer-center" ? 220 : undefined,
      }}
    >
      <Button
        fullWidth={submitPlacement === "footer-center"}
        size="large"
        variant="primary"
        disabled={!canCreate}
        loading={creating}
        onClick={onCreate}
      >
        {creating ? t("v4.createTask.creating") : t("v4.createTask.confirmAction")}
      </Button>
    </div>
  );

  return (
    <div
      className="v4-create-task-card v4-lift"
      style={{
        ...v4CardStyle,
        borderRadius: 18,
        padding: "20px 22px",
        boxShadow: "var(--app-shadow-card-strong)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
          marginBottom: 18,
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2
            style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              color: v4Colors.text,
              lineHeight: 1.4,
              overflowWrap: "anywhere",
            }}
          >
            {t("v4.createTask.title")}
          </h2>
          {disabledMessage ? (
            <div
              style={{
                marginTop: 6,
                fontSize: 12,
                lineHeight: 1.5,
                color: v4Colors.textMuted,
              }}
            >
              {disabledMessage}
            </div>
          ) : null}
        </div>
        {submitPlacement === "header" ? (
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: "8px 12px",
              maxWidth: "100%",
              minWidth: 0,
            }}
          >
            {submitButton}
          </div>
        ) : null}
      </div>

      <div style={{ marginBottom: 16 }}>
        <SectionHeader
          title={t("v4.createTask.targetLanguages")}
          action={
            <CheckboxInlineAction
              label={t("Check all")}
              selected={allTargetsSelected}
              indeterminate={someTargetsSelected}
              onToggle={toggleAllTargets}
            />
          }
        />
        <div style={checkboxGridStyle}>
          {localeChips.map((locale) => {
            const selected = targets.includes(locale.value);
            return (
              <CheckboxOptionCard
                key={locale.value}
                label={locale.label}
                selected={selected}
                onToggle={() => toggleTarget(locale.value)}
                prefix={locale.regionCode}
              />
            );
          })}
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <SectionHeader
          title={t("v4.createTask.content")}
          action={
            <CheckboxInlineAction
              label={t("Check all")}
              selected={allModulesSelected}
              indeterminate={someModulesSelected}
              onToggle={toggleAllModules}
            />
          }
        />
        <div style={checkboxGridStyle}>
          {moduleChips.map((mod) => {
            const selected = modules.includes(mod.value);
            return (
              <CheckboxOptionCard
                key={mod.value}
                label={mod.label}
                selected={selected}
                onToggle={() => toggleModule(mod.value)}
              />
            );
          })}
        </div>
      </div>

      <div
        style={{
          padding: advancedOpen ? "14px 14px 0" : "14px",
          borderRadius: 12,
          background: v4Colors.cardSubdued,
          border: `1px dashed ${v4Colors.cardBorder}`,
          transition: "padding 0.42s cubic-bezier(0.22, 0.61, 0.36, 1)",
        }}
      >
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          aria-expanded={advancedOpen}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            gap: 8,
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: 13,
            fontWeight: 600,
            color: v4Colors.text,
            userSelect: "none",
          }}
        >
          <span style={{ minWidth: 0, textAlign: "left", lineHeight: 1.35, overflowWrap: "anywhere" }}>
            {t("v4.createTask.advancedSettings")}
          </span>
          <span
            className={`v4-caret${advancedOpen ? " v4-caret--open" : ""}`}
            aria-hidden
            style={{ flexShrink: 0 }}
          >
            ⌄
          </span>
        </button>

        <div
          className="v4-collapse"
          style={{
            maxHeight: advancedOpen ? 420 : 0,
            opacity: advancedOpen ? 1 : 0,
          }}
        >
          <div style={{ marginTop: 12 }}>
            <SectionLabel>{t("v4.createTask.aiModel")}</SectionLabel>
            <div style={{ marginBottom: 16 }}>
              <Select
                label={t("v4.createTask.aiModel")}
                labelHidden
                options={aiModelOptions}
                value={aiModel}
                onChange={onAiModelChange}
              />
            </div>
            <SectionLabel>{t("v4.createTask.translationOptions")}</SectionLabel>
            <BlockStack gap="300">
              <Checkbox
                label={t("v4.createTask.overwriteExisting")}
                checked={isCover}
                onChange={onIsCoverChange}
              />
              <Checkbox
                label={t("v4.createTask.translateHandle")}
                checked={isHandle}
                onChange={onIsHandleChange}
              />
              <Checkbox
                label={t("v4.createTask.includeLiquid")}
                helpText={t("v4.createTask.includeLiquidHelp")}
                checked={includeLiquid}
                onChange={onIncludeLiquidChange}
              />
            </BlockStack>
          </div>
        </div>
      </div>

      {submitPlacement === "footer-center" ? (
        <div
          style={{
            marginTop: 22,
            paddingTop: 18,
            display: "flex",
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px 12px",
          }}
        >
          {submitButton}
        </div>
      ) : null}
    </div>
  );
}

function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        marginBottom: 12,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: v4Colors.text,
          lineHeight: 1.35,
          overflowWrap: "anywhere",
          minWidth: 0,
        }}
      >
        {title}
      </div>
      {action}
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div style={{ fontSize: 13, fontWeight: 600, color: v4Colors.textMuted, marginBottom: 8, lineHeight: 1.35, overflowWrap: "anywhere" }}>
      {children}
    </div>
  );
}

function CheckboxOptionCard({
  label,
  selected,
  indeterminate = false,
  onToggle,
  prefix,
}: {
  label: string;
  selected: boolean;
  indeterminate?: boolean;
  onToggle: () => void;
  prefix?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <label style={checkboxCardStyle(selected)}>
      <input
        ref={inputRef}
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        style={checkboxInputStyle}
      />
      <span style={{ minWidth: 0, display: "inline-flex", alignItems: "center", gap: 6 }}>
        {prefix ? (
          <span
            style={{
              opacity: selected ? 1 : 0.72,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.02em",
              color: v4Colors.textMuted,
              flexShrink: 0,
            }}
          >
            {prefix}
          </span>
        ) : null}
        <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{label}</span>
      </span>
    </label>
  );
}

function CheckboxInlineAction({
  label,
  selected,
  indeterminate = false,
  onToggle,
}: {
  label: string;
  selected: boolean;
  indeterminate?: boolean;
  onToggle: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        cursor: "pointer",
        fontSize: 12,
        fontWeight: 500,
        color: v4Colors.textMuted,
        lineHeight: 1.35,
        userSelect: "none",
        flexShrink: 0,
      }}
    >
      <input
        ref={inputRef}
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        style={checkboxInputStyle}
      />
      <span>{label}</span>
    </label>
  );
}

const checkboxGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 10,
};

function checkboxCardStyle(selected: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minHeight: 42,
    padding: "10px 12px",
    borderRadius: 12,
    border: "none",
    background: selected ? "rgba(46, 125, 246, 0.10)" : v4Colors.cardSubdued,
    color: selected ? v4Colors.primary : v4Colors.text,
    fontSize: 13,
    fontWeight: selected ? 600 : 500,
    lineHeight: 1.35,
    cursor: "pointer",
    transition: "background-color 0.15s, color 0.15s, opacity 0.15s",
    fontFamily: "inherit",
    userSelect: "none",
    opacity: 1,
  };
}

const checkboxInputStyle: CSSProperties = {
  margin: 0,
  width: 16,
  height: 16,
  flexShrink: 0,
  accentColor: v4Colors.primary,
};
