import { useCallback, useEffect, useMemo, useState } from "react";
import { TitleBar } from "@shopify/app-bridge-react";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate, useSearchParams } from "@remix-run/react";
import { BlockStack, Button, Page, Text } from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import AppPageHeader from "~/ui/components/AppPageHeader";
import { message } from "~/ui/message";
import { authenticate } from "~/shopify.server";
import {
  listV4JobSummaries,
  type TranslationJobProgressSummary,
} from "~/server/translateV4/progress.server";
import { CompactJobCard } from "../app.translate-v4/components/TaskQueueSection";
import { isHistoryV4Job } from "../app.translate-v4/jobFilters";
import {
  v4CardStyle,
  v4Colors,
  v4ContentStyle,
  v4PageStyle,
} from "../app.translate-v4/v4Styles";
import { translateV4Message } from "../app.translate-v4/v4I18n";
import { openCreditsPurchaseModal } from "~/utils/creditsPurchaseModal";
import type { ShopQuota } from "~/lib/translationQuota";
import { normalizeShopQuota } from "~/lib/translationQuota";
import { buildTranslateV4TaskCreditsPurchaseContext } from "~/utils/creditsPurchaseTaskContext";
import { useV4BillingTaskResumeRefresh } from "~/hooks/useV4BillingTaskResumeRefresh";

async function readJsonResponse<T = any>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(`Empty response body (${res.status})`);
  }
  return JSON.parse(text) as T;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const jobs = await listV4JobSummaries(session.shop, {
    limit: 50,
    escalateStuck: false,
  });
  return json({ shop: session.shop, jobs });
};

export default function AppTranslateV4History() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { shop, jobs: initialJobs } = useLoaderData<typeof loader>();
  const [jobs, setJobs] = useState<TranslationJobProgressSummary[]>(initialJobs);
  const [quota, setQuota] = useState<ShopQuota | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const normalizedQuota = useMemo(() => normalizeShopQuota(quota), [quota]);

  const historyJobs = useMemo(() => jobs.filter(isHistoryV4Job), [jobs]);
  const returnTo = useMemo(() => {
    const value = searchParams.get("returnTo");
    if (!value || !value.startsWith("/app/")) {
      return "/app/translate-v4-mvp?tab=queue";
    }
    return value;
  }, [searchParams]);

  const refreshList = useCallback(async () => {
    const res = await fetch(
      `/api/translate-v4/tasks?shopName=${encodeURIComponent(shop)}`,
    );
    const data = await readJsonResponse(res);
    if (data?.ok) {
      setJobs(data.jobs as TranslationJobProgressSummary[]);
    }
  }, [shop]);

  useV4BillingTaskResumeRefresh(refreshList);

  const refreshQuota = useCallback(async () => {
    const res = await fetch(
      `/api/translate-v4/quota?shopName=${encodeURIComponent(shop)}`,
    );
    const data = await readJsonResponse(res);
    if (data?.ok) {
      setQuota(normalizeShopQuota(data.quota as ShopQuota | null));
    }
  }, [shop]);

  useEffect(() => {
    void refreshQuota();
  }, [refreshQuota]);

  const openTaskCreditsModal = useCallback(
    (job: TranslationJobProgressSummary) => {
      openCreditsPurchaseModal(
        buildTranslateV4TaskCreditsPurchaseContext(
          job,
          normalizedQuota?.remaining ?? null,
        ),
      );
    },
    [normalizedQuota],
  );

  const handleAction = useCallback(
    async (
      taskId: string,
      actionType: "pause" | "resume" | "cancel" | "delete",
    ) => {
      try {
        const res = await fetch("/api/translate-v4/task-action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId, shopName: shop, action: actionType }),
        });
        const data = await readJsonResponse(res);
        if (data?.ok) {
          const label =
            actionType === "delete"
              ? t("v4.deleted")
              : actionType === "resume"
                ? t("v4.resuming")
                : actionType === "pause"
                  ? data.pending
                    ? t("v4.pausing")
                    : t("v4.paused")
                  : data.pending
                    ? t("v4.cancelling")
                    : t("v4.cancelled");
          message.success(label);
          await refreshList();
          return true;
        }
        if (
          actionType === "resume" &&
          data?.error === "v4.create.noCreditsPricing"
        ) {
          const targetJob =
            jobs.find((item) => item.taskId === taskId) ?? null;
          if (targetJob) {
            openTaskCreditsModal(targetJob);
          } else {
            openCreditsPurchaseModal();
          }
          return false;
        }
        message.error(
          data?.error ? translateV4Message(data.error, t) : t("v4.actionFailed"),
        );
        return false;
      } catch (err) {
        console.error("[translateV4] history task action failed:", err);
        message.error(t("v4.actionFailedRetry"));
        return false;
      }
    },
    [jobs, openTaskCreditsModal, refreshList, shop, t],
  );

  return (
    <div style={v4PageStyle}>
      <TitleBar
        title={t("v4.tasks.historyPageTitle", { count: historyJobs.length })}
      />
      <Page>
        <div style={v4ContentStyle}>
          <BlockStack gap="200">
            <div>
              <Button
                variant="plain"
                size="slim"
                onClick={() => navigate(returnTo)}
              >
                {t("v4.back")}
              </Button>
            </div>
            <AppPageHeader
              style={{ marginBottom: 18 }}
              title={t("v4.tasks.historyPageTitle", { count: historyJobs.length })}
              description={t("v4.tasks.historyHelper")}
            />
          </BlockStack>

          <div style={{ ...v4CardStyle, padding: "16px" }}>
            {historyJobs.length === 0 ? (
              <div
                style={{
                  borderRadius: 8,
                  background: v4Colors.cardSubdued,
                  padding: "32px 16px",
                }}
              >
                <div style={emptyStateStyle}>
                  <div style={emptyStateIconStyle} aria-hidden>
                    <span style={emptyStateLineStyle} />
                    <span style={emptyStateLineStyle} />
                    <span style={{ ...emptyStateLineStyle, width: 20 }} />
                  </div>
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    {t("v4.tasks.noHistory")}
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    {t("v4.tasks.noHistoryDesc")}
                  </Text>
                </div>
              </div>
            ) : (
              historyJobs.map((job) => (
                <CompactJobCard
                  key={job.taskId}
                  job={job}
                  translateSlotBusy={false}
                  expanded={expandedTaskId === job.taskId}
                  onBuyCredits={openTaskCreditsModal}
                  onToggleExpand={() =>
                    setExpandedTaskId((current) =>
                      current === job.taskId ? null : job.taskId,
                    )
                  }
                  onAction={handleAction}
                />
              ))
            )}
          </div>
        </div>
      </Page>
    </div>
  );
}

const emptyStateStyle = {
  display: "flex",
  flexDirection: "column" as const,
  alignItems: "center",
  gap: 6,
  textAlign: "center" as const,
};

const emptyStateIconStyle = {
  width: 40,
  height: 40,
  borderRadius: 12,
  background: v4Colors.cardBg,
  border: `1px solid ${v4Colors.cardBorder}`,
  display: "flex",
  flexDirection: "column" as const,
  justifyContent: "center",
  alignItems: "center",
  gap: 4,
  marginBottom: 2,
};

const emptyStateLineStyle = {
  width: 16,
  height: 2,
  borderRadius: 999,
  background: v4Colors.textFaint,
};
