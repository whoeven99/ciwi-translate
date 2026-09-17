import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  confirmLeaveSaveBar,
  getAppBridgeSaveBar,
  runAfterSaveBarLeave,
} from "./saveBarNavigation.ts";

type ShopifyHost = {
  shopify?: {
    saveBar?: {
      show: (id: string) => void;
      hide: (id: string) => void;
      leaveConfirmation: () => Promise<void>;
    };
  };
};

const host = globalThis as ShopifyHost;
const originalShopify = host.shopify;

describe("confirmLeaveSaveBar", () => {
  beforeEach(() => {
    delete host.shopify;
  });

  afterEach(() => {
    if (originalShopify) {
      host.shopify = originalShopify;
    } else {
      delete host.shopify;
    }
  });

  it("no-ops when App Bridge saveBar is missing", async () => {
    await confirmLeaveSaveBar();
    assert.equal(getAppBridgeSaveBar(), undefined);
  });

  it("waits until leaveConfirmation resolves", async () => {
    let called = false;
    host.shopify = {
      saveBar: {
        show() {},
        hide() {},
        leaveConfirmation: async () => {
          called = true;
        },
      },
    };

    await confirmLeaveSaveBar();
    assert.equal(called, true);
  });

  it("runs the action after leaveConfirmation", async () => {
    host.shopify = {
      saveBar: {
        show() {},
        hide() {},
        leaveConfirmation: async () => {},
      },
    };
    let ran = false;
    await new Promise((resolve) => {
      runAfterSaveBarLeave(() => {
        ran = true;
        resolve();
      });
    });
    assert.equal(ran, true);
  });
});
