import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { requireWhatsAppSuperadmin } from "../documentDelivery/whatsappConnectorAuthority";
import { logActivity } from "../../utils/logActivity";
import { SIMULATED_REPLIES, SIMULATION_CONFIGS } from "./simulation";
import { simulationConfigId } from "./simulationRunner";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const clean = (value: unknown, max = 200) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// Owner only: the switch of the simulation (off by default) and the simulated replies to review. Nothing here sends anything.
export const setWhatsAppReplySimulation = onCall({ cors: true, timeoutSeconds: 30, memory: "256MiB" }, async request => {
  const { uid, rootId } = await requireWhatsAppSuperadmin(request);
  if (typeof request.data?.enabled !== "boolean") throw new HttpsError("invalid-argument", "Indica si la simulación queda encendida o apagada.");
  const enabled = request.data.enabled === true;
  await db.doc(`${SIMULATION_CONFIGS}/${simulationConfigId(rootId)}`).set({ rootId, agentId: "hugo", enabled, updatedBy: uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await logActivity({
    event: enabled ? "WHATSAPP_SIMULACION_ENCENDIDA" : "WHATSAPP_SIMULACION_APAGADA", rootId, actorUid: uid, actorRole: "superadmin", referenceId: simulationConfigId(rootId), referenceType: "whatsapp_reply_simulation",
    entityId: simulationConfigId(rootId), entityType: "whatsapp_reply_simulation", description: enabled ? "Se encendió la simulación de respuestas de Hugo." : "Se apagó la simulación de respuestas de Hugo.",
  }).catch(() => undefined);
  return { ok: true, enabled };
});

export const getWhatsAppSimulatedReplies = onCall({ cors: true, timeoutSeconds: 30, memory: "256MiB" }, async request => {
  const { rootId } = await requireWhatsAppSuperadmin(request);
  const [config, snap] = await Promise.all([
    db.doc(`${SIMULATION_CONFIGS}/${simulationConfigId(rootId)}`).get(),
    db.collection(SIMULATED_REPLIES).where("rootId", "==", rootId).limit(300).get(),
  ]);
  // Only a draft that passed the guard is returned as text; a rejected one only shows why it was rejected.
  const replies = snap.docs.map(doc => {
    const usable = doc.get("usable") === true && doc.get("status") === "SIMULATED";
    return {
      id: doc.id, chatId: clean(doc.get("chatId")), groupName: clean(doc.get("groupName"), 160), clientPhrase: clean(doc.get("clientPhrase"), 160), lookup: clean(doc.get("lookup"), 20),
      status: clean(doc.get("status"), 30), usable, draft: usable ? clean(doc.get("draft"), 400) : null, guardReasons: ((doc.get("guardReasons") as string[]) || []).map(text => clean(text, 200)).slice(0, 5),
      monthKey: clean(doc.get("monthKey"), 7), createdAtMs: doc.get("createdAt")?.toMillis?.() ?? null,
    };
  }).sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));
  return { ok: true, enabled: config.get("enabled") === true, replies };
});
