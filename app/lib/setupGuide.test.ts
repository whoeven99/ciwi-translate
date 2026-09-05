import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSetupGuideState,
  firstIncompleteSetupGuideTask,
  shouldAutoDismissSetupGuide,
  type SetupGuideInput,
} from "./setupGuide.ts";

function input(overrides: Partial<SetupGuideInput> = {}): SetupGuideInput {
  return {
    hasV4Job: false,
    hasOpenedCreateFlow: false,
    hasGlossary: false,
    embedStatus: "inactive",
    hasIncludeLiquidJob: false,
    ...overrides,
  };
}

describe("buildSetupGuideState", () => {
  it("shows all three tasks as incomplete for a fresh shop", () => {
    const state = buildSetupGuideState(input());
    assert.equal(state.completedCount, 0);
    assert.equal(state.totalCount, 3);
    assert.equal(state.translate.complete, false);
    assert.equal(state.translate.steps.clickTranslate, false);
    assert.equal(state.translate.steps.configureTask, false);
    assert.equal(state.glossary.complete, false);
    assert.equal(state.thirdParty.complete, false);
    assert.equal(state.thirdParty.steps.themeEmbed, false);
    assert.equal(state.thirdParty.steps.includeLiquid, false);
  });

  it("marks batch translate complete after a v4 job exists", () => {
    const state = buildSetupGuideState(input({ hasV4Job: true }));
    assert.equal(state.translate.complete, true);
    assert.equal(state.translate.steps.clickTranslate, true);
    assert.equal(state.translate.steps.configureTask, true);
    assert.equal(state.completedCount, 1);
  });

  it("marks click-translate done when the create flow was opened", () => {
    const state = buildSetupGuideState(input({ hasOpenedCreateFlow: true }));
    assert.equal(state.translate.complete, false);
    assert.equal(state.translate.steps.clickTranslate, true);
    assert.equal(state.translate.steps.configureTask, false);
  });

  it("marks glossary complete when a rule exists", () => {
    const state = buildSetupGuideState(input({ hasGlossary: true }));
    assert.equal(state.glossary.complete, true);
    assert.equal(state.glossary.steps.addRule, true);
    assert.equal(state.completedCount, 1);
  });

  it("does not complete third-party until embed and liquid are both done", () => {
    assert.equal(
      buildSetupGuideState(input({ embedStatus: "active" })).thirdParty.complete,
      false,
    );
    assert.equal(
      buildSetupGuideState(input({ hasIncludeLiquidJob: true })).thirdParty.complete,
      false,
    );
    const state = buildSetupGuideState(
      input({ embedStatus: "active", hasIncludeLiquidJob: true }),
    );
    assert.equal(state.thirdParty.complete, true);
    assert.equal(state.thirdParty.steps.themeEmbed, true);
    assert.equal(state.thirdParty.steps.includeLiquid, true);
    assert.equal(state.completedCount, 1);
  });

  it("does not treat loading or unknown embed as enabled", () => {
    assert.equal(
      buildSetupGuideState(input({ embedStatus: "loading" })).thirdParty.steps.themeEmbed,
      false,
    );
    assert.equal(
      buildSetupGuideState(input({ embedStatus: "unknown" })).thirdParty.steps.themeEmbed,
      false,
    );
  });

  it("counts 3/3 when every parent task is complete", () => {
    const state = buildSetupGuideState(
      input({
        hasV4Job: true,
        hasGlossary: true,
        embedStatus: "active",
        hasIncludeLiquidJob: true,
      }),
    );
    assert.equal(state.completedCount, 3);
    assert.equal(state.translate.complete, true);
    assert.equal(state.glossary.complete, true);
    assert.equal(state.thirdParty.complete, true);
  });
});

describe("shouldAutoDismissSetupGuide", () => {
  it("is false until translate, glossary, and third-party are all done", () => {
    assert.equal(shouldAutoDismissSetupGuide(buildSetupGuideState(input())), false);
    assert.equal(
      shouldAutoDismissSetupGuide(buildSetupGuideState(input({ hasV4Job: true }))),
      false,
    );
    assert.equal(
      shouldAutoDismissSetupGuide(
        buildSetupGuideState(input({ hasV4Job: true, hasGlossary: true })),
      ),
      false,
    );
    assert.equal(
      shouldAutoDismissSetupGuide(
        buildSetupGuideState(
          input({
            hasV4Job: true,
            hasGlossary: true,
            embedStatus: "active",
          }),
        ),
      ),
      false,
    );
  });

  it("is true when all three setup tasks are complete", () => {
    assert.equal(
      shouldAutoDismissSetupGuide(
        buildSetupGuideState(
          input({
            hasV4Job: true,
            hasGlossary: true,
            embedStatus: "active",
            hasIncludeLiquidJob: true,
          }),
        ),
      ),
      true,
    );
  });
});

describe("firstIncompleteSetupGuideTask", () => {
  it("returns the first incomplete parent task", () => {
    assert.equal(firstIncompleteSetupGuideTask(buildSetupGuideState(input())), "translate");
    assert.equal(
      firstIncompleteSetupGuideTask(buildSetupGuideState(input({ hasV4Job: true }))),
      "glossary",
    );
    assert.equal(
      firstIncompleteSetupGuideTask(
        buildSetupGuideState(input({ hasV4Job: true, hasGlossary: true })),
      ),
      "thirdParty",
    );
  });
});
