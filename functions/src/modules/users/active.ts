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
export const updateUserActive = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const callerUid = requireAuth(request);
    const caller = await getMyUser(callerUid);
    assertAuthorized(request.auth, caller, { allowedRoles: ["superadmin", "admin"], requiredModule: "usuarios", requiredAction: "activate" });
    const role = requireRole(caller, ["admin", "superadmin"]);

    const targetUid = String(request.data?.uid || "");
    const isActive = !!request.data?.isActive;
    if (!targetUid) throw new HttpsError("invalid-argument", "uid requerido");

    const targetSnap = await db.doc(`users/${targetUid}`).get();
    if (!targetSnap.exists) throw new HttpsError("not-found", "Usuario no existe");

    const target: any = targetSnap.data() || {};

    // Reglas de control
    if (role === "admin") {
      // admin solo puede tocar operadores que el administra
      if (String(target.parentUserId || "") !== callerUid) {
        throw new HttpsError("permission-denied", "Admin solo puede activar/desactivar sus operadores.");
      }
      if (String(target.role || "") !== "operador" && String(target.role || "") !== "operator") {
        throw new HttpsError("permission-denied", "Admin solo puede activar/desactivar operadores.");
      }
    } else {
      // superadmin: solo dentro de su root
      const rootId = String(caller?.rootId || callerUid);
      if (String(target.rootId || "") !== rootId && targetUid !== callerUid) {
        throw new HttpsError("permission-denied", "Fuera de tu root.");
      }
    }

    const now = FieldValue.serverTimestamp();
    await db.doc(`users/${targetUid}`).set(
      { isActive, updatedAt: now, updatedBy: callerUid },
      { merge: true }
    );

    // Opcional: deshabilitar en Auth para forzar login/logout
    // (si falla por permisos, no tiramos todo)
    try {
      await admin.auth().updateUser(targetUid, { disabled: !isActive });
    } catch (e) {
      // noop
    }

    return { ok: true, uid: targetUid, isActive };
  }
);
