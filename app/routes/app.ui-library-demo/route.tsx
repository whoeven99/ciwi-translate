import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { readFile, writeFile } from "node:fs/promises";
import { TitleBar } from "@shopify/app-bridge-react";
import {
  json,
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Button,
  Card,
  Checkbox,
  Divider,
  InlineStack,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { authenticate } from "~/shopify.server";
import { isProductionNodeEnv } from "~/config/nodeEnv.server";

type DemoViewKey =
  | "componentLibrary"
  | "manageHub"
  | "detailPage"
  | "operationList"
  | "media"
  | "pricing"
  | "analytics"
  | "onboarding"
  | "designStandards";

type PricingPlanKey = "free" | "basic" | "pro";
type ScanStatusKey = "preparing" | "scanning" | "ready";

interface DemoConfig {
  activeView: DemoViewKey;
  shopName: string;
  targetLanguage: string;
  brandPrimary: string;
  brandPrimaryHover: string;
  brandPrimaryDeep: string;
  bodyFontSize: string;
  bodySmallFontSize: string;
  captionFontSize: string;
  headingLgFontSize: string;
  cornerRadius: string;
  translatedCount: string;
  totalCount: string;
  selectedResource: string;
  secondaryResource: string;
  selectedCount: string;
  sourceLanguage: string;
  showSaveBar: boolean;
  showMobileCard: boolean;
  showTranslatedImage: boolean;
  enableAutoTranslate: boolean;
  highlightThirdParty: boolean;
  pricingPlan: PricingPlanKey;
  nextPaymentDate: string;
  scanStatus: ScanStatusKey;
  translatableItems: string;
  sourceCharacters: string;
  promptTone: string;
  showHistoryEmpty: boolean;
}

const CONFIG_FILE_URL = new URL("./demo-config.json", import.meta.url);

const DEFAULT_CONFIG: DemoConfig = {
  activeView: "componentLibrary",
  shopName: "CIWI Demo Store",
  targetLanguage: "French (FR)",
  brandPrimary: "#5467ff",
  brandPrimaryHover: "#4254e8",
  brandPrimaryDeep: "#2d3572",
  bodyFontSize: "14px",
  bodySmallFontSize: "13px",
  captionFontSize: "12px",
  headingLgFontSize: "28px",
  cornerRadius: "12px",
  translatedCount: "12,480",
  totalCount: "18,205",
  selectedResource: "Summer Dress",
  secondaryResource: "Canvas Bag",
  selectedCount: "2",
  sourceLanguage: "English",
  showSaveBar: true,
  showMobileCard: true,
  showTranslatedImage: true,
  enableAutoTranslate: true,
  highlightThirdParty: true,
  pricingPlan: "basic",
  nextPaymentDate: "Sep 05",
  scanStatus: "scanning",
  translatableItems: "18,205",
  sourceCharacters: "1.2M",
  promptTone: "clean, modern, premium but friendly",
  showHistoryEmpty: true,
};

const VIEW_OPTIONS: Array<{
  key: DemoViewKey;
  label: string;
  description: string;
  source: string;
}> = [
  {
    key: "componentLibrary",
    label: "Component Library",
    description: "按钮、状态、表单、表格、空态和 CTA 的标准组件预览。",
    source: "UI baseline / reusable patterns",
  },
  {
    key: "manageHub",
    label: "Manage Translation Hub",
    description: "入口页：locale 选择、摘要卡、分组入口卡片。",
    source: "app.manage_translation",
  },
  {
    key: "detailPage",
    label: "Editable Detail Page",
    description: "编辑型详情页：SaveBar、资源列表、右侧翻译表格。",
    source: "app.manage_translation_.product family",
  },
  {
    key: "operationList",
    label: "Operation Lists",
    description: "语言 / 币种 / 术语表：批量操作、状态列、移动端卡片。",
    source: "app.language / app.currency / app.glossary",
  },
  {
    key: "media",
    label: "Media Translation",
    description: "图片翻译：媒体预览、上传/删除动作、语言选择。",
    source: "app.manage_translation_.productImage",
  },
  {
    key: "pricing",
    label: "Pricing Page",
    description: "商业化页面：套餐卡、对比表、FAQ。",
    source: "app.pricing / paymentModal",
  },
  {
    key: "analytics",
    label: "Analytics / Report",
    description: "分析报告页：扫描状态、画像、指标、提示词。",
    source: "app.shop-profile",
  },
  {
    key: "onboarding",
    label: "Onboarding / History",
    description: "状态型页面：引导流、进度态、空历史页。",
    source: "app.onboarding / app.translate-v4-history",
  },
  {
    key: "designStandards",
    label: "Design Standards",
    description: "整体配色、字体字号、圆角和页面结构约束规范。",
    source: "design tokens / layout rules",
  },
];

const pageGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "320px minmax(0, 1fr)",
  gap: 20,
  alignItems: "start",
};

const railStackStyle: CSSProperties = {
  display: "grid",
  gap: 16,
  position: "sticky",
  top: 20,
};

const frameStyle: CSSProperties = {
  padding: 20,
  borderRadius: 18,
  border: "1px dashed var(--app-color-border-secondary)",
  background: "rgba(255, 255, 255, 0.56)",
};

const sectionGrid2Style: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 16,
};

const sectionGrid3Style: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 16,
};

const miniCardStyle: CSSProperties = {
  padding: 14,
  borderRadius: 14,
  border: "1px solid var(--app-color-border-secondary)",
  background: "rgba(255, 255, 255, 0.8)",
};

const pillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 32,
  padding: "0 12px",
  borderRadius: 8,
  border: "1px solid var(--app-color-border-secondary)",
  background: "var(--app-color-surface)",
  color: "var(--app-color-text-secondary)",
  fontSize: "var(--app-font-size-body-small)",
};

const sidebarStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
  gap: 12,
  padding: 14,
  borderRadius: 14,
  border: "1px solid var(--app-color-border-secondary)",
  background: "rgba(255, 255, 255, 0.72)",
};

const detailShellStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "220px minmax(0, 1fr)",
  gap: 18,
};

const saveBarStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "12px 14px",
  borderRadius: 14,
  border: "1px solid rgba(84, 103, 255, 0.18)",
  background:
    "linear-gradient(180deg, rgba(84, 103, 255, 0.08), rgba(84, 103, 255, 0.04))",
};

const tableStyle: CSSProperties = {
  borderRadius: 14,
  overflow: "hidden",
  border: "1px solid var(--app-color-border-secondary)",
};

const tableHeaderRowStyle: CSSProperties = {
  display: "grid",
  gap: 0,
  background: "var(--app-color-surface-secondary)",
};

const tableRowStyle: CSSProperties = {
  display: "grid",
  gap: 0,
  background: "var(--app-color-surface)",
  borderTop: "1px solid var(--app-color-border-secondary)",
};

const cellStyle: CSSProperties = {
  padding: "12px 14px",
  fontSize: "var(--app-font-size-body-small)",
};

const headerCellStyle: CSSProperties = {
  ...cellStyle,
  color: "var(--app-color-text-secondary)",
  fontSize: "var(--app-font-size-caption)",
  fontWeight: 600,
};

