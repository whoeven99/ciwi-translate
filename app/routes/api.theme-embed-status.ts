import { json } from "@remix-run/node";
import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";

type ThemeEmbedStatus = "enabled" | "disabled" | "missing" | "unknown";

/**
 * 检测当前店铺主主题中是否启用了 Ciwi Switcher theme app embed。
 * 复用 `/app/switcher` 页的检测思路：读取主主题 `config/settings_data.json`，
 * 在 `current.blocks` 中查找 type === SHOPIFY_CIWI_SWITCHER_THEME_ID 的 block，
 * 依据是否存在及其 `disabled` 字段判断状态。
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const blockType = process.env.SHOPIFY_CIWI_SWITCHER_THEME_ID;

  if (!blockType) {
    return json({ ok: false, status: "unknown" as ThemeEmbedStatus });
  }

  try {
    const response = await admin.graphql(
      `#graphql
        query {
          themes(roles: MAIN, first: 1) {
            nodes {
              files(filenames: "config/settings_data.json") {
                nodes {
                  body {
                    ... on OnlineStoreThemeFileBodyText {
                      __typename
                      content
                    }
                  }
                }
              }
            }
          }
        }`,
    );
    const data = await response.json();
    const content =
      data?.data?.themes?.nodes?.[0]?.files?.nodes?.[0]?.body?.content;

    if (!content) {
      return json({ ok: true, status: "missing" as ThemeEmbedStatus });
    }

    const jsonString = content.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    const parsed = JSON.parse(jsonString);
    const blocks = parsed?.current?.blocks;

    if (!blocks) {
      return json({ ok: true, status: "missing" as ThemeEmbedStatus });
    }

    const block = Object.values(blocks).find(
      (candidate: any) => candidate?.type === blockType,
    );

    if (!block) {
      return json({ ok: true, status: "missing" as ThemeEmbedStatus });
    }

    return json({
      ok: true,
      status: (block.disabled ? "disabled" : "enabled") as ThemeEmbedStatus,
    });
  } catch (error) {
    console.error("[theme-embed-status] failed:", error);
    return json({ ok: false, status: "unknown" as ThemeEmbedStatus });
  }
};
