import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";
import { delegationIsCurrent } from "./policy";
import { getUserRole } from "../../utils/authGuard";

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
  if (!active || (input !== undefined && (input === null || typeof input !== "object" || Array.isArray(input)))) {
    return buildDefaultPermissions(false);
  }
  const permissions = input ?? {};
  const permission = (key: string, fallback: boolean) =>
    Object.prototype.hasOwnProperty.call(permissions, key) ? permissions[key] === true : fallback;
  const legacyView = permission("view", true);
  const legacyOperate = permission("operate", true);
  return {
    view: permission("viewBasic", legacyView),
    operate: legacyOperate,
    viewBasic: permission("viewBasic", legacyView),
    operateSolicitudes: permission("operateSolicitudes", legacyOperate),
    operatePagos: permission("operatePagos", legacyOperate),
    operateBeneficiarios: permission("operateBeneficiarios", legacyOperate),
    operateDispersiones: permission("operateDispersiones", legacyOperate),
    viewBalanceInDispersion: permission("viewBalanceInDispersion", legacyView),
    requestDispersionIncidents: permission("requestDispersionIncidents", legacyOperate),
    commentDispersionNotes: permission("commentDispersionNotes", legacyOperate),
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

  const user = (await db.doc(`users/${uid}`).get()).data();
  if (!user || !rootId || !["superadmin", "admin", "operador"].includes(role) || getUserRole(user) !== role || cleanId(user.rootId || uid) !== rootId
    || user.active === false || user.isActive === false || user.isDeleted === true || user.disabled === true
    || user.deleted === true || user.deletedAt != null) {
    return deniedAccess({ uid, role, rootId, clientId, client, reason: "CLIENT_ACCESS_ACTOR_INVALID" });
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

  if (delegation?.revokedAt != null) {
    return deniedAccess({
      uid,
      role,
      rootId,
      clientId,
      client,
      reason: "DELEGATION_REVOKED",
    });
  }

  if (!delegationIsCurrent(delegation)) {
    return deniedAccess({
      uid,
      role,
      rootId,
      clientId,
      client,
      reason: "DELEGATION_EXPIRED",
    });
  }

  if (("rootId" in delegation && delegation.rootId !== rootId)
    || ("targetUid" in delegation && delegation.targetUid !== uid)
    || ("clientId" in delegation && delegation.clientId !== clientId)) {
    return deniedAccess({ uid, role, rootId, clientId, client, reason: "DELEGATION_SCOPE_INVALID" });
  }

  const permissions = normalizeClientAccessPermissions(delegation?.permissions, true);

  if (!Object.values(permissions).some(value => value === true)) {
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

// Compatibility adapter for legacy domain helpers. The current actor, scope,
// lifetime and granular permission are resolved on every call.
export async function getCurrentClientDelegationAccess(
  uid: string, clientId: string, permission: ClientAccessPermissionKey
) {
  const user = (await db.doc(`users/${uid}`).get()).data();
  if (!user) return null;
  const access = await resolveClientOperationalAccess({
    uid, clientId, role: getUserRole(user) as ClientAccessRole,
    rootId: cleanId(user.rootId || uid),
  });
  if (!access.allowed || access.source !== "DELEGATED" || access.permissions[permission] !== true) return null;
  return { id: access.delegationId, path: access.delegationPath, data: access.delegation };
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
