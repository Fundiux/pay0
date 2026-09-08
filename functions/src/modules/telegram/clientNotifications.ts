import * as admin from "firebase-admin";
import { logActivity } from "../../utils/logActivity";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { buildClientFacturaDeliveryMessage } from "./commands";
import { sendTelegramDocumentBuffer, sendTelegramMessage } from "./service";

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

export const TELEGRAM_BOT_TOKEN_FOR_CLIENT_NOTIFICATIONS = defineSecret("TELEGRAM_BOT_TOKEN");

type FacturaUploadFile = {
  uploadId: string;
  storagePath: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
};

type FacturaPair = {
  pdf: FacturaUploadFile | null;
  xml: FacturaUploadFile | null;
};

function cleanText(value: any): string {
  return String(value || "").trim();
}

function cleanUpper(value: any): string {
  return cleanText(value).toUpperCase();
}

function safeDocId(value: string): string {
  return cleanText(value).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 180);
}

function toMoney(value: any): number {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function toMillis(value: any): number {
  if (value && typeof value.toMillis === "function") return Number(value.toMillis() || 0);
  if (value && typeof value.toDate === "function") return Number(value.toDate().getTime() || 0);
  return 0;
}

function pickFileName(data: any): string {
  return cleanText(data.originalName || data.filename || data.fileName || "documento");
}

function pickContentType(documentType: string, data: any): string {
  return cleanText(data.contentType) || (documentType === "FACTURA_XML" ? "application/xml" : "application/pdf");
}

async function getSolicitudMeta(solicitudId: string): Promise<{
  solicitudFolio: string;
  clientId: string;
  clientName: string;
  companyName: string;
  totalAmount: number;
}> {
  const cleanSolicitudId = cleanText(solicitudId);

  if (!cleanSolicitudId) {
    return {
      solicitudFolio: "",
      clientId: "",
      clientName: "Cliente",
      companyName: "Empresa",
      totalAmount: 0,
    };
  }

  const snap = await db.collection("solicitudes").doc(cleanSolicitudId).get();

  if (!snap.exists) {
    return {
      solicitudFolio: cleanSolicitudId,
      clientId: "",
      clientName: "Cliente",
      companyName: "Empresa",
      totalAmount: 0,
    };
  }

  const data = snap.data() || {};

  return {
    solicitudFolio: cleanText(
      data.folio ||
      data.folioSolicitud ||
      data.solicitudFolio ||
      data.sequenceDisplay ||
      data.requestFolio ||
      cleanSolicitudId
    ),
    clientId: cleanText(data.clienteId || data.clientId || ""),
    clientName: cleanText(
      data.clienteNombre ||
      data.clientName ||
      data.clientDisplayName ||
      data.clientLabel ||
      "Cliente"
    ),
    companyName: cleanText(
      data.empresaNombre ||
      data.companyName ||
      data.companyDisplayName ||
      data.companyLabel ||
      "Empresa"
    ),
    totalAmount: toMoney(
      data.total ??
      data.totalAmount ??
      data.monto ??
      data.montoTotal ??
      data.amount ??
      data.importeTotal ??
      0
    ),
  };
}

async function getActiveFacturaPair(input: {
  rootId: string;
  solicitudId: string;
}): Promise<FacturaPair> {
  const rootId = cleanText(input.rootId);
  const solicitudId = cleanText(input.solicitudId);

  if (!rootId || !solicitudId) {
    return { pdf: null, xml: null };
  }

  const snap = await db
    .collection("uploads")
    .where("rootId", "==", rootId)
    .where("solicitudId", "==", solicitudId)
    .where("active", "==", true)
    .limit(50)
    .get();

  const rows: Array<FacturaUploadFile & { documentType: string; createdAtMillis: number }> = [];

  snap.forEach((doc) => {
    const data = doc.data() || {};
    const documentType = cleanUpper(data.documentType || data.type);
    const status = cleanUpper(data.status);
    const storagePath = cleanText(data.storagePath);

    if (!storagePath) return;
    if (documentType !== "FACTURA_PDF" && documentType !== "FACTURA_XML") return;
    if (["DELETED", "ELIMINADA", "INACTIVE", "INACTIVO", "REPLACED"].includes(status)) return;

    rows.push({
      uploadId: doc.id,
      documentType,
      storagePath,
      fileName: pickFileName(data),
      contentType: pickContentType(documentType, data),
      sizeBytes: Number(data.sizeBytes || 0),
      createdAtMillis: toMillis(data.finalizedAt || data.createdAt || data.updatedAt),
    });
  });

  rows.sort((a, b) => b.createdAtMillis - a.createdAtMillis);

  return {
    pdf: rows.find((row) => row.documentType === "FACTURA_PDF") || null,
    xml: rows.find((row) => row.documentType === "FACTURA_XML") || null,
  };
}

async function getClientRecipients(clientId: string): Promise<Array<{
  telegramUserId: string;
  chatId: string;
  telegramUsername: string;
}>> {
  const cleanClientId = cleanText(clientId);

  if (!cleanClientId) return [];

  const snap = await db
    .collection("clientTelegramUsers")
    .where("clientId", "==", cleanClientId)
    .where("active", "==", true)
    .get();

  const rows: Array<{
    telegramUserId: string;
    chatId: string;
    telegramUsername: string;
  }> = [];

  snap.forEach((doc) => {
    const data = doc.data() || {};
    const chatId = cleanText(data.chatId);

    if (!chatId) return;

    rows.push({
      telegramUserId: cleanText(data.telegramUserId || doc.id),
      chatId,
      telegramUsername: cleanText(data.telegramUsername || ""),
    });
  });

  return rows;
}

async function sendStorageFileToTelegram(input: {
  botToken: string;
  chatId: string;
  file: FacturaUploadFile;
  caption: string;
}) {
  const bucket = admin.storage().bucket();
  const storageFile = bucket.file(input.file.storagePath);
  const [exists] = await storageFile.exists();

  if (!exists) {
    throw new Error(`Archivo no encontrado en Storage: ${input.file.storagePath}`);
  }

  const [buffer] = await storageFile.download();

  return await sendTelegramDocumentBuffer(
    input.botToken,
    input.chatId,
    input.file.fileName || "documento",
    buffer,
    input.file.contentType || "application/octet-stream",
    input.caption.slice(0, 1024)
  );
}

export async function notifyClientFacturaDisponibleFromUploadId(uploadId: string): Promise<{
  ok: boolean;
  notified: boolean;
  reason: string;
  sentCount?: number;
}> {
  const cleanUploadId = cleanText(uploadId);

  if (!cleanUploadId) {
    return { ok: true, notified: false, reason: "missing_upload_id" };
  }

  const uploadSnap = await db.collection("uploads").doc(cleanUploadId).get();

  if (!uploadSnap.exists) {
    return { ok: true, notified: false, reason: "upload_not_found" };
  }

  const upload = uploadSnap.data() || {};
  const documentType = cleanUpper(upload.documentType || upload.type);

  if (documentType !== "FACTURA_PDF" && documentType !== "FACTURA_XML") {
    return { ok: true, notified: false, reason: "not_factura_document" };
  }

  const rootId = cleanText(upload.rootId);
  const solicitudId = cleanText(upload.solicitudId || upload.entityId || "");

  if (!rootId || !solicitudId) {
    return { ok: true, notified: false, reason: "missing_scope" };
  }

  const pair = await getActiveFacturaPair({ rootId, solicitudId });

  if (!pair.pdf || !pair.xml) {
    return { ok: true, notified: false, reason: "missing_pdf_or_xml" };
  }

  const meta = await getSolicitudMeta(solicitudId);

  if (!meta.clientId) {
    return { ok: true, notified: false, reason: "missing_client_id" };
  }

  const eventId = safeDocId(`FACTURA_CLIENTE_${meta.clientId}_${solicitudId}_${pair.pdf.uploadId}_${pair.xml.uploadId}`);
  const eventRef = db.collection("telegramClientNotificationEvents").doc(eventId);
  const eventSnap = await eventRef.get();

  if (eventSnap.exists) {
    const event = eventSnap.data() || {};
    const status = cleanUpper(event.status);

    if (status === "SENT" || status === "PENDING") {
      return { ok: true, notified: false, reason: "duplicate" };
    }
  }

  await eventRef.set(
    {
      eventId,
      type: "FACTURA_CLIENTE_DISPONIBLE",
      status: "PENDING",
      rootId,
      solicitudId,
      solicitudFolio: meta.solicitudFolio,
      clientId: meta.clientId,
    clienteId: meta.clientId,
    clientName: meta.clientName,
    clienteNombre: meta.clientName,
    companyName: meta.companyName,
    empresaNombre: meta.companyName,
    amount: Number(meta.totalAmount || 0),
      totalAmount: meta.totalAmount,
      pdfUploadId: pair.pdf.uploadId,
      xmlUploadId: pair.xml.uploadId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const recipients = await getClientRecipients(meta.clientId);

  if (recipients.length === 0) {
    await eventRef.set(
      {
        status: "SKIPPED",
        reason: "client_without_telegram_recipients",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return { ok: true, notified: false, reason: "client_without_telegram_recipients" };
  }

  const message = buildClientFacturaDeliveryMessage({
    clientName: meta.clientName,
    companyName: meta.companyName,
    totalAmount: meta.totalAmount,
    solicitudFolio: meta.solicitudFolio,
  });

  let sentCount = 0;
  const errors: string[] = [];

  for (const recipient of recipients) {
    try {
      await sendTelegramMessage(
        TELEGRAM_BOT_TOKEN_FOR_CLIENT_NOTIFICATIONS.value(),
        recipient.chatId,
        message
      );

      await sendStorageFileToTelegram({
        botToken: TELEGRAM_BOT_TOKEN_FOR_CLIENT_NOTIFICATIONS.value(),
        chatId: recipient.chatId,
        file: pair.pdf,
        caption: "PDF",
      });

      await sendStorageFileToTelegram({
        botToken: TELEGRAM_BOT_TOKEN_FOR_CLIENT_NOTIFICATIONS.value(),
        chatId: recipient.chatId,
        file: pair.xml,
        caption: "XML",
      });

      sentCount += 1;
    } catch (error: any) {
      const message = String(error?.message || error || "unknown");
      errors.push(message);

      logger.error("notifyClientFacturaDisponibleFromUploadId recipient error", {
        clientId: meta.clientId,
        telegramUserId: recipient.telegramUserId,
        message,
      });
    }
  }

  await eventRef.set(
    {
      status: sentCount > 0 ? "SENT" : "FAILED",
      reason: sentCount > 0 ? "sent" : "send_failed",
      sentCount,
      errors,
      sentAt: sentCount > 0 ? FieldValue.serverTimestamp() : null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

    await logActivity({
    event: "TELEGRAM_FACTURA_CLIENTE_ENVIADA",
    rootId,
    actorUid: "system",
    actorName: "Sistema",
    actorUsername: "Sistema",
    actorRole: "system",
    entityType: "solicitudes",
    entityId: solicitudId,
    referenceId: solicitudId,
    referenceFolio: meta.solicitudFolio || solicitudId,
    referenceType: "telegramFactura",
    amount: Number(meta.totalAmount || 0),
    description: "Factura disponible enviada al cliente por Telegram",
    createdBy: "system",
    extra: {
      source: "telegram",
      solicitudId,
      clientId: meta.clientId,
      clienteId: meta.clientId,
      clientName: meta.clientName,
      clienteNombre: meta.clientName,
      companyName: meta.companyName,
      empresaNombre: meta.companyName,
      pdfUploadId: pair.pdf.uploadId,
      xmlUploadId: pair.xml.uploadId,
      sentCount,
      message: "Factura disponible enviada al cliente por Telegram",
    },
  });

  return {
    ok: true,
    notified: sentCount > 0,
    reason: sentCount > 0 ? "sent" : "send_failed",
    sentCount,
  };
}