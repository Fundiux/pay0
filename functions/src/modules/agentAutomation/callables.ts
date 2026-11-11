import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { assertAuthorized } from "../../utils/authGuard";
import { getMyUser, requireAuth } from "../sharedCallables/helpers";
import { recordIntervention } from "../agentOperations/incidentResolution";
import { reviewAutomationRule, runAutomationCycle } from "./service";
import { defaultAutomationDeps } from "./tools";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const ACTIONS = ["APPROVE", "REJECT", "REVOKE", "PAUSE", "RESUME", "KILL_ON", "KILL_OFF"] as const;

/** El dueño aprueba, rechaza, revoca o pausa una regla, o activa el interruptor global. Lista para que la reutilice MAT. */
export const reviewAgentAutomationRule = onCall({ cors: true, region: "us-central1" }, async request => {
  const uid = requireAuth(request);
  const user = await getMyUser(uid);
  assertAuthorized(request.auth, user, { allowedRoles: ["superadmin"], requiredModule: "solicitudes", requiredAction: "view" });
  const rootId = String(user?.rootId || uid);
  const action = String(request.data?.action || "");
  const ruleId = String(request.data?.ruleId || "").trim();
  if (!(ACTIONS as readonly string[]).includes(action)) throw new HttpsError("invalid-argument", "Acción no válida.");
  const global = action === "KILL_ON" || action === "KILL_OFF";
  if (!global && !/^[a-f0-9]{32}$/.test(ruleId)) throw new HttpsError("invalid-argument", "Regla no válida.");
  try {
    const result = await reviewAutomationRule({ rootId, ruleId, action: action as any, actorUid: uid });
    await recordIntervention({ rootId, kind: "PROPOSAL_REVIEWED", actorUid: uid, targetId: global ? null : ruleId, reason: `Automatización: ${action}` }).catch(error => console.error("INTERVENTION_LOG_FAILED", error));
    return { ok: true, ...result };
  } catch (error) {
    const message = (error as Error)?.message;
    if (message === "RULE_NOT_FOUND") throw new HttpsError("not-found", "La regla no existe.");
    if (message === "RULE_TRANSITION_INVALID") throw new HttpsError("failed-precondition", "Esa acción no aplica al estado actual de la regla.");
    throw error;
  }
});

/** Normaliza lecciones, propone reglas, evalúa incidencias abiertas y verifica lo ejecutado. */
export const processAgentAutomationRules = onSchedule({ schedule: "every 15 minutes", timeZone: "America/Mexico_City", timeoutSeconds: 300, memory: "512MiB" }, async () => {
  const roots = new Set<string>();
  const [lessons, rules] = await Promise.all([
    db.collection("agentResolutionLessons").where("state", "in", ["PENDING_REVIEW", "NORMALIZED"]).limit(200).get(),
    db.collection("agentAutomationRules").where("status", "in", ["SIMULACION", "ACTIVA"]).limit(200).get(),
  ]);
  for (const doc of [...lessons.docs, ...rules.docs]) { const rootId = String(doc.get("rootId") || ""); if (rootId) roots.add(rootId); }
  const deps = defaultAutomationDeps();
  for (const rootId of roots) {
    try { await runAutomationCycle(rootId, deps); }
    catch (error) { console.error("AGENT_AUTOMATION_CYCLE_FAILED", rootId, String((error as Error)?.message || error).slice(0, 200)); }
  }
});
