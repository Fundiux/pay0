import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";

if (!admin.apps.length) admin.initializeApp();

export type SolicitudDocumentFinalizeMode = "create" | "update";

export async function finalizeSolicitudDocumentVersionTx(input: {
  tx: Transaction;
  db: Firestore;
  rootId: string;
  solicitudId: string;
  documentType: string;
  uploadId: string;
  uploadRef: DocumentReference;
  mode: SolicitudDocumentFinalizeMode;
  readyPatch: Record<string, unknown>;
  // Distinct REP partialities coexist; only versions of the same REP replace.
  complementKey?: string;
}): Promise<number> {
  const activeQuery = input.db
    .collection("uploads")
    .where("rootId", "==", input.rootId)
    .where("solicitudId", "==", input.solicitudId)
    .where("documentType", "==", input.documentType)
    .where("active", "==", true);
  const activeSnap = await input.tx.get(activeQuery);
  let maxVersion = 0;
  for (const document of activeSnap.docs) {
    if (document.id === input.uploadId) continue;
    if (input.complementKey && document.data().complementKey !== input.complementKey) continue;
    const version = Number((document.data() || {}).version || 0);
    if (version > maxVersion) maxVersion = version;
    input.tx.update(document.ref, {
      active: false,
      status: "REPLACED",
      replacedByUploadId: input.uploadId,
      replacedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  const finalVersion = maxVersion + 1;
  const canonicalPatch = {
    ...input.readyPatch,
    status: "READY",
    active: true,
    version: finalVersion,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (input.mode === "create") input.tx.set(input.uploadRef, canonicalPatch);
  else input.tx.update(input.uploadRef, canonicalPatch);
  return finalVersion;
}
