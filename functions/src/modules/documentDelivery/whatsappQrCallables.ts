import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getMyUser, getRootId, requireAuth } from "../sharedCallables/helpers";
import {
  applyWhatsAppDestinationsToJob,
  buildWhatsAppRouteId,
  getWhatsAppJobClientLabel,
  getWhatsAppJobSourceType,
  normalizeWhatsAppRouteKey,
  serializeWhatsAppDestination,
} from "./whatsappRoutes";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

function cleanText(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isSuperadmin(user: any): boolean {
  return cleanText(user?.role || user?.supervisorRole).toLowerCase() === "superadmin";
}

function toIso(value: any): string | null {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return null;
}

async function requireSuperadminUser(request: any) {
  const uid = requireAuth(request);
  const user = await getMyUser(uid);

  if (!user || !isSuperadmin(user)) {
    throw new HttpsError("permission-denied", "Solo superadmin puede operar WhatsApp QR.");
  }

  const rootId = await getRootId(uid);

  return { uid, user, rootId };
}

function userName(user: any): string {
  return cleanText(user?.nombreUsuario || user?.displayName || user?.email || user?.username) || "superadmin";
}

export const getWhatsAppQrDashboard = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const { rootId } = await requireSuperadminUser(request);

    const connectorSnap = await db.collection("whatsappQrConnectors").doc("default").get();
    const connectorData = connectorSnap.exists ? connectorSnap.data() || {} : {};

    const jobsSnap = await db
      .collection("documentDeliveryJobs")
      .where("rootId", "==", rootId)
      .orderBy("createdAt", "desc")
      .limit(300)
      .get();

    const jobs = jobsSnap.docs
      .map((doc) => {
        const data = doc.data() || {};
        const docs = Array.isArray(data.documents) ? data.documents : [];
        const targetDestinations = Array.isArray(data.targetDestinations) ? data.targetDestinations : [];

        return {
          id: doc.id,
          status: cleanText(data.status || "UNKNOWN"),
          channel: cleanText(data.channel || "WHATSAPP"),
          sourceType: cleanText(data.sourceType || ""),
          sourceId: cleanText(data.sourceId || ""),
          clienteId: cleanText(data.clienteId || data.clientId || ""),
          message: cleanText(data.message || ""),
          targetLabel: cleanText(data.targetLabel || ""),
          targetChatId: cleanText(data.targetChatId || ""),
          targetChatName: cleanText(data.targetChatName || ""),
          targetChatType: cleanText(data.targetChatType || ""),
          targetChatSafeDocId: cleanText(data.targetChatSafeDocId || ""),
          targetConfiguredAt: toIso(data.targetConfiguredAt),
          targetResolutionStatus: cleanText(data.targetResolutionStatus || ""),
          targetRouteId: cleanText(data.targetRouteId || ""),
          targetRouteMatchType: cleanText(data.targetRouteMatchType || ""),
          targetDestinations,
          targetDestinationsCount: Number(data.targetDestinationsCount || targetDestinations.length || 0),
          deliveryMode: cleanText(data.deliveryMode || ""),
          documentsCount: docs.length,
          createdAt: toIso(data.createdAt),
          updatedAt: toIso(data.updatedAt),
        };
      })
      .filter(
        (job) =>
          job.channel === "WHATSAPP" &&
          job.status !== "OMITTED_BACKLOG_RESET" &&
          job.status !== "OMITTED"
      )
      .slice(0, 300);

    const jobsWithDeliveries = await Promise.all(
      jobs.map(async (job) => {
        const jobStatus =
          cleanText(job.status || "")
            .toUpperCase();

        const destinationCount =
          Math.max(
            1,
            Number(
              job.targetDestinationsCount ||
              job.targetDestinations?.length ||
              1
            )
          );

        if (
          ["SENT", "OMITTED", "OMITTED_BACKLOG_RESET"]
            .includes(jobStatus)
        ) {
          return {
            ...job,
            deliveries: [],
            deliveryStatsUi: {
              total: destinationCount,
              sent:
                jobStatus === "SENT"
                  ? destinationCount
                  : 0,
              error: 0,
              pending: 0,
              omitted:
                jobStatus === "OMITTED" ||
                jobStatus === "OMITTED_BACKLOG_RESET"
                  ? destinationCount
                  : 0,
            },
          };
        }

        const deliveriesSnap = await db
          .collection("documentDeliveryJobs")
          .doc(job.id)
          .collection("deliveries")
          .get();

        const deliveries =
          deliveriesSnap.docs.map((deliveryDoc) => {
            const data =
              deliveryDoc.data() || {};

            return {
              id: deliveryDoc.id,
              status:
                cleanText(data.status || ""),
              chatId:
                cleanText(data.chatId || ""),
              chatName:
                cleanText(data.chatName || ""),
              chatType:
                cleanText(data.chatType || ""),
              safeDocId:
                cleanText(data.safeDocId || ""),
              lastError:
                cleanText(data.lastError || ""),
              releasedAt:
                toIso(data.releasedAt),
              sendingAt:
                toIso(data.sendingAt),
              sentAt:
                toIso(data.sentAt),
              omittedAt:
                toIso(data.omittedAt),
              updatedAt:
                toIso(data.updatedAt),
            };
          });

        const sent =
          deliveries.filter(
            (delivery) =>
              delivery.status === "SENT"
          ).length;

        const error =
          deliveries.filter(
            (delivery) =>
              ["ERROR", "ERROR_RETRYABLE"]
                .includes(delivery.status)
          ).length;

        const pending =
          deliveries.filter(
            (delivery) =>
              [
                "PENDING_MANUAL_RELEASE",
                "PENDING_SEND",
                "SENDING",
                "ERROR_RETRYABLE",
              ].includes(delivery.status)
          ).length;

        const omitted =
          deliveries.filter(
            (delivery) =>
              delivery.status === "OMITTED"
          ).length;

        return {
          ...job,
          deliveries,
          deliveryStatsUi: {
            total: deliveries.length,
            sent,
            error,
            pending,
            omitted,
          },
        };
      })
    );

    const chatsSnap = await db
      .collection("whatsappQrChats")
      .orderBy("lastSyncedAt", "desc")
      .limit(150)
      .get();

    const chats = chatsSnap.docs
      .map((doc) => {
        const data = doc.data() || {};

        return {
          id: doc.id,
          connectorId: cleanText(data.connectorId || ""),
          chatId: cleanText(data.chatId || ""),
          safeDocId: cleanText(data.safeDocId || doc.id),
          name: cleanText(data.name || data.chatId || ""),
          isGroup: data.isGroup === true,
          archived: data.archived === true,
          pinned: data.pinned === true,
          timestamp: data.timestamp || null,
          lastSyncedAt: toIso(data.lastSyncedAt),
          active: data.active !== false,
          updatedAt: toIso(data.updatedAt),
        };
      })
      .filter((chat) => chat.connectorId === "default" && chat.active)
      .slice(0, 120);

    const routesSnap = await db
      .collection("whatsappDeliveryRoutes")
      .where("rootId", "==", rootId)
      .orderBy("updatedAt", "desc")
      .limit(200)
      .get();

    const routes = routesSnap.docs.map((doc) => {
      const data = doc.data() || {};
      const destinationChats = Array.isArray(data.destinationChats) ? data.destinationChats : [];

      return {
        id: doc.id,
        active: data.active !== false,
        clienteId: cleanText(data.clienteId || ""),
        clientLabel: cleanText(data.clientLabel || ""),
        clientKey: cleanText(data.clientKey || ""),
        sourceType: cleanText(data.sourceType || "DEFAULT"),
        sourceTypeKey: cleanText(data.sourceTypeKey || ""),
        destinationChats,
        destinationsCount: destinationChats.length,
        updatedAt: toIso(data.updatedAt),
        createdAt: toIso(data.createdAt),
      };
    });

    return {
      ok: true,
      connector: {
        id: "default",
        status: cleanText(connectorData.status || "DISCONNECTED") || "DISCONNECTED",
        qrDataUrl: cleanText(connectorData.qrDataUrl) || null,
        qrText: cleanText(connectorData.qrText) || null,
        phoneLabel: cleanText(connectorData.phoneLabel) || null,
        chatsCount: chats.length,
        lastChatsSyncedAt: toIso(connectorData.lastChatsSyncedAt),
        lastSeenAt: toIso(connectorData.lastSeenAt),
        updatedAt: toIso(connectorData.updatedAt),
        sendEnabled: connectorData.sendEnabled === true,
        authClientId: cleanText(connectorData.authClientId || ""),
        error: cleanText(connectorData.error) || null,
        lastCommandId: cleanText(connectorData.lastCommandId || "") || null,
        lastCommandType: cleanText(connectorData.lastCommandType || "") || null,
        lastCommandStatus: cleanText(connectorData.lastCommandStatus || "") || null,
        lastCommandMessage: cleanText(connectorData.lastCommandMessage || "") || null,
        lastCommandAt: toIso(connectorData.lastCommandAt),
        lastCommandFinishedAt: toIso(connectorData.lastCommandFinishedAt),
      },
      jobs: jobsWithDeliveries,
      chats,
      routes,
    };
  }
);


