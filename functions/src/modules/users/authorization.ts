import { getDefaultModules } from "./defaultModules";

import { evaluateTrustedRestriction } from "./restrictions";


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
    | "USER_RESTRICTED"
    | "USER_RESTRICTION_INVALID"
    | "ROLE_NOT_ALLOWED"
    | "MODULE_NOT_ALLOWED"
    | "ACTION_NOT_ALLOWED"
    | "PARENT_AUTHORITY_UNRESOLVED";
};

/**
 * Techo heredado de un operador: los permisos efectivos de su usuario padre (admin o superadmin).
 * Solo el servidor lo adjunta (simbolo privado: no puede venir de Firestore ni del navegador).
 * Un operador sin techo resuelto no tiene permisos de modulo (falla cerrado).
 */
export type InheritedModuleCeiling =
  | { status: "RESOLVED"; parentUid: string; parentRole: "admin" | "superadmin"; modules: CanonicalModuleMap }
  | { status: "UNRESOLVED"; reason: "NO_PARENT" | "PARENT_NOT_FOUND" | "PARENT_NOT_ALLOWED" | "PARENT_ROLE_INVALID" | "PARENT_ROOT_MISMATCH" };

const INHERITED_MODULE_CEILING = Symbol("pay0.inheritedModuleCeiling");

export function attachInheritedModuleCeiling<T>(user: T, ceiling: InheritedModuleCeiling): T {
  if (user && typeof user === "object") (user as any)[INHERITED_MODULE_CEILING] = ceiling;
  return user;
}

export function getAttachedInheritedModuleCeiling(user: any): InheritedModuleCeiling | null {
  const ceiling = user && typeof user === "object" ? user[INHERITED_MODULE_CEILING] : null;
  return ceiling && typeof ceiling === "object" ? ceiling as InheritedModuleCeiling : null;
}

/** Operador ligado a su padre por parentUserId; documentos heredados usan adminId. */
export function getOperatorParentUid(user: any): string {
  return String(user?.parentUserId || user?.adminId || "").trim();
}

/**
 * Calcula el techo heredado a partir del documento del padre ya leido. Puro: sin lecturas.
 * Superadmin padre: techo completo (su bypass equivale a todos los permisos del catalogo).
 * Admin padre: sus permisos efectivos (techo del rol admin ∩ sus modulos individuales).
 */
export function computeInheritedModuleCeiling(params: {
  operator: any;
  operatorUid?: unknown;
  parentUid: unknown;
  parent: any;
  nowMs?: number;
}): InheritedModuleCeiling {
  const parentUid = String(params.parentUid || "").trim();
  const operatorUid = String(params.operatorUid || "").trim();
  if (!parentUid || (operatorUid && parentUid === operatorUid)) return { status: "UNRESOLVED", reason: "NO_PARENT" };
  if (!params.parent) return { status: "UNRESOLVED", reason: "PARENT_NOT_FOUND" };

  const parentRole = normalizeCanonicalRole(params.parent?.role ?? params.parent?.supervisorRole);
  if (parentRole !== "admin" && parentRole !== "superadmin") return { status: "UNRESOLVED", reason: "PARENT_ROLE_INVALID" };

  const parentDecision = decideUserAuthorization({ authenticatedUid: parentUid, user: params.parent, nowMs: params.nowMs });
  if (!parentDecision.allowed) return { status: "UNRESOLVED", reason: "PARENT_NOT_ALLOWED" };

  const operatorRoot = String(params.operator?.rootId || operatorUid || "").trim();
  const parentRoot = String(params.parent?.rootId || parentUid).trim();
  if (!operatorRoot || operatorRoot !== parentRoot) return { status: "UNRESOLVED", reason: "PARENT_ROOT_MISMATCH" };

  const modules = parentRole === "superadmin"
    ? getDefaultModules("superadmin") as CanonicalModuleMap
    : getEffectiveUserModules(params.parent);
  return { status: "RESOLVED", parentUid, parentRole, modules };
}

/**
 * Permisos que un editor puede asignar al usuario destino: techo de su rol y, si es operador,
 * solo lo que su padre tiene efectivamente. Un operador con padre no resuelto no admite ninguno.
 */
