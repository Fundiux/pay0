import { createHash } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import type { Firestore, Transaction } from "firebase-admin/firestore";

export const INVOICE_OUTBOX = "telegramInvoiceNotificationOutbox";
export const INVOICE_DELIVERY_CONTROL = "telegramInvoiceDeliveryControl/current";
export const INVOICE_QUEUE_SCHEMA = 1;

export function invoiceNotificationJobId(rootId: string, uploadId: string): string {
  return createHash("sha256").update(JSON.stringify([rootId, uploadId])).digest("hex");
}

// Called inside the existing, authorized document finalization transaction.
// An aborted commit cannot leave either a READY upload or an orphan queue item.
export async function prepareTelegramInvoiceNotificationTx(input: {
  tx: Transaction; db: Firestore; rootId: string; solicitudId: string;
  uploadId: string; documentType: string;
}): Promise<(() => void) | null> {
  if (!["FACTURA_PDF", "FACTURA_XML"].includes(input.documentType)) return null;
  for (const value of [input.rootId, input.solicitudId, input.uploadId]) {
    if (!value || value.includes("/") || value.length > 256) throw new Error("INVALID_INVOICE_NOTIFICATION_SCOPE");
  }
  const jobId = invoiceNotificationJobId(input.rootId, input.uploadId);
  const ref = input.db.collection(INVOICE_OUTBOX).doc(jobId), previous = (await input.tx.get(ref)).data();
  if (previous) {
    if (previous.schemaVersion !== INVOICE_QUEUE_SCHEMA || previous.jobId !== jobId ||
        previous.rootId !== input.rootId || previous.solicitudId !== input.solicitudId ||
        previous.uploadId !== input.uploadId || previous.documentType !== input.documentType ||
        !["READY", "WAITING_PAIR", "ATTEMPTING", "DONE", "UNCERTAIN", "REVIEW", "CANCELLED"].includes(previous.state)) {
      throw new Error("EXISTING_INVOICE_INTENT_MISMATCH");
    }
    return null;
  }
  const solicitud = (await input.tx.get(input.db.collection("solicitudes").doc(input.solicitudId))).data();
  const clientId = String(solicitud?.clienteId || solicitud?.clientId || "").trim();
  if (solicitud?.rootId !== input.rootId || !clientId || clientId.includes("/") || clientId.length > 256) {
    throw new Error("INVOICE_CLIENT_SCOPE_UNAVAILABLE");
  }
  // Read during the transaction's read phase; invoke only after all reads.
  return () => { input.tx.create(ref, {
    schemaVersion: INVOICE_QUEUE_SCHEMA, jobId, rootId: input.rootId,
    solicitudId: input.solicitudId, uploadId: input.uploadId, clientId,
    documentType: input.documentType, state: "READY",
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  }); };
}
