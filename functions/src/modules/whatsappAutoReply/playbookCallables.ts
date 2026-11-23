import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { requireWhatsAppSuperadmin } from "../documentDelivery/whatsappConnectorAuthority";
import { logActivity } from "../../utils/logActivity";
import { PLAYBOOK, SIMULATION_MS, validateGuidance } from "./playbook";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const clean = (value: unknown, max = 200) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// Proposals and approved guidance per group. Only the owner reads and decides them.
export const getWhatsAppAgentPlaybook = onCall({ cors: true, timeoutSeconds: 30, memory: "256MiB" }, async request => {
  const { rootId } = await requireWhatsAppSuperadmin(request);
  const snap = await db.collection(PLAYBOOK).where("rootId", "==", rootId).limit(300).get();
  const entries = snap.docs.map(doc => ({
    id: doc.id, chatId: clean(doc.get("chatId")), groupName: clean(doc.get("groupName"), 160), type: clean(doc.get("type"), 40), kind: clean(doc.get("kind"), 40),
    subject: doc.get("subject") || null, category: doc.get("category") || null, status: clean(doc.get("status"), 20), evidenceCount: Number(doc.get("evidenceCount")) || 0,
    examples: ((doc.get("examples") as string[]) || []).map(text => clean(text, 160)).slice(0, 3), suggestedGuidance: clean(doc.get("suggestedGuidance"), 400),
    guidance: clean(doc.get("guidance"), 400), simulationEndsAtMs: Number(doc.get("simulationEndsAtMs")) || null,
  }));
  const rank: Record<string, number> = { PROPOSED: 0, APPROVED: 1, REJECTED: 2 };
  entries.sort((a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3) || b.evidenceCount - a.evidenceCount);
  return { ok: true, entries };
});

// The owner approves (with the guidance text, validated) or rejects one proposal. Approval starts a 3-day simulation:
// nothing is sent to a client from it until the simulation has been reviewed.
export const decideWhatsAppPlaybookEntry = onCall({ cors: true, timeoutSeconds: 30, memory: "256MiB" }, async request => {
  const { uid, rootId } = await requireWhatsAppSuperadmin(request);
  const id = clean(request.data?.id, 80), decision = request.data?.decision, guidance = clean(request.data?.guidance, 500);
  if (!id) throw new HttpsError("invalid-argument", "Propuesta requerida.");
  if (decision !== "APPROVE" && decision !== "REJECT") throw new HttpsError("invalid-argument", "Decisión inválida.");
  if (decision === "APPROVE") {
    const problem = validateGuidance(guidance);
    if (problem) throw new HttpsError("invalid-argument", problem);
  }
  const ref = db.doc(`${PLAYBOOK}/${id}`);
  const result = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.get("rootId") !== rootId) throw new HttpsError("not-found", "No se encontró esa propuesta.");
    if (snap.get("status") !== "PROPOSED") throw new HttpsError("failed-precondition", "Esa propuesta ya fue decidida.");
    const nowMs = Date.now();
    tx.update(ref, decision === "APPROVE"
      ? { status: "APPROVED", guidance, approvedBy: uid, approvedAtMs: nowMs, simulationEndsAtMs: nowMs + SIMULATION_MS, updatedAt: FieldValue.serverTimestamp() }
      : { status: "REJECTED", rejectedBy: uid, rejectedAtMs: nowMs, updatedAt: FieldValue.serverTimestamp() });
    return { groupName: clean(snap.get("groupName"), 160), simulationEndsAtMs: decision === "APPROVE" ? nowMs + SIMULATION_MS : null };
  });
  await logActivity({
    event: decision === "APPROVE" ? "WHATSAPP_APRENDIZAJE_APROBADO" : "WHATSAPP_APRENDIZAJE_RECHAZADO", rootId, actorUid: uid, actorRole: "superadmin", referenceId: id, referenceType: "whatsapp_agent_playbook",
    entityId: id, entityType: "whatsapp_agent_playbook",
    description: decision === "APPROVE" ? `Se aprobó un aprendizaje de Hugo para el grupo ${result.groupName}; queda 3 días en simulación.` : `Se rechazó un aprendizaje propuesto para el grupo ${result.groupName}.`,
  }).catch(() => undefined);
  return { ok: true, status: decision === "APPROVE" ? "APPROVED" : "REJECTED", simulationEndsAtMs: result.simulationEndsAtMs };
});
