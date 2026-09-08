import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import {
  resolveClientOperationalAccess,
  type ClientAccessRole,
  type ClientAccessSource,
} from "../clientDelegations/access";

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function canonicalNumber(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number > 0
    ? Math.trunc(number)
    : 0;
}

export type CanonicalBusinessFolioContext = {
  clientId: string;
  clientNumber: number;

  ownerUid: string;
  ownerUserNumber: number;

  actorUid: string;
  accessSource: ClientAccessSource;

  delegateUid: string | null;
  delegateUserNumber: number | null;

  delegatedClientAccessPath: string | null;
  delegatedClientAccessId: string | null;
};

export async function resolveCanonicalBusinessFolioContext(input: {
  db: Firestore;
  rootId: string;
  clientId: string;
  actorUid: string;
  actorRole: ClientAccessRole | "operator";
}): Promise<CanonicalBusinessFolioContext> {
  const rootId = clean(input.rootId);
  const clientId = clean(input.clientId);
  const actorUid = clean(input.actorUid);
  const actorRoleRaw = clean(input.actorRole).toLowerCase();
  const actorRole: ClientAccessRole =
    actorRoleRaw === "operator"
      ? "operador"
      : actorRoleRaw === "superadmin" ||
          actorRoleRaw === "admin" ||
          actorRoleRaw === "operador"
        ? actorRoleRaw
        : "";

  if (!actorRole) {
    throw new HttpsError(
      "permission-denied",
      "Rol no autorizado para resolver folio canonico.",
    );
  }

  if (!rootId) {
    throw new HttpsError(
      "failed-precondition",
      "rootId requerido para resolver folio canonico.",
    );
  }

  if (!clientId) {
    throw new HttpsError(
      "invalid-argument",
      "clientId requerido para resolver folio canonico.",
    );
  }

  if (!actorUid) {
    throw new HttpsError(
      "unauthenticated",
      "Usuario requerido para resolver folio canonico.",
    );
  }

  const clientSnap = await input.db.doc(`clients/${clientId}`).get();

  if (!clientSnap.exists) {
    throw new HttpsError(
      "not-found",
      "Cliente no existe.",
    );
  }

  const client: any = clientSnap.data() || {};

  const access = await resolveClientOperationalAccess({
    uid: actorUid,
    role: actorRole,
    rootId,
    clientId,
    client,
  });

  if (!access.allowed) {
    throw new HttpsError(
      "permission-denied",
      "No autorizado para operar este cliente.",
    );
  }

  // Regla canonica:
  // U# siempre pertenece al usuario creador original del cliente.
  const ownerUid = clean(client?.createdBy);

  if (!ownerUid) {
    throw new HttpsError(
      "failed-precondition",
      "El cliente no conserva createdBy; no se puede resolver U# de forma canonica.",
    );
  }

  const clientNumber = canonicalNumber(
    client?.clientNumber ??
      client?.numeroCliente ??
      client?.sequenceNumber,
  );

  if (!clientNumber) {
    throw new HttpsError(
      "failed-precondition",
      "Numero canonico de cliente faltante.",
    );
  }

  const delegated = access.source === "DELEGATED";

  const [ownerSnap, delegateSnap] = await Promise.all([
    input.db.doc(`users/${ownerUid}`).get(),
    delegated
      ? input.db.doc(`users/${actorUid}`).get()
      : Promise.resolve(null),
  ]);

  if (!ownerSnap.exists) {
    throw new HttpsError(
      "failed-precondition",
      "El usuario creador original del cliente no existe.",
    );
  }

  const owner: any = ownerSnap.data() || {};
  const ownerUserNumber = canonicalNumber(
    owner?.userNumber ??
      owner?.numeroUsuario ??
      owner?.sequenceNumber,
  );

  if (!ownerUserNumber) {
    throw new HttpsError(
      "failed-precondition",
      "Numero canonico del usuario creador del cliente faltante.",
    );
  }

  let delegateUserNumber: number | null = null;

  if (delegated) {
    if (!delegateSnap?.exists) {
      throw new HttpsError(
        "failed-precondition",
        "El usuario delegado no existe.",
      );
    }

    const delegate: any = delegateSnap.data() || {};

    delegateUserNumber = canonicalNumber(
      delegate?.userNumber ??
        delegate?.numeroUsuario ??
        delegate?.sequenceNumber,
    );

    if (!delegateUserNumber) {
      throw new HttpsError(
        "failed-precondition",
        "Numero canonico del usuario delegado faltante.",
      );
    }
  }

  return {
    clientId,
    clientNumber,

    ownerUid,
    ownerUserNumber,

    actorUid,
    accessSource: access.source,

    delegateUid: delegated ? actorUid : null,
    delegateUserNumber,

    delegatedClientAccessPath: access.delegationPath,
    delegatedClientAccessId: access.delegationId,
  };
}

export function buildCanonicalBusinessFolioParts(input: {
  clientNumber: number;
  ownerUserNumber: number;
  companyNumber: number;
  delegateUserNumber?: number | null;
}) {
  return [
    { label: "C", value: input.clientNumber },
    { label: "U", value: input.ownerUserNumber },
    { label: "E", value: input.companyNumber },
    ...(input.delegateUserNumber
      ? [{ label: "UD", value: input.delegateUserNumber }]
      : []),
  ];
}
