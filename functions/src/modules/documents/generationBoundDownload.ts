import type { Bucket } from "@google-cloud/storage";
import { HttpsError } from "firebase-functions/v2/https";

const validGeneration = (value: unknown): value is string =>
  typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value);

/** Preserve the authorized object's identity even if its path is overwritten.
 * Source: exact-generation signing contract from b77765a. Never use the File
 * generation option, which can coerce identifiers larger than 2^53 to Number.
 */
export async function signGenerationBoundDownload(
  bucket: Bucket,
  storagePath: string,
  expectedGeneration: unknown = null,
): Promise<string> {
  if (expectedGeneration !== null && expectedGeneration !== undefined && !validGeneration(expectedGeneration)) {
    throw new HttpsError("failed-precondition", "Generación de documento inválida.");
  }
  const file = bucket.file(storagePath);
  const options: { userProject?: string; generation?: string } = {};
  if (validGeneration(expectedGeneration)) options.generation = expectedGeneration;
  const [metadata] = await file.getMetadata(options);
  const generation = metadata.generation;
  if (metadata.name !== storagePath || metadata.bucket !== bucket.name || !validGeneration(generation) ||
      (validGeneration(expectedGeneration) && generation !== expectedGeneration)) {
    throw new HttpsError("failed-precondition", "Documento modificado.");
  }
  // Legacy uploads pin the single observed generation; do not mutate metadata.
  const [url] = await file.getSignedUrl({
    version: "v4", action: "read", expires: Date.now() + 5 * 60 * 1000,
    queryParams: { generation },
  });
  return url;
}
