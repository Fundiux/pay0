import * as admin from "firebase-admin";
import { isTerminalSolicitud } from "../cotizaciones/quotationPolicy";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const clean = (value: unknown) => String(value ?? "").trim();

export type QuotationEvidence = { uploadId: string; storagePath: string; evidence: string[] };

/** A quotation is complete only when its active Firestore row and Storage object agree. */
export async function verifyQuotationEvidence(input: { rootId: string; solicitudId: string; jobId: string; uploadId: string; iqFolio: string; ocUploadId: string }): Promise<QuotationEvidence> {
  if (!input.uploadId) throw Error("COTIZACION_SIN_UPLOAD_ID");
  const [solicitudSnap, uploadSnap, ocSnap] = await Promise.all([
    db.collection("solicitudes").doc(input.solicitudId).get(),
    db.collection("uploads").doc(input.uploadId).get(),
    db.collection("uploads").doc(input.ocUploadId).get(),
  ]);
  const solicitud = solicitudSnap.data() || {};
  const upload = uploadSnap.data() || {};
  const oc = ocSnap.data() || {};
  const storagePath = clean(upload.storagePath);
  const ocStoragePath = clean(oc.storagePath);
  const sha256 = clean(upload.sha256);
  if (!solicitudSnap.exists || !uploadSnap.exists || !ocSnap.exists || isTerminalSolicitud(solicitud) ||
      clean(solicitud.rootId) !== input.rootId || clean(upload.rootId) !== input.rootId ||
      clean(oc.rootId) !== input.rootId || clean(oc.solicitudId) !== input.solicitudId ||
      oc.documentType !== "ORDEN_COMPRA" || oc.status !== "READY" || oc.active !== true ||
      !ocStoragePath.startsWith(`roots/${input.rootId}/solicitudes/${input.solicitudId}/docs/ORDEN_COMPRA/`) ||
      clean(solicitud.iqFolio || solicitud.iqId) !== input.iqFolio || clean(solicitud.ocFiscalMetadataUploadId) !== input.ocUploadId ||
      clean(upload.solicitudId) !== input.solicitudId || clean(upload.quotationJobId) !== input.jobId ||
      upload.documentType !== "COTIZACION" || upload.status !== "READY" || upload.active !== true || !/^[a-f0-9]{64}$/i.test(sha256) ||
      !storagePath.startsWith(`roots/${input.rootId}/solicitudes/${input.solicitudId}/docs/COTIZACION/`)) {
    throw Error("COTIZACION_NO_LIGADA_O_NO_ACTIVA");
  }
  const file = admin.storage().bucket().file(storagePath);
  const [[exists], [ocExists]] = await Promise.all([file.exists(), admin.storage().bucket().file(ocStoragePath).exists()]);
  if (!exists) throw Error("COTIZACION_SIN_ARCHIVO_STORAGE");
  if (!ocExists) throw Error("OC_SIN_ARCHIVO_STORAGE");
  const [metadata] = await file.getMetadata();
  if (clean(metadata.metadata?.sha256).toLowerCase() !== sha256.toLowerCase()) throw Error("COTIZACION_HASH_NO_COINCIDE");
  return { uploadId: input.uploadId, storagePath, evidence: [
    `solicitudes/${input.solicitudId}`,
    `uploads/${input.uploadId}`,
    `uploads/${input.ocUploadId}`,
    storagePath,
    ocStoragePath,
    `solicitudQuotationJobs/${input.jobId}`,
  ] };
}
