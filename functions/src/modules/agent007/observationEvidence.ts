import type { Firestore, Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { canonicalEvidenceType, evidenceIdentity, isEvidenceSystem, observationEntity } from "./hugoCore/evidenceIdentity";
import { buildPaymentApplicationActivityId } from "../paymentApplications/domain";

const collections = ["pay0ActivityLog", "assetsActivityLog", "tttActivityLog", "hugoActivityLog", "activityLog"] as const;
const systems = ["PAY0", "ASSETS", "TTT", "HUGO"] as const;
const safeId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,151}$/.test(value);
const millis = (value: any): number | null => {
  const ms = typeof value?.toMillis === "function" ? value.toMillis() : NaN;
  return Number.isFinite(ms) && ms > 0 ? ms : null;
};
function reject(reason: string): never {
  throw new HttpsError("failed-precondition", "La procedencia historica de la observacion no es verificable.", { reason });
}
export type ResolvedObservationEvidence = { observation: any; activityCreatedAt: number | null };

/** Construct inside each transaction callback; no cache survives a retry.
 * Only absent systems may be resolved. No historical document is rewritten.
 */
export function observationEvidenceResolver(db: Firestore, tx: Transaction, rootId: string) {
  const cache = new Map<string, Promise<Array<{ collection: string; data: any }>>>();
  return async (observationId: string, observation: any): Promise<ResolvedObservationEvidence> => {
    if (!observation || observation.rootId !== rootId || observation.source !== "ACTIVITY_LOG") reject("OBSERVATION_SCOPE_INVALID");
    if (Object.prototype.hasOwnProperty.call(observation, "sourceSystem")) {
      if (!evidenceIdentity(observationEntity(observation))) reject("OBSERVATION_IDENTITY_INVALID");
      return { observation, activityCreatedAt: null };
    }
    const sourceId = observation.sourceActivityId;
    // observer writes observationRef(`activity_${activityId}`); observationRef does not truncate/sanitize.
    if (!safeId(sourceId) || observationId !== `activity_${sourceId}` ||
        !canonicalEvidenceType(observation.caseType) ||
        (typeof observation.caseId !== "string" || !observation.caseId || observation.caseId.length > 160 || /[\/\\\x00-\x1f]/.test(observation.caseId)) ||
        typeof observation.sourceEvent !== "string" || !/^[A-Z][A-Z0-9_]{1,119}$/.test(observation.sourceEvent)) reject("OBSERVATION_SOURCE_REFERENCE_INVALID");
    if (!cache.has(sourceId)) cache.set(sourceId, Promise.all(collections.map(async collection => {
      const snap = await tx.get(db.collection(collection).doc(sourceId));
      return { collection, data: snap.exists ? snap.data() : undefined };
    })));
    const found = (await cache.get(sourceId)!).filter(item => item.data !== undefined);
    if (found.length !== 1) reject(found.length ? "ACTIVITY_SOURCE_AMBIGUOUS" : "ACTIVITY_SOURCE_MISSING");
    const { collection, data } = found[0];
    if (data.rootId !== rootId || !isEvidenceSystem(data.sourceSystem) || data.event !== observation.sourceEvent ||
        ["type", "eventType"].some(key => key in data && data[key] !== data.event)) reject("ACTIVITY_SOURCE_CONTRADICTION");
    const index = collections.indexOf(collection as typeof collections[number]);
    if (index < 4 && data.sourceSystem !== systems[index]) reject("ACTIVITY_COLLECTION_SYSTEM_INVALID");
    const hasReference = Boolean(data.referenceType || data.referenceId);
    const type = hasReference ? data.referenceType : data.entityType;
    const entityId = hasReference ? data.referenceId : data.entityId;
    const identity = evidenceIdentity({ sourceSystem: data.sourceSystem, entityType: type, entityId });
    if (!identity || identity !== evidenceIdentity({ sourceSystem: data.sourceSystem, entityType: observation.caseType, entityId: observation.caseId }) ||
        (hasReference && (data.entityType || data.entityId) && identity !== evidenceIdentity({ sourceSystem: data.sourceSystem, entityType: data.entityType, entityId: data.entityId }))) reject("ACTIVITY_ENTITY_INVALID");
    if (collection === "activityLog") {
      const applied = data.event === "PAGO_APLICADO_A_SOLICITUD";
      if ((!applied && data.event !== "SOLICITUD_COMPLETADA") || data.sourceSystem !== "PAY0" ||
          canonicalEvidenceType(type) !== (applied ? "PAGO" : "SOLICITUD") ||
          data.activitySchemaVersion !== 2 || data.atomicBatch !== true ||
          !safeId(data.paymentApplicationId) || !safeId(data.batchReservationId) ||
          buildPaymentApplicationActivityId(data.paymentApplicationId, applied ? "APPLIED" : "COMPLETED") !== sourceId) reject("LEGACY_ACTIVITY_PRODUCER_INVALID");
    }
    const sourceAt = millis(data.createdAt), observedAt = millis(observation.createdAt);
    if (sourceAt === null || observedAt === null || sourceAt > observedAt) reject("ACTIVITY_SOURCE_TIME_INVALID");
    return { observation: { ...observation, sourceSystem: data.sourceSystem }, activityCreatedAt: sourceAt };
  };
}
export function assertResolvedOutcomeTime(evidence: ResolvedObservationEvidence, decisionAt: number, correctedAt?: number) {
  if (evidence.activityCreatedAt !== null && (!Number.isFinite(decisionAt) || decisionAt <= 0 || evidence.activityCreatedAt < decisionAt ||
      correctedAt !== undefined && (!Number.isFinite(correctedAt) || correctedAt <= 0 || evidence.activityCreatedAt < correctedAt))) reject("ACTIVITY_OUTCOME_PREDATES_DECISION");
}
