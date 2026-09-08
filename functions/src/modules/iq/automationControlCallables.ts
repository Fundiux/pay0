import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertIqAuthorized } from "./authorization";

import { logActivity } from "../../utils/logActivity";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

type AuthContext = {
  uid: string;
  role: string;
  rootId: string;
  username: string;
};

type OmitTarget = {
  collection: string;
  label: string;
};

const TARGETS: Record<string, OmitTarget[]> = {
  invoice: [{ collection: "iqInvoiceJobs", label: "Facturas IQ" }],
  create: [{ collection: "iqCreateJobs", label: "Creacion solicitudes IQ" }],
  status: [{ collection: "iqStatusJobs", label: "Estado solicitudes IQ" }],
  pagoReceipt: [{ collection: "iqPagoReceiptJobs", label: "Pagos / depositos IQ" }],
  pagoDepositStatus: [{ collection: "iqPagoDepositStatusJobs", label: "Conciliacion pagos IQ" }],
  all: [
    { collection: "iqInvoiceJobs", label: "Facturas IQ" },
    { collection: "iqCreateJobs", label: "Creacion solicitudes IQ" },
    { collection: "iqStatusJobs", label: "Estado solicitudes IQ" },
    { collection: "iqPagoReceiptJobs", label: "Pagos / depositos IQ" },
    { collection: "iqPagoDepositStatusJobs", label: "Conciliacion pagos IQ" },
  ],
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
  const username = cleanText(user.username ?? user.displayName ?? user.name ?? user.email ?? uid) || uid;

  return { uid, role, rootId, username };
}

function assertSuperAdmin(auth: AuthContext): void {
  if (auth.role !== "superadmin") {
    throw new HttpsError("permission-denied", "Solo Super Admin puede omitir seguimiento IQ.");
  }
}

function uniqueRefs(refs: FirebaseFirestore.DocumentReference[]): FirebaseFirestore.DocumentReference[] {
  const seen = new Set<string>();
  const out: FirebaseFirestore.DocumentReference[] = [];

  for (const ref of refs) {
    if (seen.has(ref.path)) continue;
    seen.add(ref.path);
    out.push(ref);
  }

  return out;
}

async function findRefs(input: {
  collection: string;
  jobId: string;
  folio: string;
  pagoId: string;
  solicitudId: string;
  rootId: string;
}): Promise<FirebaseFirestore.DocumentReference[]> {
  const refs: FirebaseFirestore.DocumentReference[] = [];
  const collection = db.collection(input.collection);

  if (input.jobId) {
    refs.push(collection.doc(input.jobId));
  }

  const queryFields: Array<[string, string]> = [];

  if (input.folio) {
    queryFields.push(["folio", input.folio]);
    queryFields.push(["pay0Folio", input.folio]);
    queryFields.push(["pagoFolio", input.folio]);
    queryFields.push(["solicitudFolio", input.folio]);
  }

  if (input.pagoId) {
    queryFields.push(["pagoId", input.pagoId]);
  }

  if (input.solicitudId) {
    queryFields.push(["solicitudId", input.solicitudId]);
  }

  for (const [field, value] of queryFields) {
    const snap = await collection.where(field, "==", value).limit(30).get().catch(() => null);
    if (!snap) continue;

    snap.docs.forEach((doc) => refs.push(doc.ref));
  }

  const unique = uniqueRefs(refs);
  const scoped: FirebaseFirestore.DocumentReference[] = [];

  for (const ref of unique) {
    const snap = await ref.get().catch(() => null);
    if (!snap?.exists) continue;

    const data = asRecord(snap.data());
    const docRootId = cleanText(data.rootId ?? data.ownerRootId ?? data.adminId);

    if (docRootId && docRootId !== input.rootId) {
      continue;
    }

    scoped.push(ref);
  }

  return scoped;
}

