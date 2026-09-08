import { DEFAULT_IQ_ERP_URL } from "./config";
import { evaluateIqDispatchGate } from "../dispatches/iqGate";
import * as crypto from "crypto";
import * as os from "os";
import * as path from "path";
import { mkdtemp, rm } from "fs/promises";
import * as admin from "firebase-admin";
import type { DocumentReference, Transaction } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";

import { runIqCreateInvoiceHttpA53 } from "./solicitudHttpCreateA53";
import { enqueueIqReconciliationJob } from "./solicitudReconciliationCallables";
import { logActivity, type ActivityLogParams } from "../../utils/logActivity";
import { sendTelegramMessage } from "../telegram/service";
import { assertIqAuthorized } from "./authorization";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const IQ_CREDENTIALS_KEY = defineSecret("IQ_CREDENTIALS_KEY");

const TELEGRAM_BOT_TOKEN = defineSecret("TELEGRAM_BOT_TOKEN");

const IQ_PREVALIDATION_VERSION = "IQ-SOLICITUD-PREVALIDATION-3";

const IQ_CREATION_VERSION = "IQ-SOLICITUD-CREATION-2";

const DEFAULT_IQ_TIME_ZONE = "America/Mexico_City";

const ACTIVE_LOCK_WINDOW_MS = 10 * 60 * 1000;

type AuthContext = {
  uid: string;
  role: string;
  rootId: string;
  user: Record<string, unknown>;
};

type IqCreationReservation = {
  reused: boolean;
  executionToken: string;
  attemptCount: number;
  fingerprint: string;
  iqId: string;
};

type IqCreationFinalStatus =
  | "SUCCEEDED"
  | "FAILED_RETRYABLE"
  | "OUTCOME_UNKNOWN";

function cleanText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
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
    throw new HttpsError(
      "failed-precondition",
      "La cuenta IQ tiene una URL ERP invalida.",
    );
  }
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

function getAuthContext(
  request: {
    auth?: {
      uid?: string;
      token?: Record<string, unknown>;
    } | null;
  },
  authorizedProfile: Record<string, unknown>,
): AuthContext {
  const uid = cleanText(request.auth?.uid);

  if (!uid) {
    throw new HttpsError("unauthenticated", "Sesion requerida.");
  }

  const user = asRecord(authorizedProfile);
  const token = asRecord(request.auth?.token);
  const role = cleanText(
    token.role ?? token.userRole ?? user.role,
  ).toLowerCase();
  const rootId = cleanText(token.rootId ?? token.root_id ?? user.rootId ?? uid);

  return {
    uid,
    role,
    rootId: rootId || uid,
    user,
  };
}

function canCreateSolicitudes(auth: AuthContext): boolean {
  if (auth.role === "superadmin") {
    return true;
  }

  const modules = asRecord(auth.user.modules);
  const solicitudes = asRecord(modules.solicitudes);

  return solicitudes.create === true;
}

async function verifyDespachoAccess(
  uid: string,
  despachoId: string,
): Promise<boolean> {
  const providerGateH4D73A6 = await evaluateIqDispatchGate({ db, despachoId });
  if (!providerGateH4D73A6.ok) return false;
  if (!despachoId) {
    return false;
  }

  const snap = await db
    .collection("userDespachoAccess")
    .doc(uid)
    .collection("despachos")
    .doc(despachoId)
    .get();

  return snap.exists && snap.data()?.active === true;
}

function safeTemporaryFileName(value: string): string {
  const base = path.basename(value).replace(/[^a-zA-Z0-9._-]/g, "_");

  return base || "orden-compra.xlsx";
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return cleanText(error.message).slice(0, 1500);
  }

  return cleanText(error).slice(0, 1500) || "Error IQ no identificado.";
}

