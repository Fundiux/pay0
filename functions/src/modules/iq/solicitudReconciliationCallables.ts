import { evaluateIqDispatchGate } from "../dispatches/iqGate";
import { DEFAULT_IQ_ERP_URL } from "./config";
import * as crypto from "crypto";
import * as admin from "firebase-admin";
import type {
  DocumentReference,
  DocumentSnapshot,
  Transaction,
} from "firebase-admin/firestore";
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
import { logActivity, type ActivityLogParams } from "../../utils/logActivity";
import { enqueueIqStatusMonitorJob } from "./solicitudStatusMonitorCallables";
import { assertIqAuthorized } from "./authorization";
import { loadEnabledIqAutomationRoots } from "./automationRuntime";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

const IQ_CREDENTIALS_KEY = defineSecret("IQ_CREDENTIALS_KEY");
const DEFAULT_IQ_TIME_ZONE = "America/Mexico_City";
const IQ_RECONCILIATION_VERSION = "IQ-SOLICITUD-RECONCILIATION-3";
const PROFILE_LOCK_MS = 8 * 60 * 1000;
const CONFIG_NOT_READY_RETRY_MS = 24 * 60 * 60 * 1000;
const MAX_JOBS_PER_RUN = 40;
const MAX_JOBS_PER_PROFILE = 20;

type AuthContext = {
  uid: string;
  role: string;
  rootId: string;
  user: Record<string, unknown>;
};

type ReconciliationJob = {
  ref: DocumentReference;
  id: string;
  solicitudId: string;
  solicitudFolio: string;
  rootId: string;
  profileId: string;
  profileAlias: string;
  marker: string;
  targetDateIso: string;
  amount: number;
  attemptCount: number;
  requestedBy: string;
  createdAtLowerBoundMs: number;
};

type ReconciliationResultStatus =
  | "LINKED"
  | "NOT_FOUND"
  | "WAITING_FOR_OPERATING_WINDOW"
  | "LOCKED"
  | "REVIEW_REQUIRED";

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
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
    // Fallback below.
  }

  return value.toISOString().slice(0, 10);
}

