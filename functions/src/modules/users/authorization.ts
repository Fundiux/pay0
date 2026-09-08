import { getDefaultModules } from "./defaultModules";

export type CanonicalUserRole = "superadmin" | "admin" | "operador";
export type CanonicalModuleMap = Record<string, Record<string, boolean>>;

export type AuthorizationRequirement = {
  allowedRoles?: CanonicalUserRole[];
  module?: string;
  action?: string | string[];
};

export type AuthorizationDecision = {
  allowed: boolean;
  role: CanonicalUserRole | "";
  reason:
    | "ALLOWED"
    | "UNAUTHENTICATED"
    | "USER_NOT_FOUND"
    | "USER_INACTIVE"
    | "ROLE_NOT_ALLOWED"
    | "MODULE_NOT_ALLOWED"
    | "ACTION_NOT_ALLOWED";
};

export function normalizeCanonicalRole(value: unknown): CanonicalUserRole | "" {
  const role = String(value || "").trim().toLowerCase();
  if (role === "superadmin") return "superadmin";
  if (role === "admin") return "admin";
  if (role === "operador" || role === "operator") return "operador";
  return "";
}

export function isCanonicalUserActive(user: any): boolean {
  if (!user) return false;
  if (user.isDeleted === true) return false;
  if (user.isActive === false) return false;
  if (user.active === false) return false;
  return true;
}

export function getEffectiveUserModules(user: any): CanonicalModuleMap {
  const role = normalizeCanonicalRole(user?.role ?? user?.supervisorRole);
  if (!role) return {};

  const defaults = getDefaultModules(role);
  const result: CanonicalModuleMap = JSON.parse(JSON.stringify(defaults));
  const stored = user?.modules;

  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return result;
  }

  for (const [moduleKey, actions] of Object.entries(stored as Record<string, any>)) {
    if (!result[moduleKey] || !actions || typeof actions !== "object" || Array.isArray(actions)) {
      continue;
    }

    for (const [actionKey, value] of Object.entries(actions)) {
      if (!(actionKey in result[moduleKey])) continue;
      // El permiso individual puede revocar el techo del rol, nunca elevarlo.
      result[moduleKey][actionKey] = result[moduleKey][actionKey] === true && value === true;
    }
  }

  return result;
}

export function decideUserAuthorization(params: {
  authenticatedUid?: unknown;
  user: any;
  requirement?: AuthorizationRequirement;
}): AuthorizationDecision {
  const uid = String(params.authenticatedUid || "").trim();
  if (!uid) return { allowed: false, role: "", reason: "UNAUTHENTICATED" };
  if (!params.user) return { allowed: false, role: "", reason: "USER_NOT_FOUND" };

  const role = normalizeCanonicalRole(params.user?.role ?? params.user?.supervisorRole);
  if (!isCanonicalUserActive(params.user)) {
    return { allowed: false, role, reason: "USER_INACTIVE" };
  }

  const requirement = params.requirement || {};
  if (requirement.allowedRoles?.length && !requirement.allowedRoles.includes(role as CanonicalUserRole)) {
    return { allowed: false, role, reason: "ROLE_NOT_ALLOWED" };
  }

  // El superadmin conserva bypass explicito. Admin y operador obedecen permisos individuales.
  if (role === "superadmin") return { allowed: true, role, reason: "ALLOWED" };

  if (requirement.module) {
    const modules = getEffectiveUserModules(params.user);
    const moduleAccess = modules[String(requirement.module)];
    if (moduleAccess?.view !== true) {
      return { allowed: false, role, reason: "MODULE_NOT_ALLOWED" };
    }

    const requiredActions = Array.isArray(requirement.action)
      ? requirement.action
      : requirement.action
        ? [requirement.action]
        : [];

    if (
      requiredActions.length > 0 &&
      !requiredActions.some((action) => moduleAccess[String(action)] === true)
    ) {
      return { allowed: false, role, reason: "ACTION_NOT_ALLOWED" };
    }
  }

  return { allowed: true, role, reason: "ALLOWED" };
}
