// Recovery of client documents after Hugo was offline, and the "Hugo is not sending" alert.
// The sweep only moves a delivery back to the queue when nothing reached WhatsApp (decideAutoRetry); SEND_UNCERTAIN is never touched.
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";

import { logActivity, logActivityTx } from "../../utils/logActivity";
import { applyWhatsAppDestinationsToJob, findDocumentSenderBinding } from "./whatsappRoutes";
import { readInternalGroup } from "./internalGroupOwner";
import { releaseWhatsAppJobDeliveriesCore } from "./whatsappReleaseCallables";
import {
  aggregateJobStatus,
  chooseDeliveryDestination,
  decideAutoRetry,
  DELIVERY_ALERT_NOTICE_EVERY_MS,
  deliveryAlertNoticeText,
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

/**
 * Tells the owner's internal group that documents are waiting while Hugo is connected. Never when Hugo is the one that is down:
 * the notice goes out through him. At most one per hour, and only when Hugo's own connector sees the internal group.
 * Returns what happened so it can be tested.
 */
export async function noticeUnclaimedToInternalGroup(rootId: string, alert: DeliveryAlert, nowMs: number, lastNoticeAtMs: number): Promise<"SENT" | "NOT_NEEDED" | "TOO_SOON" | "NO_INTERNAL_GROUP" | "GROUP_NOT_VISIBLE" | "ALREADY_QUEUED"> {
  if (alert.heartbeatMissing || alert.unclaimedCount <= 0) return "NOT_NEEDED";
  if (lastNoticeAtMs > 0 && nowMs - lastNoticeAtMs < DELIVERY_ALERT_NOTICE_EVERY_MS) return "TOO_SOON";
  // In PAY0 the superadmin's user id is the root id; that owner's internal group is the one that is told.
  const internal = await readInternalGroup(db, rootId, rootId);
  if (!internal) return "NO_INTERNAL_GROUP";
  const binding = await findDocumentSenderBinding(db, rootId);
  const chat = binding ? await db.doc(`whatsappAgentChats/${binding.id}__${encodeURIComponent(internal.groupChatId)}`).get() : null;
  const hugoGroup = binding && chat?.exists && clean(chat.get("bindingId")) === binding.id ? { ...(chat.data() || {}), bindingId: binding.id } : null;
  const choice = chooseDeliveryDestination({ assignment: { groupChatId: internal.groupChatId, groupName: internal.groupName }, hugoGroup, rootId });
  if (choice.source !== "CLIENT_GROUP") return "GROUP_NOT_VISIBLE";
  const destination = choice.destinations[0];
  const bucket = Math.floor(nowMs / DELIVERY_ALERT_NOTICE_EVERY_MS);
  const jobRef = db.doc(`documentDeliveryJobs/hugo-no-envia-${rootId}-${bucket}`);
  const deliveryId = encodeURIComponent(destination.safeDocId || destination.chatId);
  const batch = db.batch();
  batch.create(jobRef, {
    rootId, channel: "WHATSAPP", sourceType: "AVISO_GRUPO_INTERNO", sourceId: `hugo-no-envia:${bucket}`, origin: "AUTOMATIC", status: "READY_FOR_SEND", releaseStatus: "RELEASED",
    clienteId: null, clienteNombre: "Aviso interno", documents: [], caption: "", textBody: deliveryAlertNoticeText(alert), notes: "Aviso interno: documentos sin enviar.",
    deliveryMode: "MULTI_TARGET", targetResolutionStatus: "ROUTE_RESOLVED", targetDestinations: [destination], targetDestinationsCount: 1, targetChatId: destination.chatId, targetChatName: destination.chatName,
    createdByUid: "system", createdByName: "Sistema", createdAt: FieldValue.serverTimestamp(), releasedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });
  batch.set(jobRef.collection("deliveries").doc(deliveryId), {
    channel: "WHATSAPP", rootId, status: "PENDING_SEND", connectorId: destination.connectorId, chatId: destination.chatId, chatName: destination.chatName, chatType: destination.chatType,
    safeDocId: destination.safeDocId, destinationType: destination.destinationType, releasedAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });
  try { await batch.commit(); } catch (error: any) {
    if (Number(error?.code) === 6 || /already exists/i.test(String(error?.message || ""))) return "ALREADY_QUEUED";
    throw error;
  }
  return "SENT";
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
  const priorNotice = Number(((await db.doc(`${DELIVERY_ALERTS}/${rootId}`).get()).data() || {}).lastNoticeAtMs || 0);
  const noticed = await noticeUnclaimedToInternalGroup(rootId, alert, nowMs, priorNotice).catch((error: any) => { console.warn("[WHATSAPP RECOVERY] AVISO INTERNO NO ENVIADO", clean(error?.message, 120)); return "NOT_NEEDED" as const; });

  const ref = db.doc(`${DELIVERY_ALERTS}/${rootId}`);
  const before = (await ref.get()).data() || {};
  await ref.set({ rootId, ...alert, evaluatedAt: FieldValue.serverTimestamp(), ...(noticed === "SENT" ? { lastNoticeAtMs: nowMs } : {}),
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
