// Recovery of client documents after Hugo was offline, and the "Hugo is not sending" alert.
// The sweep only moves a delivery back to the queue when nothing reached WhatsApp (decideAutoRetry); SEND_UNCERTAIN is never touched.
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";

import { logActivity, logActivityTx } from "../../utils/logActivity";
import { applyWhatsAppDestinationsToJob, findDocumentSenderBinding } from "./whatsappRoutes";
import { releaseWhatsAppJobDeliveriesCore } from "./whatsappReleaseCallables";
import {
  aggregateJobStatus,
  decideAutoRetry,
  evaluateDeliveryAlert,
  shouldRerouteWaitingJob,
  type DeliveryAlert,
} from "./whatsappDeliveryDomain";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const clean = (value: unknown, max = 200) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const millis = (value: any): number => (typeof value?.toMillis === "function" ? Number(value.toMillis()) || 0 : 0);
const PAGE = 50;

export const DELIVERY_ALERTS = "whatsappDeliveryAlerts";

export type RecoverySummary = { retried: number; rerouted: number };

/** Failed pre-send deliveries of recent automatic jobs go back to the queue, a bounded number of times. */
async function retryFailedDeliveries(rootId: string, nowMs: number): Promise<number> {
  let retried = 0;
  for (const status of ["ERROR", "ERROR_PARTIAL"]) {
    const jobs = await db.collection("documentDeliveryJobs").where("rootId", "==", rootId).where("status", "==", status).limit(PAGE).get();
    for (const jobDoc of jobs.docs) {
      try {
        retried += await db.runTransaction(async (tx) => {
          const [jobSnap, deliveries] = await Promise.all([tx.get(jobDoc.ref), tx.get(jobDoc.ref.collection("deliveries"))]);
          const job = jobSnap.data() || {};
          if (clean(job.rootId) !== rootId) return 0;
          const retryable = deliveries.docs.filter((doc) => decideAutoRetry({ delivery: doc.data() || {}, job, nowMs }) === "RETRY");
          if (!retryable.length) return 0;
          for (const doc of retryable) {
            tx.update(doc.ref, { status: "PENDING_SEND", lease: null, attemptStartedAtMs: null, autoRetryCount: FieldValue.increment(1),
              lastAutoRetryAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
          }
          const ids = new Set(retryable.map((doc) => doc.id));
          const statuses = deliveries.docs.map((doc) => (ids.has(doc.id) ? "PENDING_SEND" : clean(doc.get("status"), 80)));
          tx.update(jobDoc.ref, { status: aggregateJobStatus(statuses, clean(job.status, 80)), releaseStatus: "AUTO_RETRY", updatedAt: FieldValue.serverTimestamp() });
          logActivityTx(tx, db, { event: "WHATSAPP_DOCUMENTO_REINTENTO_AUTOMATICO", rootId, actorUid: "SYSTEM", actorName: "Hugo", actorRole: "system",
            referenceId: jobDoc.id, referenceType: "documentDeliveryJob",
            description: `Envío por WhatsApp de ${clean(job.clienteNombre, 160) || "cliente"} puesto de nuevo en cola tras un fallo antes de enviar.`,
            extra: { deliveries: retryable.length } });
          return retryable.length;
        });
      } catch (error: any) {
        console.warn("[WHATSAPP RECOVERY] REINTENTO NO APLICADO", clean(error?.message, 120));
      }
    }
  }
  return retried;
}

/** Automatic jobs left without destination because Hugo did not see the group are routed and released once he does. */
async function rerouteWaitingJobs(rootId: string, nowMs: number): Promise<number> {
  let rerouted = 0;
  const jobs = await db.collection("documentDeliveryJobs").where("rootId", "==", rootId).where("status", "==", "READY_FOR_MANUAL_SEND").limit(PAGE).get();
  for (const jobDoc of jobs.docs) {
    const job = jobDoc.data() || {};
    if (!shouldRerouteWaitingJob(job, nowMs)) continue;
    try {
      const routed = await applyWhatsAppDestinationsToJob(db, jobDoc.ref, job, { uid: "system", name: "AUTO_ROUTE_RECOVERY" });
      if (routed.destinationsCount > 0) {
        await releaseWhatsAppJobDeliveriesCore({ jobId: jobDoc.id, uid: "system", actorName: "Sistema" });
        rerouted += 1;
      }
    } catch (error: any) {
      console.warn("[WHATSAPP RECOVERY] REENRUTAMIENTO NO APLICADO", clean(error?.message, 120));
    }
  }
  return rerouted;
}

/** Evaluates and stores the alert; the audit entry is written only when it turns on, once per episode. */
export async function evaluateAndStoreDeliveryAlert(rootId: string, nowMs = Date.now()): Promise<DeliveryAlert> {
  const binding = await findDocumentSenderBinding(db, rootId);
  const connector = binding ? (await db.doc(`whatsappQrConnectors/${binding.id}`).get()).data() || {} : {};
  const seenMs = millis(connector.lastSeenAt);
  const heartbeatAgeMs = seenMs > 0 ? Math.max(0, nowMs - seenMs) : null;
  const pending = await db.collection("documentDeliveryJobs").where("rootId", "==", rootId).where("status", "==", "READY_FOR_SEND").limit(PAGE).get();
  const releasedAtMs = pending.docs.map((doc) => millis(doc.get("releasedAt")) || millis(doc.get("createdAt")));
  const alert = evaluateDeliveryAlert({ nowMs, heartbeatAgeMs, releasedAtMs });

  const ref = db.doc(`${DELIVERY_ALERTS}/${rootId}`);
  const before = (await ref.get()).data() || {};
  await ref.set({ rootId, ...alert, evaluatedAt: FieldValue.serverTimestamp(),
    ...(alert.active && before.active !== true ? { activeSince: FieldValue.serverTimestamp() } : {}) }, { merge: true });
  if (alert.active && before.active !== true) {
    const reason = alert.heartbeatMissing ? "Hugo no reporta conexión desde hace más de 5 minutos" : `hay ${alert.unclaimedCount} documento(s) sin enviar desde hace más de 15 minutos`;
    await logActivity({ event: "WHATSAPP_ALERTA_ENVIO_DOCUMENTOS", rootId, actorUid: "SYSTEM", actorName: "Hugo", actorRole: "system", referenceId: rootId, referenceType: "whatsappDeliveryAlert",
      description: `Alerta: ${reason}.`, extra: { heartbeatMissing: alert.heartbeatMissing, unclaimedCount: alert.unclaimedCount } }).catch(() => undefined);
  }
  return alert;
}

export async function recoverWhatsAppDeliveriesForRoot(rootId: string, nowMs = Date.now()): Promise<RecoverySummary> {
  const config = await db.doc(`whatsappAutomationConfigs/${rootId}`).get();
  if (config.get("enabled") !== true) return { retried: 0, rerouted: 0 };
  // With no active Hugo binding nothing can be sent; the alert still reports it, the queue is left as it is.
  const binding = await findDocumentSenderBinding(db, rootId);
  const summary = binding ? { retried: await retryFailedDeliveries(rootId, nowMs), rerouted: await rerouteWaitingJobs(rootId, nowMs) } : { retried: 0, rerouted: 0 };
  await evaluateAndStoreDeliveryAlert(rootId, nowMs);
  return summary;
}

export const recoverWhatsAppDeliveries = onSchedule({ schedule: "*/10 * * * *", timeZone: "America/Mexico_City", region: "us-central1", timeoutSeconds: 240, memory: "256MiB", retryCount: 0 }, async () => {
  const configs = await db.collection("whatsappAutomationConfigs").where("enabled", "==", true).limit(20).get();
  for (const doc of configs.docs) {
    try {
      const summary = await recoverWhatsAppDeliveriesForRoot(doc.id);
      if (summary.retried || summary.rerouted) console.log("[WHATSAPP RECOVERY]", JSON.stringify(summary));
    } catch (error: any) {
      console.error("WHATSAPP_RECOVERY_FAILED", clean(error?.message, 160));
    }
  }
});
