import * as admin from "firebase-admin";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { queueAutomaticClientDelivery } from "./whatsappAutomaticDelivery";
import { buildGroupAlertText, checkClientGroupAgents, mexicoDayStartMs } from "./whatsappDeliveryDomain";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const clean = (value: unknown, max = 200) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);

/**
 * When a client has a new solicitud, check that the client has a WhatsApp group and that Hugo, Maria and Sofia
 * are all in it. If not, Hugo reports it once per client, problem and day in the owner's internal group.
 * Returns what happened so it can be tested and logged.
 */
export async function alertIfClientGroupIncomplete(input: { rootId: string; clienteId: string; nowMs?: number }): Promise<string> {
  const { rootId, clienteId } = input;
  const nowMs = input.nowMs ?? Date.now();
  if (!rootId || !clienteId) return "NO_CLIENT";

  const clientSnap = await db.doc(`clients/${clienteId}`).get();
  if (!clientSnap.exists || clean(clientSnap.get("rootId")) !== rootId) return "CLIENT_OUT_OF_SCOPE";

  const assignmentSnap = await db.doc(`clientWhatsappGroups/${rootId}__${encodeURIComponent(clienteId)}`).get();
  const groupChatId = assignmentSnap.exists && clean(assignmentSnap.get("rootId")) === rootId ? clean(assignmentSnap.get("groupChatId")) : "";

  const [bindings, chats] = await Promise.all([
    db.collection("whatsappQrConnectorBindings").where("rootId", "==", rootId).limit(50).get(),
    groupChatId
      ? db.collection("whatsappAgentChats").where("rootId", "==", rootId).where("chatId", "==", groupChatId).limit(25).get()
      : Promise.resolve({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] }),
  ]);

  const check = checkClientGroupAgents({
    rootId,
    groupChatId,
    bindings: bindings.docs.map((doc) => ({ id: doc.id, agentId: doc.get("agentId"), state: doc.get("state"), rootId: doc.get("rootId") })),
    chats: chats.docs.map((doc) => doc.data() as Record<string, unknown>),
  });

  const clientName = clean(clientSnap.get("name") || clientSnap.get("nombre") || clientSnap.get("razonSocial"), 120);
  const text = buildGroupAlertText({ clientName, check });
  if (!text) return "COMPLETE";

  // One notice per client, problem and Mexico City day: the text is part of the job fingerprint, so a changed problem sends again.
  const day = mexicoDayStartMs(nowMs);
  const result = await queueAutomaticClientDelivery({
    rootId,
    sourceType: "AVISO_GRUPO_INTERNO",
    sourceId: `${clienteId}:${day}`,
    clienteId,
    clienteNombre: clientName || null,
    caption: "",
    textBody: text,
    notes: "Aviso interno: grupo de WhatsApp del cliente.",
  });
  return `${check.status}:${result}`;
}

export const alertClientGroupOnSolicitud = onDocumentCreated(
  { document: "solicitudes/{solicitudId}", region: "us-central1", retry: false, maxInstances: 1, concurrency: 1, timeoutSeconds: 120, memory: "512MiB" },
  async (event) => {
    const solicitud = event.data?.data() || {};
    const rootId = clean(solicitud.rootId);
    const clienteId = clean(solicitud.clienteId ?? solicitud.clientId, 300);
    try {
      await alertIfClientGroupIncomplete({ rootId, clienteId });
    } catch (error) {
      console.error("CLIENT_GROUP_ALERT_FAILED", { rootId, clienteId, message: (error instanceof Error ? error.message : String(error)).slice(0, 200) });
    }
  },
);
