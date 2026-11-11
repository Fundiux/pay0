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
import { recordIntervention, resolveIncident } from "./incidentResolution";
import { groupIncidents, incidentsOfTheDay, loadIncidentSubjects } from "./incidentLabels";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
async function authorized(request: any) {
  const uid = requireAuth(request);
  const user = await getMyUser(uid);
  assertAuthorized(request.auth, user, { allowedRoles: ["superadmin"], requiredModule: "solicitudes", requiredAction: "view" });
  return { uid, rootId: String(user?.rootId || uid) };
}

/** Resumen de tokens por proveedor de IA (sin montos): permite ver dependencia de IAs externas. */
export function tokenSummary(traces: Array<Record<string, any>>) {
  const byProvider: Record<string, { requests: number; input: number; output: number; reasoning: number }> = {};
  for (const row of traces) {
    const key = String(row.modelProvider || "SIN_MODELO");
    const entry = byProvider[key] || (byProvider[key] = { requests: 0, input: 0, output: 0, reasoning: 0 });
    entry.requests += 1;
    entry.input += Number(row.tokenUsage?.input || 0);
    entry.output += Number(row.tokenUsage?.output || 0);
    entry.reasoning += Number(row.tokenUsage?.reasoning || 0);
  }
  return Object.entries(byProvider).map(([provider, value]) => ({ provider, ...value })).sort((a, b) => b.requests - a.requests);
}

const average = (values: number[]) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;

/** Indicadores de autonomía: cuánto resuelven solos los agentes frente a cuánto requiere a una persona. */
export function autonomyReport(todayRuns: Array<Record<string, any>>, recentIncidents: Array<Record<string, any>>, interventionsToday: number) {
  const visible = recentIncidents.filter(row => row.reportingExcluded !== true);
  const resolved = visible.filter(row => row.status === "RESOLVED");
  const byAgent = resolved.filter(row => row.resolvedBy === "AGENTE" || row.resolvedBy === "ORQUESTADOR").length;
  const byPerson = resolved.filter(row => row.resolvedBy === "PERSONA").length;
  const finishedRuns = todayRuns.filter(row => ["SUCCEEDED", "ESCALATED", "BLOCKED", "FAILED_RETRYABLE"].includes(row.status));
  return {
    openIncidents: visible.filter(row => row.status === "OPEN").length,
    resolvedByAgent: byAgent, resolvedByPerson: byPerson,
    agentResolutionRate: byAgent + byPerson ? Math.round((byAgent / (byAgent + byPerson)) * 100) : null,
    runsSucceeded: finishedRuns.filter(row => row.status === "SUCCEEDED").length, runsFinished: finishedRuns.length,
    avgRunMs: average(finishedRuns.map(row => Number(row.durationMs)).filter(value => Number.isFinite(value) && value >= 0)),
    avgTimeToResolveMs: average(resolved.map(row => Number(row.timeToResolveMs)).filter(value => Number.isFinite(value) && value >= 0)),
    humanInterventionsToday: interventionsToday,
  };
}

