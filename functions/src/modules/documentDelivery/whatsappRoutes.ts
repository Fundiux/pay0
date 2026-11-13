import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { normalizeClientWhatsapp } from "../clients/domain";
import { chooseDeliveryDestination, DOCUMENT_SENDER_AGENT_ID, PROTECTED_DELIVERY_STATUSES } from "./whatsappDeliveryDomain";

export type WhatsAppDestinationRoute = {
  safeDocId: string;
  chatId: string;
  chatName: string;
  chatType: "GROUP" | "CONTACT";
  destinationType?: "CLIENT_PRIMARY" | "ADDITIONAL" | "CLIENT_GROUP";
  phone?: string;
  connectorId?: string;
};

function cleanText(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function normalizeWhatsAppRouteKey(value: unknown): string {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 140);
}

export function getWhatsAppJobClientLabel(job: any): string {
  return (
    cleanText(job?.clienteNombre) ||
    cleanText(job?.clientName) ||
    cleanText(job?.clienteName) ||
    cleanText(job?.targetLabel) ||
    cleanText(job?.customerName) ||
    "SIN_CLIENTE"
  );
}

export function getWhatsAppJobSourceType(job: any): string {
  return normalizeWhatsAppRouteKey(job?.sourceType || job?.documentType || "DEFAULT") || "DEFAULT";
}

export function buildWhatsAppRouteId(clienteId: unknown, sourceType: unknown): string {
  const clientId = cleanText(clienteId) || "SIN_CLIENTE";
  const sourceKey = normalizeWhatsAppRouteKey(sourceType) || "DEFAULT";
  return encodeURIComponent(`${clientId}__${sourceKey}`);
}

export function serializeWhatsAppDestination(chatDoc: admin.firestore.DocumentSnapshot): WhatsAppDestinationRoute {
  const data = chatDoc.data() || {};
  const chatId = cleanText(data.chatId);
  const chatName = cleanText(data.name || data.chatId);
  const safeDocId = cleanText(data.safeDocId || chatDoc.id);
  const chatType = data.isGroup === true ? "GROUP" : "CONTACT";

  if (!chatId) {
    throw new Error("Chat WhatsApp sin chatId.");
  }

  return {
    safeDocId,
    chatId,
    chatName,
    chatType,
  };
}

export async function getWhatsAppRouteForJob(
  db: admin.firestore.Firestore,
  job: any
): Promise<{ routeId: string; route: any; matchType: "EXACT" | "DEFAULT" } | null> {
  const clienteId = cleanText(job?.clienteId || job?.clientId);
  const sourceType = getWhatsAppJobSourceType(job);

  if (!clienteId) {
    return null;
  }

  // La ruta DEFAULT del cliente es su destino WhatsApp canonico
  // y tiene prioridad para cualquier comunicacion dirigida al cliente.
  const defaultId = buildWhatsAppRouteId(clienteId, "DEFAULT");
  const defaultSnap = await db.collection("whatsappDeliveryRoutes").doc(defaultId).get();

  if (defaultSnap.exists) {
    const defaultRoute = defaultSnap.data() || {};
    if (defaultRoute.active !== false) {
      return { routeId: defaultId, route: defaultRoute, matchType: "DEFAULT" };
    }
  }

  // Compatibilidad con rutas especificas existentes:
  // solo se usan cuando el cliente aun no tiene ruta DEFAULT.
  const exactId = buildWhatsAppRouteId(clienteId, sourceType);
  const exactSnap = await db.collection("whatsappDeliveryRoutes").doc(exactId).get();

  if (exactSnap.exists) {
    const exact = exactSnap.data() || {};
    if (exact.active !== false) {
      return { routeId: exactId, route: exact, matchType: "EXACT" };
    }
  }

  return null;
}

/** Hugo's active binding for a root, if one exists. */
export async function findDocumentSenderBinding(
  db: admin.firestore.Firestore,
  rootId: string
): Promise<{ id: string; generation: number; ownerUid: string } | null> {
  if (!rootId) return null;
  const snap = await db.collection("whatsappQrConnectorBindings")
    .where("rootId", "==", rootId)
    .where("agentId", "==", DOCUMENT_SENDER_AGENT_ID)
    .limit(10)
    .get();
  const active = snap.docs.find((doc) => doc.get("state") === "ACTIVE" && doc.get("rootId") === rootId);
  return active ? { id: active.id, generation: Number(active.get("generation") || 0), ownerUid: cleanText(active.get("ownerUid")) } : null;
}

