import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

import { resolveIncident } from "../agentOperations/incidentResolution";
import { mexicoDayKey } from "../agentOperations/time";

// A dispersion that the automatic send to the external system could not finish must be visible to the
// resolution ladder (system, then Hugo, then a person) instead of waiting for someone to press a button.
// One deterministic incident per dispersion keeps retries from piling up duplicates.

export type DispersionIqIncidentDecision = "OPEN" | "RESOLVE" | "NONE";

const NEEDS_ATTENTION = new Set(["IQ_REQUIERE_REVISION", "IQ_ERROR_SEGURO"]);

export function dispersionIqIncidentDecision(aggregateStatus: unknown): DispersionIqIncidentDecision {
  const status = String(aggregateStatus ?? "").trim().toUpperCase();
  if (NEEDS_ATTENTION.has(status)) return "OPEN";
  return status === "IQ_GENERADA" ? "RESOLVE" : "NONE";
}

export const dispersionIqIncidentId = (dispersionId: string) => `dispersion-envio-${String(dispersionId).trim()}`;

/** Spanish cause shown in Hugo's incident view; it never names the external system. */
export function dispersionIqIncidentCause(aggregateStatus: unknown): string {
  return String(aggregateStatus ?? "").trim().toUpperCase() === "IQ_REQUIERE_REVISION"
    ? "La dispersion no tiene un resultado confirmado y requiere revision antes de reintentar"
    : "La dispersion no se pudo generar automaticamente";
}

export async function syncDispersionIqIncident(input: {
  db: admin.firestore.Firestore;
  rootId: string;
  dispersionId: string;
  aggregateStatus: unknown;
  evidence?: Record<string, unknown>;
}): Promise<void> {
  const decision = dispersionIqIncidentDecision(input.aggregateStatus);
  if (decision === "NONE" || !input.rootId || !input.dispersionId) return;
  const id = dispersionIqIncidentId(input.dispersionId);
  if (decision === "RESOLVE") {
    await resolveIncident(id, {
      rootId: input.rootId, resolvedBy: "AGENTE",
      note: "La dispersion se genero automaticamente en un reintento.",
      resolution: "AUTOMATICA", actionTaken: "Reintento automatico del sistema",
    });
    return;
  }
  const ref = input.db.collection("agentIncidents").doc(id);
  await input.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    // An open incident is left alone; a closed one is reopened only when the failure comes back.
    if (snap.exists && snap.get("status") === "OPEN") return;
    tx.set(ref, {
      rootId: input.rootId, reportDay: mexicoDayKey(), runId: id, correlationId: id,
      entityType: "dispersion", entityId: input.dispersionId, status: "OPEN",
      cause: dispersionIqIncidentCause(input.aggregateStatus),
      evidence: { aggregateStatus: String(input.aggregateStatus ?? ""), ...(input.evidence || {}) },
      createdAt: FieldValue.serverTimestamp(),
    });
  });
}
