export const LAUNCH_CREDITS_REFERENCE_ID = "launch_credits";
export const BASIC_FIRST_PAY_BONUS_REFERENCE_ID = "basic_first_pay_bonus";

/** 已停发；存量 purchasedCredits 不追回。新发放只走试用池。 */
export const BASIC_FIRST_PAY_PERMANENT_CREDITS = 0;
export const BASIC_FIRST_PAY_EXPIRING_CREDITS = 1_000_000;
export const BASIC_FIRST_PAY_TTL_DAYS = 30;

export function isBasicPlanKey(planKey: string): boolean {
  return planKey.trim().toLowerCase().startsWith("basic");
}

export function isInTrialPeriod(
  trialEndsAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  return trialEndsAt != null && trialEndsAt.getTime() > now.getTime();
}

export function basicFirstPayBonusExpiresAt(from: Date = new Date()): Date {
  return new Date(
    from.getTime() + BASIC_FIRST_PAY_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
}
