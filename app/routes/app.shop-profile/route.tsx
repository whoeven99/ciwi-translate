import { json, redirect, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useRevalidator } from "@remix-run/react";
import { Page } from "@shopify/polaris";
import AppPageHeader from "~/ui/components/AppPageHeader";
import AppSubpageTitleBar, {
  useAppHomeBackAction,
} from "~/ui/components/AppSubpageTitleBar";
import {
  Card,
  Col,
  Descriptions,
  Divider,
  Empty,
  Flex,
  Progress,
  Row,
  Statistic,
  Table,
  Tag,
  Typography,
} from "antd";
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  SyncOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  ThunderboltOutlined,
  ReloadOutlined,
  BookOutlined,
  DashboardOutlined,
  GlobalOutlined,
  DatabaseOutlined,
  RobotOutlined,
  AimOutlined,
  ShopOutlined,
  BarChartOutlined,
} from "@ant-design/icons";
import { useEffect, useMemo } from "react";
import Button from "~/ui/components/AppButton";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";
import {
  getLatestShopScanJob,
  type ShopScanJob,
  type ShopScanStageState,
  type ShopScanStatus,
} from "~/server/shopScan/cosmos.server";
import { enqueueShopScan } from "~/server/shopScan/trigger.server";
import { isProductionNodeEnv } from "~/config/nodeEnv.server";
import { buildShopProfilePromptBlock } from "~/server/translateV4/shopProfilePrompt.server";
import {
  loadShopScanArtifacts,
  type GlossarySuggestionView,
  type ShopMarketView,
  type ShopSignalsView,
  type ShopUnderstandingView,
  type TerminologyStrategyView,
} from "~/server/shopScan/artifacts.server";

const { Text, Paragraph } = Typography;

type ProfileView = {
  shopName: string | null;
  primaryLocale: string | null;
  industry: string | null;
  keywords: string[];
  description: string | null;
  brandTone: string | null;
  aiModel: string | null;
  lastScannedAt: string | null;
};

type ScanView = Pick<
  ShopScanJob,
  "id" | "trigger" | "status" | "stages" | "summary" | "createdAt" | "updatedAt"
>;

