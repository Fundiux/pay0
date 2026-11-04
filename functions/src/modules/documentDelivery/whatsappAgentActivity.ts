import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { requireWhatsAppSuperadmin } from "./whatsappConnectorAuthority";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const MAX_DAYS = 14;
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" });

export type ActivityMessage = { agentId: string; chatId: string; fromMe: boolean; timestampMs: number };

/**
 * Por agente y grupo: mensajes del agente, mensajes recibidos de otros y tiempo de respuesta.
 * Un mensaje de otra persona abre una espera; el siguiente mensaje del agente la cierra y mide el tiempo.
 * Las esperas que siguen abiertas al final cuentan como mensajes sin respuesta.
 */
export function summarizeAgentActivity(messages: ActivityMessage[]) {
  const groups = new Map<string, ActivityMessage[]>();
  for (const message of messages) {
    const key = `${message.agentId}\u0000${message.chatId}`;
    const list = groups.get(key) || [];
    list.push(message);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([key, list]) => {
    const [agentId, chatId] = key.split("\u0000");
    list.sort((a, b) => a.timestampMs - b.timestampMs);
    let waitingSince: number | null = null, answered = 0, sent = 0, received = 0;
    const responseMs: number[] = [];
    for (const message of list) {
      if (message.fromMe) {
        sent++;
        if (waitingSince !== null) { responseMs.push(Math.max(0, message.timestampMs - waitingSince)); answered++; waitingSince = null; }
      } else {
        received++;
        if (waitingSince === null) waitingSince = message.timestampMs;
      }
    }
    const sorted = [...responseMs].sort((a, b) => a - b);
    return {
      agentId, chatId, sent, received, answered, unanswered: waitingSince !== null ? 1 : 0,
      avgResponseMs: responseMs.length ? Math.round(responseMs.reduce((sum, value) => sum + value, 0) / responseMs.length) : null,
      medianResponseMs: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
    };
  }).sort((a, b) => (a.agentId + a.chatId).localeCompare(b.agentId + b.chatId));
}

export const getWhatsAppAgentActivity = onCall({ cors: true, timeoutSeconds: 120, memory: "512MiB" }, async request => {
  const { rootId } = await requireWhatsAppSuperadmin(request);
  const days = Math.min(MAX_DAYS, Math.max(1, Math.trunc(Number(request.data?.days) || 7)));
  if (!Number.isFinite(days)) throw new HttpsError("invalid-argument", "Días inválidos.");
  const keys = Array.from({ length: days }, (_, index) => dayKey.format(new Date(Date.now() - index * 86_400_000)));
  const snaps = await Promise.all(keys.map(day => db.collection("whatsappInboundMessages").where("rootId", "==", rootId).where("reportDay", "==", day).limit(5000).get()));
  const truncated = snaps.some(snap => snap.size === 5000);
  const messages: ActivityMessage[] = snaps.flatMap(snap => snap.docs.map(doc => ({
    agentId: String(doc.get("agentId")), chatId: String(doc.get("chatId")), fromMe: doc.get("fromMe") === true, timestampMs: Number(doc.get("timestampMs")) || 0,
  })));
  return { ok: true, days, truncated, totalMessages: messages.length, rows: summarizeAgentActivity(messages) };
});

// Retención: los mensajes capturados se eliminan al vencer expiresAt (30 días).
export const purgeExpiredWhatsAppInboundMessages = onSchedule({ schedule: "30 3 * * *", timeZone: "America/Mexico_City", region: "us-central1", retryCount: 0 }, async () => {
  for (let round = 0; round < 20; round++) {
    const expired = await db.collection("whatsappInboundMessages").where("expiresAt", "<=", new Date()).limit(400).get();
    if (expired.empty) return;
    const batch = db.batch();
    expired.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    if (expired.size < 400) return;
  }
});
