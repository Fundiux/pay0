import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { getRole, getRootIdFromUser, getUser, getUsername, requireAuthLike } from "../../utils/auth";
import { MAX_PAGO_DOCUMENT_SIZE_BYTES, buildPagoDocumentStoragePath, getPagoDocumentTypeLabel, normalizePagoDocumentType, sanitizePagoDocumentLabel, sanitizeFilename } from "./domain";

import { logActivityTx, logActivity } from "../../utils/logActivity";
import { notifyIqPagoTelegramH4D59B } from "../iq/pagoTelegramNotifications";

const db = admin.firestore();

type PagoDocNotificationOptionsH4D64A6 = {
  telegramBotToken?: string;
};

type PagoIqTerminalContextH4D64A6 = {
  terminal: boolean;
  terminalStatus: "REJECTED" | "CANCELLED" | "";
  pay0Status: "RECHAZADO" | "CANCELADO" | "";
  iqId: string;
  reason: string;
};

function cleanTextH4D64A6(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function moneyH4D64A6(value: unknown): number {
  const parsed = Number(String(value ?? 0).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

export function getPagoIqTerminalContextH4D64A6(
  pago: Record<string, unknown>,
): PagoIqTerminalContextH4D64A6 {
  const text = [
    pago.status,
    pago.iqDepositStatus,
    pago.iqDepositReconciliationStatus,
    pago.iqDepositOperationStatus,
    pago.iqDepositTerminalStatus,
  ].map((value) => cleanTextH4D64A6(value)).join(" ").toUpperCase();

  const cancelled = /CANCEL/.test(text);
  const rejected = /RECHAZ|REJECT/.test(text);
  const terminal = pago.iqDepositTerminalLocked === true || cancelled || rejected;
  const iqId = cleanTextH4D64A6(
    pago.iqDepositId ??
    pago.iqDepositFolio ??
    pago.iqPagoDepositId ??
    pago.iqPagoDepositFolio ??
    pago.iqDepositTerminalLockedIqId ??
    "",
  );
  const terminalStatus = cancelled ? "CANCELLED" : rejected || terminal ? "REJECTED" : "";
  const pay0Status = terminalStatus === "CANCELLED" ? "CANCELADO" : terminalStatus === "REJECTED" ? "RECHAZADO" : "";
  const reason = cleanTextH4D64A6(
    pago.iqDepositTerminalReason ??
    pago.iqDepositRejectionReason ??
    pago.rejectionReason ??
    pago.cancellationReason ??
    (terminalStatus === "CANCELLED" ? "Deposito cancelado en IQ." : "Deposito rechazado en IQ."),
  );

  return {
    terminal,
    terminalStatus,
    pay0Status,
    iqId,
    reason,
  };
}

function isPagoIqTerminalForReplacementH4D58H(pago: Record<string, unknown>): boolean {
  return getPagoIqTerminalContextH4D64A6(pago).terminal;
}

export function buildPagoIqReplacementUnlockPatchH4D58H(input: {
  pago: Record<string, unknown>;
  uploadId: string;
  documentType: string;
  uid: string;
}): Record<string, unknown> {
  if (input.documentType !== "COMPROBANTE_PAGO") return {};

  const terminal = getPagoIqTerminalContextH4D64A6(input.pago);
  if (!terminal.terminal) return {};

  return {
    status: "CONCILIACION_PENDIENTE",

    iqDepositPreviousTerminalIqId: terminal.iqId || null,
    iqDepositPreviousTerminalStatus: terminal.terminalStatus || null,
    iqDepositPreviousTerminalReason: terminal.reason || null,
    iqDepositPreviousTerminalLockedAt: input.pago.iqDepositTerminalLockedAt || null,
    iqDepositPreviousTerminalUnlockedByUploadId: input.uploadId,

    iqDepositRetryOfIqId: terminal.iqId || null,
    iqDepositRetryGeneration: input.uploadId,
    iqDepositRetryStartedAt: FieldValue.serverTimestamp(),
    iqDepositRetryStartedBy: input.uid,

    iqDepositId: FieldValue.delete(),
    iqDepositFolio: FieldValue.delete(),
    iqPagoDepositId: FieldValue.delete(),
    iqPagoDepositFolio: FieldValue.delete(),

    iqDepositStatus: "READY_FOR_NEW_IQ_FOLIO",
    iqDepositReconciliationStatus: "RESET_BY_NEW_COMPROBANTE",
    iqDepositOperationStatus: FieldValue.delete(),
    iqDepositCreationStatus: "READY_FOR_RECREATE",
    iqDepositCreationRetryBlocked: false,
    iqDepositCreationLastError: null,

    iqDepositTerminalLocked: false,
    iqDepositTerminalStatus: FieldValue.delete(),
    iqDepositTerminalReason: FieldValue.delete(),
    iqDepositTerminalLockedAt: FieldValue.delete(),
    iqDepositTerminalLockedBy: FieldValue.delete(),
    iqDepositTerminalLockedSource: FieldValue.delete(),
    iqDepositTerminalLockedIqId: FieldValue.delete(),
    iqDepositTerminalUnlockedAt: FieldValue.serverTimestamp(),
    iqDepositTerminalUnlockedBy: input.uid,
    iqDepositTerminalUnlockUploadId: input.uploadId,
    iqDepositTerminalUnlockDocumentType: input.documentType,
    iqDepositTerminalUnlockRequiredDocumentType: FieldValue.delete(),
    iqDepositTerminalUnlockReason: "Nuevo comprobante subido; se habilita crear nuevo folio IQ de deposito.",

    iqDepositRejectedAt: FieldValue.delete(),
    iqDepositRejectionReason: FieldValue.delete(),
    rejectionReason: FieldValue.delete(),
    rejectedAt: FieldValue.delete(),
    rejectedBy: FieldValue.delete(),
    cancellationReason: FieldValue.delete(),
    cancelledAt: FieldValue.delete(),
    cancelledBy: FieldValue.delete(),

    iqDepositAutomationOmitted: false,
    iqDepositFollowupStatus: "PENDING_NEW_FOLIO",
    // H4_D87_A58_CLEAR_LEGACY_ON_DEMAND_STATE
    iqDepositOnDemandGeneration: FieldValue.delete(),
    iqDepositOnDemandStatus: FieldValue.delete(),
    iqDepositOnDemandOperation: FieldValue.delete(),
    iqDepositOnDemandAttempt: FieldValue.delete(),
    iqDepositOnDemandTaskId: FieldValue.delete(),
    iqDepositOnDemandTaskDuplicate: FieldValue.delete(),
    iqDepositOnDemandNextAttemptAt: FieldValue.delete(),
    iqDepositOnDemandCompletedAt: FieldValue.delete(),
    iqDepositOnDemandStartedAt: FieldValue.delete(),
    iqDepositOnDemandLastMessage: FieldValue.delete(),
    iqDepositOnDemandLastError: FieldValue.delete(),
    iqDepositOnDemandLastErrorAt: FieldValue.delete(),

    iqDepositUpdatedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}
// H4_D64_A6_PAGO_DOC_UNLOCK_HELPERS
function cleanTextH4D62B(value: unknown): string {
  return String(value ?? "").trim();
}

function cleanUpperH4D62B(value: unknown): string {
  return cleanTextH4D62B(value).toUpperCase();
}

function getPagoIqDepositIdH4D62B(pago: Record<string, unknown>): string {
  return cleanTextH4D62B(
    pago.iqDepositId ??
    pago.iqDepositFolio ??
    pago.iqPagoDepositId ??
    pago.iqPagoDepositFolio ??
    "",
  );
}

export function buildPagoIqAutoQueuePatchH4D62B(input: {
  pago: Record<string, unknown>;
  uploadId: string;
  documentType: string;
  uid: string;
  terminalUnlockApplied: boolean;
}): Record<string, unknown> {
  if (input.documentType !== "COMPROBANTE_PAGO") return {};

  const status = cleanUpperH4D62B(input.pago.status);
  const existingIqId = getPagoIqDepositIdH4D62B(input.pago);
  const creationStatus = cleanUpperH4D62B(input.pago.iqDepositCreationStatus);
  const retryBlocked = input.pago.iqDepositCreationRetryBlocked === true;

  if (existingIqId && !input.terminalUnlockApplied) return {};

  if (!input.terminalUnlockApplied && (
    status === "CONCILIADO" ||
    status === "APLICADO_PARCIAL" ||
    status === "APLICADO_TOTAL" ||
    status === "CANCELADO"
  )) {
    return {};
  }

  if (!input.terminalUnlockApplied && (
    creationStatus === "PROCESSING" ||
    creationStatus === "CREATED" ||
    creationStatus === "CREATED_RECOVERED" ||
    creationStatus === "OUTCOME_UNKNOWN" ||
    retryBlocked
  )) {
    return {};
  }

  if (!input.terminalUnlockApplied && input.pago.iqDepositAutomationOmitted === true) {
    return {};
  }

  return {
    iqDepositAutomationMode: "AUTO",
    iqDepositAutomationTrigger: "COMPROBANTE_PAGO_READY",
    iqDepositAutomationRequestedAt: FieldValue.serverTimestamp(),

    iqDepositCreationStatus: "QUEUED",
    iqDepositCreationQueuedAt: FieldValue.serverTimestamp(),
    iqDepositCreationQueuedBy: input.uid,
    iqDepositCreationQueuedUploadId: input.uploadId,
    iqDepositCreationRetryBlocked: false,
    iqDepositCreationLastError: null,

    iqDepositFollowupStatus: "QUEUED",
    iqDepositAutoCreateLastError: null,

    iqDepositUpdatedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}
// H4_D62B_PAGO_DOC_COMPROBANTE_AUTO_QUEUE_HELPERS

function canUploadPagoDocs(user: any): boolean {
  const role = getRole(user);
  const modules = user?.modules || {};

  if (role === "superadmin" || role === "admin") return true;
  if (modules?.pagos?.create === true) return true;
  if (modules?.pagos?.conciliate === true) return true;
  if (modules?.pagos?.uploadDocs === true) return true;

  return false;
}

async function loadPagoOrThrow(params: {
  pagoId: string;
  uid: string;
  user: any;
  rootId: string;
}) {
  const pagoRef = db.collection("pagos").doc(params.pagoId);
  const pagoSnap = await pagoRef.get();

  if (!pagoSnap.exists) {
    throw new HttpsError("not-found", "Pago no encontrado.");
  }

  const pago = pagoSnap.data() || {};
  if (String(pago.rootId || "") !== String(params.rootId || "")) {
    throw new HttpsError("permission-denied", "No autorizado para este pago.");
  }

  return { pagoRef, pago };
}

export async function initPagoDocumentUploadCore(request: any) {
  const uid = requireAuthLike(request);
  const user = await getUser(uid);

  if (!user) {
    throw new HttpsError("permission-denied", "Usuario no encontrado.");
  }

  if (!canUploadPagoDocs(user)) {
    throw new HttpsError("permission-denied", "No autorizado para subir documentos de pagos.");
  }

  const rootId = getRootIdFromUser(user, uid);
  const data = request.data || {};

  const pagoId = String(data.pagoId || data.entityId || "").trim();
  const originalName = String(data.originalName || data.filename || "").trim();
  const contentType = String(data.contentType || "application/octet-stream").trim();
  const sizeBytes = Number(data.sizeBytes || 0);
  const documentType = normalizePagoDocumentType(data.documentType);
  const customDocumentTypeLabel = sanitizePagoDocumentLabel(data.customDocumentTypeLabel || data.otherDocumentTypeLabel || "");
  const documentTypeLabel =
    documentType === "OTRO" && customDocumentTypeLabel
      ? customDocumentTypeLabel
      : getPagoDocumentTypeLabel(documentType);

  if (!pagoId || !originalName) {
    throw new HttpsError("invalid-argument", "pagoId y originalName son obligatorios.");
  }

  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new HttpsError("invalid-argument", "Tamano de archivo invalido.");
  }

  if (sizeBytes > MAX_PAGO_DOCUMENT_SIZE_BYTES) {
    throw new HttpsError("invalid-argument", "El archivo excede el limite de 1 MB.");
  }

  const inputSha256 = String(data.sha256 || data.fileSha256 || "").trim().toLowerCase();
  const sha256 = /^[a-f0-9]{64}$/.test(inputSha256) ? inputSha256 : "";

  const { pago } = await loadPagoOrThrow({
    pagoId,
    uid,
    user,
    rootId,
  });

  const safeName = sanitizeFilename(originalName);
  const uploadId = db.collection("uploads").doc().id;
  const storagePath = buildPagoDocumentStoragePath({ rootId, pagoId, documentType, uploadId, originalName: safeName });

  await db.collection("uploads").doc(uploadId).set({
    rootId,
    adminId: pago.adminId || rootId,
    clienteId: pago.clienteId || pago.clientId || null,
    clienteNombre: pago.clienteNombre || pago.clientName || null,
    companyId: pago.companyId || null,
    empresaNombre: pago.empresaNombre || pago.companyName || null,

    entityType: "pagos",
    entityId: pagoId,
    pagoId,
    pagoFolio: pago.folio || pago.referenceFolio || pago.pagoFolio || pagoId,
    pagoReferencia: pago.referencia || null,

    documentType,
    documentTypeLabel,
    originalName,
    filename: safeName,
    contentType,
    sizeBytes,
    storagePath,

    sha256: sha256 || null,
    integrityHashAlgorithm: sha256 ? "SHA-256" : null,
    integritySealStatus: sha256 ? "HASH_CLIENT_REPORTED" : "NO_HASH",
    integritySealVersion: "PAY0-MATERIALIDAD-V1",

    status: "PENDING",
    active: false,
    version: null,

    createdBy: uid,
    createdUsername: getUsername(user, uid),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return {
    ok: true,
    uploadId,
    storagePath,
    sha256: sha256 || null,
    integrityHashAlgorithm: sha256 ? "SHA-256" : null,
    integritySealStatus: sha256 ? "HASH_CLIENT_REPORTED" : "NO_HASH",
    integritySealVersion: "PAY0-MATERIALIDAD-V1",
    documentType,
  };
}

export async function finalizePagoDocumentUploadCore(
  request: any,
  options: PagoDocNotificationOptionsH4D64A6 = {},
) {
  const uid = requireAuthLike(request);
  const user = await getUser(uid);

  if (!user) {
    throw new HttpsError("permission-denied", "Usuario no encontrado.");
  }

  if (!canUploadPagoDocs(user)) {
    throw new HttpsError("permission-denied", "No autorizado para finalizar documentos de pagos.");
  }

  const rootId = getRootIdFromUser(user, uid);
  const data = request.data || {};

  const uploadId = String(data.uploadId || "").trim();
  const storagePathIn = String(data.storagePath || "").trim();

  if (!uploadId) {
    throw new HttpsError("invalid-argument", "uploadId requerido.");
  }

  const uploadRef = db.collection("uploads").doc(uploadId);
  const uploadSnap = await uploadRef.get();

  if (!uploadSnap.exists) {
    throw new HttpsError("not-found", "Upload no existe.");
  }

  const upload = uploadSnap.data() || {};

  if (String(upload.rootId || "") !== rootId) {
    throw new HttpsError("permission-denied", "No autorizado.");
  }

  if (String(upload.entityType || "") !== "pagos") {
    throw new HttpsError("failed-precondition", "Upload no pertenece a pagos.");
  }

  const pagoId = String(upload.pagoId || upload.entityId || "").trim();
  const documentType = normalizePagoDocumentType(upload.documentType);

  if (!pagoId) {
    throw new HttpsError("failed-precondition", "Upload sin pagoId.");
  }

  await loadPagoOrThrow({
    pagoId,
    uid,
    user,
    rootId,
  });

  if (storagePathIn && storagePathIn !== String(upload.storagePath || "")) {
    throw new HttpsError("invalid-argument", "storagePath no coincide con el registro.");
  }

  try {
    const bucket = admin.storage().bucket();
    const [exists] = await bucket.file(String(upload.storagePath || "")).exists();

    if (!exists) {
      throw new HttpsError("failed-precondition", "El archivo no existe en Storage.");
    }
  } catch (e: any) {
    if (e instanceof HttpsError) throw e;
    throw new HttpsError("internal", "No se pudo verificar el archivo en Storage.");
  }

  let finalVersion = 1;
  let terminalUnlockAppliedH4D64A6 = false;
  let terminalContextH4D64A6: PagoIqTerminalContextH4D64A6 = {
    terminal: false,
    terminalStatus: "",
    pay0Status: "",
    iqId: "",
    reason: "",
  };
  let pagoForNotificationH4D64A6: Record<string, unknown> = {};

  await db.runTransaction(async (tx) => {
    const pagoRefH4D58H = db.collection("pagos").doc(pagoId);
    const pagoSnapH4D58H = await tx.get(pagoRefH4D58H);
    const pagoH4D58H = pagoSnapH4D58H.exists ? ((pagoSnapH4D58H.data() || {}) as Record<string, unknown>) : {};
    terminalContextH4D64A6 = getPagoIqTerminalContextH4D64A6(pagoH4D58H);
    pagoForNotificationH4D64A6 = pagoH4D58H;
    // H4_D64_A6_PAGO_DOC_TX_READ_TERMINAL_CONTEXT
    const activeQuery = db
      .collection("uploads")
      .where("rootId", "==", rootId)
      .where("pagoId", "==", pagoId)
      .where("documentType", "==", documentType)
      .where("active", "==", true);

    const activeSnap = await tx.get(activeQuery);

    let maxVersion = 0;
    const terminalReplacementH4D64A6 =
      documentType === "COMPROBANTE_PAGO" && terminalContextH4D64A6.terminal;

    activeSnap.docs.forEach((doc) => {
      const row: any = doc.data() || {};
      const currentVersion = Number(row.version || 0);
      if (currentVersion > maxVersion) maxVersion = currentVersion;

      tx.update(doc.ref, {
        active: false,
        status: terminalReplacementH4D64A6
          ? terminalContextH4D64A6.terminalStatus === "CANCELLED"
            ? "CANCELLED_IQ"
            : "REJECTED_IQ"
          : "REPLACED",
        replacedByUploadId: uploadId,
        replacedAt: FieldValue.serverTimestamp(),
        ...(terminalReplacementH4D64A6
          ? {
              iqTerminalFolio: terminalContextH4D64A6.iqId || null,
              iqTerminalStatus: terminalContextH4D64A6.terminalStatus || null,
              iqTerminalReason: terminalContextH4D64A6.reason || null,
              iqTerminalClosedAt: FieldValue.serverTimestamp(),
              documentStateLabel:
                terminalContextH4D64A6.terminalStatus === "CANCELLED"
                  ? terminalContextH4D64A6.iqId
                    ? `CANCELADO - FOLIO IQ ${terminalContextH4D64A6.iqId}`
                    : "CANCELADO EN IQ"
                  : terminalContextH4D64A6.iqId
                    ? `RECHAZADO - FOLIO IQ ${terminalContextH4D64A6.iqId}`
                    : "RECHAZADO EN IQ",
            }
          : {}),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    finalVersion = maxVersion + 1;

    tx.update(uploadRef, {
      status: "READY",
      active: true,
      version: finalVersion,
      finalizedBy: uid,
      finalizedUsername: getUsername(user, uid),
      finalizedAt: FieldValue.serverTimestamp(),
      integritySealStatus: upload.sha256 ? "SEALED" : "SEALED_NO_HASH",
      integritySealedAt: FieldValue.serverTimestamp(),
      integritySealedBy: uid,
      integritySealedUsername: getUsername(user, uid),
      ...(terminalReplacementH4D64A6
        ? {
            iqRetryForTerminalFolio: terminalContextH4D64A6.iqId || null,
            iqRetryForTerminalStatus: terminalContextH4D64A6.terminalStatus || null,
            iqRetryGeneration: uploadId,
            documentStateLabel: "NUEVO COMPROBANTE - NUEVO FOLIO IQ PENDIENTE",
          }
        : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const iqUnlockPatchH4D58H = buildPagoIqReplacementUnlockPatchH4D58H({
      pago: pagoH4D58H,
      uploadId,
      documentType,
      uid,
    });

    const iqUnlockAppliedH4D62B = Object.keys(iqUnlockPatchH4D58H).length > 0;
    terminalUnlockAppliedH4D64A6 = iqUnlockAppliedH4D62B;

    if (iqUnlockAppliedH4D62B) {
      tx.set(pagoRefH4D58H, iqUnlockPatchH4D58H, { merge: true });
    }
    // H4_D64_A6_PAGO_DOC_UNLOCK_WRITE

    const iqAutoQueuePatchH4D62B = buildPagoIqAutoQueuePatchH4D62B({
      pago: pagoH4D58H,
      uploadId,
      documentType,
      uid,
      terminalUnlockApplied: iqUnlockAppliedH4D62B,
    });

    if (Object.keys(iqAutoQueuePatchH4D62B).length > 0) {
      tx.set(pagoRefH4D58H, iqAutoQueuePatchH4D62B, { merge: true });
    }
    // H4_D62B_PAGO_DOC_COMPROBANTE_AUTO_QUEUE_WRITE
    logActivityTx(tx, db, {
      event: "DOCUMENTO_PAGO_SUBIDO",
      rootId,
      adminId: upload.adminId || rootId,
      actorUid: uid,
      actorUsername: getUsername(user, uid),
      actorRole: getRole(user),
      entityType: "pagos",
      entityId: pagoId,
      referenceId: pagoId,
      referenceFolio: upload.pagoFolio || pagoId,
      referenceType: "pagoDocument",
      description: `Documento ${upload.documentTypeLabel || getPagoDocumentTypeLabel(documentType)} subido a pago ${upload.pagoFolio || pagoId}.`,
      createdBy: uid,
      extra: {
        source: "pagoDocs",
        clientId: upload.clienteId || upload.clientId || null,
        clienteId: upload.clienteId || upload.clientId || null,
        clientName: upload.clienteNombre || upload.clientName || null,
        clienteNombre: upload.clienteNombre || upload.clientName || null,
        companyId: upload.companyId || null,
        empresaNombre: upload.empresaNombre || upload.companyName || null,
        documentType,
        documentTypeLabel: upload.documentTypeLabel || getPagoDocumentTypeLabel(documentType),
        uploadId,
      },
    });
  });

  if (terminalUnlockAppliedH4D64A6) {
    const terminalFolio = terminalContextH4D64A6.iqId || "sin folio";

    await db.collection("pagos").doc(pagoId).collection("notas").add({
      rootId,
      text: `Nuevo comprobante recibido. El folio IQ terminal ${terminalFolio} queda historico y se habilita un nuevo intento.`,
      createdBy: uid,
      createdByName: getUsername(user, uid),
      createdByRole: getRole(user),
      createdAt: FieldValue.serverTimestamp(),
      source: "PAGO_DOC_RETRY_H4_D64_A6",
      uploadId,
      previousIqId: terminalContextH4D64A6.iqId || null,
    }).catch(() => undefined);

    if (options.telegramBotToken) {
      await notifyIqPagoTelegramH4D59B({
        botToken: options.telegramBotToken,
        auth: {
          uid,
          role: getRole(user),
          rootId,
          user: user as Record<string, unknown>,
        },
        event: "IQ_PAGO_NUEVO_COMPROBANTE",
        pagoId,
        pago: pagoForNotificationH4D64A6,
        iqId: terminalContextH4D64A6.iqId || null,
        source: "PAGO_DOC_RETRY_H4_D64_A6",
        dedupeKey: uploadId,
        message: `Nuevo comprobante recibido. El folio IQ ${terminalFolio} queda cerrado como historico y se habilita un nuevo folio.`,
      }).catch(() => undefined);
    }
  }

  return {
    ok: true,
    uploadId,
    pagoId,
    version: finalVersion,
    terminalUnlockApplied: terminalUnlockAppliedH4D64A6,
    previousIqId: terminalUnlockAppliedH4D64A6
      ? terminalContextH4D64A6.iqId || null
      : null,
  };
}


export function validateRejectedPagoAmountCorrectionH4D64A7(input: {
  role: string;
  pago: Record<string, unknown>;
  newAmount: number;
  hasRegisteredApplications: boolean;
}): {
  previousAmount: number;
  terminalIqId: string;
  correctionVersion: number;
} {
  if (cleanTextH4D64A6(input.role).toLowerCase() !== "superadmin") {
    throw new HttpsError(
      "permission-denied",
      "Solo superadmin puede corregir el monto de un pago rechazado.",
    );
  }

  const terminal = getPagoIqTerminalContextH4D64A6(input.pago);
  const status = cleanTextH4D64A6(input.pago.status).toUpperCase();

  if (
    !terminal.terminal ||
    terminal.terminalStatus !== "REJECTED" ||
    status !== "RECHAZADO"
  ) {
    throw new HttpsError(
      "failed-precondition",
      "El monto solo puede corregirse mientras el pago sigue bloqueado por rechazo IQ.",
    );
  }

  const applied = moneyH4D64A6(
    input.pago.montoAplicadoSolicitudes ??
    input.pago.montoAplicado ??
    0,
  );

  if (applied > 0) {
    throw new HttpsError(
      "failed-precondition",
      "No se puede corregir el monto porque el pago ya tiene aplicaciones.",
    );
  }

  const financialPostingStatus = cleanTextH4D64A6(input.pago.financialPostingStatus).toUpperCase();
  const walletPostingStatus = cleanTextH4D64A6(input.pago.walletPostingStatus).toUpperCase();
  if (financialPostingStatus === "POSTED" || walletPostingStatus === "POSTED") {
    throw new HttpsError(
      "failed-precondition",
      "No se puede corregir el monto porque el pago ya tiene posteo financiero.",
    );
  }

  if (input.hasRegisteredApplications) {
    throw new HttpsError(
      "failed-precondition",
      "No se puede corregir el monto porque existen aplicaciones registradas.",
    );
  }

  const previousAmount = moneyH4D64A6(
    input.pago.montoTotal ?? input.pago.montoTotalCanonico,
  );

  if (previousAmount === input.newAmount) {
    throw new HttpsError(
      "failed-precondition",
      "El monto corregido es igual al monto actual.",
    );
  }

  return {
    previousAmount,
    terminalIqId: terminal.iqId,
    correctionVersion: Math.max(
      1,
      Math.floor(Number(input.pago.iqDepositAmountCorrectionVersion || 0)) + 1,
    ),
  };
}
// H4_D64_A7_PURE_AMOUNT_POLICY

export async function updateRejectedPagoAmountForRetryCore(
  request: any,
  options: PagoDocNotificationOptionsH4D64A6 = {},
) {
  const uid = requireAuthLike(request);
  const user = await getUser(uid);

  if (!user) {
    throw new HttpsError("permission-denied", "Usuario no encontrado.");
  }

  const role = getRole(user);
  if (role !== "superadmin") {
    throw new HttpsError(
      "permission-denied",
      "Solo superadmin puede corregir el monto de un pago rechazado.",
    );
  }

  const rootId = getRootIdFromUser(user, uid);
  const data = request.data || {};
  const pagoId = cleanTextH4D64A6(data.pagoId);
  const newAmount = moneyH4D64A6(data.montoTotal ?? data.newAmount);
  const reason = cleanTextH4D64A6(data.reason ?? data.motivo);

  if (!pagoId) {
    throw new HttpsError("invalid-argument", "pagoId requerido.");
  }

  if (!Number.isFinite(newAmount) || newAmount <= 0 || newAmount > 999999999.99) {
    throw new HttpsError("invalid-argument", "Monto corregido invalido.");
  }

  if (reason.length < 3) {
    throw new HttpsError("invalid-argument", "Indica el motivo de la correccion.");
  }

  const pagoRef = db.collection("pagos").doc(pagoId);
  let previousAmount = 0;
  let pagoForNotification: Record<string, unknown> = {};
  let terminalIqId = "";
  let correctionVersion = 1;

  await db.runTransaction(async (tx) => {
    const pagoSnap = await tx.get(pagoRef);
    if (!pagoSnap.exists) {
      throw new HttpsError("not-found", "Pago no encontrado.");
    }

    const pago = (pagoSnap.data() || {}) as Record<string, unknown>;
    if (cleanTextH4D64A6(pago.rootId) !== rootId) {
      throw new HttpsError("permission-denied", "No autorizado para este pago.");
    }

    const applicationQuery = db
      .collection("pagoAplicaciones")
      .where("pagoId", "==", pagoId)
      .limit(1);
    const applicationSnap = await tx.get(applicationQuery);

    const policy = validateRejectedPagoAmountCorrectionH4D64A7({
      role,
      pago,
      newAmount,
      hasRegisteredApplications: !applicationSnap.empty,
    });

    previousAmount = policy.previousAmount;
    terminalIqId = policy.terminalIqId;
    correctionVersion = policy.correctionVersion;
    pagoForNotification = {
      ...pago,
      montoTotal: newAmount,
      montoTotalCanonico: newAmount,
    };

    tx.update(pagoRef, {
      montoTotal: newAmount,
      montoTotalCanonico: newAmount,
      montoAplicado: 0,
      montoDisponible: 0,
      montoAplicadoSolicitudes: 0,
      montoDisponibleSolicitudes: 0,

      iqDepositExpectedAmount: newAmount,
      iqDepositAmountPrevious: previousAmount,
      iqDepositAmountCorrectionVersion: correctionVersion,
      iqDepositAmountCorrectionReason: reason,
      iqDepositAmountCorrectedAt: FieldValue.serverTimestamp(),
      iqDepositAmountCorrectedBy: uid,
      iqDepositAmountCorrectedByName: getUsername(user, uid),
      iqDepositAmountCorrectionPendingReceipt: true,
      iqDepositAmountCorrectionTerminalIqId: terminalIqId || null,

      financialPostingStatus: "PENDING",
      walletPostingStatus: "PENDING",
      financialSnapshotId: null,
      updatedAt: FieldValue.serverTimestamp(),
      iqDepositUpdatedAt: FieldValue.serverTimestamp(),
    });

    logActivityTx(tx, db, {
      event: "PAGO_MONTO_CORREGIDO_RECHAZO_IQ",
      rootId,
      adminId: (pago.adminId as string) || rootId,
      actorUid: uid,
      actorUsername: getUsername(user, uid),
      actorRole: role,
      entityType: "pagos",
      entityId: pagoId,
      referenceId: pagoId,
      referenceFolio: cleanTextH4D64A6(pago.folio ?? pago.referenceFolio ?? pagoId),
      referenceType: "pago",
      description: `Monto de pago corregido de ${previousAmount.toFixed(2)} a ${newAmount.toFixed(2)} antes de nuevo comprobante.`,
      createdBy: uid,
      amount: newAmount,
      extra: {
        source: "H4_D64_A6_CONTROLLED_AMOUNT_EDIT",
        previousAmount,
        newAmount,
        reason,
        terminalIqId: terminalIqId || null,
        correctionVersion,
      },
    });
  });

  await pagoRef.collection("notas").add({
    rootId,
    text: `Monto corregido de ${previousAmount.toFixed(2)} a ${newAmount.toFixed(2)} antes de subir el nuevo comprobante. Motivo: ${reason}`,
    createdBy: uid,
    createdByName: getUsername(user, uid),
    createdByRole: role,
    createdAt: FieldValue.serverTimestamp(),
    source: "H4_D64_A6_CONTROLLED_AMOUNT_EDIT",
    previousAmount,
    newAmount,
    terminalIqId: terminalIqId || null,
  }).catch(() => undefined);

  if (options.telegramBotToken) {
    await notifyIqPagoTelegramH4D59B({
      botToken: options.telegramBotToken,
      auth: {
        uid,
        role,
        rootId,
        user: user as Record<string, unknown>,
      },
      event: "IQ_PAGO_MONTO_CORREGIDO",
      pagoId,
      pago: pagoForNotification,
      iqId: terminalIqId || null,
      source: "H4_D64_A6_CONTROLLED_AMOUNT_EDIT",
      dedupeKey: `amount-v${correctionVersion}-${Math.round(newAmount * 100)}`,
      message: `Monto corregido de ${previousAmount.toFixed(2)} a ${newAmount.toFixed(2)}. El pago permanece bloqueado hasta subir un nuevo comprobante. Motivo: ${reason}`,
    }).catch(() => undefined);
  }

  return {
    ok: true,
    pagoId,
    previousAmount,
    newAmount,
    correctionVersion,
    terminalIqId: terminalIqId || null,
    requiresNewReceipt: true,
  };
}

// H4_D64_A6_CONTROLLED_REJECTED_AMOUNT_EDIT

export async function deactivatePagoDocumentCore(request: any) {
  const uid = requireAuthLike(request);
  const user = await getUser(uid);

  if (!user) {
    throw new HttpsError("permission-denied", "Usuario no encontrado.");
  }

  if (!canUploadPagoDocs(user)) {
    throw new HttpsError("permission-denied", "No autorizado para desactivar documentos de pagos.");
  }

  const rootId = getRootIdFromUser(user, uid);
  const uploadId = String(request?.data?.uploadId || "").trim();

  if (!uploadId) {
    throw new HttpsError("invalid-argument", "uploadId requerido.");
  }

  const uploadRef = db.collection("uploads").doc(uploadId);
  const uploadSnap = await uploadRef.get();

  if (!uploadSnap.exists) {
    throw new HttpsError("not-found", "Documento no existe.");
  }

  const upload = uploadSnap.data() || {};

  if (String(upload.rootId || "") !== rootId) {
    throw new HttpsError("permission-denied", "No autorizado.");
  }

  if (String(upload.entityType || "") !== "pagos") {
    throw new HttpsError("failed-precondition", "Documento no pertenece a pagos.");
  }

  const pagoId = String(upload.pagoId || upload.entityId || "").trim();

  if (pagoId) {
    await loadPagoOrThrow({
      pagoId,
      uid,
      user,
      rootId,
    });
  }

  await uploadRef.update({
    active: false,
    status: "DISABLED",
    disabledBy: uid,
    disabledUsername: getUsername(user, uid),
    disabledAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await logActivity({
    event: "DOCUMENTO_PAGO_DESACTIVADO",
    rootId,
    adminId: upload.adminId || rootId,
    actorUid: uid,
    actorUsername: getUsername(user, uid),
    actorRole: getRole(user),
    entityType: "pagos",
    entityId: pagoId || upload.entityId || uploadId,
    referenceId: pagoId || upload.entityId || uploadId,
    referenceFolio: upload.pagoFolio || pagoId || uploadId,
    referenceType: "pagoDocument",
    description: `Documento ${upload.documentTypeLabel || upload.documentType || "OTRO"} desactivado en pago ${upload.pagoFolio || pagoId || uploadId}.`,
    createdBy: uid,
    extra: {
      source: "pagoDocs",
      clientId: upload.clienteId || upload.clientId || null,
      clienteId: upload.clienteId || upload.clientId || null,
      clientName: upload.clienteNombre || upload.clientName || null,
      clienteNombre: upload.clienteNombre || upload.clientName || null,
      companyId: upload.companyId || null,
      empresaNombre: upload.empresaNombre || upload.companyName || null,
      documentType: upload.documentType || null,
      documentTypeLabel: upload.documentTypeLabel || null,
      uploadId,
    },
  });

  return {
    ok: true,
    uploadId,
    pagoId: pagoId || null,
  };
}