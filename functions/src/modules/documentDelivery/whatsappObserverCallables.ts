import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { normalizeClientWhatsapp } from "../clients/domain";
import { AGENTS } from "../agentOperations/contract";
import { requireWhatsAppSuperadmin } from "./whatsappConnectorAuthority";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const MAX_OBSERVERS_PER_GROUP = 10;
const clean = (value: unknown, max = 160) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);

// Configuración de qué agente observa cada grupo y con qué número. Solo registro:
// no lee mensajes; la captura de mensajes entrantes es un paso posterior que requiere aprobación.
const configId = (rootId: string, chatId: string) => `${rootId}__${encodeURIComponent(chatId)}`;

export const getWhatsAppAgentObservers = onCall({ cors: true, timeoutSeconds: 60, memory: "256MiB" }, async request => {
  const { rootId } = await requireWhatsAppSuperadmin(request);
  const [configs, groups] = await Promise.all([
    db.collection("whatsappAgentObservers").where("rootId", "==", rootId).limit(200).get(),
    db.collection("whatsappQrChats").where("rootId", "==", rootId).where("isGroup", "==", true).where("active", "==", true).limit(500).get(),
  ]);
  return {
    ok: true,
    agents: AGENTS.map(agent => ({ id: agent.id, name: agent.name })),
    groups: groups.docs.map(doc => ({ chatId: clean(doc.get("chatId"), 200), name: clean(doc.get("name"), 160) })),
    configs: configs.docs.map(doc => ({ groupChatId: doc.get("groupChatId"), groupName: doc.get("groupName") || "", active: doc.get("active") === true, observers: doc.get("observers") || [] })),
  };
});

export const saveWhatsAppAgentObservers = onCall({ cors: true, timeoutSeconds: 60, memory: "256MiB" }, async request => {
  const { uid, rootId } = await requireWhatsAppSuperadmin(request);
  const groupChatId = clean(request.data?.groupChatId, 200);
  const active = request.data?.active !== false;
  const rawObservers: unknown[] = Array.isArray(request.data?.observers) ? request.data.observers : [];
  if (!groupChatId || rawObservers.length > MAX_OBSERVERS_PER_GROUP) throw new HttpsError("invalid-argument", "Grupo requerido y máximo 10 observadores por grupo.");

  const knownAgents = new Set(AGENTS.map(agent => agent.id));
  const seenAgents = new Set<string>();
  const observers = rawObservers.map((row: any) => {
    // El número es solo informativo: cada agente se conectará con su propio QR (conector por agente).
    const agentId = clean(row?.agentId, 64), phone = normalizeClientWhatsapp(row?.phone);
    if (!knownAgents.has(agentId)) throw new HttpsError("invalid-argument", `Agente desconocido: ${agentId || "(vacío)"}.`);
    if (phone && (phone.length < 10 || phone.length > 15)) throw new HttpsError("invalid-argument", "Número de teléfono inválido.");
    if (seenAgents.has(agentId)) throw new HttpsError("invalid-argument", "Un agente solo puede aparecer una vez por grupo.");
    seenAgents.add(agentId);
    return { agentId, phone };
  });

  const chat = await db.doc(`whatsappQrChats/${encodeURIComponent(groupChatId)}`).get();
  if (!chat.exists || chat.get("rootId") !== rootId || chat.get("isGroup") !== true) throw new HttpsError("failed-precondition", "El grupo no existe en los chats sincronizados de este root.");

  await db.doc(`whatsappAgentObservers/${configId(rootId, groupChatId)}`).set({
    rootId, groupChatId, groupName: clean(chat.get("name")), observers, active,
    updatedBy: uid, updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { ok: true, observers: observers.length };
});
