import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { v4Colors } from "~/routes/app.translate-v4/v4Styles";
import { SUPPORT_CHAT_OPEN_EVENT } from "~/utils/supportChat";

type SupportImageAttachment = {
  type: "image";
  url: string;
  mime: string;
  size: number;
  name?: string;
};

type SupportMessage = {
  id: string;
  sender: string;
  senderName: string | null;
  content: string;
  attachments?: SupportImageAttachment[];
  createdAt: string;
};

type SupportConversation = {
  id: string;
  status: string;
  contactEmail: string | null;
  shopEmail: string | null;
  unreadForShop: number;
  messages: SupportMessage[];
};

const OPEN_POLL_MS = 5000;
const BADGE_POLL_MS = 30000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return "";
}

function isIgnorableSupportAuthError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return /idtoken unavailable|failed to fetch an idtoken/i.test(message);
}

async function fetchConversation(
  markSeen: boolean,
): Promise<SupportConversation | null> {
  const res = await fetch(`/api/support?markSeen=${markSeen ? "true" : "false"}`, {
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { ok: boolean; conversation?: SupportConversation };
  return data.ok && data.conversation ? data.conversation : null;
}

async function postSupport(body: Record<string, unknown>): Promise<{
  ok: boolean;
  error?: string;
  message?: SupportMessage;
}> {
  const res = await fetch("/api/support", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  return (await res.json().catch(() => ({ ok: false }))) as {
    ok: boolean;
    error?: string;
    message?: SupportMessage;
  };
}

async function uploadSupportImage(file: File): Promise<SupportImageAttachment | null> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/support/upload", {
    method: "POST",
    body: form,
    credentials: "same-origin",
  });
  const data = (await res.json().catch(() => ({ ok: false }))) as {
    ok: boolean;
    attachment?: SupportImageAttachment;
    error?: string;
  };
  if (!data.ok || !data.attachment) return null;
  return data.attachment;
}

