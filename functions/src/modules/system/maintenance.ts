import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logActivity } from "../../utils/logActivity";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const db = getFirestore();

function requireAuth(request: any): string {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "No autenticado.");
  return uid;
}

function normalizeRole(value: unknown): string {
  const role = String(value || "").trim().toLowerCase();
  if (role === "operator") return "operador";
  return role;
}

function buildActivityContext(profile: any, uid: string) {
  const role = normalizeRole(profile?.role || profile?.supervisorRole);
  const rootId = String(profile?.rootId || uid || "");

  let adminId = uid;

  if (role === "admin") {
    adminId = uid;
  } else if (role === "operador") {
    if (String(profile?.parentRole || "") === "admin") {
      adminId = String(profile?.parentUserId || "");
    } else {
      adminId = rootId;
    }
  } else {
    adminId = uid;
  }

  return {
    role,
    rootId,
    adminId: adminId || rootId || uid,
  };
}

export const setMaintenanceMode = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = requireAuth(request);

    const userSnap = await db.doc(`users/${uid}`).get();
    if (!userSnap.exists) {
      throw new HttpsError("permission-denied", "Usuario no existe.");
    }

    const profile: any = userSnap.data() || {};
    const ctx = buildActivityContext(profile, uid);

    if (ctx.role !== "superadmin") {
      throw new HttpsError("permission-denied", "Solo superadmin puede cambiar mantenimiento.");
    }

    const enabled = request.data?.enabled === true;
    const reasonRaw = String(request.data?.reason || "").trim();
    const reason = reasonRaw.slice(0, 200) || (enabled ? "Sistema activo" : "Sistema en mantenimiento");
    const now = FieldValue.serverTimestamp();

    await db.doc("system/publicAccess").set(
      {
        enabled,
        reason,
        updatedAt: now,
        updatedBy: uid,
        updatedByRole: ctx.role,
      },
      { merge: true }
    );

    const eventType = enabled ? "WEB_MAINTENANCE_OFF" : "WEB_MAINTENANCE_ON";
    const description = enabled
      ? "Modo mantenimiento desactivado. Acceso web habilitado."
      : "Modo mantenimiento activado. Acceso web restringido.";

        await logActivity({
      event: eventType,
      rootId: ctx.rootId,
      adminId: ctx.adminId,
      actorUid: uid,
      actorName: String(profile?.displayName || profile?.nombreUsuario || profile?.email || "Superadmin"),
      actorUsername: String(profile?.displayName || profile?.nombreUsuario || profile?.email || "Superadmin"),
      actorRole: ctx.role,
      entityType: "system",
      entityId: "publicAccess",
      referenceId: "system/publicAccess",
      referenceType: "maintenance",
      description,
      createdBy: uid,
      createdByRole: ctx.role,
      extra: {
        module: "system",
        enabled,
        reason,
      },
    });

    return { ok: true, enabled, reason };
  }
);