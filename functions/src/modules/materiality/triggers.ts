import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { refreshMaterialityProjectionFromSource } from "./service";

const db = getFirestore();

async function refreshOrSkipInvalidSource(rootId: string, solicitudId: string): Promise<void> {
  try {
    await refreshMaterialityProjectionFromSource({ rootId, solicitudId });
  } catch (error) {
    const code = String((error as { code?: unknown })?.code || "");
    if (!["not-found", "permission-denied", "failed-precondition", "invalid-argument"].includes(code)) throw error;
    // A deleted parent or invalid scope cannot be repaired by Eventarc retries.
    logger.warn("materiality projection skipped: invalid source", { rootId, solicitudId, code });
  }
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function changed(before: Record<string, unknown>, after: Record<string, unknown>, key: string): boolean {
  return JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null);
}

function mustSync(before: Record<string, unknown>, after: Record<string, unknown>): boolean {
  if (before.active !== after.active) return true;
  if (after.active !== true) return false;
  return ["status", "documentType", "solicitudId", "pagoId", "entityId", "storagePath", "sha256", "rootId", "applicationId", "pagoAplicacionId"]
    .some((key) => changed(before, after, key));
}

async function solicitudIdsForUpload(upload: Record<string, unknown>): Promise<string[]> {
  const direct = text(upload.solicitudId);
  const applicationId = text(upload.applicationId || upload.pagoAplicacionId);
  if (applicationId) {
    const app = (await db.doc(`pagoAplicaciones/${applicationId}`).get()).data();
    if (!app || text(app.rootId) !== text(upload.rootId) || text(app.pagoId) !== text(upload.pagoId) ||
        (direct && direct !== text(app.solicitudId))) return [];
    return text(app.solicitudId) ? [text(app.solicitudId)] : [];
  }
  if (direct) return [direct];

  const pagoId = text(upload.pagoId) || (text(upload.entityType) === "pagos" ? text(upload.entityId) : "");
  if (!pagoId) return [];

  const applications = await db.collection("pagoAplicaciones")
    .where("pagoId", "==", pagoId)
    .limit(100)
    .get();
  return [...new Set(applications.docs.filter(row => text(row.data()?.rootId) === text(upload.rootId)).map((row) => text(row.data()?.solicitudId)).filter(Boolean))];
}

/**
 * Materialidad is a referential projection. A finalized/replaced/deactivated
 * document must refresh its parent operations without relying on a browser
 * button. System-authored documents are projected under their verified root;
 * a synthetic SYSTEM value must never be used to impersonate a Firebase user.
 */
export const refreshMaterialityFromUpload = onDocumentWritten(
  { document: "uploads/{uploadId}", region: "us-central1", retry: true, timeoutSeconds: 120, memory: "512MiB", maxInstances: 2 },
  async (event) => {
    const before = (event.data?.before.data() || {}) as Record<string, unknown>;
    const after = (event.data?.after.data() || {}) as Record<string, unknown>;
    if (!mustSync(before, after)) return;
    if (event.time && Date.now() - Date.parse(event.time) > 20 * 60_000) return;
    const seen = new Set<string>();
    for (const source of [before, after]) {
      const rootId = text(source.rootId);
      if (!rootId) continue;
      const solicitudIds = await solicitudIdsForUpload(source);
      for (const solicitudId of solicitudIds) {
        const key = `${rootId}:${solicitudId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const solicitud = await db.doc(`solicitudes/${solicitudId}`).get();
        if (!solicitud.exists || text(solicitud.data()?.rootId) !== rootId) {
          logger.warn("materiality upload refresh skipped: solicitud out of scope", { uploadId: event.params.uploadId, solicitudId });
          continue;
        }
        await refreshOrSkipInvalidSource(rootId, solicitudId);
      }
    }
  },
);

export const refreshMaterialityFromPaymentApplication = onDocumentWritten(
  { document: "pagoAplicaciones/{applicationId}", region: "us-central1", retry: true, timeoutSeconds: 120, memory: "512MiB", maxInstances: 2 },
  async event => {
    const before = event.data?.before.data() || {}, after = event.data?.after.data() || {};
    if (event.time && Date.now() - Date.parse(event.time) > 20 * 60_000) return;
    if (!["status", "solicitudId", "pagoId", "rootId"].some(key => changed(before, after, key))) return;
    const sources = [before, after].filter(row => text(row.rootId) && text(row.solicitudId));
    const seen = new Set<string>();
    for (const row of sources) {
      const key = `${row.rootId}:${row.solicitudId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await refreshOrSkipInvalidSource(text(row.rootId), text(row.solicitudId));
    }
  },
);
