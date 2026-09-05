type AppBridgeSaveBar = {
  show: (id: string) => Promise<unknown> | unknown;
  hide: (id: string) => Promise<unknown> | unknown;
  leaveConfirmation: () => Promise<unknown>;
};

type ShopifyHost = {
  shopify?: { saveBar?: AppBridgeSaveBar };
};

export function getAppBridgeSaveBar(): AppBridgeSaveBar | undefined {
  const host = (
    typeof window !== "undefined" ? window : globalThis
  ) as ShopifyHost;
  return host.shopify?.saveBar;
}

/** CSB 显示时一直等到商家点 Save / Discard；无栏则立即返回。 */
export async function confirmLeaveSaveBar(): Promise<void> {
  const saveBar = getAppBridgeSaveBar();
  if (!saveBar?.leaveConfirmation) {
    return;
  }
  await saveBar.leaveConfirmation();
}

/** 等商家处理完 CSB 后再执行跳转 / 翻页等离开当前表单的动作。 */
export function runAfterSaveBarLeave(action: () => void): void {
  void confirmLeaveSaveBar().then(action);
}
