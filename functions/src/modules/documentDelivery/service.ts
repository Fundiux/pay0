import { applyWhatsAppDestinationsToJob } from "./whatsappRoutes";
import { recordOperationalMetric } from "../operationalMetrics/service";
import { createHash } from "crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { deliverySource, normalizeDeliverySourceType, type DeliverySourceType } from "./whatsappDeliveryDomain";
import { assertAuthorized } from "../../utils/authGuard";
import { normalizeClientWhatsapp } from "../clients/domain";

type DocumentDeliverySourceType = DeliverySourceType;
type DocumentDeliveryChannel = "WHATSAPP";

type DeliveryDocumentInput = {
  name?: unknown;
  fileName?: unknown;
  contentType?: unknown;
  storagePath?: unknown;
  downloadUrl?: unknown;
  url?: unknown;
  documentType?: unknown;
  uploadId?: unknown;
};

function cleanText(value: unknown, maxLength = 500): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

function cleanOptionalText(value: unknown, maxLength = 500): string | null {
  const text = cleanText(value, maxLength);
  return text || null;
}

function normalizeSourceType(value: unknown): DocumentDeliverySourceType {
  const sourceType = normalizeDeliverySourceType(value);
  if (!sourceType) throw new HttpsError("invalid-argument", "Tipo de envio no soportado.");
  return sourceType;
}

function canonicalMessageForSource(sourceType: DocumentDeliverySourceType): string {
  return deliverySource(sourceType).legacyMessage;
}

function normalizeDocuments(raw: unknown): Array<{
  name: string;
  fileName: string | null;
  contentType: string | null;
  storagePath: string | null;
  downloadUrl: string | null;
  documentType: string | null;
  uploadId: string | null;
}> {
  const list = Array.isArray(raw) ? raw : [];
  const docs = list
    .map((item: DeliveryDocumentInput) => {
      const name = cleanOptionalText(item?.name ?? item?.fileName, 200);
      const fileName = cleanOptionalText(item?.fileName ?? item?.name, 200);
      const storagePath = cleanOptionalText(item?.storagePath, 1200);
      const downloadUrl = cleanOptionalText(item?.downloadUrl ?? item?.url, 2000);
      const contentType = cleanOptionalText(item?.contentType, 200);
      const documentType = cleanOptionalText(item?.documentType, 120);
      const uploadId = cleanOptionalText(item?.uploadId, 200);

      if (!name && !fileName && !storagePath && !downloadUrl) return null;

      return {
        name: name || fileName || "documento",
        fileName,
        contentType,
        storagePath,
        downloadUrl,
        documentType,
        uploadId,
      };
    })
    .filter(Boolean) as Array<{
      name: string;
      fileName: string | null;
      contentType: string | null;
      storagePath: string | null;
      downloadUrl: string | null;
      documentType: string | null;
      uploadId: string | null;
    }>;

  if (!docs.length) {
    throw new HttpsError("invalid-argument", "Agrega al menos un documento para preparar el envio.");
  }

  return docs.slice(0, 10);
}

function buildDocumentFingerprint(
  documents: ReturnType<typeof normalizeDocuments>
): string {
  const canonical = documents
    // The stored object identifies the document; the display name does not, so a
    // manual and an automatic job for the same file share one fingerprint.
    .map((doc) => ({
      documentType: cleanText(doc.documentType, 120).toUpperCase(),
      storagePath: cleanText(doc.storagePath, 1200),
      fileName: cleanText(doc.storagePath, 1200) ? "" : cleanText(doc.fileName || doc.name, 200),
    }))
    .sort((a, b) =>
      `${a.documentType}|${a.storagePath}|${a.fileName}`.localeCompare(
        `${b.documentType}|${b.storagePath}|${b.fileName}`
      )
    );

  return createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
}

function fingerprintExistingJob(job: any): string {
  const stored = cleanText(job?.documentFingerprint, 100);
  if (stored) return stored;

  try {
    return buildDocumentFingerprint(normalizeDocuments(job?.documents));
  } catch {
    return "";
  }
}

