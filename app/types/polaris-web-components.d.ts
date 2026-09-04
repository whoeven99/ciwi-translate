import type { DetailedHTMLProps, HTMLAttributes } from "react";

type SModalSize = "small" | "small-100" | "base" | "large" | "large-100";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "s-modal": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        heading?: string;
        padding?: "base" | "none";
        size?: SModalSize;
        accessibilityLabel?: string;
      };
      "s-button": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        variant?: "primary" | "secondary" | "auto" | "tertiary";
        tone?: "auto" | "neutral" | "success" | "critical";
        commandFor?: string;
        command?: string;
      };
    }
  }
}

export {};
