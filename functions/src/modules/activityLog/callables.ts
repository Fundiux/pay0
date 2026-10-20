import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { assertAuthorized, getUserRole } from "../../utils/authGuard";
import { logActivity } from "../../utils/logActivity";
import { getActivityAdminId, getMyUser, requireAuth } from "../sharedCallables/helpers";
import { createHash } from "crypto";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

function cleanText(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function pickFirst(...values: unknown[]): string {
  for (const value of values) {
    const clean = cleanText(value);
    if (clean) return clean;
  }
  return "";
}

function getAuthActorName(user: any, request: any, uid: string): string {
  return pickFirst(
    user?.username,
    user?.displayName,
    user?.nombreUsuario,
    user?.name,
    user?.email,
    request.auth?.token?.email,
    request.data?.actorName,
    uid
  );
}

function hashUnlockCode(uid: string, code: string): string {
  return createHash("sha256").update(`${uid}:${cleanText(code).toUpperCase()}`, "utf8").digest("hex");
}

export const logAuthEventCallable = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const callerUid = requireAuth(request);
    const caller = await getMyUser(callerUid);

    const event = cleanText(request.data?.event).toUpperCase();
    if (event !== "LOGIN" && event !== "LOGOUT") {
      throw new HttpsError("invalid-argument", "Evento auth invalido.");
    }

    const rootId = cleanText((caller as any)?.rootId) || callerUid;
    const adminId = getActivityAdminId(caller, callerUid, rootId);
    if (!adminId) {
      throw new HttpsError("failed-precondition", "adminId no resuelto.");
    }

    const actorName = getAuthActorName(caller, request, callerUid);
    const actorUsername = pickFirst((caller as any)?.username, actorName, callerUid);
    const actorRole = pickFirst(getUserRole(caller), (caller as any)?.role, "unknown");

    await logActivity({
      event,
      rootId,
      adminId,
      actorUid: callerUid,
      actorName,
      actorUsername,
      actorRole,
      referenceId: callerUid,
      referenceType: "auth",
      description:
        event === "LOGIN"
          ? `Inicio de sesion: ${actorName}`
          : `Cierre de sesion: ${actorName}`,
    });

    return { ok: true, event };
  }
);

// Browser reports are untrusted observations, never authority to restrict an account.
// One record per actor/minute bounds storage independently of client-controlled paths.
export const logUnauthorizedRouteAttempt = onCall(
  { cors: true, timeoutSeconds: 30, memory: "256MiB", secrets: [] },
  async (request) => {
    const callerUid = requireAuth(request);
    const caller = await getMyUser(callerUid);
    assertAuthorized(request.auth, caller);
    const rawPath = cleanText(request.data?.path || request.data?.pathname || request.data?.attemptedPath);
    if (!rawPath.startsWith("/") || rawPath.startsWith("//")) {
      throw new HttpsError("invalid-argument", "Ruta local requerida.");
    }
    // Hash the local path and discard query/fragment/URLs: tokens can also appear in path segments.
    const path = rawPath.split(/[?#]/, 1)[0].slice(0, 300);
    const rootId = cleanText(caller?.rootId) || callerUid;
    const minuteBucket = Math.floor(Date.now() / 60000);
    const actorKey = createHash("sha256").update(callerUid).digest("hex");
    const reportId = `client_route_${actorKey}_${minuteBucket}`;
    const reportRef = db.collection("securityClientReports").doc(reportId);
    const recorded = await db.runTransaction(async (tx) => {
      const existing = await tx.get(reportRef);
      if (existing.exists) return false;
      tx.create(reportRef, {
        rootId,
        uid: callerUid,
        pathHash: createHash("sha256").update(path).digest("hex"),
        origin: "CLIENT_REPORTED",
        verified: false,
        event: "ROUTE_ACCESS_REPORTED",
        policyVersion: "PAY0-CLIENT-REPORT@1",
        decision: "OBSERVE_ONLY",
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 7 * 86400000),
      });
      return true;
    });
    return { ok: true, reportId, deduped: !recorded, restricted: false };
  }
);

export const redeemMySecurityUnlockCode = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const callerUid = requireAuth(request);
    const code = cleanText(request.data?.code).toUpperCase();
    if (!code) throw new HttpsError("invalid-argument", "Codigo requerido.");

    const userRef = db.doc(`users/${callerUid}`);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists) throw new HttpsError("not-found", "Usuario no existe.");
      const user: any = snap.data() || {};
      const lock = user?.securityLock || {};
      if (lock?.active !== true) throw new HttpsError("failed-precondition", "El usuario no esta bloqueado.");
      if (lock?.unlockCodeUsedAt) throw new HttpsError("failed-precondition", "El codigo ya fue utilizado.");
      if (cleanText(lock?.unlockCodeHash) !== hashUnlockCode(callerUid, code)) {
        throw new HttpsError("permission-denied", "Codigo de desbloqueo incorrecto.");
      }
      tx.set(userRef, {
        securityLock: {
          ...lock,
          active: false,
          unlockCodeHash: null,
          unlockCodeUsedAt: FieldValue.serverTimestamp(),
          unlockedAt: FieldValue.serverTimestamp(),
          unlockedBy: "SELF_ONE_TIME_CODE",
        },
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    return { ok: true };
  }
);