// WA_REMOTE_CONTROL_A1
type WhatsAppConnectorCommandType = "SYNC_CHATS" | "NEW_QR";

async function enqueueWhatsAppConnectorCommand(
  request: any,
  type: WhatsAppConnectorCommandType
) {
  const { uid, user, rootId } = await requireSuperadminUser(request);

  const connectorRef = db
    .collection("whatsappQrConnectors")
    .doc("default");

  const connectorSnap = await connectorRef.get();
  const connectorData =
    connectorSnap.exists ? connectorSnap.data() || {} : {};

  const connectorStatus = cleanText(
    connectorData.status || "DISCONNECTED"
  ).toUpperCase();

  if (
    type === "SYNC_CHATS" &&
    connectorStatus !== "CONNECTED"
  ) {
    throw new HttpsError(
      "failed-precondition",
      "El conector WhatsApp no esta conectado."
    );
  }

  const commandRef = db
    .collection("whatsappQrConnectorCommands")
    .doc();

  const now =
    admin.firestore.FieldValue.serverTimestamp();

  const message =
    type === "SYNC_CHATS"
      ? "Solicitud de sincronizacion enviada al conector."
      : "Solicitud de nuevo QR enviada al conector.";

  const batch = db.batch();

  batch.set(commandRef, {
    connectorId: "default",
    rootId,
    type,
    status: "PENDING",
    requestedByUid: uid,
    requestedByName: userName(user),
    createdAt: now,
    updatedAt: now,
  });

  batch.set(
    connectorRef,
    {
      lastCommandId: commandRef.id,
      lastCommandType: type,
      lastCommandStatus: "PENDING",
      lastCommandMessage: message,
      lastCommandAt: now,
      lastCommandFinishedAt: null,
      ...(type === "NEW_QR"
        ? {
            qrText: null,
            qrDataUrl: null,
          }
        : {}),
      updatedAt: now,
    },
    { merge: true }
  );

  await batch.commit();

  return {
    ok: true,
    commandId: commandRef.id,
    type,
    status: "PENDING",
    message,
  };
}

