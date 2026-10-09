import * as admin from "firebase-admin";
import { createHash } from "node:crypto";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { HttpsError, onRequest } from "firebase-functions/v2/https";
import { resolveAuthorizedDocumentObject, validatePrivateDocumentReference, type AuthorizedDocumentObject, type PrivateDocumentReference } from "./downloadAccess";

export const PRIVATE_DOCUMENT_CHUNK_BYTES = 8 * 1024 * 1024;
export const PRIVATE_DOCUMENT_MAX_BYTES = 32 * 1024 * 1024;
const STREAM_TIMEOUT_MS = 55_000;
const origins = new Set(["https://pay-0-system.web.app", "https://pay-0-system.firebaseapp.com"]);
const mimeTypes = new Set(["application/pdf", "image/png", "image/jpeg", "application/xml", "text/xml", "text/plain"]);
type Metadata = { generation: string; size: number; contentType: string };
export type PrivateDownloadDependencies = {
  verifyToken: (token: string) => Promise<{ uid: string }>;
  resolve: (uid: string, reference: PrivateDocumentReference) => Promise<AuthorizedDocumentObject>;
  metadata: (path: string) => Promise<Metadata>;
  stream: (path: string, generation: string, start: number, end: number) => Readable;
};
const defaults: PrivateDownloadDependencies = {
  verifyToken: token => admin.auth().verifyIdToken(token, true),
  resolve: resolveAuthorizedDocumentObject,
  metadata: async path => { const [row] = await admin.storage().bucket().file(path).getMetadata();
    return { generation: String(row.generation || ""), size: Number(row.size), contentType: String(row.contentType || "application/octet-stream") }; },
  stream: (path, generation, start, end) => admin.storage().bucket().file(path, { generation }).createReadStream({ start, end }),
};
const httpStatus: Record<string, number> = { "unauthenticated":401, "permission-denied":403, "not-found":404,
  "invalid-argument":400, "failed-precondition":409, "resource-exhausted":413, "deadline-exceeded":504 };
const revisionFor = (object: AuthorizedDocumentObject, metadata: Metadata) => createHash("sha256")
  .update(JSON.stringify([object.revision, metadata.generation, metadata.size])).digest("hex");

/** No public token or signed URL is produced. Each chunk is a fresh authorization. */
export async function streamPrivateDocumentCore(req: any, res: any, dependencies: PrivateDownloadDependencies = defaults): Promise<void> {
  const origin = String(req.headers?.origin || "");
  const emulatorOrigin = process.env.FUNCTIONS_EMULATOR === "true" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Vary", "Origin");
  if (origin && !origins.has(origin) && !emulatorOrigin) { res.status(403).json({ error:{code:"permission-denied"} }); return; }
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Expose-Headers", "X-Document-Revision, X-Document-Size, X-Document-Offset, X-Document-Next-Offset, Content-Type, Content-Disposition");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({error:{code:"invalid-argument"}}); return; }
  try {
    const bearer = /^Bearer ([^\s]+)$/.exec(String(req.headers?.authorization || ""));
    if (!bearer) throw new HttpsError("unauthenticated", "Sesion requerida.");
    let uid: string;
    try { uid = (await dependencies.verifyToken(bearer[1])).uid; }
    catch { throw new HttpsError("unauthenticated", "Sesion no disponible."); }
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body) || (req.rawBody?.length || 0) > 4096 ||
        Object.keys(req.query || {}).length || Object.keys(body).some(key => !["family", "documentId", "offset", "revision"].includes(key))) {
      throw new HttpsError("invalid-argument", "Solicitud invalida.");
    }
    const reference = validatePrivateDocumentReference(body);
    const offset = body.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset % PRIVATE_DOCUMENT_CHUNK_BYTES !== 0 ||
        (offset > 0 && (typeof body.revision !== "string" || !/^[a-f0-9]{64}$/.test(body.revision))) ||
        (offset === 0 && body.revision !== undefined)) throw new HttpsError("invalid-argument", "Rango invalido.");
    const object = await dependencies.resolve(uid, reference);
    const metadata = await dependencies.metadata(object.storagePath);
    if (!/^\d+$/.test(metadata.generation) || !Number.isSafeInteger(metadata.size) || metadata.size <= 0 || metadata.size > PRIVATE_DOCUMENT_MAX_BYTES) {
      throw new HttpsError("resource-exhausted", "Archivo fuera del limite permitido.");
    }
    if (object.expectedGeneration && object.expectedGeneration !== metadata.generation) throw new HttpsError("failed-precondition", "Archivo reemplazado.");
    const revision = revisionFor(object, metadata);
    if ((offset > 0 && body.revision !== revision) || offset >= metadata.size) throw new HttpsError("failed-precondition", "Archivo modificado.");
    // Metadata retrieval is outside Firestore; revalidate immediately afterwards.
    const current = await dependencies.resolve(uid, reference);
    if (current.revision !== object.revision || current.storagePath !== object.storagePath || current.expectedGeneration !== object.expectedGeneration) {
      throw new HttpsError("failed-precondition", "Documento modificado.");
    }
    if (req.aborted || res.destroyed) return;
    const end = Math.min(offset + PRIVATE_DOCUMENT_CHUNK_BYTES, metadata.size) - 1;
    const length = end - offset + 1;
    const filename = object.filename.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 160) || "documento";
    res.status(metadata.size > length ? 206 : 200);
    res.setHeader("Content-Type", mimeTypes.has(metadata.contentType.toLowerCase()) ? metadata.contentType.toLowerCase() : "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", String(length));
    res.setHeader("X-Document-Revision", revision);
    res.setHeader("X-Document-Size", String(metadata.size));
    res.setHeader("X-Document-Offset", String(offset));
    res.setHeader("X-Document-Next-Offset", String(end + 1));
    const stream = dependencies.stream(object.storagePath, metadata.generation, offset, end);
    let received = 0;
    const limiter = new Transform({ transform(chunk, _encoding, done) {
      received += chunk.length;
      done(received > length ? new Error("DOCUMENT_STREAM_LIMIT") : null, chunk);
    }, flush(done) { done(received !== length ? new Error("DOCUMENT_STREAM_TRUNCATED") : null); } });
    const abort = () => stream.destroy(new Error("DOCUMENT_DOWNLOAD_ABORTED"));
    const closed = () => { if (!res.writableFinished) abort(); };
    const timer = setTimeout(abort, STREAM_TIMEOUT_MS);
    req.once("aborted", abort); res.once("close", closed);
    try { await pipeline(stream, limiter, res); }
    finally { clearTimeout(timer); req.off("aborted", abort); res.off("close", closed); }
  } catch (error: any) {
    if (res.headersSent || res.destroyed) { if (!res.destroyed) res.destroy(); return; }
    const code = error?.code === 404 ? "not-found" : typeof error?.code === "string" && error.code in httpStatus ? error.code : "internal";
    res.removeHeader("Content-Length");
    res.status(httpStatus[code] || 500).json({error:{code}});
  }
}

// Deliberately not exported from functions/src/index.ts until rollout review.
export const streamPrivateDocument = onRequest({ region:"us-central1", timeoutSeconds:60, memory:"256MiB", cors:false },
  async (req, res) => streamPrivateDocumentCore(req, res));
