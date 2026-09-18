import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createTmChunkStats,
  formatTmStatsLine,
  noteTmEngineChars,
  noteTmEngineRequests,
  noteTmLookup,
  summarizeTmChunk,
  TM_STATS_LOG_PREFIX,
} from "./tmStats.js";

const context = {
  shopName: "demo.myshopify.com",
  source: "en",
  target: "fr",
  aiModel: "deepseek-v4-flash",
  cacheDisabled: false,
};

function parseLine(line: string): Record<string, unknown> {
  assert.ok(line.startsWith(`${TM_STATS_LOG_PREFIX} `));
  return JSON.parse(line.slice(TM_STATS_LOG_PREFIX.length + 1));
}

describe("tmStats", () => {
  it("counts lookups and only credits chars on a hit", () => {
    const stats = createTmChunkStats();
    noteTmLookup(stats, "fieldDigest", true, 100);
    noteTmLookup(stats, "fieldDigest", false, 400);

    const summary = summarizeTmChunk(stats);
    assert.equal(summary.tiers.fieldDigest.lookups, 2);
    assert.equal(summary.tiers.fieldDigest.hits, 1);
    assert.equal(summary.tiers.fieldDigest.hitChars, 100);
    assert.equal(summary.tiers.fieldDigest.hitRate, 0.5);
  });

  it("derives charHitRate from cached vs engine chars", () => {
    const stats = createTmChunkStats();
    noteTmLookup(stats, "leafValue", true, 300);
    noteTmEngineChars(stats, 100);

    const summary = summarizeTmChunk(stats);
    assert.equal(summary.hitChars, 300);
    assert.equal(summary.engineChars, 100);
    assert.equal(summary.charHitRate, 0.75);
  });

  it("aggregates across all three tiers", () => {
    const stats = createTmChunkStats();
    noteTmLookup(stats, "fieldDigest", true, 10);
    noteTmLookup(stats, "fieldValue", false, 20);
    noteTmLookup(stats, "leafValue", true, 30);

    const summary = summarizeTmChunk(stats);
    assert.equal(summary.lookups, 3);
    assert.equal(summary.hits, 2);
    assert.equal(summary.hitChars, 40);
  });

  it("reports zero rates instead of dividing by zero", () => {
    const summary = summarizeTmChunk(createTmChunkStats());
    assert.equal(summary.hitRate, 0);
    assert.equal(summary.charHitRate, 0);
  });

  it("clamps negative char counts", () => {
    const stats = createTmChunkStats();
    noteTmLookup(stats, "leafValue", true, -5);
    noteTmEngineChars(stats, -5);

    const summary = summarizeTmChunk(stats);
    assert.equal(summary.hitChars, 0);
    assert.equal(summary.engineChars, 0);
  });

  it("emits a parseable one-line JSON summary", () => {
    const stats = createTmChunkStats();
    noteTmLookup(stats, "fieldValue", true, 50);
    noteTmEngineChars(stats, 150);

    const line = formatTmStatsLine(stats, context);
    assert.ok(line);
    assert.equal(line!.includes("\n"), false);

    const payload = parseLine(line!);
    assert.equal(payload.shop, "demo.myshopify.com");
    assert.equal(payload.target, "fr");
    assert.equal(payload.hitChars, 50);
    assert.equal(payload.engineChars, 150);
    assert.equal(payload.charHitRate, 0.25);
    assert.equal(payload.cacheDisabled, undefined);
  });

  it("marks chunks that ran with TM reads disabled", () => {
    const stats = createTmChunkStats();
    noteTmEngineChars(stats, 200);

    const payload = parseLine(
      formatTmStatsLine(stats, { ...context, cacheDisabled: true })!,
    );
    assert.equal(payload.cacheDisabled, true);
    assert.equal(payload.lookups, 0);
  });

  it("stays silent for a chunk that did no TM or engine work", () => {
    assert.equal(formatTmStatsLine(createTmChunkStats(), context), null);
  });

  it("reports content carried per LLM request", () => {
    const stats = createTmChunkStats();
    noteTmEngineChars(stats, 1200);
    noteTmEngineRequests(stats, 4);

    const summary = summarizeTmChunk(stats);
    assert.equal(summary.llmRequests, 4);
    assert.equal(summary.charsPerRequest, 300);
  });

  it("does not divide by zero when nothing reached an engine", () => {
    const stats = createTmChunkStats();
    noteTmLookup(stats, "leafValue", true, 40);

    assert.equal(summarizeTmChunk(stats).charsPerRequest, 0);
  });

  it("still logs a chunk whose only activity was dispatching requests", () => {
    const stats = createTmChunkStats();
    noteTmEngineRequests(stats, 2);

    const payload = parseLine(formatTmStatsLine(stats, context)!);
    assert.equal(payload.llmRequests, 2);
  });
});
