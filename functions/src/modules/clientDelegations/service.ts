import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";
import { getUserRole, normalizeRole } from "../../utils/authGuard";
import type { ClientDelegationConfigItem } from "./types";
import { normalizeClientAccessPermissions } from "./access";

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

type Role = "superadmin" | "admin" | "operador" | "";

function requireAuth(request: any) {
  const uid = String(request?.auth?.uid || "").trim();

  if (!uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesion.");
  }

  return uid;
}

async function getUserOrThrow(uid: string) {
  const snap = await db.doc(`users/${uid}`).get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "Usuario no existe.");
  }

  return snap.data() as any;
}

function getRootId(uid: string, user: any) {
  return String(user?.rootId || uid).trim();
}

function getClientName(clientId: string, client: any) {
  return String(
    client?.name ||
    client?.nombreComercial ||
    client?.nombre ||
    client?.razonSocial ||
    clientId
  ).trim();
}

function getClientNumber(client: any) {
  const n = Number(client?.clientNumber ?? client?.numeroCliente ?? client?.sequenceNumber ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function assertTargetAllowed(params: {
  callerUid: string;
  caller: any;
  callerRole: Role;
  targetUid: string;
  target: any;
}) {
  const { callerUid, caller, callerRole, targetUid, target } = params;

  if (targetUid === callerUid) {
    throw new HttpsError("failed-precondition", "No necesitas delegarte clientes a ti mismo.");
  }

  const targetRole = normalizeRole(target?.role ?? target?.supervisorRole) as Role;

  if (targetRole === "superadmin") {
    throw new HttpsError("permission-denied", "No se delegan clientes a superadmin.");
  }

  if (callerRole !== "superadmin" && callerRole !== "admin") {
    throw new HttpsError("permission-denied", "Tu rol no puede delegar clientes.");
  }

  const callerRootId = getRootId(callerUid, caller);
  const targetRootId = getRootId(targetUid, target);

  if (callerRootId !== targetRootId) {
    throw new HttpsError("permission-denied", "Usuario objetivo fuera de tu root.");
  }
}

async function hasActiveDelegation(uid: string, clientId: string) {
  const snap = await db.doc(`userClientAccess/${uid}/clients/${clientId}`).get();

  if (!snap.exists) return false;

  const data: any = snap.data() || {};
  return data.active === true && data?.permissions?.operate === true;
}

async function canCallerGrantClient(params: {
  callerUid: string;
  callerRole: Role;
  callerRootId: string;
  clientId: string;
  client: any;
}) {
  const { callerUid, callerRole, callerRootId, clientId, client } = params;

  const clientRootId = String(client?.rootId || "").trim();

  if (clientRootId && clientRootId !== callerRootId) {
    return false;
  }

  if (callerRole === "superadmin") {
    return true;
  }

  if (callerRole !== "admin") {
    return false;
  }

  const adminId = String(client?.adminId || "").trim();
  const ownerId = String(client?.ownerId || "").trim();
  const managedByUserId = String(client?.managedByUserId || "").trim();
  const createdBy = String(client?.createdBy || "").trim();
  const operadorId = String(client?.operadorId || "").trim();

  const direct =
    adminId === callerUid ||
    ownerId === callerUid ||
    managedByUserId === callerUid ||
    createdBy === callerUid ||
    operadorId === callerUid;

  if (direct) {
    return true;
  }

  return hasActiveDelegation(callerUid, clientId);
}

async function getCallerContext(request: any, targetUid: string) {
  const callerUid = requireAuth(request);
  const caller = await getUserOrThrow(callerUid);
  assertAuthorized(request.auth, caller, { allowedRoles: ["superadmin", "admin"], requiredModule: "usuarios", requiredAction: "clientDelegations" });
  const callerRole = getUserRole(caller) as Role;

  if (callerRole !== "superadmin" && callerRole !== "admin") {
    throw new HttpsError("permission-denied", "Tu rol no puede delegar clientes.");
  }

  const target = await getUserOrThrow(targetUid);

  assertTargetAllowed({
    callerUid,
    caller,
    callerRole,
    targetUid,
    target,
  });

  return {
    callerUid,
    caller,
    callerRole,
    callerRootId: getRootId(callerUid, caller),
    target,
  };
}


type IncomingClientAccessItem = {
  clientId: string;
  active: boolean;
  permissions: any;
  mode: "PERMANENT" | "TEMPORARY";
  startsAt: any | null;
  expiresAt: any | null;
  grantReason: string | null;
};

function cleanString(value: any) {
  return String(value || "").trim();
}

function cleanMode(value: any): "PERMANENT" | "TEMPORARY" {
  return cleanString(value).toUpperCase() === "TEMPORARY" ? "TEMPORARY" : "PERMANENT";
}

function cleanReason(value: any) {
  const text = cleanString(value);
  return text ? text.slice(0, 500) : null;
}

function normalizeIncomingPermissions(raw: any, active: boolean) {
  const legacy = normalizeClientAccessPermissions(raw || {}, active);

  if (!active) {
    return normalizeClientAccessPermissions(
      {
        view: false,
        operate: false,
        viewBasic: false,
        operateSolicitudes: false,
        operatePagos: false,
        operateBeneficiarios: false,
        operateDispersiones: false,
        viewBalanceInDispersion: false,
        requestDispersionIncidents: false,
        commentDispersionNotes: false,
      },
      false
    );
  }

  return {
    view: legacy.view,
    operate: legacy.operate,
    viewBasic: legacy.viewBasic,
    operateSolicitudes: legacy.operateSolicitudes,
    operatePagos: legacy.operatePagos,
    operateBeneficiarios: legacy.operateBeneficiarios,
    operateDispersiones: legacy.operateDispersiones,
    viewBalanceInDispersion: legacy.viewBalanceInDispersion,
    requestDispersionIncidents: legacy.requestDispersionIncidents,
    commentDispersionNotes: legacy.commentDispersionNotes,
  };
}

function normalizeIncomingClientAccessItems(data: any): IncomingClientAccessItem[] {
  const rawItems = Array.isArray(data?.accessItems)
    ? data.accessItems
    : Array.isArray(data?.items)
      ? data.items
      : null;

  const map = new Map<string, IncomingClientAccessItem>();

  if (rawItems) {
    rawItems.forEach((item: any) => {
      const clientId = cleanString(item?.clientId || item?.id);
      if (!clientId) return;

      const active = item?.active !== false;
      const mode = cleanMode(item?.mode);
      const expiresAt = item?.expiresAt || null;

      if (mode === "TEMPORARY" && !expiresAt) {
        throw new HttpsError(
          "invalid-argument",
          `La delegacion temporal requiere expiresAt para cliente ${clientId}.`
        );
      }

      map.set(clientId, {
        clientId,
        active,
        permissions: normalizeIncomingPermissions(item?.permissions || {}, active),
        mode,
        startsAt: item?.startsAt || null,
        expiresAt,
        grantReason: cleanReason(item?.grantReason),
      });
    });

    return Array.from(map.values());
  }

  const clientIds: string[] = Array.from(
    new Set<string>(
      (Array.isArray(data?.clientIds) ? data.clientIds : [])
        .map((x: any): string => cleanString(x))
        .filter((x: string) => Boolean(x))
    )
  );

  clientIds.forEach((clientId) => {
    map.set(clientId, {
      clientId,
      active: true,
      permissions: normalizeIncomingPermissions({ view: true, operate: true }, true),
      mode: "PERMANENT",
      startsAt: null,
      expiresAt: null,
      grantReason: null,
    });
  });

  return Array.from(map.values());
}

function hasAnyEffectivePermission(permissions: any) {
  return (
    permissions?.view === true ||
    permissions?.operate === true ||
    permissions?.viewBasic === true ||
    permissions?.operateSolicitudes === true ||
    permissions?.operatePagos === true ||
    permissions?.operateBeneficiarios === true ||
    permissions?.operateDispersiones === true ||
    permissions?.viewBalanceInDispersion === true ||
    permissions?.requestDispersionIncidents === true ||
    permissions?.commentDispersionNotes === true
  );
}
export async function getUserClientAccessConfigService(request: any) {
  const targetUid = String(request.data?.targetUid || request.data?.uid || "").trim();

  if (!targetUid) {
    throw new HttpsError("invalid-argument", "targetUid requerido.");
  }

  const ctx = await getCallerContext(request, targetUid);

  const accessSnap = await db.collection(`userClientAccess/${targetUid}/clients`).get();
  const current = new Map<string, any>();

  accessSnap.docs.forEach((doc) => {
    current.set(doc.id, doc.data() || {});
  });

  const clientsSnap = await db
    .collection("clients")
    .where("rootId", "==", ctx.callerRootId)
    .get();

  const clients: ClientDelegationConfigItem[] = [];

  for (const doc of clientsSnap.docs) {
    const client: any = doc.data() || {};

    if (client.active === false) {
      continue;
    }

    const canGrant = await canCallerGrantClient({
      callerUid: ctx.callerUid,
      callerRole: ctx.callerRole,
      callerRootId: ctx.callerRootId,
      clientId: doc.id,
      client,
    });

    if (!canGrant) {
      continue;
    }

    const access = current.get(doc.id) || {};
    const active = access.active === true;

    const permissions = normalizeClientAccessPermissions(access?.permissions || {}, active);

    clients.push({
      clientId: doc.id,
      clientName: getClientName(doc.id, client),
      clientNumber: getClientNumber(client),
      active,
      permissions,
      mode: access?.mode === "TEMPORARY" ? "TEMPORARY" : "PERMANENT",
      startsAt: access?.startsAt || null,
      expiresAt: access?.expiresAt || null,
      revokedAt: access?.revokedAt || null,
      revokedBy: String(access?.revokedBy || "").trim() || null,
      grantReason: String(access?.grantReason || "").trim() || null,
      adminId: String(client?.adminId || "").trim() || null,
      ownerId: String(client?.ownerId || "").trim() || null,
      managedByUserId: String(client?.managedByUserId || "").trim() || null,
      createdBy: String(client?.createdBy || "").trim() || null,
    });
  }

  clients.sort((a, b) => {
    const an = String(a.clientName || "");
    const bn = String(b.clientName || "");
    return an.localeCompare(bn);
  });

  return {
    ok: true,
    targetUid,
    clients,
  };
}

export async function setUserClientAccessService(request: any) {
  const targetUid = String(request.data?.targetUid || request.data?.uid || "").trim();

  if (!targetUid) {
    throw new HttpsError("invalid-argument", "targetUid requerido.");
  }

  const accessItems = normalizeIncomingClientAccessItems(request.data || {});
  const activeItems = accessItems.filter((item) => item.active === true);

  if (accessItems.length > 200) {
    throw new HttpsError("invalid-argument", "Maximo 200 clientes por usuario.");
  }

  for (const item of activeItems) {
    if (!hasAnyEffectivePermission(item.permissions)) {
      throw new HttpsError(
        "invalid-argument",
        `El cliente ${item.clientId} no tiene permisos efectivos.`
      );
    }
  }

  const ctx = await getCallerContext(request, targetUid);

  const now = FieldValue.serverTimestamp();
  const accessCol = db.collection(`userClientAccess/${targetUid}/clients`);
  const currentSnap = await accessCol.get();
  const batch = db.batch();

  currentSnap.docs.forEach((doc) => {
    batch.set(
      doc.ref,
      {
        active: false,
        updatedAt: now,
        updatedBy: ctx.callerUid,
      },
      { merge: true }
    );
  });

  for (const item of activeItems) {
    const clientId = item.clientId;
    const clientSnap = await db.doc(`clients/${clientId}`).get();

    if (!clientSnap.exists) {
      continue;
    }

    const client: any = clientSnap.data() || {};

    const canGrant = await canCallerGrantClient({
      callerUid: ctx.callerUid,
      callerRole: ctx.callerRole,
      callerRootId: ctx.callerRootId,
      clientId,
      client,
    });

    if (!canGrant) {
      throw new HttpsError("permission-denied", `No puedes delegar este cliente: ${clientId}`);
    }

    const clientAdminId = String(client?.adminId || "").trim();
    const clientOwnerId = String(client?.ownerId || "").trim();
    const clientManagedByUserId = String(client?.managedByUserId || "").trim();
    const clientCreatedBy = String(client?.createdBy || "").trim();

    batch.set(
      db.doc(`userClientAccess/${targetUid}/clients/${clientId}`),
      {
        active: true,
        rootId: ctx.callerRootId,
        targetUid,
        clientId,
        clientName: getClientName(clientId, client),
        clientNumber: getClientNumber(client),
        adminId: clientAdminId || null,
        ownerId: clientOwnerId || null,
        managedByUserId: clientManagedByUserId || null,
        originalCreatedBy: clientCreatedBy || null,
        permissions: item.permissions,
        mode: item.mode,
        startsAt: item.startsAt || null,
        expiresAt: item.expiresAt || null,
        revokedAt: null,
        revokedBy: null,
        grantReason: item.grantReason,
        grantedBy: ctx.callerUid,
        updatedAt: now,
        updatedBy: ctx.callerUid,
        createdAt: now,
        createdBy: ctx.callerUid,
      },
      { merge: true }
    );
  }

  await batch.commit();

  const clientIds = activeItems.map((item) => item.clientId);

  return {
    ok: true,
    targetUid,
    clientIds,
    count: clientIds.length,
    accessItems: activeItems.map((item) => ({
      clientId: item.clientId,
      active: item.active,
      permissions: item.permissions,
      mode: item.mode,
      startsAt: item.startsAt,
      expiresAt: item.expiresAt,
      grantReason: item.grantReason,
    })),
  };
}
