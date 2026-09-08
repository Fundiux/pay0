import { CALLABLES } from "@/lib/callableNames";
import { httpsCallable } from "firebase/functions";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { functions, storage } from "@/lib/firebaseClient";

export const MAX_DISPERSION_DOCUMENT_SIZE_BYTES = 1024 * 1024;

export const DISPERSION_DOCUMENT_TYPES = [
  {
    value: "COMPROBANTE_DISPERSION",
    label: "Comprobante de Dispersion",
    accept: "application/pdf,image/*,.pdf,.jpg,.jpeg,.png,.webp",
  },
] as const;

export type DispersionDocumentType = typeof DISPERSION_DOCUMENT_TYPES[number]["value"];

type InitResp = {
  ok: boolean;
  uploadId: string;
  storagePath: string;
  documentType: DispersionDocumentType;
};

export async function uploadDispersionDoc(opts: {
  dispersionId: string;
  file: File;
  onProgress?: (pct: number) => void;
}) {
  const { dispersionId, file, onProgress } = opts;

  if (!dispersionId) {
    throw new Error("dispersionId requerido.");
  }

  if (!file) {
    throw new Error("Archivo requerido.");
  }

  if (file.size > MAX_DISPERSION_DOCUMENT_SIZE_BYTES) {
    throw new Error("El archivo excede el limite de 1 MB.");
  }

  const init = httpsCallable(functions, CALLABLES.initDispersionDocumentUpload);
  const initRes = await init({
    dispersionId,
    documentType: "COMPROBANTE_DISPERSION",
    originalName: file.name,
    contentType: file.type || "application/octet-stream",
    sizeBytes: file.size,
  });

  const { uploadId, storagePath } = (initRes.data as any) as InitResp;

  if (!uploadId || !storagePath) {
    throw new Error("initDispersionDocumentUpload no devolvio uploadId/storagePath");
  }

  const storageRef = ref(storage, storagePath);
  const task = uploadBytesResumable(storageRef, file, {
    contentType: file.type || "application/octet-stream",
    customMetadata: {
      uploadid: uploadId,
      dispersionId,
      documentType: "COMPROBANTE_DISPERSION",
      originalName: file.name,
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

  const finalize = httpsCallable(functions, CALLABLES.finalizeDispersionDocumentUpload);
  const finalizeRes = await finalize({ uploadId, storagePath });

  return {
    uploadId,
    storagePath,
    downloadURL,
    ...(finalizeRes.data as any),
  };
}