async function updateRelatedEntity(input: {
  collection: string;
  data: Record<string, unknown>;
  comment: string;
  reason: string;
  auth: AuthContext;
}): Promise<void> {
  const now = FieldValue.serverTimestamp();
  const pagoId = cleanText(input.data.pagoId);
  const solicitudId = cleanText(input.data.solicitudId);

  if (pagoId && input.collection.startsWith("iqPago")) {
    await db.collection("pagos").doc(pagoId).set({
      iqDepositSyncStatus: "OMITTED",
      iqDepositUploadStatus: "OMITTED",
      iqDepositStatus: "OMITTED",
      iqDepositStatusLabel: "Omitido",
      iqDepositReviewRequired: false,
      iqDepositLastError: null,
      iqDepositUploadLastError: null,
      iqDepositReconciliationLastError: null,
      iqDepositOmitted: true,
      iqDepositOmittedReason: input.reason,
      iqDepositOmittedComment: input.comment,
      iqDepositOmittedBy: input.auth.uid,
      iqDepositOmittedByName: input.auth.username,
      iqDepositOmittedAt: now,
      iqDepositUpdatedAt: now,
      updatedAt: now,
    }, { merge: true }).catch(() => undefined);
  }

  if (solicitudId && input.collection === "iqInvoiceJobs") {
    await db.collection("solicitudes").doc(solicitudId).set({
      iqInvoiceImportStatus: "OMITTED",
      iqInvoiceImportLastError: null,
      iqInvoiceImportOmitted: true,
      iqInvoiceImportOmittedReason: input.reason,
      iqInvoiceImportOmittedComment: input.comment,
      iqInvoiceImportOmittedBy: input.auth.uid,
      iqInvoiceImportOmittedByName: input.auth.username,
      iqInvoiceImportOmittedAt: now,
      updatedAt: now,
    }, { merge: true }).catch(() => undefined);
  }

  if (solicitudId && input.collection === "iqStatusJobs") {
    await db.collection("solicitudes").doc(solicitudId).set({
      iqStatusSyncStatus: "OMITTED",
      iqStatusLastError: null,
      iqStatusOmitted: true,
      iqStatusOmittedReason: input.reason,
      iqStatusOmittedComment: input.comment,
      iqStatusOmittedBy: input.auth.uid,
      iqStatusOmittedByName: input.auth.username,
      iqStatusOmittedAt: now,
      updatedAt: now,
    }, { merge: true }).catch(() => undefined);
  }

  if (solicitudId && input.collection === "iqCreateJobs") {
    await db.collection("solicitudes").doc(solicitudId).set({
      iqCreateStatus: "OMITTED",
      iqCreateLastError: null,
      iqCreateOmitted: true,
      iqCreateOmittedReason: input.reason,
      iqCreateOmittedComment: input.comment,
      iqCreateOmittedBy: input.auth.uid,
      iqCreateOmittedByName: input.auth.username,
      iqCreateOmittedAt: now,
      updatedAt: now,
    }, { merge: true }).catch(() => undefined);
  }
}

export const omitIqAutomationJob = onCall(
  {
    cors: true,
    invoker: "public",
    timeoutSeconds: 180,
    memory: "512MiB",
  },
  async (request) => {
    await assertIqAuthorized(request, { allowedRoles: ["superadmin"] });
    const auth = await getAuthContext(request);
    assertSuperAdmin(auth);

    const payload = asRecord(request.data);
    const area = cleanText(payload.area || "all");
    const jobId = cleanText(payload.jobId);
    const folio = cleanText(payload.folio);
    const pagoId = cleanText(payload.pagoId);
    const solicitudId = cleanText(payload.solicitudId);
    const reason = cleanText(payload.reason) || "Prueba / seguimiento no requerido";
    const comment = cleanText(payload.comment) || reason;

    if (!jobId && !folio && !pagoId && !solicitudId) {
      throw new HttpsError("invalid-argument", "Captura jobId, folio, pagoId o solicitudId.");
    }

    const targets = TARGETS[area];
    if (!targets?.length) {
      throw new HttpsError("invalid-argument", `Area IQ no soportada: ${area}.`);
    }

    const now = FieldValue.serverTimestamp();
    const omitted: Array<{
      collection: string;
      id: string;
      folio: string;
      pagoId: string;
      solicitudId: string;
    }> = [];

    for (const target of targets) {
      const refs = await findRefs({
        collection: target.collection,
        jobId,
        folio,
        pagoId,
        solicitudId,
        rootId: auth.rootId,
      });

      for (const ref of refs) {
        const snap = await ref.get();
        if (!snap.exists) continue;

        const data = asRecord(snap.data());

        await ref.set({
          status: "OMITTED",
          omitted: true,
          omittedReason: reason,
          omittedComment: comment,
          omittedBy: auth.uid,
          omittedByName: auth.username,
          omittedAt: now,
          lastError: `Omitido: ${comment}`,
          lastErrorCode: "OMITTED_BY_SUPERADMIN",
          nextRunAt: null,
          updatedAt: now,
        }, { merge: true });

        await updateRelatedEntity({
          collection: target.collection,
          data,
          comment,
          reason,
          auth,
        });

        omitted.push({
          collection: target.collection,
          id: ref.id,
          folio: cleanText(data.pagoFolio ?? data.solicitudFolio ?? data.folio ?? data.pay0Folio),
          pagoId: cleanText(data.pagoId),
          solicitudId: cleanText(data.solicitudId),
        });
      }
    }

    if (omitted.length === 0) {
      throw new HttpsError("not-found", "No encontre jobs IQ para omitir con esos datos.");
    }

    await logActivity({
      event: "IQ_JOB_OMITIDO",
      rootId: auth.rootId,
      adminId: auth.rootId,
      actorUid: auth.uid,
      actorName: auth.username,
      actorUsername: auth.username,
      actorRole: auth.role,
      referenceId: pagoId || solicitudId || jobId || folio,
      referenceFolio: folio || pagoId || solicitudId || jobId,
      referenceType: "iq",
      entityId: pagoId || solicitudId || jobId || folio,
      entityType: "iq",
      description: `Seguimiento IQ omitido: ${comment}`,
      extra: {
        area,
        jobId,
        folio,
        pagoId,
        solicitudId,
        reason,
        comment,
        omitted,
      },
    }).catch(() => undefined);

    return {
      ok: true,
      data: {
        area,
        omittedCount: omitted.length,
        omitted,
      },
      message: `Seguimiento IQ omitido en ${omitted.length} job(s).`,
    };
  },
);
