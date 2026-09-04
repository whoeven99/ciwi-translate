/**
 * 首页 Setup Guide 快照：关闭标记、币种、IP 开关。
 * 任一项失败都降级，不阻塞首页。
 */
import prisma from "~/db.server";

export type SetupGuideSnapshot = {
  dismissed: boolean;
  hasCurrency: boolean;
  ipOpen: boolean;
};

const EMPTY_SNAPSHOT: SetupGuideSnapshot = {
  dismissed: false,
  hasCurrency: false,
  ipOpen: false,
};

export async function loadSetupGuideSnapshot(
  shop: string,
): Promise<SetupGuideSnapshot> {
  try {
    const [onboarding, currencyCount, switcher] = await Promise.all([
      prisma.shopOnboarding.findUnique({
        where: { shop },
        select: { setupGuideDismissedAt: true },
      }),
      prisma.currency.count({ where: { shop } }),
      prisma.switcherConfiguration.findUnique({
        where: { shop },
        select: { ipOpen: true },
      }),
    ]);

    return {
      dismissed: Boolean(onboarding?.setupGuideDismissedAt),
      hasCurrency: currencyCount > 0,
      ipOpen: Boolean(switcher?.ipOpen),
    };
  } catch (err) {
    console.error("[setup-guide] load snapshot failed:", err);
    return EMPTY_SNAPSHOT;
  }
}

export async function dismissSetupGuide(shop: string): Promise<void> {
  const now = new Date();
  await prisma.shopOnboarding.upsert({
    where: { shop },
    update: { setupGuideDismissedAt: now },
    create: { shop, setupGuideDismissedAt: now },
  });
}