export const requestWhatsAppChatsSync = onCall(
  {
    cors: true,
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (request) =>
    enqueueWhatsAppConnectorCommand(
      request,
      "SYNC_CHATS"
    )
);

export const requestWhatsAppNewQr = onCall(
  {
    cors: true,
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (request) =>
    enqueueWhatsAppConnectorCommand(
      request,
      "NEW_QR"
    )
);
// WA_REMOTE_CONTROL_A1_END

export const saveWhatsAppDeliveryRoute = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const { uid, user, rootId } = await requireSuperadminUser(request);

    const clienteId = cleanText(request.data?.clienteId);
    const sourceType = cleanText(request.data?.sourceType || "DEFAULT");
    const chatDocIds = Array.isArray(request.data?.chatDocIds)
      ? request.data.chatDocIds.map((x: any) => cleanText(x)).filter(Boolean)
      : [];

    if (!clienteId) {
      throw new HttpsError("invalid-argument", "Falta clienteId.");
    }

    if (!sourceType) {
      throw new HttpsError("invalid-argument", "Falta tipo de documento.");
    }

    if (chatDocIds.length === 0) {
      throw new HttpsError("invalid-argument", "Selecciona al menos un destino WhatsApp.");
    }

    const clientSnap = await db.collection("clients").doc(clienteId).get();

    if (!clientSnap.exists) {
      throw new HttpsError("not-found", "Cliente no existe.");
    }

    const clientData = clientSnap.data() || {};

    if (cleanText(clientData.rootId) !== rootId) {
      throw new HttpsError("permission-denied", "Cliente fuera de tu root.");
    }

    const clientLabel =
      cleanText(
        clientData.name ||
        clientData.nombre ||
        clientData.razonSocial ||
        clientData.clienteNombre
      ) || clienteId;

    const uniqueChatDocIds: string[] = Array.from(new Set<string>(chatDocIds));
    const chatSnaps = await Promise.all(
      uniqueChatDocIds.map((id) => db.collection("whatsappQrChats").doc(id).get())
    );

    const destinationChats = chatSnaps.map((snap) => {
      if (!snap.exists) {
        throw new HttpsError("not-found", "Uno de los chats seleccionados ya no existe.");
      }

      const data = snap.data() || {};

      if (cleanText(data.connectorId || "default") !== "default") {
        throw new HttpsError("failed-precondition", "Uno de los chats no pertenece al conector default.");
      }

      if (data.active === false) {
        throw new HttpsError("failed-precondition", "Uno de los chats seleccionados ya no esta activo.");
      }

      return serializeWhatsAppDestination(snap);
    });

    const clientKey = normalizeWhatsAppRouteKey(clienteId);
    const sourceTypeKey = normalizeWhatsAppRouteKey(sourceType) || "DEFAULT";
    const routeId = buildWhatsAppRouteId(clienteId, sourceType);
    const routeRef = db.collection("whatsappDeliveryRoutes").doc(routeId);

    await routeRef.set(
      {
        active: true,
        clienteId,
        clientLabel,
        clientKey,
        rootId,
        sourceType,
        sourceTypeKey,
        destinationChats,
        destinationsCount: destinationChats.length,
        connectorId: "default",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedByUid: uid,
        updatedByName: userName(user),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    let appliedCount = 0;

    const recentJobsSnap = await db
      .collection("documentDeliveryJobs")
      .where("rootId", "==", rootId)
      .orderBy("createdAt", "desc")
      .limit(100)
      .get();

    for (const doc of recentJobsSnap.docs) {
      const job = doc.data() || {};

      if (cleanText(job.channel || "WHATSAPP") !== "WHATSAPP") continue;
      if (cleanText(job.rootId) !== rootId) continue;
      if (cleanText(job.clienteId || job.clientId) !== clienteId) continue;
      if (getWhatsAppJobSourceType(job) !== sourceTypeKey) continue;

      const status = cleanText(job.status || "");
      if (["READY_FOR_SEND", "SENDING", "SENT"].includes(status)) continue;

      await applyWhatsAppDestinationsToJob(db, doc.ref, job, {
        uid,
        name: userName(user),
      });

      appliedCount++;
    }

    return {
      ok: true,
      routeId,
      clienteId,
      clientLabel,
      sourceType,
      destinationsCount: destinationChats.length,
      appliedCount,
      message: `Ruta guardada con ${destinationChats.length} destino(s).`,
    };
  }
);

export const resolveWhatsAppJobDestinations = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const { uid, user } = await requireSuperadminUser(request);
    const jobId = cleanText(request.data?.jobId);

    if (!jobId) {
      throw new HttpsError("invalid-argument", "Falta jobId.");
    }

    const jobRef = db.collection("documentDeliveryJobs").doc(jobId);
    const jobSnap = await jobRef.get();

    if (!jobSnap.exists) {
      throw new HttpsError("not-found", "No existe el job WhatsApp.");
    }

    const job = jobSnap.data() || {};
    const result = await applyWhatsAppDestinationsToJob(db, jobRef, job, { uid, name: userName(user) });
    const { ok: _routeOk, ...routeResult } = result;

    return {
      ok: true,
      jobId,
      ...routeResult,
    };
  }
);

