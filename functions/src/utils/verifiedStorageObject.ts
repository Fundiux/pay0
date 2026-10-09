import { createHash } from "node:crypto";
import type { Bucket } from "@google-cloud/storage";
import { HttpsError } from "firebase-functions/v2/https";

function reject(message = "El archivo no coincide con la carga preparada."): never {
  throw new HttpsError("failed-precondition", message);
}
const mime = (value: unknown) => String(value || "application/octet-stream").split(";", 1)[0].trim().toLowerCase();

// Identification only. Magic bytes do not establish malware safety or parser safety.
export function detectStorageContentType(prefix: Buffer): string | null {
  if (prefix.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (prefix.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (prefix.length >= 3 && prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255) return "image/jpeg";
  if (prefix.subarray(0, 4).toString("ascii") === "RIFF" && prefix.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (["GIF87a", "GIF89a"].includes(prefix.subarray(0, 6).toString("ascii"))) return "image/gif";
  if ([[80, 75, 3, 4], [80, 75, 5, 6], [80, 75, 7, 8]].some(signature => prefix.subarray(0, 4).equals(Buffer.from(signature)))) return "application/zip";
  if (prefix.subarray(0, 8).equals(Buffer.from([208, 207, 17, 224, 161, 177, 26, 225]))) return "application/x-ole-storage";
  const text = prefix.toString("utf8").replace(/^\uFEFF/, "").trimStart();
  if (/^-----BEGIN (?:CERTIFICATE|(?:ENCRYPTED |RSA |EC )?PRIVATE KEY)-----/.test(text)) return "application/x-pem-file";
  if (prefix.length >= 4 && prefix[0] === 0x30 && prefix[1] >= 0x80 && prefix[1] <= 0x84) return "application/pkix-cert";
  if (/^\{\\rtf[0-9]/.test(text)) return "application/rtf";
  if (/^[\[{]/.test(text)) return "application/json";
  const xmlRoot = text.replace(/^<\?xml[\s\S]*?\?>\s*/i, "");
  if (/^(?:<!doctype\s+html|<html(?:\s|>))/i.test(xmlRoot)) return "text/html";
  if (/^<svg(?:\s|>)/i.test(xmlRoot)) return "image/svg+xml";
  if (/^<\?xml\s/i.test(text) || /^<(?:[A-Za-z_][\w.:-]*)(?:\s|>|\/)/.test(xmlRoot)) return "application/xml";
  if (text && !/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffd]/.test(text) && !/^\s*</.test(text)) return "text/plain";
  return null;
}
function matchesMime(declared: string, detected: string): boolean {
  if (declared === "application/octet-stream") return true;
  if (declared === detected) return true;
  if (detected === "application/zip") return /^(application\/(?:zip|x-zip-compressed|vnd\.openxmlformats-officedocument\.[a-z.]+))$/.test(declared);
  if (detected === "application/x-ole-storage") return ["application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint"].includes(declared);
  if (detected === "application/pkix-cert") return ["application/pkix-cert", "application/x-x509-ca-cert", "application/pkcs8", "application/x-pkcs12"].includes(declared);
  if (detected === "application/x-pem-file") return ["application/x-pem-file", "text/plain", "application/pkcs8", "application/x-x509-ca-cert"].includes(declared);
  if (detected === "application/xml") return ["application/xml", "text/xml"].includes(declared);
  if (detected === "application/json") return ["application/json", "text/json", "text/plain"].includes(declared);
  if (detected === "application/rtf") return ["application/rtf", "text/rtf"].includes(declared);
  if (detected === "text/plain") return ["text/plain", "text/csv"].includes(declared);
  return false;
}

function isRecognizedMime(declared: string): boolean {
  return ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml", "text/html",
    "application/zip", "application/x-zip-compressed", "application/msword", "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint", "application/pkix-cert", "application/x-x509-ca-cert", "application/pkcs8",
    "application/x-pkcs12", "application/x-pem-file", "application/xml", "text/xml", "application/json",
    "text/json", "application/rtf", "text/rtf", "text/plain", "text/csv"].includes(declared) ||
    /^application\/vnd\.openxmlformats-officedocument\.[a-z.]+$/.test(declared);
}

export async function verifyStorageObject(input: {
  bucket: Bucket; storagePath: string; expectedSize: number; expectedContentType: string;
  maxBytes: number; expectedClientSha256?: string | null; expectedMetadata?: Record<string, string>;
}) {
  if (!input.storagePath || input.storagePath.startsWith("/") || input.storagePath.includes("..") || /[\\\x00-\x1f]/.test(input.storagePath) ||
      !Number.isSafeInteger(input.expectedSize) || input.expectedSize <= 0 || input.expectedSize > input.maxBytes) reject();
  const latest = input.bucket.file(input.storagePath);
  let metadata: any;
  try { [metadata] = await latest.getMetadata(); } catch { reject("No se pudo verificar el archivo en Storage."); }
  const generation = String(metadata.generation || "");
  const validateMetadata = (data: any) => {
    if (data.name !== input.storagePath || String(data.generation) !== generation || !/^\d+$/.test(generation) ||
        Number(data.size) !== input.expectedSize || mime(data.contentType) !== mime(input.expectedContentType)) reject();
    for (const [key, value] of Object.entries(input.expectedMetadata || {})) if (String(data.metadata?.[key] || "") !== value) reject();
  };
  validateMetadata(metadata);
  const file = input.bucket.file(input.storagePath, { generation });
  const hash = createHash("sha256"); let size = 0; let prefix = Buffer.alloc(0);
  const stream = file.createReadStream({ validation: "crc32c" });
  const timer = setTimeout(() => stream.destroy(new Error("VERIFICATION_TIMEOUT")), 30_000);
  try {
    for await (const raw of stream) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      size += chunk.length;
      if (size > input.maxBytes || size > input.expectedSize) { stream.destroy(); reject("El archivo excede el tamano preparado."); }
      if (prefix.length < 512) prefix = Buffer.concat([prefix, chunk.subarray(0, 512 - prefix.length)]);
      hash.update(chunk);
    }
  } catch (error) { if (error instanceof HttpsError) throw error; reject("No se pudo verificar el contenido del archivo."); }
  finally { clearTimeout(timer); }
  if (size !== input.expectedSize) reject();
  const detectedContentType = detectStorageContentType(prefix);
  const declaredContentType = mime(input.expectedContentType);
  const recognizedDeclaration = isRecognizedMime(declaredContentType);
  if (recognizedDeclaration && (!detectedContentType || !matchesMime(declaredContentType, detectedContentType))) reject("El tipo del archivo no coincide con su contenido.");
  // The upload UI historically permits opaque formats. Preserve them without
  // claiming type verification or malware clearance when no detector applies.
  const contentValidationStatus = detectedContentType && (recognizedDeclaration || declaredContentType === "application/octet-stream")
    ? "BASIC_SIGNATURE_VERIFIED" : "UNRECOGNIZED_TYPE";
  const sha256 = hash.digest("hex");
  if (input.expectedClientSha256 && input.expectedClientSha256.toLowerCase() !== sha256) reject("El hash del archivo no coincide con la carga preparada.");
  let finalMetadata: any;
  try { [finalMetadata] = await latest.getMetadata(); } catch { reject("No se pudo verificar la version final del archivo."); }
  validateMetadata(finalMetadata);
  if (String(finalMetadata.metageneration || "") !== String(metadata.metageneration || "")) reject("Los metadatos del archivo cambiaron durante la verificacion.");
  return { sha256, storageGeneration: generation, storageMetageneration: String(metadata.metageneration || ""), sizeBytes: size,
    contentType: mime(metadata.contentType), detectedContentType, contentValidationStatus, integrityVerificationVersion: 1 };
}
