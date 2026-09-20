import { createHash } from "crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db } from "../sharedCallables/helpers";
import { context } from "../controlCenter/callables";
import { logActivityTx } from "../../utils/logActivity";

// Recognition is explicit, evidence-backed, and separate from bank movements.
// It does not transfer money, change Wallet, or constitute fiscal deductibility.
export const recognizeControlCenterExpense = onCall({ cors: true, region: "us-central1" }, async request => {
  const { rootId, uid } = await context(request);
  const uploadId = String(request.data?.uploadId || "");
  const amountMinor = request.data?.amountMinor;
  const note = String(request.data?.note || "").trim();
  if (!/^[\w-]{1,160}$/.test(uploadId) || !Number.isSafeInteger(amountMinor) || amountMinor <= 0 || note.length < 5 || note.length > 500 || request.data?.confirmed !== true) {
    throw new HttpsError("invalid-argument", "Confirma documento, importe positivo en centavos y motivo.");
  }
  return db.runTransaction(async tx => {
    const upload = await tx.get(db.doc(`uploads/${uploadId}`)), row = upload.data();
    if (!row || row.rootId !== rootId || row.active !== true || !["CFDI_GASTO_XML", "CFDI_GASTO_PDF", "SOLICITUD_GASTO_RELACIONADA"].includes(row.documentType)) {
      throw new HttpsError("permission-denied", "Se requiere evidencia de gasto activa del mismo ámbito.");
    }
    const solicitudId = String(row.solicitudId || "");
    if (!solicitudId || solicitudId.includes("/")) throw new HttpsError("failed-precondition", "El documento no tiene solicitud.");
    const solicitud = (await tx.get(db.doc(`solicitudes/${solicitudId}`))).data();
    if (!solicitud || solicitud.rootId !== rootId) throw new HttpsError("permission-denied", "Solicitud fuera de ámbito.");
    // One recognized expense per operation prevents counting PDF and XML twice.
    // Multiple invoices must use distinct documented expense operations.
    const id = createHash("sha256").update(`${rootId}:${solicitudId}`).digest("hex");
    const ref = db.doc(`recognizedExpenses/${id}`), existing = (await tx.get(ref)).data();
    if (existing && existing.status !== "REVERSED") {
      if (existing.uploadId === uploadId && existing.amountMinor === amountMinor && existing.status === "RECOGNIZED") return { ok: true, id, reused: true };
      throw new HttpsError("already-exists", "Esta operación ya tiene un gasto reconocido. No se duplicó.");
    }
    const revision = Number(existing?.revision || 0) + 1;
    tx.set(ref, { rootId, solicitudId, uploadId, amountMinor, currency: "MXN", note, revision,
      companyId: solicitud.companyId || solicitud.empresaId || "", clientId: solicitud.clienteId || solicitud.clientId || "",
      status: "RECOGNIZED", createdBy: uid, createdAt: Timestamp.now(), accountingBasis: "MANUAL_EVIDENCE_CONFIRMED" });
    tx.create(ref.collection("revisions").doc(String(revision)), { rootId, uploadId, amountMinor, note, recognizedBy: uid, recognizedAt: FieldValue.serverTimestamp(), status: "RECOGNIZED" });
    logActivityTx(tx, db, { event: "GASTO_RECONOCIDO", rootId, actorUid: uid, actorRole: "superadmin", referenceId: solicitudId, referenceType: "SOLICITUD", amount: amountMinor / 100, description: "Gasto reconocido con evidencia documental; no implica pago ni deducibilidad fiscal." });
    return { ok: true, id, reused: false };
  });
});

export const reverseControlCenterExpense = onCall({ cors: true, region: "us-central1" }, async request => {
  const { rootId, uid } = await context(request);
  const id = String(request.data?.id || ""), reason = String(request.data?.reason || "").trim();
  if (!/^[a-f0-9]{64}$/.test(id) || reason.length < 5 || reason.length > 500) throw new HttpsError("invalid-argument", "Gasto y motivo requeridos.");
  await db.runTransaction(async tx => {
    const ref = db.doc(`recognizedExpenses/${id}`), row = (await tx.get(ref)).data();
    if (!row || row.rootId !== rootId) throw new HttpsError("permission-denied", "Gasto fuera de ámbito.");
    if (row.status === "REVERSED") return;
    tx.update(ref, { status: "REVERSED", reversedBy: uid, reversedAt: FieldValue.serverTimestamp(), reversalReason: reason });
    tx.set(ref.collection("revisions").doc(String(row.revision || 1)), { status: "REVERSED", reversedBy: uid, reversedAt: FieldValue.serverTimestamp(), reversalReason: reason }, { merge: true });
    logActivityTx(tx, db, { event: "GASTO_REVERTIDO", rootId, actorUid: uid, actorRole: "superadmin", referenceId: row.solicitudId, referenceType: "SOLICITUD", amount: row.amountMinor / 100, description: "Reconocimiento de gasto revertido; evidencia conservada." });
  });
  return { ok: true };
});
