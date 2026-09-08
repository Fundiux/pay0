import { CALLABLES } from "@/lib/callableNames";
import { httpsCallable } from "firebase/functions";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { functions, storage } from "@/lib/firebaseClient";

export const MAX_SOLICITUD_DOCUMENT_SIZE_BYTES = 1024 * 1024;

export const SOLICITUD_DOCUMENT_TYPES = [
  { value: "FACTURA_PDF", label: "Factura PDF", accept: "application/pdf,.pdf" },
  { value: "FACTURA_XML", label: "Factura XML", accept: ".xml,text/xml,application/xml" },
  { value: "ORDEN_COMPRA", label: "Orden de Compra", accept: ".xls,.xlsx,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" },
  { value: "PRESUPUESTO", label: "Presupuesto / Cotizacion", accept: "application/pdf,image/*,.pdf,.jpg,.jpeg,.png,.webp,.xls,.xlsx,.csv" },
  { value: "EVIDENCIA_OPERATIVA", label: "Evidencia Operativa", accept: "application/pdf,image/*,.pdf,.jpg,.jpeg,.png,.webp,.txt,.csv,.xls,.xlsx" },
  { value: "OTRO", label: "Otro", accept: "application/pdf,image/*,.pdf,.jpg,.jpeg,.png,.webp,.xml,.xls,.xlsx,.csv,.doc,.docx,.txt" },
] as const;

export type SolicitudDocumentType = typeof SOLICITUD_DOCUMENT_TYPES[number]["value"];

async function computeFileSha256(file: File): Promise<string> {
  try {
    if (typeof crypto === "undefined" || !crypto.subtle) return "";
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return "";
  }
}

type InitResp = {
  ok: boolean;
  uploadId: string;
  storagePath: string;
  documentType: SolicitudDocumentType;
};

export async function uploadSolicitudDoc(opts: {
  solicitudId: string;
  documentType: SolicitudDocumentType;
  customDocumentTypeLabel?: string;
  file: File;
  onProgress?: (pct: number) => void;
}) {
  const { solicitudId, documentType, customDocumentTypeLabel, file, onProgress } = opts;

  if (file.size > MAX_SOLICITUD_DOCUMENT_SIZE_BYTES) {
    throw new Error("El archivo excede el limite de 1 MB.");
  }

  
  const sha256 = await computeFileSha256(file);
const init = httpsCallable(functions, CALLABLES.initSolicitudDocumentUpload);
  const initRes = await init({
    solicitudId,
    documentType,
    customDocumentTypeLabel: documentType === "OTRO" ? String(customDocumentTypeLabel || "").trim() : "",
    originalName: file.name,
    contentType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    sha256,
    integrityHashAlgorithm: sha256 ? "SHA-256" : "",
  });

  const { uploadId, storagePath } = (initRes.data as any) as InitResp;
  if (!uploadId || !storagePath) {
    throw new Error("initSolicitudDocumentUpload no devolvio uploadId/storagePath");
  }

  const storageRef = ref(storage, storagePath);
  const task = uploadBytesResumable(storageRef, file, {
    contentType: file.type || "application/octet-stream",
    customMetadata: {
        uploadid: uploadId,
        sha256,
        integrityHashAlgorithm: sha256 ? "SHA-256" : "",
        integritySealVersion: "PAY0-MATERIALIDAD-V1",
      },
  });

  const snap = await new Promise<any>((resolve, reject) => {
    task.on(
      "state_changed",
      (s) => {
        if (onProgress && s.totalBytes) {
          onProgress(Math.round((s.bytesTransferred / s.totalBytes) * 100));
        }
      },
      reject,
      () => resolve(task.snapshot)
    );
  });

  const downloadURL = await getDownloadURL(snap.ref);

  const finalize = httpsCallable(functions, CALLABLES.finalizeSolicitudDocumentUpload);
  const finalizeRes = await finalize({ uploadId, storagePath });

  return {
    uploadId,
    storagePath,
    downloadURL,
    ...(finalizeRes.data as any),
  };
}