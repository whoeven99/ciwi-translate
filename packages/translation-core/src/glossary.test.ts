import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { selectGlossaryLinesForTexts, type GlossaryEntry } from "./glossary.js";

const entry = (term: string): GlossaryEntry => ({
  term,
  line: `- Translate "${term}" as "X".`,
});

describe("selectGlossaryLinesForTexts", () => {
  it("keeps only terms the batch actually contains", () => {
    const entries = [entry("tent"), entry("kayak"), entry("sleeping bag")];

    const lines = selectGlossaryLinesForTexts(entries, [
      "Our lightweight tent packs down small.",
      "Pairs well with any sleeping bag.",
    ]);

    assert.deepEqual(lines, [entry("tent").line, entry("sleeping bag").line]);
  });

  it("matches case-insensitively and across inflections", () => {
    const lines = selectGlossaryLinesForTexts(
      [entry("shoe")],
      ["Waterproof Shoes for winter"],
    );

    assert.deepEqual(lines, [entry("shoe").line]);
  });

  it("returns nothing when no term appears", () => {
    assert.deepEqual(selectGlossaryLinesForTexts([entry("kayak")], ["A red hat"]), []);
  });

  it("handles empty inputs without throwing", () => {
    assert.deepEqual(selectGlossaryLinesForTexts([], ["anything"]), []);
    assert.deepEqual(selectGlossaryLinesForTexts([entry("tent")], []), []);
    assert.deepEqual(selectGlossaryLinesForTexts([entry("tent")], [""]), []);
  });

  it("ignores blank terms instead of matching everything", () => {
    assert.deepEqual(selectGlossaryLinesForTexts([entry("   ")], ["some text"]), []);
  });

  it("treats terms as literal text, not patterns", () => {
    const entries = [entry("C++ (beta)")];

    assert.deepEqual(
      selectGlossaryLinesForTexts(entries, ["Now shipping C++ (beta) support"]),
      [entries[0].line],
    );
    assert.deepEqual(selectGlossaryLinesForTexts(entries, ["Cxx beta"]), []);
  });

  it("preserves the deterministic order of the source entries", () => {
    const entries = [entry("alpha"), entry("beta"), entry("gamma")];

    assert.deepEqual(
      selectGlossaryLinesForTexts(entries, ["gamma beta alpha"]),
      entries.map((e) => e.line),
    );
  });
});
