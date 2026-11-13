// Server side of document sending through Hugo's enrolled connector.
// CLAIM_DELIVERY leases one released delivery; REPORT_DELIVERY records ATTEMPT, SENT, ERROR or UNCERTAIN.
// A delivery is never sent twice: an attempt that may have reached WhatsApp without a SENT report
// becomes SEND_UNCERTAIN and waits for a human.
import { randomUUID } from "node:crypto";
import { FieldValue, Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { logActivityTx } from "../../utils/logActivity";
import type { Binding } from "./whatsappConnectorPolicy";
import {
  aggregateJobStatus,
  decideClaim,
  decideReport,
  deliverySource,
  DELIVERY_LEASE_MS,
  isWithinHugoHours,
  normalizeDeliverySourceType,
  type ReportOutcome,
} from "./whatsappDeliveryDomain";

export type DocumentUrlSigner = (storagePath: string, expectedGeneration: unknown) => Promise<string>;

export type DocumentSenderOptions = {
  signUrl?: DocumentUrlSigner;
  isOpen?: (nowMs: number) => boolean;
};

const MAX_JOBS_SCANNED = 10;
const clean = (value: unknown, max = 500) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const millis = (value: any) => (typeof value?.toMillis === "function" ? Number(value.toMillis()) : 0);
const CHAT_ID = /^[0-9A-Za-z._-]{3,120}@(g|c)\.us$/;
const LEASE_ID = /^[a-f0-9-]{36}$/;
const ERROR_CODE = /^[A-Z0-9_]{1,60}$/;

function fail(code: "invalid-argument" | "failed-precondition" | "permission-denied" = "failed-precondition", message = "Entrega no disponible para este conector."): never {
  throw new HttpsError(code, message);
}

function defaultSigner(): DocumentUrlSigner {
  return async (storagePath, expectedGeneration) => {
    // Loaded lazily: unit tests of the connector authority never touch Storage.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getStorage } = require("firebase-admin/storage");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { signGenerationBoundDownload } = require("../documents/generationBoundDownload");
    return signGenerationBoundDownload(getStorage().bucket(), storagePath, expectedGeneration ?? null);
  };
}

type ClaimedDelivery = {
  jobId: string;
  deliveryId: string;
  leaseId: string;
  leaseExpiresAtMs: number;
  chatId: string;
  kind: "FILES" | "TEXT";
  caption: string;
  text: string | null;
  documents: Array<{ fileName: string; contentType: string; storagePath: string; uploadId: string | null }>;
};

export class WhatsAppDocumentSender {
  private readonly signUrl: DocumentUrlSigner;
  private readonly isOpen: (nowMs: number) => boolean;

  constructor(private readonly db: Firestore, options: DocumentSenderOptions = {}) {
    this.signUrl = options.signUrl || defaultSigner();
    this.isOpen = options.isOpen || isWithinHugoHours;
  }

  private audit(tx: any, event: string, rootId: string, job: any, jobId: string, delivery: any, description: string, extra: Record<string, unknown> = {}) {
    logActivityTx(tx, this.db, {
      event,
      rootId,
      actorUid: "SYSTEM",
      actorName: "Hugo",
      actorRole: "system",
      referenceId: jobId,
      referenceType: "documentDeliveryJob",
      entityId: clean(job?.sourceId, 300) || jobId,
      entityType: clean(job?.sourceType, 80).toLowerCase() || "document_delivery",
      description,
      extra: { channel: "WHATSAPP", sourceType: clean(job?.sourceType, 80), destinationName: clean(delivery?.chatName, 160), ...extra },
    });
  }

  private describe(job: any, delivery: any, verb: string): string {
    const sourceType = normalizeDeliverySourceType(job?.sourceType);
    const label = sourceType ? deliverySource(sourceType).label : "Documento";
    const client = clean(job?.clienteNombre, 160) || "cliente";
    const destination = clean(delivery?.chatName, 160) || "WhatsApp";
    return `${label} de ${client} ${verb} por WhatsApp (${destination}).`;
  }

  /** Reads and writes inside the authority transaction (nonce consumed in the same transaction). */
  async claimTx(tx: any, binding: Binding, data: unknown): Promise<{ delivery: ClaimedDelivery | null; reason?: string }> {
    if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data as object).length !== 0) fail("invalid-argument", "Solicitud de entrega inválida.");
    const nowMs = Date.now(), rootId = binding.rootId;
    const config = (await tx.get(this.db.doc(`whatsappAutomationConfigs/${rootId}`))).data();
    if (config?.enabled !== true) return { delivery: null, reason: "AUTOMATION_OFF" };
    if (!this.isOpen(nowMs)) return { delivery: null, reason: "OFF_HOURS" };

    const jobsCol = this.db.collection("documentDeliveryJobs");
    const [ready, sending] = await Promise.all([
      tx.get(jobsCol.where("rootId", "==", rootId).where("status", "==", "READY_FOR_SEND").limit(MAX_JOBS_SCANNED)),
      tx.get(jobsCol.where("rootId", "==", rootId).where("status", "==", "SENDING").limit(MAX_JOBS_SCANNED)),
    ]);
    const jobs = [...sending.docs, ...ready.docs]
      .filter((doc: any, index: number, all: any[]) => all.findIndex((other: any) => other.id === doc.id) === index)
      .filter((doc: any) => clean(doc.get("rootId"), 200) === rootId && clean(doc.get("channel") || "WHATSAPP") === "WHATSAPP")
      .sort((a: any, b: any) => (millis(a.get("releasedAt")) || millis(a.get("createdAt"))) - (millis(b.get("releasedAt")) || millis(b.get("createdAt"))))
      .slice(0, MAX_JOBS_SCANNED);
    const deliveriesByJob = await Promise.all(jobs.map((job: any) => tx.get(job.ref.collection("deliveries"))));
    // Signature links are re-checked before sending: a used or expired link is never sent.
    const linkSnaps = await Promise.all(jobs.map((job: any) => {
      const token = clean(job.get("linkToken"), 200);
      return job.get("sourceType") === "CONSTANCIA_FIRMA_LINK" && /^[A-Za-z0-9_-]{24,160}$/.test(token)
        ? tx.get(this.db.doc(`signatureRequests/${token}`)) : Promise.resolve(null);
    }));

    // ---- all reads are done; decide and write ----
    let claimed: ClaimedDelivery | null = null;
    jobs.forEach((jobDoc: any, jobIndex: number) => {
      const job = jobDoc.data() || {};
      const deliveries = deliveriesByJob[jobIndex].docs;
      const statuses = new Map<string, string>(deliveries.map((d: any) => [d.id, clean(d.get("status"), 80)]));
      let changed = false;
      for (const deliveryDoc of deliveries) {
        const delivery = deliveryDoc.data() || {};
        const decision = decideClaim(delivery, nowMs);
        if (decision === "MARK_UNCERTAIN") {
          tx.update(deliveryDoc.ref, { status: "SEND_UNCERTAIN", retryBlocked: true, uncertainReason: "LEASE_EXPIRED_AFTER_ATTEMPT",
            uncertainAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
          statuses.set(deliveryDoc.id, "SEND_UNCERTAIN");
          changed = true;
          this.audit(tx, "WHATSAPP_DOCUMENTO_ENVIO_BLOQUEADO", rootId, job, jobDoc.id, delivery,
            this.describe(job, delivery, "quedó sin confirmar; requiere revisión antes de reenviar"), { reason: "LEASE_EXPIRED_AFTER_ATTEMPT" });
          continue;
        }
        if (claimed || (decision !== "CLAIM" && decision !== "RECLAIM_EXPIRED")) continue;
        const invalid = this.invalidReason(job, delivery, rootId, linkSnaps[jobIndex], nowMs);
        if (invalid) {
          const omit = invalid === "LINK_NOT_PENDING";
          tx.update(deliveryDoc.ref, omit
            ? { status: "OMITTED", omitReason: invalid, omittedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }
            : { status: "ERROR", lastError: invalid, errorAt: FieldValue.serverTimestamp(), lease: null, updatedAt: FieldValue.serverTimestamp() });
          statuses.set(deliveryDoc.id, omit ? "OMITTED" : "ERROR");
          changed = true;
          if (!omit) this.audit(tx, "WHATSAPP_DOCUMENTO_ENVIO_FALLIDO", rootId, job, jobDoc.id, delivery, this.describe(job, delivery, "no se pudo enviar"), { reason: invalid });
          continue;
        }
        const leaseId = randomUUID(), leaseExpiresAtMs = nowMs + DELIVERY_LEASE_MS;
        tx.update(deliveryDoc.ref, {
          status: "SENDING",
          lease: { leaseId, bindingId: binding.id, generation: binding.generation, claimedAtMs: nowMs, expiresAtMs: leaseExpiresAtMs },
          attemptStartedAtMs: null,
          claimCount: FieldValue.increment(1),
          sendingAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        statuses.set(deliveryDoc.id, "SENDING");
        changed = true;
        const sourceType = normalizeDeliverySourceType(job.sourceType)!;
        const kind = deliverySource(sourceType).kind;
        claimed = {
          jobId: jobDoc.id,
          deliveryId: deliveryDoc.id,
          leaseId,
          leaseExpiresAtMs,
          chatId: clean(delivery.chatId, 200),
          kind,
          caption: clean(job.caption, 1000) || `${deliverySource(sourceType).label}.`,
          text: kind === "TEXT" ? String(job.textBody || "").slice(0, 1500) : null,
          documents: kind === "FILES" ? (Array.isArray(job.documents) ? job.documents : []).map((doc: any) => ({
            fileName: clean(doc.fileName || doc.name, 200) || "documento.pdf",
            contentType: clean(doc.contentType, 120) || "application/octet-stream",
            storagePath: clean(doc.storagePath, 1200),
            uploadId: clean(doc.uploadId, 200) || null,
          })) : [],
        };
      }
      if (changed) {
        tx.update(jobDoc.ref, { status: aggregateJobStatus([...statuses.values()], clean(job.status, 80)), updatedAt: FieldValue.serverTimestamp() });
      }
    });
    return claimed ? { delivery: claimed } : { delivery: null, reason: "NOTHING_TO_SEND" };
  }

  private invalidReason(job: any, delivery: any, rootId: string, linkSnap: any, nowMs: number): string | null {
    const sourceType = normalizeDeliverySourceType(job.sourceType);
    if (!sourceType) return "SOURCE_TYPE_UNSUPPORTED";
    if (!CHAT_ID.test(clean(delivery.chatId, 200))) return "DESTINATION_INVALID";
    if (delivery.rootId !== undefined && delivery.rootId !== null && clean(delivery.rootId, 200) !== rootId) return "DESTINATION_SCOPE_INVALID";
    if (deliverySource(sourceType).kind === "TEXT") {
      if (!clean(job.textBody, 1500)) return "TEXT_MISSING";
      if (sourceType === "CONSTANCIA_FIRMA_LINK") {
        const link = linkSnap?.data?.();
        if (!link || link.rootId !== rootId || link.status !== "PENDING" || millis(link.expiresAt) <= nowMs) return "LINK_NOT_PENDING";
      }
      return null;
    }
    const documents = Array.isArray(job.documents) ? job.documents : [];
    if (!documents.length || documents.length > 10) return "DOCUMENTS_MISSING";
    if (documents.some((doc: any) => !clean(doc?.storagePath, 1200).startsWith(`roots/${rootId}/`))) return "DOCUMENT_SCOPE_INVALID";
    return null;
  }

  /** After the claim commits: authorize every file again and sign short-lived URLs. */
  async finishClaim(binding: Binding, claim: { delivery: ClaimedDelivery | null; reason?: string }) {
    const delivery = claim.delivery;
    if (!delivery) return { delivery: null, reason: claim.reason || "NOTHING_TO_SEND" };
    if (delivery.kind === "TEXT") {
      return { delivery: { jobId: delivery.jobId, deliveryId: delivery.deliveryId, leaseId: delivery.leaseId, leaseExpiresAtMs: delivery.leaseExpiresAtMs,
        chatId: delivery.chatId, kind: "TEXT", text: delivery.text, caption: null, documents: [] } };
    }
    const documents: Array<{ fileName: string; contentType: string; url: string }> = [];
    try {
      for (const doc of delivery.documents) {
        const upload = await this.authorizedUpload(binding.rootId, doc.storagePath, doc.uploadId);
        documents.push({ fileName: doc.fileName, contentType: clean(upload.contentType, 120) || doc.contentType, url: await this.signUrl(doc.storagePath, upload.storageGeneration ?? null) });
      }
    } catch (error: any) {
      const reason = error instanceof HttpsError ? "FILE_UNAVAILABLE" : "FILE_SIGNING_FAILED";
      await this.releaseUnattempted(binding, delivery, reason);
      return { delivery: null, reason };
    }
    return { delivery: { jobId: delivery.jobId, deliveryId: delivery.deliveryId, leaseId: delivery.leaseId, leaseExpiresAtMs: delivery.leaseExpiresAtMs,
      chatId: delivery.chatId, kind: "FILES", caption: delivery.caption, text: null, documents } };
  }

  /** Same checks as the authorized document download: root, active, READY, exact stored path. */
  private async authorizedUpload(rootId: string, storagePath: string, uploadId: string | null): Promise<any> {
    let upload: any = null;
    if (uploadId) {
      const snap = await this.db.doc(`uploads/${uploadId}`).get();
      upload = snap.exists ? snap.data() : null;
    } else {
      const snap = await this.db.collection("uploads").where("storagePath", "==", storagePath).limit(5).get();
      upload = snap.docs.map(doc => doc.data()).find(row => row.rootId === rootId) || null;
    }
    if (!upload || upload.rootId !== rootId || clean(upload.storagePath, 1200) !== storagePath || !storagePath.startsWith(`roots/${rootId}/`) ||
        upload.active !== true || clean(upload.status).toUpperCase() !== "READY") {
      throw new HttpsError("failed-precondition", "El documento ya no está disponible.");
    }
    return upload;
  }

  private async releaseUnattempted(binding: Binding, claimed: ClaimedDelivery, reason: string) {
    const jobRef = this.db.doc(`documentDeliveryJobs/${claimed.jobId}`);
    await this.db.runTransaction(async tx => {
      const [jobSnap, deliveries] = await Promise.all([tx.get(jobRef), tx.get(jobRef.collection("deliveries"))]);
      const target = deliveries.docs.find((doc: any) => doc.id === claimed.deliveryId);
      const row = target?.data();
      // Only a lease that is still ours and was never attempted can be failed safely.
      if (!target || !row || row.status !== "SENDING" || row.lease?.leaseId !== claimed.leaseId || Number(row.attemptStartedAtMs || 0) > 0) return;
      tx.update(target.ref, { status: "ERROR", lastError: reason, errorAt: FieldValue.serverTimestamp(), lease: null, updatedAt: FieldValue.serverTimestamp() });
      const statuses = deliveries.docs.map((doc: any) => (doc.id === target.id ? "ERROR" : clean(doc.get("status"), 80)));
      const job = jobSnap.data() || {};
      tx.update(jobRef, { status: aggregateJobStatus(statuses, clean(job.status, 80)), updatedAt: FieldValue.serverTimestamp() });
      this.audit(tx, "WHATSAPP_DOCUMENTO_ENVIO_FALLIDO", binding.rootId, job, jobRef.id, row, this.describe(job, row, "no se pudo enviar"), { reason });
    });
  }

  async reportTx(tx: any, binding: Binding, data: any) {
    const allowed = ["jobId", "deliveryId", "leaseId", "outcome", "errorCode", "messageIds"];
    if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(key => !allowed.includes(key))) fail("invalid-argument", "Reporte inválido.");
    const jobId = clean(data.jobId, 200), deliveryId = String(data.deliveryId ?? ""), leaseId = clean(data.leaseId, 80), outcome = data.outcome as ReportOutcome;
    if (!jobId || /[\/\x00-\x1f]/.test(jobId) || !deliveryId || deliveryId.length > 1000 || /[\/\x00-\x1f]/.test(deliveryId) || !LEASE_ID.test(leaseId) ||
        !["ATTEMPT", "SENT", "ERROR", "UNCERTAIN"].includes(outcome)) fail("invalid-argument", "Reporte inválido.");
    if (data.errorCode !== undefined && (typeof data.errorCode !== "string" || !ERROR_CODE.test(data.errorCode))) fail("invalid-argument", "Reporte inválido.");
    if (data.messageIds !== undefined && (!Array.isArray(data.messageIds) || data.messageIds.length > 10 ||
        data.messageIds.some((value: unknown) => typeof value !== "string" || value.length > 200))) fail("invalid-argument", "Reporte inválido.");

    const nowMs = Date.now();
    const jobRef = this.db.doc(`documentDeliveryJobs/${jobId}`);
    const [jobSnap, deliveries] = await Promise.all([tx.get(jobRef), tx.get(jobRef.collection("deliveries"))]);
    const job = jobSnap.data();
    if (!job || clean(job.rootId, 200) !== binding.rootId) fail("permission-denied");
    const target = deliveries.docs.find((doc: any) => doc.id === deliveryId);
    const row = target?.data();
    if (!target || !row) fail();
    const decision = decideReport(row, { outcome, leaseId, bindingId: binding.id, generation: binding.generation }, nowMs);
    if (decision.action === "REJECT") fail("failed-precondition", `Reporte rechazado: ${decision.reason}.`);
    if (decision.action === "ALREADY_SENT") return { outcome, deliveryStatus: "SENT", duplicate: true };

    let nextStatus = clean(row.status, 80);
    if (decision.action === "ATTEMPT_AUTHORIZED") {
      tx.update(target.ref, { attemptStartedAtMs: nowMs, attemptStartedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      return { outcome, deliveryStatus: "SENDING", attemptAuthorized: true };
    }
    if (decision.action === "MARK_SENT") {
      nextStatus = "SENT";
      tx.update(target.ref, { status: "SENT", sentAt: FieldValue.serverTimestamp(), sentAtMs: nowMs, retryBlocked: false,
        whatsappMessageIds: Array.isArray(data.messageIds) ? data.messageIds : [], lastError: null, updatedAt: FieldValue.serverTimestamp() });
      this.audit(tx, "WHATSAPP_DOCUMENTO_ENVIADO", binding.rootId, job, jobId, row, this.describe(job, row, "enviado"),
        row.status === "SEND_UNCERTAIN" ? { resolvedUncertain: true } : {});
    } else if (decision.action === "MARK_ERROR") {
      nextStatus = "ERROR";
      const code = clean(data.errorCode, 60) || "SEND_FAILED_BEFORE_ATTEMPT";
      tx.update(target.ref, { status: "ERROR", lastError: code, errorAt: FieldValue.serverTimestamp(), lease: null, updatedAt: FieldValue.serverTimestamp() });
      this.audit(tx, "WHATSAPP_DOCUMENTO_ENVIO_FALLIDO", binding.rootId, job, jobId, row, this.describe(job, row, "no se pudo enviar"), { reason: code });
    } else {
      nextStatus = "SEND_UNCERTAIN";
      const code = clean(data.errorCode, 60) || "SEND_OUTCOME_UNKNOWN";
      tx.update(target.ref, { status: "SEND_UNCERTAIN", retryBlocked: true, uncertainReason: code, uncertainAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      this.audit(tx, "WHATSAPP_DOCUMENTO_ENVIO_BLOQUEADO", binding.rootId, job, jobId, row,
        this.describe(job, row, "quedó sin confirmar; requiere revisión antes de reenviar"), { reason: code });
    }
    const statuses = deliveries.docs.map((doc: any) => (doc.id === deliveryId ? nextStatus : clean(doc.get("status"), 80)));
    tx.update(jobRef, { status: aggregateJobStatus(statuses, clean(job.status, 80)), updatedAt: FieldValue.serverTimestamp() });
    return { outcome, deliveryStatus: nextStatus };
  }
}