export function getAssignableUserModules(targetRole: unknown, ceiling: InheritedModuleCeiling | null): CanonicalModuleMap {
  const role = normalizeCanonicalRole(targetRole);
  if (!role) return {};
  const result: CanonicalModuleMap = JSON.parse(JSON.stringify(getDefaultModules(role)));
  return role === "operador" ? clipToCeiling(result, ceiling) : result;
}

/**
 * Recorta una solicitud de permisos ya saneada: revocar (false) siempre se acepta; otorgar (true)
 * solo si es asignable. Lo no asignable se omite de la escritura y se informa como "modulo.accion".
 */
export function clipRequestedModules(requested: CanonicalModuleMap, assignable: CanonicalModuleMap): { modules: CanonicalModuleMap; dropped: string[] } {
  const modules: CanonicalModuleMap = {};
  const dropped: string[] = [];
  for (const [moduleKey, actions] of Object.entries(requested)) {
    const kept: Record<string, boolean> = {};
    for (const [actionKey, value] of Object.entries(actions)) {
      if (value === true && assignable[moduleKey]?.[actionKey] !== true) {
        dropped.push(`${moduleKey}.${actionKey}`);
        continue;
      }
      kept[actionKey] = value === true;
    }
    if (Object.keys(kept).length > 0) modules[moduleKey] = kept;
  }
  return { modules, dropped: dropped.sort() };
}

function clipToCeiling(result: CanonicalModuleMap, ceiling: InheritedModuleCeiling | null): CanonicalModuleMap {
  const allowed = ceiling?.status === "RESOLVED" ? ceiling.modules : null;
  for (const [moduleKey, actions] of Object.entries(result)) {
    for (const actionKey of Object.keys(actions)) {
      // Un operador nunca supera a su padre; sin padre resuelto no conserva permisos de modulo.
      actions[actionKey] = actions[actionKey] === true && allowed?.[moduleKey]?.[actionKey] === true;
    }
  }
  return result;
}

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
  if (user.deleted === true || user.disabled === true || Boolean(user.deletedAt)) return false;
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

  if (stored && typeof stored === "object" && !Array.isArray(stored)) {
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
  }

  // Los permisos del operador se heredan de su padre: techo del rol ∩ propios ∩ efectivos del padre.
  return role === "operador" ? clipToCeiling(result, getAttachedInheritedModuleCeiling(user)) : result;
}

export function decideUserAuthorization(params: {
  authenticatedUid?: unknown;
  user: any;
  requirement?: AuthorizationRequirement;
  nowMs?: number;
}): AuthorizationDecision {
  const uid = String(params.authenticatedUid || "").trim();
  if (!uid) return { allowed: false, role: "", reason: "UNAUTHENTICATED" };
  if (!params.user) return { allowed: false, role: "", reason: "USER_NOT_FOUND" };

  const role = normalizeCanonicalRole(params.user?.role ?? params.user?.supervisorRole);
  if (!isCanonicalUserActive(params.user)) {
    return { allowed: false, role, reason: "USER_INACTIVE" };
  }

  const restriction = evaluateTrustedRestriction(params.user, uid, params.nowMs ?? Date.now());
  if (restriction.restricted) {
    return { allowed: false, role, reason: restriction.state === "INVALID" ? "USER_RESTRICTION_INVALID" : "USER_RESTRICTED" };
  }

  if (!role) return { allowed: false, role, reason: "ROLE_NOT_ALLOWED" };

  const requirement = params.requirement || {};
  if (requirement.allowedRoles?.length && !requirement.allowedRoles.includes(role as CanonicalUserRole)) {
    return { allowed: false, role, reason: "ROLE_NOT_ALLOWED" };
  }

  // El superadmin conserva bypass explicito. Admin y operador obedecen permisos individuales.
  if (role === "superadmin") return { allowed: true, role, reason: "ALLOWED" };

  if (requirement.module) {
    if (role === "operador" && getAttachedInheritedModuleCeiling(params.user)?.status !== "RESOLVED") {
      return { allowed: false, role, reason: "PARENT_AUTHORITY_UNRESOLVED" };
    }
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
