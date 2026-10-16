import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export type DossierDocument = {
  id: string; family: string; parentId: string; name: string; documentType: string;
  folio: string; company: string; client: string; origin: "IQ" | "PAY0"; iqFolio: string; version: number | null;
  availability?: "AVAILABLE" | "PENDING_REVIEW";
  pendingReason?: "UPLOAD_PENDING" | "LEGACY_METADATA";
};
export async function listOperationalDocuments(cursor?: string) {
  const result = await httpsCallable<{ cursor?: string }, { documents: DossierDocument[]; pendingDocuments?: DossierDocument[]; scanned: number; nextCursor: string | null }>(functions, "listOperationalDocuments")({ ...(cursor ? { cursor } : {}) });
  return result.data;
}
