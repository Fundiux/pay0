import { DEFAULT_IQ_ERP_URL } from "./config";
import { evaluateIqDispatchGate } from "../dispatches/iqGate";
import * as crypto from "crypto";
import * as os from "os";
import * as path from "path";
import { mkdtemp, rm } from "fs/promises";
import * as admin from "firebase-admin";
import type { DocumentReference, Transaction } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onTaskDispatched } from "firebase-functions/tasks";
import { defineSecret } from "firebase-functions/params";

import {
  runIqCreateInvoiceBatchHttpA53,
  type IqSolicitudHttpItemA53 as IqCreateInvoiceBatchItem,
  type IqSolicitudHttpResultA53 as IqCreateInvoiceBatchItemResult,
} from "./solicitudHttpCreateA53";
import { enqueueIqReconciliationJob } from "./solicitudReconciliationCallables";
import { enqueueIqStatusMonitorJob } from "./solicitudStatusMonitorCallables";
import { logActivity, type ActivityLogParams } from "../../utils/logActivity";
import { sendTelegramMessage } from "../telegram/service";
import { assertIqAuthorized } from "./authorization";

import { loadEnabledIqAutomationRoots } from "./automationRuntime";
import { enqueueIqOnDemandTaskH4D64 } from "./iqOnDemandTaskQueue";
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

const IQ_CREDENTIALS_KEY = defineSecret("IQ_CREDENTIALS_KEY");
const TELEGRAM_BOT_TOKEN = defineSecret("TELEGRAM_BOT_TOKEN");

const DEFAULT_IQ_TIME_ZONE = "America/Mexico_City";
const IQ_QUEUE_VERSION = "IQ-SOLICITUD-CREATE-QUEUE-1";
const IQ_CREATE_ON_DEMAND_TASK = "processIqCreateOnDemandTask";
const IQ_PREVALIDATION_VERSION = "IQ-SOLICITUD-PREVALIDATION-3";
const MAX_JOBS_PER_RUN = 25;
const MAX_QUEUE_SCAN_PER_RUN = 100;
const STALE_QUEUE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_JOBS_PER_PROFILE = 12;
const PROFILE_LOCK_MS = 25 * 60 * 1000;
const RETRYABLE_DELAY_MS = 10 * 60 * 1000;

type AuthContext = {
  uid: string;
  role: string;
  rootId: string;
  user: Record<string, unknown>;
};

type IqQueuePreparedSolicitud = {
  solicitudId: string;
  solicitudFolio: string;
  rootId: string;
  requestedBy: string;
  profileId: string;
  profileAlias: string;
  erpUrl: string;
  username: string;
  associatedName: string;
  clientName: string;
  iqClientId: string;
  companyName: string;
  invoiceType: "PUE" | "PPD";
  amount: number;
  orderUploadId: string;
  orderStoragePath: string;
  orderFileName: string;
  despachoId: string;
  targetDateIso: string;
  marker: string;
  fingerprint: string;
  previousIqFolio: string;
  previousOrderUploadId: string;
  rejectedPreviousAttempt: boolean;
};

type IqCreateJob = IqQueuePreparedSolicitud & {
  id: string;
  ref: DocumentReference;
  attemptCount: number;
  batchId: string;
};

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cleanUpper(value: unknown): string {
  return cleanText(value).toUpperCase();
}


const IQ_TERMINAL_SOLICITUD_STATUSES = new Set([
  "RECHAZADA",
  "RECHAZADO",
  "CANCELADA",
  "CANCELADO",
  "ELIMINADA",
  "ELIMINADO",
  "OMITTED",
  "OMITIDO",
  "STOPPED_SOLICITUD_TERMINAL",
]);

function isIqTerminalOrOmittedSolicitud(data: Record<string, unknown>): boolean {
  const values = [
    data.status,
    data.estado,
    data.solicitudStatus,
    data.iqOperationStatus,
    data.iqStatus,
    data.iqCreateStatus,
    data.iqInvoiceImportStatus,
    data.iqStatusSyncStatus,
    data.iqAutomationStatus,
  ].map(cleanUpper);

  if (values.some((value) => IQ_TERMINAL_SOLICITUD_STATUSES.has(value))) {
    return true;
  }

  return data.iqInvoiceImportOmitted === true ||
    data.iqStatusOmitted === true ||
    data.iqCreateOmitted === true ||
    data.iqWorkOmitted === true;
}

function getIqTerminalStopReason(data: Record<string, unknown>): string {
  const status = cleanUpper(data.status ?? data.estado ?? data.solicitudStatus);
  if (status) {
    return `Solicitud PAY0 terminal: ${status}.`;
  }

  if (data.iqInvoiceImportOmitted === true || data.iqStatusOmitted === true || data.iqCreateOmitted === true) {
    return "Seguimiento IQ omitido por Super Admin.";
  }

  return "Solicitud PAY0 terminal u omitida.";
}
function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function toMillis(value: unknown): number {
  if (
    value &&
    typeof value === "object" &&
    "toMillis" in value &&
    typeof (value as { toMillis?: unknown }).toMillis === "function"
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function dateIsoInTimeZone(value: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(value);
    const year = parts.find((part) => part.type === "year")?.value ?? "";
    const month = parts.find((part) => part.type === "month")?.value ?? "";
    const day = parts.find((part) => part.type === "day")?.value ?? "";

    if (year && month && day) {
      return `${year}-${month}-${day}`;
    }
  } catch {
    // fallback below
  }

  return value.toISOString().slice(0, 10);
}

async function loadIqTimeZone(rootId: string): Promise<string> {
  const snap = await db.collection("iqIntegrationConfigs").doc(rootId).get();
  const configured = snap.exists ? cleanText(snap.data()?.timezone) : "";

  if (!configured) {
    return DEFAULT_IQ_TIME_ZONE;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: configured }).format(new Date());
    return configured;
  } catch {
    return DEFAULT_IQ_TIME_ZONE;
  }
}

