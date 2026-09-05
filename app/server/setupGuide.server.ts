/**
 * 首页 Setup Guide 快照：术语表是否已有规则。
 * 失败降级，不阻塞首页。
 */
import prisma from "~/db.server";

export type SetupGuideSnapshot = {
  hasGlossary: boolean;
};

const EMPTY_SNAPSHOT: SetupGuideSnapshot = {
  hasGlossary: false,
};

export async function loadSetupGuideSnapshot(
  shop: string,
): Promise<SetupGuideSnapshot> {
  try {
    const glossaryCount = await prisma.glossary.count({ where: { shop } });
    return { hasGlossary: glossaryCount > 0 };
  } catch (err) {
    console.error("[setup-guide] load snapshot failed:", err);
    return EMPTY_SNAPSHOT;
  }
}
