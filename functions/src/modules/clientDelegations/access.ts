import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();

export type ClientAccessRole = "superadmin" | "admin" | "operador" | "";

export type ClientAccessSource = "SUPERADMIN" | "DIRECT" | "DELEGATED" | "DENIED";

export type ClientAccessPermissionKey =
  | "viewBasic"
  | "operateSolicitudes"
  | "operatePagos"
  | "operateBeneficiarios"
  | "operateDispersiones"
  | "viewBalanceInDispersion"
  | "requestDispersionIncidents"
  | "commentDispersionNotes";

export type ClientAccessPermissions = Record<ClientAccessPermissionKey, boolean> & {
  view: boolean;
  operate: boolean;
};

export type ResolvedClientAccess = {
  uid: string;
  role: ClientAccessRole;
  rootId: string;
  clientId: string;
  allowed: boolean;
  source: ClientAccessSource;
  client: any | null;
  clientPath: string | null;
  delegationPath: string | null;
  delegationId: string | null;
  delegation: any | null;
  permissions: ClientAccessPermissions;
  economicOwnerAdminId: string | null;
  economicOwnerOperadorId: string | null;
  clientOwnerId: string | null;
  clientManagedByUserId: string | null;
  reason: string | null;
};

export type ResolveClientAccessParams = {
  uid: string;
  role: ClientAccessRole;
  rootId: string;
  clientId: string;
  client?: any | null;
};

export type RequireClientAccessParams = ResolveClientAccessParams & {
  permission: "view" | "operate" | ClientAccessPermissionKey;
  errorMessage?: string;
};

function cleanId(value: any) {
  return String(value || "").trim();
}

