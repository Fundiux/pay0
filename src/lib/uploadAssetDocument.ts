import { ref, uploadBytesResumable } from "firebase/storage";
import { storage } from "@/lib/firebaseClient";
import {
  finalizeAssetDocumentUpload,
  initAssetDocumentUpload,
  type AssetDocumentType,
} from "@/services/assets";

const ALLOWED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const MAX_BYTES = 10 * 1024 * 1024;

async function sha256(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function uploadAssetDocument(input: {
  file: File;
  documentType: AssetDocumentType;
  description?: string;
  positionId?: string;
  operationId?: string;
  movementId?: string;
  onProgress?: (value: number) => void;
}) {
  if (!ALLOWED_TYPES.has(input.file.type)) {
    throw new Error("El formato no es compatible. Usa PDF, JPG o PNG.");
  }
  if (input.file.size <= 0 || input.file.size > MAX_BYTES) {
    throw new Error("El archivo debe pesar máximo 10 MB.");
  }
  const integrityHash = await sha256(input.file);
  const prepared = await initAssetDocumentUpload({
    originalFileName: input.file.name,
    contentType: input.file.type,
    fileSize: input.file.size,
    sha256: integrityHash,
    documentType: input.documentType,
    description: input.description,
    positionId: input.positionId,
    operationId: input.operationId,
    movementId: input.movementId,
  });
  if (prepared.duplicate) return { ...prepared, duplicate: true };
  const task = uploadBytesResumable(ref(storage, prepared.storagePath), input.file, {
    contentType: input.file.type,
    customMetadata: {
      documentId: prepared.documentId,
      sha256: integrityHash,
      integrityHashAlgorithm: "SHA-256",
    },
  });
  await new Promise<void>((resolve, reject) => task.on(
    "state_changed",
    (snapshot) => input.onProgress?.(
      snapshot.totalBytes ? Math.round(snapshot.bytesTransferred / snapshot.totalBytes * 100) : 0,
    ),
    reject,
    resolve,
  ));
  await finalizeAssetDocumentUpload(prepared.documentId);
  return { ...prepared, duplicate: false };
}
