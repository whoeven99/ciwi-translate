/** Shopify translationsRegister userErrors that are platform constraints, not worker bugs. */

export type WritebackUserError = {
  field: string | string[];
  message: string;
};

export type WritebackFailedResource = {
  resourceId: string;
  userErrors?: WritebackUserError[];
};

export function isTooManyTranslationKeysMessage(
  message: string | undefined | null,
): boolean {
  return /too many translation keys|too_many_keys/i.test(message ?? "");
}

/** e.g. Value fails validation on resource: ["Value has a maximum length of 20."] */
export function isValueLengthValidationMessage(
  message: string | undefined | null,
): boolean {
  const msg = message ?? "";
  return (
    /Value fails validation on resource/i.test(msg) &&
    /(maximum|minimum)\s+length/i.test(msg)
  );
}

export function isBenignWritebackUserError(message: string | undefined | null): boolean {
  return (
    isTooManyTranslationKeysMessage(message) ||
    isValueLengthValidationMessage(message)
  );
}

export function areAllUserErrorsBenign(userErrors: WritebackUserError[]): boolean {
  return (
    userErrors.length > 0 &&
    userErrors.every((err) => isBenignWritebackUserError(err.message))
  );
}

/** When every writeback failure is a benign Shopify constraint, count them as done. */
export function shouldTreatWritebackFailuresAsBenign(
  writebackFailed: number,
  failedResources: WritebackFailedResource[] | undefined,
): boolean {
  if (writebackFailed <= 0 || !failedResources?.length) return false;
  if (failedResources.length !== writebackFailed) return false;
  return failedResources.every((resource) =>
    areAllUserErrorsBenign(resource.userErrors ?? []),
  );
}

export function reconcileBenignWritebackFailures(
  writebackDone: number,
  writebackFailed: number,
  failedResources: WritebackFailedResource[] | undefined,
): { writebackDone: number; writebackFailed: number; reconciled: boolean } {
  if (!shouldTreatWritebackFailuresAsBenign(writebackFailed, failedResources)) {
    return { writebackDone, writebackFailed, reconciled: false };
  }
  return {
    writebackDone: writebackDone + writebackFailed,
    writebackFailed: 0,
    reconciled: true,
  };
}