type LoaderData = {
  configured: boolean;
  profile: ProfileView | null;
  scan: ScanView | null;
  promptBlock: string | null;
  strategy: TerminologyStrategyView | null;
  glossarySuggestions: GlossarySuggestionView[];
  understanding: ShopUnderstandingView | null;
  markets: ShopMarketView[];
  signals: ShopSignalsView | null;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (isProductionNodeEnv()) {
    throw redirect("/app/translate-v4");
  }
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const configured = Boolean(
    process.env.COSMOS_ENDPOINT_V4?.trim() && process.env.COSMOS_KEY_V4?.trim(),
  );

  let profile: ProfileView | null = null;
  let scan: ScanView | null = null;
  let strategy: TerminologyStrategyView | null = null;
  let glossarySuggestions: GlossarySuggestionView[] = [];
  let understanding: ShopUnderstandingView | null = null;
  let markets: ShopMarketView[] = [];
  let signals: ShopSignalsView | null = null;

  try {
    const row = await prisma.shopProfile.findUnique({ where: { shop } });
    if (row) {
      profile = {
        shopName: row.shopName,
        primaryLocale: row.primaryLocale,
        industry: row.industry,
        keywords: Array.isArray(row.keywords) ? (row.keywords as string[]) : [],
        description: row.description,
        brandTone: row.brandTone,
        aiModel: row.aiModel,
        lastScannedAt: row.lastScannedAt ? row.lastScannedAt.toISOString() : null,
      };
    }
  } catch (err) {
    console.error("[shop-profile page] read ShopProfile failed:", err);
  }

  if (configured) {
    try {
      const latest = await getLatestShopScanJob(shop);
      if (latest) {
        scan = {
          id: latest.id,
          trigger: latest.trigger,
          status: latest.status,
          stages: latest.stages,
          summary: latest.summary,
          createdAt: latest.createdAt,
          updatedAt: latest.updatedAt,
        };
        const artifacts = await loadShopScanArtifacts(latest.blobPrefix, latest.summary);
        strategy = artifacts.strategy;
        glossarySuggestions = artifacts.glossarySuggestions;
        understanding = artifacts.understanding;
        markets = artifacts.markets;
        signals = artifacts.signals;
      }
    } catch (err) {
      console.error("[shop-profile page] read latest scan failed:", err);
    }
  }

  const promptBlock = buildShopProfilePromptBlock(profile);

  return json<LoaderData>({
    configured,
    profile,
    scan,
    promptBlock,
    strategy,
    glossarySuggestions,
    understanding,
    markets,
    signals,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (isProductionNodeEnv()) {
    throw redirect("/app/translate-v4");
  }
  const { session } = await authenticate.admin(request);
  const result = await enqueueShopScan({ shop: session.shop, trigger: "manual" });
  return json(result);
};

const STATUS_LABEL: Record<ShopScanStatus, string> = {
  CREATED: "已创建",
  QUEUED: "排队中",
  SCANNING: "扫描中",
  COMPLETED: "已完成",
  PARTIAL: "部分完成",
  FAILED: "失败",
};

const STAGE_LABEL: Record<string, string> = {
  contentSize: "内容规模",
  profile: "店铺画像",
  coverage: "语言覆盖率",
  glossary: "AI 术语建议",
};

const STAGE_STATE_LABEL: Record<ShopScanStageState, string> = {
  PENDING: "待处理",
  DONE: "完成",
  SKIPPED: "跳过",
  FAILED: "失败",
};

const STATUS_ICON: Record<ShopScanStatus, React.ReactNode> = {
  CREATED: <ClockCircleOutlined />,
  QUEUED: <SyncOutlined spin />,
  SCANNING: <SyncOutlined spin />,
  COMPLETED: <CheckCircleOutlined />,
  PARTIAL: <ExclamationCircleOutlined />,
  FAILED: <CloseCircleOutlined />,
};

const STATUS_TONE: Record<ShopScanStatus, string> = {
  CREATED: "var(--app-color-text-secondary)",
  QUEUED: "var(--app-accent-primary)",
  SCANNING: "var(--app-accent-primary)",
  COMPLETED: "var(--app-accent-growth)",
  PARTIAL: "var(--app-accent-utility)",
  FAILED: "var(--app-accent-critical)",
};

const STAGE_TONE: Record<ShopScanStageState, string> = {
  PENDING: "rgba(0,0,0,0.45)",
  DONE: "var(--app-accent-growth)",
  SKIPPED: "rgba(0,0,0,0.45)",
  FAILED: "var(--app-accent-critical)",
};

const ACTIVE_STATUSES: ShopScanStatus[] = ["CREATED", "QUEUED", "SCANNING"];

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString();
}

function formatNumber(n: number | undefined | null): string {
  if (typeof n !== "number") return "-";
  return n.toLocaleString();
}

export default function ShopProfilePage() {
  const {
    configured,
    profile,
    scan,
    promptBlock,
    strategy,
    glossarySuggestions,
    understanding,
    markets,
    signals,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ enqueued: boolean; reason?: string }>();
  const revalidator = useRevalidator();
  const homeBackAction = useAppHomeBackAction();

  const isActive = scan ? ACTIVE_STATUSES.includes(scan.status) : false;
  const isRescanning = fetcher.state !== "idle";

  // 扫描进行中时自动轮询刷新
  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 5000);
    return () => clearInterval(timer);
  }, [isActive, revalidator]);

  const moduleRows = useMemo(() => {
    const stats = scan?.summary?.moduleStats ?? {};
    return Object.entries(stats)
      .map(([module, v]) => ({ key: module, module, items: v.items, chars: v.chars }))
      .filter((r) => r.items > 0)
      .sort((a, b) => b.items - a.items);
  }, [scan]);

  const coverageRows = useMemo(() => {
    return (scan?.summary?.coverage ?? []).map((c) => ({ key: c.locale, ...c }));
  }, [scan]);

  const glossaryRows = useMemo(() => {
    return glossarySuggestions.map((g, i) => ({
      key: `${g.locale}-${g.source}-${i}`,
      ...g,
    }));
  }, [glossarySuggestions]);

  const moduleHintRows = useMemo(() => {
    return (strategy?.moduleHints ?? []).map((h) => ({
      key: h.module,
      ...h,
    }));
  }, [strategy]);

  const marketRows = useMemo(() => {
    return markets.map((m, i) => ({
      key: m.handle || `${m.name}-${i}`,
      ...m,
    }));
  }, [markets]);

  const termRows = useMemo(() => {
    return (signals?.weightedTopTerms ?? []).map((t, i) => ({
      key: `term-${t.term}-${i}`,
      ...t,
    }));
  }, [signals]);

  const phraseRows = useMemo(() => {
    return (signals?.weightedTopPhrases ?? []).map((t, i) => ({
      key: `phrase-${t.term}-${i}`,
      ...t,
    }));
  }, [signals]);

  const sampleRows = useMemo(() => {
    return (signals?.representativeSamples ?? []).map((s, i) => ({
      key: `sample-${s.source}-${i}`,
      ...s,
    }));
  }, [signals]);

  const sourceStatRows = useMemo(() => {
    return Object.entries(signals?.sourceStats ?? {})
      .map(([source, count]) => ({ key: source, source, count }))
      .sort((a, b) => b.count - a.count);
  }, [signals]);

  const handleRescan = () => {
    fetcher.submit({}, { method: "POST" });
  };

  return (
    <Page>
      <AppSubpageTitleBar title="店铺画像 (Shop Profile)" />
      <Flex vertical gap={20}>
        <AppPageHeader
          title={
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <DashboardOutlined
                style={{ fontSize: 22, color: "var(--app-accent-primary)" }}
              />
              店铺画像扫描结果
              {scan ? (
                <Tag
                  style={{
                    margin: 0,
                    color: STATUS_TONE[scan.status],
                    borderColor: STATUS_TONE[scan.status],
                    background: "transparent",
                  }}
                >
                  {STATUS_LABEL[scan.status]}
                </Tag>
              ) : null}
            </span>
          }
          backAction={homeBackAction}
          extra={
            <Button
              type="primary"
              icon={<ReloadOutlined />}
              loading={isRescanning}
              disabled={!configured || isActive}
              onClick={handleRescan}
            >
              {isActive ? "扫描进行中…" : "重新扫描"}
            </Button>
          }
        />

        {!configured ? (
          <Card style={{ boxShadow: "var(--app-shadow-card)" }}>
            <Empty
              image={<ExclamationCircleOutlined style={{ fontSize: 48, color: "var(--app-accent-utility)" }} />}
              description="店铺画像扫描未配置（缺少 Cosmos 环境变量）"
            />
          </Card>
        ) : !scan && !profile ? (
          <Card style={{ boxShadow: "var(--app-shadow-card)" }}>
            <Empty
              image={<ThunderboltOutlined style={{ fontSize: 48, color: "var(--app-accent-primary)" }} />}
              description="尚未扫描。安装后会自动触发一次扫描，或点击下方按钮开始。"
            >
              <Button
                type="primary"
                icon={<ThunderboltOutlined />}
                loading={isRescanning}
                onClick={handleRescan}
              >
                立即扫描
              </Button>
            </Empty>
          </Card>
        ) : (
          <>
            {/* 扫描状态 */}
            <Card
              title={
                <Flex align="center" gap={8}>
                  {scan && (
                    <span style={{ color: STATUS_TONE[scan.status] }}>
                      {STATUS_ICON[scan.status]}
                    </span>
                  )}
                  <span>扫描状态</span>
                </Flex>
              }
              style={{ boxShadow: "var(--app-shadow-card)" }}
            >
              <Flex vertical gap={16}>
                {/* 更新时间 */}
                <Flex vertical gap={2}>
                  <Text type="secondary" style={{ fontSize: 12 }}>更新时间</Text>
                  <Text>{formatDate(scan?.updatedAt)}</Text>
                </Flex>

                <Divider style={{ margin: "4px 0" }} />

                {/* 阶段进度 */}
                <Flex vertical gap={8}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    扫描阶段
                  </Text>
                  <Row gutter={[12, 12]}>
                    {(Object.keys(STAGE_LABEL) as Array<keyof typeof STAGE_LABEL>).map(
                      (stage, idx, arr) => {
                        const st = scan
                          ? (scan.stages as Record<string, ShopScanStageState>)[stage]
                          : undefined;
                        const isDone = st === "DONE";
                        const isLast = idx === arr.length - 1;
                        return (
                          <Col xs={12} sm={6} key={stage}>
                            <Flex align="center" gap={8}>
                              {/* 步骤序号圆圈 */}
                              <Flex
                                align="center"
                                justify="center"
                                style={{
                                  width: 28,
                                  height: 28,
                                  borderRadius: "50%",
                                  background: isDone
                                    ? "var(--app-accent-growth)"
                                    : st === "FAILED"
                                      ? "var(--app-accent-critical)"
                                      : "rgba(0,0,0,0.06)",
                                  color: isDone || st === "FAILED"
                                    ? "#fff"
                                    : "rgba(0,0,0,0.45)",
                                  fontSize: 12,
                                  fontWeight: 600,
                                  flexShrink: 0,
                                  border: isDone || st === "FAILED"
                                    ? "none"
                                    : "2px solid rgba(0,0,0,0.10)",
                                }}
                              >
                                {isDone ? (
                                  <CheckCircleOutlined />
                                ) : st === "FAILED" ? (
                                  <CloseCircleOutlined />
                                ) : (
                                  idx + 1
                                )}
                              </Flex>
                              <Flex vertical gap={0} style={{ flex: 1 }}>
                                <Text
                                  strong
                                  style={{
                                    fontSize: 13,
                                    color: isDone
                                      ? "var(--app-color-text)"
                                      : "var(--app-color-text-secondary)",
                                  }}
                                >
                                  {STAGE_LABEL[stage]}
                                </Text>
                                <Text
                                  style={{
                                    fontSize: 11,
                                    color: st
                                      ? STAGE_TONE[st]
                                      : "var(--app-color-text-tertiary)",
                                  }}
                                >
                                  {st ? STAGE_STATE_LABEL[st] : "-"}
                                </Text>
                              </Flex>
                              {/* 连接线 */}
                              {!isLast && (
                                <div
                                  style={{
                                    display: "none",
                                    // shown on sm+
                                  }}
                                />
                              )}
                            </Flex>
                          </Col>
                        );
                      },
                    )}
                  </Row>
                </Flex>
              </Flex>
            </Card>

            {/* 店铺画像：独占一行 */}
            <Card
              title={
                <Flex align="center" gap={8}>
                  <DatabaseOutlined style={{ color: "var(--app-accent-primary)" }} />
                  <span>店铺画像</span>
                </Flex>
              }
              style={{ boxShadow: "var(--app-shadow-card)" }}
            >
              {profile ? (
                <Descriptions column={{ xs: 1, sm: 2, lg: 3 }} size="small" bordered>
                  <Descriptions.Item label="店铺名称">
                    {profile.shopName || "-"}
                  </Descriptions.Item>
                  <Descriptions.Item label="默认语言">
                    <Tag>{profile.primaryLocale || "-"}</Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="行业/品类">
                    <Tag color="blue">{profile.industry || "-"}</Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="品牌语气">
                    {profile.brandTone || "-"}
                  </Descriptions.Item>
                  <Descriptions.Item label="AI 模型" span={2}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {profile.aiModel || "-"}
                    </Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="关键词" span={3}>
                    {profile.keywords.length ? (
                      <Flex gap={4} wrap="wrap">
                        {profile.keywords.map((k) => (
                          <Tag key={k} color="purple">{k}</Tag>
                        ))}
                      </Flex>
                    ) : (
                      "-"
                    )}
                  </Descriptions.Item>
                  <Descriptions.Item label="店铺描述" span={3}>
                    <Paragraph
                      style={{ margin: 0 }}
                      ellipsis={{ rows: 2, expandable: true }}
                    >
                      {profile.description || "-"}
                    </Paragraph>
                  </Descriptions.Item>
                </Descriptions>
              ) : (
                <Empty description="画像尚未生成（可能素材不足或 AI 未配置）" />
              )}
            </Card>

            {/* AI 第一步完整理解（Blob；Turso 只落了 industry/keywords/description/brandTone） */}
            <Card
              title={
                <Flex align="center" gap={8}>
                  <RobotOutlined style={{ color: "var(--app-accent-utility)" }} />
                  <span>店铺理解详情（AI 第一步）</span>
                </Flex>
              }
              style={{ boxShadow: "var(--app-shadow-card)" }}
            >
              {understanding ? (
                <Flex vertical gap={16}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    完整理解结果存于扫描 Blob；上方「店铺画像」仅展示已写入数据库、可注入翻译的字段。
                  </Text>
                  <Descriptions column={{ xs: 1, sm: 2, lg: 3 }} size="small" bordered>
                    <Descriptions.Item label="行业">
                      {understanding.industry || "-"}
                    </Descriptions.Item>
                    <Descriptions.Item label="子品类">
                      {understanding.subIndustry || "-"}
                    </Descriptions.Item>
                    <Descriptions.Item label="价格区间">
                      {understanding.priceRange || "-"}
                    </Descriptions.Item>
                    <Descriptions.Item label="品牌定位" span={3}>
                      {understanding.brandPositioning || "-"}
                    </Descriptions.Item>
                    <Descriptions.Item label="品牌语气">
                      {understanding.voiceStyle || "-"}
                    </Descriptions.Item>
                    <Descriptions.Item label="SEO 导向" span={2}>
                      {understanding.seoDirection || "-"}
                    </Descriptions.Item>
                    <Descriptions.Item label="核心商品类型" span={3}>
                      {understanding.coreProductTypes.length ? (
                        <Flex gap={4} wrap="wrap">
                          {understanding.coreProductTypes.map((t) => (
                            <Tag key={t} color="blue">
                              {t}
                            </Tag>
                          ))}
                        </Flex>
                      ) : (
                        "-"
                      )}
                    </Descriptions.Item>
                    <Descriptions.Item label="卖点" span={3}>
                      {understanding.sellingPoints.length ? (
                        <Flex vertical gap={4}>
                          {understanding.sellingPoints.map((p) => (
                            <Text key={p}>· {p}</Text>
                          ))}
                        </Flex>
                      ) : (
                        "-"
                      )}
                    </Descriptions.Item>
                    <Descriptions.Item label="市场本地化关注点" span={3}>
                      {understanding.marketNotes.length ? (
                        <Flex vertical gap={4}>
                          {understanding.marketNotes.map((n) => (
                            <Text key={n}>· {n}</Text>
                          ))}
                        </Flex>
                      ) : (
                        "-"
                      )}
                    </Descriptions.Item>
                  </Descriptions>
                </Flex>
              ) : (
                <Empty description="暂无完整理解详情（需完成扫描且 Blob 可读）" />
              )}
            </Card>

            {/* Markets：扫描时采集，尚未持久化到独立表 */}
            <Card
              title={
                <Flex align="center" gap={8}>
                  <ShopOutlined style={{ color: "var(--app-accent-primary)" }} />
                  <span>市场配置（Markets）</span>
                </Flex>
              }
              style={{ boxShadow: "var(--app-shadow-card)" }}
            >
              {marketRows.length > 0 ? (
                <Flex vertical gap={12}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    来自 Shopify Markets，用于本地化策略输入；当前仅保存在扫描结果中。
                  </Text>
                  <Table
                    size="small"
                    pagination={false}
                    dataSource={marketRows}
                    columns={[
                      { title: "市场", dataIndex: "name", key: "name", ellipsis: true },
                      {
                        title: "Handle",
                        dataIndex: "handle",
                        key: "handle",
                        width: 120,
                        ellipsis: true,
                        render: (v: string) => v || "-",
                      },
                      {
                        title: "货币",
                        dataIndex: "baseCurrency",
                        key: "baseCurrency",
                        width: 90,
                        render: (v: string | null) =>
                          v ? <Tag>{v}</Tag> : <Text type="secondary">-</Text>,
                      },
                      {
                        title: "语言",
                        dataIndex: "locales",
                        key: "locales",
                        render: (locales: string[]) =>
                          locales.length ? (
                            <Flex gap={4} wrap="wrap">
                              {locales.map((l) => (
                                <Tag key={l}>{l}</Tag>
                              ))}
                            </Flex>
                          ) : (
                            "-"
                          ),
                      },
                      {
                        title: "状态",
                        dataIndex: "status",
                        key: "status",
                        width: 90,
                        render: (v: string) => v || "-",
                      },
                    ]}
                  />
                </Flex>
              ) : (
                <Empty description="暂无市场数据（需完成画像扫描且 Blob 可读）" />
              )}
            </Card>

            {/* 信号提取层中间结果 */}
            <Card
              title={
                <Flex align="center" gap={8}>
                  <BarChartOutlined style={{ color: "var(--app-accent-utility)" }} />
                  <span>内容信号（加权词频 / 抽样）</span>
                </Flex>
              }
              style={{ boxShadow: "var(--app-shadow-card)" }}
            >
              {signals ? (
                <Flex vertical gap={16}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    工程侧提纯结果，供 AI 归纳使用；来源含 menu / collection / theme / product 等。
                  </Text>

                  {(signals.brandTerms.length > 0 ||
                    signals.categoryTerms.length > 0 ||
                    signals.menuTerms.length > 0) && (
                    <Row gutter={[16, 12]}>
                      {signals.brandTerms.length > 0 && (
                        <Col xs={24} md={8}>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            品牌/供应商
                          </Text>
                          <Flex gap={4} wrap="wrap" style={{ marginTop: 6 }}>
                            {signals.brandTerms.map((t) => (
                              <Tag key={t}>{t}</Tag>
                            ))}
                          </Flex>
                        </Col>
                      )}
                      {signals.categoryTerms.length > 0 && (
                        <Col xs={24} md={8}>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            品类词
                          </Text>
                          <Flex gap={4} wrap="wrap" style={{ marginTop: 6 }}>
                            {signals.categoryTerms.map((t) => (
                              <Tag key={t} color="blue">
                                {t}
                              </Tag>
                            ))}
                          </Flex>
                        </Col>
                      )}
                      {signals.menuTerms.length > 0 && (
                        <Col xs={24} md={8}>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            导航词
                          </Text>
                          <Flex gap={4} wrap="wrap" style={{ marginTop: 6 }}>
                            {signals.menuTerms.map((t) => (
                              <Tag key={t} color="green">
                                {t}
                              </Tag>
                            ))}
                          </Flex>
                        </Col>
                      )}
                    </Row>
                  )}

                  <Row gutter={[16, 16]}>
                    <Col xs={24} lg={12}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        高权重关键词
                      </Text>
                      <Table
                        size="small"
                        pagination={{ pageSize: 8, hideOnSinglePage: true }}
                        style={{ marginTop: 8 }}
                        dataSource={termRows}
                        columns={[
                          { title: "词", dataIndex: "term", key: "term", ellipsis: true },
                          {
                            title: "得分",
                            dataIndex: "score",
                            key: "score",
                            width: 72,
                            align: "right",
                            render: (v: number) => (Number.isFinite(v) ? v.toFixed(1) : "-"),
                          },
                          {
                            title: "次数",
                            dataIndex: "count",
                            key: "count",
                            width: 64,
                            align: "right",
                          },
                          {
                            title: "来源",
                            dataIndex: "sources",
                            key: "sources",
                            ellipsis: true,
                            render: (sources: string[]) => sources.join(", ") || "-",
                          },
                        ]}
                        locale={{ emptyText: "暂无" }}
                      />
                    </Col>
                    <Col xs={24} lg={12}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        高权重短语
                      </Text>
                      <Table
                        size="small"
                        pagination={{ pageSize: 8, hideOnSinglePage: true }}
                        style={{ marginTop: 8 }}
                        dataSource={phraseRows}
                        columns={[
                          { title: "短语", dataIndex: "term", key: "term", ellipsis: true },
                          {
                            title: "得分",
                            dataIndex: "score",
                            key: "score",
                            width: 72,
                            align: "right",
                            render: (v: number) => (Number.isFinite(v) ? v.toFixed(1) : "-"),
                          },
                          {
                            title: "次数",
                            dataIndex: "count",
                            key: "count",
                            width: 64,
                            align: "right",
                          },
                        ]}
                        locale={{ emptyText: "暂无" }}
                      />
                    </Col>
                  </Row>

                  {sourceStatRows.length > 0 && (
                    <div>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        来源样本数
                      </Text>
                      <Flex gap={4} wrap="wrap" style={{ marginTop: 6 }}>
                        {sourceStatRows.map((r) => (
                          <Tag key={r.source}>
                            {r.source}: {r.count}
                          </Tag>
                        ))}
                      </Flex>
                    </div>
                  )}

                  {sampleRows.length > 0 && (
                    <div>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        代表文案样本
                      </Text>
                      <Table
                        size="small"
                        pagination={{ pageSize: 8, hideOnSinglePage: true }}
                        style={{ marginTop: 8 }}
                        dataSource={sampleRows}
                        columns={[
                          {
                            title: "来源",
                            dataIndex: "source",
                            key: "source",
                            width: 140,
                            ellipsis: true,
                          },
                          { title: "文本", dataIndex: "text", key: "text", ellipsis: true },
                        ]}
                      />
                    </div>
                  )}
                </Flex>
              ) : (
                <Empty description="暂无信号数据（需完成画像扫描且 Blob 可读）" />
              )}
            </Card>

            {/* 翻译提示词预览：真实注入翻译 API 的 shop profile 上下文 */}
            <Card
              title={
                <Flex align="center" gap={8}>
                  <RobotOutlined style={{ color: "var(--app-accent-primary)" }} />
                  <span>翻译提示词预览</span>
                </Flex>
              }
              style={{ boxShadow: "var(--app-shadow-card)" }}
            >
              <Flex vertical gap={12}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  以下内容会作为店铺上下文注入到翻译请求的系统提示词中，用于指导译文的语气、术语与本地化。
                </Text>
                {promptBlock ? (
                  <Paragraph
                    copyable={{ text: promptBlock }}
                    style={{
                      margin: 0,
                      padding: 12,
                      background: "var(--app-color-bg-subtle, #f6f7f9)",
                      borderRadius: 8,
                      border: "1px solid rgba(0,0,0,0.06)",
                      fontFamily:
                        "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                      fontSize: 12,
                      lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {promptBlock}
                  </Paragraph>
                ) : (
                  <Empty description="暂无可注入的画像内容（需先完成一次扫描生成画像）" />
                )}
              </Flex>
            </Card>

            {/* 第二步 AI 归纳：术语策略与模块建议 */}
            <Card
              title={
                <Flex align="center" gap={8}>
                  <AimOutlined style={{ color: "var(--app-accent-utility)" }} />
                  <span>术语与翻译策略（AI 第二步）</span>
                </Flex>
              }
              style={{ boxShadow: "var(--app-shadow-card)" }}
            >
              {strategy ? (
                <Flex vertical gap={16}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    基于店铺理解结论归纳的术语控制与模块级翻译方向，仅供预览，不会自动写入术语表。
                  </Text>

                  {(strategy.brandTerms.length > 0 || strategy.doNotTranslateTerms.length > 0) && (
                    <Row gutter={[16, 12]}>
                      {strategy.brandTerms.length > 0 && (
                        <Col xs={24} md={12}>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            品牌词
                          </Text>
                          <Flex gap={4} wrap="wrap" style={{ marginTop: 6 }}>
                            {strategy.brandTerms.map((t) => (
                              <Tag key={t} color="blue">
                                {t}
                              </Tag>
                            ))}
                          </Flex>
                        </Col>
                      )}
                      {strategy.doNotTranslateTerms.length > 0 && (
                        <Col xs={24} md={12}>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            不翻译词
                          </Text>
                          <Flex gap={4} wrap="wrap" style={{ marginTop: 6 }}>
                            {strategy.doNotTranslateTerms.map((t) => (
                              <Tag key={t} color="red">
                                {t}
                              </Tag>
                            ))}
                          </Flex>
                        </Col>
                      )}
                    </Row>
                  )}

                  {strategy.seoTerms.length > 0 && (
                    <div>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        SEO 关键词
                      </Text>
                      <Flex gap={4} wrap="wrap" style={{ marginTop: 6 }}>
                        {strategy.seoTerms.map((t) => (
                          <Tag key={t} color="purple">
                            {t}
                          </Tag>
                        ))}
                      </Flex>
                    </div>
                  )}

                  {strategy.preferredTerms.length > 0 && (
                    <div>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        建议固定译法
                      </Text>
                      <Table
                        size="small"
                        pagination={false}
                        style={{ marginTop: 8 }}
                        dataSource={strategy.preferredTerms.map((t, i) => ({
                          key: `${t.source}-${i}`,
                          ...t,
                        }))}
                        columns={[
                          { title: "源词", dataIndex: "source", key: "source", ellipsis: true },
                          {
                            title: "说明",
                            dataIndex: "note",
                            key: "note",
                            ellipsis: true,
                            render: (v: string | null) => v || <Text type="secondary">-</Text>,
                          },
                        ]}
                      />
                    </div>
                  )}

                  {moduleHintRows.length > 0 && (
                    <div>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        模块级翻译建议
                      </Text>
                      <Table
                        size="small"
                        pagination={false}
                        style={{ marginTop: 8 }}
                        dataSource={moduleHintRows}
                        columns={[
                          { title: "模块", dataIndex: "module", key: "module", width: 160, ellipsis: true },
                          {
                            title: "语气",
                            dataIndex: "tonePolicy",
                            key: "tonePolicy",
                            ellipsis: true,
                            render: (v: string | null) => v || "-",
                          },
                          {
                            title: "关键词",
                            dataIndex: "keywordPolicy",
                            key: "keywordPolicy",
                            ellipsis: true,
                            render: (v: string | null) => v || "-",
                          },
                          {
                            title: "直译/意译",
                            dataIndex: "literalVsAdaptive",
                            key: "literalVsAdaptive",
                            ellipsis: true,
                            render: (v: string | null) => v || "-",
                          },
                        ]}
                      />
                    </div>
                  )}
                </Flex>
              ) : (
                <Empty description="暂无术语策略（需完成扫描且 AI 第二步成功生成）" />
              )}
            </Card>

            {/* 内容规模 + 语言覆盖率：双栏 */}
            <Row gutter={[20, 20]}>
              <Col xs={24} lg={12}>
                <Card
                  title={
                    <Flex align="center" gap={8}>
                      <ThunderboltOutlined style={{ color: "var(--app-accent-utility)" }} />
                      <span>内容规模</span>
                    </Flex>
                  }
                  style={{ boxShadow: "var(--app-shadow-card)", height: "100%" }}
                >
                  <Row gutter={16} style={{ marginBottom: 16 }}>
                    <Col span={12}>
                      <Statistic
                        title="可翻译条目"
                        value={formatNumber(scan?.summary?.totalItems)}
                        valueStyle={{ color: "var(--app-accent-primary)", fontSize: 24 }}
                      />
                    </Col>
                    <Col span={12}>
                      <Statistic
                        title="源文字符数"
                        value={formatNumber(scan?.summary?.totalChars)}
                        valueStyle={{ color: "var(--app-color-text)", fontSize: 24 }}
                      />
                    </Col>
                  </Row>
                  <Table
                    size="small"
                    pagination={false}
                    dataSource={moduleRows}
                    columns={[
                      { title: "模块", dataIndex: "module", key: "module", ellipsis: true },
                      {
                        title: "条目",
                        dataIndex: "items",
                        key: "items",
                        align: "right",
                        width: 72,
                        render: (v: number) => formatNumber(v),
                        sorter: (a, b) => a.items - b.items,
                      },
                      {
                        title: "字符",
                        dataIndex: "chars",
                        key: "chars",
                        align: "right",
                        width: 72,
                        render: (v: number) => formatNumber(v),
                        sorter: (a, b) => a.chars - b.chars,
                      },
                    ]}
                    locale={{ emptyText: "暂无数据" }}
                  />
                </Card>
              </Col>

              <Col xs={24} lg={12}>
                <Card
                  title={
                    <Flex align="center" gap={8}>
                      <GlobalOutlined style={{ color: "var(--app-accent-primary)" }} />
                      <span>已发布语言覆盖率</span>
                    </Flex>
                  }
                  style={{ boxShadow: "var(--app-shadow-card)", height: "100%" }}
                >
                  {coverageRows.length > 0 ? (
                    <Table
                      size="small"
                      pagination={false}
                      dataSource={coverageRows}
                      columns={[
                        { title: "语言", dataIndex: "locale", key: "locale", width: 80 },
                        {
                          title: "进度",
                          key: "count",
                          align: "right",
                          width: 100,
                          render: (_: unknown, r: (typeof coverageRows)[number]) =>
                            `${formatNumber(r.translated)} / ${formatNumber(r.total)}`,
                        },
                        {
                          title: "覆盖率",
                          dataIndex: "percent",
                          key: "percent",
                          render: (percent: number | null) =>
                            percent === null ? (
                              <Text type="secondary">-</Text>
                            ) : (
                              <Flex align="center" gap={8}>
                                <Progress
                                  percent={percent}
                                  size="small"
                                  status={percent >= 100 ? "success" : "active"}
                                  style={{ flex: 1, margin: 0 }}
                                  strokeColor={
                                    percent >= 100
                                      ? "var(--app-accent-growth)"
                                      : percent >= 50
                                        ? "var(--app-accent-primary)"
                                        : "var(--app-accent-utility)"
                                  }
                                />
                                <Text
                                  strong
                                  style={{
                                    fontSize: 13,
                                    minWidth: 40,
                                    textAlign: "right",
                                    color:
                                      percent >= 100
                                        ? "var(--app-accent-growth)"
                                        : "var(--app-color-text)",
                                  }}
                                >
                                  {percent}%
                                </Text>
                              </Flex>
                            ),
                        },
                      ]}
                      locale={{ emptyText: "无已发布的目标语言" }}
                    />
                  ) : (
                    <Empty description="无已发布的目标语言" />
                  )}
                </Card>
              </Col>
            </Row>

            {/* AI 术语建议（仅展示，不写术语表库） */}
            <Card
              title={
                <Flex align="center" gap={8}>
                  <BookOutlined style={{ color: "var(--app-accent-primary)" }} />
                  <span>AI 术语建议</span>
                </Flex>
              }
              style={{ boxShadow: "var(--app-shadow-card)" }}
            >
              <Flex vertical gap={12}>
                <Flex align="baseline" gap={8}>
                  <Text>本次扫描归纳术语</Text>
                  <Text
                    strong
                    style={{
                      fontSize: 20,
                      color: "var(--app-accent-primary)",
                    }}
                  >
                    {formatNumber(glossarySuggestions.length)}
                  </Text>
                  <Text>条</Text>
                </Flex>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  从已有译文样本归纳，仅保存在本页扫描结果中，不会写入正式术语表。
                </Text>
                {glossaryRows.length > 0 ? (
                  <Table
                    size="small"
                    pagination={{ pageSize: 10, hideOnSinglePage: true }}
                    dataSource={glossaryRows}
                    columns={[
                      { title: "语言", dataIndex: "locale", key: "locale", width: 80 },
                      { title: "源词", dataIndex: "source", key: "source", ellipsis: true },
                      { title: "建议译文", dataIndex: "target", key: "target", ellipsis: true },
                    ]}
                  />
                ) : (
                  <Empty description="暂无术语建议（需有已发布语言及足够译文样本）" />
                )}
              </Flex>
            </Card>
          </>
        )}
      </Flex>
    </Page>
  );
}
