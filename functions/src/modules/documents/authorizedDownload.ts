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
        const bucket = admin.storage().bucket();
        // Do not use File({generation}): the SDK coerces strings to Number.
        // Its metadata request forwards these query options without coercion.
        const file = bucket.file(storagePath);
        const expectedGeneration = object.expectedGeneration;
        const validGeneration = (value: unknown): value is string =>
          typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value);
        if (expectedGeneration !== null && !validGeneration(expectedGeneration)) {
          throw new HttpsError("failed-precondition", "Generación de documento inválida.");
        }
        const metadataOptions: { userProject?: string; generation?: string } =
          expectedGeneration === null ? {} : { generation: expectedGeneration };
        const [metadata] = await file.getMetadata(metadataOptions);
        const generation = metadata.generation;
        if (metadata.name !== storagePath || metadata.bucket !== bucket.name ||
            !validGeneration(generation) ||
            (expectedGeneration !== null && generation !== expectedGeneration)) {
          throw new HttpsError("failed-precondition", "Documento modificado.");
        }
        signer = async () => {
          // V4 signs the exact generation query. V2 does not bind this query.
          // Legacy documents pin the observed generation, without backfilling it.
          const [signed] = await file.getSignedUrl({ version: "v4", action: "read",
            expires: Date.now() + 5 * 60 * 1000, queryParams: { generation } });
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
