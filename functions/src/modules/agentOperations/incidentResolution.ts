import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { mexicoDayKey } from "./time";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const clean = (value: unknown, max = 500) => String(value ?? "").trim().slice(0, max);

/** Quién cerró el incidente; alimenta la tasa de autonomía de los agentes. */
export type IncidentResolver = "AGENTE" | "ORQUESTADOR" | "PERSONA";
/** Escalera de resolución: primero el sistema, luego Hugo, al final una persona. */
export type ResolverTier = "SYSTEM" | "HUGO" | "PERSON";
export const resolverTierOf = (resolvedBy: unknown): ResolverTier | null =>
  resolvedBy === "AGENTE" || resolvedBy === "SYSTEM" ? "SYSTEM" : resolvedBy === "ORQUESTADOR" || resolvedBy === "HUGO" ? "HUGO" : resolvedBy === "PERSONA" || resolvedBy === "PERSON" ? "PERSON" : null;
export type InterventionKind = "INCIDENT_RESOLVED" | "PROPOSAL_REVIEWED" | "KILL_SWITCH";

/** Cierra un incidente abierto de forma idempotente y guarda quién lo resolvió y cuánto tardó. */
export async function resolveIncident(incidentId: string, input: { rootId: string; resolvedBy: IncidentResolver; actorUid?: string | null; note: string; resolution?: string; actionTaken?: string }): Promise<boolean> {
  const ref = db.collection("agentIncidents").doc(incidentId);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.get("rootId") !== input.rootId || snap.get("status") !== "OPEN") return false;
    const createdMs = Number(snap.get("createdAt")?.toMillis?.() || 0);
    tx.update(ref, {
      status: "RESOLVED", resolvedBy: input.resolvedBy, resolvedByUid: clean(input.actorUid, 128) || null,
      resolutionNote: clean(input.note), resolverTier: resolverTierOf(input.resolvedBy),
      resolution: clean(input.resolution, 80) || (input.resolvedBy === "PERSONA" ? "MANUAL" : "AUTOMATICA"), actionTaken: clean(input.actionTaken ?? input.note), resolvedAt: FieldValue.serverTimestamp(),
      timeToResolveMs: createdMs ? Math.max(0, Date.now() - createdMs) : null,
    });
    // Lo que hizo la persona queda como candidato de aprendizaje para Hugo; no activa ninguna regla por sí solo.
    if (input.resolvedBy === "PERSONA") {
      tx.set(db.collection("agentResolutionLessons").doc(incidentId), {
        rootId: input.rootId, incidentId, entityType: clean(snap.get("entityType"), 40) || null, cause: clean(snap.get("cause")),
        actionTaken: clean(input.actionTaken ?? input.note), resolvedByUid: clean(input.actorUid, 128) || null,
        state: "PENDING_REVIEW", createdAt: FieldValue.serverTimestamp(),
      });
    }
    return true;
  });
}

/** Cierra los incidentes abiertos de una entidad cuando un agente completa la corrección. */
export async function resolveIncidentsForEntity(input: { rootId: string; entityId: string; resolvedBy: IncidentResolver; note: string; resolution?: string; actionTaken?: string }): Promise<number> {
  const open = await db.collection("agentIncidents").where("rootId", "==", input.rootId).where("entityId", "==", input.entityId).where("status", "==", "OPEN").limit(50).get();
  let resolved = 0;
  for (const doc of open.docs) if (await resolveIncident(doc.id, input)) resolved++;
  return resolved;
}

/** Bitácora de cada vez que una persona interviene sobre un agente; indica qué agente construir o afinar después. */
export async function recordIntervention(input: { rootId: string; kind: InterventionKind; actorUid: string; reason: string; agentId?: string | null; targetId?: string | null }): Promise<void> {
  await db.collection("agentInterventions").add({
    rootId: input.rootId, kind: input.kind, actorUid: input.actorUid, reason: clean(input.reason),
    agentId: clean(input.agentId, 64) || null, targetId: clean(input.targetId, 128) || null,
    reportDay: mexicoDayKey(),
    createdAt: FieldValue.serverTimestamp(),
  });
}
