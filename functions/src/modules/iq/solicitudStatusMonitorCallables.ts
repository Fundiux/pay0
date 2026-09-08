import { evaluateIqDispatchGate } from "../dispatches/iqGate";
import { DEFAULT_IQ_ERP_URL } from "./config";
import * as crypto from "crypto";
import * as admin from "firebase-admin";
import type { DocumentReference, DocumentSnapshot, Transaction } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";

import {
  runIqFindInvoicesByMarkersHttpA54,
  type IqInvoiceMarkerMatchA54 as IqInvoiceMarkerMatch,
} from "./solicitudHttpReadA54";
import {
  evaluateIqOperatingWindow,
  getIqReconciliationDelayMs,
  normalizeIqOperatingCalendarConfig,
  type IqOperatingCalendarConfig,
} from "./operatingCalendar";
import { enqueueIqInvoiceImportJob } from "./solicitudInvoiceImportCallables";
import { logActivity, type ActivityLogParams } from "../../utils/logActivity";
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
const IQ_STATUS_MONITOR_VERSION = "IQ-SOLICITUD-STATUS-MONITOR-1";
const PROFILE_LOCK_MS = 10 * 60 * 1000;
const MAX_JOBS_PER_RUN = 50;
const MAX_JOBS_PER_PROFILE = 25;
const CONFIG_NOT_READY_RETRY_MS = 24 * 60 * 60 * 1000;

type AuthContext = {
  uid: string;
  role: string;
  rootId: string;
  user: Record<string, unknown>;
};

type IqStatusJob = {
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
  createdAtLowerBoundMs: number;
};

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cleanUpper(value: unknown): string {
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
  const currentIqFolio = cleanText(data.iqFolio ?? data.iqId);
  const rejectedIqFolio = cleanText(data.iqRejectedFolio);
  const operationStatus = cleanUpper(data.iqOperationStatus);

  const historicalRejectedOperation =
    (operationStatus === "RECHAZADA" || operationStatus === "RECHAZADO") &&
    Boolean(currentIqFolio) &&
    Boolean(rejectedIqFolio) &&
    currentIqFolio !== rejectedIqFolio;

  const values = [
    data.status,
    data.estado,
    data.solicitudStatus,
    historicalRejectedOperation ? "" : data.iqOperationStatus,
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
    throw new HttpsError("permission-denied", "Solo Super Admin puede sincronizar estados del despacho.");
  }
}

function getActorName(auth: AuthContext): string {
  return cleanText(
    auth.user.username ?? auth.user.displayName ?? auth.user.name ?? auth.user.email ?? auth.uid,
  );
}

async function loadOperatingConfig(rootId: string): Promise<IqOperatingCalendarConfig> {
  const snap = await db.collection("iqIntegrationConfigs").doc(rootId).get();
  return normalizeIqOperatingCalendarConfig(snap.exists ? snap.data() : {});
}

function nextMonitorRunAt(
  config: IqOperatingCalendarConfig,
  attemptCount: number,
  now = new Date(),
): Date {
  const delay = attemptCount <= 1
    ? 20 * 60 * 1000
    : getIqReconciliationDelayMs(Math.min(6, attemptCount));
  const candidate = new Date(now.getTime() + delay);
  const decision = evaluateIqOperatingWindow(config, candidate, "RECONCILIATION");
  if (decision.allowed) {
    return candidate;
  }
  return decision.nextEligibleAt ?? new Date(now.getTime() + CONFIG_NOT_READY_RETRY_MS);
}

function getQueueRef(solicitudId: string): DocumentReference {
  return db.collection("iqStatusJobs").doc(`status_${solicitudId}`);
}

