// 新用户系统 billing 核心库统一导出。
export * from "./types.server";
export * from "./accountBalance.server";
export { ensureAccount } from "./account/ensureAccount.server";
export { appendBillingLog, type AppendBillingLogParams } from "./billingLog.server";
export {
  getPlanByKey,
  findSubscriptionPlan,
  findPackPlanByName,
  type PlanRecord,
} from "./plans/planCatalog.server";
export {
  applyActiveSubscription,
  type ApplyActiveSubscriptionParams,
  type ApplyActiveSubscriptionResult,
} from "./subscription/activateSubscription.server";
export {
  archivePeriodAndRenew,
  isSubscriptionRenewal,
  type SubscriptionPeriodSnapshot,
} from "./subscription/renewal.server";
export {
  collectGrantedAnnualCreditCycleIndexes,
  countGrantsForBillingPeriod,
  decideAnnualCreditGrant,
  getAnnualCreditCycleIndex,
  getAnnualYearWindow,
  getExpectedAnnualGrants,
  getNextAnnualCreditGrantAt,
  MAX_ANNUAL_CREDIT_GRANTS,
} from "./subscription/annualCreditCycle.server";
export { cancelSubscription } from "./subscription/cancelSubscription.server";
export { cleanupBillingOnUninstall } from "./subscription/cleanupOnUninstall.server";
export {
  snapshotShopForUninstall,
  formatUninstallFeishuMessage,
  formatInstallFeishuMessage,
  formatFirstSubscribeFeishuMessage,
  type UninstallShopSnapshot,
} from "./uninstallSnapshot.server";
export {
  scheduleFirstInstallFeishuNotify,
  scheduleFirstSubscribeFeishuNotify,
} from "./lifecycleFeishuNotify.server";
export { applyTokenPackPurchase } from "./purchase/applyTokenPack.server";
export {
  grantLaunchCreditsIfEligible,
  resolveLaunchCreditsForPlanKey,
  LAUNCH_CREDITS_BY_TIER,
  LAUNCH_CREDITS_REFERENCE_ID,
  type GrantLaunchCreditsResult,
} from "./grant/grantLaunchCredits.server";
export {
  resolveBillingBinding,
  type BindingResolution,
} from "./binding/resolveBillingBinding.server";
export {
  getAccountQuota,
  type AccountQuota,
} from "./quota/getAccountQuota.server";
export { deductCredits } from "./quota/deductCredits.server";
export {
  getShopCreditQuota,
  deductShopCredits,
  type DeductShopCreditsAudit,
} from "./quota/quotaRouter.server";
export {
  recordCreditUsage,
  type CreditUsageSource,
  type RecordCreditUsageParams,
} from "./quota/recordCreditUsage.server";
export { getTsfBootstrapData } from "./bootstrap/getTsfBootstrapData.server";
export {
  handleTsfSubscriptionWebhook,
  handleTsfPurchaseWebhook,
} from "./webhooks/handleBillingWebhook.server";
export { scheduleUninstallWinbackEmail } from "./email/uninstallEmail.server";