function normalizeErpUrl(value: string): string {
  const raw = value.trim() || DEFAULT_IQ_ERP_URL;

  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}`;
  } catch {
    throw new HttpsError("failed-precondition", "La cuenta IQ tiene una URL ERP invalida.");
  }
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return cleanText(error.message).slice(0, 1500);
  }

  return cleanText(error).slice(0, 1500) || "Error IQ no identificado.";
}

async function safeLogActivity(params: ActivityLogParams): Promise<void> {
  await logActivity(params).catch(() => undefined);
}

function getActorNameFromUser(user: Record<string, unknown>, uid: string): string {
  return cleanText(user.username ?? user.displayName ?? user.name ?? user.email ?? uid);
}

function getEncryptionKey(): Buffer {
  const raw = IQ_CREDENTIALS_KEY.value();

  if (!raw || raw.trim().length < 16) {
    throw new HttpsError("failed-precondition", "IQ_CREDENTIALS_KEY no esta configurada.");
  }

  const trimmed = raw.trim();

  if (/^[a-f0-9]{64}$/i.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }

  try {
    const fromBase64 = Buffer.from(trimmed, "base64");

    if (fromBase64.length === 32) {
      return fromBase64;
    }
  } catch {
    // fallback to sha256
  }

  return crypto.createHash("sha256").update(trimmed).digest();
}

function decryptSecret(data: Record<string, unknown>): string {
  const ciphertext = cleanText(data.passwordCiphertext);
  const iv = cleanText(data.passwordIv);
  const tag = cleanText(data.passwordTag);

  if (!ciphertext || !iv || !tag) {
    throw new HttpsError("failed-precondition", "La cuenta IQ no tiene contrasena configurada.");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

const IQ_CREATE_ATTEMPT_GUARD_VERSION_H4D82A4 = "H4_D82_A3_A6_A4_A1_IQ_CREATE_ATTEMPT_GUARD";

// H4_D82_A3_A6_A4_A1_IQ_CREATE_ATTEMPT_GUARD
function iqCreateRejectedSignalH4D82A4(
  solicitud: Record<string, unknown>,
  previousCreation: Record<string, unknown>,
): boolean {
  return [
    solicitud.status,
    solicitud.estado,
    solicitud.iqStatus,
    solicitud.iqOperationStatus,
    solicitud.iqSolicitudStatus,
    solicitud.iqSyncStatus,
    solicitud.iqTerminalStatus,
    solicitud.iqLastTerminalStatus,
    solicitud.iqCreationOutcome,
    solicitud.iqCreationStatus,
    previousCreation.status,
    previousCreation.outcome,
    previousCreation.operationStatus,
    previousCreation.error,
  ]
    .map(cleanUpper)
    .filter(Boolean)
    .some((value) =>
      value.includes("RECHAZ") || value.includes("REJECT"),
    );
}

function iqCreateCurrentFolioH4D82A4(
  solicitud: Record<string, unknown>,
): string {
  return cleanText(
    solicitud.iqFolio ??
      solicitud.iqId ??
      solicitud.solicitudIqFolio ??
      solicitud.folioIq,
  );
}

function iqCreateCurrentOrderH4D82A4(
  solicitud: Record<string, unknown>,
): {
  orderUploadId: string;
  orderStoragePath: string;
  orderFileName: string;
} {
  const iqSync = asRecord(solicitud.iqSync);

  return {
    orderUploadId: cleanText(
      iqSync.orderUploadId ?? solicitud.iqOrderUploadId,
    ),
    orderStoragePath: cleanText(
      iqSync.orderStoragePath ?? solicitud.iqOrderStoragePath,
    ),
    orderFileName: cleanText(
      iqSync.orderFileName ?? solicitud.iqOrderFileName,
    ),
  };
}

function iqCreateHasImportedInvoiceH4D82A4(
  solicitud: Record<string, unknown>,
): boolean {
  const status = cleanUpper(
    solicitud.iqInvoiceImportStatus ??
      solicitud.iqInvoiceStatus,
  );

  return Boolean(
    status === "IMPORTED" ||
      cleanText(solicitud.iqInvoiceUuid) ||
      cleanText(solicitud.facturaUuid) ||
      cleanText(solicitud.iqInvoiceXmlUploadId) ||
      cleanText(solicitud.iqInvoicePdfUploadId),
  );
}

async function stopIqCreateJobH4D82A4(input: {
  job: IqCreateJob;
  status: string;
  message: string;
}): Promise<null> {
  const now = FieldValue.serverTimestamp();

  await Promise.all([
    input.job.ref.set(
      {
        status: input.status,
        nextRunAt: null,
        lastError: input.message,
        stoppedByGuard: IQ_CREATE_ATTEMPT_GUARD_VERSION_H4D82A4,
        updatedAt: now,
      },
      { merge: true },
    ),
    db.collection("solicitudes").doc(input.job.solicitudId).set(
      {
        iqCreateQueueStatus: input.status,
        iqCreationStatus: input.status,
        iqCreationLastError: input.message,
        iqSyncUpdatedAt: now,
      },
      { merge: true },
    ),
  ]);

  return null;
}

async function revalidateIqCreateJobH4D82A4(
  job: IqCreateJob,
): Promise<IqCreateJob | null> {
  const solicitudRef = db.collection("solicitudes").doc(job.solicitudId);
  const creationRef = db.collection("iqSolicitudCreations").doc(job.solicitudId);

  const [solicitudSnap, creationSnap] = await Promise.all([
    solicitudRef.get(),
    creationRef.get(),
  ]);

  if (!solicitudSnap.exists) {
    return stopIqCreateJobH4D82A4({
      job,
      status: "OMITTED_NOT_FOUND",
      message: "La solicitud ya no existe.",
    });
  }

  const solicitud = asRecord(solicitudSnap.data());
  const creation = creationSnap.exists ? asRecord(creationSnap.data()) : {};
  const iqSync = asRecord(solicitud.iqSync);

  const currentStatus = cleanUpper(solicitud.status ?? solicitud.estado);
  const currentFolio = cleanText(
    solicitud.folio ?? solicitud.folioSolicitud ?? job.solicitudId,
  );
  const currentAmount = Number(solicitud.monto);
  const currentInvoiceType = cleanUpper(
    solicitud.tipoFactura ?? solicitud.invoiceType ?? iqSync.invoiceType,
  );
  const currentProfileId = cleanText(
    iqSync.profileId ?? solicitud.iqCredentialProfileId,
  );
  const currentMarker = cleanText(solicitud.iqReconciliationMarker);
  const currentOrder = iqCreateCurrentOrderH4D82A4(solicitud);
  const currentIqFolio = iqCreateCurrentFolioH4D82A4(solicitud);

  const queuedAtMs = toMillis(
    (job as unknown as Record<string, unknown>).queuedAt,
  );

  if (
    queuedAtMs > 0 &&
    Date.now() - queuedAtMs > STALE_QUEUE_MAX_AGE_MS
  ) {
    return stopIqCreateJobH4D82A4({
      job,
      status: "REVIEW_REQUIRED_STALE_QUEUE",
      message:
        "El trabajo permanecio mas de 24 horas en cola y no se enviara automaticamente a IQ.",
    });
  }

  let effectiveIqClientId = cleanText(job.iqClientId);

  if (!effectiveIqClientId && job.attemptCount === 0) {
    const currentClientId = cleanText(
      solicitud.clienteId ?? solicitud.clientId,
    );

    if (currentClientId) {
      const clientSnap = await db
        .collection("clients")
        .doc(currentClientId)
        .get();

      const client = clientSnap.exists
        ? asRecord(clientSnap.data())
        : {};

      const clientIqLink = asRecord(client.iqLink);

      effectiveIqClientId = cleanText(
        clientIqLink.clientId ??
          client.iqClientId,
      );

      if (effectiveIqClientId) {
        const repairNow = FieldValue.serverTimestamp();

        await Promise.all([
          job.ref.set(
            {
              iqClientId: effectiveIqClientId,
              iqClientIdAutoRepaired: true,
              iqClientIdAutoRepairedAt: repairNow,
              updatedAt: repairNow,
            },
            { merge: true },
          ),
          creationRef.set(
            {
              iqClientId: effectiveIqClientId,
              iqClientIdAutoRepaired: true,
              iqClientIdAutoRepairedAt: repairNow,
              updatedAt: repairNow,
            },
            { merge: true },
          ),
        ]);
      }
    }
  }

  if (!effectiveIqClientId) {
    return stopIqCreateJobH4D82A4({
      job,
      status: "REVIEW_REQUIRED_CLIENT_IQ_ID_MISSING",
      message:
        "La cola no contiene la vinculacion canonica del cliente con IQ. No se enviara por nombre.",
    });
  }

  if (
    ["CANCELADA", "CANCELADO", "ELIMINADA", "ELIMINADO", "COMPLETADA", "COMPLETADO"]
      .includes(currentStatus) ||
    iqCreateHasImportedInvoiceH4D82A4(solicitud)
  ) {
    return stopIqCreateJobH4D82A4({
      job,
      status: "OMITTED_CURRENT_TERMINAL",
      message:
        "La solicitud ya está terminal o ya tiene factura IQ; no se vuelve a crear.",
    });
  }

  const validRejectedReplacement =
    Boolean(currentIqFolio) &&
    job.rejectedPreviousAttempt === true &&
    cleanText(job.previousIqFolio) === currentIqFolio &&
    Boolean(currentOrder.orderUploadId) &&
    Boolean(cleanText(job.previousOrderUploadId)) &&
    currentOrder.orderUploadId !== cleanText(job.previousOrderUploadId);

  if (currentIqFolio && !validRejectedReplacement) {
    return stopIqCreateJobH4D82A4({
      job,
      status: "OMITTED_EXISTING_IQ_FOLIO",
      message:
        "La solicitud ya tiene folio IQ y no existe un intento nuevo autorizado por rechazo y nueva OC.",
    });
  }

  const creationStatus = cleanUpper(
    creation.status ??
      creation.outcome,
  );
  const sameCreationAttempt =
    cleanText(creation.fingerprint) ===
    cleanText(job.fingerprint);

  if (
    sameCreationAttempt &&
    !cleanText(creation.iqId) &&
    (
      creation.submitClicked === true ||
      [
        "OUTCOME_UNKNOWN",
        "PENDING_RECONCILIATION",
        "REVIEW_REQUIRED_PROFILE_OUTCOME_UNKNOWN",
      ].includes(creationStatus)
    )
  ) {
    return stopIqCreateJobH4D82A4({
      job,
      status: "REVIEW_REQUIRED_POST_ALREADY_SENT",
      message:
        "Este intento pudo haber sido enviado a IQ; solo procede conciliación de lectura.",
    });
  }

  const mismatches: string[] = [];

  if (currentFolio !== cleanText(job.solicitudFolio)) {
    mismatches.push("folio PAY0");
  }
  if (
    !Number.isFinite(currentAmount) ||
    currentAmount <= 0 ||
    Math.abs(currentAmount - Number(job.amount)) > 0.009
  ) {
    mismatches.push("monto total");
  }
  if (!currentProfileId || currentProfileId !== cleanText(job.profileId)) {
    mismatches.push("cuenta IQ");
  }
  if (
    !currentOrder.orderUploadId ||
    currentOrder.orderUploadId !== cleanText(job.orderUploadId)
  ) {
    mismatches.push("versión de OC");
  }
  if (
    !currentOrder.orderStoragePath ||
    currentOrder.orderStoragePath !== cleanText(job.orderStoragePath)
  ) {
    mismatches.push("archivo de OC");
  }
  if (
    !["PUE", "PPD"].includes(currentInvoiceType) ||
    currentInvoiceType !== cleanUpper(job.invoiceType)
  ) {
    mismatches.push("tipo de factura");
  }
  if (currentMarker && currentMarker !== cleanText(job.marker)) {
    mismatches.push("marcador de conciliación");
  }

  if (mismatches.length > 0) {
    return stopIqCreateJobH4D82A4({
      job,
      status: "REVIEW_REQUIRED_SNAPSHOT_MISMATCH",
      message:
        "La cola no coincide con la solicitud actual: " +
        mismatches.join(", ") +
        ".",
    });
  }

  return {
    ...job,
    solicitudFolio: currentFolio,
    amount: currentAmount,
    profileId: currentProfileId,
    iqClientId: effectiveIqClientId,
    orderUploadId: currentOrder.orderUploadId,
    orderStoragePath: currentOrder.orderStoragePath,
    orderFileName: currentOrder.orderFileName || job.orderFileName,
    invoiceType: currentInvoiceType as "PUE" | "PPD",
    marker: currentMarker || job.marker,
  };
}

async function revalidateIqCreateJobsH4D82A4(
  jobs: IqCreateJob[],
): Promise<IqCreateJob[]> {
  const approved: IqCreateJob[] = [];

  for (const job of jobs) {
    const current = await revalidateIqCreateJobH4D82A4(job);
    if (current) approved.push(current);
  }

  return approved;
}

function buildFingerprint(input: {
  solicitudId: string;
  profileId: string;
  orderUploadId: string;
  orderStoragePath: string;
  amount: number;
  invoiceType: string;
}): string {
  return crypto
    .createHash("sha256")
    .update(
      [
        input.solicitudId,
        input.profileId,
        input.orderUploadId,
        input.orderStoragePath,
        input.amount.toFixed(2),
        input.invoiceType,
      ].join("|"),
    )
    .digest("hex");
}

function safeTemporaryFileName(value: string): string {
  const base = path.basename(value).replace(/[^a-zA-Z0-9._-]/g, "_");
  return base || "orden-compra.xlsx";
}

function isExcelFileName(fileName: string): boolean {
  return /\.xlsx$/i.test(fileName);
}

function isActiveUpload(upload: Record<string, unknown>): boolean {
  if (upload.active !== true) {
    return false;
  }

  return ![
    "DELETED",
    "ELIMINADA",
    "INACTIVE",
    "INACTIVO",
    "REPLACED",
    "REEMPLAZADO",
  ].includes(cleanUpper(upload.status));
}

function normalizeInvoiceType(value: unknown): "PUE" | "PPD" | null {
  const raw = cleanUpper(value);
  if (raw === "PUE") return "PUE";
  if (raw === "PPD") return "PPD";
  return null;
}

async function getAuthContext(request: {
  auth?: { uid?: string; token?: Record<string, unknown> } | null;
}): Promise<AuthContext> {
  const uid = cleanText(request.auth?.uid);

  if (!uid) {
    throw new HttpsError("unauthenticated", "Sesion requerida.");
  }

  const userSnap = await db.collection("users").doc(uid).get();

  if (!userSnap.exists) {
    throw new HttpsError("permission-denied", "Usuario PAY0 no encontrado.");
  }

  const user = asRecord(userSnap.data());
  const token = asRecord(request.auth?.token);
  const role = cleanText(token.role ?? token.userRole ?? user.role).toLowerCase();
  const rootId = cleanText(token.rootId ?? token.root_id ?? user.rootId ?? uid);

  return { uid, role, rootId: rootId || uid, user };
}

function canCreateSolicitudes(auth: AuthContext): boolean {
  if (auth.role === "superadmin") return true;
  const modules = asRecord(auth.user.modules);
  const solicitudes = asRecord(modules.solicitudes);
  return solicitudes.create === true;
}

async function loadUserContext(uid: string): Promise<AuthContext | null> {
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) return null;
  const user = asRecord(snap.data());
  const role = cleanText(user.role).toLowerCase();
  const rootId = cleanText(user.rootId ?? uid) || uid;
  return { uid, role, rootId, user };
}

async function verifyDespachoAccess(uid: string, despachoId: string): Promise<boolean> {
  const providerGateH4D73A6 = await evaluateIqDispatchGate({ db, despachoId });
  if (!providerGateH4D73A6.ok) return false;
  if (!despachoId) return false;
  const snap = await db
    .collection("userDespachoAccess")
    .doc(uid)
    .collection("despachos")
    .doc(despachoId)
    .get();
  return snap.exists && snap.data()?.active === true;
}

function getEntityName(data: Record<string, unknown>, fallback: string): string {
  return cleanText(
    data.name ??
      data.nombre ??
      data.nombreComercial ??
      data.razonSocial ??
      data.displayName ??
      fallback,
  );
}

async function prepareSolicitudForIqQueue(input: {
  solicitudId: string;
  requestedBy: string;
}): Promise<IqQueuePreparedSolicitud> {
  const userContext = await loadUserContext(input.requestedBy);

  if (!userContext) {
    throw new HttpsError("failed-precondition", "Usuario solicitante no encontrado.");
  }

  if (!canCreateSolicitudes(userContext)) {
    throw new HttpsError("permission-denied", "Usuario sin permiso para crear solicitudes.");
  }

  const solicitudRef = db.collection("solicitudes").doc(input.solicitudId);
  const solicitudSnap = await solicitudRef.get();

  if (!solicitudSnap.exists) {
    throw new HttpsError("not-found", "Solicitud PAY0 no encontrada.");
  }

  const solicitud = asRecord(solicitudSnap.data());
  const rootId = cleanText(solicitud.rootId ?? solicitud.ownerRootId ?? userContext.rootId);

  if (rootId && rootId !== userContext.rootId) {
    throw new HttpsError("permission-denied", "Solicitud fuera del scope autorizado.");
  }

  const existingIqId = cleanText(solicitud.iqId ?? solicitud.iqFolio);
  if (existingIqId) {
    throw new HttpsError("already-exists", "La solicitud ya tiene folio del despacho.");
  }

  const clientId = cleanText(solicitud.clienteId ?? solicitud.clientId);
  const companyId = cleanText(solicitud.companyId ?? solicitud.empresaId);
  const despachoId = cleanText(solicitud.despachoId ?? solicitud.firmId);
  const amount = Number(solicitud.monto);
  const invoiceType = normalizeInvoiceType(solicitud.tipoFactura ?? solicitud.invoiceType);

  if (!clientId || !companyId || !despachoId) {
    throw new HttpsError("failed-precondition", "Solicitud incompleta para envio automatico.");
  }

  if (!Number.isFinite(amount) || amount <= 0 || !invoiceType) {
    throw new HttpsError("failed-precondition", "Monto o tipo de factura invalido.");
  }

  const operationGateH4D73A6 = await evaluateIqDispatchGate({ db, despachoId, companyId, rootId: userContext.rootId });
  if (!operationGateH4D73A6.ok) {
    throw new HttpsError("failed-precondition", `[${operationGateH4D73A6.code}] ${operationGateH4D73A6.message}`);
  }

  const operationalOwnerId = cleanText(
    solicitud.operationalOwnerId ??
      solicitud.iqOwnerId ??
      solicitud.ownerId,
  );

  if (!operationalOwnerId) {
    throw new HttpsError(
      "failed-precondition",
      "La solicitud no conserva propietario operativo.",
    );
  }

  // El actor debe conservar permiso para administrar el despacho.
  if (!(await verifyDespachoAccess(input.requestedBy, despachoId))) {
    throw new HttpsError("permission-denied", "Usuario sin despacho habilitado para esta solicitud.");
  }

  // La cuenta IQ pertenece al propietario operativo, no al actor delegado.
  const accessSnap = await db
    .collection("iqUserAccess")
    .doc(operationalOwnerId)
    .get();
  const access = asRecord(accessSnap.data());

  if (!accessSnap.exists || access.active !== true || access.iqEnabled !== true) {
    throw new HttpsError(
      "failed-precondition",
      "El propietario operativo no tiene cuenta IQ activa.",
    );
  }

  const profileId = cleanText(access.iqCredentialProfileId);
  if (!profileId) {
    throw new HttpsError(
      "failed-precondition",
      "El propietario operativo no tiene cuenta IQ asignada.",
    );
  }

  const profileSnap = await db.collection("iqCredentialProfiles").doc(profileId).get();
  if (!profileSnap.exists) {
    throw new HttpsError("failed-precondition", "Cuenta de despacho no encontrada.");
  }

  const profile = asRecord(profileSnap.data());

  if (
    cleanText(profile.rootId) !== userContext.rootId ||
    profile.active !== true ||
    profile.hasPassword !== true
  ) {
    throw new HttpsError("failed-precondition", "Cuenta de despacho inactiva o incompleta.");
  }

  const [clientSnap, companySnap, uploadSnap] = await Promise.all([
    db.collection("clients").doc(clientId).get(),
    db.collection("companies").doc(companyId).get(),
    db.collection("uploads").where("solicitudId", "==", input.solicitudId).get(),
  ]);

  const client = clientSnap.exists ? asRecord(clientSnap.data()) : {};
  const company = companySnap.exists ? asRecord(companySnap.data()) : {};

  const orderUploads = uploadSnap.docs
    .map((doc) => ({ id: doc.id, data: asRecord(doc.data()) }))
    .filter((row) => {
      const uploadRootId = cleanText(row.data.rootId);
      if (uploadRootId && uploadRootId !== userContext.rootId) return false;
      return cleanUpper(row.data.documentType) === "ORDEN_COMPRA" && isActiveUpload(row.data);
    })
    .sort((a, b) => {
      const aTime = toMillis(a.data.finalizedAt) || toMillis(a.data.updatedAt) || toMillis(a.data.createdAt);
      const bTime = toMillis(b.data.finalizedAt) || toMillis(b.data.updatedAt) || toMillis(b.data.createdAt);
      return bTime - aTime;
    });

  const activeOrder = orderUploads[0];
  if (!activeOrder) {
    throw new HttpsError("failed-precondition", "No existe una Orden de Compra activa.");
  }

  const orderFileName = cleanText(
    activeOrder.data.originalName ?? activeOrder.data.filename ?? activeOrder.data.fileName,
  );
  const orderStoragePath = cleanText(activeOrder.data.storagePath);

  if (!orderFileName || !isExcelFileName(orderFileName) || !orderStoragePath) {
    throw new HttpsError("failed-precondition", "La Orden de Compra debe ser .xlsx y tener storagePath.");
  }

  const existsResult = await admin.storage().bucket().file(orderStoragePath).exists();
  if (existsResult[0] !== true) {
    throw new HttpsError("failed-precondition", "El archivo de Orden de Compra no existe en Storage.");
  }

  const previousCreationSnap = await db
    .collection("iqSolicitudCreations")
    .doc(input.solicitudId)
    .get();
  const previousCreation = previousCreationSnap.exists
    ? asRecord(previousCreationSnap.data())
    : {};
  const previousIqFolio = iqCreateCurrentFolioH4D82A4(solicitud);
  const previousOrderUploadId = cleanText(previousCreation.orderUploadId);
  const rejectedPreviousAttempt = iqCreateRejectedSignalH4D82A4(
    solicitud,
    previousCreation,
  );

  if (previousIqFolio) {
    const hasNewOrder =
      Boolean(previousOrderUploadId) &&
      activeOrder.id !== previousOrderUploadId;

    if (!rejectedPreviousAttempt || !hasNewOrder) {
      throw new HttpsError(
        "failed-precondition",
        "La solicitud ya tiene folio IQ. Solo un rechazo con una nueva OC permite crear un intento nuevo.",
      );
    }
  }

  const timeZone = await loadIqTimeZone(userContext.rootId);
  const targetDateIso = dateIsoInTimeZone(new Date(), timeZone);
  const solicitudFolio = cleanText(solicitud.folio ?? solicitud.folioSolicitud ?? input.solicitudId);
  const marker = ["PAY0", solicitudFolio || input.solicitudId, `IQ-${crypto.randomUUID().slice(0, 8)}`].join(" ");
  const fingerprint = buildFingerprint({
    solicitudId: input.solicitudId,
    profileId,
    orderUploadId: activeOrder.id,
    orderStoragePath,
    amount,
    invoiceType,
  });

  const clientName =
    cleanText(solicitud.clienteNombre ?? solicitud.clientName) || getEntityName(client, clientId);

  const clientIqLink = asRecord(client.iqLink);
  const iqClientId = cleanText(
    clientIqLink.clientId ??
      client.iqClientId,
  );

  const companyName =
    cleanText(solicitud.empresaNombre ?? solicitud.companyName) || getEntityName(company, companyId);
  const username = cleanText(profile.username);

  if (!username || !clientName || !companyName) {
    throw new HttpsError(
      "failed-precondition",
      "No fue posible resolver nombres para envio automatico.",
    );
  }

  if (!iqClientId) {
    throw new HttpsError(
      "failed-precondition",
      `El cliente ${clientName} no esta vinculado con IQ.`,
    );
  }

  return {
    solicitudId: input.solicitudId,
    solicitudFolio,
    rootId: userContext.rootId,
    requestedBy: input.requestedBy,
    profileId,
    profileAlias: cleanText(profile.alias),
    erpUrl: normalizeErpUrl(cleanText(profile.erpUrl)),
    username,
    associatedName: username,
    clientName,
    iqClientId,
    companyName,
    invoiceType,
    amount,
    orderUploadId: activeOrder.id,
    orderStoragePath,
    orderFileName,
    despachoId,
    targetDateIso,
    marker,
    fingerprint,
    previousIqFolio,
    previousOrderUploadId,
    rejectedPreviousAttempt,
  };
}

async function reserveQueuedJob(input: {
  prepared: IqQueuePreparedSolicitud;
  source: string;
  batchId?: string;
}): Promise<{ jobId: string; batchId: string; reused: boolean }> {
  const solicitudRef = db.collection("solicitudes").doc(input.prepared.solicitudId);
  const creationRef = db.collection("iqSolicitudCreations").doc(input.prepared.solicitudId);
  const jobId = input.prepared.solicitudId;
  const jobRef = db.collection("iqCreateJobs").doc(jobId);
  const batchId = input.batchId || `iqbatch-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`;
  const batchRef = db.collection("iqCreateBatches").doc(batchId);

  return db.runTransaction(async (tx: Transaction) => {
    const [solicitudSnap, jobSnap] = await Promise.all([
      tx.get(solicitudRef),
      tx.get(jobRef),
    ]);

    if (!solicitudSnap.exists) {
      throw new HttpsError("not-found", "Solicitud PAY0 no encontrada.");
    }

    const solicitud = asRecord(solicitudSnap.data());
    const existingIqId = cleanText(solicitud.iqId ?? solicitud.iqFolio);
    if (existingIqId) {
      return { jobId, batchId, reused: true };
    }

    if (jobSnap.exists) {
      const job = asRecord(jobSnap.data());
      const status = cleanUpper(job.status);
      const sameFingerprint = cleanText(job.fingerprint) === input.prepared.fingerprint;
      if (
        sameFingerprint &&
        ["QUEUED", "PROCESSING", "CREATED", "OUTCOME_UNKNOWN", "PENDING_RECONCILIATION"].includes(status)
      ) {
        return { jobId, batchId: cleanText(job.batchId) || batchId, reused: true };
      }
    }

    const now = FieldValue.serverTimestamp();
    const jobPatch = {
      ...input.prepared,
      batchId,
      source: input.source,
      status: "QUEUED",
      version: IQ_QUEUE_VERSION,
      attemptCount: jobSnap.exists ? Number(jobSnap.data()?.attemptCount ?? 0) || 0 : 0,
      nextRunAt: now,
      queuedAt: now,
      updatedAt: now,
    };

    tx.set(jobRef, jobPatch, { merge: true });
    tx.set(creationRef, {
      rootId: input.prepared.rootId,
      solicitudId: input.prepared.solicitudId,
      solicitudFolio: input.prepared.solicitudFolio || null,
      status: "QUEUED",
      source: input.source,
      batchId,
      version: IQ_QUEUE_VERSION,
      fingerprint: input.prepared.fingerprint,
      profileId: input.prepared.profileId,
      profileAlias: input.prepared.profileAlias || null,
      iqClientId: input.prepared.iqClientId,
      previousIqFolio: input.prepared.previousIqFolio || null,
      previousOrderUploadId:
        input.prepared.previousOrderUploadId || null,
      rejectedPreviousAttempt:
        input.prepared.rejectedPreviousAttempt === true,
      marker: input.prepared.marker,
      targetDateIso: input.prepared.targetDateIso,
      orderUploadId: input.prepared.orderUploadId || null,
      orderStoragePath: input.prepared.orderStoragePath,
      orderFileName: input.prepared.orderFileName,
      amount: input.prepared.amount,
      invoiceType: input.prepared.invoiceType,
      requestedBy: input.prepared.requestedBy,
      updatedAt: now,
      createdAt: jobSnap.exists ? (jobSnap.data()?.createdAt ?? now) : now,
    }, { merge: true });

    tx.set(solicitudRef, {
      iqCreationStatus: "QUEUED",
      iqCreateQueueStatus: "QUEUED",
      iqCreateQueuedAt: now,
      iqCreateQueuedBy: input.prepared.requestedBy,
      iqCredentialProfileId: input.prepared.profileId,
      iqCreationFingerprint: input.prepared.fingerprint,
      iqReconciliationMarker: input.prepared.marker,
      iqTargetDateIso: input.prepared.targetDateIso,
      iqSyncStatus: "READY",
      iqSync: {
        status: "READY",
        version: IQ_PREVALIDATION_VERSION,
        profileId: input.prepared.profileId,
        profileAlias: input.prepared.profileAlias || null,
        iqAssociatedName: input.prepared.associatedName,
        iqClientName: input.prepared.clientName,
        iqCompanyName: input.prepared.companyName,
        invoiceType: input.prepared.invoiceType,
        despachoId: input.prepared.despachoId || null,
        orderUploadId: input.prepared.orderUploadId || null,
        orderFileName: input.prepared.orderFileName,
        orderStoragePath: input.prepared.orderStoragePath,
        orderExists: true,
        amount: input.prepared.amount,
        errors: [],
        prevalidatedAt: now,
        requestedBy: input.prepared.requestedBy,
      },
      iqSyncUpdatedAt: now,
    }, { merge: true });

    tx.set(batchRef, {
      rootId: input.prepared.rootId,
      batchId,
      status: "QUEUED",
      source: input.source,
      totalItems: FieldValue.increment(1),
      queuedItems: FieldValue.increment(1),
      profileIds: FieldValue.arrayUnion(input.prepared.profileId),
      createdBy: input.prepared.requestedBy,
      updatedAt: now,
      createdAt: now,
    }, { merge: true });

    return { jobId, batchId, reused: false };
  });
}

export async function enqueueIqCreationForSolicitud(input: {
  solicitudId: string;
  requestedBy: string;
  source?: string;
  batchId?: string;
}): Promise<{ queued: boolean; jobId: string; batchId: string; reused: boolean; message: string }> {
  try {
    const prepared = await prepareSolicitudForIqQueue({
      solicitudId: input.solicitudId,
      requestedBy: input.requestedBy,
    });

    const reservation = await reserveQueuedJob({
      prepared,
      source: input.source || "AUTO",
      batchId: input.batchId,
    });

    await safeLogActivity({
      event: reservation.reused ? "IQ_SOLICITUD_COLA_REUTILIZADA" : "IQ_SOLICITUD_ENCOLADA",
      rootId: prepared.rootId,
      adminId: prepared.rootId,
      actorUid: input.requestedBy,
      actorName: input.requestedBy,
      actorUsername: input.requestedBy,
      actorRole: "system",
      referenceId: prepared.solicitudId,
      referenceFolio: prepared.solicitudFolio,
      referenceType: "solicitud",
      entityId: prepared.solicitudId,
      entityType: "solicitud",
      amount: prepared.amount,
      description: reservation.reused
        ? `Solicitud ${prepared.solicitudFolio} ya estaba en cola de despacho.`
        : `Solicitud ${prepared.solicitudFolio} encolada para envio automatico al despacho.`,
      extra: {
        batchId: reservation.batchId,
        jobId: reservation.jobId,
        profileId: prepared.profileId,
        profileAlias: prepared.profileAlias || null,
        source: input.source || "AUTO",
      },
    });

    // La tarea inmediata complementa al scheduler: conserva el mismo job y el
    // mismo bloqueo por perfil, por lo que no crea un segundo POST a IQ.
    let taskId: string | null = null;
    let taskEnqueueError: string | null = null;
    try {
      const task = await enqueueIqOnDemandTaskH4D64({
        functionName: IQ_CREATE_ON_DEMAND_TASK,
        taskId: `iq-solicitud-create-${reservation.jobId}`,
        data: {
          jobId: reservation.jobId,
          source: input.source || "AUTO",
        },
        dispatchDeadlineSeconds: 540,
      });
      taskId = task.taskId;
    } catch (error) {
      taskEnqueueError = safeErrorMessage(error);
      // La cola programada conserva el trabajo como respaldo cuando Cloud Tasks
      // no está configurado o está temporalmente indisponible.
    }

    await db.collection("iqCreateJobs").doc(reservation.jobId).set({
      onDemandTaskId: taskId,
      onDemandTaskRequestedAt: FieldValue.serverTimestamp(),
      onDemandTaskEnqueueError: taskEnqueueError,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return {
      queued: true,
      jobId: reservation.jobId,
      batchId: reservation.batchId,
      reused: reservation.reused,
      message: reservation.reused
        ? "La solicitud ya estaba en cola de envio al despacho."
        : "Solicitud encolada para envio automatico al despacho.",
    };
  } catch (error) {
    const message = safeErrorMessage(error);
    const alreadyHasFolio = error instanceof HttpsError && error.code === "already-exists";

    await db.collection("solicitudes").doc(input.solicitudId).set({
      iqCreateQueueStatus: alreadyHasFolio ? "SKIPPED_ALREADY_HAS_FOLIO" : "NOT_ENQUEUED",
      iqCreateQueueLastError: alreadyHasFolio ? null : message,
      iqSyncUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }).catch(() => undefined);

    if (alreadyHasFolio) {
      return {
        queued: false,
        jobId: input.solicitudId,
        batchId: input.batchId || "",
        reused: true,
        message: "La solicitud ya tiene folio externo; no se vuelve a crear.",
      };
    }

    return {
      queued: false,
      jobId: input.solicitudId,
      batchId: input.batchId || "",
      reused: false,
      message,
    };
  }
}

export const processIqCreateOnDemandTask = onTaskDispatched(
  {
    region: "us-central1",
    timeoutSeconds: 540,
    memory: "2GiB",
    maxInstances: 1,
    concurrency: 1,
    secrets: [IQ_CREDENTIALS_KEY, TELEGRAM_BOT_TOKEN],
    retryConfig: { maxAttempts: 1, minBackoffSeconds: 60, maxBackoffSeconds: 300 },
    rateLimits: { maxConcurrentDispatches: 1, maxDispatchesPerSecond: 1 },
  },
  async (request) => {
    const data = asRecord(request.data);
    const jobId = cleanText(data.jobId);
    if (!jobId) return;

    const snap = await db.collection("iqCreateJobs").doc(jobId).get();
    if (!snap.exists) return;
    const row = asRecord(snap.data());
    const status = cleanUpper(row.status);
    if (!["QUEUED", "FAILED_RETRYABLE"].includes(status)) return;

    const source = cleanUpper(data.source);
    const isExplicitManualRequest = ["MANUAL_QUEUE", "MASS_UPLOAD"].includes(source);
    if (!isExplicitManualRequest) {
      const enabledRoots = await loadEnabledIqAutomationRoots({
        process: "solicitudCreate",
        purpose: "CREATION",
        respectWindow: false,
      });
      if (!enabledRoots.has(cleanText(row.rootId))) return;
    }

    const job: IqCreateJob = {
      ...(row as Omit<IqCreateJob, "id" | "ref">),
      id: snap.id,
      ref: snap.ref,
      attemptCount: Number(row.attemptCount ?? 0) || 0,
      batchId: cleanText(row.batchId),
    };
    await processProfileJobs(job.profileId, [job]);
  },
);

export const enqueueSolicitudIqCreation = onCall(
  { cors: true, timeoutSeconds: 60, memory: "512MiB" },
  async (request) => {
    await assertIqAuthorized(request, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "solicitudes", requiredAction: "create" });
    const auth = await getAuthContext(request);

    if (!canCreateSolicitudes(auth)) {
      throw new HttpsError("permission-denied", "No autorizado para encolar solicitudes.");
    }

    const data = asRecord(request.data);
    const rawIds = Array.isArray(data.solicitudIds)
      ? data.solicitudIds
      : [data.solicitudId];
    const solicitudIds = rawIds.map(cleanText).filter(Boolean).slice(0, 50);

    if (solicitudIds.length === 0) {
      throw new HttpsError("invalid-argument", "solicitudId es obligatorio.");
    }

    const batchId = solicitudIds.length > 1
      ? `iqbatch-manual-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`
      : cleanText(data.batchId);

    const results = [];
    for (const solicitudId of solicitudIds) {
      results.push(await enqueueIqCreationForSolicitud({
        solicitudId,
        requestedBy: auth.uid,
        source: solicitudIds.length > 1 ? "MASS_UPLOAD" : "MANUAL_QUEUE",
        batchId: batchId || undefined,
      }));
    }

    return {
      ok: true,
      data: {
        batchId: batchId || results[0]?.batchId || null,
        total: results.length,
        queued: results.filter((result) => result.queued).length,
        results,
      },
      message: `Solicitudes encoladas: ${results.filter((result) => result.queued).length}/${results.length}`,
    };
  },
);

async function acquireProfileLock(profileId: string): Promise<string | null> {
  const lockRef = db.collection("iqCreateProfileLocks").doc(profileId);
  const leaseToken = crypto.randomUUID();
  const nowMs = Date.now();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(lockRef);
    const data = snap.exists ? asRecord(snap.data()) : {};
    const leaseUntilMs = Number(data.leaseUntilMs ?? 0) || 0;

    if (leaseUntilMs > nowMs) {
      return null;
    }

    tx.set(lockRef, {
      profileId,
      leaseToken,
      leaseUntilMs: nowMs + PROFILE_LOCK_MS,
      acquiredAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return leaseToken;
  });
}

async function releaseProfileLock(profileId: string, leaseToken: string): Promise<void> {
  const lockRef = db.collection("iqCreateProfileLocks").doc(profileId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(lockRef);
    const data = snap.exists ? asRecord(snap.data()) : {};
    if (cleanText(data.leaseToken) === leaseToken) {
      tx.set(lockRef, {
        leaseUntilMs: 0,
        releasedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  }).catch(() => undefined);
}

async function loadQueuedJobs(): Promise<IqCreateJob[]> {
  const now = Timestamp.now();
  const snap = await db
    .collection("iqCreateJobs")
    .where("status", "in", ["QUEUED", "FAILED_RETRYABLE"])
    .where("nextRunAt", "<=", now)
    .orderBy("nextRunAt", "asc")
    .limit(MAX_QUEUE_SCAN_PER_RUN)
    .get();

  return snap.docs.map((doc) => {
    const data = asRecord(doc.data());
    return {
      ...(data as Omit<IqCreateJob, "id" | "ref">),
      id: doc.id,
      ref: doc.ref,
      attemptCount: Number(data.attemptCount ?? 0) || 0,
      batchId: cleanText(data.batchId),
    };
  });
}

async function markJobProcessing(job: IqCreateJob): Promise<number> {
  const attemptCount = job.attemptCount + 1;
  await job.ref.set({
    status: "PROCESSING",
    attemptCount,
    processingStartedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await db.collection("solicitudes").doc(job.solicitudId).set({
    iqCreationStatus: "PROCESSING",
    iqCreateQueueStatus: "PROCESSING",
    iqCreationAttemptCount: attemptCount,
    iqCreationStartedAt: FieldValue.serverTimestamp(),
    iqSyncUpdatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return attemptCount;
}

async function finalizeJobFromResult(input: {
  job: IqCreateJob;
  attemptCount: number;
  result: IqCreateInvoiceBatchItemResult;
  durationMs: number;
  batchId: string;
}): Promise<void> {
  const solicitudRef = db.collection("solicitudes").doc(input.job.solicitudId);
  const creationRef = db.collection("iqSolicitudCreations").doc(input.job.solicitudId);
  const noteRef = solicitudRef.collection("notas").doc("iq-folio");
  const now = FieldValue.serverTimestamp();
  const iqId = cleanText(input.result.iqId);
  const submitted = input.result.submitClicked === true;
  const outcome = cleanUpper(input.result.outcome);
  const error = input.result.errors.join(" ").slice(0, 1500);
  const responseMessage = cleanText(input.result.responseMessage || input.result.message);

  await db.runTransaction(async (tx) => {
    const currentSolicitudSnapH4D82A4 = await tx.get(
      db.collection("solicitudes").doc(input.job.solicitudId),
    );
    const currentSolicitudH4D82A4 =
      currentSolicitudSnapH4D82A4.exists
        ? asRecord(currentSolicitudSnapH4D82A4.data())
        : {};

    const jobStatus = iqId
      ? "CREATED"
      : submitted
        ? "PENDING_RECONCILIATION"
        : "FAILED_RETRYABLE";

    tx.set(input.job.ref, {
      status: jobStatus,
      iqId: iqId || null,
      outcome,
      submitClicked: submitted,
      responseMessage: responseMessage || null,
      error: error || null,
      iqHttpCreateContractA53: input.result.httpContractCapture ?? null,
      iqHttpCreateContractCapturedAtA53: input.result.httpContractCapture ? now : null,
      durationMs: input.durationMs,
      finishedAt: now,
      updatedAt: now,
      nextRunAt: jobStatus === "FAILED_RETRYABLE"
        ? Timestamp.fromMillis(Date.now() + RETRYABLE_DELAY_MS)
        : null,
    }, { merge: true });

    tx.set(creationRef, {
      rootId: input.job.rootId,
      solicitudId: input.job.solicitudId,
      solicitudFolio: input.job.solicitudFolio || null,
      status: iqId ? "SUCCEEDED" : submitted ? "OUTCOME_UNKNOWN" : "FAILED_RETRYABLE",
      source: "QUEUE",
      batchId: input.batchId,
      version: IQ_QUEUE_VERSION,
      fingerprint: input.job.fingerprint,
      profileId: input.job.profileId,
      profileAlias: input.job.profileAlias || null,
      marker: input.job.marker,
      targetDateIso: input.job.targetDateIso,
      attemptCount: input.attemptCount,
      iqId: iqId || null,
      submitClicked: submitted,
      responseMessage: responseMessage || null,
      error: error || null,
      durationMs: input.durationMs,
      finishedAt: now,
      updatedAt: now,
    }, { merge: true });

    const solicitudPatch: Record<string, unknown> = {
      iqCreateQueueStatus: jobStatus,
      iqCreationStatus: iqId ? "CREATED" : submitted ? "OUTCOME_UNKNOWN" : "FAILED_RETRYABLE",
      iqCreationAttemptCount: input.attemptCount,
      iqCreationFinishedAt: now,
      iqCreationDurationMs: input.durationMs,
      iqCreationOutcome: outcome,
      iqCreationLastError: error || null,
      iqCreationResponseMessage: responseMessage || null,
      iqCreationSubmitClicked: submitted,
      iqHttpCreateContractA53: input.result.httpContractCapture ?? null,
      iqHttpCreateContractCapturedAtA53: input.result.httpContractCapture ? now : null,
      iqCreationFingerprint: input.job.fingerprint,
      iqCredentialProfileId: input.job.profileId,
      iqReconciliationMarker: input.job.marker,
      iqTargetDateIso: input.job.targetDateIso,
      iqSyncUpdatedAt: now,
    };

    const existingIqFolio =
      iqCreateCurrentFolioH4D82A4(currentSolicitudH4D82A4);
    const canReplaceRejectedAttempt =
      input.job.rejectedPreviousAttempt === true &&
      Boolean(input.job.previousIqFolio) &&
      cleanText(input.job.previousIqFolio) === existingIqFolio &&
      Boolean(input.job.previousOrderUploadId) &&
      cleanText(input.job.previousOrderUploadId) !==
        cleanText(input.job.orderUploadId);

    if (
      iqId &&
      existingIqFolio &&
      existingIqFolio !== iqId &&
      !canReplaceRejectedAttempt
    ) {
      solicitudPatch.iqCreateQueueStatus =
        "REVIEW_REQUIRED_FOLIO_CONFLICT";
      solicitudPatch.iqCreationStatus =
        "REVIEW_REQUIRED_FOLIO_CONFLICT";
      solicitudPatch.iqCreationLastError =
        "IQ devolvió un folio distinto, pero PAY0 ya conserva un folio inmutable para este intento.";
    } else if (iqId) {
      solicitudPatch.iqId = iqId;
      solicitudPatch.iqFolio = iqId;
      solicitudPatch.iqCreatedAt = now;
      solicitudPatch.iqCreatedBy = input.job.requestedBy;
      solicitudPatch.iqSyncStatus = "CREATED";
      solicitudPatch.iqReconciliationStatus = "LINKED";
      solicitudPatch.iqInvoiceStatus = "WAITING";
      solicitudPatch.hasUnreadMsg = true;

      tx.set(noteRef, {
        rootId: input.job.rootId,
        createdBy: input.job.requestedBy,
        createdByName: input.job.requestedBy,
        createdByRole: "system",
        source: "IQ",
        text: `FOLIO IQ: ${iqId}`,
        createdAt: now,
        updatedAt: now,
      }, { merge: true });
    } else if (submitted) {
      solicitudPatch.iqReconciliationStatus = "PENDING";
      solicitudPatch.iqReconciliationAttemptCount = 0;
      solicitudPatch.iqReconciliationNextCheckAt = null;
    }

    tx.set(solicitudRef, solicitudPatch, { merge: true });

    tx.set(db.collection("iqCreateBatches").doc(input.batchId), {
      status: "PROCESSING",
      processedItems: FieldValue.increment(1),
      linkedItems: iqId ? FieldValue.increment(1) : FieldValue.increment(0),
      uncertainItems: submitted && !iqId ? FieldValue.increment(1) : FieldValue.increment(0),
      failedItems: !submitted ? FieldValue.increment(1) : FieldValue.increment(0),
      updatedAt: now,
    }, { merge: true });
  });

  const attemptRef = db
    .collection("solicitudes")
    .doc(input.job.solicitudId)
    .collection("iqAttempts")
    .doc(input.job.fingerprint);

  await attemptRef.set(
    {
      version: IQ_CREATE_ATTEMPT_GUARD_VERSION_H4D82A4,
      solicitudFolio: input.job.solicitudFolio,
      fingerprint: input.job.fingerprint,
      profileId: input.job.profileId,
      profileAlias: input.job.profileAlias || null,
      orderUploadId: input.job.orderUploadId,
      orderStoragePath: input.job.orderStoragePath,
      orderFileName: input.job.orderFileName,
      amount: input.job.amount,
      invoiceType: input.job.invoiceType,
      marker: input.job.marker,
      status: iqId
        ? "CREATED_CONFIRMED"
        : submitted
          ? "CREATED_PENDING_FOLIO"
          : "FAILED_SAFE",
      iqFolio: iqId || null,
      submitClicked: submitted,
      outcome,
      error: error || null,
      responseMessage: responseMessage || null,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  if (input.job.previousIqFolio && input.job.previousOrderUploadId) {
    const previousAttemptKey = crypto
      .createHash("sha256")
      .update(
        [
          input.job.solicitudId,
          input.job.previousIqFolio,
          input.job.previousOrderUploadId,
        ].join("|"),
      )
      .digest("hex");

    await db
      .collection("solicitudes")
      .doc(input.job.solicitudId)
      .collection("iqAttempts")
      .doc(previousAttemptKey)
      .set(
        {
          version: IQ_CREATE_ATTEMPT_GUARD_VERSION_H4D82A4,
          solicitudFolio: input.job.solicitudFolio,
          iqFolio: input.job.previousIqFolio,
          orderUploadId: input.job.previousOrderUploadId,
          status: "REJECTED_TERMINAL",
          replacedByFingerprint: input.job.fingerprint,
          replacedByIqFolio: iqId || null,
          updatedAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
  }

  if (iqId) {
    await enqueueIqStatusMonitorJob({
      solicitudId: input.job.solicitudId,
      solicitudFolio: input.job.solicitudFolio,
      rootId: input.job.rootId,
      profileId: input.job.profileId,
      profileAlias: input.job.profileAlias,
      marker: input.job.marker,
      iqFolio: iqId,
      amount: input.job.amount,
      targetDateIso: input.job.targetDateIso,
      requestedBy: input.job.requestedBy,
      reason: "QUEUE_CREATION_LINKED",
      nextRunAt: new Date(Date.now() + 20 * 60 * 1000),
    }).catch(() => undefined);
  }

  if (submitted && !iqId) {
    await enqueueIqReconciliationJob({
      solicitudId: input.job.solicitudId,
      solicitudFolio: input.job.solicitudFolio,
      rootId: input.job.rootId,
      profileId: input.job.profileId,
      profileAlias: input.job.profileAlias,
      marker: input.job.marker,
      amount: input.job.amount,
      targetDateIso: input.job.targetDateIso,
      requestedBy: input.job.requestedBy,
      reason: "QUEUE_CREATION_OUTCOME_UNKNOWN",
      nextRunAt: new Date(Date.now() + 2 * 60 * 1000),
    }).catch(() => undefined);
  }

  await safeLogActivity({
    event: iqId
      ? "IQ_SOLICITUD_CREACION_EXITOSA"
      : submitted
        ? "IQ_SOLICITUD_RESULTADO_INCIERTO"
        : "IQ_SOLICITUD_CREACION_FALLIDA",
    rootId: input.job.rootId,
    adminId: input.job.rootId,
    actorUid: input.job.requestedBy,
    actorName: input.job.requestedBy,
    actorUsername: input.job.requestedBy,
    actorRole: "system",
    referenceId: input.job.solicitudId,
    referenceFolio: input.job.solicitudFolio,
    referenceType: "solicitud",
    entityId: input.job.solicitudId,
    entityType: "solicitud",
    amount: input.job.amount,
    description: iqId
      ? `Solicitud ${input.job.solicitudFolio} creada en IQ por cola. FOLIO IQ: ${iqId}`
      : submitted
        ? `Resultado IQ incierto para solicitud ${input.job.solicitudFolio}.`
        : `No se creo la solicitud ${input.job.solicitudFolio} en IQ por cola.`,
    extra: {
      batchId: input.batchId,
      profileId: input.job.profileId,
      profileAlias: input.job.profileAlias || null,
      attemptCount: input.attemptCount,
      outcome,
      iqId: iqId || null,
      submitClicked: submitted,
      responseMessage: responseMessage || null,
      error: error || null,
    },
  });
}

async function publishSuperadminQueueSummary(input: {
  rootId: string;
  profileId: string;
  profileAlias: string;
  batchId: string;
  total: number;
  linked: number;
  uncertain: number;
  failed: number;
  durationMs: number;
}): Promise<void> {
  try {
    const linkedSnap = await db
      .collection("telegramUsers")
      .where("uid", "==", input.rootId)
      .where("active", "==", true)
      .limit(5)
      .get();

    const text = [
      "PAY0 / IQ lote procesado",
      "",
      `Batch: ${input.batchId}`,
      `Cuenta IQ: ${input.profileAlias || input.profileId}`,
      `Total: ${input.total}`,
      `Vinculadas: ${input.linked}`,
      `Pendientes conciliacion: ${input.uncertain}`,
      `Fallidas: ${input.failed}`,
      `Duracion: ${input.durationMs} ms`,
    ].join("\n");

    for (const doc of linkedSnap.docs) {
      const chatId = cleanText(doc.data()?.chatId);
      if (chatId) {
        await sendTelegramMessage(TELEGRAM_BOT_TOKEN.value(), chatId, text);
      }
    }
  } catch {
    // Notification is best effort.
  }
}

async function processProfileJobs(profileId: string, jobs: IqCreateJob[]): Promise<{
  total: number;
  linked: number;
  uncertain: number;
  failed: number;
}> {
  const leaseToken = await acquireProfileLock(profileId);
  if (!leaseToken) {
    return { total: 0, linked: 0, uncertain: 0, failed: 0 };
  }

  const startedAtMs = Date.now();
  let batchId = cleanText(jobs[0]?.batchId) || `iqbatch-runtime-${crypto.randomUUID().slice(0, 8)}`;
  let browserBatchStarted = false;
  const browserJobIds = new Set<string>();

  try {
    const profileSnap = await db.collection("iqCredentialProfiles").doc(profileId).get();
    if (!profileSnap.exists) {
      throw new Error("Cuenta IQ no encontrada.");
    }
    const profile = asRecord(profileSnap.data());
    const password = decryptSecret(profile);
    const erpUrl = normalizeErpUrl(cleanText(profile.erpUrl));
    const username = cleanText(profile.username);
    const timeZone = await loadIqTimeZone(cleanText(profile.rootId) || jobs[0]?.rootId || "root");

    const limitedJobs = jobs.slice(0, MAX_JOBS_PER_PROFILE);
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "pay0-iq-batch-"));

    try {
      const items: IqCreateInvoiceBatchItem[] = [];
      const jobByKey = new Map<string, { job: IqCreateJob; attemptCount: number }>();

      for (const job of limitedJobs) {
        const attemptCount = await markJobProcessing(job);
        const temporaryFilePath = path.join(tempDir, `${job.id}-${safeTemporaryFileName(job.orderFileName)}`);
        await admin.storage().bucket().file(job.orderStoragePath).download({
          destination: temporaryFilePath,
        });
        items.push({
          key: job.id,
          associatedName: job.associatedName,
          clientName: job.clientName,
          iqClientId: job.iqClientId,
          companyName: job.companyName,
          invoiceType: job.invoiceType,
          amount: job.amount,
          orderFilePath: temporaryFilePath,
          orderFileName: job.orderFileName,
          comments: job.marker,
          targetDateIso: job.targetDateIso,
        });
        jobByKey.set(job.id, { job, attemptCount });
        browserJobIds.add(job.id);
      }

      // Desde este punto una excepciÃƒÂ³n no demuestra que el botÃƒÂ³n Crear
      // no haya sido pulsado. El lote queda bloqueado para lectura.
      browserBatchStarted = true;

      const batchResult = await runIqCreateInvoiceBatchHttpA53({
        erpUrl,
        username,
        password,
        timeZone,
        items,
        lookupMaxPages: 20,
      });

      let linked = 0;
      let uncertain = 0;
      let failed = 0;

      for (const itemResult of batchResult.items) {
        const queued = jobByKey.get(itemResult.key);
        if (!queued) continue;
        const durationMs = Math.max(0, Date.now() - startedAtMs);
        await finalizeJobFromResult({
          job: queued.job,
          attemptCount: queued.attemptCount,
          result: itemResult,
          durationMs,
          batchId: queued.job.batchId || batchId,
        });
        if (itemResult.iqId) linked += 1;
        else if (itemResult.submitClicked) uncertain += 1;
        else failed += 1;
      }

      await publishSuperadminQueueSummary({
        rootId: jobs[0]?.rootId || cleanText(profile.rootId),
        profileId,
        profileAlias: cleanText(profile.alias),
        batchId,
        total: batchResult.items.length,
        linked,
        uncertain,
        failed,
        durationMs: Math.max(0, Date.now() - startedAtMs),
      });

      return { total: batchResult.items.length, linked, uncertain, failed };
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  } catch (error) {
    const message = safeErrorMessage(error);

    for (const job of jobs.slice(0, MAX_JOBS_PER_PROFILE)) {
      await db.runTransaction(async (tx) => {
        const creationRef = db
          .collection("iqSolicitudCreations")
          .doc(job.solicitudId);
        const solicitudRef = db
          .collection("solicitudes")
          .doc(job.solicitudId);

        const [jobSnap, creationSnap] = await Promise.all([
          tx.get(job.ref),
          tx.get(creationRef),
        ]);

        const currentJob = jobSnap.exists
          ? asRecord(jobSnap.data())
          : {};
        const currentCreation = creationSnap.exists
          ? asRecord(creationSnap.data())
          : {};

        const currentJobStatus = cleanUpper(currentJob.status);
        const currentCreationStatus = cleanUpper(
          currentCreation.status ??
            currentCreation.outcome,
        );

        const alreadyProtected =
          Boolean(cleanText(currentJob.iqId ?? currentCreation.iqId)) ||
          currentJob.submitClicked === true ||
          currentCreation.submitClicked === true ||
          [
            "CREATED",
            "PENDING_RECONCILIATION",
            "REVIEW_REQUIRED_POST_ALREADY_SENT",
            "REVIEW_REQUIRED_PROFILE_OUTCOME_UNKNOWN",
          ].includes(currentJobStatus) ||
          [
            "SUCCEEDED",
            "OUTCOME_UNKNOWN",
            "PENDING_RECONCILIATION",
          ].includes(currentCreationStatus);

        if (alreadyProtected) {
          tx.set(
            job.ref,
            {
              nextRunAt: null,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
          return;
        }

        const outcomeUnknown =
          browserBatchStarted &&
          browserJobIds.has(job.id);

        if (outcomeUnknown) {
          const blockedStatus =
            "REVIEW_REQUIRED_PROFILE_OUTCOME_UNKNOWN";

          tx.set(
            job.ref,
            {
              status: blockedStatus,
              outcome: "UNKNOWN",
              retryBlocked: true,
              error: message,
              nextRunAt: null,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          );

          tx.set(
            creationRef,
            {
              rootId: job.rootId,
              solicitudId: job.solicitudId,
              solicitudFolio: job.solicitudFolio || null,
              status: "OUTCOME_UNKNOWN",
              outcome: "UNKNOWN",
              source: "QUEUE_PROFILE_FAILURE",
              fingerprint: job.fingerprint,
              profileId: job.profileId,
              profileAlias: job.profileAlias || null,
              marker: job.marker,
              retryBlocked: true,
              error: message,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          );

          tx.set(
            solicitudRef,
            {
              iqCreateQueueStatus: blockedStatus,
              iqCreationStatus: "OUTCOME_UNKNOWN",
              iqCreationOutcome: "UNKNOWN",
              iqCreationRetryBlocked: true,
              iqCreationLastError: message,
              iqReconciliationStatus: "PENDING",
              iqReconciliationNextCheckAt: null,
              iqSyncUpdatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          );

          return;
        }

        tx.set(
          job.ref,
          {
            status: "FAILED_RETRYABLE",
            error: message,
            nextRunAt: Timestamp.fromMillis(
              Date.now() + RETRYABLE_DELAY_MS,
            ),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

        tx.set(
          solicitudRef,
          {
            iqCreateQueueStatus: "FAILED_RETRYABLE",
            iqCreationStatus: "FAILED_RETRYABLE",
            iqCreationLastError: message,
            iqSyncUpdatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }).catch(() => undefined);
    }

    return { total: 0, linked: 0, uncertain: 0, failed: jobs.length };
  } finally {
    await releaseProfileLock(profileId, leaseToken);
  }
}

export const processIqCreateQueue = onSchedule(
  {
    schedule: "every 5 minutes", // H4_D87_A58_A15_HEARTBEAT_5_MIN
    timeZone: DEFAULT_IQ_TIME_ZONE,
    timeoutSeconds: 540,
    memory: "2GiB",
    secrets: [IQ_CREDENTIALS_KEY, TELEGRAM_BOT_TOKEN],
  },
  async () => {
    // H4_D82_A3_A6_A3D_SOLICITUD_CREATE_AUTOMATION
    // Guard econÃƒÂ³mico: primero lee ÃƒÂºnicamente la configuraciÃƒÂ³n.
    // La creaciÃƒÂ³n de solicitudes permanece 24/7 y no consulta la
    // cola ni abre Chromium cuando el proceso estÃƒÂ¡ pausado.
    const enabledRoots = await loadEnabledIqAutomationRoots({
      process: "solicitudCreate",
      purpose: "CREATION",
      respectWindow: false,
    });

    if (enabledRoots.size === 0) {
      return;
    }

    const queuedJobs = await loadQueuedJobs();

    const scopedJobs = queuedJobs.filter((job) =>
      enabledRoots.has(job.rootId),
    );

    const approvedJobs =
      await revalidateIqCreateJobsH4D82A4(scopedJobs);

    const jobs = approvedJobs.slice(0, MAX_JOBS_PER_RUN);

    const byProfile = new Map<string, IqCreateJob[]>();

    for (const job of jobs) {
      const current = byProfile.get(job.profileId) ?? [];
      current.push(job);
      byProfile.set(job.profileId, current);
    }

    let total = 0;
    let linked = 0;
    let uncertain = 0;
    let failed = 0;

    for (const [profileId, profileJobs] of byProfile.entries()) {
      const result = await processProfileJobs(profileId, profileJobs);
      total += result.total;
      linked += result.linked;
      uncertain += result.uncertain;
      failed += result.failed;
    }

    const health = {
      scannedJobs: queuedJobs.length,
      scopedJobs: scopedJobs.length,
      approvedJobs: approvedJobs.length,
      selectedJobs: jobs.length,
      rejectedByRevalidation:
        Math.max(0, scopedJobs.length - approvedJobs.length),
      deferredApprovedJobs:
        Math.max(0, approvedJobs.length - jobs.length),
      total,
      linked,
      uncertain,
      failed,
      profiles: byProfile.size,
      enabledRoots: enabledRoots.size,
    };

    console.info("IQ_CREATE_QUEUE_PROCESSED", health);

    await db
      .collection("iqAutomationHealth")
      .doc("solicitudCreate")
      .set(
        {
          ...health,
          status:
            failed > 0 || uncertain > 0
              ? "ATTENTION"
              : "OK",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      .catch(() => undefined);
  },
);
