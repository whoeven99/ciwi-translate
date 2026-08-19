/**
 * Read-only juicer / UserPicture probe. 默认测环境；查产：--env=.env.prod
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

const byFilename = await c.execute({
  sql: `SELECT shop, languageCode, isDelete,
               CASE WHEN imageAfterUrl IS NOT NULL AND length(imageAfterUrl) > 0 THEN 1 ELSE 0 END AS hasAfter,
               substr(imageBeforeUrl, 1, 140) AS beforeP
        FROM UserPicture
        WHERE imageBeforeUrl LIKE ?
        LIMIT 30`,
  args: ["%1615028849319%"],
});

const bigShops = await c.execute(`
  SELECT shop,
         COUNT(*) AS total,
         SUM(CASE WHEN imageAfterUrl IS NOT NULL AND length(imageAfterUrl) > 0 THEN 1 ELSE 0 END) AS withAfter
  FROM UserPicture
  WHERE isDelete = 0
    AND shop IN (
      '888ab7.myshopify.com',
      'p66fh3-cz.myshopify.com',
      'b97e0a-c2.myshopify.com',
      'kingart-us.myshopify.com',
      'j94z2z-dw.myshopify.com'
    )
  GROUP BY shop
`);

console.log(
  JSON.stringify(
    {
      byFilename: byFilename.rows,
      bigShops: bigShops.rows,
    },
    null,
    2,
  ),
);
