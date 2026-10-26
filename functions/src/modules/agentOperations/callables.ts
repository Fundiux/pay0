import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";
import { getMyUser, requireAuth } from "../sharedCallables/helpers";
import { AGENTS, TOOLS } from "./contract";
import { mexicoDayKey } from "./time";
import { HugoModelRouter } from "../agent007/hugoModelRouter";
import { draftAgentBlueprint, transitionProposal } from "./proposals";
import { SYSTEMS } from "./systems";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
async function authorized(request: any) {
  const uid = requireAuth(request);
  const user = await getMyUser(uid);
  assertAuthorized(request.auth, user, { allowedRoles: ["superadmin"], requiredModule: "solicitudes", requiredAction: "view" });
  return { uid, rootId: String(user?.rootId || uid) };
}

export async function loadAgentOperations(rootId: string) {
  const day = mexicoDayKey();
  const [control, runs, dailyRuns, incidents, dailyIncidents, proposals] = await Promise.all([
    db.collection("agentControls").doc(rootId).get(),
    db.collection("agentRuns").where("rootId", "==", rootId).orderBy("updatedAt", "desc").limit(100).get(),
    db.collection("agentRuns").where("rootId", "==", rootId).where("reportDay", "==", day).limit(500).get(),
    db.collection("agentIncidents").where("rootId", "==", rootId).orderBy("createdAt", "desc").limit(100).get(),
    db.collection("agentIncidents").where("rootId", "==", rootId).where("reportDay", "==", day).limit(500).get(),
    db.collection("agentProposals").where("rootId", "==", rootId).orderBy("createdAt", "desc").limit(100).get(),
  ]);
  const serialize = (snap: FirebaseFirestore.QuerySnapshot) => snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  const runRows = serialize(runs) as Array<Record<string, any>>;
  const today = serialize(dailyRuns) as Array<Record<string, any>>;
  const visible = (row: Record<string, any>) => row.reportingExcluded !== true;
  const todayIncidents = (serialize(dailyIncidents) as Array<Record<string, any>>).filter(visible);
  const causes = Object.entries(todayIncidents.reduce((acc, row) => { const key = String(row.cause || "Sin causa registrada"); acc[key] = (acc[key] || 0) + 1; return acc; }, {} as Record<string, number>)).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([cause, count]) => ({ cause, count }));
  const providerStatus = new HugoModelRouter().status();
  return { ok: true, systems: SYSTEMS, agents: AGENTS, tools: TOOLS, killSwitch: control.get("killSwitch") === true,
    providers: providerStatus,
    runs: runRows, incidents: serialize(incidents).filter(visible), proposals: serialize(proposals).filter(visible),
    report: { day, reviewed: new Set(today.map(row => row.entityId)).size,
      detected: today.length, incidents: todayIncidents.length,
      generated: today.filter(row => row.toolId === "quotation-recovery" && row.status === "SUCCEEDED" && row.resolution === "GENERATED_NORMAL").length,
      corrected: today.filter(row => row.toolId === "quotation-recovery" && row.status === "SUCCEEDED" && ["RECOVERED_EXISTING", "RECOVERED_MISSING"].includes(row.resolution)).length,
      verified: today.filter(row => row.toolId === "quotation-recovery" && row.status === "SUCCEEDED" && row.uploadId && ["RECOVERED_EXISTING", "RECOVERED_MISSING"].includes(row.resolution)).length,
      escalated: today.filter(row => ["ESCALATED", "BLOCKED"].includes(row.status)).length,
      retryable: today.filter(row => row.status === "FAILED_RETRYABLE").length,
      causes },
    reportScope: dailyRuns.size === 500 || dailyIncidents.size === 500 ? "Reporte parcial: se alcanzó el límite de 500 ejecuciones o incidencias del día." : "Ejecuciones e incidencias registradas hoy en America/Mexico_City; no equivale a todas las Solicitudes del sistema.",
  };
}

export const getAgentOperations = onCall({ cors: true, region: "us-central1" }, async request => {
  const { rootId } = await authorized(request);
  return loadAgentOperations(rootId);
});

export const setAgentKillSwitch = onCall({ cors: true, region: "us-central1" }, async request => {
  const { uid, rootId } = await authorized(request);
  if (typeof request.data?.enabled !== "boolean") throw new HttpsError("invalid-argument", "enabled requerido.");
  await db.collection("agentControls").doc(rootId).set({ killSwitch: request.data.enabled, changedBy: uid, changedAt: FieldValue.serverTimestamp() }, { merge: true });
  await db.collection("agentLedger").add({ rootId, actorUid: uid, agentId: "hugo", action: "KILL_SWITCH", result: request.data.enabled ? "ENABLED" : "DISABLED", at: FieldValue.serverTimestamp() });
  return { ok: true, enabled: request.data.enabled };
});

export const reviewAgentProposal = onCall({ cors: true, region: "us-central1" }, async request => {
  const { uid, rootId } = await authorized(request);
  const proposalId = String(request.data?.proposalId || "").trim();
  const status = request.data?.status;
  if (!/^[a-f0-9]{64}$/.test(proposalId) || !["PENDING_APPROVAL", "APPROVED", "REJECTED"].includes(status)) throw new HttpsError("invalid-argument", "Propuesta o estado inválido.");
  try { await transitionProposal({ rootId, proposalId, actorUid: uid, status }); }
  catch { throw new HttpsError("failed-precondition", "La transición de la propuesta no está permitida."); }
  return { ok: true, status, executeAutomatically: false };
});

export const createAgentBlueprintDraft = onCall({ cors: true, region: "us-central1" }, async request => {
  const { uid, rootId } = await authorized(request);
  try { return await draftAgentBlueprint({ ...request.data, rootId, actorUid: uid }); }
  catch (error) { if ((error as Error).message === "INVALID_AGENT_BLUEPRINT") throw new HttpsError("invalid-argument", "El prototipo de agente no es válido."); throw error; }
});
