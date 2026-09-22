import { FieldValue } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { ConversationInput, ConversationOutput } from "./hugoCore/conversationCore";
import { db } from "../sharedCallables/helpers";
import { FirestoreHugoDataStore } from "./firestoreHugoDataStore";

export function conversationTrace(traceId: string, input: ConversationInput, output: ConversationOutput, startedAt: number, capability?: { executed?: boolean } | null) {
  return {
    schemaVersion: 1, traceId, conversationId: input.conversationId, rootId: input.identity.rootId, actorUid: input.identity.uid,
    actorRole: input.identity.role, channel: input.channel, timestamp: FieldValue.serverTimestamp(),
    model: output.model.model, modelVersion: output.model.modelVersion, promptVersion: output.promptVersion,
    toolsRequested: output.toolsRequested.map(row => row.name),
    toolsExecuted: output.toolsExecuted.map(row => ({ tool: row.tool, sourceSystem: row.sourceSystem, completeness: row.completeness, latencyMs: row.trace.latencyMs, result: row.trace.result })),
    sourceSystems: [...new Set(output.toolsExecuted.map(row => row.sourceSystem))],
    evidenceReferences: output.toolsExecuted.flatMap(row => row.evidence.map(e => ({ sourceSystem: e.sourceSystem, entityType: e.entityType, entityId: e.entityId, completeness: e.completeness, kind: e.kind }))).slice(0, 100),
    resolvedEntities: output.recentEntities.map(row => ({ sourceSystem: row.system, entityType: row.type, entityId: row.id, folio: row.folio })).slice(0, 8),
    memoryReferences: output.pieces.filter(piece => piece.sourceSystem === "HUGO" && piece.entityId).map(piece => ({ kind: piece.kind, entityType: piece.entityType, entityId: piece.entityId })).slice(0, 18),
    contextKinds: [...new Set(output.pieces.map(piece => piece.kind))], policyDecisions: [{ policy: "SUPERADMIN_ROOT_SCOPE", decision: "ALLOW" }],
    action: capability ? { capability: "REQUEST_IQ_PAYMENT_COMPLEMENT", executed: capability.executed === true } : null,
    latencyMs: Date.now() - startedAt, tokenUsage: output.model.tokenUsage, estimatedCost: null,
    resultStatus: output.source, errorCode: output.model.error || null,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  };
}

export const purgeExpiredHugoTraces = onSchedule({ schedule: "0 3 * * *", timeZone: "America/Mexico_City", region: "us-central1", retryCount: 0 }, async () => {
  await new FirestoreHugoDataStore(db).purgeExpiredTraces();
});
