import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { getUserRole } from "../../utils/authGuard";
import { logActivity } from "../../utils/logActivity";
import { getActivityAdminId, getMyUser, requireAuth } from "../sharedCallables/helpers";
import { sendTelegramMessage } from "../telegram/service";
import { createHash } from "crypto";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const TELEGRAM_BOT_TOKEN = defineSecret("TELEGRAM_BOT_TOKEN");

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

function shortHash(value: string): string {
  return Buffer.from(value || "", "utf8")
    .toString("base64url")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 80);
}

function createSecurityIncidentCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let value = "HS-";
  for (let i = 0; i < 6; i += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return value;
}

function createOneTimeUnlockCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let value = "";
  for (let i = 0; i < 8; i += 1) value += alphabet[Math.floor(Math.random() * alphabet.length)];
  return value;
}

function hashUnlockCode(uid: string, code: string): string {
  return createHash("sha256").update(`${uid}:${cleanText(code).toUpperCase()}`, "utf8").digest("hex");
}

async function sendSecurityTelegramAlert(input: {
  rootId: string;
  text: string;
  statusRefs: FirebaseFirestore.DocumentReference[];
}): Promise<void> {
  try {
    const linkedSnap = await db
      .collection("telegramUsers")
      .where("uid", "==", input.rootId)
      .where("active", "==", true)
      .limit(10)
      .get();

    const chatIds = Array.from(new Set(
      linkedSnap.docs
        .map((doc) => cleanText(doc.data()?.chatId))
        .filter(Boolean)
    ));

    let sentCount = 0;

    for (const chatId of chatIds) {
      await sendTelegramMessage(TELEGRAM_BOT_TOKEN.value(), chatId, input.text.slice(0, 3900));
      sentCount += 1;
    }

    const statusPatch = {
        telegramStatus: sentCount > 0 ? "SENT" : "SKIPPED_NO_CHAT",
        telegramSentCount: sentCount,
        telegramSentAt: sentCount > 0 ? FieldValue.serverTimestamp() : null,
        updatedAt: FieldValue.serverTimestamp(),
    };
    await Promise.all(input.statusRefs.map((ref) => ref.set(statusPatch, { merge: true })));
  } catch (error: any) {
    const errorPatch = {
        telegramStatus: "ERROR",
        telegramError: cleanText(error?.message || error),
        updatedAt: FieldValue.serverTimestamp(),
    };
    await Promise.all(input.statusRefs.map((ref) => ref.set(errorPatch, { merge: true }).catch(() => undefined)));
  }
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

export const logUnauthorizedRouteAttempt = onCall(
  {
    cors: true,
    timeoutSeconds: 60,
    memory: "256MiB",
    secrets: [TELEGRAM_BOT_TOKEN],
  },
  async (request) => {
    const callerUid = requireAuth(request);
    const caller = await getMyUser(callerUid);

    if (!caller) {
      throw new HttpsError("permission-denied", "Usuario PAY0 no encontrado.");
    }

    // H4_D85_A10_A20_SUPERADMIN_SECURITY_BYPASS
    const callerRoleForRouteSecurity = cleanText(
      getUserRole(caller),
    ).toLowerCase();

    if (callerRoleForRouteSecurity === "superadmin") {
      return {
        ok: true,
        bypassed: true,
        role: "superadmin",
        message: "Superadministrador autorizado sin bloqueo de ruta.",
      };
    }

    const path = cleanText(
      request.data?.path ||
      request.data?.pathname ||
      request.data?.attemptedPath
    ).slice(0, 300);

    if (!path) {
      throw new HttpsError("invalid-argument", "path requerido.");
    }

    const rootId = cleanText((caller as any)?.rootId) || callerUid;
    const adminId = getActivityAdminId(caller, callerUid, rootId);
    const actorName = getAuthActorName(caller, request, callerUid);
    const actorUsername = pickFirst((caller as any)?.username, actorName, callerUid);
    const actorRole = pickFirst(getUserRole(caller), (caller as any)?.role, "unknown");
    const userNumber = Number((caller as any)?.userNumber ?? (caller as any)?.numeroUsuario ?? (caller as any)?.sequenceNumber ?? 0);
    const userFolio = Number.isFinite(userNumber) && userNumber > 0
      ? `U${String(userNumber).padStart(2, "0")}`
      : "Usuario sin folio";

    const matchedRuleHref = cleanText(request.data?.matchedRuleHref).slice(0, 300);
    const requiredModule = cleanText(request.data?.requiredModule).slice(0, 80);
    const requiredAction = cleanText(request.data?.requiredAction).slice(0, 80);
    const superadminOnly = request.data?.superadminOnly === true;
    const userAgent = cleanText(request.data?.userAgent).slice(0, 500);
    const referrer = cleanText(request.data?.referrer).slice(0, 500);
    const locationHref = cleanText(request.data?.locationHref).slice(0, 500);

    const minuteBucket = Math.floor(Date.now() / 60000);
    const alertId = `unauthorized_route_${callerUid}_${shortHash(path)}_${minuteBucket}`;
    const notificationId = `unauthorized_route_${callerUid}_${shortHash(path)}_${minuteBucket}`;

    const alertRef = db.collection("securityAlerts").doc(alertId);
    const notificationRef = db.collection("userNotifications").doc(notificationId);

    const existingAlert = await alertRef.get();
    if (existingAlert.exists && cleanText(existingAlert.data()?.telegramStatus) === "SENT") {
      return {
        ok: true,
        deduped: true,
        alertId,
        message: "Intento no autorizado ya reportado en esta ventana.",
      };
    }

    const existingLock = (caller as any)?.securityLock || {};
    const incidentCode = cleanText(existingLock?.active === true ? existingLock?.incidentCode : "") || createSecurityIncidentCode();
    const unlockCode = createOneTimeUnlockCode();
    const permissionLabel = requiredAction || (superadminOnly ? "Solo superadmin" : "Acceso al modulo");

    const message = [
      "HUGO SANCHEZ | ACCESO BLOQUEADO",
      "",
      `Usuario: ${userFolio} - ${actorName}`,
      `Rol: ${actorRole || "N/D"}`,
      `Ruta: ${path}`,
      requiredModule ? `Modulo: ${requiredModule}` : "",
      `Permiso faltante: ${permissionLabel}`,
      `Incidente: ${incidentCode}`,
      `Codigo desbloqueo: ${unlockCode}`,
    ].filter(Boolean).join("\n");

    await db.doc(`users/${callerUid}`).set(
      {
        securityLock: {
          active: true,
          incidentCode,
          unlockCodeHash: hashUnlockCode(callerUid, unlockCode),
          unlockCodeUsedAt: null,
          reason: "UNAUTHORIZED_ROUTE_ATTEMPT",
          path,
          requiredModule: requiredModule || null,
          requiredAction: requiredAction || null,
          lockedAt: FieldValue.serverTimestamp(),
          alertId,
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await alertRef.set(
      {
        rootId,
        uid: callerUid,
        actorName,
        actorUsername,
        actorRole,
        path,
        matchedRuleHref: matchedRuleHref || null,
        requiredModule: requiredModule || null,
        requiredAction: requiredAction || null,
        incidentCode,
        unlockCode,
        superadminOnly,
        userAgent: userAgent || null,
        referrer: referrer || null,
        locationHref: locationHref || null,
        status: "OPEN",
        severity: "warning",
        event: "UNAUTHORIZED_ROUTE_ATTEMPT",
        telegramStatus: "PENDING",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await notificationRef.set(
      {
        rootId,
        uid: rootId,
        audience: "superadmin",
        audienceRole: "superadmin",
        module: "security",
        event: "UNAUTHORIZED_ROUTE_ATTEMPT",
        title: "Intento de acceso no autorizado",
        message,
        read: false,
        source: "RouteAccessGuard",
        referenceId: callerUid,
        referenceType: "user",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await logActivity({
      event: "UNAUTHORIZED_ROUTE_ATTEMPT",
      rootId,
      adminId,
      actorUid: callerUid,
      actorName,
      actorUsername,
      actorRole,
      referenceId: callerUid,
      referenceType: "user",
      entityId: path,
      entityType: "route",
      description: `Intento de acceso no autorizado a ${path} por ${actorName}`,
      extra: {
        path,
        matchedRuleHref: matchedRuleHref || null,
        requiredModule: requiredModule || null,
        requiredAction: requiredAction || null,
        superadminOnly,
      },
    });

    await sendSecurityTelegramAlert({
      rootId,
      text: message,
      statusRefs: [notificationRef, alertRef],
    });

    return {
      ok: true,
      alertId,
      notificationId,
      incidentCode,
      message: "Intento no autorizado registrado.",
    };
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
