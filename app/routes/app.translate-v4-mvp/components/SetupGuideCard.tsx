import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";
import { Badge, Button, Collapsible, Icon, Link, Text } from "@shopify/polaris";
import { CheckIcon, XIcon } from "@shopify/polaris-icons";
import { useNavigate } from "@remix-run/react";
import { useTranslation } from "react-i18next";
import { APP_NAV_ITEMS } from "~/lib/appNav";
import {
  firstIncompleteSetupGuideTask,
  type SetupGuideState,
  type SetupGuideTaskId,
} from "~/lib/setupGuide";
import { openSwitcherThemeEditor } from "~/lib/themeAppExtensions";
import { appColors } from "~/ui/tokens";
import { v4CardStyle } from "~/routes/app.translate-v4/v4Styles";

type SetupGuideCardProps = {
  state: SetupGuideState;
  themeEditorUrl: string | null;
  onDismiss: () => void;
  onStartTranslate: () => void;
  onConfigureTask: () => void;
  onOpenLiquid: () => void;
};

const cardBodyStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

const titleRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  minWidth: 0,
  flexWrap: "wrap",
};

const taskListStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const taskHeaderButtonStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  margin: 0,
  padding: "8px 0",
  border: "none",
  background: "transparent",
  cursor: "pointer",
  textAlign: "left",
};

const expandedPanelStyle: CSSProperties = {
  marginLeft: 28,
  marginBottom: 8,
  padding: "16px",
  borderRadius: 8,
  background: appColors.surfaceSecondary,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1.2fr) minmax(80px, 0.8fr)",
  gap: 16,
  alignItems: "start",
};

const expandedMainStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  minWidth: 0,
};

const expandedMediaStyle: CSSProperties = {
  minHeight: 72,
};

const stepRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
  minWidth: 0,
};

