/**
 * Read-only UserPicture counts by shop. 默认测环境；查产：--env=.env.prod
 */
import { createClient } from "@libsql/client/http";
import { loadStackedEnv, resolveTurso } from "./lib/loadEnv.mjs";

const { overlay } = loadStackedEnv();
const turso = resolveTurso();
if (!turso.url || !turso.authToken) {
  console.error("missing Turso（overlay=", overlay, ")");
  process.exit(1);
}
console.log(`[smoke] overlay=${overlay}`);
const c = createClient({
  url: turso.url,
  authToken: turso.authToken,
});

const shops = [
  "musiclily.myshopify.com",
  "www-princesspinky-com.myshopify.com",
  "e00ftb-8b.myshopify.com",
  "838c59.myshopify.com",
  "ciwishop.myshopify.com",
  "p66fh3-cz.myshopify.com",
  "888ab7.myshopify.com",
];

const out = [];
for (const shop of shops) {
  const row = await c.execute({
    sql: `SELECT COUNT(*) AS total,
                 SUM(CASE WHEN isDelete = 0 THEN 1 ELSE 0 END) AS active,
                 SUM(CASE WHEN isDelete = 0 AND imageAfterUrl IS NOT NULL AND length(imageAfterUrl) > 0 THEN 1 ELSE 0 END) AS withAfter
          FROM UserPicture WHERE shop = ?`,
    args: [shop],
  });
  out.push({ shop, ...row.rows[0] });
}

console.log(JSON.stringify(out, null, 2));
