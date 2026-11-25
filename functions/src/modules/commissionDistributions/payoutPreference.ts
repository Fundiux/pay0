/** Personal commission payout preference. Missing/invalid preferences are always MANUAL.
 * This is a pure policy helper; it never initiates financial operations.
 */
export type CommissionPayoutMode = "MANUAL" | "AUTOMATIC";

export function resolveCommissionPayoutMode(value: unknown): CommissionPayoutMode {
  return value === "AUTOMATIC" ? "AUTOMATIC" : "MANUAL";
}

/** Automatic preparation and execution both require the owner's explicit opt-in.
 * The organization's existing schedule and execution gate remain additional requirements.
 */
export function mayAutomaticallyProcessCommission(input: {
  ownerPreference: unknown;
  organizationEnabled: boolean;
  organizationExecutionEnabled: boolean;
}): { prepare: boolean; execute: boolean } {
  const optedIn = resolveCommissionPayoutMode(input.ownerPreference) === "AUTOMATIC";
  return {
    prepare: optedIn && input.organizationEnabled,
    execute: optedIn && input.organizationEnabled && input.organizationExecutionEnabled,
  };
}