export async function loadAgentOperations(rootId: string) {
  const day = mexicoDayKey();
  const dayStart = admin.firestore.Timestamp.fromDate(new Date(`${day}T00:00:00-06:00`));
  const [control, runs, dailyRuns, incidents, dailyIncidents, proposals, dailyInterventions, dailyTraces] = await Promise.all([
    db.collection("agentControls").doc(rootId).get(),
    db.collection("agentRuns").where("rootId", "==", rootId).orderBy("updatedAt", "desc").limit(100).get(),
    db.collection("agentRuns").where("rootId", "==", rootId).where("reportDay", "==", day).limit(500).get(),
    db.collection("agentIncidents").where("rootId", "==", rootId).orderBy("createdAt", "desc").limit(100).get(),
    db.collection("agentIncidents").where("rootId", "==", rootId).where("reportDay", "==", day).limit(500).get(),
    db.collection("agentProposals").where("rootId", "==", rootId).orderBy("createdAt", "desc").limit(100).get(),
    db.collection("agentInterventions").where("rootId", "==", rootId).where("reportDay", "==", day).limit(500).get(),
    db.collection("agent007Traces").where("rootId", "==", rootId).where("timestamp", ">=", dayStart).orderBy("timestamp", "desc").limit(1000).get(),
  ]);
  const serialize = (snap: FirebaseFirestore.QuerySnapshot) => snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  const runRows = serialize(runs) as Array<Record<string, any>>;
  const today = serialize(dailyRuns) as Array<Record<string, any>>;
  const visible = (row: Record<string, any>) => row.reportingExcluded !== true;
  const todayIncidents = (serialize(dailyIncidents) as Array<Record<string, any>>).filter(visible);
  const causes = Object.entries(todayIncidents.reduce((acc, row) => { const key = String(row.cause || "Sin causa registrada"); acc[key] = (acc[key] || 0) + 1; return acc; }, {} as Record<string, number>)).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([cause, count]) => ({ cause, count }));
  const providerStatus = new HugoModelRouter().status();
  const visibleIncidents = serialize(incidents).filter(visible) as Array<Record<string, any>>;
  const incidentGroups = incidentsOfTheDay(groupIncidents(visibleIncidents, await loadIncidentSubjects(rootId, visibleIncidents).catch(error => { console.error("INCIDENT_SUBJECTS_FAILED", String(error?.message || error).slice(0, 200)); return new Map(); })), day);
  return { ok: true, systems: SYSTEMS, agents: AGENTS, tools: TOOLS, killSwitch: control.get("killSwitch") === true,
    providers: providerStatus,
    runs: runRows, incidents: visibleIncidents, incidentGroups, proposals: serialize(proposals).filter(visible),
    report: { day, reviewed: new Set(today.map(row => row.entityId)).size,
      detected: today.length, incidents: todayIncidents.length,
      generated: today.filter(row => row.toolId === "quotation-recovery" && row.status === "SUCCEEDED" && row.resolution === "GENERATED_NORMAL").length,
      corrected: today.filter(row => row.toolId === "quotation-recovery" && row.status === "SUCCEEDED" && ["RECOVERED_EXISTING", "RECOVERED_MISSING"].includes(row.resolution)).length,
      verified: today.filter(row => row.toolId === "quotation-recovery" && row.status === "SUCCEEDED" && row.uploadId && ["RECOVERED_EXISTING", "RECOVERED_MISSING"].includes(row.resolution)).length,
      escalated: today.filter(row => ["ESCALATED", "BLOCKED"].includes(row.status)).length,
      retryable: today.filter(row => row.status === "FAILED_RETRYABLE").length,
      causes,
      tokens: tokenSummary(dailyTraces.docs.map(doc => doc.data())),
      autonomy: autonomyReport(today, serialize(incidents) as Array<Record<string, any>>, dailyInterventions.size) },
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
  await recordIntervention({ rootId, kind: "KILL_SWITCH", actorUid: uid, agentId: "hugo", reason: request.data.enabled ? "Kill switch activado." : "Kill switch desactivado." }).catch(error => console.error("INTERVENTION_LOG_FAILED", error));
  return { ok: true, enabled: request.data.enabled };
});

export const reviewAgentProposal = onCall({ cors: true, region: "us-central1" }, async request => {
  const { uid, rootId } = await authorized(request);
  const proposalId = String(request.data?.proposalId || "").trim();
  const status = request.data?.status;
  if (!/^[a-f0-9]{64}$/.test(proposalId) || !["PENDING_APPROVAL", "APPROVED", "REJECTED"].includes(status)) throw new HttpsError("invalid-argument", "Propuesta o estado inválido.");
  try { await transitionProposal({ rootId, proposalId, actorUid: uid, status }); }
  catch { throw new HttpsError("failed-precondition", "La transición de la propuesta no está permitida."); }
  await recordIntervention({ rootId, kind: "PROPOSAL_REVIEWED", actorUid: uid, targetId: proposalId, reason: `Propuesta marcada ${status}.` }).catch(error => console.error("INTERVENTION_LOG_FAILED", error));
  return { ok: true, status, executeAutomatically: false };
});

export const resolveAgentIncident = onCall({ cors: true, region: "us-central1" }, async request => {
  const { uid, rootId } = await authorized(request);
  const incidentId = String(request.data?.incidentId || "").trim();
  const reason = String(request.data?.reason || "").trim();
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(incidentId) || reason.length < 5) throw new HttpsError("invalid-argument", "Incidente y motivo (mínimo 5 caracteres) requeridos.");
  const resolved = await resolveIncident(incidentId, { rootId, resolvedBy: "PERSONA", actorUid: uid, note: reason, resolution: "MANUAL", actionTaken: reason });
  if (!resolved) throw new HttpsError("failed-precondition", "El incidente no existe, no pertenece a este root o ya está cerrado.");
  await recordIntervention({ rootId, kind: "INCIDENT_RESOLVED", actorUid: uid, targetId: incidentId, reason }).catch(error => console.error("INTERVENTION_LOG_FAILED", error));
  return { ok: true };
});

export const createAgentBlueprintDraft = onCall({ cors: true, region: "us-central1" }, async request => {
  const { uid, rootId } = await authorized(request);
  try { return await draftAgentBlueprint({ ...request.data, rootId, actorUid: uid }); }
  catch (error) { if ((error as Error).message === "INVALID_AGENT_BLUEPRINT") throw new HttpsError("invalid-argument", "El prototipo de agente no es válido."); throw error; }
});
