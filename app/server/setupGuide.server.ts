/**
 * 首页 Setup Guide 快照：引导资格、永久关闭、术语表与 v4 任务。
 * 失败降级为不渲染，不阻塞首页。
 */
import prisma from "~/db.server";

export type SetupGuideSnapshot = {
  eligible: boolean;
  dismissedAt: string | null;
  hasGlossary: boolean;
  hasV4Job: boolean;
};

const EMPTY_SNAPSHOT: SetupGuideSnapshot = {
  eligible: false,
  dismissedAt: null,
  hasGlossary: false,
  hasV4Job: false,
};

/** 首次安装 Account 尚未落库 / 打标竞态窗口。 */
const NEW_ACCOUNT_ELIGIBLE_MS = 15 * 60 * 1000;

function isSetupGuideEligibleRow(row: {
  status: string;
  firstEnteredAt: Date | null;
}): boolean {
  return (
    row.status !== "skipped" &&
    row.status !== "completed" &&
    row.firstEnteredAt == null
  );
}

/** 终身首次建 Account 时打标；已有行不覆盖。 */
export async function markSetupGuideEligible(shop: string): Promise<void> {
  try {
    const existing = await prisma.shopOnboarding.findUnique({
      where: { shop },
      select: { shop: true },
    });
    if (existing) return;
    await prisma.shopOnboarding.create({
      data: { shop, status: "not_started" },
    });
  } catch (err) {
    console.error("[setup-guide] mark eligible failed:", err);
  }
}

export async function persistSetupGuideDismissed(shop: string): Promise<void> {
  try {
    const existing = await prisma.shopOnboarding.findUnique({
      where: { shop },
      select: { setupGuideDismissedAt: true },
    });
    if (existing?.setupGuideDismissedAt) return;
    const now = new Date();
    if (existing) {
      await prisma.shopOnboarding.update({
        where: { shop },
        data: { setupGuideDismissedAt: now },
      });
      return;
    }
    await prisma.shopOnboarding.create({
      data: { shop, status: "not_started", setupGuideDismissedAt: now },
    });
  } catch (err) {
    console.error("[setup-guide] persist dismissed failed:", err);
  }
}

export async function loadSetupGuideSnapshot(
  shop: string,
): Promise<SetupGuideSnapshot> {
  try {
    const [glossaryCount, usageCount, onboarding, account] = await Promise.all([
      prisma.glossary.count({ where: { shop } }),
      prisma.translateV4JobUsage.count({ where: { shop } }),
      prisma.shopOnboarding.findUnique({
        where: { shop },
        select: {
          status: true,
          firstEnteredAt: true,
          setupGuideDismissedAt: true,
        },
      }),
      prisma.account.findUnique({
        where: { shop },
        select: { createdAt: true },
      }),
    ]);

    let row = onboarding;
    if (!row && !account) {
      return {
        eligible: true,
        dismissedAt: null,
        hasGlossary: glossaryCount > 0,
        hasV4Job: usageCount > 0,
      };
    }
    if (
      !row &&
      account &&
      Date.now() - account.createdAt.getTime() < NEW_ACCOUNT_ELIGIBLE_MS
    ) {
      await markSetupGuideEligible(shop);
      row = { status: "not_started", firstEnteredAt: null, setupGuideDismissedAt: null };
    }

    const eligible = Boolean(row && isSetupGuideEligibleRow(row));

    return {
      eligible,
      dismissedAt: row?.setupGuideDismissedAt?.toISOString() ?? null,
      hasGlossary: glossaryCount > 0,
      hasV4Job: usageCount > 0,
    };
  } catch (err) {
    console.error("[setup-guide] load snapshot failed:", err);
    return EMPTY_SNAPSHOT;
  }
}
