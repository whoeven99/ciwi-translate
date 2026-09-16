import { useCallback, useEffect, useState } from "react";
import { Space, Spin, Typography } from "antd";
import { useTranslation } from "react-i18next";
import Button from "~/ui/components/AppButton";
import { AppSModal } from "~/ui/components/AppSModal";

const { Text } = Typography;

type CreditUsageBySource = {
  v4_job: number;
  single: number;
  image: number;
};

type CreditUsageItem = {
  id: string;
  source: string;
  credits: number;
  createdAt: string;
  target: string | null;
};

const EMPTY_BY_SOURCE: CreditUsageBySource = {
  v4_job: 0,
  single: 0,
  image: 0,
};

type CreditUsageResponse = {
  ok?: boolean;
  usedCredits?: number;
  bySource?: CreditUsageBySource;
  items?: CreditUsageItem[];
  nextCursor?: string | null;
};

function formatCredits(value: number): string {
  return Math.max(0, Math.floor(value)).toLocaleString();
}

function sourceLabelKey(source: string): string {
  if (source === "v4_job" || source === "single" || source === "image") {
    return `pricing.usage.source.${source}`;
  }
  return "pricing.usage.source.other";
}

async function fetchCreditUsage(cursor?: string): Promise<CreditUsageResponse> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  const qs = params.toString();
  const res = await fetch(
    qs ? `/api/billing/credit-usage?${qs}` : "/api/billing/credit-usage",
  );
  return (await res.json()) as CreditUsageResponse;
}

function useCreditUsageQuery(open: boolean) {
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [usedCredits, setUsedCredits] = useState(0);
  const [bySource, setBySource] = useState<CreditUsageBySource>(EMPTY_BY_SOURCE);
  const [items, setItems] = useState<CreditUsageItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const reset = useCallback(() => {
    setLoading(false);
    setLoadingMore(false);
    setError(false);
    setUsedCredits(0);
    setBySource(EMPTY_BY_SOURCE);
    setItems([]);
    setNextCursor(null);
  }, []);

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    void fetchCreditUsage()
      .then((data) => {
        if (cancelled) return;
        if (!data.ok) {
          setError(true);
          return;
        }
        setUsedCredits(Math.max(0, data.usedCredits ?? 0));
        setBySource(data.bySource ?? EMPTY_BY_SOURCE);
        setItems(data.items ?? []);
        setNextCursor(data.nextCursor ?? null);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, reset]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await fetchCreditUsage(nextCursor);
      if (!data.ok) return;
      setItems((prev) => [...prev, ...(data.items ?? [])]);
      setNextCursor(data.nextCursor ?? null);
    } finally {
      setLoadingMore(false);
    }
  };

  return {
    loading,
    loadingMore,
    error,
    usedCredits,
    bySource,
    items,
    nextCursor,
    loadMore,
  };
}

function UsageBreakdown({
  usedCredits,
  bySource,
}: {
  usedCredits: number;
  bySource: CreditUsageBySource;
}) {
  const { t } = useTranslation();
  return (
    <div className="pricing-migrate-breakdown">
      <div className="pricing-migrate-breakdown__row pricing-usage-modal__total">
        <span>{t("pricing.usage.periodUsed")}</span>
        <span>{formatCredits(usedCredits)}</span>
      </div>
      <div className="pricing-migrate-breakdown__row">
        <span>{t("pricing.usage.source.v4_job")}</span>
        <span>{formatCredits(bySource.v4_job)}</span>
      </div>
      <div className="pricing-migrate-breakdown__row">
        <span>{t("pricing.usage.source.single")}</span>
        <span>{formatCredits(bySource.single)}</span>
      </div>
      <div className="pricing-migrate-breakdown__row">
        <span>{t("pricing.usage.source.image")}</span>
        <span>{formatCredits(bySource.image)}</span>
      </div>
    </div>
  );
}

function UsageList({ items }: { items: CreditUsageItem[] }) {
  const { t, i18n } = useTranslation();
  return (
    <div className="pricing-usage-modal__list">
      {items.map((item) => (
        <div key={item.id} className="pricing-usage-modal__row">
          <div className="pricing-usage-modal__row-main">
            <span>
              {new Date(item.createdAt).toLocaleString(i18n.language, {
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <span>− {formatCredits(item.credits)}</span>
          </div>
          <Text type="secondary">
            {t(sourceLabelKey(item.source))}
            {item.target ? ` · ${item.target}` : ""}
          </Text>
        </div>
      ))}
    </div>
  );
}

function CreditUsageBody({
  usedCredits,
  bySource,
  items,
  nextCursor,
  loadingMore,
  onLoadMore,
}: {
  usedCredits: number;
  bySource: CreditUsageBySource;
  items: CreditUsageItem[];
  nextCursor: string | null;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const { t } = useTranslation();
  const emptyKey =
    usedCredits > 0 ? "pricing.usage.emptyPartial" : "pricing.usage.empty";
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <UsageBreakdown usedCredits={usedCredits} bySource={bySource} />
      <Text>{t("pricing.usage.recent")}</Text>
      {items.length === 0 ? (
        <Text type="secondary">{t(emptyKey)}</Text>
      ) : (
        <UsageList items={items} />
      )}
      {nextCursor ? (
        <Button onClick={onLoadMore} loading={loadingMore}>
          {t("pricing.usage.loadMore")}
        </Button>
      ) : null}
    </Space>
  );
}

type CreditUsageModalProps = {
  open: boolean;
  onClose: () => void;
};

const CreditUsageModal: React.FC<CreditUsageModalProps> = ({
  open,
  onClose,
}) => {
  const { t } = useTranslation();
  const query = useCreditUsageQuery(open);

  return (
    <AppSModal
      open={open}
      heading={t("pricing.usage.title")}
      onClose={onClose}
      size="large"
      primaryAction={{
        content: t("pricing.usage.close"),
        onAction: onClose,
      }}
    >
      {query.loading ? (
        <div className="pricing-usage-modal__loading">
          <Spin />
        </div>
      ) : query.error ? (
        <Text type="secondary">{t("pricing.usage.error")}</Text>
      ) : (
        <CreditUsageBody
          usedCredits={query.usedCredits}
          bySource={query.bySource}
          items={query.items}
          nextCursor={query.nextCursor}
          loadingMore={query.loadingMore}
          onLoadMore={() => void query.loadMore()}
        />
      )}
    </AppSModal>
  );
};

export default CreditUsageModal;
