import { getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";
import { httpsCallable } from "firebase/functions";
import { functions, storage } from "@/lib/firebaseClient";
import { CALLABLES } from "@/lib/callableNames";

export const MAX_PAGO_DOCUMENT_SIZE_BYTES = 1 * 1024 * 1024;

export type PagoDocumentType = "COMPROBANTE_PAGO" | "OTRO";

export type UploadPagoDocOptions = {
  pagoId: string;
  documentType: PagoDocumentType;
  customDocumentTypeLabel?: string;
  file: File;
  onProgress?: (pct: number) => void;
};

async function computeFileSha256(file: File): Promise<string> {
  if (!globalThis.crypto?.subtle) return "";

  const buffer = await file.arrayBuffer();
  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));

  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

type InitPagoDocResp = {
  uploadId: string;
  storagePath: string;
};

export async function uploadPagoDoc(opts: UploadPagoDocOptions) {
  const { pagoId, documentType, customDocumentTypeLabel, file, onProgress } = opts;

  if (!pagoId) {
    throw new Error("pagoId requerido.");
  }

  if (file.size > MAX_PAGO_DOCUMENT_SIZE_BYTES) {
    throw new Error("El archivo excede el limite de 1 MB.");
  }

  const sha256 = await computeFileSha256(file);

  const init = httpsCallable(functions, CALLABLES.initPagoDocumentUpload);
  const initRes = await init({
    pagoId,
    documentType,
    customDocumentTypeLabel: customDocumentTypeLabel || "",
    originalName: file.name,
    contentType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    sha256,
  });

  const { uploadId, storagePath } = (initRes.data as any) as InitPagoDocResp;

  if (!uploadId || !storagePath) {
    throw new Error("initPagoDocumentUpload no devolvio uploadId/storagePath");
  }

  const storageRef = ref(storage, storagePath);
  const task = uploadBytesResumable(storageRef, file, {
    contentType: file.type || "application/octet-stream",
    customMetadata: {
      uploadid: uploadId,
      pagoId,
      documentType,
      sha256,
      integrityHashAlgorithm: sha256 ? "SHA-256" : "",
      integritySealVersion: "PAY0-MATERIALIDAD-V1",
    },
  });

  await new Promise<void>((resolve, reject) => {
    task.on(
      "state_changed",
      (snap) => {
        const pct = snap.totalBytes ? Math.round((snap.bytesTransferred / snap.totalBytes) * 100) : 0;
        onProgress?.(pct);
      },
      reject,
      () => resolve()
    );
  });

  const downloadURL = await getDownloadURL(task.snapshot.ref);

  const finalize = httpsCallable(functions, CALLABLES.finalizePagoDocumentUpload);
  const finalizeRes = await finalize({ uploadId, storagePath });

  return {
    ...(finalizeRes.data as any),
    uploadId,
    storagePath,
    downloadURL,
  };
}