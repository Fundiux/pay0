import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";

const db = admin.firestore();

export function requireAuthLike(request: any): string {
  const uid = String(request?.auth?.uid || "").trim();

  if (!uid) {
    throw new HttpsError("unauthenticated", "Sesion requerida.");
  }

  return uid;
}

export async function getUser(uid: string): Promise<any | null> {
  const userSnap = await db.collection("users").doc(uid).get();

  if (!userSnap.exists) {
    return null;
  }

  return {
    uid,
    id: uid,
    ...(userSnap.data() || {}),
  };
}

export function getRole(user: any): string {
  return String(user?.role || "").trim().toLowerCase();
}

export function getRootIdFromUser(user: any, uid: string): string {
  return String(user?.rootId || uid || "").trim();
}

export function getUsername(user: any, uid: string): string {
  return String(
    user?.username ||
    user?.displayName ||
    user?.name ||
    user?.email ||
    uid ||
    "usuario"
  ).trim();
}