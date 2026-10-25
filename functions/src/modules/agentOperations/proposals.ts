import * as admin from "firebase-admin";
import { createHash } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { AgentProposal } from "./contract";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

/** Drafts are inert evidence records; approval never invokes a tool or deployment. */
export async function draftRepeatedCauseProposal(rootId: string, cause: string) {
  if (!rootId || !cause || cause.length > 500) throw Error("INVALID_PROPOSAL_CAUSE");
  const incidents = await db.collection("agentIncidents").where("rootId", "==", rootId).limit(100).get();
  const matching = incidents.docs.filter(doc => doc.get("cause") === cause).slice(0, 10);
  if (matching.length < 2) return null;
  const id = createHash("sha256").update(JSON.stringify([rootId, cause])).digest("hex");
  const ref = db.collection("agentProposals").doc(id);
  const proposal: AgentProposal = {
    problem: `Causa repetida en ${matching.length} incidencias: ${cause}`,
    evidence: matching.map(doc => `agentIncidents/${doc.id}`),
    impact: "Requiere evaluar frecuencia e impacto antes de cualquier cambio operativo.",
    risk: "Una corrección general puede afectar expedientes no revisados.",
    scope: "Diagnóstico y propuesta; sin cambios automáticos de código, reglas o permisos.",
    effort: "Pendiente de evaluación humana.",
    rollback: "No aplica al borrador; cualquier implementación deberá incluir reversión concreta.",
    status: "DRAFT", executeAutomatically: false,
  };
  await db.runTransaction(async tx => {
    const current = await tx.get(ref);
    if (!current.exists) tx.create(ref, { ...proposal, rootId, proposedBy: "hugo", createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  });
  return id;
}

export async function transitionProposal(input: { rootId: string; proposalId: string; actorUid: string; status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED" }) {
  const ref = db.collection("agentProposals").doc(input.proposalId);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.get("rootId") !== input.rootId || snap.get("executeAutomatically") !== false) throw Error("PROPOSAL_NOT_FOUND");
    const previous = snap.get("status");
    if (input.status === "PENDING_APPROVAL" ? previous !== "DRAFT" : previous !== "PENDING_APPROVAL") throw Error("INVALID_PROPOSAL_TRANSITION");
    tx.update(ref, { status: input.status, reviewedBy: input.actorUid, reviewedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    tx.create(db.collection("agentLedger").doc(), { rootId: input.rootId, actorUid: input.actorUid, agentId: "hugo", action: "PROPOSAL_REVIEW", proposalId: input.proposalId, result: input.status, executable: false, at: FieldValue.serverTimestamp() });
  });
}

export type AgentBlueprintInput = { rootId: string; actorUid: string; systemId: string; systemName: string; agentName: string; specialty: string; tools: string[]; permissions: string[]; tests: string[]; risks: string[] };
export async function draftAgentBlueprint(input: AgentBlueprintInput) {
  const fields = [input.rootId, input.actorUid, input.systemId, input.systemName, input.agentName, input.specialty];
  const lists = [input.tools, input.permissions, input.tests, input.risks];
  if (fields.some(value => typeof value !== "string" || !value.trim() || value.length > 120) || !/^[a-z0-9-]{2,40}$/.test(input.systemId) || lists.some(list => !Array.isArray(list) || !list.length || list.length > 20 || list.some(value => typeof value !== "string" || !value.trim() || value.length > 200))) throw Error("INVALID_AGENT_BLUEPRINT");
  const ref = db.collection("agentBlueprints").doc();
  const proposalRef = db.collection("agentProposals").doc(ref.id);
  const batch = db.batch();
  batch.create(ref, { ...input, id: ref.id, status: "SANDBOX_DRAFT", sandboxOnly: true, published: false, grantsPermissions: false, createdAt: FieldValue.serverTimestamp() });
  batch.create(proposalRef, { rootId: input.rootId, blueprintId: ref.id, proposedBy: "agent-creator", problem: `Evaluar sistema ${input.systemName} y agente ${input.agentName}.`, evidence: input.tests, impact: "Pendiente de evaluación humana.", risk: input.risks.join("; "), scope: `Sistema ${input.systemId}; herramientas: ${input.tools.join(", ")}; permisos propuestos: ${input.permissions.join(", ")}.`, effort: "Pendiente de estimación.", rollback: "El prototipo permanece en sandbox; la publicación requeriría un cambio separado y reversible.", status: "DRAFT", executeAutomatically: false, createdAt: FieldValue.serverTimestamp() });
  await batch.commit();
  return { blueprintId: ref.id, proposalId: proposalRef.id, published: false };
}
