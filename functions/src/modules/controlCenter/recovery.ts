import { createHash, randomUUID } from "crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { db } from "../sharedCallables/helpers";
import { logActivityTx } from "../../utils/logActivity";
import { assertAuthorized, getUserRole } from "../../utils/authGuard";
import { requireClientOperationalAccess } from "../clientDelegations/access";

export const RECOVERY_FIELDS = {
  MATERIALITY: "materialitySyncStatus",
  DRAFT: "facturamaAutoDraftStatus",
  QUOTATION: "cotizacionAutoGenerateStatus",
  CERTIFICATE: "constanciaAutoGenerateStatus",
} as const;
export type RecoveryKind = keyof typeof RECOVERY_FIELDS;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");

// Queue entries come only from trusted backend triggers. Execution rechecks the
// original actor's current scope and each domain service's authorization.
export async function enqueueRecovery(solicitudId: string, row: any, kind: RecoveryKind) {
  if (!row.rootId || !row.createdBy) return;
  const generation = String(row.ocFiscalMetadataUploadId || "initial");
  const ref = db.collection("operationRecoveryJobs").doc(hash(`${row.rootId}:${solicitudId}:${kind}:${generation}`));
  await db.runTransaction(async tx => {
    const existing = await tx.get(ref);
    if (existing.exists && !["COMPLETED", "RESOLVED_EXTERNALLY", "SUPERSEDED"].includes(existing.data()?.status)) return;
    const automatic = kind === "DRAFT" || kind === "MATERIALITY";
    tx.set(ref, {
      rootId: row.rootId, solicitudId, actorUid: row.createdBy, kind, generation,
      status: automatic ? "PENDING" : "NEEDS_REVIEW", attempts: 0,
      ...(automatic ? { nextAttemptAt: Timestamp.now() } : { lastErrorCode: "DOCUMENT_REGENERATION_REQUIRES_REVIEW" }),
      createdAt: existing.data()?.createdAt || FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

export const queueOperationRecovery = onDocumentWritten({
  document: "solicitudes/{documentId}", region: "us-central1", retry: true,
}, async event => {
  if (!event.data?.after.exists) return;
  const row = (await db.doc(`solicitudes/${event.params.documentId}`).get()).data();
  if (!row) return;
  await reconcileRecoverySource(event.params.documentId, row);
  for (const kind of Object.keys(RECOVERY_FIELDS) as RecoveryKind[]) {
    if (row[RECOVERY_FIELDS[kind]] === "ERROR") await enqueueRecovery(event.params.documentId, row, kind);
  }
});

export async function reconcileRecoverySource(solicitudId: string, row: any) {
  const jobs = await db.collection("operationRecoveryJobs").where("solicitudId", "==", solicitudId).get();
  for (const snapshot of jobs.docs) {
    const job = snapshot.data(), field = RECOVERY_FIELDS[job.kind as RecoveryKind];
    if (job.rootId !== row.rootId || !field || !["PENDING", "RUNNING", "NEEDS_REVIEW"].includes(job.status)) continue;
    const superseded = job.generation !== String(row.ocFiscalMetadataUploadId || "initial");
    if (!superseded && row[field] === "ERROR") continue;
    await db.runTransaction(async tx => {
      const current = await tx.get(snapshot.ref);
      const source = (await tx.get(db.doc(`solicitudes/${solicitudId}`))).data();
      if (!source || source.rootId !== job.rootId || current.data()?.status === "RUNNING") return;
      const obsolete = job.generation !== String(source.ocFiscalMetadataUploadId || "initial");
      if (!obsolete && source[field] === "ERROR") return;
      tx.update(snapshot.ref, { status: obsolete ? "SUPERSEDED" : "RESOLVED_EXTERNALLY", nextAttemptAt: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
    });
  }
}

export async function executeRecovery(job: any) {
  const [source, actor] = await Promise.all([
    db.doc(`solicitudes/${job.solicitudId}`).get(), db.doc(`users/${job.actorUid}`).get(),
  ]);
  if (!source.exists || source.data()?.rootId !== job.rootId || !actor.exists ||
      (actor.data()?.rootId || job.actorUid) !== job.rootId || actor.data()?.active === false) {
    throw new Error("RECOVERY_SCOPE_DENIED");
  }
  const row = source.data()!;
  if (["CANCELADA", "CANCELADO", "RECHAZADA", "RECHAZADO"].includes(row.status) || row.isDeleted) return;
  const field = RECOVERY_FIELDS[job.kind as RecoveryKind];
  if (!field) throw new Error("RECOVERY_KIND_INVALID");
  if (row[field] !== "ERROR") return;
  // A new OC supersedes a pending task for the previous document.
  if (String(row.ocFiscalMetadataUploadId || "initial") !== job.generation) return;
  const auth = { uid: job.actorUid, token: { uid: job.actorUid, role: actor.data()?.role } };
  const role = getUserRole(actor.data());
  assertAuthorized(auth, actor.data(), { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "solicitudes", requiredAction: "uploadDocs" });
  if ((role === "admin" && row.adminId !== job.actorUid) || (role === "operador" && row.createdBy !== job.actorUid)) throw Error("RECOVERY_OWNER_DENIED");
  const companyId = String(row.companyId || row.empresaId || ""), clientId = String(row.clienteId || row.clientId || "");
  if (!companyId || !clientId || companyId.includes("/") || clientId.includes("/")) throw Error("RECOVERY_RELATIONS_MISSING");
  await requireClientOperationalAccess({ uid: job.actorUid, role, rootId: job.rootId, clientId, permission: "operateSolicitudes" });
  const company = (await db.doc(`companies/${companyId}`).get()).data();
  if (!company || company.rootId !== job.rootId || company.active === false) throw Error("RECOVERY_COMPANY_DENIED");
  if (role !== "superadmin") {
    const direct = await db.doc(`userCompanyAccess/${job.actorUid}/companies/${companyId}`).get();
    let allowed = direct.data()?.active === true;
    if (!allowed) {
      const dispatches = await db.collection(`userDespachoAccess/${job.actorUid}/despachos`).where("active", "==", true).get();
      for (const dispatch of dispatches.docs) if ((await db.doc(`dispatchCompanyAccess/${dispatch.id}/companies/${companyId}`).get()).data()?.active === true) { allowed = true; break; }
    }
    if (!allowed) throw Error("RECOVERY_COMPANY_ACCESS_REVOKED");
  }
  const request = { auth, data: { solicitudId: job.solicitudId } };
  switch (job.kind as RecoveryKind) {
    case "MATERIALITY":
      await (await import("../materiality/service")).linkSolicitudToMaterialityOperationCore(request); break;
    case "DRAFT":
      {
        const result = await (await import("../facturama/service")).ensureAutomaticFacturamaDraftForSolicitud({ auth, solicitudId: job.solicitudId, source: "OC_UPLOAD" });
        if (!result.ok) throw new Error(`DRAFT_${result.reason}`);
        break;
      }
    case "QUOTATION":
      throw new Error("DOCUMENT_REGENERATION_REQUIRES_REVIEW");
    case "CERTIFICATE":
      throw new Error("DOCUMENT_REGENERATION_REQUIRES_REVIEW");
  }
  // Do not overwrite a newer failure or source version while this task ran.
  await db.runTransaction(async tx => {
    const latest = await tx.get(source.ref);
    if (latest.data()?.[field] === "ERROR" && String(latest.data()?.ocFiscalMetadataUploadId || "initial") === job.generation &&
        latest.data()?.[field.replace(/Status$/, "LastError")] === row[field.replace(/Status$/, "LastError")]) {
      tx.update(source.ref, { [field]: "RECOVERED", recoveryUpdatedAt: FieldValue.serverTimestamp() });
    }
  });
}

export async function processRecoveryJobs(handler = executeRecovery) {
  const due = await db.collection("operationRecoveryJobs").where("nextAttemptAt", "<=", Timestamp.now()).limit(5).get();
  for (const doc of due.docs) {
    const lease = randomUUID();
    const job = await db.runTransaction(async tx => {
      const current = await tx.get(doc.ref); const row = current.data();
      if (!row || !["PENDING", "RUNNING"].includes(row.status) || row.nextAttemptAt.toMillis() > Date.now()) return null;
      tx.update(doc.ref, { status: "RUNNING", lease, attempts: row.attempts + 1, nextAttemptAt: Timestamp.fromMillis(Date.now() + 15 * 60_000) });
      return { ...row, attempts: row.attempts + 1 };
    });
    if (!job) continue;
    let failed = false;
    let lastErrorCode = "";
    try { await handler(job); } catch (error: any) {
      failed = true;
      const code = String(error?.code || error?.message || "RECOVERY_FAILED");
      lastErrorCode = /^[A-Z0-9_/-]{1,100}$/i.test(code) ? code : "RECOVERY_DOMAIN_ERROR";
    }
    await db.runTransaction(async tx => {
      const current = await tx.get(doc.ref);
      if (current.data()?.lease !== lease) return;
      const exhausted = failed && job.attempts >= 5;
      tx.update(doc.ref, {
        status: failed ? exhausted ? "NEEDS_REVIEW" : "PENDING" : "COMPLETED",
        lastErrorCode,
        nextAttemptAt: failed && !exhausted ? Timestamp.fromMillis(Date.now() + Math.min(60, 2 ** job.attempts) * 60_000) : FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      logActivityTx(tx, db, { event: failed ? "OPERACION_RECUPERACION_FALLIDA" : "OPERACION_RECUPERADA",
        rootId: (job as any).rootId, actorUid: "SYSTEM_RECOVERY", actorRole: "SYSTEM",
        referenceId: (job as any).solicitudId, referenceType: "SOLICITUD",
        description: `${(job as any).kind}: ${failed ? lastErrorCode : "Reconciliación terminada"}`,
      });
    });
  }
}

export const reconcileOperationRecovery = onSchedule({
  schedule: "every 5 minutes", region: "us-central1", timeoutSeconds: 540,
  memory: "1GiB", maxInstances: 1, concurrency: 1,
}, async () => { await processRecoveryJobs(); });