function firestoreTimeMs(value: any): number {
  if (!value) return 0;

  if (typeof value?.toMillis === "function") {
    return Number(value.toMillis()) || 0;
  }

  if (typeof value?.seconds === "number") {
    return Number(value.seconds) * 1000;
  }

  return 0;
}
async function resolveActor(uid: string): Promise<{
  uid: string;
  rootId: string;
  role: string;
  name: string | null;
  user: Record<string, unknown>;
}> {
  const db = getFirestore();
  const snap = await db.doc(`users/${uid}`).get();
  const data = snap.exists ? snap.data() || {} : {};

  const role = cleanText((data as any).role || (data as any).rol || "", 80).toLowerCase();
  const rootId = cleanText((data as any).rootId || uid, 200);
  const name = cleanOptionalText((data as any).username || (data as any).name || (data as any).displayName || uid, 200);

  if (!role) {
    throw new HttpsError("permission-denied", "Usuario sin rol activo.");
  }

  return { uid, rootId, role, name, user: data as Record<string, unknown> };
}

function assertCanPrepareDocumentDelivery(request: any, actor: { user: Record<string, unknown> }, sourceType: DocumentDeliverySourceType) {
  const source = deliverySource(sourceType);
  // Text deliveries (links) are only created by the server.
  if (source.kind !== "FILES") throw new HttpsError("permission-denied", "Este envio solo lo prepara el sistema.");
  assertAuthorized(request.auth, actor.user, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: source.manualPermission.module, requiredAction: source.manualPermission.action });
}

/** Automatic jobs get a deterministic id so concurrent triggers create exactly one job. */
function automaticJobId(input: { rootId: string; sourceType: string; sourceId: string; clienteId: string; documentFingerprint: string }): string {
  return "auto_" + createHash("sha256").update(JSON.stringify([input.rootId, input.sourceType, input.sourceId, input.clienteId, input.documentFingerprint])).digest("hex").slice(0, 40);
}

export type DocumentDeliveryInternalContext = {
  origin: "AUTOMATIC";
  rootId: string;
  actorUid?: string;
  actorName?: string;
  actorRole?: string;
};

