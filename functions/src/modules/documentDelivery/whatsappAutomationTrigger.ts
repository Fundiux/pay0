import * as admin from "firebase-admin";
import { onDocumentWritten } from "firebase-functions/v2/firestore";

import { packageDocuments, queueAutomaticClientDelivery } from "./whatsappAutomaticDelivery";

import {
  readWhatsAppAutomationState,
} from "./whatsappAutomationCallables";

import {
  buildDeliveryCaption,
  deliverySource,
  sameUploadVersion,
  sourceTypeForUpload,
  type DeliverySourceType,
} from "./whatsappDeliveryDomain";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

type UploadRow = Record<string, any> & {
  id: string;
};

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function cleanUpper(value: unknown): string {
  return cleanText(value).toUpperCase();
}

function millis(value: any): number {
  return typeof value?.toMillis === "function" ? Number(value.toMillis()) : 0;
}

function firstAmount(...values: unknown[]): number | null {
  for (const value of values) {
    const amount = Number(value);
    if (Number.isFinite(amount) && amount > 0) return amount;
  }
  return null;
}

/** One package per source type: the documents, the client and the client-facing caption data. */
type DeliveryPackage = {
  sourceId: string;
  clienteId: string;
  clienteNombre: string | null;
  rows: UploadRow[];
  counterpartyName: string | null;
  amount: number | null;
  dateMs: number;
};

async function readyUploads(field: string, value: string, rootId: string, types: readonly string[]): Promise<UploadRow[]> {
  const snap = await db.collection("uploads").where(field, "==", value).limit(50).get();
  return snap.docs
    .map((doc): UploadRow => ({ id: doc.id, ...((doc.data() || {}) as Record<string, any>) }))
    .filter((row) => cleanText(row.rootId) === rootId && row.active === true && cleanUpper(row.status) === "READY" &&
      types.includes(cleanUpper(row.documentType)) && Boolean(cleanText(row.storagePath)))
    .sort((a, b) => Number(b.version || 0) - Number(a.version || 0));
}

/** Every document type of the package, newest version of each, or null while one is missing. */
function completePackage(rows: UploadRow[], types: readonly string[]): UploadRow[] | null {
  const picked = types.map((type) => rows.find((row) => cleanUpper(row.documentType) === type));
  return picked.every(Boolean) ? (picked as UploadRow[]) : null;
}

async function readSolicitud(rootId: string, solicitudId: string): Promise<Record<string, any> | null> {
  if (!solicitudId) return null;
  const snap = await db.doc(`solicitudes/${solicitudId}`).get();
  const row = snap.exists ? snap.data() || {} : null;
  return row && cleanText(row.rootId) === rootId ? row : null;
}

