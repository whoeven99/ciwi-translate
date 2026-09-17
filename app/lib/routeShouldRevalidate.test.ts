import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ShouldRevalidateFunctionArgs } from "@remix-run/react";
import { APP_NAV_HOME, APP_NAV_ITEMS } from "./appNav.ts";
import { shouldRevalidateAppShell } from "./routeShouldRevalidate.ts";

function args(
  overrides: Partial<ShouldRevalidateFunctionArgs> &
    Pick<ShouldRevalidateFunctionArgs, "currentUrl" | "nextUrl">,
): ShouldRevalidateFunctionArgs {
  return {
    currentParams: {},
    nextParams: {},
    defaultShouldRevalidate: true,
    ...overrides,
  };
}

describe("shouldRevalidateAppShell", () => {
  it("keeps the pricing path aligned with appNav", () => {
    assert.equal(APP_NAV_ITEMS.pricing, "/app/pricing");
  });

  it("skips parent revalidation when navigating to pricing", () => {
    assert.equal(
      shouldRevalidateAppShell(
        args({
          currentUrl: new URL(`https://x${APP_NAV_HOME}`),
          nextUrl: new URL(`https://x${APP_NAV_ITEMS.pricing}`),
        }),
      ),
      false,
    );
    assert.equal(
      shouldRevalidateAppShell(
        args({
          currentUrl: new URL(`https://x${APP_NAV_HOME}`),
          nextUrl: new URL(
            `https://x${APP_NAV_ITEMS.pricing}?ciwiBillingReturn=1`,
          ),
        }),
      ),
      false,
    );
  });

  it("still revalidates when leaving pricing for home", () => {
    assert.equal(
      shouldRevalidateAppShell(
        args({
          currentUrl: new URL(`https://x${APP_NAV_ITEMS.pricing}`),
          nextUrl: new URL(`https://x${APP_NAV_HOME}`),
        }),
      ),
      true,
    );
  });

  it("skips child POST and same-URL revalidation", () => {
    assert.equal(
      shouldRevalidateAppShell(
        args({
          formMethod: "POST",
          formAction: APP_NAV_ITEMS.pricing,
          currentUrl: new URL(`https://x${APP_NAV_ITEMS.pricing}`),
          nextUrl: new URL(`https://x${APP_NAV_ITEMS.pricing}`),
        }),
      ),
      false,
    );
    assert.equal(
      shouldRevalidateAppShell(
        args({
          currentUrl: new URL(`https://x${APP_NAV_HOME}`),
          nextUrl: new URL(`https://x${APP_NAV_HOME}`),
        }),
      ),
      false,
    );
  });
});