const filledIconStyle: CSSProperties = {
  width: 20,
  height: 20,
  borderRadius: 9999,
  background: appColors.text,
  color: appColors.surface,
  fontSize: 11,
  fontWeight: 700,
  lineHeight: "20px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

const dashedIconStyle: CSSProperties = {
  width: 20,
  height: 20,
  borderRadius: 9999,
  border: `1.5px dashed ${appColors.textTertiary}`,
  flexShrink: 0,
  boxSizing: "border-box",
};

const stepMarkStyle = (done: boolean): CSSProperties => ({
  width: 16,
  height: 16,
  flexShrink: 0,
  marginTop: 2,
  color: done ? appColors.textSuccess : appColors.textTertiary,
});

export function SetupGuideCard({
  state,
  themeEditorUrl,
  onDismiss,
  onStartTranslate,
  onConfigureTask,
  onOpenLiquid,
}: SetupGuideCardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [expandedId, setExpandedId] = useState<SetupGuideTaskId | null>(() =>
    firstIncompleteSetupGuideTask(state),
  );
  const [userPicked, setUserPicked] = useState(false);

  useEffect(() => {
    if (userPicked) return;
    setExpandedId(firstIncompleteSetupGuideTask(state));
  }, [state, userPicked]);

  const toggleTask = (id: SetupGuideTaskId) => {
    setUserPicked(true);
    setExpandedId((current) => (current === id ? null : id));
  };

  const openThemeEditor = () => {
    if (themeEditorUrl) {
      openSwitcherThemeEditor(themeEditorUrl);
      return;
    }
    navigate(APP_NAV_ITEMS.switcher);
  };

  return (
    <div style={{ ...v4CardStyle, padding: "20px 24px" }}>
      <div style={cardBodyStyle}>
        <div style={headerStyle}>
          <div style={titleRowStyle}>
            <Text as="h2" variant="headingMd">
              {t("v4Mvp.setupGuide.title")}
            </Text>
            <Badge>
              {t("v4Mvp.setupGuide.progress", {
                completed: state.completedCount,
                total: state.totalCount,
              })}
            </Badge>
          </div>
          <Button
            variant="plain"
            icon={XIcon}
            accessibilityLabel={t("v4Mvp.setupGuide.dismiss")}
            onClick={onDismiss}
          />
        </div>

        <div style={taskListStyle}>
          <TaskBlock
            id="setup-guide-translate"
            complete={state.translate.complete}
            expanded={expandedId === "translate"}
            title={t("v4Mvp.setupGuide.translate.title")}
            description={t("v4Mvp.setupGuide.translate.description")}
            onToggle={() => toggleTask("translate")}
          >
            <StepRow
              done={state.translate.steps.clickTranslate}
              label={t("v4Mvp.setupGuide.translate.step1")}
              onActivate={onStartTranslate}
            />
            <StepRow
              done={state.translate.steps.configureTask}
              label={t("v4Mvp.setupGuide.translate.step2")}
              onActivate={onConfigureTask}
            />
          </TaskBlock>

          <TaskBlock
            id="setup-guide-glossary"
            complete={state.glossary.complete}
            expanded={expandedId === "glossary"}
            title={t("v4Mvp.setupGuide.glossary.title")}
            description={t("v4Mvp.setupGuide.glossary.description")}
            onToggle={() => toggleTask("glossary")}
          >
            <StepRow
              done={state.glossary.steps.addRule}
              label={t("v4Mvp.setupGuide.glossary.step1")}
              onActivate={() => navigate(APP_NAV_ITEMS.glossary)}
            />
          </TaskBlock>

          <TaskBlock
            id="setup-guide-third-party"
            complete={state.thirdParty.complete}
            expanded={expandedId === "thirdParty"}
            title={t("v4Mvp.setupGuide.thirdParty.title")}
            description={t("v4Mvp.setupGuide.thirdParty.description")}
            onToggle={() => toggleTask("thirdParty")}
          >
            <StepRow
              done={state.thirdParty.steps.themeEmbed}
              label={t("v4Mvp.setupGuide.thirdParty.step1")}
              onActivate={openThemeEditor}
            />
            <StepRow
              done={state.thirdParty.steps.includeLiquid}
              label={t("v4Mvp.setupGuide.thirdParty.step2")}
              onActivate={onOpenLiquid}
            />
          </TaskBlock>
        </div>
      </div>
    </div>
  );
}

function TaskBlock({
  id,
  complete,
  expanded,
  title,
  description,
  onToggle,
  children,
}: {
  id: string;
  complete: boolean;
  expanded: boolean;
  title: string;
  description: string;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        style={taskHeaderButtonStyle}
        aria-expanded={expanded}
        aria-controls={id}
        onClick={onToggle}
      >
        {complete ? (
          <span style={filledIconStyle} aria-hidden>
            ✓
          </span>
        ) : (
          <span style={dashedIconStyle} aria-hidden />
        )}
        <Text as="span" variant="headingSm">
          {title}
        </Text>
      </button>
      <Collapsible open={expanded} id={id}>
        <div style={expandedPanelStyle}>
          <div style={expandedMainStyle}>
            <Text as="p" variant="bodyMd" tone="subdued">
              {description}
            </Text>
            {children}
          </div>
          <div style={expandedMediaStyle} aria-hidden />
        </div>
      </Collapsible>
    </div>
  );
}

function StepRow({
  done,
  label,
  onActivate,
}: {
  done: boolean;
  label: string;
  onActivate: () => void;
}) {
  return (
    <div style={stepRowStyle}>
      <span style={stepMarkStyle(done)} aria-hidden>
        <Icon source={done ? CheckIcon : XIcon} />
      </span>
      {done ? (
        <Text as="span" variant="bodyMd" tone="subdued">
          {label}
        </Text>
      ) : (
        <Link onClick={onActivate} removeUnderline>
          {label}
        </Link>
      )}
    </div>
  );
}
