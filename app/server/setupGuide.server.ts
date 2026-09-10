/**
 * 首页 Setup Guide 快照：术语表是否已有规则，以及是否有过 v4 任务。
 * 失败降级，不阻塞首页。
 */
import prisma from "~/db.server";

export type SetupGuideSnapshot = {
  hasGlossary: boolean;
  hasV4Job: boolean;
};

const EMPTY_SNAPSHOT: SetupGuideSnapshot = {
  hasGlossary: false,
  hasV4Job: false,
};

export async function loadSetupGuideSnapshot(
  shop: string,
): Promise<SetupGuideSnapshot> {
  try {
    const [glossaryCount, usageCount] = await Promise.all([
      prisma.glossary.count({ where: { shop } }),
      prisma.translateV4JobUsage.count({ where: { shop } }),
    ]);
    return {
      hasGlossary: glossaryCount > 0,
      hasV4Job: usageCount > 0,
    };
  } catch (err) {
    console.error("[setup-guide] load snapshot failed:", err);
    return EMPTY_SNAPSHOT;
  }
}
