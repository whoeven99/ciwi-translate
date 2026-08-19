/**
 * Read-only: probe full imageAfterUrl (COS + CDN) for UserPicture.
 * 默认测环境；查产：--env=.env.prod
 */
import { createClient } from "@libsql/client/http";
import { loadStackedEnv, resolveTurso } from "./lib/loadEnv.mjs";

const COS = "https://ciwi-us-1327177217.cos.na-ashburn.myqcloud.com";
const CDN = "https://img.bogdatech.com";

async function probe(url) {
  try {
    let res = await fetch(url, { method: "HEAD", redirect: "follow" });
    if (res.status === 405 || res.status === 403) {
      res = await fetch(url, {
        method: "GET",
        headers: { Range: "bytes=0-16" },
        redirect: "follow",
      });
    }
    return {
      status: res.status,
      contentType: res.headers.get("content-type"),
      contentLength: res.headers.get("content-length"),
    };
  } catch (err) {
    return { status: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

const { env, overlay } = loadStackedEnv();
const turso = resolveTurso(env);
if (!turso.url || !turso.authToken) {
  console.error("missing Turso creds（overlay=", overlay, ")");
  process.exit(1);
}
console.log(`[smoke] overlay=${overlay}`);
const client = createClient({
  url: turso.url,
  authToken: turso.authToken,
});

const shopsWithAfter = await client.execute(`
  SELECT shop, COUNT(*) AS c
  FROM UserPicture
  WHERE isDelete = 0 AND imageAfterUrl IS NOT NULL AND length(imageAfterUrl) > 0
  GROUP BY shop
  ORDER BY c DESC
  LIMIT 15
`);

const samples = await client.execute(`
  SELECT shop, languageCode, imageId, imageBeforeUrl, imageAfterUrl
  FROM UserPicture
  WHERE isDelete = 0 AND imageAfterUrl IS NOT NULL AND length(imageAfterUrl) > 0
  ORDER BY id DESC
  LIMIT 8
`);

const probed = [];
for (const row of samples.rows) {
  const cosUrl = String(row.imageAfterUrl);
  const cdnUrl = cosUrl.replace(COS, CDN);
  const [cos, cdn] = await Promise.all([probe(cosUrl), probe(cdnUrl)]);
  probed.push({
    shop: row.shop,
    languageCode: row.languageCode,
    imageId: row.imageId,
    beforeFilesKey: String(row.imageBeforeUrl).split("/files/")[2] || null,
    cosStatus: cos.status,
    cdnStatus: cdn.status,
    cosContentType: cos.contentType,
    cdnContentType: cdn.contentType,
  });
}

// 模拟 Admin 读：按 shop+product+lang 拉未删行
const demo = samples.rows[0];
let adminLike = null;
if (demo) {
  const rows = await client.execute({
    sql: `SELECT imageBeforeUrl, imageAfterUrl, languageCode
          FROM UserPicture
          WHERE shop = ? AND imageId = ? AND languageCode = ? AND isDelete = 0`,
    args: [demo.shop, demo.imageId, demo.languageCode],
  });
  adminLike = {
    shop: demo.shop,
    imageId: demo.imageId,
    languageCode: demo.languageCode,
    count: rows.rows.length,
    withAfter: rows.rows.filter((r) => r.imageAfterUrl).length,
  };
}

console.log(
  JSON.stringify(
    {
      shopsWithTranslatedImages: shopsWithAfter.rows.map((r) => ({
        shop: r.shop,
        c: Number(r.c),
      })),
      adminLikeQuery: adminLike,
      urlProbes: probed,
    },
    null,
    2,
  ),
);
