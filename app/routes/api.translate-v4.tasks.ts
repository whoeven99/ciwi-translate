import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { evaluateCreateTaskQuotaGuard } from "~/server/billing/quota/createTaskQuotaGuard.server";
import {
  createV4Job,
  existsBlockingV4Job,
} from "~/server/translateV4/cosmos.server";
import { listV4JobSummaries } from "~/server/translateV4/progress.server";
import { loadShopProfilePromptBlock } from "~/server/translateV4/shopProfileContext.server";
import { estimatePersistedJobCredits } from "~/server/translateV4/creditEstimate.server";
import {
  getTranslateV4RedisClient,
  v4HintKey,
} from "~/server/translateV4/redis.server";
import { resolveShopPrimaryLocale } from "~/server/translateV4/shopLocales.server";
import {
  TRANSLATION_V4_MODULES,
  TS_FRONTEND_TASK_SOURCE,
  V4_LIMIT_UNLIMITED,
  type TranslationV4Module,
} from "~/server/translateV4/types";
import { defaultManualV4Modules } from "~/server/translateV4/moduleCatalog";

/** GET /api/translate-v4/tasks —— 列出本店 v4 任务（手动 + 自动）。 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const shopName = url.searchParams.get("shopName")?.trim() || session.shop;

  const jobs = await listV4JobSummaries(shopName, { limit: 50 });
  return json({ ok: true, jobs });
};

/** POST /api/translate-v4/tasks —— 创建一个 TsFrontend 翻译任务，写入 Cosmos 供 worker 消费。 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const FALLBACK_SOURCE_LOCALE = "en";

  const body = (await request.json().catch(() => ({}))) as {
    source?: string;
    target?: string;
    modules?: string[];
    isCover?: boolean;
    isHandle?: boolean;
    includeLiquid?: boolean;
    aiModel?: string;
    /** 同一次创建点击共用；缺省则该 job 走旧整店邮件聚合。 */
    batchId?: string;
  };

  const batchIdRaw = typeof body.batchId === "string" ? body.batchId.trim() : "";
  const batchId =
    batchIdRaw && batchIdRaw.length <= 64 ? batchIdRaw : undefined;

  const source =
    body.source?.trim() ||
    (await resolveShopPrimaryLocale({
      shop: session.shop,
      accessToken: session.accessToken,
    })) ||
    FALLBACK_SOURCE_LOCALE;
  const target = body.target?.trim() || "";
  if (!target) return json({ ok: false, error: "v4.validation.selectTarget" }, { status: 400 });
  if (target === source)
    return json({ ok: false, error: "v4.validation.sameAsSource" }, { status: 400 });

  const includeLiquid = Boolean(body.includeLiquid);
  const allowedSet = new Set<string>(TRANSLATION_V4_MODULES);
  const modules = (body.modules ?? (includeLiquid ? [] : defaultManualV4Modules()))
    .map((m) => m.trim().toUpperCase())
    .filter((m) => allowedSet.has(m)) as TranslationV4Module[];

  if (!modules.length && !includeLiquid)
    return json({ ok: false, error: "v4.validation.selectModule" }, { status: 400 });

  const shopName = session.shop;
  const quotaGuard = await evaluateCreateTaskQuotaGuard(shopName);
  if (!quotaGuard.ok) {
    return json({ ok: false, error: quotaGuard.error }, { status: quotaGuard.status });
  }

  if (await existsBlockingV4Job(shopName, source, target)) {
    return json(
      { ok: false, error: "v4.error.blockingTaskExists" },
      { status: 409 },
    );
  }

  const jobId = crypto.randomUUID();
  const profileBlock = await loadShopProfilePromptBlock(shopName);
  const estimatedCredits = await estimatePersistedJobCredits({
    shop: shopName,
    v4Modules: modules,
    includeLiquid,
    target,
  }).catch((err) => {
    console.warn("[translateV4] estimatePersistedJobCredits failed:", err);
    return null;
  });

  const job = await createV4Job({
    id: jobId,
    shopName,
    source,
    target,
    profileBlock,
    modules,
    aiModel: body.aiModel?.trim() || "deepseek-v4-flash",
    limitPerType: V4_LIMIT_UNLIMITED,
    isCover: body.isCover ?? false,
    isHandle: body.isHandle ?? false,
    includeLiquid,
    taskSource: TS_FRONTEND_TASK_SOURCE,
    ...(batchId ? { batchId } : {}),
    status: "INIT_QUEUED",
    blobPrefix: `tasks/v4/${shopName}/${jobId}`,
    createdBy: shopName,
    estimatedCredits,
  });

  // 推 hint 让 worker 立即拾取（best-effort）；手动任务进 manual 池
  try {
    await getTranslateV4RedisClient().lpush(
      v4HintKey("init", "manual"),
      JSON.stringify({ taskId: jobId, shopName }),
    );
  } catch (err) {
    console.error("[translateV4] lpush init hint failed:", err);
  }

  console.log(
    `[translateV4] job created id=${jobId} shop=${shopName} ${source}→${target} modules=${modules.join(",")} source=${TS_FRONTEND_TASK_SOURCE} batchId=${batchId ?? ""} hasProfileBlock=${Boolean(profileBlock?.trim())}`,
  );
  return json({ ok: true, jobId: job.id });
};
