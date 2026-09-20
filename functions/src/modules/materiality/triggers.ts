import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { linkSolicitudToMaterialityOperationCore } from "./service";

const db = getFirestore();

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function changed(before: Record<string, unknown>, after: Record<string, unknown>, key: string): boolean {
  return JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null);
}

function mustSync(before: Record<string, unknown>, after: Record<string, unknown>): boolean {
  if (before.active !== after.active) return true;
  if (after.active !== true) return false;
  return ["status", "documentType", "solicitudId", "pagoId", "entityId", "storagePath", "sha256"]
    .some((key) => changed(before, after, key));
}

async function solicitudIdsForUpload(upload: Record<string, unknown>): Promise<string[]> {
  const direct = text(upload.solicitudId);
  if (direct) return [direct];

  const pagoId = text(upload.pagoId) || (text(upload.entityType) === "pagos" ? text(upload.entityId) : "");
  if (!pagoId) return [];

  const applications = await db.collection("pagoAplicaciones")
    .where("pagoId", "==", pagoId)
    .limit(100)
    .get();
  return [...new Set(applications.docs.map((row) => text(row.data()?.solicitudId)).filter(Boolean))];
}

/**
 * Materialidad is a referential projection. A finalized/replaced/deactivated
 * document must refresh its parent operations without relying on a browser
 * button. The source record still supplies the actor, scope and root checks.
 */
export const refreshMaterialityFromUpload = onDocumentWritten(
  { document: "uploads/{uploadId}", region: "us-central1", retry: true, timeoutSeconds: 120, memory: "512MiB" },
  async (event) => {
    const before = (event.data?.before.data() || {}) as Record<string, unknown>;
    const after = (event.data?.after.data() || {}) as Record<string, unknown>;
    if (!event.data?.after.exists || !mustSync(before, after)) return;

    const rootId = text(after.rootId);
    const actorUid = text(
      after.finalizedBy ||
      after.disabledBy ||
      after.deactivatedBy ||
      after.updatedBy ||
      after.createdBy,
    );
    if (!rootId || !actorUid) {
      logger.warn("materiality upload refresh skipped: missing scoped actor", { uploadId: event.params.uploadId });
      return;
    }

    const solicitudIds = await solicitudIdsForUpload(after);
    for (const solicitudId of solicitudIds) {
      const solicitud = await db.doc(`solicitudes/${solicitudId}`).get();
      if (!solicitud.exists || text(solicitud.data()?.rootId) !== rootId) {
        logger.warn("materiality upload refresh skipped: solicitud out of scope", { uploadId: event.params.uploadId, solicitudId });
        continue;
      }
      await linkSolicitudToMaterialityOperationCore({ auth: { uid: actorUid }, data: { solicitudId } });
    }
  },
);
