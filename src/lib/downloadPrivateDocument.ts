import { app, auth } from "@/lib/firebaseClient";
import { registerPrivateDocumentUrl, releasePrivateDocumentUrl, releaseAllPrivateDocumentUrls } from "./authorizedDocumentAction";
export { isPrivateDocumentUrl, releasePrivateDocumentUrl } from "./authorizedDocumentAction";

export type PrivateDocumentFamily = "uploads" | "entityDocuments" | "assetDocuments";
const CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_BYTES = 32 * 1024 * 1024;
let cleanupRegistered = false;
function endpoint(): string {
  const projectId = String(app.options.projectId || "");
  if (!/^[a-z0-9-]+$/.test(projectId)) throw new Error("Configuracion de descarga no disponible.");
  if (["true", "1"].includes(process.env.NEXT_PUBLIC_USE_EMULATORS || "")) {
    const host = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST || "127.0.0.1";
    return `http://${host}:5001/${projectId}/us-central1/streamPrivateDocument`;
  }
  return `https://us-central1-${projectId}.cloudfunctions.net/streamPrivateDocument`;
}
function failure(code: string): Error { const error = new Error("No se pudo descargar el documento."); (error as any).code = code; return error; }

/** Returns only a short-lived browser-local URL, never a remote bearer URL. */
export async function downloadPrivateDocument(family: PrivateDocumentFamily, documentId: string): Promise<string> {
  if (!documentId || /[\/\\]/.test(documentId)) throw failure("invalid-argument");
  const user = auth.currentUser;
  if (!user) throw failure("unauthenticated");
  const parts: Blob[] = [];
  let offset = 0, size = 0, revision = "", mime = "application/octet-stream";
  do {
    if (auth.currentUser?.uid !== user.uid) throw failure("unauthenticated");
    const token = await user.getIdToken();
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch(endpoint(), { method:"POST", headers:{"Content-Type":"application/json", Authorization:`Bearer ${token}`},
        body:JSON.stringify({family,documentId,offset,...(offset ? {revision} : {})}), credentials:"omit", cache:"no-store", redirect:"error", signal:controller.signal });
      if (!response.ok) {
        let code = response.status === 401 ? "unauthenticated" : response.status === 403 ? "permission-denied" : "internal";
        try { const body = await response.json(); if (typeof body?.error?.code === "string") code = body.error.code; } catch {}
        throw failure(code);
      }
      const total = Number(response.headers.get("X-Document-Size"));
      const receivedOffset = Number(response.headers.get("X-Document-Offset"));
      const next = Number(response.headers.get("X-Document-Next-Offset"));
      const currentRevision = response.headers.get("X-Document-Revision") || "";
      if (!Number.isSafeInteger(total) || total <= 0 || total > MAX_BYTES || receivedOffset !== offset ||
          !Number.isSafeInteger(next) || next !== Math.min(total, offset + CHUNK_BYTES) ||
          !/^[a-f0-9]{64}$/.test(currentRevision) || (offset > 0 && (total !== size || currentRevision !== revision))) {
        throw failure("failed-precondition");
      }
      const part = await response.blob();
      if (part.size !== next - offset) throw failure("failed-precondition");
      if (auth.currentUser?.uid !== user.uid) throw failure("unauthenticated");
      parts.push(part); size = total; revision = currentRevision; offset = next;
      mime = response.headers.get("Content-Type") || "application/octet-stream";
    } finally { window.clearTimeout(timer); }
  } while (offset < size);
  const url = URL.createObjectURL(new Blob(parts, {type:mime}));
  registerPrivateDocumentUrl(url);
  window.setTimeout(() => releasePrivateDocumentUrl(url), 120_000);
  if (!cleanupRegistered) {
    window.addEventListener("pagehide", releaseAllPrivateDocumentUrls);
    cleanupRegistered = true;
  }
  return url;
}
