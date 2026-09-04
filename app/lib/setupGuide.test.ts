import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSetupGuideState,
  shouldAutoDismissSetupGuide,
  type SetupGuideInput,
} from "./setupGuide.ts";

function input(overrides: Partial<SetupGuideInput> = {}): SetupGuideInput {
  return {
    hasV4Job: false,
    hasOpenedCreateFlow: false,
    hasCurrency: false,
    ipOpen: false,
    embedStatus: "inactive",
    hasAutoTranslate: false,
    ...overrides,
  };
}

describe("buildSetupGuideState", () => {
  it("shows all three tasks as incomplete for a fresh shop", () => {
    const state = buildSetupGuideState(input());
    assert.equal(state.completedCount, 0);
    assert.equal(state.totalCount, 3);
    assert.equal(state.translate.visible, true);
    assert.equal(state.translate.complete, false);
    assert.equal(state.translate.steps.clickTranslate, false);
    assert.equal(state.translate.steps.configureTask, false);
    assert.equal(state.switcher.visible, true);
    assert.equal(state.switcher.enabled, false);
    assert.equal(state.autoTranslate.visible, true);
  });

  it("hides the translate task after a v4 job exists", () => {
    const state = buildSetupGuideState(input({ hasV4Job: true }));
    assert.equal(state.translate.visible, false);
    assert.equal(state.translate.complete, true);
    assert.equal(state.completedCount, 1);
  });

  it("marks click-translate done when the create flow was opened", () => {
    const state = buildSetupGuideState(input({ hasOpenedCreateFlow: true }));
    assert.equal(state.translate.visible, true);
    assert.equal(state.translate.steps.clickTranslate, true);
    assert.equal(state.translate.steps.configureTask, false);
  });

  it("keeps the switcher task visible when the embed is active", () => {
    const state = buildSetupGuideState(input({ embedStatus: "active" }));
    assert.equal(state.switcher.visible, true);
    assert.equal(state.switcher.enabled, true);
    assert.equal(state.switcher.complete, true);
    assert.equal(state.completedCount, 1);
  });

  it("does not treat loading or unknown embed as enabled", () => {
    assert.equal(
      buildSetupGuideState(input({ embedStatus: "loading" })).switcher.enabled,
      false,
    );
    assert.equal(
      buildSetupGuideState(input({ embedStatus: "unknown" })).switcher.enabled,
      false,
    );
  });

  it("tracks currency and IP steps while the embed is inactive", () => {
    const state = buildSetupGuideState(
      input({ hasCurrency: true, ipOpen: true }),
    );
    assert.equal(state.switcher.steps.currency, true);
    assert.equal(state.switcher.steps.themeEmbed, false);
    assert.equal(state.switcher.steps.ipOpen, true);
    assert.equal(state.switcher.enabled, false);
  });

  it("hides the auto-translate task once any locale is enabled", () => {
    const state = buildSetupGuideState(input({ hasAutoTranslate: true }));
    assert.equal(state.autoTranslate.visible, false);
    assert.equal(state.autoTranslate.complete, true);
    assert.equal(state.completedCount, 1);
  });

  it("counts 3/3 and still shows only the switcher task when all are done", () => {
    const state = buildSetupGuideState(
      input({
        hasV4Job: true,
        embedStatus: "active",
        hasAutoTranslate: true,
      }),
    );
    assert.equal(state.completedCount, 3);
    assert.equal(state.translate.visible, false);
    assert.equal(state.switcher.visible, true);
    assert.equal(state.autoTranslate.visible, false);
  });
});

describe("shouldAutoDismissSetupGuide", () => {
  it("is false until translate, switcher embed, and auto-translate are all done", () => {
    assert.equal(shouldAutoDismissSetupGuide(buildSetupGuideState(input())), false);
    assert.equal(
      shouldAutoDismissSetupGuide(buildSetupGuideState(input({ hasV4Job: true }))),
      false,
    );
    assert.equal(
      shouldAutoDismissSetupGuide(
        buildSetupGuideState(input({ hasV4Job: true, embedStatus: "active" })),
      ),
      false,
    );
    assert.equal(
      shouldAutoDismissSetupGuide(
        buildSetupGuideState(
          input({ hasV4Job: true, hasAutoTranslate: true, embedStatus: "loading" }),
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
            embedStatus: "active",
            hasAutoTranslate: true,
          }),
        ),
      ),
      true,
    );
  });
});
