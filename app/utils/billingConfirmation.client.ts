/** Open Shopify billing confirmation in the top frame (embedded admin). */
export function redirectToBillingConfirmation(confirmationUrl: string): boolean {
  if (typeof window === "undefined" || !confirmationUrl) return false;
  try {
    window.open(confirmationUrl, "_top");
    return true;
  } catch {
    try {
      window.top!.location.href = confirmationUrl;
      return true;
    } catch {
      return false;
    }
  }
}
