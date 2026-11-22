import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { requireWhatsAppSuperadmin } from "../documentDelivery/whatsappConnectorAuthority";
import { logActivity } from "../../utils/logActivity";
import { REPLY_AGENT_ID, REPLY_CONFIGS, readReplyConfig, replyConfigId } from "./runner";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

// Solo el superadmin ve y cambia el interruptor de las respuestas de Hugo. Apagado por defecto.
export const getWhatsAppAgentReplyConfig = onCall({ cors: true, timeoutSeconds: 30, memory: "256MiB" }, async request => {
  const { rootId } = await requireWhatsAppSuperadmin(request);
  return { ok: true, agentId: REPLY_AGENT_ID, ...(await readReplyConfig(rootId)) };
});

export const setWhatsAppAgentReplyConfig = onCall({ cors: true, timeoutSeconds: 30, memory: "256MiB" }, async request => {
  const { uid, rootId } = await requireWhatsAppSuperadmin(request);
  const enabled = request.data?.enabled, mode = request.data?.mode;
  if (typeof enabled !== "boolean") throw new HttpsError("invalid-argument", "enabled debe ser booleano.");
  if (mode !== "GREETINGS_ONLY" && mode !== "STANDARD") throw new HttpsError("invalid-argument", "Modo de respuesta inválido.");
  await db.doc(`${REPLY_CONFIGS}/${replyConfigId(rootId)}`).set({
    rootId, agentId: REPLY_AGENT_ID, enabled, mode, updatedBy: uid, updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await logActivity({
    event: enabled ? "WHATSAPP_RESPUESTAS_ACTIVADAS" : "WHATSAPP_RESPUESTAS_DESACTIVADAS", rootId, actorUid: uid, actorRole: "superadmin",
    referenceId: replyConfigId(rootId), referenceType: "whatsapp_reply_config",
    description: enabled ? `Respuestas de Hugo en grupos activadas (${mode === "STANDARD" ? "saludos y validación" : "solo saludos"}).` : "Respuestas de Hugo en grupos desactivadas.",
  }).catch(() => undefined);
  return { ok: true, enabled, mode };
});
