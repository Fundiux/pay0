import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";
import { requireClientOperationalAccess } from "../clientDelegations/access";
import { documentId } from "../notes/readPagination";
import { assertDispersionFundingOwner } from "../financing/dispersionFunding";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const kinds = {
  solicitudes: { module: "solicitudes", action: "view", permission: "operateSolicitudes" },
  pagos: { module: "pagos", action: "view", permission: "operatePagos" },
  clientDispersions: { module: "wallet", action: "dispersiones", permission: "viewBasic" },
} as const;
type Kind = keyof typeof kinds;
const identifier = documentId;

async function authorizedSnapshot(transaction: admin.firestore.Transaction, auth: any, collection: Kind, id: string) {
  const profile = (await transaction.get(db.doc(`users/${auth.uid}`))).data();
  const policy = kinds[collection];
  const role = assertAuthorized(auth, profile, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: policy.module, requiredAction: policy.action });
  const rootId = String(profile?.rootId || auth.uid).trim();
  const snapshot = await transaction.get(db.doc(`${collection}/${id}`));
  const row = snapshot.data();
  if (!row || !identifier(rootId) || row.rootId !== rootId) throw new HttpsError("permission-denied", "Registro no disponible.");
  if (collection === "clientDispersions") assertDispersionFundingOwner({ uid: auth.uid, role, rootId, dispersion: row });
  let allowed = role === "superadmin" || [row.adminId, row.createdBy].includes(auth.uid)
    || (collection === "clientDispersions" && (row.operadorId === auth.uid || row.fundingSource?.holderType === "USER"));
  if (!allowed) {
    const aliases = [...new Set([row.clientId, row.clienteId].filter(identifier))];
    for (const clientId of aliases) {
      try {
        await requireClientOperationalAccess({ uid: auth.uid, role, rootId, clientId, transaction, permission: policy.permission });
        allowed = true;
        break;
      } catch (error: any) {
        if (!["permission-denied", "not-found", "failed-precondition"].includes(error?.code)) throw error;
      }
    }
  }
  if (!allowed) throw new HttpsError("permission-denied", "Registro no disponible.");
  return snapshot;
}

function transport(value: any): any {
  if (value instanceof admin.firestore.Timestamp) return { seconds: value.seconds, nanoseconds: value.nanoseconds };
  if (Array.isArray(value)) return value.map(transport);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, transport(item)]));
  return value;
}

/** Fresh server authority replaces delegated SDK reads; no cross-request cache. */
export async function readAuthorizedOperationalRecord(request: any): Promise<{ item?: Record<string, any>; items?: Record<string, any>[]; deniedIds?: string[] }> {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  const collection = request.data?.collection as Kind;
  if (request.data?.ids !== undefined) {
    const ids = request.data.ids;
    if (!Object.prototype.hasOwnProperty.call(kinds, collection) || request.data.id !== undefined || !Array.isArray(ids) || ids.length < 1 || ids.length > 20 || !ids.every(identifier) || new Set(ids).size !== ids.length) throw new HttpsError("invalid-argument", "Lote inválido.");
    const items: Record<string, any>[] = [], deniedIds: string[] = [];
    for (let offset = 0; offset < ids.length; offset += 4) {
      await Promise.all(ids.slice(offset, offset + 4).map(async (id: string) => {
        try { const result = await readAuthorizedOperationalRecord({ ...request, data: { collection, id } }); items.push(result.item!); }
        catch (error: any) {
          if (!["permission-denied", "not-found", "failed-precondition"].includes(error?.code)) throw error;
          deniedIds.push(id);
        }
      }));
    }
    return { items, deniedIds };
  }
  const id = request.data?.id;
  if (!Object.prototype.hasOwnProperty.call(kinds, collection) || !identifier(id)) throw new HttpsError("invalid-argument", "Registro inválido.");
  const snapshot = await db.runTransaction(transaction => authorizedSnapshot(transaction, request.auth, collection, id), { maxAttempts: 3 });
  const current = await db.runTransaction(transaction => authorizedSnapshot(transaction, request.auth, collection, id), { maxAttempts: 3 });
  if (!snapshot.updateTime?.isEqual(current.updateTime!)) throw new HttpsError("aborted", "El registro cambió. Actualiza e inténtalo de nuevo.");
  return { item: { ...transport(current.data()), id: current.id } };
}

export const getAuthorizedOperationalRecord = onCall({ cors: true, timeoutSeconds: 60, memory: "256MiB" }, readAuthorizedOperationalRecord);