async function buildPackage(sourceType: DeliverySourceType, upload: UploadRow): Promise<DeliveryPackage | null> {
  const rootId = cleanText(upload.rootId);
  const types = deliverySource(sourceType).uploadTypes;
  const dateMs = millis(upload.finalizedAt) || millis(upload.createdAt) || Date.now();

  if (sourceType === "FACTURA_PDF_XML") {
    const solicitudId = cleanText(upload.solicitudId ?? upload.entityId);
    let rows = (await readyUploads("solicitudId", solicitudId, rootId, types)).filter((row) => cleanUpper(row.entityType) === "SOLICITUDES");
    // IQ imports PDF and XML from one ZIP: only pair documents of the same ZIP.
    if (cleanUpper(upload.source) === "IQ_INVOICE_ZIP" && cleanText(upload.iqInvoiceZipHash)) {
      rows = rows.filter((row) => cleanText(row.iqInvoiceZipHash) === cleanText(upload.iqInvoiceZipHash));
    }
    const pair = completePackage(rows, types);
    const solicitud = await readSolicitud(rootId, solicitudId);
    if (!pair || !solicitud) return null;
    return { sourceId: solicitudId, clienteId: cleanText(upload.clienteId ?? upload.clientId ?? pair[0].clienteId ?? solicitud.clienteId ?? solicitud.clientId),
      clienteNombre: cleanText(upload.clienteNombre ?? solicitud.clienteNombre ?? solicitud.clientName) || null, rows: pair,
      counterpartyName: cleanText(solicitud.empresaNombre || solicitud.companyName) || null,
      amount: firstAmount(solicitud.total, solicitud.monto, solicitud.amount), dateMs };
  }

  if (sourceType === "COMPLEMENTO_PAGO_PDF_XML") {
    const key = cleanText(upload.complementKey);
    const rows = (await readyUploads("complementKey", key, rootId, types))
      .filter((row) => cleanText(row.pagoId) === cleanText(upload.pagoId) && cleanText(row.applicationId) === cleanText(upload.applicationId) &&
        cleanUpper(row.integritySealStatus) === "SEALED");
    const pair = completePackage(rows, types);
    if (!pair) return null;
    const [solicitud, application] = await Promise.all([
      readSolicitud(rootId, cleanText(upload.solicitudId)),
      cleanText(upload.applicationId) ? db.doc(`pagoAplicaciones/${cleanText(upload.applicationId)}`).get() : Promise.resolve(null),
    ]);
    const app = application?.exists && cleanText(application.get("rootId")) === rootId ? application.data() || {} : {};
    return { sourceId: key, clienteId: cleanText(upload.clienteId ?? solicitud?.clienteId ?? solicitud?.clientId),
      clienteNombre: cleanText(solicitud?.clienteNombre ?? solicitud?.clientName) || null, rows: pair,
      counterpartyName: cleanText(solicitud?.empresaNombre || solicitud?.companyName) || null,
      amount: firstAmount((app as any).montoAplicado), dateMs };
  }

  if (sourceType === "DISPERSION_COMPROBANTE") {
    const dispersionId = cleanText(upload.dispersionId ?? upload.entityId);
    const snap = dispersionId ? await db.doc(`clientDispersions/${dispersionId}`).get() : null;
    const dispersion = snap?.exists ? snap.data() || {} : null;
    if (!dispersion || cleanText(dispersion.rootId) !== rootId) return null;
    // Same rule as the Telegram notice: user-funded dispersions wait for a recipient policy.
    if (dispersion.fundingSource?.holderType === "USER") return null;
    return { sourceId: dispersionId, clienteId: cleanText(dispersion.clientId ?? dispersion.clienteId ?? upload.clienteId ?? upload.clientId),
      clienteNombre: cleanText(dispersion.clienteNombre ?? dispersion.clientName) || null, rows: [upload],
      counterpartyName: cleanText(dispersion.beneficiaryNombre ?? dispersion.beneficiarioNombre) || null,
      amount: firstAmount(dispersion.amount, dispersion.monto), dateMs: millis(dispersion.createdAt) || dateMs };
  }

  // COTIZACION_PDF and CONSTANCIA_FIRMADA_PDF: one PDF of a solicitud.
  const solicitudId = cleanText(upload.solicitudId ?? upload.entityId);
  const solicitud = await readSolicitud(rootId, solicitudId);
  if (!solicitud) return null;
  return { sourceId: solicitudId, clienteId: cleanText(upload.clienteId ?? solicitud.clienteId ?? solicitud.clientId),
    clienteNombre: cleanText(upload.clienteNombre ?? solicitud.clienteNombre ?? solicitud.clientName) || null, rows: [upload],
    counterpartyName: cleanText(solicitud.empresaNombre || solicitud.companyName) || null,
    amount: firstAmount(solicitud.total, solicitud.monto, solicitud.amount), dateMs };
}

// Every client document that lives in `uploads` (invoice, payment complement, dispersion receipt,
// quotation, signed receipt certificate) is queued here as soon as its package is READY.
export const processWhatsAppInvoiceAutomation =
  onDocumentWritten(
    {
      document: "uploads/{uploadId}",
      region: "us-central1",
      memory: "256MiB",
      timeoutSeconds: 60,
    },
    async (event) => {
      const afterSnap = event.data?.after;
      if (!afterSnap?.exists) return;

      const after = { id: afterSnap.id, ...((afterSnap.data() || {}) as Record<string, any>) } as UploadRow;
      const sourceType = sourceTypeForUpload(after);
      if (!sourceType) return;

      const beforeSnap = event.data?.before;
      const before = beforeSnap?.exists ? ((beforeSnap.data() || {}) as Record<string, any>) : {};

      // A later update of the same stored version never sends again.
      if (sameUploadVersion(before, after)) return;

      const rootId = cleanText(after.rootId);
      const automation = await readWhatsAppAutomationState(rootId);
      if (automation.enabled !== true) {
        console.log("[WHATSAPP AUTO] OFF", sourceType);
        return;
      }

      const pkg = await buildPackage(sourceType, after);
      if (!pkg) {
        console.log("[WHATSAPP AUTO] PAQUETE INCOMPLETO O NO ELEGIBLE", sourceType);
        return;
      }

      const documents = packageDocuments(sourceType, pkg.rows, pkg.dateMs);
      await queueAutomaticClientDelivery({
        rootId,
        sourceType,
        sourceId: pkg.sourceId,
        clienteId: pkg.clienteId,
        clienteNombre: pkg.clienteNombre,
        documents,
        caption: buildDeliveryCaption({ sourceType, counterpartyName: pkg.counterpartyName, amount: pkg.amount, dateMs: pkg.dateMs, fileName: documents[0]?.fileName }),
        notes: `Envio automatico: ${deliverySource(sourceType).label}.`,
      });
    }
  );
