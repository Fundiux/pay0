import * as admin from "firebase-admin";
import { logActivity } from "../../utils/logActivity";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { buildClientFacturaDeliveryMessage } from "./commands";
import { sendTelegramDocumentBuffer, sendTelegramMessage } from "./service";
import { MAX_SOLICITUD_DOCUMENT_SIZE_BYTES } from "../solicitudDocuments/domain";

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

function assertInvoiceDeliveryAcknowledged(value: any): void {
  if (value?.ok !== true || !Number.isSafeInteger(value?.result?.message_id) || value.result.message_id <= 0) {
    throw new Error("INVOICE_DELIVERY_UNCONFIRMED");
  }
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

async function getSolicitudMeta(solicitudId: string, rootId: string): Promise<{
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

  if (cleanText(data.rootId) !== rootId) {
    throw new Error("Solicitud fuera del ambito de la notificacion.");
  }

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
    if (status !== "READY") return;
    const expectedPrefix = `roots/${rootId}/solicitudes/${solicitudId}/docs/${documentType}/${doc.id}-`;
    if (!storagePath.startsWith(expectedPrefix)) return;

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

async function getClientRecipients(clientId: string, rootId: string): Promise<Array<{
  documentId: string;
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
    documentId: string;
    telegramUserId: string;
    chatId: string;
    telegramUsername: string;
  }> = [];

  snap.forEach((doc) => {
    const data = doc.data() || {};
    const chatId = cleanText(data.chatId);

    if (!chatId || cleanText(data.rootId) !== rootId) return;

    rows.push({
      documentId: doc.id,
      telegramUserId: cleanText(data.telegramUserId || doc.id),
      chatId,
      telegramUsername: cleanText(data.telegramUsername || ""),
    });
  });

  return rows.filter((row, index) => rows.findIndex(other => other.chatId === row.chatId) === index);
}

async function sendStorageFileToTelegram(input: {
  botToken: string;
  chatId: string;
  file: FacturaUploadFile;
  caption: string;
  beforeSend?: () => Promise<void>;
}) {
  const bucket = admin.storage().bucket();
  const storageFile = bucket.file(input.file.storagePath);
  const [exists] = await storageFile.exists();

  if (!exists) {
    throw new Error(`Archivo no encontrado en Storage: ${input.file.storagePath}`);
  }

  const [metadata] = await storageFile.getMetadata();
  const size = Number(metadata.size);
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_SOLICITUD_DOCUMENT_SIZE_BYTES || !/^[1-9][0-9]*$/.test(String(metadata.generation || ""))) {
    throw new Error("INVOICE_DOCUMENT_UNAVAILABLE");
  }
  const [buffer] = await bucket.file(input.file.storagePath, { generation: metadata.generation }).download();
  if (buffer.length !== size) throw new Error("INVOICE_DOCUMENT_CHANGED");
  await input.beforeSend?.();

  return await sendTelegramDocumentBuffer(
    input.botToken,
    input.chatId,
    input.file.fileName || "documento",
    buffer,
    input.file.contentType || "application/octet-stream",
    input.caption.slice(0, 1024),
    { signal: AbortSignal.timeout(12000) }
  );
}

export async function notifyClientFacturaDisponibleFromUploadId(uploadId: string, controls: { beforeSend?: () => Promise<void> } = {}): Promise<{
  ok: boolean;
  notified: boolean;
  reason: string;
  sentCount?: number;
  reviewRequired?: boolean;
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

  const meta = await getSolicitudMeta(solicitudId, rootId);

  if (!meta.clientId) {
    return { ok: true, notified: false, reason: "missing_client_id" };
  }

  const clientSnap = await db.collection("clients").doc(meta.clientId).get();
  if (!clientSnap.exists || cleanText(clientSnap.data()?.rootId) !== rootId) {
    return { ok: true, notified: false, reason: "client_scope_mismatch" };
  }

  const eventId = safeDocId(`FACTURA_CLIENTE_${meta.clientId}_${solicitudId}_${pair.pdf.uploadId}_${pair.xml.uploadId}`);
  const eventRef = db.collection("telegramClientNotificationEvents").doc(eventId);
  try {
    // Any existing receipt, including a partial or uncertain delivery, is final
    // for automatic retries. Keep the historical key so legacy receipts count.
    await eventRef.create(
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
    }
    );
  } catch (error: any) {
    if (error?.code === 6 || error?.code === "already-exists") {
      const receipt = (await eventRef.get()).data();
      return { ok: true, notified: false, reason: "duplicate", reviewRequired: receipt?.status !== "SENT" };
    }
    throw error;
  }

  const recipients = await getClientRecipients(meta.clientId, rootId);

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
      const authorizeRecipient = async () => {
        await controls.beforeSend?.();
        const current = (await db.collection("clientTelegramUsers").doc(recipient.documentId).get()).data();
        if (current?.active !== true || current.rootId !== rootId || current.clientId !== meta.clientId || cleanText(current.chatId) !== recipient.chatId) {
          throw new Error("INVOICE_RECIPIENT_AUTHORITY_CHANGED");
        }
      };
      await authorizeRecipient();
      const textResult = await sendTelegramMessage(
        TELEGRAM_BOT_TOKEN_FOR_CLIENT_NOTIFICATIONS.value(),
        recipient.chatId,
        message,
        { signal: AbortSignal.timeout(12000) }
      );
      assertInvoiceDeliveryAcknowledged(textResult);

      const pdfResult = await sendStorageFileToTelegram({
        botToken: TELEGRAM_BOT_TOKEN_FOR_CLIENT_NOTIFICATIONS.value(),
        chatId: recipient.chatId,
        file: pair.pdf,
        caption: "PDF",
        beforeSend: authorizeRecipient,
      });
      assertInvoiceDeliveryAcknowledged(pdfResult);

      const xmlResult = await sendStorageFileToTelegram({
        botToken: TELEGRAM_BOT_TOKEN_FOR_CLIENT_NOTIFICATIONS.value(),
        chatId: recipient.chatId,
        file: pair.xml,
        caption: "XML",
        beforeSend: authorizeRecipient,
      });
      assertInvoiceDeliveryAcknowledged(xmlResult);

      sentCount += 1;
    } catch (error: any) {
      const message = "delivery_uncertain";
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
      // PENDING is intentionally retained for compatibility with old readers,
      // which would retry an unfamiliar status after a traffic rollback.
      status: errors.length > 0 ? "PENDING" : "SENT",
      deliveryState: errors.length > 0 ? "UNCERTAIN" : "SENT",
      reason: errors.length > 0 ? "delivery_uncertain" : "sent",
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
    reason: errors.length > 0 ? "delivery_uncertain" : "sent",
    sentCount,
  };
}