async function safeLogIqActivity(
  solicitudId: string,
  params: ActivityLogParams,
): Promise<void> {
  try {
    await logActivity(params);
  } catch (error) {
    await db
      .collection("iqSolicitudCreations")
      .doc(solicitudId)
      .set(
        {
          auditWarnings: FieldValue.arrayUnion({
            event: params.event,
            message: safeErrorMessage(error),
            occurredAt: new Date().toISOString(),
          }),
          updatedAt: FieldValue.serverTimestamp(),
        },
        {
          merge: true,
        },
      )
      .catch(() => undefined);
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

function timestampToMillis(value: unknown): number {
  if (
    value &&
    typeof value === "object" &&
    "toMillis" in value &&
    typeof (
      value as {
        toMillis?: unknown;
      }
    ).toMillis === "function"
  ) {
    return (
      value as {
        toMillis: () => number;
      }
    ).toMillis();
  }

  return Number(value) || 0;
}

async function reserveIqCreation(input: {
  auth: AuthContext;
  solicitudRef: DocumentReference;
  solicitudId: string;
  solicitudFolio: string;
  profileId: string;
  profileAlias: string;
  orderUploadId: string;
  orderStoragePath: string;
  orderFileName: string;
  amount: number;
  invoiceType: string;
  fingerprint: string;
  allowRejectedReplacement: boolean;
  previousIqFolio: string;
  previousOrderUploadId: string;
}): Promise<IqCreationReservation> {
  const creationRef = db
    .collection("iqSolicitudCreations")
    .doc(input.solicitudId);

  return db.runTransaction(async (tx: Transaction) => {
    const [currentSolicitudSnap, creationSnap] = await Promise.all([
      tx.get(input.solicitudRef),
      tx.get(creationRef),
    ]);

    if (!currentSolicitudSnap.exists) {
      throw new HttpsError("not-found", "Solicitud PAY0 no encontrada.");
    }

    const currentSolicitud = asRecord(currentSolicitudSnap.data());
    const existingIqId = cleanText(
      currentSolicitud.iqId ?? currentSolicitud.iqFolio,
    );

    if (existingIqId && input.allowRejectedReplacement !== true) {
      // H4_D87_A57_A85_CLEAR_LEGACY_PREVALIDATION_RESIDUE_ON_REUSE_EXISTING_IQ
      tx.set(
        input.solicitudRef,
        {
          iqSync: {
            ...asRecord(currentSolicitud.iqSync),
            version: FieldValue.delete(),
            ready: FieldValue.delete(),
            errors: FieldValue.delete(),
            prevalidatedAt: FieldValue.delete(),
            requestedBy: FieldValue.delete(),
            clientMatchStrategy: FieldValue.delete(),
            companyMatchStrategy: FieldValue.delete(),
            orderExists: FieldValue.delete(),
            formPreparationVersion: FieldValue.delete(),
            formPreparedAt: FieldValue.delete(),
            formPreparedBy: FieldValue.delete(),
            formVerified: FieldValue.delete(),
            formFinalPath: FieldValue.delete(),
            associatedMatched: FieldValue.delete(),
            clientMatched: FieldValue.delete(),
            companyMatched: FieldValue.delete(),
            formError: FieldValue.delete(),
          },
        },
        {
          merge: true,
        },
      );

      return {
        reused: true,
        executionToken: "",
        attemptCount: Number(currentSolicitud.iqCreationAttemptCount ?? 1) || 1,
        fingerprint: input.fingerprint,
        iqId: existingIqId,
      };
    }

    const existing = creationSnap.exists ? asRecord(creationSnap.data()) : {};
    const existingStatus = cleanText(existing.status).toUpperCase();
    const existingFingerprint = cleanText(existing.fingerprint);
    const existingCreatedId = cleanText(existing.iqId);

    if (
      existingStatus === "SUCCEEDED" &&
      existingCreatedId &&
      input.allowRejectedReplacement !== true
    ) {
      tx.set(
        input.solicitudRef,
        {
          iqId: existingCreatedId,
          iqFolio: existingCreatedId,
          iqCreationStatus: "CREATED",
          iqSyncStatus: "CREATED",
          iqSyncUpdatedAt: FieldValue.serverTimestamp(),

          // H4_D87_A57_A85_CLEAR_LEGACY_PREVALIDATION_RESIDUE_ON_REUSE_SUCCEEDED
          iqSync: {
            ...asRecord(currentSolicitud.iqSync),
            status: "CREATED",
            iqId: existingCreatedId,
            version: FieldValue.delete(),
            ready: FieldValue.delete(),
            errors: FieldValue.delete(),
            prevalidatedAt: FieldValue.delete(),
            requestedBy: FieldValue.delete(),
            clientMatchStrategy: FieldValue.delete(),
            companyMatchStrategy: FieldValue.delete(),
            orderExists: FieldValue.delete(),
            formPreparationVersion: FieldValue.delete(),
            formPreparedAt: FieldValue.delete(),
            formPreparedBy: FieldValue.delete(),
            formVerified: FieldValue.delete(),
            formFinalPath: FieldValue.delete(),
            associatedMatched: FieldValue.delete(),
            clientMatched: FieldValue.delete(),
            companyMatched: FieldValue.delete(),
            formError: FieldValue.delete(),
          },
        },
        {
          merge: true,
        },
      );

      return {
        reused: true,
        executionToken: "",
        attemptCount: Number(existing.attemptCount ?? 1) || 1,
        fingerprint: existingFingerprint || input.fingerprint,
        iqId: existingCreatedId,
      };
    }

    if (["OUTCOME_UNKNOWN", "CREATED_ID_MISSING"].includes(existingStatus)) {
      throw new HttpsError(
        "failed-precondition",
        "La solicitud tiene un resultado IQ incierto. Debe conciliarse manualmente antes de reintentar.",
      );
    }

    if (existingStatus === "PROCESSING") {
      const startedAtMs =
        timestampToMillis(existing.startedAt) ||
        Number(existing.startedAtMs ?? 0);
      const isActive =
        startedAtMs > 0 && Date.now() - startedAtMs < ACTIVE_LOCK_WINDOW_MS;

      throw new HttpsError(
        isActive ? "already-exists" : "failed-precondition",
        isActive
          ? "La solicitud IQ ya se esta procesando."
          : "Existe un intento IQ interrumpido cuyo resultado no puede confirmarse. Revisa IQ y concilia el intento antes de volver a crear para evitar duplicados.",
      );
    }

    if (
      input.allowRejectedReplacement !== true &&
      existingStatus === "SUCCEEDED" &&
      existingFingerprint &&
      existingFingerprint !== input.fingerprint
    ) {
      throw new HttpsError(
        "failed-precondition",
        "La solicitud ya fue creada en IQ con otra configuracion.",
      );
    }

    // H4_D87_A57_A10_WRITE_ONCE_PER_ATTEMPT
    if (
      input.allowRejectedReplacement === true &&
      input.previousIqFolio &&
      input.previousOrderUploadId
    ) {
      const previousAttemptKey = crypto
        .createHash("sha256")
        .update(
          [
            input.solicitudId,
            input.previousIqFolio,
            input.previousOrderUploadId,
          ].join("|"),
        )
        .digest("hex");

      const previousAttemptRef = input.solicitudRef
        .collection("iqAttempts")
        .doc(previousAttemptKey);

      tx.set(
        previousAttemptRef,
        {
          version: "H4_D87_A57_A10_WRITE_ONCE_PER_ATTEMPT",
          solicitudFolio: input.solicitudFolio,
          iqFolio: input.previousIqFolio,
          orderUploadId: input.previousOrderUploadId,
          status: "REJECTED_TERMINAL",
          replacedByFingerprint: input.fingerprint,
          updatedAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    const attemptCount =
      Math.max(0, Number(existing.attemptCount ?? 0) || 0) + 1;
    const executionToken = crypto.randomUUID();
    const now = FieldValue.serverTimestamp();

    tx.set(
      creationRef,
      {
        rootId: input.auth.rootId,
        solicitudId: input.solicitudId,
        solicitudFolio: input.solicitudFolio || null,
        status: "PROCESSING",
        version: IQ_CREATION_VERSION,
        executionToken,
        fingerprint: input.fingerprint,
        attemptCount,
        profileId: input.profileId,
        profileAlias: input.profileAlias || null,
        orderUploadId: input.orderUploadId || null,
        orderStoragePath: input.orderStoragePath,
        orderFileName: input.orderFileName,
        amount: input.amount,
        invoiceType: input.invoiceType,
        requestedBy: input.auth.uid,
        requestedByRole: input.auth.role,
        startedAt: now,
        startedAtMs: Date.now(),
        finishedAt: FieldValue.delete(),
        durationMs: FieldValue.delete(),
        iqId: FieldValue.delete(),
        error: FieldValue.delete(),
        outcome: FieldValue.delete(),
        updatedAt: now,
        createdAt: creationSnap.exists ? (existing.createdAt ?? now) : now,
      },
      {
        merge: true,
      },
    );

    tx.set(
      input.solicitudRef,
      {
        iqCreationStatus: "PROCESSING",
        iqCreationAttemptCount: attemptCount,
        iqCreationStartedAt: now,
        iqCreationStartedBy: input.auth.uid,
        iqCredentialProfileId: input.profileId,
        iqCreationFingerprint: input.fingerprint,
        iqSyncUpdatedAt: now,
      },
      {
        merge: true,
      },
    );

    return {
      reused: false,
      executionToken,
      attemptCount,
      fingerprint: input.fingerprint,
      iqId: "",
    };
  });
}

async function finalizeIqCreation(input: {
  auth: AuthContext;
  solicitudRef: DocumentReference;
  solicitudId: string;
  solicitudFolio: string;
  executionToken: string;
  attemptCount: number;
  fingerprint: string;
  profileId: string;
  profileAlias: string;
  status: IqCreationFinalStatus;
  outcome: string;
  iqId: string;
  durationMs: number;
  submitted: boolean;
  resultPath: string;
  responseMessage: string;
  error: string;
}): Promise<void> {
  const creationRef = db
    .collection("iqSolicitudCreations")
    .doc(input.solicitudId);
  const noteRef = input.solicitudRef.collection("notas").doc("iq-folio");
  const now = FieldValue.serverTimestamp();

  await db.runTransaction(async (tx: Transaction) => {
    const [creationSnap, solicitudSnap] = await Promise.all([
      tx.get(creationRef),
      tx.get(input.solicitudRef),
    ]);
    const current = creationSnap.exists ? asRecord(creationSnap.data()) : {};
    const currentSolicitud = solicitudSnap.exists
      ? asRecord(solicitudSnap.data())
      : {};

    if (cleanText(current.executionToken) !== input.executionToken) {
      throw new HttpsError(
        "aborted",
        "La ejecucion IQ fue reemplazada por otro intento.",
      );
    }

    tx.set(
      creationRef,
      {
        status: input.status,
        outcome: input.outcome,
        iqId: input.iqId || null,
        submitClicked: input.submitted,
        resultPath: input.resultPath || null,
        responseMessage: input.responseMessage || null,
        error: input.error || null,
        durationMs: input.durationMs,
        finishedAt: now,
        updatedAt: now,
      },
      {
        merge: true,
      },
    );

    const solicitationPatch: Record<string, unknown> = {
      iqCreationStatus: input.status === "SUCCEEDED" ? "CREATED" : input.status,
      iqCreationAttemptCount: input.attemptCount,
      iqCreationFinishedAt: now,
      iqCreationDurationMs: input.durationMs,
      iqCreationOutcome: input.outcome,
      iqCreationLastError: input.error || null,
      iqCreationResponseMessage: input.responseMessage || null,
      iqCreationResultPath: input.resultPath || null,
      iqCreationSubmitClicked: input.submitted,
      iqCreationFingerprint: input.fingerprint,
      iqCredentialProfileId: input.profileId,
      iqSyncUpdatedAt: now,
    };

    if (input.status === "SUCCEEDED" && input.iqId) {
      solicitationPatch.iqId = input.iqId;
      solicitationPatch.iqFolio = input.iqId;
      solicitationPatch.iqCreatedAt = now;
      solicitationPatch.iqCreatedBy = input.auth.uid;
      solicitationPatch.iqSyncStatus = "CREATED";
      solicitationPatch.iqReconciliationStatus = "LINKED";
      solicitationPatch.iqInvoiceStatus = "WAITING";

      // INC_SOL_OC_REINTENTO_A15_RESET_CURRENT_REJECTION_STATE
      // El rechazo anterior permanece en iqAttempts + iqRejectedFolio/iqRejectedAt.
      // El nuevo folio pasa a ser el intento corriente en PROCESANDO.
      solicitationPatch.status = "PROCESANDO";
      solicitationPatch.iqOperationStatus = FieldValue.delete();
      solicitationPatch.iqStatus = FieldValue.delete();
      solicitationPatch.iqStatusMonitorStatus = FieldValue.delete();
      solicitationPatch.iqRejectionStatus = FieldValue.delete();
      solicitationPatch.iqRejectionReason = FieldValue.delete();
      solicitationPatch.iqCanResend = FieldValue.delete();
      solicitationPatch.iqNeedsOcCorrection = FieldValue.delete();
      solicitationPatch.iqLastOperationStatus = FieldValue.delete();
      solicitationPatch.iqLastRejectionComment = FieldValue.delete();
      solicitationPatch.iqLastRowText = FieldValue.delete();
      solicitationPatch.iqStatusUpdatedAt = FieldValue.delete();
      solicitationPatch.iqSync = {
        ...asRecord(currentSolicitud.iqSync),
        status: "CREATED",
        creationVersion: IQ_CREATION_VERSION,
        iqId: input.iqId,
        createdAt: now,
        createdBy: input.auth.uid,
        profileId: input.profileId,
        profileAlias: input.profileAlias || null,
        attemptCount: input.attemptCount,
        durationMs: input.durationMs,

        // H4_D87_A57_A29_CLEAR_LEGACY_PREVALIDATION_RESIDUE
        version: FieldValue.delete(),
        ready: FieldValue.delete(),
        errors: FieldValue.delete(),
        prevalidatedAt: FieldValue.delete(),
        requestedBy: FieldValue.delete(),
        clientMatchStrategy: FieldValue.delete(),
        companyMatchStrategy: FieldValue.delete(),
        orderExists: FieldValue.delete(),

        formPreparationVersion: FieldValue.delete(),
        formPreparedAt: FieldValue.delete(),
        formPreparedBy: FieldValue.delete(),
        formVerified: FieldValue.delete(),
        formFinalPath: FieldValue.delete(),
        associatedMatched: FieldValue.delete(),
        clientMatched: FieldValue.delete(),
        companyMatched: FieldValue.delete(),
        formError: FieldValue.delete(),
      };

      tx.set(
        noteRef,
        {
          rootId: input.auth.rootId,
          createdBy: input.auth.uid,
          createdByName: getActorName(input.auth),
          createdByRole: input.auth.role,
          source: "IQ",
          text: `FOLIO IQ: ${input.iqId}`,
          createdAt: now,
          updatedAt: now,
        },
        {
          merge: true,
        },
      );

      solicitationPatch.hasUnreadMsg = true;
    } else if (input.status === "OUTCOME_UNKNOWN") {
      solicitationPatch.iqReconciliationStatus = "PENDING";
      solicitationPatch.iqReconciliationAttemptCount = 0;
      solicitationPatch.iqReconciliationNextCheckAt = null;
    }

    tx.set(input.solicitudRef, solicitationPatch, {
      merge: true,
    });

    const attemptRef = input.solicitudRef
      .collection("iqAttempts")
      .doc(input.fingerprint);

    tx.set(
      attemptRef,
      {
        version: "H4_D87_A57_A10_WRITE_ONCE_PER_ATTEMPT",
        solicitudFolio: input.solicitudFolio,
        fingerprint: input.fingerprint,
        profileId: input.profileId,
        profileAlias: input.profileAlias || null,
        orderUploadId: cleanText(current.orderUploadId) || null,
        orderStoragePath: cleanText(current.orderStoragePath) || null,
        orderFileName: cleanText(current.orderFileName) || null,
        amount: Number(current.amount ?? 0) || null,
        invoiceType: cleanText(current.invoiceType) || null,
        marker: cleanText(current.marker) || null,
        status:
          input.status === "SUCCEEDED" && input.iqId
            ? "CREATED_CONFIRMED"
            : input.submitted
              ? "CREATED_PENDING_FOLIO"
              : "FAILED_SAFE",
        iqFolio: input.iqId || null,
        submitClicked: input.submitted,
        outcome: input.outcome,
        error: input.error || null,
        responseMessage: input.responseMessage || null,
        updatedAt: now,
        createdAt: now,
      },
      { merge: true },
    );
  });
}

async function publishIqNotification(input: {
  auth: AuthContext;
  event: string;
  status: string;
  solicitudId: string;
  solicitudFolio: string;
  iqId: string;
  profileId: string;
  profileAlias: string;
  attemptCount: number;
  durationMs: number;
  message: string;
}): Promise<void> {
  const notificationRef = db.collection("iqIntegrationNotifications").doc();
  const now = FieldValue.serverTimestamp();

  await notificationRef.set({
    rootId: input.auth.rootId,
    audienceRole: "superadmin",
    event: input.event,
    module: "iq",
    status: input.status,
    solicitudId: input.solicitudId,
    solicitudFolio: input.solicitudFolio || null,
    iqId: input.iqId || null,
    profileId: input.profileId,
    profileAlias: input.profileAlias || null,
    attemptCount: input.attemptCount,
    durationMs: input.durationMs,
    message: input.message,
    channels: ["in_app", "telegram"],
    inAppStatus: "READY",
    telegramStatus: "PENDING",
    read: false,
    createdAt: now,
    updatedAt: now,
  });

  try {
    const linkedSnap = await db
      .collection("telegramUsers")
      .where("uid", "==", input.auth.rootId)
      .where("active", "==", true)
      .limit(5)
      .get();

    if (linkedSnap.empty) {
      await notificationRef.set(
        {
          telegramStatus: "SKIPPED_NOT_LINKED",
          updatedAt: FieldValue.serverTimestamp(),
        },
        {
          merge: true,
        },
      );
      return;
    }

    const text = [
      input.status === "SUCCEEDED"
        ? "PAY0 / IQ solicitud creada"
        : input.status === "OUTCOME_UNKNOWN"
          ? "PAY0 / IQ resultado incierto"
          : "PAY0 / IQ creacion fallida",
      "",
      `Solicitud PAY0: ${input.solicitudFolio || input.solicitudId}`,
      input.iqId ? `FOLIO IQ: ${input.iqId}` : "FOLIO IQ: no identificado",
      `Cuenta IQ: ${input.profileAlias || input.profileId}`,
      `Intento: ${input.attemptCount}`,
      `Duracion: ${input.durationMs} ms`,
      "",
      input.message,
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 3900);

    let sentCount = 0;

    for (const doc of linkedSnap.docs) {
      const linked = asRecord(doc.data());
      const chatId = cleanText(linked.chatId);

      if (!chatId) {
        continue;
      }

      await sendTelegramMessage(TELEGRAM_BOT_TOKEN.value(), chatId, text);
      sentCount += 1;
    }

    await notificationRef.set(
      {
        telegramStatus: sentCount > 0 ? "SENT" : "SKIPPED_NO_CHAT",
        telegramSentCount: sentCount,
        telegramSentAt: sentCount > 0 ? FieldValue.serverTimestamp() : null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      {
        merge: true,
      },
    );
  } catch (error) {
    await notificationRef
      .set(
        {
          telegramStatus: "ERROR",
          telegramError: safeErrorMessage(error),
          updatedAt: FieldValue.serverTimestamp(),
        },
        {
          merge: true,
        },
      )
      .catch(() => undefined);
  }
}

function solicitudIqTerminalTextH4D87A57A10(
  solicitud: Record<string, unknown>,
  creation?: Record<string, unknown>,
): string {
  return [
    solicitud.status,
    solicitud.estado,
    solicitud.iqStatus,
    solicitud.iqOperationStatus,
    solicitud.iqReconciliationStatus,
    solicitud.iqTerminalStatus,
    solicitud.iqPreviousTerminalStatus,
    solicitud.iqTerminalOutcome,
    creation?.operationStatus,
  ]
    .map((value) => cleanText(value))
    .join(" ")
    .toUpperCase();
}

function isSolicitudIqCancelledForCreateH4D87A57A10(
  solicitud: Record<string, unknown>,
  creation?: Record<string, unknown>,
): boolean {
  const text = solicitudIqTerminalTextH4D87A57A10(solicitud, creation);
  return text.includes("CANCEL");
}

function isSolicitudIqRejectedForCreateH4D87A57A10(
  solicitud: Record<string, unknown>,
  creation?: Record<string, unknown>,
): boolean {
  // INC_SOL_OC_REINTENTO_A6_EXPLICIT_REJECTION_EVIDENCE
  // Al desbloquear por una OC nueva, PAY0 puede limpiar los textos terminales
  // actuales, pero conserva evidencia historica explicita del rechazo.
  if (solicitud.iqRejected === true) return true;
  if (cleanText(solicitud.iqRejectedAt)) return true;

  const text = solicitudIqTerminalTextH4D87A57A10(solicitud, creation);
  return text.includes("RECHAZ") || text.includes("REJECT");
}

function isSolicitudIqTerminalLockedForCreateH4D58H(
  solicitud: Record<string, unknown>,
): boolean {
  if (solicitud.iqTerminalLocked === true) return true;
  if (solicitud.iqSolicitudTerminalLocked === true) return true;

  return (
    isSolicitudIqRejectedForCreateH4D87A57A10(solicitud) ||
    isSolicitudIqCancelledForCreateH4D87A57A10(solicitud)
  );
}
// H4_D58H_B1_SOLICITUD_CREATE_GUARD_HELPER
export const createSolicitudIq = onCall(
  {
    cors: true,
    secrets: [IQ_CREDENTIALS_KEY, TELEGRAM_BOT_TOKEN],
    invoker: "public",
    timeoutSeconds: 300,
    memory: "2GiB",
    concurrency: 1,
  },
  async (request) => {
    const perfStartedAtMs = Date.now();
    let perfLastMarkMs = perfStartedAtMs;
    const perfStages: Record<string, number> = {};

    const markPerf = (stage: string): void => {
      const nowMs = Date.now();
      perfStages[stage] = nowMs - perfLastMarkMs;
      perfLastMarkMs = nowMs;
    };

    const authorizedProfile = await assertIqAuthorized(request, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "solicitudes", requiredAction: "create" });
    markPerf("authorization");
    const auth = getAuthContext(request, authorizedProfile);
    markPerf("auth_context");

    if (!canCreateSolicitudes(auth)) {
      throw new HttpsError(
        "permission-denied",
        "No autorizado para crear solicitudes IQ.",
      );
    }

    const requestData = asRecord(request.data);
    const solicitudId = cleanText(requestData.solicitudId);

    if (!solicitudId) {
      throw new HttpsError("invalid-argument", "solicitudId es obligatorio.");
    }

    const solicitudRef = db.collection("solicitudes").doc(solicitudId);
    const solicitudSnap = await solicitudRef.get();
    markPerf("solicitud_read");

    if (!solicitudSnap.exists) {
      throw new HttpsError("not-found", "Solicitud PAY0 no encontrada.");
    }

    const solicitud = asRecord(solicitudSnap.data());
    const solicitudRootId = cleanText(
      solicitud.rootId ?? solicitud.ownerRootId,
    );

    if (solicitudRootId && solicitudRootId !== auth.rootId) {
      throw new HttpsError(
        "permission-denied",
        "Solicitud fuera del scope autorizado.",
      );
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

    const iqSync = asRecord(solicitud.iqSync);
    const previousCreationSnapH4D87A57A10 = await db
      .collection("iqSolicitudCreations")
      .doc(solicitudId)
      .get();
    const previousCreationH4D87A57A10 =
      previousCreationSnapH4D87A57A10.exists
        ? asRecord(previousCreationSnapH4D87A57A10.data())
        : {};

    // INC_SOL_OC_REINTENTO_A1_R2_CANONICAL_UNLOCK_FIELDS
    const previousIqFolioH4D87A57A10 = cleanText(
      solicitud.iqFolio ??
      solicitud.iqId ??
      solicitud.solicitudIqFolio ??
      solicitud.folioIq ??
      solicitud.iqPreviousTerminalIqId,
    );
    const previousOrderUploadIdH4D87A57A10 = cleanText(
      previousCreationH4D87A57A10.previousOrderUploadId ??
        previousCreationH4D87A57A10.orderUploadId,
    );
    // INC_SOL_OC_REINTENTO_A11_RESOLVE_ACTIVE_ORDER_UPLOAD
    // El puntero de desbloqueo puede quedar obsoleto cuando la OC se reemplaza.
    // Resolvemos siempre la OC ACTIVA vigente de esta solicitud antes del gate.
    let currentOrderUploadIdH4D87A57A10 = cleanText(
      solicitud.iqTerminalUnlockUploadId ??
        solicitud.iqPreviousTerminalUnlockedByUploadId ??
        solicitud.iqOrderUploadId ??
        iqSync.orderUploadId,
    );

    let currentOrderUploadH4D87A57A10: Record<string, unknown> = {};

    if (currentOrderUploadIdH4D87A57A10) {
      const pointedOrderSnapH4D87A57A10 = await db
        .collection("uploads")
        .doc(currentOrderUploadIdH4D87A57A10)
        .get();

      if (pointedOrderSnapH4D87A57A10.exists) {
        const pointedOrderH4D87A57A10 = asRecord(
          pointedOrderSnapH4D87A57A10.data(),
        );
        const pointedStatusH4D87A57A10 = cleanText(
          pointedOrderH4D87A57A10.status,
        ).toUpperCase();

        if (
          cleanText(pointedOrderH4D87A57A10.rootId) === auth.rootId &&
          cleanText(
            pointedOrderH4D87A57A10.solicitudId ??
              pointedOrderH4D87A57A10.entityId,
          ) === solicitudId &&
          cleanText(
            pointedOrderH4D87A57A10.documentType,
          ).toUpperCase() === "ORDEN_COMPRA" &&
          pointedOrderH4D87A57A10.active === true &&
          pointedStatusH4D87A57A10 !== "REPLACED" &&
          pointedStatusH4D87A57A10 !== "INACTIVE"
        ) {
          currentOrderUploadH4D87A57A10 =
            pointedOrderH4D87A57A10;
        }
      }
    }

    if (
      Object.keys(currentOrderUploadH4D87A57A10).length === 0
    ) {
      const orderUploadsSnapH4D87A57A10 = await db
        .collection("uploads")
        .where("solicitudId", "==", solicitudId)
        .get();

      const activeOrderCandidatesH4D87A57A10 =
        orderUploadsSnapH4D87A57A10.docs
          .map((doc) => ({
            id: doc.id,
            data: asRecord(doc.data()),
          }))
          .filter(({ data }) => {
            const status = cleanText(data.status).toUpperCase();
            return (
              cleanText(data.rootId) === auth.rootId &&
              cleanText(data.entityType).toLowerCase() === "solicitudes" &&
              cleanText(data.documentType).toUpperCase() ===
                "ORDEN_COMPRA" &&
              data.active === true &&
              status !== "REPLACED" &&
              status !== "INACTIVE"
            );
          })
          .sort((a, b) => {
            const versionA = Number(a.data.version ?? 0);
            const versionB = Number(b.data.version ?? 0);
            if (versionA !== versionB) return versionB - versionA;

            const createdA = Number(
              asRecord(a.data.createdAt).seconds ?? 0,
            );
            const createdB = Number(
              asRecord(b.data.createdAt).seconds ?? 0,
            );
            return createdB - createdA;
          });

      const activeOrderH4D87A57A10 =
        activeOrderCandidatesH4D87A57A10[0];

      if (activeOrderH4D87A57A10) {
        currentOrderUploadIdH4D87A57A10 =
          activeOrderH4D87A57A10.id;
        currentOrderUploadH4D87A57A10 =
          activeOrderH4D87A57A10.data;
      }
    }

    markPerf("previous_creation_and_order_resolution");

    const previousCancelledH4D87A57A10 =
      isSolicitudIqCancelledForCreateH4D87A57A10(
        solicitud,
        previousCreationH4D87A57A10,
      );
    const previousRejectedH4D87A57A10 =
      isSolicitudIqRejectedForCreateH4D87A57A10(
        solicitud,
        previousCreationH4D87A57A10,
      );

    const validRejectedReplacementH4D87A57A10 =
      !previousCancelledH4D87A57A10 &&
      previousRejectedH4D87A57A10 &&
      Boolean(previousIqFolioH4D87A57A10) &&
      Boolean(previousOrderUploadIdH4D87A57A10) &&
      Boolean(currentOrderUploadIdH4D87A57A10) &&
      currentOrderUploadIdH4D87A57A10 !==
        previousOrderUploadIdH4D87A57A10;

    if (
      previousCancelledH4D87A57A10 ||
      (
        isSolicitudIqTerminalLockedForCreateH4D58H(solicitud) &&
        !validRejectedReplacementH4D87A57A10
      )
    ) {
      throw new HttpsError(
        "failed-precondition",
        previousCancelledH4D87A57A10
          ? "El folio IQ cancelado es terminal y no admite un nuevo intento."
          : "Solicitud IQ rechazada. Se requiere una OC nueva para generar un folio IQ nuevo.",
      );
    }
    // H4_D87_A57_A10_WRITE_ONCE_PER_ATTEMPT_GATE
    const solicitudFolio = cleanText(
      solicitud.folio ?? solicitud.folioSolicitud ?? solicitudId,
    );
    const despachoId = cleanText(
      solicitud.despachoId ??
        solicitud.dispatchId ??
        iqSync.despachoId,
    );

    const [despachoAccessOk, accessSnap] = await Promise.all([
      verifyDespachoAccess(auth.uid, despachoId),
      db
        .collection("iqUserAccess")
        .doc(operationalOwnerId)
        .get(),
    ]);
    markPerf("despacho_and_iq_user_access");

    if (!despachoAccessOk) {
      throw new HttpsError(
        "permission-denied",
        "El usuario ya no tiene habilitado el despacho de la solicitud.",
      );
    }

    const access = asRecord(accessSnap.data());

    if (
      !accessSnap.exists ||
      access.active !== true ||
      access.iqEnabled !== true
    ) {
      throw new HttpsError(
        "failed-precondition",
        "El usuario no tiene acceso IQ activo.",
      );
    }

    const profileId = cleanText(access.iqCredentialProfileId);

    if (!profileId) {
      throw new HttpsError(
        "failed-precondition",
        "La cuenta IQ asignada cambio. Ejecuta nuevamente la prevalidacion.",
      );
    }

    const profileSnap = await db
      .collection("iqCredentialProfiles")
      .doc(profileId)
      .get();

    if (!profileSnap.exists) {
      throw new HttpsError(
        "failed-precondition",
        "La cuenta IQ asignada no existe.",
      );
    }

    markPerf("iq_profile_read");
    const profile = asRecord(profileSnap.data());

    if (
      cleanText(profile.rootId) !== auth.rootId ||
      profile.active !== true ||
      profile.hasPassword !== true
    ) {
      throw new HttpsError(
        "failed-precondition",
        "La cuenta IQ asignada esta inactiva o fuera de scope.",
      );
    }

    const username = cleanText(profile.username);
    const profileAlias = cleanText(profile.alias);
    const erpUrl = normalizeErpUrl(cleanText(profile.erpUrl));
    const associatedName = username;

    const pay0ClientId = cleanText(
      solicitud.clienteId ??
        solicitud.clientId,
    );

    const pay0CompanyId = cleanText(
      solicitud.companyId ??
        solicitud.empresaId,
    );

    if (!pay0ClientId || !pay0CompanyId) {
      throw new HttpsError(
        "failed-precondition",
        "La solicitud no conserva Cliente o Empresa canonicos.",
      );
    }

    const [clientSnap, companySnap] = await Promise.all([
      db.collection("clients").doc(pay0ClientId).get(),
      db.collection("companies").doc(pay0CompanyId).get(),
    ]);

    markPerf("client_company_read");

    if (!clientSnap.exists || !companySnap.exists) {
      throw new HttpsError(
        "failed-precondition",
        "El Cliente o la Empresa canonicos ya no existen.",
      );
    }

    const client = asRecord(clientSnap.data());
    const company = asRecord(companySnap.data());
    const clientIqLink = asRecord(client.iqLink);

    const clientName =
      cleanText(
        client.iqClientName ??
          clientIqLink.clientName ??
          client.name ??
          client.nombre ??
          solicitud.clienteNombre ??
          solicitud.clientName,
      );

    const iqClientId = cleanText(
      clientIqLink.clientId ??
        client.iqClientId,
    );

    const companyName =
      cleanText(
        company.name ??
          company.nombre ??
          company.razonSocial ??
          solicitud.empresaNombre ??
          solicitud.companyName,
      );

    const invoiceType = cleanText(
      solicitud.tipoFactura ??
        solicitud.invoiceType ??
        iqSync.invoiceType,
    ).toUpperCase();

    const amount = Number(
      solicitud.monto ??
        solicitud.amount ??
        iqSync.amount,
    );

    // INC_SOL_OC_REINTENTO_A3_ACTIVE_UNLOCK_UPLOAD
    // A11 reutiliza la OC activa ya resuelta antes del gate.
    const unlockOrderUploadId =
      currentOrderUploadIdH4D87A57A10;
    const unlockOrderUpload =
      currentOrderUploadH4D87A57A10;

    if (!unlockOrderUploadId) {
      throw new HttpsError(
        "failed-precondition",
        "Se requiere una Orden de Compra activa nueva para generar un folio IQ nuevo.",
      );
    }

    if (
      Object.keys(unlockOrderUpload).length === 0
    ) {
      throw new HttpsError(
        "failed-precondition",
        "La nueva Orden de Compra del reintento no es un documento activo valido.",
      );
    }

    const orderUploadId = cleanText(unlockOrderUploadId);

    const orderStoragePath = cleanText(
      unlockOrderUpload.storagePath,
    );

    const orderFileName = cleanText(
      unlockOrderUpload.filename ??
        unlockOrderUpload.originalName,
    );

    if (
      !username ||
      !associatedName ||
      !clientName ||
      !iqClientId ||
      !companyName ||
      !["PUE", "PPD"].includes(invoiceType) ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !orderUploadId ||
      !orderStoragePath ||
      !orderFileName
    ) {
      throw new HttpsError(
        "failed-precondition",
        "La solicitud PAY0 no tiene completos los datos canonicos requeridos para IQ.",
      );
    }

    const orderFile = admin.storage().bucket().file(orderStoragePath);
    const existsResult = await orderFile.exists();

    markPerf("order_storage_exists");

    if (existsResult[0] !== true) {
      throw new HttpsError(
        "failed-precondition",
        "La Orden de Compra ya no existe en Storage.",
      );
    }

    const fingerprint = buildFingerprint({
      solicitudId,
      profileId,
      orderUploadId,
      orderStoragePath,
      amount,
      invoiceType,
    });

    const reservation = await reserveIqCreation({
      auth,
      solicitudRef,
      solicitudId,
      solicitudFolio,
      profileId,
      profileAlias,
      orderUploadId,
      orderStoragePath,
      orderFileName,
      amount,
      invoiceType,
      fingerprint,
      allowRejectedReplacement:
        validRejectedReplacementH4D87A57A10,
      previousIqFolio:
        previousIqFolioH4D87A57A10,
      previousOrderUploadId:
        previousOrderUploadIdH4D87A57A10,
    });

    markPerf("creation_reservation");

    if (reservation.reused) {
      await safeLogIqActivity(solicitudId, {
        event: "IQ_SOLICITUD_CREACION_REUTILIZADA",
        rootId: auth.rootId,
        adminId: auth.rootId,
        actorUid: auth.uid,
        actorName: getActorName(auth),
        actorUsername: getActorName(auth),
        actorRole: auth.role,
        referenceId: solicitudId,
        referenceFolio: solicitudFolio,
        referenceType: "solicitud",
        entityId: solicitudId,
        entityType: "solicitud",
        amount,
        description: `Solicitud IQ ya creada ${solicitudFolio} - FOLIO IQ: ${reservation.iqId}`,
        extra: {
          iqId: reservation.iqId,
          iqProfileId: profileId,
          iqProfileAlias: profileAlias || null,
          attemptCount: reservation.attemptCount,
          idempotent: true,
          fingerprint: reservation.fingerprint,
        },
      });

      return {
        ok: true,
        data: {
          solicitudId,
          solicitudFolio,
          status: "CREATED",
          created: true,
          reused: true,
          iqId: reservation.iqId,
          attemptCount: reservation.attemptCount,
          durationMs: 0,
          submitClicked: false,
          outcome: "IDEMPOTENT_REUSE",
          retryBlocked: true,
        },
        message: `La solicitud ya existe en IQ. FOLIO IQ: ${reservation.iqId}`,
      };
    }

    const preCreationMs = Date.now() - perfStartedAtMs;
    const startedAtMs = Date.now();
    const iqTimeZone = await loadIqTimeZone(auth.rootId);
    markPerf("iq_timezone");
    const targetDateIso = dateIsoInTimeZone(new Date(startedAtMs), iqTimeZone);

    await safeLogIqActivity(solicitudId, {
      event: "IQ_SOLICITUD_CREACION_INICIADA",
      rootId: auth.rootId,
      adminId: auth.rootId,
      actorUid: auth.uid,
      actorName: getActorName(auth),
      actorUsername: getActorName(auth),
      actorRole: auth.role,
      referenceId: solicitudId,
      referenceFolio: solicitudFolio,
      referenceType: "solicitud",
      entityId: solicitudId,
      entityType: "solicitud",
      amount,
      description: `Inicio creacion IQ para solicitud ${solicitudFolio}`,
      extra: {
        attemptCount: reservation.attemptCount,
        iqProfileId: profileId,
        iqProfileAlias: profileAlias || null,
        fingerprint,
        startedAtMs,
        targetDateIso,
        iqTimeZone,
        orderUploadId: orderUploadId || null,
        orderFileName,
      },
    });

    markPerf("initial_activity_log");

    let temporaryDirectory = "";
    let temporaryFilePath = "";
    let password = "";
    let browserResult: Awaited<
      ReturnType<typeof runIqCreateInvoiceHttpA53>
    > | null = null;
    let executionError = "";
    const creationComment = [
      "PAY0",
      solicitudFolio || solicitudId,
      `IQ-${reservation.executionToken.slice(0, 8)}`,
    ].join(" ");

    await Promise.all([
      db.collection("iqSolicitudCreations").doc(solicitudId).set(
        {
          marker: creationComment,
          targetDateIso,
          iqTimeZone,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      ),
      solicitudRef.set(
        {
          iqReconciliationMarker: creationComment,
          iqTargetDateIso: targetDateIso,
          iqTimeZone,
          iqSyncUpdatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      ),
    ]);

    try {
      markPerf("marker_writes");
      temporaryDirectory = await mkdtemp(
        path.join(os.tmpdir(), "pay0-iq-create-"),
      );
      markPerf("temp_directory");
      temporaryFilePath = path.join(
        temporaryDirectory,
        safeTemporaryFileName(orderFileName),
      );

      await orderFile.download({
        destination: temporaryFilePath,
      });

      markPerf("order_download");
      password = decryptSecret(profile);
      markPerf("credential_decrypt");

      browserResult = await runIqCreateInvoiceHttpA53({
        erpUrl,
        username,
        password,
        associatedName,
        clientName,
        iqClientId,
        companyName,
        invoiceType: invoiceType as "PUE" | "PPD",
        amount,
        orderFilePath: temporaryFilePath,
        orderFileName,
        comments: creationComment,
        targetDateIso,
        timeZone: iqTimeZone,
      });
      markPerf("a53_http_create");
    } catch (error) {
      markPerf("a53_http_create_error");
      executionError = safeErrorMessage(error);
    } finally {
      password = "";

      if (temporaryDirectory) {
        await rm(temporaryDirectory, {
          recursive: true,
          force: true,
        }).catch(() => undefined);
      }
    }

    markPerf("cleanup");

    const perfToCleanupMs = Date.now() - perfStartedAtMs;

    console.info(
      "PAY0_IQ_SOLICITUD_CREATE_PERF",
      JSON.stringify({
        solicitudId,
        preCreationMs,
        perfToCleanupMs,
        stages: perfStages,
      }),
    );

    const durationMs = Math.max(0, Date.now() - startedAtMs);
    const submitClicked = browserResult?.submitClicked === true;
    const outcome = cleanText(
      browserResult?.outcome || (executionError ? "FAILED_RETRYABLE" : "UNKNOWN"),
    ).toUpperCase();
    const iqId = cleanText(browserResult?.iqId);
    const resultPath = cleanText(
      browserResult?.resultPath ?? browserResult?.finalPath,
    );
    const responseMessage = cleanText(
      browserResult?.responseMessage ?? browserResult?.message,
    );
    const combinedError = cleanText(
      executionError || browserResult?.errors.join(" ") || "",
    );

    const httpContractCaptureA53 = browserResult?.httpContractCapture ?? null;
    if (httpContractCaptureA53) {
      await Promise.all([
        db.collection("iqSolicitudCreations").doc(solicitudId).set(
          {
            iqHttpCreateContractA53: httpContractCaptureA53,
            iqHttpCreateContractCapturedAtA53: FieldValue.serverTimestamp(),
          },
          { merge: true },
        ),
        solicitudRef.set(
          {
            iqHttpCreateContractA53: httpContractCaptureA53,
            iqHttpCreateContractCapturedAtA53: FieldValue.serverTimestamp(),
          },
          { merge: true },
        ),
      ]);
    }

    let finalStatus: IqCreationFinalStatus;
    let event: string;
    let retryBlocked: boolean;

    if (outcome === "CREATED" && iqId) {
      finalStatus = "SUCCEEDED";
      event = "IQ_SOLICITUD_CREACION_EXITOSA";
      retryBlocked = true;
    } else if (
      outcome === "CREATED_ID_MISSING" ||
      outcome === "UNKNOWN" ||
      (submitClicked && executionError)
    ) {
      finalStatus = "OUTCOME_UNKNOWN";
      event = "IQ_SOLICITUD_RESULTADO_INCIERTO";
      retryBlocked = true;
    } else {
      finalStatus = "FAILED_RETRYABLE";
      event = "IQ_SOLICITUD_CREACION_FALLIDA";
      retryBlocked = false;
    }

    const finalizeStartedAtMs = Date.now();
    await finalizeIqCreation({
      auth,
      solicitudRef,
      solicitudId,
      solicitudFolio,
      executionToken: reservation.executionToken,
      attemptCount: reservation.attemptCount,
      fingerprint,
      profileId,
      profileAlias,
      status: finalStatus,
      outcome,
      iqId,
      durationMs,
      submitted: submitClicked,
      resultPath,
      responseMessage,
      error: combinedError,
    });
    const finalizeMs = Date.now() - finalizeStartedAtMs;

    if (finalStatus === "OUTCOME_UNKNOWN") {
      const reconciliationEnqueueStartedAtMs = Date.now();
      await enqueueIqReconciliationJob({
        solicitudId,
        solicitudFolio,
        rootId: auth.rootId,
        profileId,
        profileAlias,
        marker: creationComment,
        amount,
        targetDateIso,
        requestedBy: auth.uid,
        reason: "CREATION_OUTCOME_UNKNOWN",
        nextRunAt: new Date(Date.now() + 2 * 60 * 1000),
      }).catch(() => undefined);
      console.info("PAY0_IQ_SOLICITUD_RECONCILIATION_ENQUEUE_PERF", Date.now() - reconciliationEnqueueStartedAtMs);
    }

    const activityDescription =
      finalStatus === "SUCCEEDED"
        ? `Solicitud ${solicitudFolio} creada en IQ. FOLIO IQ: ${iqId}`
        : finalStatus === "OUTCOME_UNKNOWN"
          ? `Resultado IQ incierto para solicitud ${solicitudFolio}. Reintento bloqueado.`
          : `No se creo la solicitud ${solicitudFolio} en IQ.`;

    const postSideEffectsStartedAtMs = Date.now();
    await Promise.all([
      safeLogIqActivity(solicitudId, {
        event,
        rootId: auth.rootId,
        adminId: auth.rootId,
        actorUid: auth.uid,
        actorName: getActorName(auth),
        actorUsername: getActorName(auth),
        actorRole: auth.role,
        referenceId: solicitudId,
        referenceFolio: solicitudFolio,
        referenceType: "solicitud",
        entityId: solicitudId,
        entityType: "solicitud",
        amount,
        description: activityDescription,
        extra: {
          startedAtMs,
          targetDateIso,
          iqTimeZone,
          finishedAtMs: Date.now(),
          durationMs,
          attemptCount: reservation.attemptCount,
          outcome,
          status: finalStatus,
          iqId: iqId || null,
          iqProfileId: profileId,
          iqProfileAlias: profileAlias || null,
          submitClicked,
          retryBlocked,
          resultPath: resultPath || null,
          responseMessage: responseMessage || null,
          error: combinedError || null,
          fingerprint,
        },
      }),
  
      publishIqNotification({
        auth,
        event,
        status: finalStatus,
        solicitudId,
        solicitudFolio,
        iqId,
        profileId,
        profileAlias,
        attemptCount: reservation.attemptCount,
        durationMs,
        message: responseMessage || combinedError || activityDescription,
      }).catch(() => undefined),
    ]);
    const postSideEffectsMs = Date.now() - postSideEffectsStartedAtMs;

    console.info(
      "PAY0_IQ_SOLICITUD_POST_PERF",
      JSON.stringify({
        solicitudId,
        finalizeMs,
        postSideEffectsMs,
      }),
    );

    return {
      ok: true,
      data: {
        solicitudId,
        solicitudFolio,
        status: finalStatus === "SUCCEEDED" ? "CREATED" : finalStatus,
        created: finalStatus === "SUCCEEDED",
        reused: false,
        iqId: iqId || null,
        attemptCount: reservation.attemptCount,
        durationMs,
        submitClicked,
        outcome,
        retryBlocked,
        resultPath: resultPath || null,
        responseMessage: responseMessage || null,
        errors: browserResult?.errors ?? (combinedError ? [combinedError] : []),
      },
      message:
        finalStatus === "SUCCEEDED"
          ? `Solicitud creada en IQ. FOLIO IQ: ${iqId}`
          : finalStatus === "OUTCOME_UNKNOWN"
            ? "IQ recibio la operacion, pero el resultado no fue concluyente. El reintento quedo bloqueado para evitar duplicados."
            : responseMessage ||
              combinedError ||
              "IQ rechazo la creacion de la solicitud.",
    };
  },
);
