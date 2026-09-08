import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { logActivity } from "../../utils/logActivity";
import { assertAuthorized, getUserRole } from "../../utils/authGuard";
import { nextSequenceTx } from "../sequences/service";
import { buildDispatchAutomationPatch } from "./domain";
import { db, getActivityAdminId, getMyUser, requireAuth, requireRole } from "../sharedCallables/helpers";





export const saveDespachoCallable = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const callerUid = requireAuth(request);
    const caller = await getMyUser(callerUid);
    requireRole(caller, ["superadmin"]);

    const callerRootId = String((caller as any)?.rootId || callerUid);
    const editingId = String(request.data?.editingId || "").trim();
    const nombre = String(request.data?.nombre || "").trim();
    const requestedAutomationMode = request.data?.automationMode;
    const requestedErpProvider = request.data?.erpProvider;
    const requestedIntegrationProvider = request.data?.integrationProvider; // compatibilidad A2
    const requestedDeliveryChannels = request.data?.deliveryChannels;

    if (nombre.length < 2) {
      throw new HttpsError("invalid-argument", "nombre invalido.");
    }

    const payload: any = {
      rootId: callerRootId,
      nombre,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: callerUid,
    };

    if (editingId) {
      const despachoRef = db.doc(`despachos/${editingId}`);
      const despachoSnap = await despachoRef.get();

      if (!despachoSnap.exists) {
        throw new HttpsError("not-found", "Despacho no existe.");
      }

      const despachoData: any = despachoSnap.data() || {};
      if (despachoData?.rootId && String(despachoData.rootId) !== callerRootId) {
        throw new HttpsError("permission-denied", "Despacho fuera de tu root.");
      }
      const automation = buildDispatchAutomationPatch({
        automationMode: requestedAutomationMode,
        erpProvider: requestedErpProvider,
        integrationProvider: requestedIntegrationProvider,
        deliveryChannels: requestedDeliveryChannels,
        existing: despachoData,
      });
      await despachoRef.set({ ...payload, ...automation }, { merge: true });

      await logActivity({
        event: "DESPACHO_UPDATE",
        rootId: callerRootId,
        adminId: getActivityAdminId(caller, callerUid, callerRootId),
        actorUid: callerUid,
        actorName: String((caller as any)?.email || callerUid),
        actorUsername: String((caller as any)?.username || ""),
        actorRole: String(getUserRole(caller) || ""),
        referenceId: editingId,
        referenceType: "despacho",
        description: `Despacho ${editingId} actualizado`,
      });

      return { updated: true, id: editingId };
    }

    const despachoRef = db.collection("despachos").doc();
    const automation = buildDispatchAutomationPatch({
      automationMode: requestedAutomationMode,
      erpProvider: requestedErpProvider,
      integrationProvider: requestedIntegrationProvider,
      deliveryChannels: requestedDeliveryChannels,
    });
    await despachoRef.set({
      ...payload,
      ...automation,
      active: true,
      createdBy: callerUid,
      createdAt: FieldValue.serverTimestamp(),
    });

    await logActivity({
      event: "DESPACHO_CREATE",
      rootId: callerRootId,
      adminId: getActivityAdminId(caller, callerUid, callerRootId),
      actorUid: callerUid,
      actorName: String((caller as any)?.email || callerUid),
      actorUsername: String((caller as any)?.username || ""),
      actorRole: String(getUserRole(caller) || ""),
      referenceId: despachoRef.id,
      referenceType: "despacho",
      description: `Despacho ${despachoRef.id} creado`,
    });

    return { created: true, id: despachoRef.id };
  }
);

