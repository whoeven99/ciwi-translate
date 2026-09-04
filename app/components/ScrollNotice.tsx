import { Typography } from "antd";

const { Text } = Typography;

interface ScrollNoticeProps {
  text: string;
  /** Optional minimum height; content can grow and wrap. */
  height?: number;
  backgroundColor?: string;
  className?: string;
}

const ScrollNotice: React.FC<ScrollNoticeProps> = ({
  text,
  height,
  backgroundColor = "var(--app-color-surface-secondary)",
  className,
}) => {
  return (
    <div
      style={{
        minHeight: height ? `${height}px` : undefined,
        position: "relative",
        backgroundColor,
        width: "100%",
        display: "flex",
        borderRadius: "var(--app-radius-sm)",
        justifyContent: "center",
        alignItems: "center",
        marginBottom: "var(--app-space-300)",
        padding: "var(--app-space-200) var(--app-space-400)",
        boxSizing: "border-box",
      }}
      className={className}
    >
      <Text
        style={{
          textAlign: "center",
          color: "var(--app-color-text-secondary)",
          whiteSpace: "normal",
          overflowWrap: "break-word",
          lineHeight: "20px",
        }}
      >
        {text}
      </Text>
    </div>
  );
};

export default ScrollNotice;