export async function enqueueIqStatusMonitorJob(input: {
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
  createdAtLowerBoundMs?: number;
  reason: string;
  nextRunAt?: Date;
}): Promise<void> {
  if (!input.solicitudId || !input.rootId || !input.profileId || !input.marker || !input.iqFolio) {
    return;
  }
  const now = new Date();
  const ref = getQueueRef(input.solicitudId);

  const solicitudSnap = await db.collection("solicitudes").doc(input.solicitudId).get().catch(() => null);
  
  let createdAtLowerBoundMs = Number(input.createdAtLowerBoundMs ?? 0) || 0;
  if (!createdAtLowerBoundMs && solicitudSnap?.exists) {
    const solicitudA54 = asRecord(solicitudSnap.data());
    createdAtLowerBoundMs = timestampMillis(solicitudA54.createdAt);
  }

  if (!createdAtLowerBoundMs) {
    throw new HttpsError(
      "failed-precondition",
      "La solicitud no tiene fecha y hora exactas de creacion para limitar la busqueda IQ.",
    );
  }
if (solicitudSnap?.exists) {
    const solicitud = asRecord(solicitudSnap.data());
    if (isIqTerminalOrOmittedSolicitud(solicitud)) {
      const reason = getIqTerminalStopReason(solicitud);
      await ref.set({
        jobType: "IQ_STATUS_MONITOR",
        version: IQ_STATUS_MONITOR_VERSION,
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
        createdAtLowerBoundMs,
        reason: input.reason,
        lastError: reason,
        lastErrorCode: "STOPPED_SOLICITUD_TERMINAL",
        nextRunAt: null,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      await solicitudSnap.ref.set({
        iqStatusSyncStatus: "OMITTED",
        iqStatusLastError: reason,
        iqStatusUpdatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true }).catch(() => undefined);
      return;
    }
  }

  await ref.set({
    jobType: "IQ_STATUS_MONITOR",
    version: IQ_STATUS_MONITOR_VERSION,
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
        createdAtLowerBoundMs,
    reason: input.reason,
    nextRunAt: Timestamp.fromDate(input.nextRunAt ?? now),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

function parseJob(snapshot: DocumentSnapshot): IqStatusJob | null {
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
    createdAtLowerBoundMs: Number(data.createdAtLowerBoundMs ?? 0) || 0,
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

async function loadProfile(job: IqStatusJob): Promise<{
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

function isRejectedOperation(match: IqInvoiceMarkerMatch | undefined): boolean {
  const operation = cleanUpper(match?.operationStatus);
  return /RECHAZAD[AO]/.test(operation);
}

function isCancelledOperation(match: IqInvoiceMarkerMatch | undefined): boolean {
  const operation = cleanUpper(match?.operationStatus);
  return /CANCELAD[AO]/.test(operation) ||
    operation === "CANCELLED" ||
    operation === "CANCELED";
}

function buildUserCorrectionMessage(reason: string): string {
  return [
    "La solicitud requiere correccion.",
    `Motivo: ${reason || "La solicitud fue rechazada por el despacho."}`,
    "Actualiza la OC.",
  ].join("\n");
}

async function notifyUserCorrection(input: {
  solicitudId: string;
  solicitudFolio: string;
  rootId: string;
  userUid: string;
  message: string;
}): Promise<void> {
  if (!input.userUid) {
    return;
  }
  const notificationRef = db.collection("userNotifications").doc();
  await notificationRef.set({
    rootId: input.rootId,
    uid: input.userUid,
    audience: "user",
    module: "solicitudes",
    event: "SOLICITUD_REQUIERE_CORRECCION",
    solicitudId: input.solicitudId,
    solicitudFolio: input.solicitudFolio,
    title: "Solicitud requiere correccion",
    message: input.message,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }).catch(() => undefined);

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
        await sendTelegramMessage(TELEGRAM_BOT_TOKEN.value(), chatId, input.message.slice(0, 3900));
      }
    }
  } catch {
    // User notification is best effort.
  }
}

async function publishSuperadminRejectionNotification(input: {
  job: IqStatusJob;
  reason: string;
  operationStatus: string;
  rowText: string;
}): Promise<void> {
  await db.collection("iqIntegrationNotifications").doc().set({
    rootId: input.job.rootId,
    audienceRole: "superadmin",
    event: "IQ_SOLICITUD_RECHAZADA",
    module: "iq",
    status: "REJECTED_BEFORE_STAMPING",
    solicitudId: input.job.solicitudId,
    solicitudFolio: input.job.solicitudFolio,
    iqId: input.job.iqFolio,
    profileId: input.job.profileId,
    profileAlias: input.job.profileAlias || null,
    message: `IQ RECHAZO FOLIO ${input.job.iqFolio}: ${input.reason}`,
    operationStatus: input.operationStatus || null,
    rowText: input.rowText || null,
    channels: ["in_app", "telegram"],
    inAppStatus: "READY",
    telegramStatus: "PENDING",
    read: false,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }).catch(() => undefined);
}

async function markCancelled(input: {
  job: IqStatusJob;
  match: IqInvoiceMarkerMatch;
}): Promise<void> {
  const solicitudRef = db.collection("solicitudes").doc(input.job.solicitudId);
  const now = FieldValue.serverTimestamp();

  await db.runTransaction(async (tx: Transaction) => {
    const solicitudSnap = await tx.get(solicitudRef);

    if (!solicitudSnap.exists) {
      throw new HttpsError("not-found", "Solicitud PAY0 no encontrada.");
    }

    const solicitud = asRecord(solicitudSnap.data());
    const cancelledBy =
      cleanText(solicitud.iqCancellationRequestedBy) ||
      cleanText(solicitud.cancelledBy) ||
      cleanText(input.job.requestedBy) ||
      "system";

    tx.set(solicitudRef, {
      status: "CANCELADA",
      cancelledBy,
      cancelledAt: now,
      iqOperationStatus: "CANCELADA",
      iqCancellationStatus: "CONFIRMED",
      iqCancelledAt: now,
      iqCancelledFolio: input.job.iqFolio,
      iqStatusMonitorStatus: "CANCELLED",
      iqStatusMonitorVersion: IQ_STATUS_MONITOR_VERSION,
      iqLastOperationStatus: cleanText(input.match.operationStatus) || "CANCELADA",
      iqLastRowText: input.match.rowText || null,
      iqStatusMonitorNextCheckAt: null,
      iqStatusUpdatedAt: now,
    }, { merge: true });

    tx.set(input.job.ref, {
      status: "CANCELLED",
      operationStatus: cleanText(input.match.operationStatus) || "CANCELADA",
      rowText: input.match.rowText || null,
      finishedAt: now,
      updatedAt: now,
      nextRunAt: null,
    }, { merge: true });
  });

  await safeLogActivity({
    event: "IQ_SOLICITUD_CANCELADA",
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
    amount: input.job.amount,
    description: `Solicitud ${input.job.solicitudFolio} cancelada en IQ. FOLIO IQ: ${input.job.iqFolio}`,
    extra: {
      iqId: input.job.iqFolio,
      iqProfileId: input.job.profileId,
      iqProfileAlias: input.job.profileAlias || null,
      marker: input.job.marker,
      operationStatus: cleanText(input.match.operationStatus),
      rowText: input.match.rowText || null,
    },
  });
}
async function markRejected(input: {
  job: IqStatusJob;
  match: IqInvoiceMarkerMatch;
}): Promise<void> {
  const solicitudRef = db.collection("solicitudes").doc(input.job.solicitudId);
  const noteRef = solicitudRef.collection("notas").doc(`despacho-correccion-${input.job.iqFolio}`);
  const reason = cleanText(input.match.rejectionComment) || "La solicitud fue rechazada por el despacho.";
  const userMessage = buildUserCorrectionMessage(reason);
  const now = FieldValue.serverTimestamp();
  let userUid = "";

  await db.runTransaction(async (tx: Transaction) => {
    const solicitudSnap = await tx.get(solicitudRef);
    if (!solicitudSnap.exists) {
      throw new HttpsError("not-found", "Solicitud PAY0 no encontrada.");
    }
    const solicitud = asRecord(solicitudSnap.data());
    userUid = cleanText(solicitud.createdBy ?? solicitud.createdByUid ?? solicitud.userId ?? input.job.requestedBy);

    tx.set(solicitudRef, {
      status: "RECHAZADA",
      iqOperationStatus: "RECHAZADA",
      iqStatusMonitorStatus: "REQUIRES_CORRECTION",
      iqStatusMonitorVersion: IQ_STATUS_MONITOR_VERSION,
      iqRejectionStatus: "REJECTED_BEFORE_STAMPING",
      iqRejectionReason: reason,
      iqRejectedAt: now,
      iqRejectedFolio: input.job.iqFolio,
      iqCanResend: true,
      iqNeedsOcCorrection: true,
      iqLastOperationStatus: cleanText(input.match.operationStatus) || null,
      iqLastRejectionComment: reason,
      iqLastRowText: input.match.rowText || null,
      iqStatusUpdatedAt: now,
      hasUnreadMsg: true,
    }, { merge: true });

    tx.set(noteRef, {
      rootId: input.job.rootId,
      createdBy: "system",
      createdByName: "Sistema",
      createdByRole: "system",
      source: "DESPACHO",
      text: userMessage,
      createdAt: now,
      updatedAt: now,
    }, { merge: true });

    tx.set(input.job.ref, {
      status: "REJECTED_BEFORE_STAMPING",
      operationStatus: cleanText(input.match.operationStatus) || null,
      rejectionComment: reason,
      rowText: input.match.rowText || null,
      finishedAt: now,
      updatedAt: now,
      nextRunAt: null,
    }, { merge: true });
  });

  await notifyUserCorrection({
    solicitudId: input.job.solicitudId,
    solicitudFolio: input.job.solicitudFolio,
    rootId: input.job.rootId,
    userUid,
    message: userMessage,
  });

  await publishSuperadminRejectionNotification({
    job: input.job,
    reason,
    operationStatus: cleanText(input.match.operationStatus),
    rowText: input.match.rowText || "",
  });

  await safeLogActivity({
    event: "IQ_SOLICITUD_RECHAZADA",
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
    amount: input.job.amount,
    description: `Solicitud ${input.job.solicitudFolio} rechazada en IQ antes de timbrar. FOLIO IQ: ${input.job.iqFolio}`,
    extra: {
      iqId: input.job.iqFolio,
      iqProfileId: input.job.profileId,
      iqProfileAlias: input.job.profileAlias || null,
      marker: input.job.marker,
      operationStatus: cleanText(input.match.operationStatus),
      rejectionComment: reason,
      rowText: input.match.rowText || null,
      userMessage,
    },
  });
}

async function rescheduleJob(input: {
  job: IqStatusJob;
  config: IqOperatingCalendarConfig;
  error?: string;
  status?: string;
  operationStatus?: string;
  match?: IqInvoiceMarkerMatch;
}): Promise<void> {
  const attemptCount = input.job.attemptCount + 1;
  const nextRunAt = nextMonitorRunAt(input.config, attemptCount);
  await input.job.ref.set({
    status: input.status || "QUEUED",
    attemptCount,
    lastAttemptAt: FieldValue.serverTimestamp(),
    lastError: input.error || null,
    operationStatus: input.operationStatus || null,
    lastRowText: input.match?.rowText || null,
    nextRunAt: Timestamp.fromDate(nextRunAt),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  const solicitudRef = db.collection("solicitudes").doc(input.job.solicitudId);
  const solicitudSnap = await solicitudRef.get();
  const solicitud = solicitudSnap.exists ? asRecord(solicitudSnap.data()) : {};
  const rejectedIqFolio = cleanText(solicitud.iqRejectedFolio);
  const historicalRejectedAttempt =
    Boolean(input.job.iqFolio) &&
    Boolean(rejectedIqFolio) &&
    input.job.iqFolio !== rejectedIqFolio;

  const solicitudPatch: Record<string, unknown> = {
    iqOperationStatus: input.operationStatus || null,
    iqStatusMonitorStatus: input.status || "MONITORING",
    iqStatusMonitorAttemptCount: attemptCount,
    iqStatusMonitorLastError: input.error || null,
    iqStatusMonitorNextCheckAt: Timestamp.fromDate(nextRunAt),
    iqLastRowText: input.match?.rowText || null,
    iqStatusUpdatedAt: FieldValue.serverTimestamp(),
  };

  // INC_SOL_OC_REINTENTO_A16_SELF_HEAL_HISTORICAL_REJECTION
  // Si el rechazo pertenece a otro folio, queda solo como historico.
  if (historicalRejectedAttempt) {
    solicitudPatch.iqStatus = FieldValue.delete();
    solicitudPatch.iqRejectionStatus = FieldValue.delete();
    solicitudPatch.iqRejectionReason = FieldValue.delete();
    solicitudPatch.iqCanResend = FieldValue.delete();
    solicitudPatch.iqNeedsOcCorrection = FieldValue.delete();
    solicitudPatch.iqLastOperationStatus = FieldValue.delete();
    solicitudPatch.iqLastRejectionComment = FieldValue.delete();
  }

  await solicitudRef.set(solicitudPatch, { merge: true });
}

async function processJobGroup(input: {
  jobs: IqStatusJob[];
  source: "MANUAL" | "SCHEDULER";
}): Promise<Map<string, string>> {
  const statuses = new Map<string, string>();
  const allowedJobsH4D73A8: typeof input.jobs = [];
  for (const jobH4D73A8 of input.jobs) {
    const solicitudSnapH4D73A8 = await db.collection("solicitudes").doc(jobH4D73A8.solicitudId).get();
    const solicitudH4D73A8: any = solicitudSnapH4D73A8.exists ? solicitudSnapH4D73A8.data() || {} : {};
    const continuationGateH4D73A8 = solicitudSnapH4D73A8.exists ? await evaluateIqDispatchGate({ db, despachoId: solicitudH4D73A8.despachoId || solicitudH4D73A8.firmId, companyId: solicitudH4D73A8.companyId || solicitudH4D73A8.empresaId, rootId: jobH4D73A8.rootId }) : { ok: false, code: "IQ_SOLICITUD_NOT_FOUND", message: "Solicitud no encontrada." };
    if (!continuationGateH4D73A8.ok) {
      await jobH4D73A8.ref.set({ status: "OMITTED_PROVIDER_GATE", lastError: `[${continuationGateH4D73A8.code}] ${continuationGateH4D73A8.message}`, nextRunAt: null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      statuses.set(jobH4D73A8.solicitudId, "OMITTED_PROVIDER_GATE" as any);
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
    // H4_D87_A58_A30_R1_MANUAL_STATUS_BYPASS_OPERATING_WINDOW
    // La ventana operativa limita al scheduler; el boton manual es forzado.
    if (input.source === "SCHEDULER") {
      const decision = evaluateIqOperatingWindow(config, new Date(), "RECONCILIATION");
      if (!decision.allowed) {
        const nextRunAt = decision.nextEligibleAt ?? new Date(Date.now() + CONFIG_NOT_READY_RETRY_MS);
        for (const job of input.jobs) {
          await job.ref.set({
            status: "WAITING_FOR_OPERATING_WINDOW",
            lastError: `Horario no habilitado para revision del despacho: ${decision.reason}`,
            nextRunAt: Timestamp.fromDate(nextRunAt),
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          statuses.set(job.solicitudId, "WAITING_FOR_OPERATING_WINDOW");
        }
        return statuses;
      }
    }

    const profile = await loadProfile(firstJob);
    const browserResult = await runIqFindInvoicesByMarkersHttpA54({
      erpUrl: profile.erpUrl,
      username: profile.username,
      password: profile.password,
      items: input.jobs.map((job) => ({
        key: job.solicitudId,
        marker: job.marker,
        targetDateIso: job.targetDateIso,
        // H4_D87_A58_A31_IQ_ID_EXACT
        iqIdExact: job.iqFolio,
        folioToken: job.solicitudFolio,
        expectedAmount: job.amount,
        createdAtLowerBoundMs: job.createdAtLowerBoundMs,
      })),
      timeZone: config.timezone || DEFAULT_IQ_TIME_ZONE,
      adjacentMonthFallback: false,
      dateFilterFallback: false,
      maxPages: 20,
      refreshDelaysMs: [0],
    });

    const lookupSummary = [
      `paginas=${browserResult.pagesInspected}`,
      `orden=${browserResult.sortsVerified}`,
      `estrategias=${browserResult.searchDiagnostics.join(",") || "ninguna"}`,
      browserResult.errors.length > 0 ? `errores=${browserResult.errors.join(" | ")}` : "errores=ninguno",
    ].join("; ");

    if (!browserResult.authenticated) {
      const error = browserResult.errors.join(" ") || "No se pudo autenticar en el despacho.";
      for (const job of input.jobs) {
        await rescheduleJob({ job, config, error });
        statuses.set(job.solicitudId, "NOT_FOUND");
      }
      return statuses;
    }

    const matchesByKey = new Map(browserResult.matches.map((match) => [match.key, match]));

    for (const job of input.jobs) {
      const match = matchesByKey.get(job.solicitudId);
      const operationStatus = cleanText(match?.operationStatus);

      if (isRejectedOperation(match)) {
        await markRejected({ job, match: match as IqInvoiceMarkerMatch });
        statuses.set(job.solicitudId, "REJECTED_BEFORE_STAMPING");
        continue;
      }

      if (isCancelledOperation(match)) {
        await markCancelled({ job, match: match as IqInvoiceMarkerMatch });
        statuses.set(job.solicitudId, "CANCELLED");
        continue;
      }

      if (match?.found) {
        if (match.hasInvoiceAction) {
          await enqueueIqInvoiceImportJob({
            solicitudId: job.solicitudId,
            solicitudFolio: job.solicitudFolio,
            rootId: job.rootId,
            profileId: job.profileId,
            profileAlias: job.profileAlias,
            marker: job.marker,
            iqFolio: job.iqFolio,
            targetDateIso: job.targetDateIso,
            amount: job.amount,
            requestedBy: job.requestedBy || "system",
            reason: "INVOICE_ACTION_AVAILABLE",
            nextRunAt: new Date(),
          });
          await rescheduleJob({
            job,
            config,
            status: "INVOICE_AVAILABLE",
            operationStatus: operationStatus || "EN_OPERACION",
            match,
          });
          statuses.set(job.solicitudId, "INVOICE_AVAILABLE");
          continue;
        }

        await rescheduleJob({
          job,
          config,
          status: "MONITORING",
          operationStatus: operationStatus || "EN_OPERACION",
          match,
        });
        statuses.set(job.solicitudId, "MONITORING");
        continue;
      }

      await rescheduleJob({
        job,
        config,
        error: `No se localizo el marcador para revisar estado del despacho. ${lookupSummary}`,
      });
      statuses.set(job.solicitudId, "NOT_FOUND");
    }

    return statuses;
  } catch (error) {
    const message = safeErrorMessage(error);
    const config = await loadOperatingConfig(firstJob.rootId);
    for (const job of input.jobs) {
      await rescheduleJob({ job, config, error: message });
      statuses.set(job.solicitudId, "ERROR");
    }
    return statuses;
  } finally {
    await releaseProfileLock(firstJob.profileId, workerToken);
  }
}

async function buildJobForSolicitud(input: { solicitudId: string; auth: AuthContext }): Promise<IqStatusJob> {
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
  if (isIqTerminalOrOmittedSolicitud(solicitud)) {
    throw new HttpsError("failed-precondition", getIqTerminalStopReason(solicitud));
  }

  const creation = creationSnap.exists ? asRecord(creationSnap.data()) : {};
  const solicitudFolio = cleanText(solicitud.folio ?? solicitud.folioSolicitud ?? input.solicitudId);
  const iqFolio = cleanText(solicitud.iqFolio ?? solicitud.iqId ?? creation.iqId);
  const profileId = cleanText(solicitud.iqCredentialProfileId ?? creation.profileId);
  const marker = cleanText(solicitud.iqReconciliationMarker ?? creation.marker ?? creation.creationMarker);
  if (!iqFolio || !profileId || !marker) {
    throw new HttpsError("failed-precondition", "La solicitud no tiene folio externo, cuenta o marcador para revisar estado.");
  }
  
  const createdAtLowerBoundMs = timestampMillis(solicitud.createdAt);
  if (!createdAtLowerBoundMs) {
    throw new HttpsError(
      "failed-precondition",
      "La solicitud no tiene fecha y hora exactas de creacion para limitar la busqueda IQ.",
    );
  }

  const config = await loadOperatingConfig(input.auth.rootId);
  const targetDateIso = normalizeIsoDate(
    solicitud.iqTargetDateIso ?? creation.targetDateIso,
  ) || dateIsoInTimeZone(new Date(timestampMillis(solicitud.iqCreatedAt) || Date.now()), config.timezone || DEFAULT_IQ_TIME_ZONE);
  await enqueueIqStatusMonitorJob({
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
    createdAtLowerBoundMs,
    reason: "MANUAL_STATUS_SYNC",
    nextRunAt: new Date(),
  });
  return {
    ref: getQueueRef(input.solicitudId),
    id: `status_${input.solicitudId}`,
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
    createdAtLowerBoundMs,
  };
}

export const syncIqSolicitudStatus = onCall(
  {
    cors: true,
    secrets: [IQ_CREDENTIALS_KEY, TELEGRAM_BOT_TOKEN],
    invoker: "public",
    timeoutSeconds: 180,
    memory: "2GiB",
    concurrency: 1,
  },
  async (request) => {
    await assertIqAuthorized(request, { allowedRoles: ["superadmin"] });
    const auth = await getAuthContext(request);
    assertSuperAdmin(auth);
    const solicitudId = cleanText(asRecord(request.data).solicitudId);
    if (!solicitudId) {
      throw new HttpsError("invalid-argument", "solicitudId requerido.");
    }
    const job = await buildJobForSolicitud({ solicitudId, auth });
    const result = await processJobGroup({ jobs: [job], source: "MANUAL" });
    const status = result.get(solicitudId) || "NOT_FOUND";
    return { ok: status !== "ERROR", status };
  },
);

// H4_D82_A3_A6_A3C_AUTOMATION_CONTROL
// IQ2G_H4_D55A_ENABLED_SCHEDULER_START processIqStatusMonitorQueue
export const processIqStatusMonitorQueue = onSchedule(
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
      process: "statusMonitor",
      purpose: "RECONCILIATION",
    });

    if (enabledRoots.size === 0) {
      return;
    }

    const snap = await db
      .collection("iqStatusJobs")
      .where("status", "in", ["QUEUED", "MONITORING", "WAITING_FOR_OPERATING_WINDOW"])
      .limit(MAX_JOBS_PER_RUN)
      .get();
    const nowMs = Date.now();
    const jobs = snap.docs
      .map(parseJob)
      .filter((job): job is IqStatusJob => Boolean(job))
      .filter((job) => enabledRoots.has(job.rootId))
      .filter((job) => {
        const data = asRecord(snap.docs.find((doc) => doc.id === job.id)?.data());
        const nextRunAtMs = timestampMillis(data.nextRunAt);
        return !nextRunAtMs || nextRunAtMs <= nowMs;
      });

    const byProfile = new Map<string, IqStatusJob[]>();
    for (const job of jobs) {
      const bucket = byProfile.get(job.profileId) ?? [];
      if (bucket.length < MAX_JOBS_PER_PROFILE) {
        bucket.push(job);
        byProfile.set(job.profileId, bucket);
      }
    }

    let processed = 0;
    let rejected = 0;
    for (const group of byProfile.values()) {
      const statuses = await processJobGroup({ jobs: group, source: "SCHEDULER" });
      processed += statuses.size;
      rejected += Array.from(statuses.values()).filter((status) => status === "REJECTED_BEFORE_STAMPING").length;
    }

    await db.collection("iqQueueRuns").doc(`status-${Date.now()}`).set({
      type: "STATUS_MONITOR",
      processed,
      rejected,
      profileGroups: byProfile.size,
      createdAt: FieldValue.serverTimestamp(),
    }).catch(() => undefined);
  },
);
// IQ2G_H4_D55A_ENABLED_SCHEDULER_END processIqStatusMonitorQueue
