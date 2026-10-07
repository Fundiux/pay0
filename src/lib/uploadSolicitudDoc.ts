import { CALLABLES } from "@/lib/callableNames";
import { httpsCallable } from "firebase/functions";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { functions, storage } from "@/lib/firebaseClient";
import { MATERIALIDAD_CANONICAL_DOCUMENTS } from "@/canonicos/materialidad";

export const MAX_SOLICITUD_DOCUMENT_SIZE_BYTES = 1024 * 1024;

export const SOLICITUD_DOCUMENT_TYPES = MATERIALIDAD_CANONICAL_DOCUMENTS.map(({ value, label, accept }) => ({ value, label, accept }));

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

// Retain the same upload identity across a recoverable Storage/finalize failure.
// Files stay in memory only; no business data or document is persisted locally.
const checkpoints = new WeakMap<File, Map<string, { uploadId: string; storagePath: string; uploaded: boolean }>>();

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
  const key = `${solicitudId}:${documentType}:${customDocumentTypeLabel || ""}`;
  let files = checkpoints.get(file);
  if (!files) { files = new Map(); checkpoints.set(file, files); }
  let checkpoint = files.get(key);
  if (!checkpoint) {
    const init = httpsCallable(functions, CALLABLES.initSolicitudDocumentUpload);
    const initRes = await init({
      solicitudId, documentType,
      customDocumentTypeLabel: documentType === "OTRO" ? String(customDocumentTypeLabel || "").trim() : "",
      originalName: file.name, contentType: file.type || "application/octet-stream",
      sizeBytes: file.size, sha256, integrityHashAlgorithm: sha256 ? "SHA-256" : "",
    });
    const { uploadId, storagePath } = initRes.data as InitResp;
    if (!uploadId || !storagePath) throw new Error("initSolicitudDocumentUpload no devolvio uploadId/storagePath");
    checkpoint = { uploadId, storagePath, uploaded: false };
    files.set(key, checkpoint);
  }
  const { uploadId, storagePath } = checkpoint;

  const storageRef = ref(storage, storagePath);
  if (!checkpoint.uploaded) {
    const task = uploadBytesResumable(storageRef, file, {
      contentType: file.type || "application/octet-stream",
      customMetadata: {
          uploadid: uploadId,
          sha256,
          integrityHashAlgorithm: sha256 ? "SHA-256" : "",
          integritySealVersion: "PAY0-MATERIALIDAD-V1",
        },
    });

    await new Promise<any>((resolve, reject) => {
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

    checkpoint.uploaded = true;
  }

  const finalize = httpsCallable(functions, CALLABLES.finalizeSolicitudDocumentUpload);
  const finalizeRes = await finalize({ uploadId, storagePath });

  // A download-link failure must not prevent authoritative finalization.
  const downloadURL = await getDownloadURL(storageRef).catch(() => "");

  return {
    uploadId,
    storagePath,
    downloadURL,
    ...(finalizeRes.data as any),
  };
}