export async function applyWhatsAppDestinationsToJob(
  db: admin.firestore.Firestore,
  jobRef: admin.firestore.DocumentReference,
  jobData: any,
  actor?: { uid?: string; name?: string }
): Promise<{
  ok: boolean;
  status: "ROUTE_RESOLVED" | "ROUTE_NOT_CONFIGURED" | "ROUTE_INVALID";
  routeId?: string;
  matchType?: "EXACT" | "DEFAULT";
  destinationsCount: number;
}> {
  const clienteId = cleanText(jobData?.clienteId || jobData?.clientId);
  const rootId = cleanText(jobData?.rootId);

  const clientSnap = clienteId
    ? await db.collection("clients").doc(clienteId).get()
    : null;

  const client = clientSnap?.exists
    ? clientSnap.data() || {}
    : {};

  const clientRootId = cleanText((client as any).rootId);

  if (
    !clienteId ||
    !clientSnap?.exists ||
    !rootId ||
    clientRootId !== rootId
  ) {
    await writeResolutionFailure(
      db,
      jobRef,
      "CLIENT_SCOPE_INVALID",
      "No fue posible resolver el cliente dentro del root del job.",
      actor
    );

    return {
      ok: true,
      status: "ROUTE_NOT_CONFIGURED",
      destinationsCount: 0,
    };
  }

  // 1) The client's WhatsApp group, only when Hugo's own connector sees it.
  const assignmentSnap = await db.doc(`clientWhatsappGroups/${rootId}__${encodeURIComponent(clienteId)}`).get();
  const assignment = assignmentSnap.exists && cleanText(assignmentSnap.get("rootId")) === rootId && cleanText(assignmentSnap.get("clientId")) === clienteId
    ? (assignmentSnap.data() || {})
    : null;
  let hugoGroup: any = null;
  const groupChatId = cleanText(assignment?.groupChatId);
  if (groupChatId) {
    const binding = await findDocumentSenderBinding(db, rootId);
    if (binding) {
      const chat = await db.doc(`whatsappAgentChats/${binding.id}__${encodeURIComponent(groupChatId)}`).get();
      if (chat.exists && cleanText(chat.get("bindingId")) === binding.id) hugoGroup = { ...(chat.data() || {}), bindingId: binding.id };
    }
  }

  // 2) Legacy route, 3) the client's own WhatsApp number.
  const routeMatch = await getWhatsAppRouteForJob(db, jobData);
  const choice = chooseDeliveryDestination({
    assignment,
    hugoGroup,
    rootId,
    legacyRoute: routeMatch ? {
      routeId: routeMatch.routeId,
      matchType: routeMatch.matchType,
      destinations: Array.isArray(routeMatch.route.destinationChats) ? routeMatch.route.destinationChats : [],
    } : null,
    clientPhone: normalizeClientWhatsapp((client as any).whatsapp) || null,
    clientName: cleanText((client as any).name) || getWhatsAppJobClientLabel(jobData),
  });

  if (choice.source === "CLIENT_GROUP") {
    return writeDestinations(db, jobRef, choice.destinations, null, null, actor, "CLIENT_GROUP");
  }

  if (choice.source === "LEGACY_ROUTE_INVALID") {
    await writeResolutionFailure(
      db,
      jobRef,
      "ROUTE_INVALID",
      "La ruta WhatsApp configurada no tiene destinos validos.",
      actor
    );

    return {
      ok: true,
      status: "ROUTE_INVALID",
      routeId: choice.routeId,
      matchType: choice.matchType,
      destinationsCount: 0,
    };
  }

  if (choice.source === "LEGACY_ROUTE") {
    return writeDestinations(db, jobRef, choice.destinations, choice.routeId, choice.matchType, actor, "LEGACY_ROUTE");
  }

  if (choice.source === "CLIENT_PHONE") {
    return writeDestinations(db, jobRef, choice.destinations, null, null, actor, "CLIENT_PHONE");
  }

  await writeResolutionFailure(
    db,
    jobRef,
    "CLIENT_WHATSAPP_MISSING",
    groupChatId
      ? "El grupo asignado al cliente no esta en los chats de Hugo y no hay otra ruta."
      : "El cliente no tiene grupo, ruta ni WhatsApp registrado.",
    actor
  );

  return {
    ok: true,
    status: "ROUTE_NOT_CONFIGURED",
    destinationsCount: 0,
  };
}

const isProtectedDeliveryStatus = (status: string) =>
  (PROTECTED_DELIVERY_STATUSES as readonly string[]).includes(status);