const mediaThumbStyle: CSSProperties = {
  width: "100%",
  height: 132,
  borderRadius: 12,
  border: "1px solid var(--app-color-border-secondary)",
  background:
    "linear-gradient(135deg, rgba(84, 103, 255, 0.12), rgba(84, 103, 255, 0.03)), linear-gradient(180deg, #ffffff, #eef2ff)",
};

const codeBlockStyle: CSSProperties = {
  padding: 14,
  borderRadius: 14,
  border: "1px solid var(--app-color-border-secondary)",
  background: "#0f172a",
  color: "#e2e8f0",
  fontSize: 12,
  lineHeight: 1.7,
  whiteSpace: "pre-wrap",
};

const activeNavStyle: CSSProperties = {
  width: "100%",
  textAlign: "left",
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid rgba(84, 103, 255, 0.22)",
  background: "var(--app-color-surface-selected)",
  cursor: "pointer",
};

const inactiveNavStyle: CSSProperties = {
  ...activeNavStyle,
  border: "1px solid var(--app-color-border-secondary)",
  background: "var(--app-color-surface)",
};

const swatchGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 16,
};

const swatchStyle: CSSProperties = {
  borderRadius: 14,
  overflow: "hidden",
  border: "1px solid var(--app-color-border-secondary)",
  background: "var(--app-color-surface)",
};

const swatchColorStyle: CSSProperties = {
  height: 88,
  width: "100%",
};

const ruleCardStyle: CSSProperties = {
  padding: 16,
  borderRadius: 16,
  border: "1px solid var(--app-color-border-secondary)",
  background: "rgba(255, 255, 255, 0.82)",
};

const previewPageShellStyle: CSSProperties = {
  padding: 18,
  borderRadius: 18,
  border: "1px solid var(--app-color-border-secondary)",
  background: "rgba(255, 255, 255, 0.74)",
};

function getPreviewScopeStyle(config: DemoConfig): CSSProperties {
  return {
    "--app-accent-primary": config.brandPrimary,
    "--app-accent-primary-hover": config.brandPrimaryHover,
    "--app-accent-primary-deep": config.brandPrimaryDeep,
    "--app-font-size-body": config.bodyFontSize,
    "--app-font-size-body-small": config.bodySmallFontSize,
    "--app-font-size-caption": config.captionFontSize,
    "--app-radius-lg": config.cornerRadius,
    "--ui-demo-heading-lg": config.headingLgFontSize,
  } as CSSProperties;
}

