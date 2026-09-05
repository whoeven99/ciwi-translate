import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";
import { Badge, Button, Collapsible, Icon, Text } from "@shopify/polaris";
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

const stepsBoxStyle: CSSProperties = {
  marginLeft: 28,
  marginBottom: 8,
  padding: "12px 16px",
  borderRadius: 8,
  background: appColors.surfaceSecondary,
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const stepRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

const stepLabelStyle: CSSProperties = {
  display: "inline-flex",
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
            onToggle={() => toggleTask("translate")}
          >
            <StepRow
              done={state.translate.steps.clickTranslate}
              label={t("v4Mvp.setupGuide.translate.step1")}
              action={
                state.translate.steps.clickTranslate ? null : (
                  <Button size="slim" onClick={onStartTranslate}>
                    {t("v4Mvp.setupGuide.translate.ctaTranslate")}
                  </Button>
                )
              }
            />
            <StepRow
              done={state.translate.steps.configureTask}
              label={t("v4Mvp.setupGuide.translate.step2")}
              action={
                state.translate.steps.configureTask ? null : (
                  <Button size="slim" onClick={onConfigureTask}>
                    {t("v4Mvp.setupGuide.translate.ctaConfigure")}
                  </Button>
                )
              }
            />
          </TaskBlock>

          <TaskBlock
            id="setup-guide-glossary"
            complete={state.glossary.complete}
            expanded={expandedId === "glossary"}
            title={t("v4Mvp.setupGuide.glossary.title")}
            onToggle={() => toggleTask("glossary")}
          >
            <StepRow
              done={state.glossary.steps.addRule}
              label={t("v4Mvp.setupGuide.glossary.step1")}
              action={
                state.glossary.steps.addRule ? null : (
                  <Button size="slim" onClick={() => navigate(APP_NAV_ITEMS.glossary)}>
                    {t("v4Mvp.setupGuide.glossary.ctaAdd")}
                  </Button>
                )
              }
            />
          </TaskBlock>

          <TaskBlock
            id="setup-guide-third-party"
            complete={state.thirdParty.complete}
            expanded={expandedId === "thirdParty"}
            title={t("v4Mvp.setupGuide.thirdParty.title")}
            onToggle={() => toggleTask("thirdParty")}
          >
            <StepRow
              done={state.thirdParty.steps.themeEmbed}
              label={t("v4Mvp.setupGuide.thirdParty.step1")}
              action={
                <Button
                  size="slim"
                  onClick={() => {
                    if (themeEditorUrl) {
                      openSwitcherThemeEditor(themeEditorUrl);
                      return;
                    }
                    navigate(APP_NAV_ITEMS.switcher);
                  }}
                >
                  {t("v4Mvp.setupGuide.thirdParty.ctaTheme")}
                </Button>
              }
            />
            <StepRow
              done={state.thirdParty.steps.includeLiquid}
              label={t("v4Mvp.setupGuide.thirdParty.step2")}
              action={
                state.thirdParty.steps.includeLiquid ? null : (
                  <Button size="slim" onClick={onOpenLiquid}>
                    {t("v4Mvp.setupGuide.thirdParty.ctaLiquid")}
                  </Button>
                )
              }
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
  onToggle,
  children,
}: {
  id: string;
  complete: boolean;
  expanded: boolean;
  title: string;
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
        <div style={stepsBoxStyle}>{children}</div>
      </Collapsible>
    </div>
  );
}

function StepRow({
  done,
  label,
  action,
}: {
  done: boolean;
  label: string;
  action: ReactNode;
}) {
  return (
    <div style={stepRowStyle}>
      <span style={stepLabelStyle}>
        <span style={stepMarkStyle(done)} aria-hidden>
          <Icon source={done ? CheckIcon : XIcon} />
        </span>
        <Text as="span" variant="bodyMd" tone={done ? "subdued" : undefined}>
          {label}
        </Text>
      </span>
      {action}
    </div>
  );
}
