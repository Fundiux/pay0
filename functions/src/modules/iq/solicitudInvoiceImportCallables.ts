import { evaluateIqDispatchGate } from "../dispatches/iqGate";
import { DEFAULT_IQ_ERP_URL } from "./config";
import * as crypto from "crypto";
import * as zlib from "zlib";
import * as admin from "firebase-admin";
import type { DocumentReference, DocumentSnapshot, Transaction } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";

import {
  runIqDownloadInvoiceZipHttpA55 as runIqDownloadInvoiceZipByMarker,
} from "./solicitudInvoiceDownloadHttpA55";
import {
  evaluateIqOperatingWindow,
  getIqReconciliationDelayMs,
  normalizeIqOperatingCalendarConfig,
  type IqOperatingCalendarConfig,
  type IqOperatingWindow,
} from "./operatingCalendar";
import { buildSolicitudDocumentStoragePath, getSolicitudDocumentTypeLabel, sanitizeFilename, type SolicitudDocumentType } from "../solicitudDocuments/domain";
import { finalizeSolicitudDocumentVersionTx } from "../solicitudDocuments/lifecycle";
import { logActivity, logActivityTx, type ActivityLogParams } from "../../utils/logActivity";
import { sendTelegramMessage } from "../telegram/service";
import { assertIqAuthorized } from "./authorization";

import { loadEnabledIqAutomationRoots } from "./automationRuntime";
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

const IQ_CREDENTIALS_KEY = defineSecret("IQ_CREDENTIALS_KEY");
const TELEGRAM_BOT_TOKEN = defineSecret("TELEGRAM_BOT_TOKEN");

const DEFAULT_IQ_TIME_ZONE = "America/Mexico_City";
const IQ_INVOICE_IMPORT_VERSION = "IQ-INVOICE-IMPORT-1";
const PROFILE_LOCK_MS = 15 * 60 * 1000;
const MAX_JOBS_PER_RUN = 30;
const MAX_JOBS_PER_PROFILE = 10;
const CONFIG_NOT_READY_RETRY_MS = 24 * 60 * 60 * 1000;
const MAX_ZIP_BYTES = 25 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

type AuthContext = {
  uid: string;
  role: string;
  rootId: string;
  user: Record<string, unknown>;
};

type IqInvoiceJob = {
  ref: DocumentReference;
  id: string;
  solicitudId: string;
  solicitudFolio: string;
  rootId: string;
  profileId: string;
  profileAlias: string;
  marker: string;
  iqFolio: string;
  targetDateIso: string;
  amount: number;
  attemptCount: number;
  requestedBy: string;
};

type ZipEntry = {
  name: string;
  buffer: Buffer;
};

type CfdiMetadata = {
  uuid: string | null;
  serie: string | null;
  folio: string | null;
  display: string | null;
  total: number | null;
  subtotal: number | null;
  metodoPago: string | null;
  moneda: string | null;
  fecha: string | null;
  emisorRfc: string | null;
  receptorRfc: string | null;
};

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}


function iqTerminalUpper(value: unknown): string {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
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
  ].map(iqTerminalUpper);

  if (values.some((value) => IQ_TERMINAL_SOLICITUD_STATUSES.has(value))) {
    return true;
  }

  return data.iqInvoiceImportOmitted === true ||
    data.iqStatusOmitted === true ||
    data.iqCreateOmitted === true ||
    data.iqWorkOmitted === true;
}

function getIqTerminalStopReason(data: Record<string, unknown>): string {
  const status = iqTerminalUpper(data.status ?? data.estado ?? data.solicitudStatus);
  if (status) {
    return `Solicitud PAY0 terminal: ${status}.`;
  }

  if (data.iqInvoiceImportOmitted === true || data.iqStatusOmitted === true || data.iqCreateOmitted === true) {
    return "Seguimiento IQ omitido por Super Admin.";
  }

  return "Solicitud PAY0 terminal u omitida.";
}
function normalizeIsoDate(value: unknown): string {
  const raw = cleanText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function timestampMillis(value: unknown): number {
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
  return Number(value) || 0;
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

function assertSuperAdmin(auth: AuthContext): void {
  if (auth.role !== "superadmin") {
    throw new HttpsError("permission-denied", "Solo Super Admin puede sincronizar facturas del despacho.");
  }
}

// IQ_CANON_FOLLOW_UP_OPERATING_WINDOW:
// Este horario canonico aplica a seguimiento IQ:
// facturas, estatus, rechazos, conciliacion y discovery.
// La creacion en IQ puede ser 24/7 si el modulo lo permite.
const CANONICAL_IQ_INVOICE_WEEKLY_WINDOWS: Record<string, IqOperatingWindow[]> = {
  sunday: [],
  monday: [{ start: "09:00", end: "19:00" }],
  tuesday: [{ start: "09:00", end: "19:00" }],
  wednesday: [{ start: "09:00", end: "19:00" }],
  thursday: [{ start: "09:00", end: "19:00" }],
  friday: [{ start: "09:00", end: "19:00" }],
  saturday: [{ start: "09:00", end: "14:30" }],
};

function hasAnyIqOperatingWindow(config: IqOperatingCalendarConfig): boolean {
  return Object.values(config.weeklyWindows).some((windows) => windows.length > 0);
}

type InvoiceLocalDateParts = {
  year: number;
  month: number;
  day: number;
  weekday: string;
};

function getInvoiceLocalDateParts(value: Date, timeZone: string): InvoiceLocalDateParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
  }).formatToParts(value);

  const map = parts.reduce<Record<string, string>>((acc, part) => {
    if (part.type !== "literal") {
      acc[part.type] = part.value;
    }
    return acc;
  }, {});

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    weekday: cleanText(map.weekday).toLowerCase(),
  };
}