// Override manual temporal. Se conserva como excepcion, no como flujo principal.
export const assignWhatsAppJobDestination = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const { uid, user } = await requireSuperadminUser(request);

    const jobId = cleanText(request.data?.jobId);
    const chatDocId = cleanText(request.data?.chatDocId);

    if (!jobId) {
      throw new HttpsError("invalid-argument", "Falta jobId.");
    }

    if (!chatDocId) {
      throw new HttpsError("invalid-argument", "Falta chatDocId.");
    }

    const jobRef = db.collection("documentDeliveryJobs").doc(jobId);
    const chatRef = db.collection("whatsappQrChats").doc(chatDocId);

    const [jobSnap, chatSnap] = await Promise.all([jobRef.get(), chatRef.get()]);

    if (!jobSnap.exists) {
      throw new HttpsError("not-found", "No existe el job WhatsApp.");
    }

    if (!chatSnap.exists) {
      throw new HttpsError("not-found", "No existe el chat WhatsApp seleccionado.");
    }

    const job = jobSnap.data() || {};
    const chat = chatSnap.data() || {};

    if (cleanText(job.channel || "WHATSAPP") !== "WHATSAPP") {
      throw new HttpsError("failed-precondition", "El job no es de WhatsApp.");
    }

    const status = cleanText(job.status || "");
    if (["SENDING", "SENT"].includes(status)) {
      throw new HttpsError("failed-precondition", "No se puede cambiar destino de un job enviado o en envio.");
    }

    const destination = serializeWhatsAppDestination(chatSnap);

    await jobRef.set(
      {
        deliveryMode: "MULTI_TARGET",
        targetResolutionStatus: "MANUAL_OVERRIDE",
        targetDestinations: [destination],
        targetDestinationsCount: 1,
        targetChatId: destination.chatId,
        targetChatName: destination.chatName,
        targetChatType: destination.chatType,
        targetChatSafeDocId: destination.safeDocId,
        targetConfiguredAt: admin.firestore.FieldValue.serverTimestamp(),
        targetConfiguredByUid: uid,
        targetConfiguredByName: userName(user),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await jobRef.collection("deliveries").doc(encodeURIComponent(destination.safeDocId)).set(
      {
        channel: "WHATSAPP",
        status: "PENDING_MANUAL_RELEASE",
        connectorId: "default",
        routeId: null,
        routeMatchType: "MANUAL_OVERRIDE",
        chatId: destination.chatId,
        chatName: destination.chatName,
        chatType: destination.chatType,
        safeDocId: destination.safeDocId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return {
      ok: true,
      jobId,
      targetChatId: destination.chatId,
      targetChatName: destination.chatName,
      targetChatType: destination.chatType,
      status,
      message: "Destino WhatsApp configurado como excepcion. El job no se envio.",
    };
  }
);
