import { getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";
import { storage } from "@/lib/firebaseClient";
import {
  EntityDocumentEntityType,
  EntityDocumentFiscalAdminType,
  EntityDocumentLegalPersonType,
  EntityDocumentType,
  finalizeEntityDocumentUpload,
  initEntityDocumentUpload,
} from "@/services/entityDocuments";


export type UploadEntityDocumentProgress = {
  bytesTransferred: number;
  totalBytes: number;
  progress: number;
};

export type UploadEntityDocumentInput = {
  entityType: EntityDocumentEntityType;
  entityId: string;
  documentType: EntityDocumentType;
  file: File;
  legalPersonType?: EntityDocumentLegalPersonType | null;
  fiscalAdminType?: EntityDocumentFiscalAdminType | null;
  periodYear?: number | null;
  periodMonth?: number | null;
  notes?: string | null;
  onProgress?: (progress: UploadEntityDocumentProgress) => void;
};

export type UploadEntityDocumentResult = {
  ok: boolean;
  entityDocumentId: string;
  documentId: string;
  storagePath: string;
  downloadURL: string;
  documentType: EntityDocumentType;
  documentTypeLabel?: string | null;
  documentPeriod?: string | null;
  periodYear?: number | null;
  periodMonth?: number | null;
  version?: number | null;
  maxSizeBytes?: number | null;
  sha256: string;
};

async function computeFileSha256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  const bytes = Array.from(new Uint8Array(hash));

  return bytes
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function assertUploadInitResponse(value: {
  entityDocumentId?: string | null;
  documentId?: string | null;
  storagePath?: string | null;
}) {
  if (!value.entityDocumentId || !value.documentId || !value.storagePath) {
    throw new Error("initEntityDocumentUpload no devolvio entityDocumentId/documentId/storagePath");
  }
}

export async function uploadEntityDocument(
  input: UploadEntityDocumentInput
): Promise<UploadEntityDocumentResult> {
  const { file } = input;

  if (!file) {
    throw new Error("Archivo requerido.");
  }

  const sha256 = await computeFileSha256(file);

  const initResult = await initEntityDocumentUpload({
    entityType: input.entityType,
    entityId: input.entityId,
    documentType: input.documentType,
    legalPersonType: input.legalPersonType ?? null,
    fiscalAdminType: input.fiscalAdminType ?? null,
    originalName: file.name,
    fileSize: file.size,
    contentType: file.type || "application/octet-stream",
    sha256,
    periodYear: input.periodYear ?? null,
    periodMonth: input.periodMonth ?? null,
    notes: input.notes ?? null,
  });

  assertUploadInitResponse(initResult);

  const storageRef = ref(storage, initResult.storagePath);
  const task = uploadBytesResumable(storageRef, file, {
    contentType: file.type || "application/octet-stream",
    customMetadata: {
      sha256,
      integrityHashAlgorithm: "SHA-256",
      entityDocumentId: initResult.entityDocumentId,
      documentid: initResult.documentId,
      entityType: input.entityType,
      entityId: input.entityId,
      documentType: input.documentType,
    },
  });

  await new Promise<void>((resolve, reject) => {
    task.on(
      "state_changed",
      (snapshot) => {
        const totalBytes = snapshot.totalBytes || file.size || 0;
        const bytesTransferred = snapshot.bytesTransferred || 0;
        const progress = totalBytes > 0 ? Math.round((bytesTransferred / totalBytes) * 100) : 0;

        input.onProgress?.({
          bytesTransferred,
          totalBytes,
          progress,
        });
      },
      (error) => reject(error),
      () => resolve()
    );
  });

  const finalizeResult = await finalizeEntityDocumentUpload({
    entityDocumentId: initResult.entityDocumentId,
    documentId: initResult.documentId,
    storagePath: initResult.storagePath,
  });

  let downloadURL = "";
  try {
    downloadURL = await getDownloadURL(task.snapshot.ref);
  } catch {
    downloadURL = "";
  }

  return {
    ok: Boolean(finalizeResult.ok),
    entityDocumentId: initResult.entityDocumentId,
    documentId: initResult.documentId,
    storagePath: initResult.storagePath,
    downloadURL,
    documentType: initResult.documentType,
    documentTypeLabel: initResult.documentTypeLabel ?? null,
    documentPeriod: initResult.documentPeriod ?? null,
    periodYear: initResult.periodYear ?? null,
    periodMonth: initResult.periodMonth ?? null,
    version: initResult.version ?? null,
    maxSizeBytes: initResult.maxSizeBytes ?? null,
    sha256,
  };
}