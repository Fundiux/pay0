import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { assertAuthorized, getUserRole, normalizeRole } from "../../utils/authGuard";

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

function assertCanManageTargetUser(params: {
  callerUid: string;
  caller: any;
  role: "superadmin" | "admin" | "operador" | "";
  targetUid: string;
  target: any;
  actionLabel: string;
  allowSameUser?: boolean;
  forbidSuperadminTarget?: boolean;
}) {
  const {
    callerUid,
    caller,
    role,
    targetUid,
    target,
    actionLabel,
    allowSameUser = false,
    forbidSuperadminTarget = false,
  } = params;

  const targetRole = normalizeRole(target?.role ?? target?.supervisorRole);

  if (!allowSameUser && targetUid === callerUid) {
    throw new HttpsError("failed-precondition", `No puedes ${actionLabel}te a ti mismo.`);
  }

  if (role === "admin") {
    if (String(target?.parentUserId || "") !== callerUid) {
      throw new HttpsError(
        "permission-denied",
        `Admin solo puede ${actionLabel} sus operadores.`
      );
    }

    if (targetRole !== "operador") {
      throw new HttpsError(
        "permission-denied",
        `Admin solo puede ${actionLabel} operadores.`
      );
    }

    return;
  }

  const rootId = String(caller?.rootId || callerUid);

  if (String(target?.rootId || "") !== rootId) {
    throw new HttpsError("permission-denied", "Fuera de tu root.");
  }

  if (forbidSuperadminTarget && targetRole === "superadmin") {
    throw new HttpsError(
      "permission-denied",
      `No puedes ${actionLabel} superadmins.`
    );
  }
}

export const softDeleteUser = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const callerUid = requireAuth(request);
    const caller = await getMyUser(callerUid);
    assertAuthorized(request.auth, caller, { allowedRoles: ["superadmin", "admin"], requiredModule: "usuarios", requiredAction: "activate" });
    const role = requireRole(caller, ["admin", "superadmin"]);

    const targetUid = String(request.data?.uid || "");
    if (!targetUid) throw new HttpsError("invalid-argument", "uid requerido");

    if (targetUid === callerUid) {
      throw new HttpsError("failed-precondition", "No puedes eliminarte a ti mismo.");
    }

    const targetSnap = await db.doc(`users/${targetUid}`).get();
    if (!targetSnap.exists) throw new HttpsError("not-found", "Usuario no existe");

    const target: any = targetSnap.data() || {};

    assertCanManageTargetUser({
      callerUid,
      caller,
      role,
      targetUid,
      target,
      actionLabel: "eliminar",
      allowSameUser: false,
      forbidSuperadminTarget: true,
    });

    const now = FieldValue.serverTimestamp();

    await db.doc(`users/${targetUid}`).set(
      {
        isDeleted: true,
        isActive: false,
        deletedAt: now,
        deletedBy: callerUid,
        updatedAt: now,
        updatedBy: callerUid,
      },
      { merge: true }
    );

    try {
      await admin.auth().updateUser(targetUid, { disabled: true });
    } catch (e) {
      // noop
    }

    return { ok: true, uid: targetUid, isDeleted: true };
  }
);

export const restoreUser = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const callerUid = requireAuth(request);
    const caller = await getMyUser(callerUid);
    assertAuthorized(request.auth, caller, { allowedRoles: ["superadmin", "admin"], requiredModule: "usuarios", requiredAction: "activate" });
    const role = requireRole(caller, ["admin", "superadmin"]);

    const targetUid = String(request.data?.uid || "");
    if (!targetUid) throw new HttpsError("invalid-argument", "uid requerido");

    const targetSnap = await db.doc(`users/${targetUid}`).get();
    if (!targetSnap.exists) throw new HttpsError("not-found", "Usuario no existe");

    const target: any = targetSnap.data() || {};

    assertCanManageTargetUser({
      callerUid,
      caller,
      role,
      targetUid,
      target,
      actionLabel: "reactivar",
      allowSameUser: true,
      forbidSuperadminTarget: true,
    });

    const now = FieldValue.serverTimestamp();

    await db.doc(`users/${targetUid}`).set(
      {
        isDeleted: false,
        isActive: true,
        deletedAt: null,
        deletedBy: null,
        restoredAt: now,
        restoredBy: callerUid,
        updatedAt: now,
        updatedBy: callerUid,
      },
      { merge: true }
    );

    try {
      await admin.auth().updateUser(targetUid, { disabled: false });
    } catch (e) {
      // noop
    }

    return { ok: true, uid: targetUid, isDeleted: false, isActive: true };
  }
);