export default function AppUiLibraryDemo() {
  const loaderData = useLoaderData<typeof loader>();
  const saveFetcher = useFetcher<typeof action>();
  const [config, setConfig] = useState<DemoConfig>(loaderData.config);
  const [lastSavedConfig, setLastSavedConfig] = useState<DemoConfig>(loaderData.config);
  const [saveLabel, setSaveLabel] = useState(`Loaded from ${loaderData.configFilePath}`);
  const [copyLabel, setCopyLabel] = useState("Copy JSON");

  useEffect(() => {
    setConfig(loaderData.config);
    setLastSavedConfig(loaderData.config);
    setSaveLabel(`Loaded from ${loaderData.configFilePath}`);
  }, [loaderData.config, loaderData.configFilePath]);

  useEffect(() => {
    if (!saveFetcher.data?.ok || !saveFetcher.data.config) return;

    setLastSavedConfig(saveFetcher.data.config);
    setConfig(saveFetcher.data.config);
    setSaveLabel(
      `Saved to ${saveFetcher.data.configFilePath} at ${saveFetcher.data.savedAt}`,
    );
  }, [saveFetcher.data]);

  const activeMeta = useMemo(
    () => VIEW_OPTIONS.find((option) => option.key === config.activeView) ?? VIEW_OPTIONS[0],
    [config.activeView],
  );

  const updateConfig = <K extends keyof DemoConfig>(key: K, value: DemoConfig[K]) => {
    setConfig((current) => ({ ...current, [key]: value }));
  };

  const resetConfig = () => {
    setConfig(DEFAULT_CONFIG);
    setSaveLabel("Reset to defaults, not saved yet");
  };

  const reloadConfig = () => {
    setConfig(lastSavedConfig);
    setSaveLabel(`Reloaded from ${loaderData.configFilePath}`);
  };

  const copyConfig = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setCopyLabel("Clipboard unavailable");
      return;
    }

    await navigator.clipboard.writeText(JSON.stringify(config, null, 2));
    setCopyLabel("Copied");
    window.setTimeout(() => setCopyLabel("Copy JSON"), 1600);
  };

  const saveConfig = () => {
    const formData = new FormData();
    formData.append("intent", "save");
    formData.append("config", JSON.stringify(config));
    saveFetcher.submit(formData, { method: "post" });
  };

  const isDirty =
    JSON.stringify(config) !== JSON.stringify(lastSavedConfig);

  return (
    <>
      <TitleBar title="UI Library Demo" />
      <Page fullWidth>
        <div
          className="ui-demo-preview-scope"
          style={{ ...getPreviewScopeStyle(config), display: "grid", gap: 20 }}
        >
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center" wrap>
                <BlockStack gap="100">
                  <Text as="h1" variant="headingLg">
                    UI Library Demo Configurator
                  </Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    用 Polaris 组件做的轻量配置台。现在同时包含组件规范、
                    页面结构规范和设计 token 规范；右侧可视化修改后点击保存，
                    会直接写入仓库里的标准配置文件。
                  </Text>
                </BlockStack>
                <InlineStack gap="200" wrap>
                  <Badge tone="info">Polaris</Badge>
                  <Badge tone="success">File backed</Badge>
                  <Badge tone={isDirty ? "attention" : "success"}>
                    {isDirty ? "Unsaved changes" : "Synced"}
                  </Badge>
                </InlineStack>
              </InlineStack>
            </BlockStack>
          </Card>

          <div style={pageGridStyle}>
            <div style={railStackStyle}>
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Page Types
                  </Text>
                  <BlockStack gap="200">
                    {VIEW_OPTIONS.map((option) => {
                      const active = option.key === config.activeView;
                      return (
                        <button
                          key={option.key}
                          type="button"
                          style={active ? activeNavStyle : inactiveNavStyle}
                          onClick={() => updateConfig("activeView", option.key)}
                        >
                          <div style={{ display: "grid", gap: 4 }}>
                            <strong style={{ fontSize: 13 }}>{option.label}</strong>
                            <span
                              style={{
                                color: "var(--app-color-text-secondary)",
                                fontSize: 12,
                                lineHeight: 1.5,
                              }}
                            >
                              {option.description}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </BlockStack>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">
                      Save State
                    </Text>
                    <Badge tone="info">repo file</Badge>
                  </InlineStack>
                  <Text as="p" tone="subdued" variant="bodySm">
                    {saveLabel}
                  </Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    Reference file: {loaderData.configFilePath}
                  </Text>
                  <InlineStack gap="200" wrap>
                    <Button
                      variant="primary"
                      onClick={saveConfig}
                      loading={saveFetcher.state !== "idle"}
                      disabled={!isDirty}
                    >
                      Save standard
                    </Button>
                    <Button onClick={reloadConfig} disabled={!isDirty}>
                      Reload file
                    </Button>
                    <Button onClick={copyConfig}>{copyLabel}</Button>
                    <Button onClick={resetConfig}>Reset</Button>
                  </InlineStack>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Current Config
                  </Text>
                  <div style={codeBlockStyle}>{JSON.stringify(config, null, 2)}</div>
                </BlockStack>
              </Card>
            </div>

            <div style={{ display: "grid", gap: 16 }}>
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center" wrap>
                    <BlockStack gap="100">
                      <Text as="h2" variant="headingMd">
                        {activeMeta.label}
                      </Text>
                      <Text as="p" tone="subdued" variant="bodySm">
                        {activeMeta.source}
                      </Text>
                    </BlockStack>
                    <Badge tone="success">Preview updates live</Badge>
                  </InlineStack>
                  <ConfigPanel config={config} updateConfig={updateConfig} />
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center" wrap>
                    <Text as="h2" variant="headingMd">
                      Preview
                    </Text>
                    <InlineStack gap="200" wrap>
                      <Pill>{config.shopName}</Pill>
                      <Pill>{config.targetLanguage}</Pill>
                    </InlineStack>
                  </InlineStack>
                  {renderPreview(config)}
                </BlockStack>
              </Card>
            </div>
          </div>
        </div>
      </Page>
    </>
  );
}

function ConfigPanel({
  config,
  updateConfig,
}: {
  config: DemoConfig;
  updateConfig: <K extends keyof DemoConfig>(key: K, value: DemoConfig[K]) => void;
}) {
  return (
    <BlockStack gap="400">
      <div style={sectionGrid2Style}>
        <TextField
          label="Shop name"
          value={config.shopName}
          onChange={(value) => updateConfig("shopName", value)}
          autoComplete="off"
        />
        <TextField
          label="Target language"
          value={config.targetLanguage}
          onChange={(value) => updateConfig("targetLanguage", value)}
          autoComplete="off"
        />
      </div>

      <div style={sectionGrid2Style}>
        <TextField
          label="Primary brand color"
          value={config.brandPrimary}
          onChange={(value) => updateConfig("brandPrimary", value)}
          autoComplete="off"
        />
        <TextField
          label="Primary hover color"
          value={config.brandPrimaryHover}
          onChange={(value) => updateConfig("brandPrimaryHover", value)}
          autoComplete="off"
        />
        <TextField
          label="Primary deep color"
          value={config.brandPrimaryDeep}
          onChange={(value) => updateConfig("brandPrimaryDeep", value)}
          autoComplete="off"
        />
        <TextField
          label="Corner radius"
          value={config.cornerRadius}
          onChange={(value) => updateConfig("cornerRadius", value)}
          autoComplete="off"
        />
      </div>

      <div style={sectionGrid2Style}>
        <TextField
          label="Body font size"
          value={config.bodyFontSize}
          onChange={(value) => updateConfig("bodyFontSize", value)}
          autoComplete="off"
        />
        <TextField
          label="Body small font size"
          value={config.bodySmallFontSize}
          onChange={(value) => updateConfig("bodySmallFontSize", value)}
          autoComplete="off"
        />
        <TextField
          label="Caption font size"
          value={config.captionFontSize}
          onChange={(value) => updateConfig("captionFontSize", value)}
          autoComplete="off"
        />
        <TextField
          label="Heading LG size"
          value={config.headingLgFontSize}
          onChange={(value) => updateConfig("headingLgFontSize", value)}
          autoComplete="off"
        />
      </div>

      <Select
        label="Active preview"
        options={VIEW_OPTIONS.map((option) => ({
          label: option.label,
          value: option.key,
        }))}
        value={config.activeView}
        onChange={(value) => updateConfig("activeView", value as DemoViewKey)}
      />

      {config.activeView === "componentLibrary" ? (
        <div style={sectionGrid2Style}>
          <Checkbox
            label="Use saturated CTA color"
            checked={config.enableAutoTranslate}
            onChange={(value) => updateConfig("enableAutoTranslate", value)}
          />
          <Checkbox
            label="Show mobile card pattern"
            checked={config.showMobileCard}
            onChange={(value) => updateConfig("showMobileCard", value)}
          />
          <TextField
            label="Primary resource"
            value={config.selectedResource}
            onChange={(value) => updateConfig("selectedResource", value)}
            autoComplete="off"
          />
          <TextField
            label="Secondary resource"
            value={config.secondaryResource}
            onChange={(value) => updateConfig("secondaryResource", value)}
            autoComplete="off"
          />
        </div>
      ) : null}

      {config.activeView === "manageHub" ? (
        <div style={sectionGrid2Style}>
          <TextField
            label="Translated count"
            value={config.translatedCount}
            onChange={(value) => updateConfig("translatedCount", value)}
            autoComplete="off"
          />
          <TextField
            label="Total count"
            value={config.totalCount}
            onChange={(value) => updateConfig("totalCount", value)}
            autoComplete="off"
          />
          <Checkbox
            label="Highlight third-party apps card"
            checked={config.highlightThirdParty}
            onChange={(value) => updateConfig("highlightThirdParty", value)}
          />
          <Checkbox
            label="Enable auto-translate label"
            checked={config.enableAutoTranslate}
            onChange={(value) => updateConfig("enableAutoTranslate", value)}
          />
        </div>
      ) : null}

      {config.activeView === "detailPage" ? (
        <div style={sectionGrid2Style}>
          <TextField
            label="Primary resource"
            value={config.selectedResource}
            onChange={(value) => updateConfig("selectedResource", value)}
            autoComplete="off"
          />
          <TextField
            label="Secondary resource"
            value={config.secondaryResource}
            onChange={(value) => updateConfig("secondaryResource", value)}
            autoComplete="off"
          />
          <Checkbox
            label="Show SaveBar"
            checked={config.showSaveBar}
            onChange={(value) => updateConfig("showSaveBar", value)}
          />
          <Checkbox
            label="Enable auto-translate badge"
            checked={config.enableAutoTranslate}
            onChange={(value) => updateConfig("enableAutoTranslate", value)}
          />
        </div>
      ) : null}

      {config.activeView === "operationList" ? (
        <div style={sectionGrid2Style}>
          <TextField
            label="Selected count"
            value={config.selectedCount}
            onChange={(value) => updateConfig("selectedCount", value)}
            autoComplete="off"
          />
          <TextField
            label="Primary resource label"
            value={config.selectedResource}
            onChange={(value) => updateConfig("selectedResource", value)}
            autoComplete="off"
          />
          <Checkbox
            label="Show mobile card layout"
            checked={config.showMobileCard}
            onChange={(value) => updateConfig("showMobileCard", value)}
          />
          <Checkbox
            label="Enable auto-translate column"
            checked={config.enableAutoTranslate}
            onChange={(value) => updateConfig("enableAutoTranslate", value)}
          />
        </div>
      ) : null}

      {config.activeView === "media" ? (
        <div style={sectionGrid2Style}>
          <TextField
            label="Source language"
            value={config.sourceLanguage}
            onChange={(value) => updateConfig("sourceLanguage", value)}
            autoComplete="off"
          />
          <TextField
            label="Resource name"
            value={config.selectedResource}
            onChange={(value) => updateConfig("selectedResource", value)}
            autoComplete="off"
          />
          <Checkbox
            label="Show translated image card"
            checked={config.showTranslatedImage}
            onChange={(value) => updateConfig("showTranslatedImage", value)}
          />
          <Checkbox
            label="Enable auto-translate helper"
            checked={config.enableAutoTranslate}
            onChange={(value) => updateConfig("enableAutoTranslate", value)}
          />
        </div>
      ) : null}

      {config.activeView === "pricing" ? (
        <div style={sectionGrid2Style}>
          <Select
            label="Highlighted plan"
            options={[
              { label: "Free", value: "free" },
              { label: "Basic", value: "basic" },
              { label: "Pro", value: "pro" },
            ]}
            value={config.pricingPlan}
            onChange={(value) => updateConfig("pricingPlan", value as PricingPlanKey)}
          />
          <TextField
            label="Next payment date"
            value={config.nextPaymentDate}
            onChange={(value) => updateConfig("nextPaymentDate", value)}
            autoComplete="off"
          />
        </div>
      ) : null}

      {config.activeView === "analytics" ? (
        <div style={sectionGrid2Style}>
          <Select
            label="Scan status"
            options={[
              { label: "Preparing", value: "preparing" },
              { label: "Scanning", value: "scanning" },
              { label: "Ready", value: "ready" },
            ]}
            value={config.scanStatus}
            onChange={(value) => updateConfig("scanStatus", value as ScanStatusKey)}
          />
          <TextField
            label="Translatable items"
            value={config.translatableItems}
            onChange={(value) => updateConfig("translatableItems", value)}
            autoComplete="off"
          />
          <TextField
            label="Source characters"
            value={config.sourceCharacters}
            onChange={(value) => updateConfig("sourceCharacters", value)}
            autoComplete="off"
          />
          <TextField
            label="Prompt tone"
            value={config.promptTone}
            onChange={(value) => updateConfig("promptTone", value)}
            autoComplete="off"
          />
        </div>
      ) : null}

      {config.activeView === "onboarding" ? (
        <div style={sectionGrid2Style}>
          <Checkbox
            label="Show history empty state"
            checked={config.showHistoryEmpty}
            onChange={(value) => updateConfig("showHistoryEmpty", value)}
          />
          <Checkbox
            label="Show auto-translate recommendation"
            checked={config.enableAutoTranslate}
            onChange={(value) => updateConfig("enableAutoTranslate", value)}
          />
          <TextField
            label="Target language"
            value={config.targetLanguage}
            onChange={(value) => updateConfig("targetLanguage", value)}
            autoComplete="off"
          />
          <TextField
            label="Primary resource"
            value={config.selectedResource}
            onChange={(value) => updateConfig("selectedResource", value)}
            autoComplete="off"
          />
        </div>
      ) : null}

      {config.activeView === "designStandards" ? (
        <div style={sectionGrid2Style}>
          <TextField
            label="Body font size"
            value={config.bodyFontSize}
            onChange={(value) => updateConfig("bodyFontSize", value)}
            autoComplete="off"
          />
          <TextField
            label="Heading LG size"
            value={config.headingLgFontSize}
            onChange={(value) => updateConfig("headingLgFontSize", value)}
            autoComplete="off"
          />
          <TextField
            label="Primary brand color"
            value={config.brandPrimary}
            onChange={(value) => updateConfig("brandPrimary", value)}
            autoComplete="off"
          />
          <TextField
            label="Corner radius"
            value={config.cornerRadius}
            onChange={(value) => updateConfig("cornerRadius", value)}
            autoComplete="off"
          />
        </div>
      ) : null}
    </BlockStack>
  );
}

function renderPreview(config: DemoConfig) {
  switch (config.activeView) {
    case "componentLibrary":
      return <ComponentLibraryPreview config={config} />;
    case "manageHub":
      return <ManageHubPreview config={config} />;
    case "detailPage":
      return <DetailPagePreview config={config} />;
    case "operationList":
      return <OperationListPreview config={config} />;
    case "media":
      return <MediaPreview config={config} />;
    case "pricing":
      return <PricingPreview config={config} />;
    case "analytics":
      return <AnalyticsPreview config={config} />;
    case "onboarding":
      return <OnboardingPreview config={config} />;
    case "designStandards":
      return <DesignStandardsPreview config={config} />;
    default:
      return null;
  }
}

function ComponentLibraryPreview({ config }: { config: DemoConfig }) {
  return (
    <div style={frameStyle}>
      <BlockStack gap="400">
        <div style={sectionGrid2Style}>
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                Button and CTA standards
              </Text>
              <Text as="p" tone="subdued" variant="bodySm">
                主按钮保持高饱和品牌色，次级按钮只保留边框和轻交互反馈。
              </Text>
              <InlineStack gap="200" wrap>
                <Button variant="primary">Primary action</Button>
                <Button>Secondary action</Button>
                <Button variant="tertiary">Tertiary action</Button>
                <Button tone="critical" variant="secondary">
                  Delete
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                Status and feedback
              </Text>
              <InlineStack gap="200" wrap>
                <Badge tone="success">Healthy</Badge>
                <Badge tone="attention">Needs review</Badge>
                <Badge tone="info">Draft</Badge>
                <Badge tone="critical">Blocked</Badge>
              </InlineStack>
              <div style={ruleCardStyle}>
                <Text as="p" tone="subdued" variant="bodySm">
                  规则：状态色只用于状态，不用于大面积按钮；CTA 只保留一组主色。
                </Text>
              </div>
            </BlockStack>
          </Card>
        </div>

        <div style={sectionGrid2Style}>
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                Form controls
              </Text>
              <TextField
                label="Localized title"
                value={`${config.selectedResource} (${config.targetLanguage})`}
                onChange={() => {}}
                autoComplete="off"
              />
              <Select
                label="Target language"
                options={[
                  { label: config.targetLanguage, value: config.targetLanguage },
                  { label: "Deutsch", value: "Deutsch" },
                  { label: "Japanese", value: "Japanese" },
                ]}
                value={config.targetLanguage}
                onChange={() => {}}
              />
              <Checkbox
                label="Enable auto translate by default"
                checked={config.enableAutoTranslate}
                onChange={() => {}}
              />
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                Save and empty states
              </Text>
              <div style={saveBarStyle}>
                <Text as="span" tone="subdued" variant="bodySm">
                  Unsaved changes in component standard
                </Text>
                <InlineStack gap="200">
                  <Button>Cancel</Button>
                  <Button variant="primary">Save</Button>
                </InlineStack>
              </div>
              <div style={ruleCardStyle}>
                <BlockStack gap="200">
                  <Text as="span" fontWeight="semibold">
                    Empty state guidance
                  </Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    标题一句话讲清状态，下面给一个动作按钮，不要堆过多辅助文案。
                  </Text>
                  <Button variant="primary">Create first task</Button>
                </BlockStack>
              </div>
            </BlockStack>
          </Card>
        </div>

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center" wrap>
              <Text as="h3" variant="headingMd">
                Table and mobile fallback
              </Text>
              <Badge tone="info">List pattern</Badge>
            </InlineStack>
            <DataPreviewTable
              headers={["Field", "Source", "Translated", "Action"]}
              rows={[
                [
                  "Title",
                  config.selectedResource,
                  `${config.selectedResource} (${config.targetLanguage})`,
                  <ActionText key="component-edit-title">Edit</ActionText>,
                ],
                [
                  "Description",
                  "A concise product description in source language.",
                  "Localized description preview.",
                  <ActionText key="component-edit-body">Translate</ActionText>,
                ],
              ]}
            />
            {config.showMobileCard ? (
              <div style={sectionGrid2Style}>
                <MobileListCard
                  title={config.targetLanguage}
                  status="Healthy"
                  autoTranslate={config.enableAutoTranslate}
                />
                <MobileListCard title="Deutsch" status="Needs review" autoTranslate={false} />
              </div>
            ) : null}
          </BlockStack>
        </Card>
      </BlockStack>
    </div>
  );
}

function DesignStandardsPreview({ config }: { config: DemoConfig }) {
  return (
    <div style={frameStyle}>
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <Text as="h3" variant="headingMd">
              Color palette and button saturation
            </Text>
            <div style={swatchGridStyle}>
              <ColorSwatch label="Primary" value={config.brandPrimary} />
              <ColorSwatch label="Hover" value={config.brandPrimaryHover} />
              <ColorSwatch label="Deep" value={config.brandPrimaryDeep} />
            </div>
            <InlineStack gap="200" wrap>
              <Button variant="primary">Primary CTA</Button>
              <Button>Secondary CTA</Button>
              <Button variant="tertiary">Text action</Button>
            </InlineStack>
          </BlockStack>
        </Card>

        <div style={sectionGrid2Style}>
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                Typography scale
              </Text>
              <TypeScaleRow label="Heading LG" value={config.headingLgFontSize}>
                <span style={{ fontSize: "var(--ui-demo-heading-lg)", fontWeight: 700 }}>
                  Build clear, single-column information hierarchy
                </span>
              </TypeScaleRow>
              <TypeScaleRow label="Body" value={config.bodyFontSize}>
                <span style={{ fontSize: "var(--app-font-size-body)" }}>
                  Body copy should stay compact and readable in product-like admin pages.
                </span>
              </TypeScaleRow>
              <TypeScaleRow label="Body Small" value={config.bodySmallFontSize}>
                <span style={{ fontSize: "var(--app-font-size-body-small)" }}>
                  Use for helper text, captions, and table metadata.
                </span>
              </TypeScaleRow>
              <TypeScaleRow label="Caption" value={config.captionFontSize}>
                <span style={{ fontSize: "var(--app-font-size-caption)" }}>
                  Status hints, tags, and dense secondary labels.
                </span>
              </TypeScaleRow>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                Layout constraints
              </Text>
              <RuleList
                items={[
                  "Settings page: single-column, section cards stacked vertically.",
                  "Detail page: header + toolbar + left resource list + right editable content.",
                  "List page: top actions, filters, desktop table, mobile card fallback.",
                  "Overview page: summary cards first, then grouped actions or reports.",
                ]}
              />
            </BlockStack>
          </Card>
        </div>

        <Card>
          <BlockStack gap="300">
            <Text as="h3" variant="headingMd">
              Page structure standards
            </Text>
            <div style={sectionGrid2Style}>
              <PagePatternCard
                title="Settings pattern"
                subtitle="Single-column"
                items={["Header", "SaveBar", "Section card", "Tight helper copy"]}
              />
              <PagePatternCard
                title="Detail pattern"
                subtitle="Editable workspace"
                items={["Header + filters", "Sidebar list", "Editable table", "Pagination"]}
              />
              <PagePatternCard
                title="Index pattern"
                subtitle="Operation list"
                items={["Bulk actions", "Index table", "Status cell", "Mobile cards"]}
              />
              <PagePatternCard
                title="Overview pattern"
                subtitle="Dashboard / report"
                items={["Summary metrics", "Grouped cards", "One primary CTA", "Secondary reports"]}
              />
            </div>
          </BlockStack>
        </Card>

        <div style={sectionGrid2Style}>
          <PreviewPageShell
            title="Settings skeleton"
            description="适合 switcher / general settings / config forms。"
            blocks={["Page header", "Save bar", "Section card", "Section card"]}
          />
          <PreviewPageShell
            title="Detail skeleton"
            description="适合 products / pages / articles / theme blocks。"
            blocks={["Header + filters", "Sidebar resource list", "Editable grid", "Footer pagination"]}
          />
        </div>
      </BlockStack>
    </div>
  );
}

function ManageHubPreview({ config }: { config: DemoConfig }) {
  const progressText = `${config.translatedCount} / ${config.totalCount} (${computePercent(
    config.translatedCount,
    config.totalCount,
  )}%)`;

  return (
    <div style={frameStyle}>
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center" wrap>
              <BlockStack gap="100">
                <Text as="h3" variant="headingMd">
                  {config.shopName}
                </Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  Manage Translation hub
                </Text>
              </BlockStack>
              <InlineStack gap="200" blockAlign="center" wrap>
                <Pill>{config.targetLanguage}</Pill>
                {config.enableAutoTranslate ? <Badge tone="success">Auto translate</Badge> : null}
              </InlineStack>
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="span" tone="subdued" variant="bodySm">
              Items translated
            </Text>
            <Text as="p" variant="headingLg">
              {progressText}
            </Text>
          </BlockStack>
        </Card>

        <div style={sectionGrid2Style}>
          <MiniInfoCard
            title="Products"
            description={`Primary focus: ${config.selectedResource}`}
            meta="2,310 items"
          />
          <MiniInfoCard
            title="Online Store Theme"
            description="Theme sections, JSON templates, locale content."
            meta="1,284 items"
          />
          <MiniInfoCard
            title="Blogs and Articles"
            description="Blog titles, article bodies, static pages."
            meta="348 items"
          />
          <MiniInfoCard
            title={config.highlightThirdParty ? "Liquid and Third-Party Apps" : "Liquid Blocks"}
            description={
              config.highlightThirdParty
                ? "Custom Liquid, PageFly, and app-owned content."
                : "Custom Liquid and theme snippets."
            }
            meta="126 items"
          />
        </div>
      </BlockStack>
    </div>
  );
}

function DetailPagePreview({ config }: { config: DemoConfig }) {
  return (
    <div style={frameStyle}>
      <BlockStack gap="400">
        {config.showSaveBar ? (
          <div style={saveBarStyle}>
            <Text as="span" tone="subdued" variant="bodySm">
              Unsaved changes in current resource
            </Text>
            <InlineStack gap="200">
              <Button>Cancel</Button>
              <Button variant="primary">Save</Button>
            </InlineStack>
          </div>
        ) : null}

        <InlineStack gap="200" wrap>
          <Pill>Search...</Pill>
          <Pill>{config.targetLanguage}</Pill>
          <Pill>Product</Pill>
          {config.enableAutoTranslate ? <Badge tone="success">Auto</Badge> : null}
        </InlineStack>

        <div style={detailShellStyle}>
          <div style={sidebarStyle}>
            <BlockStack gap="200">
              <SidebarItem active>{config.selectedResource}</SidebarItem>
              <SidebarItem>{config.secondaryResource}</SidebarItem>
              <SidebarItem>Autumn Jacket</SidebarItem>
              <SidebarItem>Wool Scarf</SidebarItem>
            </BlockStack>
            <InlineStack gap="200">
              <Button>Previous</Button>
              <Button>Next</Button>
            </InlineStack>
          </div>

          <BlockStack gap="300">
            <Text as="h3" variant="headingMd">
              {config.selectedResource}
            </Text>
            <DataPreviewTable
              headers={["Field", "Source", "Translated", "Action"]}
              rows={[
                [
                  "Title",
                  config.selectedResource,
                  `${config.selectedResource} (${config.targetLanguage})`,
                  <ActionText key="translate-title">Translate</ActionText>,
                ],
                [
                  "Description",
                  "Lightweight cotton dress for everyday wear.",
                  "Localized copy preview.",
                  <ActionText key="edit-description">Edit</ActionText>,
                ],
              ]}
            />
            <DataPreviewTable
              headers={["SEO", "Source", "Translated", "Action"]}
              rows={[
                [
                  "Meta title",
                  `${config.selectedResource} | ${config.shopName}`,
                  `${config.selectedResource} | ${config.shopName}`,
                  <ActionText key="update-seo">Update</ActionText>,
                ],
              ]}
            />
          </BlockStack>
        </div>
      </BlockStack>
    </div>
  );
}

function OperationListPreview({ config }: { config: DemoConfig }) {
  return (
    <div style={{ ...frameStyle, display: "grid", gap: 16 }}>
      <div style={sectionGrid2Style}>
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center" wrap>
              <Text as="h3" variant="headingSm">
                Desktop List
              </Text>
              <InlineStack gap="200">
                <Button>Preview store</Button>
                <Button variant="primary">Add language</Button>
              </InlineStack>
            </InlineStack>
            <InlineStack gap="200" blockAlign="center" wrap>
              <Button>Delete</Button>
              <Text as="span" tone="subdued" variant="bodySm">
                Selected {config.selectedCount} items
              </Text>
            </InlineStack>
            <DataPreviewTable
              headers={["Language", "Status", "Published", "Auto"]}
              rows={[
                [
                  config.targetLanguage,
                  <Badge key="healthy" tone="success">
                    Healthy
                  </Badge>,
                  "On",
                  config.enableAutoTranslate ? "On" : "Off",
                ],
                [
                  "Deutsch",
                  <Badge key="review" tone="attention">
                    Needs review
                  </Badge>,
                  "Off",
                  "Off",
                ],
              ]}
            />
          </BlockStack>
        </Card>

        {config.showMobileCard ? (
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                Mobile Card Layout
              </Text>
              <Text as="p" tone="subdued" variant="bodySm">
                移动端退化成卡片，而不是把桌面表格硬塞进去。
              </Text>
              <MobileListCard
                title={config.targetLanguage}
                status="Healthy"
                autoTranslate={config.enableAutoTranslate}
              />
              <MobileListCard title="Deutsch" status="Needs review" autoTranslate={false} />
            </BlockStack>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function MediaPreview({ config }: { config: DemoConfig }) {
  return (
    <div style={frameStyle}>
      <div style={detailShellStyle}>
        <div style={sidebarStyle}>
          <BlockStack gap="200">
            <SidebarItem active>{config.selectedResource}</SidebarItem>
            <SidebarItem>{config.secondaryResource}</SidebarItem>
            <SidebarItem>Leather Boots</SidebarItem>
          </BlockStack>
          <InlineStack gap="200">
            <Button>Previous</Button>
            <Button>Next</Button>
          </InlineStack>
        </div>

        <BlockStack gap="300">
          <Text as="h3" variant="headingMd">
            Product Images
          </Text>
          <div style={sectionGrid2Style}>
            <Card>
              <BlockStack gap="300">
                <div style={mediaThumbStyle} />
                <Text as="p" tone="subdued" variant="bodySm">
                  Default language ({config.sourceLanguage})
                </Text>
                <InlineStack gap="200">
                  <Button>Upload</Button>
                  <Button>Delete</Button>
                </InlineStack>
              </BlockStack>
            </Card>

            {config.showTranslatedImage ? (
              <Card>
                <BlockStack gap="300">
                  <div style={mediaThumbStyle} />
                  <Text as="p" tone="subdued" variant="bodySm">
                    Translated target image ({config.targetLanguage})
                  </Text>
                  <InlineStack gap="200">
                    <Button variant="primary">Image translation</Button>
                    {config.enableAutoTranslate ? <Badge tone="success">Auto</Badge> : null}
                  </InlineStack>
                </BlockStack>
              </Card>
            ) : null}
          </div>

          <Card>
            <InlineStack gap="300" wrap>
              <BlockStack gap="100">
                <Text as="span" tone="subdued" variant="bodySm">
                  Source language
                </Text>
                <Pill>{config.sourceLanguage}</Pill>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="span" tone="subdued" variant="bodySm">
                  Target language
                </Text>
                <Pill>{config.targetLanguage}</Pill>
              </BlockStack>
            </InlineStack>
          </Card>
        </BlockStack>
      </div>
    </div>
  );
}

function PricingPreview({ config }: { config: DemoConfig }) {
  const plans = [
    {
      key: "free" as const,
      title: "Free",
      price: "$0",
      features: ["Basic translation quota", "Manual translation workflow", "Email support"],
    },
    {
      key: "basic" as const,
      title: "Basic",
      price: "$19",
      features: ["Auto translation", "Glossary and switcher", "More credits included"],
    },
    {
      key: "pro" as const,
      title: "Pro",
      price: "$79",
      features: ["Higher quota", "Priority processing", "Advanced support"],
    },
  ];

  return (
    <div style={frameStyle}>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center" wrap>
          <InlineStack gap="200" blockAlign="center" wrap>
            <Text as="h3" variant="headingMd">
              Pricing
            </Text>
            <Badge tone="info">{plans.find((plan) => plan.key === config.pricingPlan)?.title} Plan</Badge>
          </InlineStack>
          <Text as="span" tone="subdued" variant="bodySm">
            Next payment: {config.nextPaymentDate}
          </Text>
        </InlineStack>

        <div style={sectionGrid3Style}>
          {plans.map((plan) => {
            const active = plan.key === config.pricingPlan;

            return (
              <Card key={plan.key}>
                <BlockStack gap="300">
                  <InlineStack>
                    {active ? <Badge tone="attention">Selected</Badge> : <Badge tone="info">Available</Badge>}
                  </InlineStack>
                  <Text as="h4" variant="headingMd">
                    {plan.title}
                  </Text>
                  <InlineStack gap="100" blockAlign="end">
                    <Text as="span" variant="headingXl">
                      {plan.price}
                    </Text>
                    <Text as="span" tone="subdued">
                      /month
                    </Text>
                  </InlineStack>
                  <Button variant={active ? "primary" : "secondary"}>
                    {active ? "Current plan" : "Choose plan"}
                  </Button>
                  <BlockStack gap="200">
                    {plan.features.map((feature) => (
                      <InlineStack key={feature} gap="200" blockAlign="center">
                        <Badge tone="success">Yes</Badge>
                        <Text as="span" tone="subdued" variant="bodySm">
                          {feature}
                        </Text>
                      </InlineStack>
                    ))}
                  </BlockStack>
                </BlockStack>
              </Card>
            );
          })}
        </div>

        <DataPreviewTable
          headers={["Feature", "Free", "Basic", "Pro"]}
          rows={[
            ["Glossary", "-", "Yes", "Yes"],
            ["Auto translate", "-", "Yes", "Yes"],
          ]}
        />
      </BlockStack>
    </div>
  );
}

function AnalyticsPreview({ config }: { config: DemoConfig }) {
  const statusLabel =
    config.scanStatus === "preparing"
      ? "Preparing"
      : config.scanStatus === "ready"
        ? "Ready"
        : "Scanning";

  return (
    <div style={frameStyle}>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center" wrap>
          <InlineStack gap="200" blockAlign="center" wrap>
            <Text as="h3" variant="headingMd">
              Shop Profile Scan Result
            </Text>
            <Badge tone={config.scanStatus === "ready" ? "success" : "info"}>{statusLabel}</Badge>
          </InlineStack>
          <Button variant="primary">Rescan</Button>
        </InlineStack>

        <div style={sectionGrid3Style}>
          <MiniInfoCard title="Collect" description="Done" />
          <MiniInfoCard title="Extract" description="Done" />
          <MiniInfoCard title="Understand" description={statusLabel} />
        </div>

        <div style={sectionGrid2Style}>
          <Card>
            <BlockStack gap="300">
              <Text as="h4" variant="headingSm">
                Shop profile
              </Text>
              <InlineStack gap="200" wrap>
                <Badge tone="info">fashion</Badge>
                <Badge tone="info">minimal</Badge>
                <Badge tone="info">{config.targetLanguage}</Badge>
              </InlineStack>
              <Text as="p" tone="subdued" variant="bodySm">
                Brand tone: {config.promptTone}
              </Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h4" variant="headingSm">
                Content scale
              </Text>
              <div style={sectionGrid2Style}>
                <MetricTile label="Translatable items" value={config.translatableItems} />
                <MetricTile label="Source characters" value={config.sourceCharacters} />
              </div>
            </BlockStack>
          </Card>
        </div>

        <Card>
          <BlockStack gap="300">
            <Text as="h4" variant="headingSm">
              Translation prompt preview
            </Text>
            <div style={codeBlockStyle}>
              {`Brand tone: ${config.promptTone}.\n`}
              {"Target audience: cross-border fashion shoppers.\n"}
              {`Localization guidance: keep ${config.selectedResource} natural, preserve branded terms, and prefer concise CTA copy.`}
            </div>
          </BlockStack>
        </Card>
      </BlockStack>
    </div>
  );
}

function OnboardingPreview({ config }: { config: DemoConfig }) {
  return (
    <div style={frameStyle}>
      <div style={sectionGrid2Style}>
        <Card>
          <BlockStack gap="300">
            <InlineStack>
              <Badge tone="info">Preparing</Badge>
            </InlineStack>
            <Text as="h3" variant="headingMd">
              Set up your first translation task
            </Text>
            <Text as="p" tone="subdued" variant="bodySm">
              {config.shopName} is preparing {config.targetLanguage} for {config.selectedResource}.
            </Text>
            <ProgressRow step="1" label="Load locales" detail="Completed" done />
            <ProgressRow step="2" label="Fast coverage scan" detail="3 / 5 modules done" done />
            <ProgressRow
              step="3"
              label={config.enableAutoTranslate ? "Build auto recommendation" : "Build recommendation"}
              detail="Waiting for coverage snapshot"
            />
            <Divider />
            <InlineStack align="space-between" wrap>
              <Button>Skip</Button>
              <InlineStack gap="200">
                <Button>Customize</Button>
                <Button variant="primary">Create first task</Button>
              </InlineStack>
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h3" variant="headingMd">
              Task History
            </Text>
            {config.showHistoryEmpty ? (
              <div
                style={{
                  ...miniCardStyle,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 8,
                  textAlign: "center",
                  background: "var(--app-color-surface-secondary)",
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    background:
                      "linear-gradient(180deg, rgba(84, 103, 255, 0.12), rgba(84, 103, 255, 0.04))",
                  }}
                />
                <Text as="p" variant="bodyMd" fontWeight="semibold">
                  No task history yet
                </Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  Completed, cancelled, or deleted tasks will appear here.
                </Text>
                <Button>Back to current tasks</Button>
              </div>
            ) : (
              <DataPreviewTable
                headers={["Task", "Target", "Status", "Action"]}
                rows={[
                  [config.selectedResource, config.targetLanguage, "Completed", <ActionText key="view-task">View</ActionText>],
                  ["Theme sections", config.targetLanguage, "Cancelled", <ActionText key="retry-task">Retry</ActionText>],
                ]}
              />
            )}
          </BlockStack>
        </Card>
      </div>
    </div>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return <span style={pillStyle}>{children}</span>;
}

function MiniInfoCard({
  title,
  description,
  meta,
}: {
  title: string;
  description: string;
  meta?: string;
}) {
  return (
    <div style={miniCardStyle}>
      <BlockStack gap="200">
        <Text as="h4" variant="headingSm">
          {title}
        </Text>
        <Text as="p" tone="subdued" variant="bodySm">
          {description}
        </Text>
        {meta ? (
          <Text as="span" tone="subdued" variant="bodySm">
            {meta}
          </Text>
        ) : null}
      </BlockStack>
    </div>
  );
}

function SidebarItem({
  children,
  active = false,
}: {
  children: ReactNode;
  active?: boolean;
}) {
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 8,
        color: active ? "var(--app-color-text)" : "var(--app-color-text-secondary)",
        fontSize: "var(--app-font-size-body-small)",
        background: active ? "var(--app-color-surface-selected)" : "transparent",
        fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </div>
  );
}

function ActionText({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        color: "var(--app-accent-primary)",
        fontSize: "var(--app-font-size-body-small)",
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
}

function DataPreviewTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: Array<Array<ReactNode>>;
}) {
  const gridTemplateColumns = `repeat(${headers.length}, minmax(0, 1fr))`;

  return (
    <div style={tableStyle}>
      <div style={{ ...tableHeaderRowStyle, gridTemplateColumns }}>
        {headers.map((header) => (
          <div key={header} style={headerCellStyle}>
            {header}
          </div>
        ))}
      </div>
      {rows.map((row, rowIndex) => (
        <div key={`row-${rowIndex}`} style={{ ...tableRowStyle, gridTemplateColumns }}>
          {row.map((cell, cellIndex) => (
            <div key={`cell-${rowIndex}-${cellIndex}`} style={cellStyle}>
              {cell}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function MobileListCard({
  title,
  status,
  autoTranslate,
}: {
  title: string;
  status: string;
  autoTranslate: boolean;
}) {
  return (
    <div style={miniCardStyle}>
      <BlockStack gap="200">
        <Text as="h4" variant="headingSm">
          {title}
        </Text>
        <InlineStack align="space-between" blockAlign="center">
          <Text as="span" variant="bodySm">
            Status
          </Text>
          <Badge tone={status === "Healthy" ? "success" : "attention"}>{status}</Badge>
        </InlineStack>
        <InlineStack align="space-between" blockAlign="center">
          <Text as="span" variant="bodySm">
            Auto translate
          </Text>
          <Badge tone={autoTranslate ? "success" : "info"}>{autoTranslate ? "On" : "Off"}</Badge>
        </InlineStack>
        <InlineStack gap="200">
          <Button variant="primary">Translate</Button>
          <Button>Manage</Button>
        </InlineStack>
      </BlockStack>
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div style={miniCardStyle}>
      <BlockStack gap="100">
        <Text as="span" tone="subdued" variant="bodySm">
          {label}
        </Text>
        <Text as="p" variant="headingLg">
          {value}
        </Text>
      </BlockStack>
    </div>
  );
}

function ColorSwatch({ label, value }: { label: string; value: string }) {
  return (
    <div style={swatchStyle}>
      <div style={{ ...swatchColorStyle, background: value }} />
      <div style={{ padding: 12 }}>
        <BlockStack gap="100">
          <Text as="span" fontWeight="semibold">
            {label}
          </Text>
          <Text as="span" tone="subdued" variant="bodySm">
            {value}
          </Text>
        </BlockStack>
      </div>
    </div>
  );
}

function TypeScaleRow({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <div style={ruleCardStyle}>
      <BlockStack gap="100">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="span" fontWeight="semibold">
            {label}
          </Text>
          <Text as="span" tone="subdued" variant="bodySm">
            {value}
          </Text>
        </InlineStack>
        <div>{children}</div>
      </BlockStack>
    </div>
  );
}

function RuleList({ items }: { items: string[] }) {
  return (
    <div style={ruleCardStyle}>
      <BlockStack gap="200">
        {items.map((item) => (
          <InlineStack key={item} gap="200" blockAlign="start">
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: "var(--app-accent-primary)",
                marginTop: 6,
                flexShrink: 0,
              }}
            />
            <Text as="p" tone="subdued" variant="bodySm">
              {item}
            </Text>
          </InlineStack>
        ))}
      </BlockStack>
    </div>
  );
}

function PagePatternCard({
  title,
  subtitle,
  items,
}: {
  title: string;
  subtitle: string;
  items: string[];
}) {
  return (
    <div style={ruleCardStyle}>
      <BlockStack gap="200">
        <Text as="h4" variant="headingSm">
          {title}
        </Text>
        <Text as="p" tone="subdued" variant="bodySm">
          {subtitle}
        </Text>
        <RuleList items={items} />
      </BlockStack>
    </div>
  );
}

function PreviewPageShell({
  title,
  description,
  blocks,
}: {
  title: string;
  description: string;
  blocks: string[];
}) {
  return (
    <div style={previewPageShellStyle}>
      <BlockStack gap="300">
        <BlockStack gap="100">
          <Text as="h4" variant="headingSm">
            {title}
          </Text>
          <Text as="p" tone="subdued" variant="bodySm">
            {description}
          </Text>
        </BlockStack>
        <BlockStack gap="200">
          {blocks.map((block) => (
            <div
              key={block}
              style={{
                padding: "14px 16px",
                borderRadius: 12,
                border: "1px dashed var(--app-color-border-secondary)",
                background: "var(--app-color-surface-secondary)",
              }}
            >
              <Text as="span" variant="bodySm">
                {block}
              </Text>
            </div>
          ))}
        </BlockStack>
      </BlockStack>
    </div>
  );
}

function ProgressRow({
  step,
  label,
  detail,
  done = false,
}: {
  step: string;
  label: string;
  detail?: string;
  done?: boolean;
}) {
  return (
    <InlineStack gap="300" blockAlign="center">
      <div
        style={{
          width: 28,
          height: 28,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 999,
          background: done
            ? "var(--app-accent-growth-soft)"
            : "var(--app-accent-primary-soft)",
          color: done ? "var(--app-accent-growth)" : "var(--app-accent-primary)",
          fontSize: "var(--app-font-size-caption)",
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {step}
      </div>
      <BlockStack gap="100">
        <Text as="span" fontWeight="semibold">
          {label}
        </Text>
        {detail ? (
          <Text as="span" tone="subdued" variant="bodySm">
            {detail}
          </Text>
        ) : null}
      </BlockStack>
    </InlineStack>
  );
}

function formatClock(date: Date) {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function computePercent(value: string, total: string) {
  const current = Number(value.replace(/,/g, ""));
  const max = Number(total.replace(/,/g, ""));

  if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.round((current / max) * 100);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (isProductionNodeEnv()) {
    throw redirect("/app/translate-v4-mvp");
  }
  await authenticate.admin(request);
  const config = await readStoredConfig();

  return json({
    config,
    configFilePath: "/app/routes/app.ui-library-demo/demo-config.json",
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  // This demo writes back to source files, so keep it local-only.
  if (isProductionNodeEnv()) {
    throw redirect("/app/translate-v4-mvp");
  }
  await authenticate.admin(request);

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent !== "save") {
    return json(
      {
        ok: false,
        error: "Unsupported action",
      },
      { status: 400 },
    );
  }

  const rawConfig = formData.get("config");
  if (typeof rawConfig !== "string") {
    return json(
      {
        ok: false,
        error: "Missing config payload",
      },
      { status: 400 },
    );
  }

  const config = parseConfig(rawConfig);
  await writeStoredConfig(config);

  return json({
    ok: true,
    config,
    savedAt: formatClock(new Date()),
    configFilePath: "/app/routes/app.ui-library-demo/demo-config.json",
  });
};

async function readStoredConfig(): Promise<DemoConfig> {
  try {
    const raw = await readFile(CONFIG_FILE_URL, "utf8");
    return parseConfig(raw);
  } catch {
    return DEFAULT_CONFIG;
  }
}

async function writeStoredConfig(config: DemoConfig) {
  const payload = `${JSON.stringify(config, null, 2)}\n`;
  await writeFile(CONFIG_FILE_URL, payload, "utf8");
}

function parseConfig(raw: string): DemoConfig {
  try {
    const parsed = JSON.parse(raw) as Partial<DemoConfig>;
    return normalizeConfig(parsed);
  } catch {
    return DEFAULT_CONFIG;
  }
}

function normalizeConfig(parsed: Partial<DemoConfig>): DemoConfig {
  const activeView = VIEW_OPTIONS.some((option) => option.key === parsed.activeView)
    ? parsed.activeView
    : DEFAULT_CONFIG.activeView;
  const pricingPlan =
    parsed.pricingPlan === "free" ||
    parsed.pricingPlan === "basic" ||
    parsed.pricingPlan === "pro"
      ? parsed.pricingPlan
      : DEFAULT_CONFIG.pricingPlan;
  const scanStatus =
    parsed.scanStatus === "preparing" ||
    parsed.scanStatus === "scanning" ||
    parsed.scanStatus === "ready"
      ? parsed.scanStatus
      : DEFAULT_CONFIG.scanStatus;

  return {
    ...DEFAULT_CONFIG,
    ...parsed,
    activeView,
    pricingPlan,
    scanStatus,
  };
}
