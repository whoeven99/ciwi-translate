/**
 * Read-only Turso UserPicture smoke check.
 * 默认测环境；查产：--env=.env.prod
 * Usage: node scripts/smoke-user-picture-read.mjs [--env=.env.test]
 */
import { createClient } from "@libsql/client/http";
import { loadStackedEnv, resolveTurso } from "./lib/loadEnv.mjs";

const { env, overlay } = loadStackedEnv();
const turso = resolveTurso(env);
const url = turso.url;
const authToken = turso.authToken;

if (!url || !authToken) {
  console.error("missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN（overlay=", overlay, ")");
  process.exit(1);
}

console.log(`[smoke] overlay=${overlay} turso=${new URL(url).host}`);
const client = createClient({ url, authToken });

const table = await client.execute(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='UserPicture'",
);
if (!table.rows.length) {
  console.log(JSON.stringify({ ok: false, error: "UserPicture table missing" }, null, 2));
  process.exit(1);
}

const [total, active, withAfter, cosRows, cdnRows, byLang, byShop, sample] =
  await Promise.all([
    client.execute("SELECT COUNT(*) AS c FROM UserPicture"),
    client.execute("SELECT COUNT(*) AS c FROM UserPicture WHERE isDelete = 0"),
    client.execute(
      "SELECT COUNT(*) AS c FROM UserPicture WHERE isDelete = 0 AND imageAfterUrl IS NOT NULL AND length(imageAfterUrl) > 0",
    ),
    client.execute(
      "SELECT COUNT(*) AS c FROM UserPicture WHERE isDelete = 0 AND imageAfterUrl LIKE '%ciwi-us-1327177217.cos%'",
    ),
    client.execute(
      "SELECT COUNT(*) AS c FROM UserPicture WHERE isDelete = 0 AND imageAfterUrl LIKE '%img.bogdatech.com%'",
    ),
    client.execute(
      "SELECT languageCode, COUNT(*) AS c FROM UserPicture WHERE isDelete = 0 GROUP BY languageCode ORDER BY c DESC LIMIT 15",
    ),
    client.execute(
      "SELECT shop, COUNT(*) AS c FROM UserPicture WHERE isDelete = 0 GROUP BY shop ORDER BY c DESC LIMIT 10",
    ),
    client.execute(
      "SELECT shop, imageId, languageCode, substr(imageBeforeUrl, 1, 100) AS beforePrefix, substr(imageAfterUrl, 1, 100) AS afterPrefix FROM UserPicture WHERE isDelete = 0 AND imageAfterUrl IS NOT NULL AND length(imageAfterUrl) > 0 LIMIT 5",
    ),
  ]);

const samples = [];
for (const row of sample.rows) {
  const after = String(row.afterPrefix || "");
  let httpStatus = null;
  let finalUrl = null;
  if (after) {
    // API 读出时会 COS→CDN；这里对 CDN 形态做 HEAD/GET 探测
    const cdnUrl = after.replace(
      "https://ciwi-us-1327177217.cos.na-ashburn.myqcloud.com",
      "https://img.bogdatech.com",
    );
    finalUrl = cdnUrl;
    try {
      const res = await fetch(cdnUrl, { method: "HEAD", redirect: "follow" });
      httpStatus = res.status;
      if (httpStatus === 405 || httpStatus === 403) {
        const getRes = await fetch(cdnUrl, {
          method: "GET",
          headers: { Range: "bytes=0-0" },
          redirect: "follow",
        });
        httpStatus = getRes.status;
      }
    } catch (err) {
      httpStatus = `error:${err instanceof Error ? err.message : String(err)}`;
    }
  }
  samples.push({
    shop: row.shop,
    imageId: row.imageId,
    languageCode: row.languageCode,
    beforePrefix: row.beforePrefix,
    afterPrefix: row.afterPrefix,
    probeUrlPrefix: finalUrl ? finalUrl.slice(0, 100) : null,
    probeHttpStatus: httpStatus,
  });
}

console.log(
  JSON.stringify(
    {
      ok: true,
      envPath,
      total: Number(total.rows[0].c),
      active: Number(active.rows[0].c),
      withImageAfterUrl: Number(withAfter.rows[0].c),
      cosUrlRows: Number(cosRows.rows[0].c),
      alreadyCdnRows: Number(cdnRows.rows[0].c),
      topLanguages: byLang.rows.map((r) => ({
        languageCode: r.languageCode,
        c: Number(r.c),
      })),
      topShops: byShop.rows.map((r) => ({ shop: r.shop, c: Number(r.c) })),
      samples,
    },
    null,
    2,
  ),
);
