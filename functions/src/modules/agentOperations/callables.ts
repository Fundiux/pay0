import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";
import { getMyUser, requireAuth } from "../sharedCallables/helpers";
import { AGENTS, TOOLS } from "./contract";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
async function authorized(request: any) {
  const uid = requireAuth(request);
  const user = await getMyUser(uid);
  assertAuthorized(request.auth, user, { allowedRoles: ["superadmin"], requiredModule: "solicitudes", requiredAction: "view" });
  return { uid, rootId: String(user?.rootId || uid) };
}

export const getAgentOperations = onCall({ cors: true, region: "us-central1" }, async request => {
  const { rootId } = await authorized(request);
  const [control, runs, incidents, proposals, jobs] = await Promise.all([
    db.collection("agentControls").doc(rootId).get(),
    db.collection("agentRuns").where("rootId", "==", rootId).limit(100).get(),
    db.collection("agentIncidents").where("rootId", "==", rootId).limit(100).get(),
    db.collection("agentProposals").where("rootId", "==", rootId).limit(100).get(),
    db.collection("solicitudQuotationJobs").where("rootId", "==", rootId).limit(500).get(),
  ]);
  const serialize = (snap: FirebaseFirestore.QuerySnapshot) => snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  const quoteRows = serialize(jobs) as Array<Record<string, any>>;
  const runRows = serialize(runs) as Array<Record<string, any>>;
  return { ok: true, agents: AGENTS, tools: TOOLS, killSwitch: control.get("killSwitch") === true,
    runs: runRows, incidents: serialize(incidents), proposals: serialize(proposals),
    report: { reviewed: quoteRows.length, detected: quoteRows.filter(row => row.status !== "SUCCEEDED").length,
      corrected: runRows.filter(row => row.toolId === "quotation-recovery" && row.status === "SUCCEEDED").length,
      escalated: quoteRows.filter(row => ["ESCALATED", "BLOCKED"].includes(row.status)).length },
    reportScope: "Muestra parcial: hasta 500 trabajos y 100 ejecuciones consultadas, sin filtro diario. No equivale a todas las Solicitudes ni a un reporte diario certificado.",
  };
});

export const setAgentKillSwitch = onCall({ cors: true, region: "us-central1" }, async request => {
  const { uid, rootId } = await authorized(request);
  if (typeof request.data?.enabled !== "boolean") throw new HttpsError("invalid-argument", "enabled requerido.");
  await db.collection("agentControls").doc(rootId).set({ killSwitch: request.data.enabled, changedBy: uid, changedAt: FieldValue.serverTimestamp() }, { merge: true });
  await db.collection("agentLedger").add({ rootId, actorUid: uid, agentId: "hugo", action: "KILL_SWITCH", result: request.data.enabled ? "ENABLED" : "DISABLED", at: FieldValue.serverTimestamp() });
  return { ok: true, enabled: request.data.enabled };
});