async function writeResolutionFailure(
  db: admin.firestore.Firestore,
  jobRef: admin.firestore.DocumentReference,
  resolutionStatus: string,
  resolutionError: string,
  actor?: { uid?: string; name?: string }
): Promise<void> {
  await db.runTransaction(async (tx) => {
    const deliveriesSnap = await tx.get(jobRef.collection("deliveries"));

    tx.set(
      jobRef,
      {
        targetResolutionStatus: resolutionStatus,
        targetResolutionError: resolutionError,
        targetRouteId: null,
        targetRouteMatchType: null,
        targetDestinationSource: null,
        targetDestinations: [],
        targetDestinationsCount: 0,
        targetChatId: null,
        targetChatName: null,
        targetChatType: null,
        targetChatSafeDocId: null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    deliveriesSnap.docs.forEach((doc) => {
      const status = cleanText((doc.data() || {}).status);

      // Sent, in-flight and uncertain deliveries are history; never overwrite them.
      if (isProtectedDeliveryStatus(status)) {
        return;
      }

      tx.set(
        doc.ref,
        {
          status: "OMITTED",
          omittedAt: FieldValue.serverTimestamp(),
          omittedByUid: cleanText(actor?.uid),
          omittedByName: cleanText(actor?.name || "AUTO_ROUTE"),
          omitReason: "TARGET_RESOLUTION_REPLACED",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });
  });
}

async function writeDestinations(
  db: admin.firestore.Firestore,
  jobRef: admin.firestore.DocumentReference,
  destinations: WhatsAppDestinationRoute[],
  routeId: string | null,
  matchType: "EXACT" | "DEFAULT" | null,
  actor?: { uid?: string; name?: string },
  destinationSource?: string
): Promise<any> {
  const first = destinations[0];

  const desiredIds = new Set(
    destinations.map((destination) =>
      encodeURIComponent(
        destination.safeDocId || destination.chatId
      )
    )
  );

  // One transaction: a delivery claimed by the connector meanwhile is never reset.
  await db.runTransaction(async (tx) => {
    const [jobSnap, deliveriesSnap] = await Promise.all([
      tx.get(jobRef),
      tx.get(jobRef.collection("deliveries")),
    ]);
    const rootId = cleanText(jobSnap.get("rootId"));
    const existingById = new Map(
      deliveriesSnap.docs.map((doc) => [doc.id, doc])
    );

    tx.set(
      jobRef,
      {
        deliveryMode: "MULTI_TARGET",
        targetResolutionStatus: "ROUTE_RESOLVED",
        targetResolutionError: null,
        targetRouteId: routeId,
        targetRouteMatchType: matchType,
        targetDestinationSource: destinationSource || null,
        targetDestinations: destinations,
        targetDestinationsCount: destinations.length,

        // Legacy/compatibilidad temporal para pantalla actual.
        targetChatId: first.chatId,
        targetChatName: first.chatName,
        targetChatType: first.chatType,
        targetChatSafeDocId: first.safeDocId,

        targetConfiguredAt: FieldValue.serverTimestamp(),
        targetConfiguredByUid: cleanText(actor?.uid),
        targetConfiguredByName: cleanText(actor?.name || "AUTO_ROUTE"),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // Todo destino anterior que ya no forma parte de la resolucion actual
    // queda omitido. SENT/SENDING/SEND_UNCERTAIN se preservan.
    deliveriesSnap.docs.forEach((doc) => {
      if (desiredIds.has(doc.id)) {
        return;
      }

      const status = cleanText((doc.data() || {}).status);

      if (isProtectedDeliveryStatus(status)) {
        return;
      }

      tx.set(
        doc.ref,
        {
          status: "OMITTED",
          omittedAt: FieldValue.serverTimestamp(),
          omittedByUid: cleanText(actor?.uid),
          omittedByName: cleanText(actor?.name || "AUTO_ROUTE"),
          omitReason: "DESTINATION_REPLACED",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    destinations.forEach((destination: WhatsAppDestinationRoute) => {
      const deliveryId = encodeURIComponent(
        destination.safeDocId || destination.chatId
      );

      const deliveryRef = jobRef.collection("deliveries").doc(deliveryId);
      const existing = existingById.get(deliveryId);
      const existingStatus = cleanText((existing?.data() || {}).status);
      const preserveExistingStatus = isProtectedDeliveryStatus(existingStatus);

      const payload: Record<string, any> = {
        channel: "WHATSAPP",
        rootId,
        status: preserveExistingStatus
          ? existingStatus
          : "PENDING_MANUAL_RELEASE",
        connectorId: destination.connectorId || "default",
        routeId,
        routeMatchType: matchType,
        chatId: destination.chatId,
        chatName: destination.chatName,
        chatType: destination.chatType,
        safeDocId: destination.safeDocId,
        destinationType:
          destination.destinationType || "ADDITIONAL",
        phone: destination.phone || null,
        updatedAt: FieldValue.serverTimestamp(),
      };

      if (!existing) {
        payload.createdAt =
          FieldValue.serverTimestamp();
      }

      tx.set(
        deliveryRef,
        payload,
        { merge: true }
      );
    });
  });

  return {
    ok: true,
    status: "ROUTE_RESOLVED",
    routeId: routeId || undefined,
    matchType: matchType || undefined,
    destinationsCount: destinations.length,
  };
}
