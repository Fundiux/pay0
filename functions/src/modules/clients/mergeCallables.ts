import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertAuthorized, getUserRole } from "../../utils/authGuard";
import { logActivityTx } from "../../utils/logActivity";
import { db, getActivityAdminId, getMyUser, requireAuth, requireRole } from "../sharedCallables/helpers";
import { MERGE_REFUSAL_MESSAGES, planClientMerge } from "./mergeDomain";

const clean = (value: unknown) => String(value ?? "").trim();

export type MergeClientsResult = { ok: true; canonicalId: string; duplicateId: string; alreadyMerged: boolean };

// Marks `duplicateId` as merged into `canonicalId` from today on. It writes only the duplicate's mergedInto fields:
// no pago, solicitud, balance or ledger entry is moved, reversed or re-posted. Idempotent for the same pair.
export async function mergeDuplicateClient(input: { rootId: string; actorUid: string; actor: any; canonicalId: string; duplicateId: string; reason?: string }): Promise<MergeClientsResult> {
  const canonicalRef = db.doc(`clients/${input.canonicalId}`), duplicateRef = db.doc(`clients/${input.duplicateId}`);
  return db.runTransaction(async (tx) => {
    const [canonicalSnap, duplicateSnap] = await Promise.all([tx.get(canonicalRef), tx.get(duplicateRef)]);
    const duplicate = duplicateSnap.exists ? duplicateSnap.data() as Record<string, any> : null;
    if (duplicate && clean(duplicate.mergedInto) === input.canonicalId) return { ok: true as const, canonicalId: input.canonicalId, duplicateId: input.duplicateId, alreadyMerged: true };
    const plan = planClientMerge({ rootId: input.rootId, canonicalId: input.canonicalId, duplicateId: input.duplicateId, canonical: canonicalSnap.exists ? canonicalSnap.data() as Record<string, any> : null, duplicate });
    if (!plan.ok) throw new HttpsError("failed-precondition", MERGE_REFUSAL_MESSAGES[plan.refusal], { code: `CLIENT_MERGE_${plan.refusal}` });

    tx.update(duplicateRef, {
      mergedInto: input.canonicalId,
      mergedAt: FieldValue.serverTimestamp(),
      mergedBy: input.actorUid,
      mergeReason: clean(input.reason).slice(0, 300) || null,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: input.actorUid,
    });
    tx.update(canonicalRef, { mergedDuplicateIds: FieldValue.arrayUnion(input.duplicateId), updatedAt: FieldValue.serverTimestamp(), updatedBy: input.actorUid });
    logActivityTx(tx, db, {
      event: "CLIENT_MERGED",
      rootId: input.rootId,
      adminId: getActivityAdminId(input.actor, input.actorUid, input.rootId),
      actorUid: input.actorUid,
      actorName: clean(input.actor?.email) || input.actorUid,
      actorUsername: clean(input.actor?.username),
      actorRole: clean(getUserRole(input.actor)),
      referenceId: input.duplicateId,
      referenceType: "client",
      description: `Cliente ${input.duplicateId} fusionado en ${input.canonicalId} para operaciones nuevas; el historial no se movió`,
    });
    return { ok: true as const, canonicalId: input.canonicalId, duplicateId: input.duplicateId, alreadyMerged: false };
  });
}

export const mergeDuplicateClientCallable = onCall({ cors: true, timeoutSeconds: 60, memory: "256MiB" }, async (request) => {
  const callerUid = requireAuth(request);
  const caller = await getMyUser(callerUid);
  requireRole(caller, ["superadmin"]);
  assertAuthorized(request.auth, caller, { allowedRoles: ["superadmin"], requiredModule: "clientes", requiredAction: "edit" });
  const rootId = clean((caller as any)?.rootId) || callerUid;
  const canonicalId = clean(request.data?.canonicalId), duplicateId = clean(request.data?.duplicateId);
  if (!canonicalId || !duplicateId) throw new HttpsError("invalid-argument", "canonicalId y duplicateId son requeridos.");
  return mergeDuplicateClient({ rootId, actorUid: callerUid, actor: caller, canonicalId, duplicateId, reason: request.data?.reason });
});
