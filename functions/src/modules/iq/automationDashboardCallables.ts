import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertIqAuthorized } from "./authorization";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const ACTIVE_INVOICE_STATUSES = new Set([
  "QUEUED",
  "WAITING",
  "WAITING_FOR_OPERATING_WINDOW",
  "ERROR_RETRYABLE",
  "RUNNING",
  "PROCESSING",
  "NOT_FOUND",
]);

const ACTIVE_CREATE_STATUSES = new Set([
  "QUEUED",
  "RUNNING",
  "PROCESSING",
  "PENDING_RECONCILIATION",
  "ERROR_RETRYABLE",
]);

const ACTIVE_STATUS_STATUSES = new Set([
  "QUEUED",
  "RUNNING",
  "WAITING",
  "WAITING_FOR_OPERATING_WINDOW",
  "ERROR_RETRYABLE",
]);

// IQ2G_H4_D57B_PAGO_ACTIVE_STATUSES
const ACTIVE_PAGO_RECEIPT_STATUSES = new Set([
  "QUEUED",
  "WAITING",
  "WAITING_FOR_OPERATING_WINDOW",
  "RUNNING",
  "PROCESSING",
  "ERROR_RETRYABLE",
  "PENDING_RECONCILIATION",
]);

const ACTIVE_PAGO_DEPOSIT_STATUS_STATUSES = new Set([
  "QUEUED",
  "WAITING",
  "WAITING_FOR_OPERATING_WINDOW",
  "RUNNING",
  "PROCESSING",
  "ERROR_RETRYABLE",
  "PENDING_RECONCILIATION",
]);

type AuthContext = {
  uid: string;
  role: string;
  rootId: string;
};

type JobRow = {
  id: string;
  status: string;
  solicitudId: string | null;
  pagoId: string | null;
  folio: string | null;
  iqFolio: string | null;
  profileId: string | null;
  profileAlias: string | null;
  attempts: number;
  nextRunAt: string | null;
  updatedAt: string | null;
  createdAt: string | null;
  error: string | null;
};