export const setUserDespachos = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const callerUid = requireAuth(request);
    const caller = await getMyUser(callerUid);
    const callerRole = requireRole(caller, ["superadmin", "admin"]);
    assertAuthorized(request.auth, caller, {
      allowedRoles: ["superadmin", "admin"],
      requiredModule: "usuarios",
      requiredAction: "permissions",
    });

    const userId = String(request.data?.userId || "").trim();
    const despachoIds = Array.isArray(request.data?.despachoIds)
      ? request.data.despachoIds.map((x: any) => String(x).trim()).filter(Boolean)
      : [];

    if (!userId) {
      throw new HttpsError("invalid-argument", "userId requerido.");
    }

    const callerRootId = String(caller?.rootId || callerUid);

    const targetSnap = await db.doc(`users/${userId}`).get();
    if (!targetSnap.exists) {
      throw new HttpsError("not-found", "Usuario no existe.");
    }

    const target: any = targetSnap.data() || {};
    const targetRole = String(getUserRole(target) || "");
    const targetRootId = String(target?.rootId || "");
    const targetParentUserId = String(target?.parentUserId || "");

    if (targetRootId && targetRootId !== callerRootId) {
      throw new HttpsError("permission-denied", "Usuario fuera de tu root.");
    }

    if (callerRole === "admin") {
      if (userId === callerUid || targetParentUserId !== callerUid || targetRole !== "operador") {
        throw new HttpsError("permission-denied", "Admin solo puede asignar despachos a sus operadores.");
      }
    }

    const now = FieldValue.serverTimestamp();
    const accessCol = db.collection(`userDespachoAccess/${userId}/despachos`);
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

    for (const despachoId of despachoIds) {
      const despachoSnap = await db.doc(`despachos/${despachoId}`).get();
      if (!despachoSnap.exists) {
        continue;
      }

      const despacho: any = despachoSnap.data() || {};
      const despachoRootId = String(despacho?.rootId || "");

      if (despachoRootId && despachoRootId !== callerRootId) {
        throw new HttpsError("permission-denied", `Despacho fuera de tu root: ${despachoId}`);
      }
      if (despacho?.active === false) {
        throw new HttpsError("failed-precondition", `Despacho inactivo: ${despachoId}`);
      }
      if (callerRole === "admin") {
        const callerDespachoId = String(caller?.despachoId || "");
        const callerAccess = await db.doc(`userDespachoAccess/${callerUid}/despachos/${despachoId}`).get();
        if (callerDespachoId !== despachoId && (!callerAccess.exists || callerAccess.data()?.active !== true)) {
          throw new HttpsError("permission-denied", `Despacho fuera del alcance del admin: ${despachoId}`);
        }
      }

      batch.set(
        db.doc(`userDespachoAccess/${userId}/despachos/${despachoId}`),
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

    return { ok: true, userId, despachoIds };
  }
);


export const toggleDespachoActive = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const callerUid = requireAuth(request);
    const caller = await getMyUser(callerUid);
    assertAuthorized(request.auth, caller, { allowedRoles: ["superadmin"], requiredModule: "despachos", requiredAction: "view" });
    requireRole(caller, ["superadmin"]);

    const despachoId = String(request.data?.despachoId || "").trim();
    const nextActive = Boolean(request.data?.nextActive);

    if (!despachoId) {
      throw new HttpsError("invalid-argument", "despachoId requerido.");
    }

    const despachoRef = db.doc(`despachos/${despachoId}`);
    const despachoSnap = await despachoRef.get();

    if (!despachoSnap.exists) {
      throw new HttpsError("not-found", "Despacho no existe.");
    }

    const despacho: any = despachoSnap.data() || {};
    const callerRootId = String(caller?.rootId || callerUid);
    const despachoRootId = String(despacho?.rootId || "");

    if (despachoRootId && despachoRootId !== callerRootId) {
      throw new HttpsError("permission-denied", "Despacho fuera de tu root.");
    }

    const now = FieldValue.serverTimestamp();
    const batch = db.batch();

    batch.update(despachoRef, {
      active: nextActive,
      updatedAt: now,
      updatedBy: callerUid,
    });

    // F5: si se desactiva el despacho, desactivar empresas relacionadas
    // F7: si se reactiva el despacho, NO reactivar empresas automaticamente
    if (!nextActive) {
      const companiesSnap = await db
        .collection("companies")
        .where("despachoId", "==", despachoId)
        .get();

      companiesSnap.docs.forEach((companyDoc) => {
        batch.set(
          companyDoc.ref,
          {
            active: false,
            updatedAt: now,
            updatedBy: callerUid,
          },
          { merge: true }
        );
      });
    }

    await batch.commit();

    return {
      ok: true,
      despachoId,
      active: nextActive,
      cascadedCompanies: !nextActive,
    };
}
);
