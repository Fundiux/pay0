import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { isMergedClient, mergedClientMessage, mergedIntoOf } from "./mergeDomain";

// Call at the points that CREATE something for a client (solicitud, pago, beneficiary, dispersion, new delegation).
// Work already created on a merged duplicate is not guarded: it can still be applied, dispersed and documented.
export function assertClientAcceptsNewOperations(client: unknown): void {
  if (!isMergedClient(client)) return;
  throw new HttpsError("failed-precondition", mergedClientMessage(client), { code: "CLIENT_MERGED", mergedInto: mergedIntoOf(client) });
}

export async function assertClientIdAcceptsNewOperations(db: Firestore, clientId: string, transaction?: FirebaseFirestore.Transaction): Promise<void> {
  const id = String(clientId ?? "").trim();
  if (!id) return;
  const ref = db.doc(`clients/${id}`);
  const snap = transaction ? await transaction.get(ref) : await ref.get();
  if (snap.exists) assertClientAcceptsNewOperations(snap.data());
}
