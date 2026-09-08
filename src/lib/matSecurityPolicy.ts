export type MatActorScope = "CLIENT" | "USER" | "SUPERADMIN";

export type MatPinAction =
  | "NEW_DEVICE"
  | "FIRST_DISPERSION"
  | "CREATE_BENEFICIARY"
  | "REVOKE_DEVICE"
  | "MAINTENANCE"
  | "LOGOUT_REOPEN";

export const MAT_SECURITY_POLICY = {
  clientTrustWindowMs: 4 * 60 * 60 * 1000,
  userTrustWindowMs: 8 * 60 * 60 * 1000,
  superadminTrustWindowMs: 7 * 24 * 60 * 60 * 1000,
  pinActions: [
    "NEW_DEVICE",
    "FIRST_DISPERSION",
    "CREATE_BENEFICIARY",
    "REVOKE_DEVICE",
    "MAINTENANCE",
    "LOGOUT_REOPEN",
  ] satisfies MatPinAction[],
};

export function getMatTrustWindowMs(scope: MatActorScope) {
  if (scope === "CLIENT") return MAT_SECURITY_POLICY.clientTrustWindowMs;
  if (scope === "USER") return MAT_SECURITY_POLICY.userTrustWindowMs;
  return MAT_SECURITY_POLICY.superadminTrustWindowMs;
}

export function formatMatTrustWindow(scope: MatActorScope) {
  if (scope === "CLIENT") return "4h";
  if (scope === "USER") return "8h";
  return "7d";
}

export function isMatPinRequiredAction(action: MatPinAction) {
  return MAT_SECURITY_POLICY.pinActions.includes(action);
}