type QueueRunRow = {
  id: string;
  type: string | null;
  version: string | null;
  createdAt: string | null;
  summary: Record<string, unknown>;
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
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function isoOrNull(value: unknown): string | null {
  const ms = timestampMillis(value);
  if (!ms) return null;
  try {
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

function statusKey(value: unknown): string {
  return cleanText(value || "UNKNOWN").toUpperCase() || "UNKNOWN";
}

function increment(target: Record<string, number>, key: string): void {
  target[key] = (target[key] || 0) + 1;
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
  const rootId = cleanText(token.rootId ?? token.root_id ?? user.rootId ?? uid) || uid;

  return { uid, role, rootId };
}

function assertSuperAdmin(auth: AuthContext): void {
  if (auth.role !== "superadmin") {
    throw new HttpsError("permission-denied", "Solo Super Admin puede consultar diagnostico IQ.");
  }
}

function matchesRoot(data: Record<string, unknown>, rootId: string): boolean {
  const value = cleanText(data.rootId ?? data.ownerRootId ?? data.adminRootId);
  return !value || value === rootId;
}

function toJobRow(doc: admin.firestore.QueryDocumentSnapshot): JobRow {
  const data = asRecord(doc.data());
  return {
    id: doc.id,
    status: statusKey(data.status),
    solicitudId: cleanText(data.solicitudId) || null,
    pagoId: cleanText(data.pagoId) || null,
    folio: cleanText(data.pagoFolio ?? data.solicitudFolio ?? data.folio ?? data.pay0Folio) || null,
    iqFolio: cleanText(data.iqFolio ?? data.iqId) || null,
    profileId: cleanText(data.profileId ?? data.iqCredentialProfileId) || null,
    profileAlias: cleanText(data.profileAlias ?? data.iqCredentialAlias) || null,
    attempts: Number(data.attempts ?? data.attemptCount ?? 0) || 0,
    nextRunAt: isoOrNull(data.nextRunAt ?? data.nextAttemptAt ?? data.scheduledAt),
    updatedAt: isoOrNull(data.updatedAt ?? data.finishedAt ?? data.completedAt),
    createdAt: isoOrNull(data.createdAt),
    error: cleanText(data.errorMessage ?? data.error ?? data.lastError) || null,
  };
}

async function readCollectionRows(input: {
  collection: string;
  rootId: string;
  limit: number;
  orderField?: string;
}): Promise<admin.firestore.QueryDocumentSnapshot[]> {
  const tryQueries: Array<() => Promise<admin.firestore.QuerySnapshot>> = [];

  const orderField = input.orderField;
  if (orderField) {
    tryQueries.push(() => db.collection(input.collection).orderBy(orderField, "desc").limit(input.limit).get());
  }

  tryQueries.push(() => db.collection(input.collection).limit(input.limit).get());

  for (const run of tryQueries) {
    try {
      const snap = await run();
      return snap.docs.filter((doc) => matchesRoot(asRecord(doc.data()), input.rootId));
    } catch {
      // try fallback
    }
  }

  return [];
}

function summarizeJobs(rows: JobRow[], activeStatuses: Set<string>) {
  const now = Date.now();
  const byStatus: Record<string, number> = {};
  let active = 0;
  let due = 0;
  let nextDueAtMs = 0;
  let failed = 0;
  let imported = 0;
  let created = 0;

  for (const row of rows) {
    increment(byStatus, row.status);
    if (activeStatuses.has(row.status)) {
      active += 1;
    }
    if (row.status === "FAILED" || row.status === "ERROR" || row.status === "ERROR_RETRYABLE") {
      failed += 1;
    }
    if (row.status === "IMPORTED") {
      imported += 1;
    }
    if (row.status === "CREATED" || row.status === "CONFIRMED") {
      created += 1;
    }
    const nextMs = row.nextRunAt ? Date.parse(row.nextRunAt) : 0;
    if (nextMs > 0 && activeStatuses.has(row.status)) {
      if (nextMs <= now) {
        due += 1;
      }
      if (!nextDueAtMs || nextMs < nextDueAtMs) {
        nextDueAtMs = nextMs;
      }
    }
  }

  return {
    totalSampled: rows.length,
    active,
    due,
    failed,
    imported,
    created,
    nextDueAt: nextDueAtMs ? new Date(nextDueAtMs).toISOString() : null,
    byStatus,
  };
}

function compactRunRow(doc: admin.firestore.QueryDocumentSnapshot): QueueRunRow {
  const data = asRecord(doc.data());
  const summary: Record<string, unknown> = {};
  for (const key of [
    "scanned",
    "invoiceCandidates",
    "invoiceQueued",
    "skipped",
    "reachedEnd",
    "processed",
    "imported",
    "failed",
    "notFound",
    "queued",
  ]) {
    if (key in data) {
      summary[key] = data[key];
    }
  }
  if (data.lastRun && typeof data.lastRun === "object") {
    summary.lastRun = data.lastRun;
  }
  return {
    id: doc.id,
    type: cleanText(data.type) || null,
    version: cleanText(data.version) || null,
    createdAt: isoOrNull(data.createdAt ?? data.lastRunAt ?? data.updatedAt),
    summary,
  };
}

export const getIqAutomationDashboard = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    await assertIqAuthorized(request, { allowedRoles: ["superadmin"] });
    const auth = await getAuthContext(request);
    assertSuperAdmin(auth);

    // IQ2G_H4_D57B_PAGO_DASHBOARD_READS
    const [invoiceDocs, createDocs, statusDocs, pagoReceiptDocs, pagoDepositStatusDocs, queueRunDocs, discoveryStateSnap] = await Promise.all([
      readCollectionRows({ collection: "iqInvoiceJobs", rootId: auth.rootId, limit: 300, orderField: "updatedAt" }),
      readCollectionRows({ collection: "iqCreateJobs", rootId: auth.rootId, limit: 300, orderField: "updatedAt" }),
      readCollectionRows({ collection: "iqStatusJobs", rootId: auth.rootId, limit: 300, orderField: "updatedAt" }),
      readCollectionRows({ collection: "iqPagoReceiptJobs", rootId: auth.rootId, limit: 300, orderField: "updatedAt" }),
      readCollectionRows({ collection: "iqPagoDepositStatusJobs", rootId: auth.rootId, limit: 300, orderField: "updatedAt" }),
      readCollectionRows({ collection: "iqQueueRuns", rootId: auth.rootId, limit: 30, orderField: "createdAt" }),
      db.collection("iqAutomationState").doc("unified-iq-maintenance-invoices").get().catch(() => null),
    ]);

    const invoiceRows = invoiceDocs.map(toJobRow);
    const createRows = createDocs.map(toJobRow);
    const statusRows = statusDocs.map(toJobRow);
    const pagoReceiptRows = pagoReceiptDocs.map(toJobRow);
    const pagoDepositStatusRows = pagoDepositStatusDocs.map(toJobRow);
    const queueRuns = queueRunDocs.map(compactRunRow);
    const discoveryState = discoveryStateSnap && discoveryStateSnap.exists
      ? asRecord(discoveryStateSnap.data())
      : {};

    const invoiceSummary = summarizeJobs(invoiceRows, ACTIVE_INVOICE_STATUSES);
    const createSummary = summarizeJobs(createRows, ACTIVE_CREATE_STATUSES);
    const statusSummary = summarizeJobs(statusRows, ACTIVE_STATUS_STATUSES);
    const pagoReceiptSummary = summarizeJobs(pagoReceiptRows, ACTIVE_PAGO_RECEIPT_STATUSES);
    const pagoDepositStatusSummary = summarizeJobs(pagoDepositStatusRows, ACTIVE_PAGO_DEPOSIT_STATUS_STATUSES);

    return {
      ok: true,
      data: {
        rootId: auth.rootId,
        generatedAt: new Date().toISOString(),
        summary: {
          invoices: invoiceSummary,
          creations: createSummary,
          statuses: statusSummary,
          pagoReceipts: pagoReceiptSummary,
          pagoDepositStatuses: pagoDepositStatusSummary,
          discovery: {
            status: cleanText(discoveryState.status) || "UNKNOWN",
            updatedAt: isoOrNull(discoveryState.updatedAt ?? discoveryState.lastRunAt),
            cursorCreatedAt: isoOrNull(discoveryState.cursorCreatedAt),
            lastRun: asRecord(discoveryState.lastRun),
          },
        },
        recent: {
          invoiceJobs: invoiceRows.slice(0, 60),
          createJobs: createRows.slice(0, 40),
          statusJobs: statusRows.slice(0, 40),
          pagoReceiptJobs: pagoReceiptRows.slice(0, 60),
          pagoDepositStatusJobs: pagoDepositStatusRows.slice(0, 60),
          queueRuns,
        },
      },
      message: "Diagnostico IQ cargado.",
    };
  },
);
