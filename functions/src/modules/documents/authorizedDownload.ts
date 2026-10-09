import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { resolveAuthorizedDocumentObject } from "./downloadAccess";

if (!admin.apps.length) admin.initializeApp();

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

export async function getAuthorizedDocumentDownloadUrlCore(
  request: any,
  signUrl?: (storagePath: string) => Promise<string>,
) {
    const uid = clean(request.auth?.uid);
    const uploadId = clean(request.data?.uploadId);
    const object = await resolveAuthorizedDocumentObject(uid, { family: "uploads", documentId: uploadId });
    const storagePath = object.storagePath;

    let url: string;
    try {
      let signer = signUrl;
      if (!signer) {
        const file = admin.storage().bucket().file(storagePath);
        const [exists] = await file.exists();
        if (!exists) throw new HttpsError("not-found", "Archivo no encontrado.");
        signer = async () => {
          const [signed] = await file.getSignedUrl({ action: "read", expires: Date.now() + 5 * 60 * 1000 });
          return signed;
        };
      }
      // Storage lookup is outside Firestore. Recheck current authority after it.
      // This does not make signing atomic or revoke a URL already delivered.
      const current = await resolveAuthorizedDocumentObject(uid, { family: "uploads", documentId: uploadId });
      if (current.revision !== object.revision || current.storagePath !== storagePath ||
          current.expectedGeneration !== object.expectedGeneration) {
        throw new HttpsError("failed-precondition", "Documento modificado.");
      }
      url = await signer(storagePath);
    } catch (error: any) {
      if (error instanceof HttpsError) throw error;
      if (Number(error?.code) === 404 || Number(error?.statusCode) === 404) {
        throw new HttpsError("not-found", "Archivo no encontrado.");
      }
      throw new HttpsError("internal", "No fue posible generar temporalmente el enlace de descarga.");
    }

    return { ok: true, uploadId, url, expiresInSeconds: 300 };
}

export const getAuthorizedDocumentDownloadUrl = onCall(
  { cors: true, timeoutSeconds: 30, memory: "256MiB" },
  async (request) => getAuthorizedDocumentDownloadUrlCore(request),
);
