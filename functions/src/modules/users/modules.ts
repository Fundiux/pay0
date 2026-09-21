import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { assertAuthorized, getUserRole } from "../../utils/authGuard";

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();

function requireAuth(request: any) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesion.");
  }

  return request.auth.uid as string;
}

async function getMyUser(uid: string) {
  const a = await db.doc(`users/${uid}`).get();
  if (a.exists) return a.data() as any;

  const b = await db.doc(`usuarios/${uid}`).get();
  if (b.exists) return b.data() as any;

  return null;
}

function requireRole(user: any, roles: Array<"superadmin" | "admin" | "operador">) {
  const role = getUserRole(user);

  if (!roles.includes(role as any)) {
    throw new HttpsError("permission-denied", "No autorizado.");
  }

  return role;
}
export const updateUserModules = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const callerUid = requireAuth(request);
    const caller = await getMyUser(callerUid);
    const callerRole = requireRole(caller, ["admin", "superadmin"]);
    assertAuthorized(request.auth, caller, {
      allowedRoles: ["superadmin", "admin"],
      requiredModule: "usuarios",
      requiredAction: "permissions",
    });

    const targetUid = String(request.data?.targetUid || request.data?.uid || "").trim();
    const rawModules = request.data?.modules;
    const rawSystemAccess = request.data?.systemAccess;

    if (!targetUid) {
      throw new HttpsError("invalid-argument", "targetUid requerido");
    }

    if (!rawModules || typeof rawModules !== "object" || Array.isArray(rawModules)) {
      throw new HttpsError("invalid-argument", "modules invalido");
    }

    if (rawSystemAccess !== undefined && callerRole !== "superadmin") {
      throw new HttpsError("permission-denied", "Solo superadmin puede asignar acceso a sistemas.");
    }

    if (rawSystemAccess !== undefined && (!rawSystemAccess || typeof rawSystemAccess !== "object" || Array.isArray(rawSystemAccess))) {
      throw new HttpsError("invalid-argument", "systemAccess invalido");
    }

    const targetSnap = await db.doc(`users/${targetUid}`).get();
    if (!targetSnap.exists) {
      throw new HttpsError("not-found", "Usuario no existe");
    }

    const target: any = targetSnap.data() || {};
    const callerRootId = String(caller?.rootId || callerUid);
    const targetRootId = String(target?.rootId || "");

    if (callerRole === "admin") {
      if (String(target?.parentUserId || "") !== callerUid) {
        throw new HttpsError("permission-denied", "Admin solo puede actualizar modulos de sus operadores.");
      }

      const targetRole = String(target?.role || "").trim().toLowerCase();
      if (targetRole !== "operador" && targetRole !== "operator") {
        throw new HttpsError("permission-denied", "Admin solo puede actualizar modulos de operadores.");
      }

      if (targetRootId && targetRootId !== callerRootId) {
        throw new HttpsError("permission-denied", "Fuera de tu root.");
      }
    } else {
      if (targetRootId && targetRootId !== callerRootId && targetUid !== callerUid) {
        throw new HttpsError("permission-denied", "Fuera de tu root.");
      }
    }

    const sanitizedModules: Record<string, Record<string, boolean>> = {};

    for (const [moduleKey, moduleValue] of Object.entries(rawModules as Record<string, any>)) {
      const moduleName = String(moduleKey || "").trim();
      if (!moduleName || moduleName === "__proto__" || moduleName === "constructor" || moduleName === "prototype") {
        continue;
      }

      if (!moduleValue || typeof moduleValue !== "object" || Array.isArray(moduleValue)) {
        continue;
      }

      const cleanActions: Record<string, boolean> = {};

      for (const [actionKey, actionValue] of Object.entries(moduleValue as Record<string, any>)) {
        const actionName = String(actionKey || "").trim();
        if (!actionName || actionName === "__proto__" || actionName === "constructor" || actionName === "prototype") {
          continue;
        }
        cleanActions[actionName] = !!actionValue;
      }

      if (Object.keys(cleanActions).length > 0) {
        sanitizedModules[moduleName] = cleanActions;
      }
    }

    const update: Record<string, unknown> = {
      modules: sanitizedModules,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: callerUid,
    };

    if (rawSystemAccess !== undefined) {
      update.systemAccess = { assets: rawSystemAccess.assets === true };
    }

    await db.doc(`users/${targetUid}`).set(
      update,
      { merge: true }
    );

    return { ok: true, targetUid, ...(rawSystemAccess !== undefined ? { systemAccess: update.systemAccess } : {}) };
  }
);
