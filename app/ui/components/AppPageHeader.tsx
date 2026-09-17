import { Button } from "@shopify/polaris";
import { ArrowLeftIcon } from "@shopify/polaris-icons";
import type { CSSProperties, ReactNode } from "react";
import styles from "./AppPageHeader.module.css";

export interface AppPageBackAction {
  accessibilityLabel: string;
  onAction: () => void;
}

interface AppPageHeaderProps {
  title: ReactNode;
  titleMeta?: ReactNode;
  description?: ReactNode;
  extra?: ReactNode;
  style?: CSSProperties;
  backAction?: AppPageBackAction;
}

export default function AppPageHeader({
  title,
  titleMeta,
  description,
  extra,
  style,
  backAction,
}: AppPageHeaderProps) {
  return (
    <div className={styles.header} style={style}>
      <div className={styles.lead}>
        {backAction ? (
          <div className={styles.backButtonWrap}>
            <Button
              icon={ArrowLeftIcon}
              accessibilityLabel={backAction.accessibilityLabel}
              onClick={backAction.onAction}
            />
          </div>
        ) : null}
        <div className={styles.titleWrap}>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{title}</h1>
            {titleMeta ? <div className={styles.titleMeta}>{titleMeta}</div> : null}
          </div>
          {description ? (
            <div className={styles.description}>{description}</div>
          ) : null}
        </div>
      </div>
      {extra ? <div className={styles.extra}>{extra}</div> : null}
    </div>
  );
}