export async function prepareDocumentDeliveryJobCore(
  request: any,
  internalContext?: DocumentDeliveryInternalContext
) {
  const automatic =
    internalContext?.origin === "AUTOMATIC";

  if (!automatic && !request.auth?.uid) {
    throw new HttpsError(
      "unauthenticated",
      "Inicia sesion para preparar envio de documentos."
    );
  }

  const actor = automatic
    ? {
        uid: cleanText(internalContext?.actorUid || "system", 200),
        rootId: cleanText(internalContext?.rootId, 200),
        role: cleanText(internalContext?.actorRole || "system", 80),
        name: cleanOptionalText(
          internalContext?.actorName || "Sistema",
          200
        ),
        user: {} as Record<string, unknown>,
      }
    : await resolveActor(request.auth.uid);

  if (!actor.rootId) {
    throw new HttpsError(
      "failed-precondition",
      "No se pudo resolver rootId para el envio."
    );
  }

  const data = request.data || {};
  const sourceType = normalizeSourceType(data.sourceType);

  if (!automatic) {
    assertCanPrepareDocumentDelivery(
      request,
      actor,
      sourceType
    );
  }
  const channel: DocumentDeliveryChannel = "WHATSAPP";
  const source = deliverySource(sourceType);
  const message = canonicalMessageForSource(sourceType);
  // TEXT deliveries carry no file; the fingerprint then covers the text itself.
  const textBody = source.kind === "TEXT" ? cleanOptionalText(data.textBody, 1500) : null;
  if (source.kind === "TEXT" && !textBody) throw new HttpsError("invalid-argument", "Falta el texto del envio.");
  const documents = source.kind === "TEXT" ? [] : normalizeDocuments(data.documents);
  const documentFingerprint = source.kind === "TEXT"
    ? createHash("sha256").update(JSON.stringify([sourceType, textBody])).digest("hex")
    : buildDocumentFingerprint(documents);
  const sourceId = cleanOptionalText(data.sourceId, 300);
  // Client-facing caption: automatic jobs bring one built from client data; manual jobs use the neutral label.
  const caption = automatic ? cleanOptionalText(data.caption, 1000) : `${source.label}.`;

  if ((sourceType === "FACTURA_PDF_XML" || automatic) && !sourceId) {
    throw new HttpsError(
      "invalid-argument",
      "Falta sourceId para proteger el envio."
    );
  }

  // AUTOMATIC nunca puede saltarse la proteccion
  // contra duplicados.
  const forceResend =
    automatic
      ? false
      : data.forceResend === true;

  const db = getFirestore();
  const now = FieldValue.serverTimestamp();
  const clienteId = cleanOptionalText(data.clienteId ?? data.clientId, 300);
  if (!clienteId) throw new HttpsError("invalid-argument", "Falta clienteId para resolver el WhatsApp canonico.");
  const clientSnap = await db.collection("clients").doc(clienteId).get();
  if (!clientSnap.exists) throw new HttpsError("not-found", "Cliente no existe.");
  const clientData = clientSnap.data() || {};
  if (cleanText((clientData as any).rootId, 200) !== actor.rootId) throw new HttpsError("permission-denied", "Cliente fuera de tu root.");
  const clienteWhatsapp = normalizeClientWhatsapp((clientData as any).whatsapp);

  // H4_DOCUMENT_DELIVERY_MANUAL_IDEMPOTENCY
  // Mismo root + cliente + origen + entidad + paquete documental.
  let matchingJobs: Array<{
    id: string;
    data: any;
  }> = [];

  if (sourceId) {
    const existingSnap = await db
      .collection("documentDeliveryJobs")
      .where("sourceId", "==", sourceId)
      .limit(100)
      .get();

    matchingJobs = existingSnap.docs
      .map((doc) => ({
        id: doc.id,
        data: doc.data() || {},
      }))
      .filter(({ data: existing }) => {
        return (
          cleanText(existing.rootId, 200) === actor.rootId &&
          cleanText(existing.channel, 80).toUpperCase() === "WHATSAPP" &&
          cleanText(existing.sourceType, 80).toUpperCase() === sourceType &&
          cleanText(existing.clienteId ?? existing.clientId, 300) === clienteId &&
          fingerprintExistingJob(existing) === documentFingerprint
        );
      })
      .sort(
        (a, b) =>
          firestoreTimeMs(b.data.createdAt) -
          firestoreTimeMs(a.data.createdAt)
      );
  }

  const inFlight = matchingJobs.find(({ data: existing }) =>
    [
      "READY_FOR_MANUAL_SEND",
      "READY_FOR_SEND",
      "SENDING",
      "BLOCKED_UNCERTAIN",
    ].includes(cleanText(existing.status, 80).toUpperCase())
  );

  if (inFlight) {
    return {
      ok: true,
      action: "ALREADY_IN_PROGRESS" as const,
      jobId: inFlight.id,
      status: cleanText(inFlight.data.status, 80),
      channel,
      sourceType,
      message:
        "Esta misma factura ya tiene un envio pendiente o en proceso.",
      documentsCount: documents.length,
      documentFingerprint,
    };
  }

  const sentJob = matchingJobs.find(
    ({ data: existing }) =>
      cleanText(existing.status, 80).toUpperCase() === "SENT"
  );

  if (sentJob && !forceResend) {
    return {
      ok: true,
      action: "REQUIRES_CONFIRMATION" as const,
      jobId: sentJob.id,
      status: "SENT",
      channel,
      sourceType,
      message:
        "Esta misma factura PDF/XML ya fue enviada por WhatsApp.",
      documentsCount: documents.length,
      documentFingerprint,
      previousJobId: sentJob.id,
    };
  }

  if (forceResend && !sentJob) {
    throw new HttpsError(
      "failed-precondition",
      "No existe un envio previo completado que requiera reenvio forzado."
    );
  }

  if (!forceResend) {
    const failedJob = matchingJobs.find(({ data: existing }) =>
      ["ERROR", "ERROR_PARTIAL"].includes(
        cleanText(existing.status, 80).toUpperCase()
      )
    );

    if (failedJob) {
      return {
        ok: true,
        action: "RETRY_EXISTING" as const,
        jobId: failedJob.id,
        status: cleanText(failedJob.data.status, 80),
        channel,
        sourceType,
        message:
          "Existe un intento fallido de esta misma factura. Se reutilizara para reintentar.",
        documentsCount: documents.length,
        documentFingerprint,
      };
    }
  }

  const payload = {
    rootId: actor.rootId,
    channel,
    sourceType,
    sourceId,
    clienteId,
    clienteNombre: cleanOptionalText((clientData as any).name ?? data.clienteNombre ?? data.clientName, 500),
    clienteWhatsapp,
    clienteWhatsappSource: `clients/${clienteId}.whatsapp`,
    targetLabel: cleanOptionalText(data.targetLabel, 500),
    targetGroupId: cleanOptionalText(data.targetGroupId, 500),
    message,
    caption,
    textBody,
    linkToken: automatic ? cleanOptionalText(data.linkToken, 200) : null,
    deliveryKind: source.kind,
    documents,
    status: "READY_FOR_MANUAL_SEND",
    sendMode: "DOCUMENT_ONLY",
    inboundResponsesEnabled: false,
    createdBy: actor.uid,
    createdByName: actor.name,
    createdByRole: actor.role,
    createdAt: now,
    updatedAt: now,
    notes: cleanOptionalText(data.notes, 1000),

    documentFingerprint,
    origin: automatic ? "AUTOMATIC" : "MANUAL",
    forceResend: forceResend === true,
    resendOfJobId:
      forceResend && sentJob
        ? sentJob.id
        : null,
  };

  let ref: FirebaseFirestore.DocumentReference;
  if (automatic) {
    ref = db.collection("documentDeliveryJobs").doc(automaticJobId({ rootId: actor.rootId, sourceType, sourceId: sourceId || "", clienteId, documentFingerprint }));
    try {
      await ref.create(payload);
    } catch (error: any) {
      // Another trigger created the same job first: report it instead of creating a second one.
      if (Number(error?.code) !== 6 && !/already exists/i.test(String(error?.message || ""))) throw error;
      const existing = await ref.get();
      return {
        ok: true,
        action: "ALREADY_IN_PROGRESS" as const,
        jobId: ref.id,
        status: cleanText(existing.get("status"), 80),
        channel,
        sourceType,
        message: "Este mismo envio ya existe.",
        documentsCount: documents.length,
        documentFingerprint,
      };
    }
  } else {
    ref = await db.collection("documentDeliveryJobs").add(payload);
  }

  await recordOperationalMetric({
    rootId: actor.rootId,
    stage: "ACTION_STARTED",
    channel: "WHATSAPP",
    caseType: "DOCUMENT_DELIVERY",
    correlationId: ref.id,
    adminId: actor.uid,
    clientId: clienteId,
    actorUid: actor.uid,
    source: automatic ? "AUTOMATION" : "HUMAN",
    outcome: "JOB_CREATED",
  }).catch(() => undefined);

  // H4-D60-E6B_AUTO_ROUTE_AFTER_CREATE
  let targetResolution: Awaited<ReturnType<typeof applyWhatsAppDestinationsToJob>> | null = null;
  try {
    targetResolution = await applyWhatsAppDestinationsToJob(db, ref, payload, {
      uid: actor.uid,
      name: "AUTO_ROUTE_AFTER_CREATE",
    });
  } catch (error: any) {
    console.warn("[documentDelivery] No se pudo resolver ruta WhatsApp automaticamente:", error?.message || error);
  }

  return {
    ok: true,
    action: "CREATED" as const,
    jobId: ref.id,
    status: payload.status,
    channel,
    sourceType,
    message,
    documentsCount: documents.length,
    documentFingerprint,
    forceResend: payload.forceResend,
    resendOfJobId: payload.resendOfJobId,
    targetResolutionStatus: targetResolution?.status || "ROUTE_RESOLUTION_ERROR",
    destinationsCount: targetResolution?.destinationsCount || 0,
  };
}