function invoiceDateKey(parts: InvoiceLocalDateParts): string {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function isLastFridayOrSaturdayOfMonth(parts: InvoiceLocalDateParts): boolean {
  if (parts.weekday !== "friday" && parts.weekday !== "saturday") {
    return false;
  }
  const daysInMonth = new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate();
  return parts.day + 7 > daysInMonth;
}

function withCanonicalIqInvoiceOperatingConfig(
  config: IqOperatingCalendarConfig,
  referenceDate = new Date(),
): IqOperatingCalendarConfig {
  const configured = hasAnyIqOperatingWindow(config);
  const weeklyWindows = configured
    ? config.weeklyWindows
    : CANONICAL_IQ_INVOICE_WEEKLY_WINDOWS;

  const normalized: IqOperatingCalendarConfig = {
    ...config,
    enabled: configured ? config.enabled : true,
    weeklyWindows,
    invoiceCutoffMinutes: Math.max(0, Number(config.invoiceCutoffMinutes ?? 15) || 15),
  };

  const parts = getInvoiceLocalDateParts(referenceDate, normalized.timezone || DEFAULT_IQ_TIME_ZONE);
  const dateKey = invoiceDateKey(parts);

  if (
    isLastFridayOrSaturdayOfMonth(parts) &&
    !normalized.dateOverrides[dateKey]
  ) {
    normalized.dateOverrides = {
      ...normalized.dateOverrides,
      [dateKey]: {
        windows: [{ start: "09:00", end: "21:00" }],
      },
    };
  }

  return normalized;
}

async function loadOperatingConfig(rootId: string): Promise<IqOperatingCalendarConfig> {
  const snap = await db.collection("iqIntegrationConfigs").doc(rootId).get();
  return withCanonicalIqInvoiceOperatingConfig(
    normalizeIqOperatingCalendarConfig(snap.exists ? snap.data() : {}),
  );
}

function invoiceRetryDelayMs(failedAttemptCount: number): number {
  if (failedAttemptCount <= 0) {
    return 30 * 60 * 1000;
  }

  if (failedAttemptCount === 1) {
    return 20 * 60 * 1000;
  }

  if (failedAttemptCount === 2) {
    return 60 * 60 * 1000;
  }

  return 30 * 60 * 1000;
}

function nextInvoiceRunAt(
  config: IqOperatingCalendarConfig,
  failedAttemptCount: number,
  now = new Date(),
): Date {
  const candidate = new Date(now.getTime() + invoiceRetryDelayMs(failedAttemptCount));
  const invoiceConfig = withCanonicalIqInvoiceOperatingConfig(config, candidate);
  const decision = evaluateIqOperatingWindow(invoiceConfig, candidate, "INVOICE");
  if (decision.allowed) {
    return candidate;
  }
  return decision.nextEligibleAt ?? new Date(now.getTime() + CONFIG_NOT_READY_RETRY_MS);
}

function firstInvoiceAttemptAt(
  config: IqOperatingCalendarConfig,
  iqCreatedAt: Date,
  now = new Date(),
): Date {
  const firstCandidate = new Date(iqCreatedAt.getTime() + 30 * 60 * 1000);
  const reference = firstCandidate.getTime() > now.getTime() ? firstCandidate : now;
  const invoiceConfig = withCanonicalIqInvoiceOperatingConfig(config, reference);
  const decision = evaluateIqOperatingWindow(invoiceConfig, reference, "INVOICE");
  if (decision.allowed) {
    return reference;
  }
  return decision.nextEligibleAt ?? new Date(now.getTime() + CONFIG_NOT_READY_RETRY_MS);
}
function getQueueRef(solicitudId: string): DocumentReference {
  return db.collection("iqInvoiceJobs").doc(`invoice_${solicitudId}`);
}

export async function enqueueIqInvoiceImportJob(input: {
  solicitudId: string;
  solicitudFolio: string;
  rootId: string;
  profileId: string;
  profileAlias?: string;
  marker: string;
  iqFolio: string;
  targetDateIso?: string;
  amount?: number;
  requestedBy: string;
  reason: string;
  nextRunAt?: Date;
}): Promise<void> {
  if (!input.solicitudId || !input.rootId) {
    return;
  }

  const now = new Date();
  const ref = getQueueRef(input.solicitudId);

  const [solicitudSnap, creationSnap] = await Promise.all([
    db.collection("solicitudes")
      .doc(input.solicitudId)
      .get()
      .catch(() => null),

    db.collection("iqSolicitudCreations")
      .doc(input.solicitudId)
      .get()
      .catch(() => null),
  ]);

  const solicitud = solicitudSnap?.exists
    ? asRecord(solicitudSnap.data())
    : {};

  const creation = creationSnap?.exists
    ? asRecord(creationSnap.data())
    : {};

  // Misma prioridad canonica que usa buildJobForSolicitud()
  // en la sincronizacion manual.
  input.solicitudFolio = cleanText(
    solicitud.folio ??
    solicitud.folioSolicitud ??
    input.solicitudFolio ??
    input.solicitudId,
  );

  input.iqFolio = cleanText(
    solicitud.iqFolio ??
    solicitud.iqId ??
    creation.iqId ??
    input.iqFolio,
  );

  input.profileId = cleanText(
    solicitud.iqCredentialProfileId ??
    creation.profileId ??
    input.profileId,
  );

  input.profileAlias = cleanText(
    creation.profileAlias ??
    solicitud.iqProfileAlias ??
    input.profileAlias,
  );

  input.marker = cleanText(
    solicitud.iqReconciliationMarker ??
    creation.marker ??
    creation.creationMarker ??
    input.marker,
  );

  const currentTargetDateIso = normalizeIsoDate(
    solicitud.iqTargetDateIso ??
    creation.targetDateIso ??
    input.targetDateIso,
  );

  if (currentTargetDateIso) {
    input.targetDateIso = currentTargetDateIso;
  }

  const currentAmount = Number(
    solicitud.monto ??
    solicitud.amount ??
    solicitud.total ??
    creation.amount ??
    input.amount ??
    0,
  );

  if (Number.isFinite(currentAmount)) {
    input.amount = currentAmount;
  }

  if (!input.profileId || !input.marker || !input.iqFolio) {
    await ref.set({
      jobType: "IQ_INVOICE_IMPORT",
      version: IQ_INVOICE_IMPORT_VERSION,
      status: "WAITING",
      solicitudId: input.solicitudId,
      solicitudFolio: input.solicitudFolio || input.solicitudId,
      rootId: input.rootId,
      lastError:
        "No se pudieron reconstruir Folio IQ, perfil y marcador actuales.",
      lastErrorCode: "IQ_INVOICE_CURRENT_METADATA_MISSING",
      nextRunAt: Timestamp.fromMillis(Date.now() + 5 * 60 * 1000),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return;
  }

  if (solicitudSnap?.exists) {
    if (isIqTerminalOrOmittedSolicitud(solicitud)) {
      const reason = getIqTerminalStopReason(solicitud);
      await ref.set({
        jobType: "IQ_INVOICE_IMPORT",
        version: IQ_INVOICE_IMPORT_VERSION,
        status: "STOPPED_SOLICITUD_TERMINAL",
        solicitudId: input.solicitudId,
        solicitudFolio: input.solicitudFolio || input.solicitudId,
        rootId: input.rootId,
        profileId: input.profileId,
        profileAlias: input.profileAlias || null,
        marker: input.marker,
        iqFolio: input.iqFolio,
        targetDateIso: normalizeIsoDate(input.targetDateIso) || null,
        amount: Number(input.amount ?? 0) || 0,
        requestedBy: input.requestedBy,
        reason: input.reason,
        lastError: reason,
        lastErrorCode: "STOPPED_SOLICITUD_TERMINAL",
        nextRunAt: null,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      await solicitudSnap.ref.set({
        iqInvoiceImportStatus: "OMITTED",
        iqInvoiceAutoDiscoveryStatus: "STOPPED_SOLICITUD_TERMINAL",
        iqInvoiceImportLastError: reason,
        iqInvoiceAutoDiscoveryLastCheckedAt: FieldValue.serverTimestamp(),
        iqInvoiceSyncUpdatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true }).catch(() => undefined);
      return;
    }
  }

  await ref.set({
    jobType: "IQ_INVOICE_IMPORT",
    version: IQ_INVOICE_IMPORT_VERSION,
    status: "QUEUED",
    solicitudId: input.solicitudId,
    solicitudFolio: input.solicitudFolio || input.solicitudId,
    rootId: input.rootId,
    profileId: input.profileId,
    profileAlias: input.profileAlias || null,
    marker: input.marker,
    iqFolio: input.iqFolio,
    targetDateIso: normalizeIsoDate(input.targetDateIso) || null,
    amount: Number(input.amount ?? 0) || 0,
    requestedBy: input.requestedBy,
    reason: input.reason,
    nextRunAt: Timestamp.fromDate(input.nextRunAt ?? now),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

function parseJob(snapshot: DocumentSnapshot): IqInvoiceJob | null {
  const data = asRecord(snapshot.data());
  const solicitudId = cleanText(data.solicitudId);
  const rootId = cleanText(data.rootId);
  const profileId = cleanText(data.profileId);
  const marker = cleanText(data.marker);
  const iqFolio = cleanText(data.iqFolio);
  if (!solicitudId || !rootId || !profileId || !marker || !iqFolio) {
    return null;
  }
  return {
    ref: snapshot.ref,
    id: snapshot.id,
    solicitudId,
    solicitudFolio: cleanText(data.solicitudFolio) || solicitudId,
    rootId,
    profileId,
    profileAlias: cleanText(data.profileAlias),
    marker,
    iqFolio,
    targetDateIso: normalizeIsoDate(data.targetDateIso) || dateIsoInTimeZone(new Date(), DEFAULT_IQ_TIME_ZONE),
    amount: Number(data.amount ?? 0) || 0,
    attemptCount: Math.max(0, Number(data.attemptCount ?? 0) || 0),
    requestedBy: cleanText(data.requestedBy),
  };
}

async function acquireProfileLock(profileId: string, workerToken: string): Promise<boolean> {
  const lockRef = db.collection("iqAccountLocks").doc(profileId);
  const nowMs = Date.now();
  return db.runTransaction(async (tx: Transaction) => {
    const snap = await tx.get(lockRef);
    const current = snap.exists ? asRecord(snap.data()) : {};
    const leaseUntilMs = timestampMillis(current.leaseUntil);
    const currentToken = cleanText(current.workerToken);
    if (leaseUntilMs > nowMs && currentToken && currentToken !== workerToken) {
      return false;
    }
    tx.set(lockRef, {
      profileId,
      workerToken,
      status: "ACTIVE",
      leaseUntil: Timestamp.fromMillis(nowMs + PROFILE_LOCK_MS),
      acquiredAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return true;
  });
}

async function releaseProfileLock(profileId: string, workerToken: string): Promise<void> {
  const lockRef = db.collection("iqAccountLocks").doc(profileId);
  await db.runTransaction(async (tx: Transaction) => {
    const snap = await tx.get(lockRef);
    const current = snap.exists ? asRecord(snap.data()) : {};
    if (cleanText(current.workerToken) !== workerToken) {
      return;
    }
    tx.set(lockRef, {
      status: "IDLE",
      workerToken: FieldValue.delete(),
      leaseUntil: FieldValue.delete(),
      releasedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }).catch(() => undefined);
}

async function loadProfile(job: IqInvoiceJob): Promise<{
  username: string;
  password: string;
  erpUrl: string;
  alias: string;
}> {
  const snap = await db.collection("iqCredentialProfiles").doc(job.profileId).get();
  if (!snap.exists) {
    throw new HttpsError("failed-precondition", "Cuenta IQ no encontrada.");
  }
  const profile = asRecord(snap.data());
  if (cleanText(profile.rootId) !== job.rootId || profile.active !== true || profile.hasPassword !== true) {
    throw new HttpsError("failed-precondition", "La cuenta IQ esta inactiva o fuera de scope.");
  }
  const username = cleanText(profile.username);
  if (!username) {
    throw new HttpsError("failed-precondition", "La cuenta IQ no tiene usuario configurado.");
  }
  return {
    username,
    password: decryptSecret(profile),
    erpUrl: normalizeErpUrl(cleanText(profile.erpUrl)),
    alias: cleanText(profile.alias),
  };
}

function sha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function classifyIqInvoiceErrorMessage(value: unknown): string {
  const raw = safeErrorMessage(value);
  const upper = raw.toUpperCase();
  if (/UNEXPECTED END OF FILE|Z_BUF_ERROR|INVALID STORED BLOCK LENGTH|INCORRECT HEADER CHECK|Z_DATA_ERROR|IQ_INVOICE_ZIP_DOWNLOAD_INCOMPLETE_TIMEOUT|ZIP_DOWNLOAD_INCOMPLETE_TIMEOUT|IQ_INVOICE_ZIP_EOCD_NOT_FOUND|IQ_INVOICE_ZIP_DATA_OUT_OF_RANGE|IQ_INVOICE_ZIP_CENTRAL_DIRECTORY_OUT_OF_RANGE|IQ_INVOICE_ZIP_CENTRAL_DIRECTORY_ENTRY_OUT_OF_RANGE/.test(upper)) {
    return "IQ_INVOICE_ZIP_INCOMPLETE";
  }
  if (/HTML|DOCTYPE|<HTML|LOGIN|INICIAR SESION|INICIAR SESI/.test(upper)) {
    return "IQ_INVOICE_DOWNLOAD_HTML_RESPONSE";
  }
  if (/NOT ZIP|FILE_IS_NOT_ZIP|CENTRAL DIRECTORY|END OF CENTRAL/.test(upper)) {
    return "IQ_INVOICE_DOWNLOAD_NOT_ZIP";
  }
  if (/TIMEOUT|TIMED OUT|PROTOCOLERROR|RUNTIMECALLFUNCTIONON TIMED OUT|TARGET CLOSED/.test(upper)) {
    return "IQ_SESSION_TIMEOUT";
  }
  if (/IQ_INVOICE_ACTION_NOT_AVAILABLE/.test(upper)) {
    return "IQ_INVOICE_ACTION_NOT_AVAILABLE";
  }
  if (/IQ_INVOICE_MARKER_NOT_FOUND/.test(upper)) {
    return "IQ_INVOICE_RECORD_NOT_FOUND";
  }
  if (/IQ_INVOICE_XML_NOT_FOUND/.test(upper)) {
    return "IQ_INVOICE_XML_NOT_FOUND_IN_ZIP";
  }
  if (/IQ_INVOICE_PDF_NOT_FOUND/.test(upper)) {
    return "IQ_INVOICE_PDF_NOT_FOUND_IN_ZIP";
  }
  return raw || "IQ_INVOICE_IMPORT_ERROR";
}

function getIqInvoiceErrorCode(value: unknown): string | null {
  const classified = classifyIqInvoiceErrorMessage(value);
  const code = cleanText(classified.split(":")[0]).toUpperCase();
  return /^IQ_[A-Z0-9_]+$/.test(code) ? code.slice(0, 120) : null;
}

function inspectInvoiceDownloadBuffer(buffer: Buffer): { ok: boolean; code: string } {
  if (!buffer || buffer.length <= 0) {
    return { ok: false, code: "IQ_INVOICE_DOWNLOAD_EMPTY" };
  }
  if (buffer.length > MAX_ZIP_BYTES) {
    return { ok: false, code: "IQ_INVOICE_ZIP_SIZE_INVALID" };
  }
  const sample = buffer.slice(0, Math.min(buffer.length, 2048)).toString("utf8").trim();
  if (/^<!doctype\s+html/i.test(sample) || /^<html[\s>]/i.test(sample) || /<form[^>]+password|iniciar\s+sesi[oÃ³]n|login/i.test(sample)) {
    return { ok: false, code: "IQ_INVOICE_DOWNLOAD_HTML_RESPONSE" };
  }
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) {
    return { ok: false, code: "IQ_INVOICE_DOWNLOAD_NOT_ZIP" };
  }
  return { ok: true, code: "OK" };
}

function readUInt16(buffer: Buffer, offset: number): number {
  if (offset < 0 || offset + 2 > buffer.length) {
    return 0;
  }
  return buffer.readUInt16LE(offset);
}

function readUInt32(buffer: Buffer, offset: number): number {
  if (offset < 0 || offset + 4 > buffer.length) {
    return 0;
  }
  return buffer.readUInt32LE(offset);
}

function findZipEndOfCentralDirectoryOffset(buffer: Buffer): number {
  const minOffset = Math.max(0, buffer.length - 22 - 65_535);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (readUInt32(buffer, offset) === 0x06054b50) {
      return offset;
    }
  }
  return -1;
}

function decodeZipEntryName(buffer: Buffer, flags: number): string {
  const value = buffer.toString("utf8");
  if (value && !value.includes("\uFFFD")) {
    return value.replace(/\\/g, "/");
  }
  // Los ZIPs de IQ usan nombres UUID simples. latin1 es fallback seguro
  // para no romper si el flag UTF-8 no viene prendido.
  return buffer.toString("latin1").replace(/\\/g, "/");
}

function extractZipEntries(buffer: Buffer): ZipEntry[] {
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) {
    throw new Error("IQ_INVOICE_FILE_IS_NOT_ZIP");
  }

  const eocdOffset = findZipEndOfCentralDirectoryOffset(buffer);
  if (eocdOffset < 0) {
    throw new Error("IQ_INVOICE_ZIP_EOCD_NOT_FOUND");
  }

  const diskNumber = readUInt16(buffer, eocdOffset + 4);
  const centralDirectoryDisk = readUInt16(buffer, eocdOffset + 6);
  if (diskNumber !== 0 || centralDirectoryDisk !== 0) {
    throw new Error("IQ_INVOICE_ZIP_MULTI_DISK_UNSUPPORTED");
  }

  const entryCountOnDisk = readUInt16(buffer, eocdOffset + 8);
  const entryCount = readUInt16(buffer, eocdOffset + 10) || entryCountOnDisk;
  const centralDirectorySize = readUInt32(buffer, eocdOffset + 12);
  const centralDirectoryOffset = readUInt32(buffer, eocdOffset + 16);

  if (
    centralDirectoryOffset < 0 ||
    centralDirectorySize <= 0 ||
    centralDirectoryOffset + centralDirectorySize > buffer.length ||
    centralDirectoryOffset >= eocdOffset
  ) {
    throw new Error("IQ_INVOICE_ZIP_CENTRAL_DIRECTORY_OUT_OF_RANGE");
  }

  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount && offset + 46 <= buffer.length; index += 1) {
    if (readUInt32(buffer, offset) !== 0x02014b50) {
      throw new Error("IQ_INVOICE_ZIP_CENTRAL_DIRECTORY_INVALID");
    }

    const flags = readUInt16(buffer, offset + 8);
    const compressionMethod = readUInt16(buffer, offset + 10);
    const compressedSize = readUInt32(buffer, offset + 20);
    const uncompressedSize = readUInt32(buffer, offset + 24);
    const nameLength = readUInt16(buffer, offset + 28);
    const extraLength = readUInt16(buffer, offset + 30);
    const commentLength = readUInt16(buffer, offset + 32);
    const localHeaderOffset = readUInt32(buffer, offset + 42);

    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    const extraEnd = nameEnd + extraLength;
    const commentEnd = extraEnd + commentLength;

    if (nameEnd > buffer.length || extraEnd > buffer.length || commentEnd > buffer.length) {
      throw new Error("IQ_INVOICE_ZIP_CENTRAL_DIRECTORY_ENTRY_OUT_OF_RANGE");
    }

    const name = decodeZipEntryName(buffer.slice(nameStart, nameEnd), flags);
    offset = commentEnd;

    if (!name || name.endsWith("/")) {
      continue;
    }

    if (localHeaderOffset + 30 > buffer.length || readUInt32(buffer, localHeaderOffset) !== 0x04034b50) {
      throw new Error("IQ_INVOICE_ZIP_LOCAL_HEADER_NOT_FOUND");
    }

    const localNameLength = readUInt16(buffer, localHeaderOffset + 26);
    const localExtraLength = readUInt16(buffer, localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;

    if (dataStart > buffer.length || dataEnd > buffer.length || dataEnd < dataStart) {
      throw new Error("IQ_INVOICE_ZIP_DATA_OUT_OF_RANGE");
    }

    const compressed = buffer.slice(dataStart, dataEnd);
    let fileBuffer: Buffer;

    if (compressionMethod === 0) {
      fileBuffer = compressed;
    } else if (compressionMethod === 8) {
      fileBuffer = zlib.inflateRawSync(compressed);
    } else {
      throw new Error(`IQ_INVOICE_ZIP_UNSUPPORTED_COMPRESSION:${compressionMethod}`);
    }

    if (uncompressedSize > 0 && fileBuffer.length !== uncompressedSize) {
      throw new Error(`IQ_INVOICE_ZIP_SIZE_MISMATCH:${name}:${fileBuffer.length}:${uncompressedSize}`);
    }

    if (fileBuffer.length > 0) {
      entries.push({ name, buffer: fileBuffer });
    }
  }

  if (entries.length === 0) {
    throw new Error("IQ_INVOICE_ZIP_EMPTY");
  }

  return entries;
}

function readXmlAttribute(tag: string, attr: string): string {
  const escaped = attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rx = new RegExp("\\s" + escaped + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')", "i");
  const match = rx.exec(tag || "");
  return cleanText((match && (match[1] || match[2])) || "");
}

function findXmlTag(xml: string, localName: string): string {
  const rx = new RegExp("<(?:[A-Za-z0-9_]+:)?" + localName + "\\b[^>]*>", "i");
  const match = rx.exec(xml || "");
  return match ? match[0] : "";
}

function toCfdiNumber(value: string): number | null {
  const num = Number(String(value || "").replace(/,/g, "").trim());
  return Number.isFinite(num) ? num : null;
}

function buildFacturaDisplay(serie: string, folio: string, uuid: string): string {
  const cleanSerie = cleanText(serie);
  const cleanFolio = cleanText(folio);
  const cleanUuid = cleanText(uuid);
  if (cleanFolio) {
    if (cleanSerie && !cleanFolio.toUpperCase().startsWith(cleanSerie.toUpperCase())) {
      return `${cleanSerie}${cleanFolio}`;
    }
    return cleanFolio;
  }
  return cleanUuid;
}

function parseCfdiMetadata(xmlBuffer: Buffer): CfdiMetadata {
  const xml = xmlBuffer.toString("utf8");
  const comprobanteTag = findXmlTag(xml, "Comprobante");
  const timbreTag = findXmlTag(xml, "TimbreFiscalDigital");
  const emisorTag = findXmlTag(xml, "Emisor");
  const receptorTag = findXmlTag(xml, "Receptor");
  if (!comprobanteTag) {
    throw new Error("IQ_INVOICE_XML_NOT_CFDI");
  }
  const serie = readXmlAttribute(comprobanteTag, "Serie") || null;
  const folio = readXmlAttribute(comprobanteTag, "Folio") || null;
  const uuid = readXmlAttribute(timbreTag, "UUID").toUpperCase() || null;
  const total = toCfdiNumber(readXmlAttribute(comprobanteTag, "Total"));
  const subtotal = toCfdiNumber(readXmlAttribute(comprobanteTag, "SubTotal"));
  const metodoPago = readXmlAttribute(comprobanteTag, "MetodoPago").toUpperCase() || null;
  const moneda = readXmlAttribute(comprobanteTag, "Moneda").toUpperCase() || null;
  const fecha = readXmlAttribute(comprobanteTag, "Fecha") || null;
  const emisorRfc = readXmlAttribute(emisorTag, "Rfc").toUpperCase() || null;
  const receptorRfc = readXmlAttribute(receptorTag, "Rfc").toUpperCase() || null;
  const display = cleanText(buildFacturaDisplay(serie || "", folio || "", uuid || "")) || null;
  return { uuid, serie, folio, display, total, subtotal, metodoPago, moneda, fecha, emisorRfc, receptorRfc };
}

function chooseInvoiceFiles(entries: ZipEntry[]): { pdf: ZipEntry; xml: ZipEntry } {
  const xmlCandidates = entries.filter((entry) => /\.xml$/i.test(entry.name) || /<\?xml|<[^>]*Comprobante\b/i.test(entry.buffer.toString("utf8", 0, Math.min(entry.buffer.length, 1000))));
  const pdfCandidates = entries.filter((entry) => /\.pdf$/i.test(entry.name) || entry.buffer.slice(0, 4).toString("latin1") === "%PDF");
  const xml = xmlCandidates.sort((a, b) => b.buffer.length - a.buffer.length)[0];
  const pdf = pdfCandidates.sort((a, b) => b.buffer.length - a.buffer.length)[0];
  if (!xml) {
    throw new Error("IQ_INVOICE_XML_NOT_FOUND_IN_ZIP");
  }
  if (!pdf) {
    throw new Error("IQ_INVOICE_PDF_NOT_FOUND_IN_ZIP");
  }
  if (xml.buffer.length > MAX_DOCUMENT_BYTES || pdf.buffer.length > MAX_DOCUMENT_BYTES) {
    throw new Error("IQ_INVOICE_DOCUMENT_TOO_LARGE");
  }
  return { pdf, xml };
}

function formatMoney(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "";
  }
  return value.toFixed(2);
}

function validateInvoiceMetadata(metadata: CfdiMetadata, expectedAmount: number): void {
  if (!metadata.uuid) {
    throw new Error("IQ_INVOICE_XML_UUID_MISSING");
  }
  if (expectedAmount > 0 && typeof metadata.total === "number" && Math.abs(metadata.total - expectedAmount) > 1) {
    throw new Error(`IQ_INVOICE_TOTAL_MISMATCH:${formatMoney(metadata.total)}:${formatMoney(expectedAmount)}`);
  }
}

async function createImportedUpload(input: {
  rootId: string;
  solicitudId: string;
  solicitud: Record<string, unknown>;
  documentType: SolicitudDocumentType;
  originalName: string;
  contentType: string;
  buffer: Buffer;
  importedBy: string;
  metadata?: Partial<CfdiMetadata>;
  iqFolio: string;
  zipHash: string;
}): Promise<string> {
  const bucket = admin.storage().bucket();
  const uploadId = db.collection("uploads").doc().id;
  const safeName = sanitizeFilename(input.originalName);
  const storagePath = buildSolicitudDocumentStoragePath({ rootId: input.rootId, solicitudId: input.solicitudId, documentType: input.documentType, uploadId, originalName: safeName });
  const fileHash = sha256(input.buffer);
  await bucket.file(storagePath).save(input.buffer, {
    resumable: false,
    contentType: input.contentType,
    metadata: {
      cacheControl: "private, max-age=0, no-transform",
      metadata: {
        sha256: fileHash,
        source: "IQ_INVOICE_ZIP",
        iqFolio: input.iqFolio,
      },
    },
  });

  await db.runTransaction(async (tx: Transaction) => {
    await finalizeSolicitudDocumentVersionTx({
      tx,
      db,
      rootId: input.rootId,
      solicitudId: input.solicitudId,
      documentType: input.documentType,
      uploadId,
      uploadRef: db.collection("uploads").doc(uploadId),
      mode: "create",
      readyPatch: {
        rootId: input.rootId,
        adminId: input.solicitud.adminId || input.rootId,
        clienteId: input.solicitud.clienteId || input.solicitud.clientId || null,
        clienteNombre: input.solicitud.clienteNombre || input.solicitud.clientName || null,
        companyId: input.solicitud.companyId || null,
        empresaNombre: input.solicitud.empresaNombre || input.solicitud.companyName || null,
        entityType: "solicitudes",
        entityId: input.solicitudId,
        solicitudId: input.solicitudId,
        solicitudFolio: input.solicitud.folio || input.solicitud.folioSolicitud || input.solicitudId,
        documentType: input.documentType,
        documentTypeLabel: getSolicitudDocumentTypeLabel(input.documentType),
        originalName: input.originalName,
        filename: safeName,
        contentType: input.contentType,
        sizeBytes: input.buffer.length,
        storagePath,
        sha256: fileHash,
        integrityHashAlgorithm: "SHA-256",
        integritySealStatus: "SEALED",
        integritySealVersion: "PAY0-MATERIALIDAD-V1",
        integritySealedAt: FieldValue.serverTimestamp(),
        integritySealedBy: "system",
        integritySealedUsername: "Sistema",
        source: "IQ_INVOICE_ZIP",
        iqFolio: input.iqFolio,
        iqInvoiceZipHash: input.zipHash,
        importedBy: input.importedBy,
        importedAt: FieldValue.serverTimestamp(),
        createdBy: "system",
        createdUsername: "Sistema",
        finalizedBy: "system",
        finalizedUsername: "Sistema",
        finalizedAt: FieldValue.serverTimestamp(),
        ...(input.metadata?.serie !== undefined ? {
          facturaSerie: input.metadata.serie,
          facturaFolio: input.metadata.folio,
          facturaDisplay: input.metadata.display,
          facturaUuid: input.metadata.uuid,
          facturaSubtotal: input.metadata.subtotal,
          facturaTotal: input.metadata.total,
          facturaMetodoPago: input.metadata.metodoPago,
          facturaMoneda: input.metadata.moneda,
          facturaFecha: input.metadata.fecha,
        } : {}),
        createdAt: FieldValue.serverTimestamp(),
      },
    });
  });
  return uploadId;
}

async function notifyInvoiceImported(input: {
  solicitudId: string;
  solicitudFolio: string;
  rootId: string;
  userUid: string;
  uuid: string;
}): Promise<void> {
  if (!input.userUid) {
    return;
  }
  const message = [
    `La factura de la solicitud ${input.solicitudFolio} ya esta disponible.`,
    "Se agregaron la Factura PDF y la Factura XML a Documentos.",
  ].join("\n");
  await db.collection("userNotifications").doc(`invoice_${input.solicitudId}_${input.uuid || "sin_uuid"}`).set({
    rootId: input.rootId,
    uid: input.userUid,
    audience: "user",
    module: "solicitudes",
    event: "SOLICITUD_FACTURA_DISPONIBLE",
    solicitudId: input.solicitudId,
    solicitudFolio: input.solicitudFolio,
    title: "Factura disponible",
    message,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true }).catch(() => undefined);

  try {
    const linkedSnap = await db
      .collection("telegramUsers")
      .where("uid", "==", input.userUid)
      .where("active", "==", true)
      .limit(5)
      .get();
    for (const doc of linkedSnap.docs) {
      const chatId = cleanText(doc.data()?.chatId);
      if (chatId) {
        await sendTelegramMessage(TELEGRAM_BOT_TOKEN.value(), chatId, message.slice(0, 3900));
      }
    }
  } catch {
    // best effort
  }
}

async function markImported(input: {
  job: IqInvoiceJob;
  zipHash: string;
  zipFileName: string;
  pdfUploadId: string;
  xmlUploadId: string;
  metadata: CfdiMetadata;
  rowText: string;
}): Promise<void> {
  const solicitudRef = db.collection("solicitudes").doc(input.job.solicitudId);
  let userUid = "";
  await db.runTransaction(async (tx: Transaction) => {
    const solicitudSnap = await tx.get(solicitudRef);
    if (!solicitudSnap.exists) {
      throw new HttpsError("not-found", "Solicitud PAY0 no encontrada.");
    }
    const solicitud = asRecord(solicitudSnap.data());
    userUid = cleanText(solicitud.createdBy ?? solicitud.createdByUid ?? solicitud.userId ?? input.job.requestedBy);
    tx.set(solicitudRef, {
      iqInvoiceImportStatus: "IMPORTED",
      iqInvoiceImportLastError: FieldValue.delete(),
      iqInvoiceImportLastErrorCode: FieldValue.delete(),
      iqInvoiceNextCheckAt: FieldValue.delete(),
      iqInvoiceImportedAt: FieldValue.serverTimestamp(),
      iqInvoiceZipHash: input.zipHash,
      iqInvoiceZipFileName: input.zipFileName,
      iqInvoicePdfUploadId: input.pdfUploadId,
      iqInvoiceXmlUploadId: input.xmlUploadId,
      iqInvoiceUuid: input.metadata.uuid,
      iqInvoiceTotal: input.metadata.total,
      iqInvoiceRowText: input.rowText || null,
      facturaPdfUploadId: input.pdfUploadId,
      facturaXmlUploadId: input.xmlUploadId,
      numFactura: input.metadata.display || input.metadata.uuid || null,
      facturaSerie: input.metadata.serie,
      facturaFolio: input.metadata.folio,
      facturaDisplay: input.metadata.display,
      facturaUuid: input.metadata.uuid,
      uuidCfdi: input.metadata.uuid,
      facturaSubtotal: input.metadata.subtotal,
      facturaTotal: input.metadata.total,
      facturaMetodoPago: input.metadata.metodoPago,
      facturaMoneda: input.metadata.moneda,
      facturaFecha: input.metadata.fecha,
      facturaMetadataSource: "IQ_INVOICE_ZIP",
      facturaMetadataUpdatedAt: FieldValue.serverTimestamp(),
      hasUnreadMsg: true,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    tx.set(input.job.ref, {
      status: "IMPORTED",
      lastError: FieldValue.delete(),
      lastErrorCode: FieldValue.delete(),
      zipHash: input.zipHash,
      zipFileName: input.zipFileName,
      pdfUploadId: input.pdfUploadId,
      xmlUploadId: input.xmlUploadId,
      facturaUuid: input.metadata.uuid,
      finishedAt: FieldValue.serverTimestamp(),
      nextRunAt: null,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    tx.set(solicitudRef.collection("notas").doc(`factura-importada-${input.metadata.uuid || input.job.iqFolio}`), {
      rootId: input.job.rootId,
      createdBy: "system",
      createdByName: "Sistema",
      createdByRole: "system",
      source: "DESPACHO",
      text: "Factura PDF y Factura XML agregadas automaticamente a Documentos.",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    logActivityTx(tx, db, {
      event: "IQ_FACTURA_IMPORTADA",
      rootId: input.job.rootId,
      adminId: input.job.rootId,
      actorUid: "system",
      actorUsername: "Sistema",
      actorRole: "system",
      entityType: "solicitudes",
      entityId: input.job.solicitudId,
      referenceId: input.job.solicitudId,
      referenceFolio: input.job.solicitudFolio,
      referenceType: "solicitud",
      amount: input.metadata.total ?? input.job.amount,
      description: `Factura importada automaticamente para solicitud ${input.job.solicitudFolio}.`,
      createdBy: "system",
      extra: {
        iqFolio: input.job.iqFolio,
        facturaUuid: input.metadata.uuid,
        facturaTotal: input.metadata.total,
        pdfUploadId: input.pdfUploadId,
        xmlUploadId: input.xmlUploadId,
        zipHash: input.zipHash,
      },
    });
  });
  await notifyInvoiceImported({
    solicitudId: input.job.solicitudId,
    solicitudFolio: input.job.solicitudFolio,
    rootId: input.job.rootId,
    userUid,
    uuid: input.metadata.uuid || "",
  });
}

async function rescheduleJob(input: {
  job: IqInvoiceJob;
  config: IqOperatingCalendarConfig;
  error?: string;
  status?: string;
}): Promise<void> {
  const attemptCount = input.job.attemptCount + 1;
  const nextRunAt = nextInvoiceRunAt(input.config, attemptCount);
  const classifiedError = input.error ? classifyIqInvoiceErrorMessage(input.error) : "";
  const errorCode = classifiedError ? getIqInvoiceErrorCode(classifiedError) : null;
  await input.job.ref.set({
    status: input.status || "QUEUED",
    attemptCount,
    lastAttemptAt: FieldValue.serverTimestamp(),
    lastError: classifiedError || null,
    lastErrorCode: errorCode,
    nextRunAt: Timestamp.fromDate(nextRunAt),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await db.collection("solicitudes").doc(input.job.solicitudId).set({
    iqInvoiceImportStatus: input.status || "WAITING",
    iqInvoiceImportAttemptCount: attemptCount,
    iqInvoiceImportLastError: classifiedError || null,
    iqInvoiceImportLastErrorCode: errorCode,
    iqInvoiceNextCheckAt: Timestamp.fromDate(nextRunAt),
    iqInvoiceUpdatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function processJob(input: { job: IqInvoiceJob; config: IqOperatingCalendarConfig; profile: { username: string; password: string; erpUrl: string } }): Promise<string> {
  const solicitudRef = db.collection("solicitudes").doc(input.job.solicitudId);
  const solicitudSnap = await solicitudRef.get();
  if (!solicitudSnap.exists) {
    throw new HttpsError("not-found", "Solicitud PAY0 no encontrada.");
  }
  const solicitud = asRecord(solicitudSnap.data());
  const solicitudStatus = cleanText(solicitud.status).toUpperCase();

  if (
    ["RECHAZADA", "CANCELADA", "ELIMINADA"].includes(
      solicitudStatus,
    )
  ) {
    await input.job.ref.set(
      {
        status: "OMITTED_TERMINAL",
        lastError:
          "Seguimiento detenido porque la solicitud terminó.",
        nextRunAt: null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return "OMITTED_TERMINAL";
  }

  const alreadyImported = cleanText(solicitud.iqInvoiceImportStatus) === "IMPORTED" && cleanText(solicitud.iqInvoiceUuid);
  if (alreadyImported) {
    await input.job.ref.set({
      status: "IMPORTED",
      lastError: FieldValue.delete(),
      lastErrorCode: FieldValue.delete(),
      nextRunAt: null,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return "IMPORTED_REUSED";
  }
  const download = await runIqDownloadInvoiceZipByMarker({
    erpUrl: input.profile.erpUrl,
    username: input.profile.username,
    password: input.profile.password,
    marker: input.job.marker,
    solicitudId: input.job.solicitudId,
    iqFolio: input.job.iqFolio,
    maxPages: 20,
    waitAfterClickMs: 120_000,
  });
  if (!download.authenticated) {
    await rescheduleJob({ job: input.job, config: input.config, status: "WAITING", error: download.errors.join(" | ") || "No se pudo autenticar en el despacho." });
    return "AUTH_FAILED";
  }
  if (!download.found || !download.clicked) {
    await rescheduleJob({ job: input.job, config: input.config, status: "WAITING", error: download.errors.join(" | ") || "Factura no disponible todavia." });
    return "WAITING_INVOICE";
  }
  if (!download.downloaded || !download.bufferBase64) {
    await rescheduleJob({ job: input.job, config: input.config, status: "WAITING", error: download.errors.join(" | ") || "No se descargo el ZIP de factura." });
    return "DOWNLOAD_PENDING";
  }
  const zipBuffer = Buffer.from(download.bufferBase64, "base64");
  const zipInspection = inspectInvoiceDownloadBuffer(zipBuffer);
  if (!zipInspection.ok) {
    throw new Error(zipInspection.code);
  }
  const zipHash = sha256(zipBuffer);
  if (cleanText(solicitud.iqInvoiceZipHash) === zipHash && cleanText(solicitud.iqInvoiceImportStatus) === "IMPORTED") {
    await input.job.ref.set({
      status: "IMPORTED",
      lastError: FieldValue.delete(),
      lastErrorCode: FieldValue.delete(),
      zipHash,
      nextRunAt: null,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return "IMPORTED_REUSED";
  }
  let entries: ZipEntry[];
  try {
    entries = extractZipEntries(zipBuffer);
  } catch (error) {
    throw new Error(classifyIqInvoiceErrorMessage(error));
  }
  const files = chooseInvoiceFiles(entries);
  const metadata = parseCfdiMetadata(files.xml.buffer);
  validateInvoiceMetadata(metadata, input.job.amount);
  const baseName = sanitizeFilename(`${input.job.solicitudFolio || input.job.solicitudId}-${metadata.uuid || input.job.iqFolio}`);
  const pdfUploadId = await createImportedUpload({
    rootId: input.job.rootId,
    solicitudId: input.job.solicitudId,
    solicitud,
    documentType: "FACTURA_PDF",
    originalName: `${baseName}.pdf`,
    contentType: "application/pdf",
    buffer: files.pdf.buffer,
    importedBy: "system",
    metadata: {},
    iqFolio: input.job.iqFolio,
    zipHash,
  });
  const xmlUploadId = await createImportedUpload({
    rootId: input.job.rootId,
    solicitudId: input.job.solicitudId,
    solicitud,
    documentType: "FACTURA_XML",
    originalName: `${baseName}.xml`,
    contentType: "application/xml",
    buffer: files.xml.buffer,
    importedBy: "system",
    metadata,
    iqFolio: input.job.iqFolio,
    zipHash,
  });
  await markImported({
    job: input.job,
    zipHash,
    zipFileName: download.fileName,
    pdfUploadId,
    xmlUploadId,
    metadata,
    rowText: download.rowText,
  });
  await safeLogActivity({
    event: "IQ_FACTURA_ZIP_DESCARGADA",
    rootId: input.job.rootId,
    adminId: input.job.rootId,
    actorUid: "system",
    actorName: "Sistema",
    actorUsername: "Sistema",
    actorRole: "system",
    referenceId: input.job.solicitudId,
    referenceFolio: input.job.solicitudFolio,
    referenceType: "solicitud",
    entityId: input.job.solicitudId,
    entityType: "solicitud",
    amount: metadata.total ?? input.job.amount,
    description: `ZIP de factura descargado e importado para solicitud ${input.job.solicitudFolio}.`,
    extra: {
      iqFolio: input.job.iqFolio,
      facturaUuid: metadata.uuid,
      zipHash,
      pdfUploadId,
      xmlUploadId,
    },
  });
  return "IMPORTED";
}

async function processJobGroup(input: { jobs: IqInvoiceJob[]; source: "MANUAL" | "SCHEDULER"; force?: boolean }): Promise<Map<string, string>> {
  const statuses = new Map<string, string>();
  const allowedJobsH4D73A8: typeof input.jobs = [];

  for (const jobH4D73A8 of input.jobs) {
    const [
      solicitudSnapH4D73A8,
      creationSnapH4D73A8,
    ] = await Promise.all([
      db.collection("solicitudes")
        .doc(jobH4D73A8.solicitudId)
        .get(),
      db.collection("iqSolicitudCreations")
        .doc(jobH4D73A8.solicitudId)
        .get(),
    ]);

    const solicitudH4D73A8 = solicitudSnapH4D73A8.exists
      ? asRecord(solicitudSnapH4D73A8.data())
      : {};

    const creationH4D73A8 = creationSnapH4D73A8.exists
      ? asRecord(creationSnapH4D73A8.data())
      : {};

    const continuationGateH4D73A8 =
      solicitudSnapH4D73A8.exists
        ? await evaluateIqDispatchGate({
            db,
            despachoId:
              solicitudH4D73A8.despachoId ||
              solicitudH4D73A8.firmId,
            companyId:
              solicitudH4D73A8.companyId ||
              solicitudH4D73A8.empresaId,
            rootId: jobH4D73A8.rootId,
          })
        : {
            ok: false,
            code: "IQ_SOLICITUD_NOT_FOUND",
            message: "Solicitud no encontrada.",
          };

    if (!continuationGateH4D73A8.ok) {
      await jobH4D73A8.ref.set({
        status: "OMITTED_PROVIDER_GATE",
        lastError:
          `[${continuationGateH4D73A8.code}] ` +
          continuationGateH4D73A8.message,
        nextRunAt: null,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      statuses.set(
        jobH4D73A8.solicitudId,
        "OMITTED_PROVIDER_GATE" as any,
      );

      continue;
    }

    // Rehidratar SIEMPRE desde la fuente actual.
    // Misma prioridad canonica que buildJobForSolicitud/manual.
    const currentSolicitudFolioH4D73A8 = cleanText(
      solicitudH4D73A8.folio ??
      solicitudH4D73A8.folioSolicitud ??
      jobH4D73A8.solicitudFolio ??
      jobH4D73A8.solicitudId,
    );

    const currentIqFolioH4D73A8 = cleanText(
      solicitudH4D73A8.iqFolio ??
      solicitudH4D73A8.iqId ??
      creationH4D73A8.iqId ??
      jobH4D73A8.iqFolio,
    );

    const currentProfileIdH4D73A8 = cleanText(
      solicitudH4D73A8.iqCredentialProfileId ??
      creationH4D73A8.profileId ??
      jobH4D73A8.profileId,
    );

    const currentProfileAliasH4D73A8 = cleanText(
      creationH4D73A8.profileAlias ??
      solicitudH4D73A8.iqProfileAlias ??
      jobH4D73A8.profileAlias,
    );

    const currentMarkerH4D73A8 = cleanText(
      solicitudH4D73A8.iqReconciliationMarker ??
      creationH4D73A8.marker ??
      creationH4D73A8.creationMarker ??
      jobH4D73A8.marker,
    );

    if (
      !currentIqFolioH4D73A8 ||
      !currentProfileIdH4D73A8 ||
      !currentMarkerH4D73A8
    ) {
      await jobH4D73A8.ref.set({
        status: "WAITING",
        lastError:
          "No se pudieron reconstruir Folio IQ, perfil y marcador actuales antes de procesar.",
        lastErrorCode:
          "IQ_INVOICE_CURRENT_METADATA_MISSING_RUNTIME",
        nextRunAt: Timestamp.fromMillis(
          Date.now() + 5 * 60 * 1000,
        ),
        metadataRefreshedAt:
          FieldValue.serverTimestamp(),
        metadataRefreshSource:
          "PROCESS_JOB_GROUP_CURRENT_SOLICITUD",
        updatedAt:
          FieldValue.serverTimestamp(),
      }, { merge: true });

      statuses.set(
        jobH4D73A8.solicitudId,
        "WAITING_CURRENT_METADATA",
      );

      continue;
    }

    const profileChangedH4D73A8 =
      currentProfileIdH4D73A8 !==
      cleanText(jobH4D73A8.profileId);

    jobH4D73A8.solicitudFolio =
      currentSolicitudFolioH4D73A8;
    jobH4D73A8.iqFolio =
      currentIqFolioH4D73A8;
    jobH4D73A8.profileId =
      currentProfileIdH4D73A8;
    jobH4D73A8.profileAlias =
      currentProfileAliasH4D73A8;
    jobH4D73A8.marker =
      currentMarkerH4D73A8;

    await jobH4D73A8.ref.set({
      solicitudFolio:
        currentSolicitudFolioH4D73A8,
      iqFolio:
        currentIqFolioH4D73A8,
      profileId:
        currentProfileIdH4D73A8,
      profileAlias:
        currentProfileAliasH4D73A8 || null,
      marker:
        currentMarkerH4D73A8,
      metadataRefreshedAt:
        FieldValue.serverTimestamp(),
      metadataRefreshSource:
        "PROCESS_JOB_GROUP_CURRENT_SOLICITUD",
      updatedAt:
        FieldValue.serverTimestamp(),
    }, { merge: true });

    // Los jobs ya vienen agrupados por profileId.
    // Si el perfil cambio, no se procesa dentro del grupo viejo:
    // se deja para el siguiente ciclo y sera agrupado correctamente.
    if (profileChangedH4D73A8) {
      await jobH4D73A8.ref.set({
        status: "WAITING",
        lastError:
          "El perfil IQ vigente cambio; job reencolado para reagrupar con el perfil actual.",
        lastErrorCode:
          "IQ_INVOICE_PROFILE_REFRESH_REQUEUED",
        nextRunAt: Timestamp.fromMillis(
          Date.now() + 60 * 1000,
        ),
        updatedAt:
          FieldValue.serverTimestamp(),
      }, { merge: true });

      statuses.set(
        jobH4D73A8.solicitudId,
        "WAITING_PROFILE_REFRESH",
      );

      continue;
    }

    allowedJobsH4D73A8.push(jobH4D73A8);
  }

  input.jobs = allowedJobsH4D73A8;
  const firstJob = input.jobs[0];
  if (!firstJob) {
    return statuses;
  }
  const workerToken = crypto.randomUUID();
  const lockAcquired = await acquireProfileLock(firstJob.profileId, workerToken);
  if (!lockAcquired) {
    for (const job of input.jobs) {
      statuses.set(job.solicitudId, "LOCKED");
    }
    return statuses;
  }
  try {
    const config = await loadOperatingConfig(firstJob.rootId);
    if (!input.force) {
      const operatingNow = new Date();
      const invoiceConfig = typeof withCanonicalIqInvoiceOperatingConfig === "function"
        ? withCanonicalIqInvoiceOperatingConfig(config, operatingNow)
        : config;
      const decision = evaluateIqOperatingWindow(invoiceConfig, operatingNow, "INVOICE");
      if (!decision.allowed) {
        const nextRunAt = decision.nextEligibleAt ?? new Date(Date.now() + CONFIG_NOT_READY_RETRY_MS);
        for (const job of input.jobs) {
          await job.ref.set({
            status: "WAITING_FOR_OPERATING_WINDOW",
            lastError: `Horario no habilitado para factura del despacho: ${decision.reason}`,
            nextRunAt: Timestamp.fromDate(nextRunAt),
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          statuses.set(job.solicitudId, "WAITING_FOR_OPERATING_WINDOW");
        }
        return statuses;
      }
    }
    const profile = await loadProfile(firstJob);
    for (const job of input.jobs) {
      const startedAtMs = Date.now();
      try {
        const status = await processJob({ job, config, profile });
        statuses.set(job.solicitudId, status);
      } catch (error) {
        const message = classifyIqInvoiceErrorMessage(error);
        const errorCode = getIqInvoiceErrorCode(message);
        const durationMs = Date.now() - startedAtMs;
        await rescheduleJob({ job, config, status: "ERROR_RETRYABLE", error: message });
        await safeLogActivity({
          event: "IQ_FACTURA_IMPORT_ERROR",
          rootId: job.rootId,
          adminId: job.rootId,
          actorUid: input.source === "MANUAL" ? job.requestedBy || "system" : "system",
          actorName: input.source === "MANUAL" ? "Super Admin" : "Sistema",
          actorUsername: input.source === "MANUAL" ? "Super Admin" : "Sistema",
          actorRole: input.source === "MANUAL" ? "superadmin" : "system",
          referenceId: job.solicitudId,
          referenceFolio: job.solicitudFolio,
          referenceType: "solicitud",
          entityId: job.solicitudId,
          entityType: "solicitud",
          amount: job.amount,
          description: `Error al importar factura IQ para solicitud ${job.solicitudFolio}.`,
          extra: {
            iqFolio: job.iqFolio,
            profileId: job.profileId,
            source: input.source,
            durationMs,
            errorCode,
            errorMessage: message,
          },
        });
        statuses.set(job.solicitudId, "ERROR_RETRYABLE");
      }
    }
    return statuses;
  } finally {
    await releaseProfileLock(firstJob.profileId, workerToken);
  }
}

async function buildJobForSolicitud(input: { solicitudId: string; auth: AuthContext }): Promise<IqInvoiceJob> {
  const solicitudRef = db.collection("solicitudes").doc(input.solicitudId);
  const [solicitudSnap, creationSnap] = await Promise.all([
    solicitudRef.get(),
    db.collection("iqSolicitudCreations").doc(input.solicitudId).get(),
  ]);
  if (!solicitudSnap.exists) {
    throw new HttpsError("not-found", "Solicitud PAY0 no encontrada.");
  }
  const solicitud = asRecord(solicitudSnap.data());
  const rootId = cleanText(solicitud.rootId ?? solicitud.ownerRootId);
  const buildGateH4D73A8 = await evaluateIqDispatchGate({ db, despachoId: solicitud.despachoId || solicitud.firmId, companyId: solicitud.companyId || solicitud.empresaId, rootId: input.auth.rootId });
  if (!buildGateH4D73A8.ok) throw new HttpsError("failed-precondition", `[${buildGateH4D73A8.code}] ${buildGateH4D73A8.message}`);
  if (rootId && rootId !== input.auth.rootId) {
    throw new HttpsError("permission-denied", "Solicitud fuera del scope autorizado.");
  }
  const creation = creationSnap.exists ? asRecord(creationSnap.data()) : {};
  const solicitudFolio = cleanText(solicitud.folio ?? solicitud.folioSolicitud ?? input.solicitudId);
  const iqFolio = cleanText(solicitud.iqFolio ?? solicitud.iqId ?? creation.iqId);
  const profileId = cleanText(solicitud.iqCredentialProfileId ?? creation.profileId);
  const marker = cleanText(solicitud.iqReconciliationMarker ?? creation.marker ?? creation.creationMarker);
  if (!iqFolio || !profileId || !marker) {
    throw new HttpsError("failed-precondition", "La solicitud no tiene folio externo, cuenta o marcador para importar factura.");
  }
  const config = await loadOperatingConfig(input.auth.rootId);
  const targetDateIso = normalizeIsoDate(solicitud.iqTargetDateIso ?? creation.targetDateIso) || dateIsoInTimeZone(new Date(timestampMillis(solicitud.iqCreatedAt) || Date.now()), config.timezone || DEFAULT_IQ_TIME_ZONE);
  await enqueueIqInvoiceImportJob({
    solicitudId: input.solicitudId,
    solicitudFolio,
    rootId: input.auth.rootId,
    profileId,
    profileAlias: cleanText(creation.profileAlias ?? solicitud.iqProfileAlias),
    marker,
    iqFolio,
    targetDateIso,
    amount: Number(solicitud.monto ?? creation.amount ?? 0) || 0,
    requestedBy: input.auth.uid,
    reason: "MANUAL_INVOICE_SYNC",
    nextRunAt: new Date(),
  });
  return {
    ref: getQueueRef(input.solicitudId),
    id: `invoice_${input.solicitudId}`,
    solicitudId: input.solicitudId,
    solicitudFolio,
    rootId: input.auth.rootId,
    profileId,
    profileAlias: cleanText(creation.profileAlias ?? solicitud.iqProfileAlias),
    marker,
    iqFolio,
    targetDateIso,
    amount: Number(solicitud.monto ?? creation.amount ?? 0) || 0,
    attemptCount: 0,
    requestedBy: input.auth.uid,
  };
}

export const syncIqSolicitudInvoice = onCall(
  {
    cors: true,
    secrets: [IQ_CREDENTIALS_KEY, TELEGRAM_BOT_TOKEN],
    invoker: "public",
    timeoutSeconds: 300,
    memory: "2GiB",
    concurrency: 1,
  },
  async (request) => {
    await assertIqAuthorized(request, { allowedRoles: ["superadmin"] });
    const auth = await getAuthContext(request);
    assertSuperAdmin(auth);
    const payload = asRecord(request.data);
    const solicitudId = cleanText(payload.solicitudId);
    const force = payload.force === true;
    if (!solicitudId) {
      throw new HttpsError("invalid-argument", "solicitudId requerido.");
    }
    const job = await buildJobForSolicitud({ solicitudId, auth });
    const result = await processJobGroup({ jobs: [job], source: "MANUAL", force });
    const status = result.get(solicitudId) || "NOT_FOUND";
    return { ok: !/ERROR/.test(status), status };
  },
);


export const enqueueExistingIqFolioInvoiceImports = onCall(
  {
    cors: true,
    secrets: [IQ_CREDENTIALS_KEY, TELEGRAM_BOT_TOKEN],
    invoker: "public",
    timeoutSeconds: 300,
    memory: "1GiB",
  },
  async (request) => {
    await assertIqAuthorized(request, { allowedRoles: ["superadmin"] });
    const auth = await getAuthContext(request);
    assertSuperAdmin(auth);

    const data = asRecord(request.data);
    const rawIds = Array.isArray(data.solicitudIds) ? data.solicitudIds : [data.solicitudId];
    const solicitudIds = Array.from(new Set(rawIds.map(cleanText).filter(Boolean))).slice(0, 100);
    const dryRun = data.confirm === true ? data.dryRun === true : true;

    if (solicitudIds.length === 0) {
      throw new HttpsError("invalid-argument", "solicitudIds es obligatorio para importar facturas de folios existentes.");
    }

    const config = await loadOperatingConfig(auth.rootId);
    const results: Array<Record<string, unknown>> = [];
    let queued = 0;
    let skipped = 0;

    for (const solicitudId of solicitudIds) {
      const solicitudRef = db.collection("solicitudes").doc(solicitudId);
      const [solicitudSnap, creationSnap] = await Promise.all([
        solicitudRef.get(),
        db.collection("iqSolicitudCreations").doc(solicitudId).get(),
      ]);

      if (!solicitudSnap.exists) {
        skipped += 1;
        results.push({ solicitudId, queued: false, skipped: true, reason: "SOLICITUD_NOT_FOUND" });
        continue;
      }

      const solicitud = asRecord(solicitudSnap.data());
      const creation = creationSnap.exists ? asRecord(creationSnap.data()) : {};
      const rootId = cleanText(solicitud.rootId ?? solicitud.ownerRootId ?? creation.rootId);

      if (rootId && rootId !== auth.rootId) {
        skipped += 1;
        results.push({ solicitudId, queued: false, skipped: true, reason: "OUT_OF_SCOPE" });
        continue;
      }

      const solicitudFolio = cleanText(solicitud.folio ?? solicitud.folioSolicitud ?? creation.solicitudFolio ?? solicitudId);
      const iqFolio = cleanText(solicitud.iqFolio ?? solicitud.iqId ?? creation.iqId);
      const profileId = cleanText(solicitud.iqCredentialProfileId ?? creation.profileId);
      const marker = cleanText(solicitud.iqReconciliationMarker ?? creation.marker ?? creation.creationMarker);
      const alreadyImported =
        cleanText(solicitud.iqInvoiceImportStatus) === "IMPORTED" &&
        Boolean(cleanText(solicitud.iqInvoiceUuid) || cleanText(solicitud.iqInvoicePdfUploadId) || cleanText(solicitud.iqInvoiceXmlUploadId));

      if (!iqFolio) {
        skipped += 1;
        results.push({ solicitudId, solicitudFolio, queued: false, skipped: true, reason: "NO_IQ_FOLIO" });
        continue;
      }

      if (alreadyImported) {
        skipped += 1;
        results.push({ solicitudId, solicitudFolio, iqFolio, queued: false, skipped: true, reason: "INVOICE_ALREADY_IMPORTED" });
        continue;
      }

      if (!profileId || !marker) {
        skipped += 1;
        results.push({ solicitudId, solicitudFolio, iqFolio, queued: false, skipped: true, reason: "MISSING_IQ_METADATA" });
        continue;
      }

      const targetDateIso =
        normalizeIsoDate(solicitud.iqTargetDateIso ?? creation.targetDateIso) ||
        dateIsoInTimeZone(
          new Date(timestampMillis(solicitud.iqCreatedAt) || timestampMillis(creation.createdAt) || Date.now()),
          config.timezone || DEFAULT_IQ_TIME_ZONE,
        );

      const amount = Number(solicitud.monto ?? solicitud.amount ?? solicitud.total ?? creation.amount ?? 0) || 0;

      if (!dryRun) {
        await enqueueIqInvoiceImportJob({
          solicitudId,
          solicitudFolio,
          rootId: auth.rootId,
          profileId,
          profileAlias: cleanText(creation.profileAlias ?? solicitud.iqProfileAlias),
          marker,
          iqFolio,
          targetDateIso,
          amount,
          requestedBy: auth.uid,
          reason: "EXISTING_IQ_FOLIO_MISSING_INVOICE",
          nextRunAt: new Date(),
        });
      }

      queued += 1;
      results.push({
        solicitudId,
        solicitudFolio,
        iqFolio,
        queued: !dryRun,
        skipped: false,
        action: dryRun ? "DRY_RUN_WOULD_QUEUE_INVOICE_ONLY" : "QUEUED_INVOICE_ONLY",
      });
    }

    return {
      ok: true,
      data: {
        dryRun,
        total: solicitudIds.length,
        queued,
        skipped,
        results,
      },
      message: dryRun
        ? `Revision lista: ${queued} facturas se podrian encolar, ${skipped} omitidas. No se cambio nada.`
        : `Facturas encoladas: ${queued}. Omitidas: ${skipped}.`,
    };
  },
);

type IqWorkDiscoveryResult = {
  scanned: number;
  invoiceCandidates: number;
  invoiceQueued: number;
  skipped: number;
  reachedEnd: boolean;
  cursorCreatedAt: number | null;
};

const IQ_WORK_DISCOVERY_STATE_ID = "unified-iq-maintenance-invoices";
const IQ_WORK_DISCOVERY_BATCH_SIZE = 80;
const IQ_WORK_MAX_INVOICE_QUEUE_PER_RUN = 10;
const IQ_WORK_ACTIVE_INVOICE_JOB_STATUSES = new Set([
  "QUEUED",
  "WAITING",
  "WAITING_FOR_OPERATING_WINDOW",
  "ERROR_RETRYABLE",
  "RUNNING",
  "PROCESSING",
]);

function hasInvoiceImportedFlag(solicitud: Record<string, unknown>): boolean {
  const status = cleanText(solicitud.iqInvoiceImportStatus);
  if (status === "IMPORTED") {
    return true;
  }

  if (
    cleanText(solicitud.iqInvoicePdfUploadId) &&
    cleanText(solicitud.iqInvoiceXmlUploadId)
  ) {
    return true;
  }

  if (cleanText(solicitud.facturaPdfUploadId) && cleanText(solicitud.facturaXmlUploadId)) {
    return true;
  }

  return false;
}

async function hasActiveInvoiceDocuments(input: {
  rootId: string;
  solicitudId: string;
}): Promise<boolean> {
  const snap = await db
    .collection("uploads")
    .where("solicitudId", "==", input.solicitudId)
    .limit(50)
    .get();

  let hasPdf = false;
  let hasXml = false;

  for (const doc of snap.docs) {
    const row = asRecord(doc.data());
    if (cleanText(row.rootId) && cleanText(row.rootId) !== input.rootId) {
      continue;
    }
    if (row.active !== true) {
      continue;
    }
    const documentType = cleanText(row.documentType ?? row.tipo ?? row.type);
    if (documentType === "FACTURA_PDF") {
      hasPdf = true;
    }
    if (documentType === "FACTURA_XML") {
      hasXml = true;
    }
  }

  return hasPdf && hasXml;
}

function isInvoiceJobActive(job: Record<string, unknown>): boolean {
  const status = cleanText(job.status);
  if (status === "IMPORTED") {
    return true;
  }
  if (!IQ_WORK_ACTIVE_INVOICE_JOB_STATUSES.has(status)) {
    return false;
  }
  const nextRunAtMs = timestampMillis(job.nextRunAt);
  return !nextRunAtMs || nextRunAtMs > Date.now() || status === "QUEUED" || status === "RUNNING" || status === "PROCESSING";
}

async function discoverIqWorkCandidatesOnce(): Promise<IqWorkDiscoveryResult> {
  const stateRef = db.collection("iqAutomationState").doc(IQ_WORK_DISCOVERY_STATE_ID);
  const stateSnap = await stateRef.get();
  const state = stateSnap.exists ? asRecord(stateSnap.data()) : {};
  const cursorCreatedAtMs = timestampMillis(state.cursorCreatedAt);

  let query = db
    .collection("solicitudes")
    .orderBy("createdAt", "desc")
    .limit(IQ_WORK_DISCOVERY_BATCH_SIZE);

  if (cursorCreatedAtMs > 0) {
    query = query.startAfter(Timestamp.fromMillis(cursorCreatedAtMs));
  }

  const snap = await query.get();
  let scanned = 0;
  let invoiceCandidates = 0;
  let invoiceQueued = 0;
  let skipped = 0;
  let lastCreatedAtMs: number | null = null;

  for (const doc of snap.docs) {
    scanned += 1;
    const solicitud = asRecord(doc.data());
    lastCreatedAtMs = timestampMillis(solicitud.createdAt) || lastCreatedAtMs;

    const solicitudId = doc.id;
    const solicitudFolio = cleanText(solicitud.folio ?? solicitud.folioSolicitud ?? solicitudId);
    const rootId = cleanText(solicitud.rootId ?? solicitud.ownerRootId ?? solicitud.adminId);
    const iqFolio = cleanText(solicitud.iqFolio ?? solicitud.iqId);

    if (!rootId || !iqFolio) {
      skipped += 1;
      continue;
    }

    if (hasInvoiceImportedFlag(solicitud)) {
      skipped += 1;
      continue;
    }

    const existingJobSnap = await getQueueRef(solicitudId).get();
    if (existingJobSnap.exists && isInvoiceJobActive(asRecord(existingJobSnap.data()))) {
      skipped += 1;
      continue;
    }

    if (await hasActiveInvoiceDocuments({ rootId, solicitudId })) {
      await doc.ref.set({
        iqInvoiceAutoDiscoveryStatus: "SKIPPED_DOCUMENTS_ALREADY_PRESENT",
        iqInvoiceAutoDiscoveryLastCheckedAt: FieldValue.serverTimestamp(),
        iqInvoiceSyncUpdatedAt: FieldValue.serverTimestamp(),
      }, { merge: true }).catch(() => undefined);
      skipped += 1;
      continue;
    }

    const creationSnap = await db.collection("iqSolicitudCreations").doc(solicitudId).get();
    const creation = creationSnap.exists ? asRecord(creationSnap.data()) : {};
    const profileId = cleanText(solicitud.iqCredentialProfileId ?? creation.profileId);
    const profileAlias = cleanText(creation.profileAlias ?? solicitud.iqProfileAlias);
    const marker = cleanText(solicitud.iqReconciliationMarker ?? creation.marker ?? creation.creationMarker);

    if (!profileId || !marker) {
      await doc.ref.set({
        iqInvoiceAutoDiscoveryStatus: "SKIPPED_MISSING_IQ_METADATA",
        iqInvoiceAutoDiscoveryLastCheckedAt: FieldValue.serverTimestamp(),
        iqInvoiceSyncUpdatedAt: FieldValue.serverTimestamp(),
      }, { merge: true }).catch(() => undefined);
      skipped += 1;
      continue;
    }

    invoiceCandidates += 1;

    if (invoiceQueued >= IQ_WORK_MAX_INVOICE_QUEUE_PER_RUN) {
      await doc.ref.set({
        iqInvoiceAutoDiscoveryStatus: "CANDIDATE_NOT_QUEUED_RATE_LIMIT",
        iqInvoiceAutoDiscoveryLastCheckedAt: FieldValue.serverTimestamp(),
        iqInvoiceSyncUpdatedAt: FieldValue.serverTimestamp(),
      }, { merge: true }).catch(() => undefined);
      skipped += 1;
      continue;
    }

    const config = await loadOperatingConfig(rootId);
    const iqCreatedAtMs =
      timestampMillis(solicitud.iqCreatedAt) ||
      timestampMillis(creation.iqCreatedAt) ||
      timestampMillis(creation.completedAt) ||
      timestampMillis(creation.createdAt) ||
      timestampMillis(solicitud.createdAt) ||
      Date.now();
    const iqCreatedAt = new Date(iqCreatedAtMs);
    const targetDateIso =
      normalizeIsoDate(solicitud.iqTargetDateIso ?? creation.targetDateIso) ||
      dateIsoInTimeZone(iqCreatedAt, config.timezone || DEFAULT_IQ_TIME_ZONE);
    const nextRunAt = firstInvoiceAttemptAt(config, iqCreatedAt);

    await enqueueIqInvoiceImportJob({
      solicitudId,
      solicitudFolio,
      rootId,
      profileId,
      profileAlias,
      marker,
      iqFolio,
      targetDateIso,
      amount: Number(solicitud.monto ?? solicitud.amount ?? solicitud.total ?? creation.amount ?? 0) || 0,
      requestedBy: "system",
      reason: "AUTO_MAINTENANCE_EXISTING_IQ_FOLIO_MISSING_INVOICE",
      nextRunAt,
    });

    await doc.ref.set({
      iqInvoiceAutoDiscoveryStatus: "QUEUED_INVOICE_IMPORT",
      iqInvoiceAutoDiscoveryLastCheckedAt: FieldValue.serverTimestamp(),
      iqInvoiceNextCheckAt: Timestamp.fromDate(nextRunAt),
      iqInvoiceSyncUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }).catch(() => undefined);

    invoiceQueued += 1;
  }

  const reachedEnd = snap.empty || snap.size < IQ_WORK_DISCOVERY_BATCH_SIZE;
  await stateRef.set({
    status: reachedEnd ? "CYCLE_COMPLETE" : "SCANNING",
    cursorCreatedAt: reachedEnd || !lastCreatedAtMs ? null : Timestamp.fromMillis(lastCreatedAtMs),
    lastRunAt: FieldValue.serverTimestamp(),
    lastRun: {
      scanned,
      invoiceCandidates,
      invoiceQueued,
      skipped,
      reachedEnd,
    },
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return {
    scanned,
    invoiceCandidates,
    invoiceQueued,
    skipped,
    reachedEnd,
    cursorCreatedAt: reachedEnd ? null : lastCreatedAtMs,
  };
}

// H4_D82_A3_A6_A3C_AUTOMATION_CONTROL
// H4_D63A_ENABLED_SCHEDULER_START discoverIqWorkCandidates
export const discoverIqWorkCandidates = onSchedule(
  {
    schedule: "every 5 minutes", // H4_D87_A58_A15_HEARTBEAT_5_MIN
    timeZone: DEFAULT_IQ_TIME_ZONE,
    memory: "512MiB",
    timeoutSeconds: 300,
    concurrency: 1,
  },
  async () => {
    const enabledRoots = await loadEnabledIqAutomationRoots({
      process: "discovery",
      purpose: "INVOICE",
    });

    if (enabledRoots.size === 0) {
      return;
    }

    const result = await discoverIqWorkCandidatesOnce();
    await db.collection("iqQueueRuns").doc(`iq-work-discovery-${Date.now()}`).set({
      type: "IQ_WORK_DISCOVERY",
      version: "IQ-2E-O-R1",
      ...result,
      createdAt: FieldValue.serverTimestamp(),
    }).catch(() => undefined);
  },
);
// H4_D63A_ENABLED_SCHEDULER_END discoverIqWorkCandidates

// ============================================================
// TEMPORAL 2026-08-31
// Sincronizacion masiva manual de facturas IQ del dia.
// Usa EXACTAMENTE buildJobForSolicitud + processJobGroup MANUAL force.
// Eliminar despues de la corrida.
// ============================================================
export const syncTodayIqInvoicesNow = onSchedule(
  {
    schedule: "every 24 hours",
    timeZone: DEFAULT_IQ_TIME_ZONE,
    secrets: [IQ_CREDENTIALS_KEY, TELEGRAM_BOT_TOKEN],
    memory: "2GiB",
    timeoutSeconds: 540,
    concurrency: 1,
  },
  async () => {
    // America/Mexico_City UTC-6:
    // 2026-08-31 00:00 -> 2026-08-31T06:00:00Z
    // 2026-09-01 00:00 -> 2026-09-01T06:00:00Z
    const start =
      admin.firestore.Timestamp.fromDate(
        new Date("2026-08-31T06:00:00.000Z"),
      );

    const end =
      admin.firestore.Timestamp.fromDate(
        new Date("2026-09-01T06:00:00.000Z"),
      );

    // Tomamos tanto solicitudes creadas hoy como solicitudes cuyo
    // Folio IQ fue creado hoy. Se hace UNION por id.
    const [createdTodaySnap, iqCreatedTodaySnap] =
      await Promise.all([
        db.collection("solicitudes")
          .where("createdAt", ">=", start)
          .where("createdAt", "<", end)
          .get(),

        db.collection("solicitudes")
          .where("iqCreatedAt", ">=", start)
          .where("iqCreatedAt", "<", end)
          .get(),
      ]);

    const candidatesById =
      new Map<string, admin.firestore.QueryDocumentSnapshot>();

    for (const doc of createdTodaySnap.docs) {
      candidatesById.set(doc.id, doc);
    }

    for (const doc of iqCreatedTodaySnap.docs) {
      candidatesById.set(doc.id, doc);
    }

    const candidateDocs =
      Array.from(candidatesById.values())
        .filter((doc) => {
          const data = asRecord(doc.data());

          const iqFolio = cleanText(
            data.iqFolio ??
            data.iqId,
          );

          if (!iqFolio) {
            return false;
          }

          const importStatus =
            cleanText(data.iqInvoiceImportStatus)
              .toUpperCase();

          const pdfId =
            cleanText(
              data.iqInvoicePdfUploadId ??
              data.facturaPdfUploadId,
            );

          const xmlId =
            cleanText(
              data.iqInvoiceXmlUploadId ??
              data.facturaXmlUploadId,
            );

          // Si ambos documentos ya existen realmente, no se repite.
          if (
            importStatus === "IMPORTED" &&
            pdfId &&
            xmlId
          ) {
            return false;
          }

          return true;
        });

    const jobs: IqInvoiceJob[] = [];

    const results: Array<Record<string, unknown>> = [];

    for (const doc of candidateDocs) {
      const solicitud = asRecord(doc.data());

      const rootId = cleanText(
        solicitud.rootId ??
        solicitud.ownerRootId ??
        solicitud.adminId,
      );

      const folio = cleanText(
        solicitud.folio ??
        solicitud.folioSolicitud ??
        doc.id,
      );

      const iqFolio = cleanText(
        solicitud.iqFolio ??
        solicitud.iqId,
      );

      if (!rootId) {
        results.push({
          solicitudId: doc.id,
          folio,
          iqFolio,
          status: "SKIPPED_NO_ROOT",
        });
        continue;
      }

      const auth: AuthContext = {
        uid: "system-bulk-invoice-2026-08-31",
        role: "superadmin",
        rootId,
        user: {
          role: "superadmin",
          rootId,
        },
      };

      try {
        // MISMO constructor que usa syncIqSolicitudInvoice manual.
        const job =
          await buildJobForSolicitud({
            solicitudId: doc.id,
            auth,
          });

        jobs.push(job);

        results.push({
          solicitudId: doc.id,
          folio: job.solicitudFolio,
          iqFolio: job.iqFolio,
          profileId: job.profileId,
          status: "READY_TO_SYNC",
        });
      }
      catch (error) {
        results.push({
          solicitudId: doc.id,
          folio,
          iqFolio,
          status: "BUILD_ERROR",
          error: safeErrorMessage(error),
        });
      }
    }

    // Agrupar por root + perfil para no mezclar credenciales.
    const groups =
      new Map<string, IqInvoiceJob[]>();

    for (const job of jobs) {
      const key =
        `${job.rootId}::${job.profileId}`;

      const bucket =
        groups.get(key) ?? [];

      bucket.push(job);

      groups.set(key, bucket);
    }

    let imported = 0;
    let reused = 0;
    let waiting = 0;
    let errors = 0;
    let processed = 0;

    for (const group of groups.values()) {
      // Chunks pequeños para conservar el patrón seguro existente.
      for (let i = 0; i < group.length; i += 10) {
        const chunk =
          group.slice(i, i + 10);

        try {
          // EXACTAMENTE el comportamiento manual.
          // force:true salta la ventana SOLO para esta corrida manual.
          const statuses =
            await processJobGroup({
              jobs: chunk,
              source: "MANUAL",
              force: true,
            });

          for (const job of chunk) {
            const status =
              statuses.get(job.solicitudId) ??
              "NOT_FOUND";

            processed += 1;

            if (status === "IMPORTED") {
              imported += 1;
            }
            else if (status === "IMPORTED_REUSED") {
              reused += 1;
            }
            else if (
              status.includes("WAITING") ||
              status === "NOT_FOUND"
            ) {
              waiting += 1;
            }
            else if (
              status.includes("ERROR")
            ) {
              errors += 1;
            }

            results.push({
              solicitudId: job.solicitudId,
              folio: job.solicitudFolio,
              iqFolio: job.iqFolio,
              profileId: job.profileId,
              status,
            });
          }
        }
        catch (error) {
          const message =
            safeErrorMessage(error);

          for (const job of chunk) {
            errors += 1;
            processed += 1;

            results.push({
              solicitudId: job.solicitudId,
              folio: job.solicitudFolio,
              iqFolio: job.iqFolio,
              profileId: job.profileId,
              status: "BULK_ERROR",
              error: message,
            });
          }
        }
      }
    }

    const summary = {
      date: "2026-08-31",
      candidates:
        candidateDocs.length,
      jobsBuilt:
        jobs.length,
      processed,
      imported,
      reused,
      waiting,
      errors,
      finishedAt:
        new Date().toISOString(),
    };

    await db
      .collection("iqBulkInvoiceRuns")
      .doc("2026-08-31")
      .set(
        {
          ...summary,
          results:
            results.slice(0, 300),
          updatedAt:
            FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

    console.log(
      "IQ_BULK_TODAY_RESULT",
      JSON.stringify(summary),
    );
  },
);
// H4_D63A_ENABLED_SCHEDULER_START processIqInvoiceImportQueue
export const processIqInvoiceImportQueue = onSchedule(
  {
    schedule: "every 5 minutes", // H4_D87_A58_A15_HEARTBEAT_5_MIN
    timeZone: DEFAULT_IQ_TIME_ZONE,
    secrets: [IQ_CREDENTIALS_KEY, TELEGRAM_BOT_TOKEN],
    memory: "2GiB",
    timeoutSeconds: 540,
    concurrency: 1,
  },
  async () => {
    const enabledRoots = await loadEnabledIqAutomationRoots({
      process: "invoiceImport",
      purpose: "INVOICE",
    });

    if (enabledRoots.size === 0) {
      return;
    }

    const snap = await db
      .collection("iqInvoiceJobs")
      .where("status", "in", ["QUEUED", "WAITING", "WAITING_FOR_OPERATING_WINDOW", "ERROR_RETRYABLE"])
      .limit(MAX_JOBS_PER_RUN)
      .get();
    const nowMs = Date.now();
    const jobs = snap.docs
      .map(parseJob)
      .filter((job): job is IqInvoiceJob => Boolean(job))
      .filter((job) => enabledRoots.has(job.rootId))
      .filter((job) => {
        const data = asRecord(snap.docs.find((doc) => doc.id === job.id)?.data());
        const nextRunAtMs = timestampMillis(data.nextRunAt);
        return !nextRunAtMs || nextRunAtMs <= nowMs;
      });
    const byProfile = new Map<string, IqInvoiceJob[]>();
    for (const job of jobs) {
      const bucket = byProfile.get(job.profileId) ?? [];
      if (bucket.length < MAX_JOBS_PER_PROFILE) {
        bucket.push(job);
        byProfile.set(job.profileId, bucket);
      }
    }
    let processed = 0;
    let imported = 0;
    for (const group of byProfile.values()) {
      const statuses = await processJobGroup({ jobs: group, source: "SCHEDULER" });
      processed += statuses.size;
      imported += Array.from(statuses.values()).filter((status) => status === "IMPORTED" || status === "IMPORTED_REUSED").length;
    }
    await db.collection("iqQueueRuns").doc(`invoice-${Date.now()}`).set({
      type: "INVOICE_IMPORT",
      processed,
      imported,
      profileGroups: byProfile.size,
      createdAt: FieldValue.serverTimestamp(),
    }).catch(() => undefined);
  },
);
// H4_D63A_ENABLED_SCHEDULER_END processIqInvoiceImportQueue
