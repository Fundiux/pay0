import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db } from "../sharedCallables/helpers";
import { assertAuthorized } from "../../utils/authGuard";
import { logActivityTx } from "../../utils/logActivity";
import { context } from "./callables";

// Acknowledgement is administrative evidence, never a retry or a recovery result.
export const listOperationRecoveryReviews = onCall({ region: "us-central1", timeoutSeconds: 30 }, async request => {
  const { rootId } = await context(request, true);
  const cursorId = request.data?.cursor;
  if (cursorId !== undefined && (typeof cursorId !== "string" || !/^[a-f0-9]{64}$/.test(cursorId))) throw new HttpsError("invalid-argument", "Cursor de revisión inválido.");
  let query = db.collection("operationRecoveryJobs").where("rootId", "==", rootId).where("status", "==", "NEEDS_REVIEW").orderBy(FieldPath.documentId()).limit(51);
  if (cursorId) {
    const cursor = await db.doc(`operationRecoveryJobs/${cursorId}`).get();
    if (!cursor.exists || cursor.get("rootId") !== rootId) throw new HttpsError("permission-denied", "Cursor fuera de tu ámbito.");
    if (cursor.get("status") !== "NEEDS_REVIEW") throw new HttpsError("failed-precondition", "La lista cambió. Actualiza desde la primera página.");
    query = query.startAfter(cursor);
  }
  const jobs = await query.get();
  const rows = await Promise.all(jobs.docs.slice(0, 50).map(async doc => {
    const job = doc.data();
    const review = await db.doc(`operationRecoveryReviews/${doc.id}`).get();
    const acknowledged = review.exists && review.get("rootId") === rootId;
    return { id: doc.id, solicitudId: String(job.solicitudId || ""), kind: String(job.kind || ""), status: "NEEDS_REVIEW" as const,
      attempts: Number(job.attempts || 0), lastErrorCode: String(job.lastErrorCode || ""), acknowledged,
      acknowledgedBy: acknowledged ? String(review.get("actorUid") || "") : null,
      note: acknowledged ? String(review.get("note") || "") : null };
  }));
  return { ok: true, rows, truncated: jobs.size > 50, nextCursor: jobs.size > 50 ? rows.at(-1)!.id : null };
});

export const acknowledgeOperationRecoveryReview = onCall({ region: "us-central1", timeoutSeconds: 30 }, async request => {
  const { uid, rootId } = await context(request, true);
  const { jobId, note } = request.data || {};
  if (typeof jobId !== "string" || !/^[a-f0-9]{64}$/.test(jobId) || typeof note !== "string" || !note.trim() || note.trim().length > 500)
    throw new HttpsError("invalid-argument", "Selecciona una incidencia y escribe el acuerdo de revisión (máximo 500 caracteres).");
  const jobRef = db.doc(`operationRecoveryJobs/${jobId}`), reviewRef = db.doc(`operationRecoveryReviews/${jobId}`);
  return db.runTransaction(async tx => {
    const [actor, job, review] = await Promise.all([tx.get(db.doc(`users/${uid}`)), tx.get(jobRef), tx.get(reviewRef)]);
    assertAuthorized(request.auth, actor.data(), { allowedRoles: ["superadmin"], requiredModule: "reportes", requiredAction: "view" });
    if (String(actor.get("rootId") || uid) !== rootId || !job.exists || job.get("rootId") !== rootId)
      throw new HttpsError("permission-denied", "La incidencia no pertenece a tu ámbito vigente.");
    if (job.get("status") !== "NEEDS_REVIEW") throw new HttpsError("failed-precondition", "La incidencia ya no requiere revisión.");
    if (review.exists) {
      if (review.get("rootId") !== rootId) throw new HttpsError("permission-denied", "Revisión fuera de ámbito.");
      return { ok: true, created: false, jobId };
    }
    tx.create(reviewRef, { rootId, jobId, actorUid: uid, note: note.trim(), action: "ACKNOWLEDGED_ONLY",
      sourceKind: job.get("kind") || null, sourceAttempts: job.get("attempts") || 0, sourceErrorCode: job.get("lastErrorCode") || null,
      createdAt: FieldValue.serverTimestamp() });
    logActivityTx(tx, db, { event: "OPERACION_RECUPERACION_REVISADA", rootId, actorUid: uid, actorRole: "superadmin",
      referenceId: jobId, referenceType: "RECOVERY_REVIEW", description: "Incidencia revisada por administración; no se ejecutó ni declaró una recuperación." });
    return { ok: true, created: true, jobId };
  });
});
