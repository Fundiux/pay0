import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { logActivityBatch } from "../../utils/logActivity";
import { requireWhatsAppSuperadmin } from "./whatsappConnectorAuthority";
import { resolveObservableGroup, type ObserverGroupDb } from "./whatsappObserverGroups";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const MAX_CLIENTS_PER_CALL = 50;
const clean = (value: unknown, max = 160) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);

// One document per client: the WhatsApp group (a chat the agents see) that receives that client's documents.
// Several clients may point at the same group (a commission agent forwards to the end client).
// This stores only the link; sending stays with the delivery pipeline.
const assignmentId = (rootId: string, clientId: string) => `${rootId}__${encodeURIComponent(clientId)}`;

export const getClientWhatsAppGroups = onCall({ cors: true, timeoutSeconds: 60, memory: "256MiB" }, async (request) => {
  const { rootId } = await requireWhatsAppSuperadmin(request);
  const [chats, assignments] = await Promise.all([
    db.collection("whatsappAgentChats").where("rootId", "==", rootId).where("isGroup", "==", true).where("active", "==", true).limit(500).get(),
    db.collection("clientWhatsappGroups").where("rootId", "==", rootId).limit(1000).get(),
  ]);
  const groups = new Map<string, string>();
  for (const doc of chats.docs) groups.set(clean(doc.get("chatId"), 200), clean(doc.get("name")));
  return {
    ok: true,
    groups: [...groups.entries()].map(([chatId, name]) => ({ chatId, name })).sort((a, b) => a.name.localeCompare(b.name, "es")),
    assignments: assignments.docs.map((doc) => ({
      clientId: clean(doc.get("clientId")),
      groupChatId: clean(doc.get("groupChatId"), 200),
      groupName: clean(doc.get("groupName")),
    })),
  };
});

export const assignWhatsAppGroupToClients = onCall({ cors: true, timeoutSeconds: 120, memory: "256MiB" }, async (request) => {
  const { uid, rootId } = await requireWhatsAppSuperadmin(request);
  const action = clean(request.data?.action || "ASSIGN").toUpperCase();
  const groupChatId = clean(request.data?.groupChatId, 200);
  const clientIds: string[] = Array.from(
    new Set<string>((Array.isArray(request.data?.clienteIds) ? request.data.clienteIds : []).map((x: unknown) => clean(x, 160)).filter(Boolean)),
  );

  if (!["ASSIGN", "UNASSIGN"].includes(action)) throw new HttpsError("invalid-argument", "Accion no valida.");
  if (clientIds.length === 0) throw new HttpsError("invalid-argument", "Selecciona al menos un cliente.");
  if (clientIds.length > MAX_CLIENTS_PER_CALL) throw new HttpsError("invalid-argument", `Maximo ${MAX_CLIENTS_PER_CALL} clientes por vez.`);
  if (clientIds.some((id) => /[\\/\x00-\x1f]/.test(id) || id === "." || id === "..")) throw new HttpsError("invalid-argument", "Referencia de cliente no valida.");

  let groupName = "";
  if (action === "ASSIGN") {
    if (!groupChatId) throw new HttpsError("invalid-argument", "Selecciona un grupo de WhatsApp.");
    const group = await resolveObservableGroup(db as unknown as ObserverGroupDb, rootId, groupChatId);
    // Only groups the agents' own connectors see; the historic connector is being retired.
    if (!group || group.source !== "AGENT") throw new HttpsError("failed-precondition", "El grupo no existe en los chats de los agentes de este root.");
    groupName = group.name;
  }

  const clientSnaps = await db.getAll(...clientIds.map((id) => db.doc(`clients/${id}`)));
  const batch = db.batch();
  const done: string[] = [];
  const failed: { clientId: string; message: string }[] = [];

  clientSnaps.forEach((snap, index) => {
    const clientId = clientIds[index];
    // Ownership comes from the server record, never from the request.
    if (!snap.exists || clean(snap.get("rootId")) !== rootId) {
      failed.push({ clientId, message: "Cliente no encontrado en tu root." });
      return;
    }
    const ref = db.doc(`clientWhatsappGroups/${assignmentId(rootId, clientId)}`);
    const clientLabel = clean(snap.get("name") || snap.get("nombre") || snap.get("razonSocial")) || clientId;
    if (action === "ASSIGN") {
      batch.set(ref, { rootId, clientId, clientLabel, groupChatId, groupName, updatedBy: uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    } else {
      batch.delete(ref);
    }
    logActivityBatch(batch, db, {
      event: action === "ASSIGN" ? "CLIENTE_GRUPO_WHATSAPP_ASIGNADO" : "CLIENTE_GRUPO_WHATSAPP_RETIRADO",
      rootId,
      actorUid: uid,
      actorRole: "superadmin",
      referenceId: clientId,
      referenceType: "client",
      description: action === "ASSIGN" ? `Grupo de WhatsApp "${groupName}" asignado al cliente ${clientLabel}.` : `Grupo de WhatsApp retirado del cliente ${clientLabel}.`,
    });
    done.push(clientId);
  });

  if (done.length > 0) await batch.commit();

  return {
    ok: failed.length === 0,
    action,
    groupChatId: action === "ASSIGN" ? groupChatId : null,
    groupName: action === "ASSIGN" ? groupName : null,
    doneCount: done.length,
    done,
    failed,
    message: failed.length === 0 ? `${done.length} cliente(s) actualizados.` : `${done.length} cliente(s) actualizados y ${failed.length} con error.`,
  };
});
