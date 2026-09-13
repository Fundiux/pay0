import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getMyUser, requireAuth } from "../sharedCallables/helpers";
import { applyWhatsAppDestinationsToJob } from "./whatsappRoutes";

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

function userName(user: any): string {
  return cleanText(user?.nombreUsuario || user?.displayName || user?.email || user?.username) || "superadmin";
}

async function requireSuperadminUser(request: any) {
  const uid = requireAuth(request);
  const user = await getMyUser(uid);

  if (!user || !isSuperadmin(user)) {
    throw new HttpsError("permission-denied", "Solo superadmin puede operar envios WhatsApp.");
  }

  return { uid, user };
}

export async function releaseWhatsAppJobDeliveriesCore(input: {
  jobId: string;
  uid: string;
  actorName: string;
}) {
  const jobId = cleanText(input.jobId);

  if (!jobId) {
    throw new HttpsError("invalid-argument", "Falta jobId.");
  }

  const jobRef = db
    .collection("documentDeliveryJobs")
    .doc(jobId);

  const jobSnap = await jobRef.get();

  if (!jobSnap.exists) {
    throw new HttpsError(
      "not-found",
      "No existe el job WhatsApp."
    );
  }

  let job = jobSnap.data() || {};

  if (
    cleanText(job.channel || "WHATSAPP") !==
    "WHATSAPP"
  ) {
    throw new HttpsError(
      "failed-precondition",
      "El job no es de WhatsApp."
    );
  }

  const currentStatus =
    cleanText(job.status || "");

  if (
    ["SENDING", "SENT"].includes(currentStatus)
  ) {
    throw new HttpsError(
      "failed-precondition",
      "El job ya esta en envio o enviado."
    );
  }

  if (
    !Array.isArray(job.targetDestinations) ||
    job.targetDestinations.length === 0
  ) {
    await applyWhatsAppDestinationsToJob(
      db,
      jobRef,
      job,
      {
        uid: input.uid,
        name: input.actorName,
      }
    );

    const refreshed = await jobRef.get();
    job = refreshed.data() || {};
  }

  const deliveriesSnap =
    await jobRef.collection("deliveries").get();

  if (deliveriesSnap.empty) {
    throw new HttpsError(
      "failed-precondition",
      "No hay destinos resueltos para liberar."
    );
  }

  const batch = db.batch();

  let releasedCount = 0;
  let alreadySentCount = 0;

  deliveriesSnap.docs.forEach((doc) => {
    const delivery = doc.data() || {};

    const deliveryStatus =
      cleanText(delivery.status || "");

    if (deliveryStatus === "SENT") {
      alreadySentCount++;
      return;
    }

    if (
      [
        "PENDING_MANUAL_RELEASE",
        "PENDING_SEND",
        "ERROR",
        "ERROR_PARTIAL",
        "ERROR_RETRYABLE",
      ].includes(deliveryStatus)
    ) {
      batch.set(
        doc.ref,
        {
          status: "PENDING_SEND",

          releasedAt:
            FieldValue.serverTimestamp(),

          releasedByUid: input.uid,
          releasedByName: input.actorName,

          updatedAt:
            FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      releasedCount++;
    }
  });

  if (releasedCount === 0) {
    throw new HttpsError(
      "failed-precondition",
      "No hay destinos pendientes para liberar."
    );
  }

  batch.set(
    jobRef,
    {
      status: "READY_FOR_SEND",

      releasedAt:
        FieldValue.serverTimestamp(),

      releasedByUid: input.uid,
      releasedByName: input.actorName,

      releaseStatus: "RELEASED",

      releasedDeliveriesCount:
        releasedCount,

      alreadySentDeliveriesCount:
        alreadySentCount,

      updatedAt:
        FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await batch.commit();

  return {
    ok: true,
    jobId,
    status: "READY_FOR_SEND" as const,
    releasedCount,
    alreadySentCount,
    message:
      `Envio liberado para ${releasedCount} destino(s).`,
  };
}

export const releaseWhatsAppJobDeliveries = onCall(
  {
    cors: true,
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (request) => {
    const { uid, user } =
      await requireSuperadminUser(request);

    return await releaseWhatsAppJobDeliveriesCore({
      jobId: cleanText(request.data?.jobId),
      uid,
      actorName: userName(user),
    });
  }
);
export const retryWhatsAppJobErrors = onCall(
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

    if (["SENDING", "SENT"].includes(cleanText(job.status || ""))) {
      throw new HttpsError("failed-precondition", "No se puede reintentar un job en envio o enviado completo.");
    }

    const deliveriesSnap = await jobRef.collection("deliveries").get();

    const batch = db.batch();
    let retryCount = 0;

    deliveriesSnap.docs.forEach((doc) => {
      const delivery = doc.data() || {};
      const status = cleanText(delivery.status || "");

      if (["ERROR", "ERROR_RETRYABLE"].includes(status)) {
        batch.set(
          doc.ref,
          {
            status: "PENDING_SEND",
            retryRequestedAt: FieldValue.serverTimestamp(),
            retryRequestedByUid: uid,
            retryRequestedByName: userName(user),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        retryCount++;
      }
    });

    if (retryCount === 0) {
      throw new HttpsError("failed-precondition", "No hay errores para reintentar.");
    }

    batch.set(
      jobRef,
      {
        status: "READY_FOR_SEND",
        releaseStatus: "RETRY_ERRORS",
        retryRequestedAt: FieldValue.serverTimestamp(),
        retryRequestedByUid: uid,
        retryRequestedByName: userName(user),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await batch.commit();

    return {
      ok: true,
      jobId,
      retryCount,
      message: `Reintento liberado para ${retryCount} error(es).`,
    };
  }
);

export const omitWhatsAppJob = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const { uid, user } = await requireSuperadminUser(request);
    const jobId = cleanText(request.data?.jobId);
    const reason = cleanText(request.data?.reason || "Omitido manualmente.");

    if (!jobId) {
      throw new HttpsError("invalid-argument", "Falta jobId.");
    }

    const jobRef = db.collection("documentDeliveryJobs").doc(jobId);
    const jobSnap = await jobRef.get();

    if (!jobSnap.exists) {
      throw new HttpsError("not-found", "No existe el job WhatsApp.");
    }

    const job = jobSnap.data() || {};
    const status = cleanText(job.status || "");

    if (status === "SENDING") {
      throw new HttpsError("failed-precondition", "No se puede omitir un job en envio.");
    }

    if (status === "SENT") {
      throw new HttpsError("failed-precondition", "No se puede omitir un job ya enviado.");
    }

    const deliveriesSnap = await jobRef.collection("deliveries").get();
    const batch = db.batch();
    let omittedDeliveries = 0;

    deliveriesSnap.docs.forEach((doc) => {
      const delivery = doc.data() || {};
      const deliveryStatus = cleanText(delivery.status || "");

      if (!["SENT", "SENDING"].includes(deliveryStatus)) {
        batch.set(
          doc.ref,
          {
            status: "OMITTED",
            omittedAt: FieldValue.serverTimestamp(),
            omittedByUid: uid,
            omittedByName: userName(user),
            omitReason: reason,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        omittedDeliveries++;
      }
    });

    batch.set(
      jobRef,
      {
        status: "OMITTED",
        releaseStatus: "OMITTED",
        omittedAt: FieldValue.serverTimestamp(),
        omittedByUid: uid,
        omittedByName: userName(user),
        omitReason: reason,
        omittedDeliveriesCount: omittedDeliveries,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await batch.commit();

    return {
      ok: true,
      jobId,
      omittedDeliveries,
      message: "Job WhatsApp omitido.",
    };
  }
);