function toMillis(value: any): number | null {
  if (!value) return null;

  if (typeof value?.toMillis === "function") {
    const n = Number(value.toMillis());
    return Number.isFinite(n) ? n : null;
  }

  if (typeof value?.seconds === "number") {
    return value.seconds * 1000;
  }

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isExpired(value: any) {
  const ms = toMillis(value);
  return ms !== null && ms > 0 && ms < Date.now();
}

function buildDefaultPermissions(allow: boolean): ClientAccessPermissions {
  return {
    view: allow,
    operate: allow,
    viewBasic: allow,
    operateSolicitudes: allow,
    operatePagos: allow,
    operateBeneficiarios: allow,
    operateDispersiones: allow,
    viewBalanceInDispersion: allow,
    requestDispersionIncidents: allow,
    commentDispersionNotes: allow,
  };
}

export function normalizeClientAccessPermissions(
  input: any,
  active: boolean
): ClientAccessPermissions {
  const permissions = input || {};

  const legacyView = active && permissions?.view !== false;
  const legacyOperate = active && permissions?.operate !== false;

  return {
    view: legacyView,
    operate: legacyOperate,
    viewBasic: permissions?.viewBasic ?? legacyView,
    operateSolicitudes: permissions?.operateSolicitudes ?? legacyOperate,
    operatePagos: permissions?.operatePagos ?? legacyOperate,
    operateBeneficiarios: permissions?.operateBeneficiarios ?? legacyOperate,
    operateDispersiones: permissions?.operateDispersiones ?? legacyOperate,
    viewBalanceInDispersion: permissions?.viewBalanceInDispersion ?? legacyView,
    requestDispersionIncidents: permissions?.requestDispersionIncidents ?? legacyOperate,
    commentDispersionNotes: permissions?.commentDispersionNotes ?? legacyOperate,
  };
}

function hasPermission(
  access: ResolvedClientAccess,
  permission: RequireClientAccessParams["permission"]
) {
  if (permission === "view") return access.permissions.view === true;
  if (permission === "operate") return access.permissions.operate === true;
  return access.permissions[permission] === true;
}

function getClientEconomicOwner(client: any) {
  const adminId = cleanId(client?.adminId) || null;
  const operadorId = cleanId(client?.operadorId) || cleanId(client?.managedByUserId) || null;

  return {
    economicOwnerAdminId: adminId,
    economicOwnerOperadorId: operadorId,
    clientOwnerId: cleanId(client?.ownerId) || null,
    clientManagedByUserId: cleanId(client?.managedByUserId) || null,
  };
}

function isDirectClientAccess(params: {
  uid: string;
  role: ClientAccessRole;
  rootId: string;
  client: any;
}) {
  const { uid, role, rootId, client } = params;

  const clientRootId = cleanId(client?.rootId);
  if (clientRootId && clientRootId !== rootId) return false;

  if (role === "superadmin") return true;

  const adminId = cleanId(client?.adminId);
  const ownerId = cleanId(client?.ownerId);
  const managedByUserId = cleanId(client?.managedByUserId);
  const createdBy = cleanId(client?.createdBy);
  const operadorId = cleanId(client?.operadorId);

  if (role === "admin") {
    return (
      adminId === uid ||
      ownerId === uid ||
      managedByUserId === uid ||
      createdBy === uid ||
      operadorId === uid
    );
  }

  if (role === "operador") {
    return managedByUserId === uid || operadorId === uid || createdBy === uid;
  }

  return false;
}

function deniedAccess(params: {
  uid: string;
  role: ClientAccessRole;
  rootId: string;
  clientId: string;
  client: any | null;
  reason: string;
}): ResolvedClientAccess {
  const owner = getClientEconomicOwner(params.client || {});

  return {
    uid: params.uid,
    role: params.role,
    rootId: params.rootId,
    clientId: params.clientId,
    allowed: false,
    source: "DENIED",
    client: params.client || null,
    clientPath: params.client ? `clients/${params.clientId}` : null,
    delegationPath: null,
    delegationId: null,
    delegation: null,
    permissions: buildDefaultPermissions(false),
    ...owner,
    reason: params.reason,
  };
}

export async function resolveClientOperationalAccess(
  params: ResolveClientAccessParams
): Promise<ResolvedClientAccess> {
  const uid = cleanId(params.uid);
  const role = params.role;
  const rootId = cleanId(params.rootId);
  const clientId = cleanId(params.clientId);

  if (!uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesion.");
  }

  if (!clientId) {
    throw new HttpsError("invalid-argument", "clientId requerido.");
  }

  let client = params.client || null;

  if (!client) {
    const clientSnap = await db.doc(`clients/${clientId}`).get();
    if (!clientSnap.exists) {
      throw new HttpsError("not-found", "Cliente no existe.");
    }
    client = clientSnap.data() || {};
  }

  if (client?.active === false) {
    throw new HttpsError("failed-precondition", "Cliente inactivo.");
  }

  const owner = getClientEconomicOwner(client);
  const clientRootId = cleanId(client?.rootId);

  if (clientRootId && rootId && clientRootId !== rootId) {
    return deniedAccess({
      uid,
      role,
      rootId,
      clientId,
      client,
      reason: "CLIENT_OUT_OF_ROOT",
    });
  }

  if (role === "superadmin") {
    return {
      uid,
      role,
      rootId,
      clientId,
      allowed: true,
      source: "SUPERADMIN",
      client,
      clientPath: `clients/${clientId}`,
      delegationPath: null,
      delegationId: null,
      delegation: null,
      permissions: buildDefaultPermissions(true),
      ...owner,
      reason: null,
    };
  }

  if (isDirectClientAccess({ uid, role, rootId, client })) {
    return {
      uid,
      role,
      rootId,
      clientId,
      allowed: true,
      source: "DIRECT",
      client,
      clientPath: `clients/${clientId}`,
      delegationPath: null,
      delegationId: null,
      delegation: null,
      permissions: buildDefaultPermissions(true),
      ...owner,
      reason: null,
    };
  }

  const delegationSnap = await db.doc(`userClientAccess/${uid}/clients/${clientId}`).get();
  if (!delegationSnap.exists) {
    return deniedAccess({
      uid,
      role,
      rootId,
      clientId,
      client,
      reason: "NO_DELEGATION",
    });
  }

  const delegation: any = delegationSnap.data() || {};
  const active = delegation?.active === true;

  if (!active) {
    return deniedAccess({
      uid,
      role,
      rootId,
      clientId,
      client,
      reason: "DELEGATION_INACTIVE",
    });
  }

  if (delegation?.revokedAt) {
    return deniedAccess({
      uid,
      role,
      rootId,
      clientId,
      client,
      reason: "DELEGATION_REVOKED",
    });
  }

  if (isExpired(delegation?.expiresAt)) {
    return deniedAccess({
      uid,
      role,
      rootId,
      clientId,
      client,
      reason: "DELEGATION_EXPIRED",
    });
  }

  const permissions = normalizeClientAccessPermissions(delegation?.permissions, true);

  if (permissions.view !== true && permissions.operate !== true) {
    return deniedAccess({
      uid,
      role,
      rootId,
      clientId,
      client,
      reason: "DELEGATION_WITHOUT_PERMISSIONS",
    });
  }

  return {
    uid,
    role,
    rootId,
    clientId,
    allowed: true,
    source: "DELEGATED",
    client,
    clientPath: `clients/${clientId}`,
    delegationPath: delegationSnap.ref.path,
    delegationId: delegationSnap.id,
    delegation,
    permissions,
    ...owner,
    reason: null,
  };
}

export async function requireClientOperationalAccess(
  params: RequireClientAccessParams
): Promise<ResolvedClientAccess> {
  const access = await resolveClientOperationalAccess(params);

  if (!access.allowed || !hasPermission(access, params.permission)) {
    throw new HttpsError(
      "permission-denied",
      params.errorMessage || "No autorizado para operar este cliente."
    );
  }

  return access;
}

export function buildClientAccessOperationPatch(access: ResolvedClientAccess) {
  return {
    actorUid: access.uid,
    accessSource: access.source,
    delegatedClientAccessPath: access.delegationPath,
    delegatedClientAccessId: access.delegationId,
    economicOwnerAdminId: access.economicOwnerAdminId,
    economicOwnerOperadorId: access.economicOwnerOperadorId,
    clientOwnerId: access.clientOwnerId,
    clientManagedByUserId: access.clientManagedByUserId,
  };
}
