import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { BlockStack, Button, Checkbox } from "@shopify/polaris";
import { useNavigate } from "@remix-run/react";
import { useTranslation } from "react-i18next";
import { message } from "~/ui/message";
import { AppSModal } from "~/ui/components/AppSModal";
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
import { AiModelInFlowSelect } from "./AiModelInFlowSelect";
import {
  entitlementsForPlanType,
  isV2ModuleAllowedForPlan,
  type PlanEntitlements,
} from "~/lib/planEntitlements";

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
  /** 套餐能力；缺省按 Free 收紧（避免漏传放开）。 */
  planEntitlements?: PlanEntitlements | null;
  advancedDefaultOpen?: boolean;
  submitPlacement?: "header" | "footer-center";
  createDisabled?: boolean;
  disabledMessage?: string | null;
  estimate?: CreateTaskEstimateView | null;
};

type TargetOption = { value: string; label: string; regionCode: string };
type CreateTaskModuleItem = {
  value: string;
  label: string;
  allowed: boolean;
  detail?: string;
  isLiquid?: boolean;
  order: number;
};
type ModelPlanTier = "free" | "basic" | "pro" | "premium";

const LIQUID_MODULE_KEY = "__custom_liquid__";
const AI_MODEL_MIN_PLAN: Record<string, ModelPlanTier> = {
  "deepseek-v4-flash": "free",
  "gpt-4.1-nano": "basic",
  "deepseek-v4-pro": "basic",
  "gpt-4.1-mini": "basic",
  "gpt-5.6-luna": "basic",
  "gpt-5.6-terra": "basic",
};

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
  planEntitlements = null,
  advancedDefaultOpen = true,
  submitPlacement = "header",
  createDisabled = false,
  disabledMessage = null,
}: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const entitlements = planEntitlements ?? entitlementsForPlanType("Free");
  const targetSelectionCap = Number.isFinite(entitlements.maxTargetsPerTask)
    ? entitlements.maxTargetsPerTask
    : null;
  const singleTargetOnly =
    targetSelectionCap != null && targetSelectionCap <= 1;
  const missingTargetSelection = targets.length === 0;
  const missingContentSelection = modules.length === 0 && !includeLiquid;
  const selectionInvalid = missingTargetSelection || missingContentSelection;
  const canCreate = !selectionInvalid && !creating && !createDisabled;
  const [advancedOpen, setAdvancedOpen] = useState(advancedDefaultOpen);
  const [upgradeModalContent, setUpgradeModalContent] = useState<{
    title: string;
    body: string;
  } | null>(null);

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
        label: formatAiModelOptionLabel({
          value: option.value,
          currentTier: entitlements.tier,
          t,
        }),
        disabled: !isAiModelAllowedForTier(option.value, entitlements.tier),
      })),
    [entitlements.tier, t],
  );
  const allTargetValues = localeChips.map((locale) => locale.value);
  const allTargetsSelected =
    allTargetValues.length > 0 &&
    allTargetValues.every((value) => targets.includes(value));
  const someTargetsSelected = targets.length > 0 && !allTargetsSelected;
  const targetSelectionLimitReached =
    targetSelectionCap != null && targets.length >= targetSelectionCap;
  const moduleItems = useMemo<CreateTaskModuleItem[]>(() => {
    const baseItems = CREATE_TASK_MODULE_OPTIONS.map((mod, index) => {
      const allowed = isV2ModuleAllowedForPlan(mod, entitlements);
      return {
        value: mod,
        label:
          getV4ModuleLabel(mod, t) || CREATE_TASK_MODULE_LABELS[mod] || mod,
        allowed,
        detail:
          !allowed && mod === "metadata"
            ? t("v4.plan.metafieldRequiresPro")
            : !allowed
              ? t("v4.plan.moduleNotAllowed")
              : undefined,
        order: index,
      };
    });

    const liquidItem: CreateTaskModuleItem = {
      value: LIQUID_MODULE_KEY,
      label: t("v4.createTask.includeLiquid"),
      allowed: entitlements.allowLiquid,
      detail: entitlements.allowLiquid
        ? t("v4.createTask.includeLiquidHelp")
        : t("v4.plan.liquidRequiresPro"),
      isLiquid: true,
      order: baseItems.length,
    };

    return [...baseItems, liquidItem].sort((a, b) => {
      if (a.allowed !== b.allowed) return a.allowed ? -1 : 1;
      return a.order - b.order;
    });
  }, [entitlements, t]);
  const allModuleValues = moduleItems.map((mod) => mod.value);
  const selectedContentValues = useMemo(
    () => [...modules, ...(includeLiquid ? [LIQUID_MODULE_KEY] : [])],
    [includeLiquid, modules],
  );

  const toggleTarget = (value: string) => {
    const selected = targets.includes(value);
    if (selected) {
      onTargetsChange(targets.filter((item) => item !== value));
      return;
    }
    if (targetSelectionLimitReached) {
      setUpgradeModalContent({
        title: t("v4.createTask.targetLimitUpgradeTitle"),
        body: singleTargetOnly
          ? t("v4.createTask.targetLimitUpgradeBody", { count: 1 })
          : t("v4.createTask.targetLimitUpgradeBody", {
              count: targetSelectionCap,
            }),
      });
      return;
    }
    onTargetsChange([...targets, value]);
  };

  const toggleModule = (value: string) => {
    const clickedItem = moduleItems.find((item) => item.value === value);
    if (!clickedItem) return;
    if (!clickedItem.allowed) {
      setUpgradeModalContent({
        title: t("v4.createTask.moduleUpgradeTitle", {
          module: clickedItem.label,
        }),
        body:
          clickedItem.detail ??
          t("v4.createTask.moduleUpgradeBody", {
            module: clickedItem.label,
          }),
      });
      return;
    }
    if (clickedItem.isLiquid) {
      onIncludeLiquidChange(!includeLiquid);
      return;
    }
    onModulesChange(
      modules.includes(value)
        ? modules.filter((m) => m !== value)
        : [...modules, value],
    );
  };

  const toggleAllTargets = () => {
    if (singleTargetOnly) return;
    onTargetsChange(allTargetsSelected ? [] : allTargetValues);
  };

  const selectableModuleValues: string[] = moduleItems
    .filter((item) => item.allowed)
    .map((item) => item.value);
  const allSelectableModulesSelected =
    selectableModuleValues.length > 0 &&
    selectableModuleValues.every((value) =>
      selectedContentValues.includes(value),
    );
  const someSelectableModulesSelected =
    selectedContentValues.some((value) =>
      selectableModuleValues.includes(value),
    ) && !allSelectableModulesSelected;
  const advancedSummaryLabels = useMemo(() => {
    const labels: string[] = [];
    if (isCover) labels.push(t("v4.createTask.overwriteExisting"));
    if (isHandle) labels.push(t("v4.createTask.translateHandle"));
    return labels;
  }, [isCover, isHandle, t]);

  const toggleAllModules = () => {
    if (allSelectableModulesSelected) {
      onModulesChange([]);
      onIncludeLiquidChange(false);
      return;
    }
    onModulesChange(
      selectableModuleValues.filter((value) => value !== LIQUID_MODULE_KEY),
    );
    onIncludeLiquidChange(selectableModuleValues.includes(LIQUID_MODULE_KEY));
  };

  const handleInvalidCreateAttempt = () => {
    const errors: string[] = [];
    if (missingTargetSelection) {
      errors.push(t("v4.validation.selectTarget"));
    }
    if (missingContentSelection) {
      errors.push(t("v4.validation.selectModule"));
    }
    if (errors.length > 0) {
      message.warning(errors.join(" "));
    }
  };

  const submitButton = (
    <div
      style={{
        position: "relative",
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
        {creating
          ? t("v4.createTask.creating")
          : t("v4.createTask.confirmAction")}
      </Button>
      {selectionInvalid && !creating && !createDisabled ? (
        <button
          type="button"
          aria-label={t("v4.createTask.confirmAction")}
          onClick={handleInvalidCreateAttempt}
          style={disabledActionOverlayStyle}
        />
      ) : null}
    </div>
  );

  return (
    <div
      className="v4-create-task-card"
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
          meta={
            <InlineBadge tone="subdued">{`${targets.length}/${localeChips.length}`}</InlineBadge>
          }
          action={
            targetSelectionCap != null ? undefined : (
              <CheckboxInlineAction
                label={t("Check all")}
                selected={allTargetsSelected}
                indeterminate={someTargetsSelected}
                onToggle={toggleAllTargets}
              />
            )
          }
        />
        <div style={checkboxGridStyle}>
          {localeChips.map((locale) => {
            const selected = targets.includes(locale.value);
            const disabled = !selected && targetSelectionLimitReached;
            return (
              <CheckboxOptionCard
                key={locale.value}
                label={locale.label}
                selected={selected}
                onToggle={() => toggleTarget(locale.value)}
                prefix={locale.regionCode}
                disabled={disabled}
              />
            );
          })}
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <SectionHeader
          title={t("v4.createTask.content")}
          meta={
            <InlineBadge tone="subdued">{`${selectedContentValues.length}/${allModuleValues.length}`}</InlineBadge>
          }
          action={
            <CheckboxInlineAction
              label={t("Check all")}
              selected={allSelectableModulesSelected}
              indeterminate={someSelectableModulesSelected}
              onToggle={toggleAllModules}
            />
          }
        />
        <div style={checkboxGridStyle}>
          {moduleItems.map((mod) => {
            const selected = mod.isLiquid
              ? includeLiquid && mod.allowed
              : modules.includes(mod.value);
            return (
              <CheckboxOptionCard
                key={mod.value}
                label={mod.label}
                selected={selected}
                onToggle={() => toggleModule(mod.value)}
                disabled={!mod.allowed}
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
          <span
            style={{
              minWidth: 0,
              textAlign: "left",
              lineHeight: 1.35,
              overflowWrap: "anywhere",
            }}
          >
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
        {!advancedOpen ? (
          <div style={advancedSummaryStyle}>
            {advancedSummaryLabels.map((label) => (
              <InlineBadge key={label} tone="subdued">
                {label}
              </InlineBadge>
            ))}
          </div>
        ) : null}

        <div
          className={`v4-collapse${advancedOpen ? " v4-collapse--open" : ""}`}
          style={{
            maxHeight: advancedOpen ? "none" : 0,
            opacity: advancedOpen ? 1 : 0,
          }}
        >
          <div style={{ marginTop: 12 }}>
            <div style={{ marginBottom: 16 }}>
              <AiModelInFlowSelect
                label={t("v4.createTask.aiModel")}
                value={aiModel}
                options={aiModelOptions}
                onChange={onAiModelChange}
                active={advancedOpen}
              />
            </div>
            <div style={advancedHintStyle}>
              {advancedSummaryLabels.map((label) => (
                <InlineBadge key={label} tone="subdued">
                  {label}
                </InlineBadge>
              ))}
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
      <AppSModal
        open={!!upgradeModalContent}
        heading={upgradeModalContent?.title ?? ""}
        onClose={() => setUpgradeModalContent(null)}
        size="small"
        primaryAction={{
          content: t("v4.quotaGate.upgradePlan"),
          onAction: () => navigate("/app/pricing"),
        }}
        secondaryActions={[
          {
            content: t("v4.quotaGate.maybeLater"),
            onAction: () => setUpgradeModalContent(null),
          },
        ]}
      >
        <div style={{ fontSize: 14, lineHeight: 1.6, color: v4Colors.text }}>
          {upgradeModalContent?.body}
        </div>
      </AppSModal>
    </div>
  );
}

function SectionHeader({
  title,
  meta,
  action,
}: {
  title: string;
  meta?: ReactNode;
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
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 13,
          fontWeight: 600,
          color: v4Colors.text,
          lineHeight: 1.35,
          overflowWrap: "anywhere",
          minWidth: 0,
        }}
      >
        <span style={{ minWidth: 0 }}>{title}</span>
        {meta}
      </div>
      {action}
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div
      style={{
        fontSize: 13,
        fontWeight: 600,
        color: v4Colors.textMuted,
        marginBottom: 8,
        lineHeight: 1.35,
        overflowWrap: "anywhere",
      }}
    >
      {children}
    </div>
  );
}

function CheckboxOptionCard({
  label,
  selected,
  indeterminate = false,
  disabled = false,
  onToggle,
  prefix,
}: {
  label: string;
  selected: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
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
    <label style={checkboxCardStyle(selected, disabled)}>
      <input
        ref={inputRef}
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        style={checkboxInputStyle}
        disabled={disabled}
      />
      <span style={{ minWidth: 0, flex: 1 }}>
        <span
          style={{
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: 6,
            justifyContent: "space-between",
          }}
        >
          <span
            style={{
              minWidth: 0,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
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
            <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
              {label}
            </span>
          </span>
        </span>
      </span>
      {disabled ? (
        <button
          type="button"
          aria-label={label}
          onClick={onToggle}
          style={disabledActionOverlayStyle}
        />
      ) : null}
    </label>
  );
}

function InlineBadge({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "subdued" | "info";
}) {
  const toneStyles =
    tone === "info"
      ? {
          background: "rgba(46, 125, 246, 0.12)",
          color: v4Colors.info,
          borderColor: "rgba(46, 125, 246, 0.18)",
        }
      : tone === "subdued"
        ? {
            background: v4Colors.cardSubdued,
            color: v4Colors.textMuted,
            borderColor: v4Colors.cardBorder,
          }
        : {
            background: v4Colors.cardBg,
            color: v4Colors.text,
            borderColor: v4Colors.cardBorder,
          };

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        minHeight: 22,
        padding: "0 8px",
        borderRadius: 999,
        border: `1px solid ${toneStyles.borderColor}`,
        background: toneStyles.background,
        color: toneStyles.color,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1,
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {children}
    </span>
  );
}

function isAiModelAllowedForTier(
  modelValue: string,
  currentTier: ModelPlanTier,
): boolean {
  const requiredTier = AI_MODEL_MIN_PLAN[modelValue] ?? "free";
  return planTierRank(currentTier) >= planTierRank(requiredTier);
}

function formatAiModelOptionLabel({
  value,
  currentTier,
  t,
}: {
  value: string;
  currentTier: ModelPlanTier;
  t: ReturnType<typeof useTranslation>["t"];
}): string {
  const baseLabel = getV4AiModelLabel(value, t);
  const requiredTier = AI_MODEL_MIN_PLAN[value] ?? "free";
  if (planTierRank(currentTier) >= planTierRank(requiredTier)) {
    return baseLabel;
  }
  return `${baseLabel} ${t("v4.createTask.planPaidOnlySuffix")}`;
}

function planTierRank(tier: ModelPlanTier): number {
  if (tier === "premium") return 3;
  if (tier === "pro") return 2;
  if (tier === "basic") return 1;
  return 0;
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
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: 12,
};

const disabledActionOverlayStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  border: "none",
  padding: 0,
  margin: 0,
  background: "transparent",
  cursor: "not-allowed",
};

const advancedSummaryStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
  marginTop: 10,
};

const advancedHintStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
  marginBottom: 12,
};

function checkboxCardStyle(selected: boolean, disabled = false): CSSProperties {
  return {
    position: "relative",
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    minHeight: 48,
    padding: "11px 12px",
    borderRadius: 12,
    border: `1px solid ${
      selected
        ? "rgba(46, 125, 246, 0.18)"
        : disabled
          ? v4Colors.cardBorder
          : "transparent"
    }`,
    background: selected
      ? "rgba(46, 125, 246, 0.10)"
      : disabled
        ? "rgba(15, 23, 42, 0.02)"
        : v4Colors.cardSubdued,
    color: selected
      ? v4Colors.info
      : disabled
        ? v4Colors.textMuted
        : v4Colors.text,
    fontSize: 13,
    fontWeight: selected ? 600 : 500,
    lineHeight: 1.35,
    cursor: disabled ? "not-allowed" : "pointer",
    transition:
      "background-color 0.15s, border-color 0.15s, color 0.15s, opacity 0.15s",
    fontFamily: "inherit",
    userSelect: "none",
    opacity: disabled ? 0.8 : 1,
  };
}

const checkboxInputStyle: CSSProperties = {
  margin: 0,
  width: 16,
  height: 16,
  flexShrink: 0,
  accentColor: v4Colors.primary,
};
