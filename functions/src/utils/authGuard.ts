import * as functions from "firebase-functions";
import {
  decideUserAuthorization,
  normalizeCanonicalRole,
} from "../modules/users/authorization";

type GuardOptions = {
  allowedRoles?: Array<"superadmin" | "admin" | "operador">;
  requiredModule?: string;
  requiredAction?: string | string[];
  requireAdmin?: boolean;
};

export function normalizeRole(input: any): "superadmin" | "admin" | "operador" | "" {
  return normalizeCanonicalRole(input);
}

export function getUserRole(user: any): "superadmin" | "admin" | "operador" | "" {
  return normalizeRole(user?.role ?? user?.supervisorRole ?? "");
}

export function assertAuthorized(
  auth: any,
  userData: any,
  options: GuardOptions = {}
) {
  const allowedRoles = options.requireAdmin ? (["admin"] as const) : options.allowedRoles;
  const decision = decideUserAuthorization({
    authenticatedUid: auth?.uid,
    user: userData,
    requirement: {
      allowedRoles: allowedRoles ? [...allowedRoles] : undefined,
      module: options.requiredModule,
      action: options.requiredAction,
    },
  });

  if (!decision.allowed) {
    const unauthenticated = decision.reason === "UNAUTHENTICATED";
    const restricted = decision.reason === "USER_RESTRICTED" || decision.reason === "USER_RESTRICTION_INVALID";
    throw new functions.https.HttpsError(
      unauthenticated ? "unauthenticated" : "permission-denied",
      unauthenticated ? "Debes iniciar sesión." : restricted
        ? "Tu cuenta requiere revisión de seguridad. Contacta a soporte."
        : "No tienes permisos para realizar esta acción.",
      restricted ? { reason: "ACCOUNT_RESTRICTED", recovery: "CONTACT_SUPPORT" } : undefined
    );
  }

  return decision.role;
}
