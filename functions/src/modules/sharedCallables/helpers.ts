import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { getUserRole } from "../../utils/authGuard";

if (!getApps().length) {
  initializeApp();
}

export const db = getFirestore();

export function requireAuth(request: any): string {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesion.");
  }

  return String(request.auth.uid);
}

export async function getRootId(uid: string): Promise<string> {
  const snap = await db.collection("users").doc(uid).get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "Usuario no encontrado.");
  }

  const data = snap.data() || {};
  return String(data.rootId || uid);
}

export async function getMyUser(uid: string): Promise<any> {
  const userSnap = await db.doc(`users/${uid}`).get();

  if (userSnap.exists) {
    return userSnap.data() as any;
  }

  const legacySnap = await db.doc(`usuarios/${uid}`).get();

  if (legacySnap.exists) {
    return legacySnap.data() as any;
  }

  return null;
}

export function requireRole(
  user: any,
  roles: Array<"superadmin" | "admin" | "operador">
): string {
  const role = getUserRole(user);

  if (!roles.includes(role as any)) {
    throw new HttpsError("permission-denied", "No autorizado.");
  }

  return role;
}

export function getActivityAdminId(user: any, uid: string, rootId: string): string {
  const role = getUserRole(user);
  let adminId = uid;

  if (role === "admin") {
    adminId = uid;
  } else if (["operador", "operator"].includes(role)) {
    if (String(user?.parentRole || "") === "admin") {
      adminId = String(user?.parentUserId || "");
    } else {
      adminId = rootId;
    }
  } else {
    adminId = uid;
  }

  return String(adminId || rootId || uid);
}

export function toSafeMoneyNumber(value: any): number {
  const n = Number(value || 0);

  if (!Number.isFinite(n)) {
    return 0;
  }

  return Math.round(n * 100) / 100;
}

export { normalizePagoStatus } from "../pagos/domain";