export const setUserCompanyAccess = onCall(
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
    const companyIds = Array.isArray(request.data?.companyIds)
      ? request.data.companyIds.map((x: any) => String(x).trim()).filter(Boolean)
      : [];

    if (!targetUid) {
      throw new HttpsError("invalid-argument", "targetUid requerido.");
    }

    const targetSnap = await db.doc(`users/${targetUid}`).get();
    if (!targetSnap.exists) {
      throw new HttpsError("not-found", "Usuario objetivo no existe.");
    }

    const target: any = targetSnap.data() || {};
    const targetRole = normalizeRole(target.role ?? target.supervisorRole);
    const callerRootId = String(caller?.rootId || callerUid);
    const targetRootId = String(target?.rootId || "");

    if (callerRole === "admin") {
      if (String(target?.parentUserId || "") !== callerUid) {
        throw new HttpsError("permission-denied", "Admin solo puede editar empresas de sus operadores.");
      }
      if (targetRole !== "operador") {
        throw new HttpsError("permission-denied", "Admin solo puede editar empresas de operadores.");
      }
    } else {
      if (targetRootId !== callerRootId && targetUid !== callerUid) {
        throw new HttpsError("permission-denied", "Usuario fuera de tu root.");
      }
    }

    const now = FieldValue.serverTimestamp();
    const accessCol = db.collection(`userCompanyAccess/${targetUid}/companies`);
    const currentSnap = await accessCol.get();

    const batch = db.batch();

    currentSnap.docs.forEach((d) => {
      batch.set(
        d.ref,
        {
          active: false,
          updatedAt: now,
          updatedBy: callerUid,
        },
        { merge: true }
      );
    });

    for (const companyId of companyIds) {
      const companySnap = await db.doc(`companies/${companyId}`).get();
      if (!companySnap.exists) {
        continue;
      }

      const company: any = companySnap.data() || {};
      const companyRootId = String(company?.rootId || "");

      if (companyRootId && companyRootId !== callerRootId) {
        throw new HttpsError("permission-denied", `Empresa fuera de tu root: ${companyId}`);
      }
      if (company?.active === false) {
        throw new HttpsError("failed-precondition", `Empresa inactiva: ${companyId}`);
      }

      const companyDespachoId = String(company?.despachoId || "").trim();
      if (!companyDespachoId) {
        throw new HttpsError("failed-precondition", `Empresa sin despacho: ${companyId}`);
      }
      const despachoSnap = await db.doc(`despachos/${companyDespachoId}`).get();
      if (!despachoSnap.exists || despachoSnap.data()?.active === false) {
        throw new HttpsError("failed-precondition", `Despacho inexistente o inactivo para empresa: ${companyId}`);
      }
      const dispatchCompany = await db.doc(`dispatchCompanyAccess/${companyDespachoId}/companies/${companyId}`).get();
      if (!dispatchCompany.exists || dispatchCompany.data()?.active !== true) {
        throw new HttpsError("failed-precondition", `Empresa no habilitada en su despacho: ${companyId}`);
      }
      const targetDespachoId = String(target?.despachoId || "").trim();
      const targetDespachoAccess = await db.doc(`userDespachoAccess/${targetUid}/despachos/${companyDespachoId}`).get();
      if (targetDespachoId !== companyDespachoId && (!targetDespachoAccess.exists || targetDespachoAccess.data()?.active !== true)) {
        throw new HttpsError("failed-precondition", `Usuario sin acceso al despacho de la empresa: ${companyId}`);
      }

      batch.set(
        db.doc(`userCompanyAccess/${targetUid}/companies/${companyId}`),
        {
          active: true,
          updatedAt: now,
          updatedBy: callerUid,
          createdAt: now,
          createdBy: callerUid,
        },
        { merge: true }
      );
    }

    await batch.commit();

    return { ok: true, targetUid, companyIds };
  }
);
