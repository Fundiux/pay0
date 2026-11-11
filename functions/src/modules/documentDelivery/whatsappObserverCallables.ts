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
  const [configs, users, agentGroups] = await Promise.all([
    db.collection("whatsappAgentObservers").where("rootId", "==", rootId).limit(200).get(),
    db.collection("users").where("rootId", "==", rootId).limit(500).get(),
    db.collection("whatsappAgentChats").where("rootId", "==", rootId).where("isGroup", "==", true).where("active", "==", true).limit(500).get(),
  ]);
  // Solo se ofrecen los grupos que ven los conectores de los agentes; los de la conexión histórica ya no se mezclan.
  const uniqueGroups = new Map<string, string>();
  for (const doc of agentGroups.docs) uniqueGroups.set(clean(doc.get("chatId"), 200), clean(doc.get("name"), 160));
  return {
    ok: true,
    agents: AGENTS.map(agent => ({ id: agent.id, name: agent.name })),
    groups: [...uniqueGroups.entries()].map(([chatId, name]) => ({ chatId, name })),
    // Solo el nombre visible; el identificador viaja como valor del selector, nunca se muestra.
    users: users.docs.filter(doc => doc.get("isDeleted") !== true && (doc.get("active") ?? doc.get("isActive") ?? true) !== false)
      .map(doc => ({ uid: doc.id, name: clean(doc.get("displayName") || doc.get("nombreUsuario") || doc.get("usernameNormalized") || doc.get("username") || "Usuario", 120) }))
      .sort((a, b) => a.name.localeCompare(b.name, "es")),
    configs: configs.docs.map(doc => ({ groupChatId: doc.get("groupChatId"), groupName: doc.get("groupName") || "", active: doc.get("active") === true, ownerUserUid: doc.get("ownerUserUid") || "", observers: doc.get("observers") || [] })),
  };
});

export const saveWhatsAppAgentObservers = onCall({ cors: true, timeoutSeconds: 60, memory: "256MiB" }, async request => {
  const { uid, rootId } = await requireWhatsAppSuperadmin(request);
  const groupChatId = clean(request.data?.groupChatId, 200);
  const active = request.data?.active !== false;
  const rawObservers: unknown[] = Array.isArray(request.data?.observers) ? request.data.observers : [];
  if (!groupChatId || rawObservers.length > MAX_OBSERVERS_PER_GROUP) throw new HttpsError("invalid-argument", "Grupo requerido y máximo 10 observadores por grupo.");

  // Cada grupo pertenece a un usuario de PAY0: sin dueño no se lee ni se guarda nada del grupo.
  const ownerUserUid = clean(request.data?.ownerUserUid, 128);
  if (active && rawObservers.length > 0 && !ownerUserUid) throw new HttpsError("invalid-argument", "Elige el usuario al que pertenece el grupo.");
  if (ownerUserUid) {
    const owner = await db.doc(`users/${ownerUserUid}`).get();
    if (!owner.exists || String(owner.get("rootId") || owner.id) !== rootId || owner.get("isDeleted") === true) throw new HttpsError("invalid-argument", "Usuario del grupo no válido.");
  }

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

  let chat: FirebaseFirestore.DocumentSnapshot = await db.doc(`whatsappQrChats/${encodeURIComponent(groupChatId)}`).get();
  if (!chat.exists) {
    const viaAgent = await db.collection("whatsappAgentChats").where("rootId", "==", rootId).where("chatId", "==", groupChatId).limit(1).get();
    if (!viaAgent.empty) chat = viaAgent.docs[0];
  }
  if (!chat.exists || chat.get("rootId") !== rootId || chat.get("isGroup") !== true) throw new HttpsError("failed-precondition", "El grupo no existe en los chats sincronizados de este root.");

  await db.doc(`whatsappAgentObservers/${configId(rootId, groupChatId)}`).set({
    rootId, groupChatId, groupName: clean(chat.get("name")), observers, active, ownerUserUid,
    updatedBy: uid, updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { ok: true, observers: observers.length };
});