export function SupportChatWidget() {
  const { t, i18n } = useTranslation();

  const [open, setOpen] = useState(false);
  const [conversation, setConversation] = useState<SupportConversation | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);

  const [emailInput, setEmailInput] = useState("");
  const [emailSaved, setEmailSaved] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  const [pendingAttachment, setPendingAttachment] = useState<SupportImageAttachment | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textInputRef = useRef<HTMLInputElement | null>(null);

  const openPanel = useCallback(() => setOpen(true), []);

  useEffect(() => {
    window.ciwiSupportChat = { open: openPanel };
    const onOpen = () => openPanel();
    window.addEventListener(SUPPORT_CHAT_OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener(SUPPORT_CHAT_OPEN_EVENT, onOpen);
      if (window.ciwiSupportChat?.open === openPanel) {
        delete window.ciwiSupportChat;
      }
    };
  }, [openPanel]);

  const refresh = useCallback(async (markSeen: boolean) => {
    try {
      const conv = await fetchConversation(markSeen);
      if (!conv) return;
      setError(null);
      setConversation(conv);
      if (markSeen) setUnread(0);
      else setUnread(conv.unreadForShop);
    } catch (error) {
      if (isIgnorableSupportAuthError(error)) return;
      setError(t("v4.support.sendFailed"));
    }
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    // 这个组件挂在 app.tsx 上，对所有嵌入页生效。后台标签页没人看，轮询直接跳过；
    // 回到前台时补一次，避免用户看到过期的未读数。
    const tick = () => {
      if (cancelled || document.hidden) return;
      void refresh(open);
    };
    const onVisibilityChange = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    if (open) {
      tick();
      const interval = window.setInterval(tick, OPEN_POLL_MS);
      return () => {
        cancelled = true;
        document.removeEventListener("visibilitychange", onVisibilityChange);
        window.clearInterval(interval);
      };
    }

    let interval: number | undefined;
    const timeout = window.setTimeout(() => {
      tick();
      if (cancelled) return;
      interval = window.setInterval(tick, BADGE_POLL_MS);
    }, BADGE_POLL_MS);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.clearTimeout(timeout);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, [open, refresh]);

  useEffect(() => {
    if (open) messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation?.messages.length, open]);

  const handleImageFile = useCallback(
    async (file: File | null) => {
      if (!file || uploadingImage || sending) return;
      setUploadingImage(true);
      setError(null);
      try {
        const attachment = await uploadSupportImage(file);
        if (!attachment) {
          setError(t("v4.support.uploadFailed"));
          return;
        }
        setPendingAttachment(attachment);
      } catch (_error) {
        setError(t("v4.support.uploadFailed"));
      } finally {
        setUploadingImage(false);
      }
    },
    [uploadingImage, sending, t],
  );

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLInputElement>) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (!item.type.startsWith("image/")) continue;
        const file = item.getAsFile();
        if (!file) continue;
        event.preventDefault();
        void handleImageFile(file);
        break;
      }
    },
    [handleImageFile],
  );

  const handleSend = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const content = draft.trim();
      if ((!content && !pendingAttachment) || sending || uploadingImage) return;
      setSending(true);
      setError(null);
      try {
        const result = await postSupport({
          intent: "send",
          content,
          locale: i18n.language,
          ...(pendingAttachment ? { attachments: [pendingAttachment] } : {}),
        });
        if (!result.ok) {
          setError(t("v4.support.sendFailed"));
          return;
        }
        setDraft("");
        setPendingAttachment(null);
        await refresh(true);
      } catch (_error) {
        setError(t("v4.support.sendFailed"));
      } finally {
        setSending(false);
      }
    },
    [draft, pendingAttachment, sending, uploadingImage, refresh, t, i18n.language],
  );

  const handleSaveEmail = useCallback(async () => {
    const email = emailInput.trim();
    if (!EMAIL_RE.test(email)) {
      setEmailError(t("v4.support.invalidEmail"));
      return;
    }
    setEmailError(null);
    try {
      const result = await postSupport({ intent: "setEmail", email });
      if (result.ok) {
        setEmailSaved(true);
        setConversation((prev) => (prev ? { ...prev, contactEmail: email } : prev));
        return;
      }
      setEmailError(t("v4.support.sendFailed"));
    } catch (_error) {
      setEmailError(t("v4.support.sendFailed"));
    }
  }, [emailInput, t]);

  const showEmailPrompt =
    open && conversation != null && !conversation.contactEmail && !emailSaved;

  return (
    <>
      {!open && (
        <button
          type="button"
          aria-label={t("v4.support.open")}
          onClick={() => setOpen(true)}
          style={styles.launcher}
        >
          <ChatIcon />
          {unread > 0 && <span style={styles.badge}>{unread > 9 ? "9+" : unread}</span>}
        </button>
      )}

      {open && (
        <div style={styles.panel} role="dialog" aria-label={t("v4.support.dialogTitle")}>
          <div style={styles.header}>
            <span style={styles.headerTitle}>{t("v4.support.dialogTitle")}</span>
            <button
              type="button"
              aria-label={t("v4.support.close")}
              onClick={() => setOpen(false)}
              style={styles.closeBtn}
            >
              ✕
            </button>
          </div>

          <div style={styles.body}>
            <div style={styles.greeting}>{t("v4.support.greeting")}</div>

            {showEmailPrompt && (
              <div style={styles.emailBox}>
                <div style={styles.emailPrompt}>{t("v4.support.emailPrompt")}</div>
                <div style={styles.emailRow}>
                  <input
                    type="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder={t("v4.support.emailPlaceholder")}
                    style={styles.emailInput}
                  />
                  <button type="button" onClick={handleSaveEmail} style={styles.emailBtn}>
                    {t("v4.support.save")}
                  </button>
                </div>
                {emailError && <div style={styles.errorText}>{emailError}</div>}
              </div>
            )}
            {emailSaved && <div style={styles.savedText}>{t("v4.support.emailSaved")}</div>}

            {conversation && conversation.messages.length === 0 && (
              <div style={styles.empty}>{t("v4.support.empty")}</div>
            )}

            {conversation?.messages.map((m) => {
              const mine = m.sender === "shop";
              return (
                <div
                  key={m.id}
                  style={{
                    ...styles.msgRow,
                    justifyContent: mine ? "flex-end" : "flex-start",
                  }}
                >
                  <div style={mine ? styles.bubbleMine : styles.bubbleOps}>
                    {!mine && (
                      <div style={styles.senderName}>{m.senderName || t("v4.support.agent")}</div>
                    )}
                    {m.attachments?.map((attachment) =>
                      attachment.type === "image" ? (
                        <a
                          key={attachment.url}
                          href={attachment.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={styles.imageLink}
                        >
                          <img
                            src={attachment.url}
                            alt={t("v4.support.imageAlt")}
                            style={styles.msgImage}
                          />
                        </a>
                      ) : null,
                    )}
                    {m.content ? <div style={styles.msgContent}>{m.content}</div> : null}
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {error && <div style={styles.errorBar}>{error}</div>}

          {pendingAttachment && (
            <div style={styles.pendingBar}>
              <img
                src={pendingAttachment.url}
                alt={t("v4.support.imageAlt")}
                style={styles.pendingThumb}
              />
              <button
                type="button"
                style={styles.pendingRemove}
                onClick={() => setPendingAttachment(null)}
                aria-label={t("v4.support.removeImage")}
              >
                ✕
              </button>
            </div>
          )}

          <form style={styles.inputBar} onSubmit={handleSend}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                e.target.value = "";
                void handleImageFile(file);
              }}
            />
            <button
              type="button"
              aria-label={t("v4.support.attachImage")}
              style={styles.attachBtn}
              disabled={sending || uploadingImage || pendingAttachment != null}
              onClick={() => fileInputRef.current?.click()}
            >
              📎
            </button>
            <input
              ref={textInputRef}
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onPaste={handlePaste}
              placeholder={t("v4.support.messagePlaceholder")}
              style={styles.textInput}
              disabled={sending || uploadingImage}
            />
            <button
              type="submit"
              style={styles.sendBtn}
              disabled={sending || uploadingImage || (!draft.trim() && !pendingAttachment)}
            >
              {uploadingImage ? "…" : t("v4.support.send")}
            </button>
          </form>
        </div>
      )}
    </>
  );
}

function ChatIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const styles: Record<string, React.CSSProperties> = {
  launcher: {
    position: "fixed",
    right: 20,
    bottom: 20,
    width: 50,
    height: 50,
    borderRadius: "50%",
    background: v4Colors.cardBg,
    color: v4Colors.primary,
    border: `1px solid ${v4Colors.cardBorder}`,
    cursor: "pointer",
    boxShadow: "var(--app-shadow-card)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2147483000,
  },
  badge: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 20,
    height: 20,
    padding: "0 5px",
    borderRadius: 10,
    background: v4Colors.danger,
    color: "var(--p-color-text-on-color-bg-fill)",
    fontSize: 12,
    lineHeight: "20px",
    textAlign: "center",
    fontWeight: 600,
  },
  panel: {
    position: "fixed",
    right: 20,
    bottom: 20,
    width: 360,
    maxWidth: "calc(100vw - 40px)",
    height: 520,
    maxHeight: "calc(100vh - 40px)",
    background: v4Colors.cardBg,
    border: `1px solid ${v4Colors.cardBorder}`,
    borderRadius: 12,
    boxShadow: "var(--app-shadow-card-strong)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    zIndex: 2147483000,
    fontFamily: v4Colors.font,
  },
  header: {
    background: v4Colors.primarySoft,
    color: v4Colors.text,
    padding: "12px 16px",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    borderBottom: `1px solid ${v4Colors.cardBorder}`,
  },
  headerTitle: {
    fontWeight: 600,
    fontSize: 14,
    lineHeight: 1.4,
    minWidth: 0,
    overflowWrap: "anywhere",
  },
  closeBtn: {
    background: "transparent",
    border: "none",
    color: v4Colors.textMuted,
    cursor: "pointer",
    fontSize: 14,
    lineHeight: 1,
  },
  body: {
    flex: 1,
    overflowY: "auto",
    padding: 12,
    background: v4Colors.cardSubdued,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  greeting: {
    fontSize: 13,
    color: v4Colors.textMuted,
    background: v4Colors.cardBg,
    padding: "10px 12px",
    borderRadius: 10,
    border: `1px solid ${v4Colors.cardBorder}`,
    lineHeight: "20px",
  },
  emailBox: {
    background: v4Colors.cardBg,
    border: `1px solid ${v4Colors.cardBorder}`,
    borderRadius: 8,
    padding: 10,
  },
  emailPrompt: { fontSize: 12, color: v4Colors.textMuted, marginBottom: 6, lineHeight: "20px" },
  emailRow: { display: "flex", gap: 6 },
  emailInput: {
    flex: 1,
    border: `1px solid ${v4Colors.cardBorder}`,
    borderRadius: 6,
    padding: "6px 8px",
    fontSize: 13,
    background: v4Colors.cardBg,
    color: v4Colors.text,
    outline: "none",
  },
  emailBtn: {
    background: v4Colors.primary,
    color: v4Colors.primaryTextOnFill,
    border: `1px solid ${v4Colors.primary}`,
    borderRadius: 6,
    padding: "0 10px",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: "normal",
    textAlign: "center",
    lineHeight: 1.35,
    minWidth: 56,
  },
  savedText: { fontSize: 12, color: v4Colors.success, paddingLeft: 4 },
  errorText: { fontSize: 12, color: v4Colors.danger, marginTop: 4 },
  empty: {
    fontSize: 13,
    color: v4Colors.textMuted,
    textAlign: "center",
    marginTop: 24,
    lineHeight: "20px",
  },
  msgRow: { display: "flex" },
  bubbleMine: {
    background: v4Colors.primarySoft,
    color: v4Colors.text,
    padding: "8px 12px",
    borderRadius: "12px 12px 2px 12px",
    maxWidth: "78%",
    fontSize: 14,
    wordBreak: "break-word",
    lineHeight: "20px",
    border: `1px solid ${v4Colors.cardBorder}`,
  },
  bubbleOps: {
    background: v4Colors.cardBg,
    color: v4Colors.text,
    padding: "8px 12px",
    borderRadius: "12px 12px 12px 2px",
    maxWidth: "78%",
    fontSize: 14,
    wordBreak: "break-word",
    border: `1px solid ${v4Colors.cardBorder}`,
    lineHeight: "20px",
  },
  senderName: { fontSize: 11, color: v4Colors.textMuted, marginBottom: 2, fontWeight: 600 },
  msgContent: { whiteSpace: "pre-wrap" },
  imageLink: { display: "block", lineHeight: 0 },
  msgImage: {
    maxWidth: "100%",
    maxHeight: 200,
    borderRadius: 8,
    marginBottom: 4,
    display: "block",
  },
  pendingBar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderTop: `1px solid ${v4Colors.cardBorder}`,
    background: v4Colors.cardSubdued,
  },
  pendingThumb: {
    width: 48,
    height: 48,
    objectFit: "cover",
    borderRadius: 6,
    border: `1px solid ${v4Colors.cardBorder}`,
  },
  pendingRemove: {
    background: "transparent",
    border: "none",
    color: v4Colors.textMuted,
    cursor: "pointer",
    fontSize: 14,
    lineHeight: 1,
  },
  attachBtn: {
    background: v4Colors.cardBg,
    color: v4Colors.textMuted,
    border: `1px solid ${v4Colors.cardBorder}`,
    borderRadius: 8,
    width: 36,
    height: 36,
    cursor: "pointer",
    fontSize: 16,
    lineHeight: 1,
    flexShrink: 0,
  },
  errorBar: {
    fontSize: 12,
    color: v4Colors.danger,
    padding: "4px 12px",
    background: v4Colors.dangerBg,
  },
  inputBar: {
    display: "flex",
    gap: 8,
    padding: 10,
    borderTop: `1px solid ${v4Colors.cardBorder}`,
    background: v4Colors.cardBg,
  },
  textInput: {
    flex: 1,
    border: `1px solid ${v4Colors.cardBorder}`,
    borderRadius: 8,
    padding: "8px 10px",
    fontSize: 14,
    background: v4Colors.cardBg,
    color: v4Colors.text,
    outline: "none",
  },
  sendBtn: {
    background: v4Colors.primary,
    color: v4Colors.primaryTextOnFill,
    border: `1px solid ${v4Colors.primary}`,
    borderRadius: 8,
    padding: "0 16px",
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 600,
    minWidth: 64,
    whiteSpace: "normal",
    textAlign: "center",
    lineHeight: 1.35,
  },
};
