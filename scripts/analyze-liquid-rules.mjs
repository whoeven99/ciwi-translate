/**
 * 导出并分析 LiquidRule（默认最近 2 天）。
 *
 * 用法（只读查产）：
 *   node scripts/analyze-liquid-rules.mjs --env=.env.prod
 *   node scripts/analyze-liquid-rules.mjs --env=.env.prod --days=2
 *   node scripts/analyze-liquid-rules.mjs --env=.env.test --source=auto
 *
 * 输出：scripts/tmp/liquid-rule-audit/{runId}/
 */
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client/http";
import {
  looksLikeAutoLiquidJunk,
  looksLikeHtmlMarkupFragment,
  looksLikeProductModelCode,
  translationRuleJudgment,
} from "@ciwi/translation-core/translation-filter";
import { loadStackedEnv, resolveTurso } from "./lib/loadEnv.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT_ROOT = resolve(ROOT, "scripts/tmp/liquid-rule-audit");

const MAX_TEXT_LEN = 200;
const MIN_TEXT_LEN = 2;
const URL_RE = /^(https?:\/\/|www\.|\/|mailto:|tel:)/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NON_HUMAN_RE = /^[\d\s.,:/#$€£¥%+\-–—()[\]{}|*·•]+$/;

function parseArgs(argv) {
  const out = { days: 2, source: null, shop: null, limit: 0, envOverlay: ".env.test" };
  for (const a of argv) {
    if (a.startsWith("--days=")) out.days = Math.max(1, Number(a.slice(7)) || 2);
    else if (a.startsWith("--source=")) out.source = a.slice(9).trim() || null;
    else if (a.startsWith("--shop=")) out.shop = a.slice(7).trim() || null;
    else if (a.startsWith("--limit=")) out.limit = Math.max(0, Number(a.slice(8)) || 0);
    else if (a.startsWith("--env=")) out.envOverlay = a.slice(6).trim() || ".env.test";
  }
  return out;
}

function normalize(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function looksTranslatable(text) {
  const t = normalize(text);
  if (t.length < MIN_TEXT_LEN || t.length > MAX_TEXT_LEN) return { ok: false, reason: "length" };
  if (!/\p{L}/u.test(t)) return { ok: false, reason: "no_letters" };
  if (URL_RE.test(t) || EMAIL_RE.test(t)) return { ok: false, reason: "url_or_email" };
  if (NON_HUMAN_RE.test(t)) return { ok: false, reason: "non_human_numeric" };
  if (t.includes("{{") || t.includes("}}") || t.includes("{%")) {
    return { ok: false, reason: "liquid_tag" };
  }
  if (looksLikeHtmlMarkupFragment(t)) return { ok: false, reason: "html_markup_fragment" };
  if (!/\s/.test(t) && /^[a-z0-9_.-]+$/.test(t)) return { ok: false, reason: "slug_like" };
  return { ok: true, reason: null };
}

function junkSubReason(text) {
  const t = normalize(text);
  if (!t) return "empty";
  if (/\b(reviews?|ratings?|verified|stars?)\b/i.test(t) || /★/.test(t)) return "review_widget";
  if (/\d+\s*stars?\s*:/i.test(t)) return "review_widget";
  if (/\d+\s*[:：]\s*\d+/.test(t) && /%/.test(t)) return "review_widget";
  if (/[$€£¥₹]\s*\d[\d,.'’]*/.test(t)) return "price";
  if (/\d[\d,.'’]*\s*(JPY|EUR|USD|GBP|CNY|RMB)\b/i.test(t)) return "price";
  if (/^SKU\s*[：:]/i.test(t)) return "sku_label";
  if (/\b(19|20)\d{2}\s+and\s+later\b/i.test(t)) return "fitment_year";
  if (t.length <= 80 && /\b(19|20)\d{2}\s*[-–—]\s*(19|20)\d{2}\b/.test(t)) return "fitment_year";
  if (!/\s/.test(t) && /^[A-Z0-9]{4,12}$/i.test(t) && /\d/.test(t)) return "sku_token";
  if (/^\d+\s*%\s*OFF$/i.test(t)) return "promo_currency";
  if (/^(EUR|USD|GBP|JPY|CNY|RMB)\s*[€$£¥]?$/i.test(t)) return "promo_currency";
  if (looksLikeProductModelCode(t)) return "product_model_code";
  if (/^(XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|5XL)$/i.test(t)) return "size_code";
  if (/^anonymous$/i.test(t) || /^@[A-Za-z0-9._-]{2,40}$/.test(t)) return "person_handle";
  if (/^[A-Z][a-z]{1,20}\s+[A-Z]\.?$/.test(t)) return "person_handle";
  if (/^[A-Z]\.?\s+[A-Z]\.?$/.test(t)) return "person_handle";
  if (/\d+(?:\.\d+)?\s*[*x×]\s*\d+/i.test(t)) return "spec_dimension";
  if (/^EU\s*\d{2}$/i.test(t)) return "eu_size";
  if (/^[A-Z]{6,}\d{2,}$/.test(t)) return "coupon_code";
  if (/^,\s*[A-Za-z0-9]/.test(t)) return "brand_fragment";
  if (/^\d+\s+likes?$/i.test(t)) return "social_counter";
  if (/^(english|deutsch|italiano|français|español)$/i.test(t)) return "locale_label";
  if (/^(facebook|instagram|paypal|visa|bmw|carplay)$/i.test(t)) return "brand_platform";
  return "junk_other";
}

function classifyRow(row) {
  const text = row.beforeTranslation;
  const coarse = looksTranslatable(text);
  const ruleOk = translationRuleJudgment("liquid", text);
  const isJunk = looksLikeAutoLiquidJunk(text);

  if (coarse.ok && ruleOk) return { bucket: "translatable", detail: null };
  if (isJunk) return { bucket: "junk", detail: junkSubReason(text) };
  if (!coarse.ok) return { bucket: "coarse_reject", detail: coarse.reason };
  if (looksLikeHtmlMarkupFragment(text)) {
    return { bucket: "html_markup_fragment", detail: "html_markup_fragment" };
  }
  return { bucket: "rule_reject_other", detail: "translation_rule" };
}

function inc(map, key, n = 1) {
  map[key] = (map[key] || 0) + n;
}

function topSamples(map, n = 10) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([text, count]) => ({ text, count }));
}

function runIdNow() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function executeWithRetry(db, query, attempts = 4) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await db.execute(query);
    } catch (err) {
      lastErr = err;
      await sleep(1500 * (i + 1));
    }
  }
  throw lastErr;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { env } = loadStackedEnv({ root: ROOT, overlay: args.envOverlay, applyToProcess: true });
  const turso = resolveTurso(env);
  if (!turso.url || !turso.authToken) throw new Error("缺少 Turso 凭据");

  const db = createClient({ url: turso.url, authToken: turso.authToken });
  const sinceIso = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000).toISOString();
  const where = ["(createdAt >= ? OR updatedAt >= ?)"];
  const params = [sinceIso, sinceIso];
  if (args.source) {
    where.push("source = ?");
    params.push(args.source);
  }
  if (args.shop) {
    where.push("shop = ?");
    params.push(args.shop);
  }

  const countRes = await executeWithRetry(db, {
    sql: `SELECT COUNT(*) AS n FROM LiquidRule WHERE ${where.join(" AND ")}`,
    args: params,
  });
  const expectedTotal = Number(countRes.rows[0]?.n || 0);
  console.log(`count=${expectedTotal}`);

  const pageSize = 400;
  const maxRows = args.limit > 0 ? args.limit : expectedTotal;
  const rawRows = [];
  let cursorUpdatedAt = null;
  let cursorId = null;

  while (rawRows.length < maxRows) {
    const take = Math.min(pageSize, maxRows - rawRows.length);
    const pageWhere = [...where];
    const pageParams = [...params];
    if (cursorUpdatedAt != null && cursorId != null) {
      pageWhere.push("(updatedAt < ? OR (updatedAt = ? AND id < ?))");
      pageParams.push(cursorUpdatedAt, cursorUpdatedAt, cursorId);
    }
    const sql = `SELECT id, shop, beforeTranslation, afterTranslation, languageCode,
      replacementMethod, source, status, sourceDigest, jobId, createdAt, updatedAt
      FROM LiquidRule WHERE ${pageWhere.join(" AND ")}
      ORDER BY updatedAt DESC, id DESC LIMIT ?`;
    const result = await executeWithRetry(db, { sql, args: [...pageParams, take] });
    if (!result.rows.length) break;
    rawRows.push(...result.rows);
    const last = result.rows[result.rows.length - 1];
    cursorUpdatedAt = last.updatedAt;
    cursorId = last.id;
    if (result.rows.length < take) break;
    if (rawRows.length % 2000 < pageSize) console.log(`fetched ${rawRows.length}/${maxRows}`);
  }

  const rows = rawRows.map((r) => ({
    id: r.id,
    shop: r.shop,
    beforeTranslation: r.beforeTranslation,
    afterTranslation: r.afterTranslation,
    languageCode: r.languageCode,
    replacementMethod: Boolean(r.replacementMethod),
    source: r.source,
    status: r.status,
    sourceDigest: r.sourceDigest,
    jobId: r.jobId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));

  const runId = runIdNow();
  const outDir = resolve(OUT_ROOT, runId);
  mkdirSync(outDir, { recursive: true });

  const summary = {
    runId,
    envOverlay: args.envOverlay,
    sinceIso,
    days: args.days,
    total: rows.length,
    byBucket: {},
    byJunkDetail: {},
    byCoarseDetail: {},
    bySource: {},
    byStatus: {},
    bySourceAndBucket: {},
    shopCount: new Set(rows.map((r) => r.shop)).size,
    samples: {},
  };

  const sampleMaps = Object.fromEntries(
    ["translatable", "junk", "coarse_reject", "html_markup_fragment", "rule_reject_other"].map((k) => [k, new Map()]),
  );

  const stream = createWriteStream(resolve(outDir, "raw.jsonl"), "utf8");
  for (const row of rows) {
    const { bucket, detail } = classifyRow(row);
    stream.write(`${JSON.stringify({ ...row, analysis: { bucket, detail } })}\n`);
    inc(summary.byBucket, bucket);
    inc(summary.bySource, row.source || "unknown");
    inc(summary.byStatus, row.status || "unknown");
    inc(summary.bySourceAndBucket, `${row.source || "unknown"}:${bucket}`);
    if (bucket === "junk" && detail) inc(summary.byJunkDetail, detail);
    if (bucket === "coarse_reject" && detail) inc(summary.byCoarseDetail, detail);
    const text = normalize(row.beforeTranslation);
    const key = text.length > 120 ? `${text.slice(0, 117)}...` : text;
    inc(sampleMaps[bucket], key);
  }
  stream.end();

  for (const [bucket, map] of Object.entries(sampleMaps)) {
    summary.samples[bucket] = topSamples(map);
  }

  const translatable = summary.byBucket.translatable || 0;
  const pct = (n) => (summary.total ? ((n / summary.total) * 100).toFixed(1) : "0.0");

  const report = [
    "# LiquidRule 分析报告",
    "",
    `- 环境: \`${args.envOverlay}\``,
    `- 时间窗: 最近 ${args.days} 天 (since \`${sinceIso}\`)`,
    `- 总行数: **${summary.total}** (${summary.shopCount} 家店)`,
    "",
    "## 总览",
    "",
    `| 分类 | 条数 | 占比 |`,
    `| --- | ---: | ---: |`,
    `| 可翻译 | ${translatable} | ${pct(translatable)}% |`,
    `| 不应翻译 | ${summary.total - translatable} | ${pct(summary.total - translatable)}% |`,
    "",
    "## junk 子类",
    "",
    ...Object.entries(summary.byJunkDetail).sort((a, b) => b[1] - a[1]).map(([k, v]) => `- ${k}: ${v}`),
    "",
    "## coarse_reject 子类",
    "",
    ...Object.entries(summary.byCoarseDetail).sort((a, b) => b[1] - a[1]).map(([k, v]) => `- ${k}: ${v}`),
    "",
  ];

  for (const [bucket, samples] of Object.entries(summary.samples)) {
    report.push(`## 样例: ${bucket}`, "");
    for (const s of samples) report.push(`- (${s.count}×) \`${s.text.replace(/`/g, "'")}\``);
    report.push("");
  }

  writeFileSync(resolve(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(resolve(outDir, "report.md"), report.join("\n"));

  console.log(`OUT_DIR: ${outDir}`);
  console.log(`TOTAL: ${summary.total}`);
  console.log(`TRANSLATABLE: ${translatable} (${pct(translatable)}%)`);
  console.log("BY_BUCKET:", JSON.stringify(summary.byBucket));
  console.log("BY_JUNK:", JSON.stringify(summary.byJunkDetail));
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
