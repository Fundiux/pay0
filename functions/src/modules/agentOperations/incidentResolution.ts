import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { mexicoDayKey } from "./time";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const clean = (value: unknown, max = 500) => String(value ?? "").trim().slice(0, max);

/** Quién cerró el incidente; alimenta la tasa de autonomía de los agentes. */
export type IncidentResolver = "AGENTE" | "ORQUESTADOR" | "PERSONA";
export type InterventionKind = "INCIDENT_RESOLVED" | "PROPOSAL_REVIEWED" | "KILL_SWITCH";

/** Cierra un incidente abierto de forma idempotente y guarda quién lo resolvió y cuánto tardó. */
export async function resolveIncident(incidentId: string, input: { rootId: string; resolvedBy: IncidentResolver; actorUid?: string | null; note: string }): Promise<boolean> {
  const ref = db.collection("agentIncidents").doc(incidentId);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.get("rootId") !== input.rootId || snap.get("status") !== "OPEN") return false;
    const createdMs = Number(snap.get("createdAt")?.toMillis?.() || 0);
    tx.update(ref, {
      status: "RESOLVED", resolvedBy: input.resolvedBy, resolvedByUid: clean(input.actorUid, 128) || null,
      resolutionNote: clean(input.note), resolvedAt: FieldValue.serverTimestamp(),
      timeToResolveMs: createdMs ? Math.max(0, Date.now() - createdMs) : null,
    });
    return true;
  });
}

/** Cierra los incidentes abiertos de una entidad cuando un agente completa la corrección. */
export async function resolveIncidentsForEntity(input: { rootId: string; entityId: string; resolvedBy: IncidentResolver; note: string }): Promise<number> {
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
