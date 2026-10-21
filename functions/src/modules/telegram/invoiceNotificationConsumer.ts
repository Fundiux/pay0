import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { FieldPath } from "firebase-admin/firestore";
import { randomUUID } from "crypto";
import { notifyClientFacturaDisponibleFromUploadId } from "./clientNotifications";
import { INVOICE_OUTBOX, INVOICE_DELIVERY_CONTROL, INVOICE_QUEUE_SCHEMA, invoiceNotificationJobId } from "./invoiceNotificationOutbox";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

function enabled(control: any): boolean {
  return control?.schemaVersion === INVOICE_QUEUE_SCHEMA && control.enabled === true &&
    typeof control.epoch === "string" && /^[a-f0-9-]{36}$/.test(control.epoch);
}

export async function consumeTelegramInvoiceNotificationJob(jobId: string): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(jobId)) throw new Error("INVALID_JOB_ID");
  const ref = db.collection(INVOICE_OUTBOX).doc(jobId), controlRef = db.doc(INVOICE_DELIVERY_CONTROL);
  const attemptId = randomUUID();
  const claimed = await db.runTransaction(async tx => {
    const [jobSnap, controlSnap] = await Promise.all([tx.get(ref), tx.get(controlRef)]);
    const job = jobSnap.data(), control = controlSnap.data();
    if (!enabled(control)) return null;
    if (!job || !["READY", "WAITING_PAIR"].includes(job.state)) return null;
    if (job.schemaVersion !== INVOICE_QUEUE_SCHEMA || job.jobId !== jobId ||
        typeof job.rootId !== "string" || typeof job.uploadId !== "string" ||
        invoiceNotificationJobId(job.rootId, job.uploadId) !== jobId ||
        !["FACTURA_PDF", "FACTURA_XML"].includes(job.documentType) ||
        [job.uploadId, job.rootId, job.solicitudId, job.clientId].some(v => typeof v !== "string" || !v || v.includes("/") || v.length > 256)) {
      tx.update(ref, { state: "REVIEW", reason: "INVALID_JOB_SCOPE", updatedAt: FieldValue.serverTimestamp() });
      return null;
    }
    const upload = (await tx.get(db.collection("uploads").doc(job.uploadId))).data();
    const solicitud = (await tx.get(db.collection("solicitudes").doc(job.solicitudId))).data();
    const client = (await tx.get(db.collection("clients").doc(job.clientId))).data();
    if (client?.rootId !== job.rootId) {
      tx.update(ref, { state: "REVIEW", reason: "CLIENT_AUTHORITY_UNAVAILABLE", updatedAt: FieldValue.serverTimestamp() });
      return null;
    }
    if (!upload || upload.rootId !== job.rootId || (upload.solicitudId || upload.entityId) !== job.solicitudId ||
        upload.documentType !== job.documentType || upload.active !== true || upload.status !== "READY" ||
        solicitud?.rootId !== job.rootId || (solicitud?.clienteId || solicitud?.clientId) !== job.clientId) {
      tx.update(ref, { state: "CANCELLED", reason: "UPLOAD_NO_LONGER_CURRENT", updatedAt: FieldValue.serverTimestamp() });
      return null;
    }
    tx.update(ref, { state: "ATTEMPTING", attemptId, epoch: control!.epoch,
      reviewRequired: true, attemptedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    return { uploadId: String(job.uploadId), rootId: String(job.rootId), solicitudId: String(job.solicitudId), clientId: String(job.clientId), epoch: String(control!.epoch) };
  });
  if (!claimed) return "NOT_CLAIMED";
  const permit = async () => {
    const [controlSnap, solicitudSnap, clientSnap] = await Promise.all([
      controlRef.get(), db.collection("solicitudes").doc(claimed.solicitudId).get(),
      db.collection("clients").doc(claimed.clientId).get(),
    ]);
    const current = controlSnap.data(), solicitud = solicitudSnap.data();
    if (!enabled(current) || current!.epoch !== claimed.epoch) throw new Error("INVOICE_NOTIFICATIONS_PAUSED");
    if (solicitud?.rootId !== claimed.rootId || (solicitud?.clienteId || solicitud?.clientId) !== claimed.clientId || clientSnap.data()?.rootId !== claimed.rootId) {
      throw new Error("INVOICE_AUTHORITY_CHANGED");
    }
  };
  let state = "UNCERTAIN", reason = "DELIVERY_UNCONFIRMED";
  try {
    await permit();
    const result = await notifyClientFacturaDisponibleFromUploadId(claimed.uploadId, { beforeSend: permit });
    if (result.reason === "missing_pdf_or_xml") { state = "WAITING_PAIR"; reason = "WAITING_PAIR"; }
    else if (result.reason === "delivery_uncertain" || result.reviewRequired) { state = "UNCERTAIN"; }
    else if (["sent", "duplicate", "client_without_telegram_recipients"].includes(result.reason)) { state = "DONE"; reason = result.reason; }
    else { state = "REVIEW"; reason = "CURRENT_AUTHORITY_OR_DOCUMENT_UNAVAILABLE"; }
  } catch { /* Reserved attempts are never automatically reclaimed after uncertainty. */ }
  await db.runTransaction(async tx => {
    const current = (await tx.get(ref)).data();
    if (current?.attemptId !== attemptId || current?.state !== "ATTEMPTING") throw new Error("QUEUE_ATTEMPT_CHANGED");
    tx.update(ref, { state, reason, reviewRequired: ["UNCERTAIN", "REVIEW"].includes(state), updatedAt: FieldValue.serverTimestamp() });
  });
  return state;
}

export async function consumeTelegramInvoiceNotificationQueue(): Promise<void> {
  if (!enabled((await db.doc(INVOICE_DELIVERY_CONTROL).get()).data())) return;
  const deadline = Date.now() + 55000;
  const progress = db.doc("telegramInvoiceDeliveryProgress/current"), cursor = (await progress.get()).data()?.cursor;
  let query = db.collection(INVOICE_OUTBOX).where("state", "in", ["READY", "WAITING_PAIR"]).orderBy(FieldPath.documentId());
  if (typeof cursor === "string" && /^[a-f0-9]{64}$/.test(cursor)) query = query.startAfter(cursor);
  const jobs = await query.limit(10).get();
  let nextCursor: string | null = null;
  for (const job of jobs.docs) {
    if (Date.now() >= deadline) break;
    await consumeTelegramInvoiceNotificationJob(job.id);
    nextCursor = job.id;
  }
  await progress.set({ cursor: nextCursor, updatedAt: FieldValue.serverTimestamp() });
}