function normalizeErpUrl(value: string): string {
  const raw = value.trim() || DEFAULT_IQ_ERP_URL;

  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}`;
  } catch {
    throw new HttpsError(
      "failed-precondition",
      "La cuenta IQ tiene una URL ERP invalida.",
    );
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
    throw new HttpsError(
      "failed-precondition",
      "IQ_CREDENTIALS_KEY no esta configurada.",
    );
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
    throw new HttpsError(
      "failed-precondition",
      "La cuenta IQ no tiene contrasena configurada.",
    );
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

  return {
    uid,
    role,
    rootId: rootId || uid,
    user,
  };
}

function assertSuperAdmin(auth: AuthContext): void {
  if (auth.role !== "superadmin") {
    throw new HttpsError(
      "permission-denied",
      "Solo Super Admin puede conciliar solicitudes IQ manualmente.",
    );
  }
}

function getActorName(auth: AuthContext): string {
  return cleanText(
    auth.user.username ??
      auth.user.displayName ??
      auth.user.name ??
      auth.user.email ??
      auth.uid,
  );
}

function buildMarker(input: {
  solicitudId: string;
  solicitudFolio: string;
  creation: Record<string, unknown>;
}): string {
  const persisted = cleanText(
    input.creation.marker ??
      input.creation.creationMarker ??
      input.creation.commentsMarker,
  );

  if (persisted) {
    return persisted;
  }

  const executionToken = cleanText(input.creation.executionToken);

  if (!executionToken) {
    return "";
  }

  return [
    "PAY0",
    input.solicitudFolio || input.solicitudId,
    `IQ-${executionToken.slice(0, 8)}`,
  ].join(" ");
}

async function loadOperatingConfig(rootId: string): Promise<IqOperatingCalendarConfig> {
  const snap = await db.collection("iqIntegrationConfigs").doc(rootId).get();
  return normalizeIqOperatingCalendarConfig(snap.exists ? snap.data() : {});
}

function getQueueRef(solicitudId: string): DocumentReference {
  return db.collection("iqJobs").doc(`reconcile_${solicitudId}`);
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

function nextRunAtForAttempt(
  config: IqOperatingCalendarConfig,
  attemptCount: number,
  now = new Date(),
): Date {
  const candidate = new Date(
    now.getTime() + getIqReconciliationDelayMs(attemptCount),
  );
  const decision = evaluateIqOperatingWindow(
    config,
    candidate,
    "RECONCILIATION",
  );

  if (decision.allowed) {
    return candidate;
  }

  return (
    decision.nextEligibleAt ??
    new Date(now.getTime() + CONFIG_NOT_READY_RETRY_MS)
  );
}

export async function enqueueIqReconciliationJob(input: {
  solicitudId: string;
  solicitudFolio: string;
  rootId: string;
  profileId: string;
  profileAlias?: string;
  marker: string;
  amount?: number;
  targetDateIso?: string;
  requestedBy: string;
  createdAtLowerBoundMs?: number;
  reason: string;
  nextRunAt?: Date;
}): Promise<void> {
  if (!input.solicitudId || !input.rootId || !input.profileId || !input.marker) {
    return;
  }

  const jobRef = getQueueRef(input.solicitudId);
  const now = new Date();

  
  let createdAtLowerBoundMs = Number(input.createdAtLowerBoundMs ?? 0) || 0;
  if (!createdAtLowerBoundMs) {
    const solicitudSnapA54 = await db.collection("solicitudes").doc(input.solicitudId).get();
    const solicitudA54 = solicitudSnapA54.exists ? asRecord(solicitudSnapA54.data()) : {};
    createdAtLowerBoundMs = timestampMillis(solicitudA54.createdAt);
  }

  if (!createdAtLowerBoundMs) {
    throw new HttpsError(
      "failed-precondition",
      "La solicitud no tiene fecha y hora exactas de creacion para limitar la busqueda IQ.",
    );
  }

  await jobRef.set(
    {
      jobType: "RECONCILE_SOLICITUD",
      version: IQ_RECONCILIATION_VERSION,
      status: "QUEUED",
      solicitudId: input.solicitudId,
      solicitudFolio: input.solicitudFolio || input.solicitudId,
      rootId: input.rootId,
      profileId: input.profileId,
      profileAlias: input.profileAlias || null,
      marker: input.marker,
      targetDateIso: normalizeIsoDate(input.targetDateIso) || null,
      amount: Number(input.amount ?? 0) || 0,
      requestedBy: input.requestedBy,
      createdAtLowerBoundMs,
      reason: input.reason,
      attemptCount: FieldValue.increment(0),
      nextRunAt: Timestamp.fromDate(input.nextRunAt ?? now),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

function parseJob(snapshot: DocumentSnapshot): ReconciliationJob | null {
  const data = asRecord(snapshot.data());
  const solicitudId = cleanText(data.solicitudId);
  const profileId = cleanText(data.profileId);
  const rootId = cleanText(data.rootId);
  const marker = cleanText(data.marker);

  if (!solicitudId || !profileId || !rootId || !marker) {
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
    targetDateIso:
      normalizeIsoDate(data.targetDateIso) ||
      dateIsoInTimeZone(
        new Date(timestampMillis(data.createdAt) || Date.now()),
        DEFAULT_IQ_TIME_ZONE,
      ),
    amount: Number(data.amount ?? 0) || 0,
    attemptCount: Math.max(0, Number(data.attemptCount ?? 0) || 0),
    requestedBy: cleanText(data.requestedBy),
    createdAtLowerBoundMs: Number(data.createdAtLowerBoundMs ?? 0) || 0,
  };
}

async function acquireProfileLock(
  profileId: string,
  workerToken: string,
): Promise<boolean> {
  const lockRef = db.collection("iqAccountLocks").doc(profileId);
  const nowMs = Date.now();

  return db.runTransaction(async (tx: Transaction) => {
    const snap = await tx.get(lockRef);
    const current = snap.exists ? asRecord(snap.data()) : {};
    const leaseUntilMs = timestampMillis(current.leaseUntil);
    const currentToken = cleanText(current.workerToken);

    if (
      leaseUntilMs > nowMs &&
      currentToken &&
      currentToken !== workerToken
    ) {
      return false;
    }

    tx.set(
      lockRef,
      {
        profileId,
        workerToken,
        status: "ACTIVE",
        leaseUntil: Timestamp.fromMillis(nowMs + PROFILE_LOCK_MS),
        acquiredAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return true;
  });
}

async function releaseProfileLock(
  profileId: string,
  workerToken: string,
): Promise<void> {
  const lockRef = db.collection("iqAccountLocks").doc(profileId);

  await db.runTransaction(async (tx: Transaction) => {
    const snap = await tx.get(lockRef);
    const current = snap.exists ? asRecord(snap.data()) : {};

    if (cleanText(current.workerToken) !== workerToken) {
      return;
    }

    tx.set(
      lockRef,
      {
        status: "IDLE",
        workerToken: FieldValue.delete(),
        leaseUntil: FieldValue.delete(),
        releasedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }).catch(() => undefined);
}

async function loadProfile(job: ReconciliationJob): Promise<{
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

  if (
    cleanText(profile.rootId) !== job.rootId ||
    profile.active !== true ||
    profile.hasPassword !== true
  ) {
    throw new HttpsError(
      "failed-precondition",
      "La cuenta IQ esta inactiva o fuera de scope.",
    );
  }

  const username = cleanText(profile.username);

  if (!username) {
    throw new HttpsError(
      "failed-precondition",
      "La cuenta IQ no tiene usuario configurado.",
    );
  }

  return {
    username,
    password: decryptSecret(profile),
    erpUrl: normalizeErpUrl(cleanText(profile.erpUrl)),
    alias: cleanText(profile.alias),
  };
}

async function linkIqFolio(input: {
  job: ReconciliationJob;
  iqId: string;
  match: IqInvoiceMarkerMatch;
  actorUid: string;
  actorName: string;
  actorRole: string;
  source: "MANUAL" | "SCHEDULER";
}): Promise<void> {
  const solicitudRef = db.collection("solicitudes").doc(input.job.solicitudId);
  const creationRef = db
    .collection("iqSolicitudCreations")
    .doc(input.job.solicitudId);
  const noteRef = solicitudRef.collection("notas").doc("iq-folio");
  const now = FieldValue.serverTimestamp();

  await db.runTransaction(async (tx: Transaction) => {
    const [solicitudSnap, creationSnap] = await Promise.all([
      tx.get(solicitudRef),
      tx.get(creationRef),
    ]);

    if (!solicitudSnap.exists) {
      throw new HttpsError("not-found", "Solicitud PAY0 no encontrada.");
    }

    const solicitud = asRecord(solicitudSnap.data());
    const existingIqId = cleanText(solicitud.iqId ?? solicitud.iqFolio);

    if (existingIqId && existingIqId !== input.iqId) {
      throw new HttpsError(
        "failed-precondition",
        `La solicitud ya esta vinculada a otro Folio IQ: ${existingIqId}.`,
      );
    }

    const creation = creationSnap.exists ? asRecord(creationSnap.data()) : {};
    const currentIqSync = asRecord(solicitud.iqSync);

    tx.set(
      creationRef,
      {
        status: "SUCCEEDED",
        previousStatus: cleanText(creation.status) || null,
        outcome: "RECONCILED",
        iqId: input.iqId,
        marker: input.job.marker,
        targetDateIso: input.job.targetDateIso,
        reconciliationVersion: IQ_RECONCILIATION_VERSION,
        reconciledAt: now,
        reconciledBy: input.actorUid,
        reconciliationSource: input.source,
        reconciliationRowText: input.match.rowText || null,
        updatedAt: now,
        finishedAt: creation.finishedAt ?? now,
      },
      { merge: true },
    );

    tx.set(
      solicitudRef,
      {
        iqId: input.iqId,
        iqFolio: input.iqId,
        iqCreationStatus: "CREATED",
        iqCreationOutcome: "RECONCILED",
        iqSyncStatus: "CREATED",
        iqReconciliationStatus: "LINKED",
        iqReconciledAt: now,
        iqReconciledBy: input.actorUid,
        iqReconciliationMarker: input.job.marker,
        iqTargetDateIso: input.job.targetDateIso,
        iqReconciliationLastError: null,
        iqInvoiceStatus: cleanText(solicitud.iqInvoiceStatus) || "WAITING",
        iqInvoiceNextCheckAt: solicitud.iqInvoiceNextCheckAt ?? null,
        iqSyncUpdatedAt: now,
        iqSync: {
          ...currentIqSync,
          status: "CREATED",
          iqId: input.iqId,
          profileId: input.job.profileId,
          profileAlias: input.job.profileAlias || null,
          marker: input.job.marker,
          reconciledAt: now,
          reconciledBy: input.actorUid,
          reconciliationVersion: IQ_RECONCILIATION_VERSION,
        },
      },
      { merge: true },
    );

    tx.set(
      noteRef,
      {
        rootId: input.job.rootId,
        createdBy: input.actorUid,
        createdByName: input.actorName,
        createdByRole: input.actorRole,
        source: "IQ",
        text: `FOLIO IQ: ${input.iqId}`,
        createdAt: now,
        updatedAt: now,
      },
      { merge: true },
    );

    tx.delete(input.job.ref);
  });

  await enqueueIqStatusMonitorJob({
    solicitudId: input.job.solicitudId,
    solicitudFolio: input.job.solicitudFolio,
    rootId: input.job.rootId,
    profileId: input.job.profileId,
    profileAlias: input.job.profileAlias,
    marker: input.job.marker,
    iqFolio: input.iqId,
    amount: input.job.amount,
    targetDateIso: input.job.targetDateIso,
    requestedBy: input.actorUid,
    reason: "RECONCILIATION_LINKED",
    nextRunAt: new Date(Date.now() + 20 * 60 * 1000),
  }).catch(() => undefined);

  await safeLogActivity({
    event: "IQ_SOLICITUD_CONCILIADA",
    rootId: input.job.rootId,
    adminId: input.job.rootId,
    actorUid: input.actorUid,
    actorName: input.actorName,
    actorUsername: input.actorName,
    actorRole: input.actorRole,
    referenceId: input.job.solicitudId,
    referenceFolio: input.job.solicitudFolio,
    referenceType: "solicitud",
    entityId: input.job.solicitudId,
    entityType: "solicitud",
    amount: input.job.amount,
    description: `Solicitud ${input.job.solicitudFolio} conciliada con IQ. FOLIO IQ: ${input.iqId}`,
    extra: {
      iqId: input.iqId,
      iqProfileId: input.job.profileId,
      iqProfileAlias: input.job.profileAlias || null,
      marker: input.job.marker,
      targetDateIso: input.job.targetDateIso,
      source: input.source,
      rowText: input.match.rowText || null,
      matchStrategy: input.match.matchStrategy,
    },
  });
}

async function rescheduleJob(input: {
  job: ReconciliationJob;
  config: IqOperatingCalendarConfig;
  error: string;
  status?: string;
}): Promise<Date> {
  const attemptCount = input.job.attemptCount + 1;
  const nextRunAt = nextRunAtForAttempt(input.config, attemptCount);

  await input.job.ref.set(
    {
      status: input.status || "QUEUED",
      attemptCount,
      lastAttemptAt: FieldValue.serverTimestamp(),
      lastError: input.error || null,
      nextRunAt: Timestamp.fromDate(nextRunAt),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await db
    .collection("solicitudes")
    .doc(input.job.solicitudId)
    .set(
      {
        iqReconciliationStatus: input.status || "PENDING",
        iqReconciliationAttemptCount: attemptCount,
        iqReconciliationLastError: input.error || null,
        iqReconciliationNextCheckAt: Timestamp.fromDate(nextRunAt),
        iqSyncUpdatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

  return nextRunAt;
}

async function processJobGroup(input: {
  jobs: ReconciliationJob[];
  source: "MANUAL" | "SCHEDULER";
  actorUid: string;
  actorName: string;
  actorRole: string;
  refreshDelaysMs?: number[];
  maxPages?: number;
}): Promise<Map<string, ReconciliationResultStatus>> {
  const statuses = new Map<string, ReconciliationResultStatus>();
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

  let password = "";

  try {
    const profile = await loadProfile(firstJob);
    const operatingConfig = await loadOperatingConfig(firstJob.rootId);
    password = profile.password;
    const browserResult = await runIqFindInvoicesByMarkersHttpA54({
      erpUrl: profile.erpUrl,
      username: profile.username,
      password,
      items: input.jobs.map((job) => ({
        key: job.solicitudId,
        marker: job.marker,
        targetDateIso: job.targetDateIso,
        folioToken: job.solicitudFolio,
        expectedAmount: job.amount,
        createdAtLowerBoundMs: job.createdAtLowerBoundMs,
      })),
      timeZone: operatingConfig.timezone || DEFAULT_IQ_TIME_ZONE,
      adjacentMonthFallback: false,
      dateFilterFallback: false,
      maxPages: Math.min(20, Math.max(1, input.maxPages ?? 20)),
      refreshDelaysMs: input.refreshDelaysMs ?? [0],
    });

    const lookupSummary = [
      `ventanas=${browserResult.dateWindowsInspected.join(",") || "ninguna"}`,
      `paginas=${browserResult.pagesInspected}`,
      `filtros=${browserResult.filtersApplied}`,
      `orden=${browserResult.sortsVerified}`,
      `estrategias=${browserResult.searchDiagnostics.join(",") || "ninguna"}`,
      browserResult.errors.length > 0
        ? `errores=${browserResult.errors.join(" | ")}`
        : "errores=ninguno",
    ].join("; ");

    if (!browserResult.authenticated) {
      const error = browserResult.errors.join(" ") || "No se pudo autenticar en IQ.";

      for (const job of input.jobs) {
        const config = await loadOperatingConfig(job.rootId);
        await rescheduleJob({ job, config, error });
        statuses.set(job.solicitudId, "NOT_FOUND");
      }

      return statuses;
    }

    const matchesByKey = new Map(
      browserResult.matches.map((match) => [match.key, match]),
    );

    for (const job of input.jobs) {
      const match = matchesByKey.get(job.solicitudId);

      if (match?.found && match.iqId) {
        await linkIqFolio({
          job,
          iqId: match.iqId,
          match,
          actorUid: input.actorUid,
          actorName: input.actorName,
          actorRole: input.actorRole,
          source: input.source,
        });
        statuses.set(job.solicitudId, "LINKED");
        continue;
      }

      const config = await loadOperatingConfig(job.rootId);

      if (match?.found && !match.iqId) {
        await rescheduleJob({
          job,
          config,
          error: "La fila IQ fue localizada, pero no se pudo leer su ID.",
          status: "REVIEW_REQUIRED",
        });
        statuses.set(job.solicitudId, "REVIEW_REQUIRED");
        continue;
      }

      await rescheduleJob({
        job,
        config,
        error: `La solicitud aun no fue localizada por el marcador PAY0 exacto en Comentarios. ${lookupSummary}` ,
      });
      statuses.set(job.solicitudId, "NOT_FOUND");
    }

    return statuses;
  } catch (error) {
    const message = safeErrorMessage(error);

    for (const job of input.jobs) {
      const config = await loadOperatingConfig(job.rootId);
      await rescheduleJob({ job, config, error: message });
      statuses.set(job.solicitudId, "NOT_FOUND");
    }

    return statuses;
  } finally {
    password = "";
    await releaseProfileLock(firstJob.profileId, workerToken);
  }
}

async function buildJobForSolicitud(input: {
  solicitudId: string;
  auth: AuthContext;
}): Promise<ReconciliationJob> {
  const solicitudRef = db.collection("solicitudes").doc(input.solicitudId);
  const creationRef = db
    .collection("iqSolicitudCreations")
    .doc(input.solicitudId);
  const [solicitudSnap, creationSnap] = await Promise.all([
    solicitudRef.get(),
    creationRef.get(),
  ]);

  if (!solicitudSnap.exists) {
    throw new HttpsError("not-found", "Solicitud PAY0 no encontrada.");
  }

  const solicitud = asRecord(solicitudSnap.data());
  const rootId = cleanText(solicitud.rootId ?? solicitud.ownerRootId);
  const buildGateH4D73A8 = await evaluateIqDispatchGate({ db, despachoId: solicitud.despachoId || solicitud.firmId, companyId: solicitud.companyId || solicitud.empresaId, rootId: input.auth.rootId });
  if (!buildGateH4D73A8.ok) throw new HttpsError("failed-precondition", `[${buildGateH4D73A8.code}] ${buildGateH4D73A8.message}`);

  if (rootId && rootId !== input.auth.rootId) {
    throw new HttpsError(
      "permission-denied",
      "Solicitud fuera del scope autorizado.",
    );
  }

  const existingIqId = cleanText(solicitud.iqId ?? solicitud.iqFolio);

  if (existingIqId) {
    throw new HttpsError(
      "already-exists",
      `La solicitud ya tiene FOLIO IQ: ${existingIqId}.`,
    );
  }

  if (!creationSnap.exists) {
    throw new HttpsError(
      "failed-precondition",
      "No existe un intento de creacion IQ para conciliar.",
    );
  }

  const creation = asRecord(creationSnap.data());
  const solicitudFolio = cleanText(
    solicitud.folio ?? solicitud.folioSolicitud ?? input.solicitudId,
  );
  const profileId = cleanText(
    creation.profileId ?? solicitud.iqCredentialProfileId,
  );
  const marker = buildMarker({
    solicitudId: input.solicitudId,
    solicitudFolio,
    creation,
  });

  if (!profileId || !marker) {
    throw new HttpsError(
      "failed-precondition",
      "El intento IQ no contiene cuenta o marcador de conciliacion.",
    );
  }

  const queueRef = getQueueRef(input.solicitudId);
  const queueSnap = await queueRef.get();
  const queue = queueSnap.exists ? asRecord(queueSnap.data()) : {};
  const operatingConfig = await loadOperatingConfig(input.auth.rootId);
  const targetTimestampMs =
    timestampMillis(creation.startedAt) ||
    Number(creation.startedAtMs ?? 0) ||
    timestampMillis(solicitud.iqCreationStartedAt) ||
    timestampMillis(solicitud.createdAt) ||
    Date.now();
  
  const createdAtLowerBoundMs = timestampMillis(solicitud.createdAt);
  if (!createdAtLowerBoundMs) {
    throw new HttpsError(
      "failed-precondition",
      "La solicitud no tiene fecha y hora exactas de creacion para limitar la busqueda IQ.",
    );
  }

  const targetDateIso =
    normalizeIsoDate(
      creation.targetDateIso ??
        solicitud.iqTargetDateIso ??
        queue.targetDateIso,
    ) ||
    dateIsoInTimeZone(
      new Date(targetTimestampMs),
      operatingConfig.timezone || DEFAULT_IQ_TIME_ZONE,
    );

  await enqueueIqReconciliationJob({
    solicitudId: input.solicitudId,
    solicitudFolio,
    rootId: input.auth.rootId,
    profileId,
    profileAlias: cleanText(creation.profileAlias),
    marker,
    targetDateIso,
    amount: Number(creation.amount ?? solicitud.monto ?? 0) || 0,
    requestedBy: input.auth.uid,
    createdAtLowerBoundMs,
    reason: "MANUAL_RECONCILIATION",
    nextRunAt: new Date(),
  });

  return {
    ref: queueRef,
    id: queueRef.id,
    solicitudId: input.solicitudId,
    solicitudFolio,
    rootId: input.auth.rootId,
    profileId,
    profileAlias: cleanText(creation.profileAlias),
    marker,
    targetDateIso,
    amount: Number(creation.amount ?? solicitud.monto ?? 0) || 0,
    attemptCount: Math.max(0, Number(queue.attemptCount ?? 0) || 0),
    requestedBy: input.auth.uid,
    createdAtLowerBoundMs,
  };
}

export const reconcileSolicitudIq = onCall(
  {
    cors: true,
    secrets: [IQ_CREDENTIALS_KEY],
    invoker: "public",
    timeoutSeconds: 180,
    memory: "2GiB",
    concurrency: 1,
  },
  async (request) => {
    await assertIqAuthorized(request, { allowedRoles: ["superadmin"] });
    const auth = await getAuthContext(request);
    assertSuperAdmin(auth);

    const data = asRecord(request.data);
    const solicitudId = cleanText(data.solicitudId);
    const force = data.force === true;

    if (!solicitudId) {
      throw new HttpsError("invalid-argument", "solicitudId es obligatorio.");
    }

    const job = await buildJobForSolicitud({ solicitudId, auth });
    const config = await loadOperatingConfig(auth.rootId);
    const decision = evaluateIqOperatingWindow(
      config,
      new Date(),
      "RECONCILIATION",
    );

    if (!force && !decision.allowed) {
      const nextRunAt =
        decision.nextEligibleAt ??
        new Date(Date.now() + CONFIG_NOT_READY_RETRY_MS);

      await job.ref.set(
        {
          status: "WAITING_FOR_OPERATING_WINDOW",
          nextRunAt: Timestamp.fromDate(nextRunAt),
          operatingWindowReason: decision.reason,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      return {
        ok: true,
        data: {
          solicitudId,
          status: "WAITING_FOR_OPERATING_WINDOW",
          linked: false,
          iqId: null,
          marker: job.marker,
          targetDateIso: job.targetDateIso,
          nextRunAt: nextRunAt.getTime(),
          operatingWindowReason: decision.reason,
        },
        message:
          "La conciliacion quedo en cola para la siguiente ventana operativa IQ.",
      };
    }

    const statuses = await processJobGroup({
      jobs: [job],
      source: "MANUAL",
      actorUid: auth.uid,
      actorName: getActorName(auth),
      actorRole: auth.role,
      // La conciliacion busca unicamente el marcador PAY0 exacto en Comentarios.
      // El ordenamiento es una optimizacion; si no puede confirmarse, se recorren
      // las paginas visibles dentro de la misma sesion sin usar el calendario.
      refreshDelaysMs: [0],
      maxPages: 20,
    });
    const status = statuses.get(solicitudId) ?? "NOT_FOUND";
    const [refreshedSolicitud, refreshedJob] = await Promise.all([
      db.collection("solicitudes").doc(solicitudId).get(),
      job.ref.get(),
    ]);
    const refreshed = refreshedSolicitud.exists
      ? asRecord(refreshedSolicitud.data())
      : {};
    const iqId = cleanText(refreshed.iqId ?? refreshed.iqFolio);
    const refreshedJobData = refreshedJob.exists ? asRecord(refreshedJob.data()) : {};
    const diagnostic = cleanText(refreshedJobData.lastError);

    return {
      ok: true,
      data: {
        solicitudId,
        status,
        linked: status === "LINKED",
        iqId: iqId || null,
        marker: job.marker,
        targetDateIso: job.targetDateIso,
        diagnostic: diagnostic || null,
      },
      message:
        status === "LINKED"
          ? `Solicitud conciliada. FOLIO IQ: ${iqId}`
          : status === "LOCKED"
            ? "La cuenta IQ ya esta procesando otra cola. La conciliacion permanece pendiente."
            : status === "REVIEW_REQUIRED"
              ? "La fila IQ fue localizada, pero el ID requiere revision."
              : diagnostic
                ? `La solicitud aun no fue vinculada. ${diagnostic}`
                : "La solicitud aun no fue localizada en IQ; quedo programada para otra revision.",
    };
  },
);

// H4_D82_A3_A6_A3C_AUTOMATION_CONTROL
// H4_D63A_ENABLED_SCHEDULER_START processIqReconciliationQueue
export const processIqReconciliationQueue = onSchedule(
  {
    schedule: "every 5 minutes", // H4_D87_A58_A15_HEARTBEAT_5_MIN
    region: "us-central1",
    timeZone: "UTC",
    secrets: [IQ_CREDENTIALS_KEY],
    timeoutSeconds: 300,
    memory: "2GiB",
    maxInstances: 1,
    concurrency: 1,
  },
  async () => {
    // H4_D87_A57_A14_MASTER_GATE_RECONCILIATION
    // Gate maestro canonico: config.enabled + proceso + ventana operativa.
    // especifico de conciliacion.
    const enabledRoots = await loadEnabledIqAutomationRoots({
      process: "solicitudReconciliation",
      purpose: "RECONCILIATION",
    });

    const openConfigs = enabledRoots;

    if (openConfigs.size === 0) {
      return;
    }

    const now = Timestamp.now();
    const dueSnap = await db
      .collection("iqJobs")
      .where("nextRunAt", "<=", now)
      .orderBy("nextRunAt", "asc")
      .limit(MAX_JOBS_PER_RUN)
      .get();
    const jobs = dueSnap.docs
      .filter((doc) => {
        const data = asRecord(doc.data());
        const status = cleanText(data.status).toUpperCase();
        const rootId = cleanText(data.rootId);
        return (
          cleanText(data.jobType) === "RECONCILE_SOLICITUD" &&
          openConfigs.has(rootId) &&
          !["REVIEW_REQUIRED", "COMPLETED", "CANCELLED"].includes(status)
        );
      })
      .map(parseJob)
      .filter((job): job is ReconciliationJob => Boolean(job));

    if (jobs.length === 0) {
      return;
    }

    const groups = new Map<string, ReconciliationJob[]>();

    for (const job of jobs) {
      const key = `${job.rootId}:${job.profileId}`;
      const current = groups.get(key) ?? [];

      if (current.length < MAX_JOBS_PER_PROFILE) {
        current.push(job);
        groups.set(key, current);
      }
    }

    for (const groupJobs of groups.values()) {
      await processJobGroup({
        jobs: groupJobs,
        source: "SCHEDULER",
        actorUid: "system:iq-reconciliation",
        actorName: "IQ Reconciliation Worker",
        actorRole: "system",
        refreshDelaysMs: [0],
        maxPages: 20,
      });
    }
  },
);
// H4_D63A_ENABLED_SCHEDULER_END processIqReconciliationQueue
