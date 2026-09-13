import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { normalizeClientWhatsapp } from "../clients/domain";

export type WhatsAppDestinationRoute = {
  safeDocId: string;
  chatId: string;
  chatName: string;
  chatType: "GROUP" | "CONTACT";
  destinationType?: "CLIENT_PRIMARY" | "ADDITIONAL";
  phone?: string;
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

  // Una ruta activa tiene prioridad absoluta sobre el telefono del cliente.
  const routeMatch = await getWhatsAppRouteForJob(db, jobData);

  if (routeMatch) {
    const destinations: WhatsAppDestinationRoute[] = (
      Array.isArray(routeMatch.route.destinationChats)
        ? routeMatch.route.destinationChats
        : []
    )
      .map((item: any) => ({
        safeDocId: cleanText(item.safeDocId),
        chatId: cleanText(item.chatId),
        chatName: cleanText(item.chatName),
        chatType:
          cleanText(item.chatType) === "GROUP"
            ? "GROUP" as const
            : "CONTACT" as const,
        destinationType: "ADDITIONAL" as const,
      }))
      .filter((item: WhatsAppDestinationRoute) =>
        Boolean(item.chatId && item.safeDocId)
      );

    if (destinations.length === 0) {
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
        routeId: routeMatch.routeId,
        matchType: routeMatch.matchType,
        destinationsCount: 0,
      };
    }

    return writeDestinations(
      db,
      jobRef,
      destinations,
      routeMatch.routeId,
      routeMatch.matchType,
      actor
    );
  }

  // Solo cuando NO existe ruta configurada se usa el WhatsApp del cliente.
  const phone = normalizeClientWhatsapp((client as any).whatsapp);

  if (!phone) {
    await writeResolutionFailure(
      db,
      jobRef,
      "CLIENT_WHATSAPP_MISSING",
      "El cliente no tiene WhatsApp registrado y no existe una ruta configurada.",
      actor
    );

    return {
      ok: true,
      status: "ROUTE_NOT_CONFIGURED",
      destinationsCount: 0,
    };
  }

  const primary: WhatsAppDestinationRoute = {
    safeDocId: "CLIENT_PRIMARY",
    chatId: `${phone}@c.us`,
    chatName:
      cleanText((client as any).name) ||
      getWhatsAppJobClientLabel(jobData),
    chatType: "CONTACT",
    destinationType: "CLIENT_PRIMARY",
    phone,
  };

  return writeDestinations(
    db,
    jobRef,
    [primary],
    null,
    null,
    actor
  );
}

async function writeResolutionFailure(
  db: admin.firestore.Firestore,
  jobRef: admin.firestore.DocumentReference,
  resolutionStatus: string,
  resolutionError: string,
  actor?: { uid?: string; name?: string }
): Promise<void> {
  const deliveriesSnap = await jobRef.collection("deliveries").get();
  const batch = db.batch();

  batch.set(
    jobRef,
    {
      targetResolutionStatus: resolutionStatus,
      targetResolutionError: resolutionError,
      targetRouteId: null,
      targetRouteMatchType: null,
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
    const data = doc.data() || {};
    const status = cleanText(data.status);

    if (["SENT", "SENDING"].includes(status)) {
      return;
    }

    batch.set(
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

  await batch.commit();
}

async function writeDestinations(
  db: admin.firestore.Firestore,
  jobRef: admin.firestore.DocumentReference,
  destinations: WhatsAppDestinationRoute[],
  routeId: string | null,
  matchType: "EXACT" | "DEFAULT" | null,
  actor?: { uid?: string; name?: string }
): Promise<any> {
  const first = destinations[0];
  const deliveriesSnap = await jobRef.collection("deliveries").get();

  const existingById = new Map(
    deliveriesSnap.docs.map((doc) => [doc.id, doc])
  );

  const desiredIds = new Set(
    destinations.map((destination) =>
      encodeURIComponent(
        destination.safeDocId || destination.chatId
      )
    )
  );

  const batch = db.batch();

  batch.set(
    jobRef,
    {
      deliveryMode: "MULTI_TARGET",
      targetResolutionStatus: "ROUTE_RESOLVED",
      targetResolutionError: null,
      targetRouteId: routeId,
      targetRouteMatchType: matchType,
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
  // queda omitido. SENT/SENDING se preservan como historial o envio en curso.
  deliveriesSnap.docs.forEach((doc) => {
    if (desiredIds.has(doc.id)) {
      return;
    }

    const data = doc.data() || {};
    const status = cleanText(data.status);

    if (["SENT", "SENDING"].includes(status)) {
      return;
    }

    batch.set(
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
    const existingData = existing?.data() || {};
    const existingStatus = cleanText(existingData.status);

    const preserveExistingStatus =
      existingStatus === "SENT" ||
      existingStatus === "SENDING";

    const payload: Record<string, any> = {
      channel: "WHATSAPP",
      status: preserveExistingStatus
        ? existingStatus
        : "PENDING_MANUAL_RELEASE",
      connectorId: "default",
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

    batch.set(
      deliveryRef,
      payload,
      { merge: true }
    );
  });

  await batch.commit();

  return {
    ok: true,
    status: "ROUTE_RESOLVED",
    routeId: routeId || undefined,
    matchType: matchType || undefined,
    destinationsCount: destinations.length,
  };
}
