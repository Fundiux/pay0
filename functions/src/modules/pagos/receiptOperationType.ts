import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";

export type ReceiptOperationTypeResolution = {
  key: string;
  source: "EXPLICIT" | "UNIQUE_CATALOG" | "MISSING";
  reason?: "MISSING_OPERATION_TYPE" | "OPERATION_TYPE_REQUIRES_REVIEW" | "OPERATION_TYPE_CATALOG_REQUIRES_REVIEW";
};

/** Resolve a catalog identity, never infer a financial operation from PDF wording. */
export async function resolveReceiptOperationType(input: {
  db: Firestore; rootId: string; operationTypeKey?: unknown;
}): Promise<ReceiptOperationTypeResolution> {
  const key = String(input.operationTypeKey ?? "").trim().toUpperCase();
  if (key.includes("/") || key.length > 100) throw new HttpsError("invalid-argument", "Tipo de operacion invalido.");
  if (key) {
    // Explicit choices retain the existing exists/active contract and global catalog scope.
    const snapshot = await input.db.doc(`operationTypes/${key}`).get();
    return snapshot.exists && snapshot.get("active") !== false
      ? { key, source: "EXPLICIT" }
      : { key, source: "EXPLICIT", reason: "OPERATION_TYPE_REQUIRES_REVIEW" };
  }
  const rootId = String(input.rootId || "").trim();
  if (!rootId) return { key: "", source: "MISSING", reason: "MISSING_OPERATION_TYPE" };
  const snapshot = await input.db.collection("operationTypes").limit(501).get();
  if (snapshot.size > 500) return { key: "", source: "MISSING", reason: "OPERATION_TYPE_CATALOG_REQUIRES_REVIEW" };
  const candidates = snapshot.docs.filter(doc => {
    const data = doc.data() || {};
    const owner = String(data.rootId || "").trim();
    return data.active !== false && String(data.category || "OPERACION").trim().toUpperCase() === "OPERACION" && (!owner || owner === rootId);
  });
  if (candidates.length !== 1) return { key: "", source: "MISSING", reason: "MISSING_OPERATION_TYPE" };
  const id = candidates[0].id;
  if (!id || id !== id.trim().toUpperCase() || id.includes("/") || id.length > 100) {
    return { key: "", source: "MISSING", reason: "OPERATION_TYPE_CATALOG_REQUIRES_REVIEW" };
  }
  return { key: id, source: "UNIQUE_CATALOG" };
}
