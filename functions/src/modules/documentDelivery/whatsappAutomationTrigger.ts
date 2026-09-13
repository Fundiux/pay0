import * as admin from "firebase-admin";
import { onDocumentWritten } from "firebase-functions/v2/firestore";

import {
  prepareDocumentDeliveryJobCore,
} from "./service";

import {
  releaseWhatsAppJobDeliveriesCore,
} from "./whatsappReleaseCallables";

import {
  readWhatsAppAutomationState,
} from "./whatsappAutomationCallables";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

type UploadRow = Record<string, any> & {
  id: string;
};

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function cleanUpper(value: unknown): string {
  return cleanText(value).toUpperCase();
}

function isReadyInvoiceDocument(
  row: Record<string, any>
): boolean {
  if (!row) return false;

  const documentType =
    cleanUpper(
      row.documentType ??
      row.tipo ??
      row.type
    );

  return (
    cleanUpper(row.entityType) === "SOLICITUDES" &&
    ["FACTURA_PDF", "FACTURA_XML"].includes(documentType) &&
    row.active === true &&
    cleanUpper(row.status) === "READY" &&
    Boolean(cleanText(row.storagePath)) &&
    Boolean(
      cleanText(
        row.solicitudId ??
        row.entityId
      )
    ) &&
    Boolean(cleanText(row.rootId))
  );
}

function sameReadyVersion(
  before: Record<string, any>,
  after: Record<string, any>
): boolean {
  if (
    !isReadyInvoiceDocument(before) ||
    !isReadyInvoiceDocument(after)
  ) {
    return false;
  }

  return (
    cleanText(before.storagePath) ===
      cleanText(after.storagePath) &&
    cleanText(before.sha256) ===
      cleanText(after.sha256) &&
    Number(before.version || 0) ===
      Number(after.version || 0)
  );
}

async function activeInvoicePair(input: {
  rootId: string;
  solicitudId: string;
  triggerRow: Record<string, any>;
}): Promise<{
  pdf: UploadRow;
  xml: UploadRow;
} | null> {
  const snap = await db
    .collection("uploads")
    .where("solicitudId", "==", input.solicitudId)
    .limit(50)
    .get();

  let active: UploadRow[] =
    snap.docs
      .map((doc): UploadRow => ({
        id: doc.id,
        ...((doc.data() || {}) as Record<string, any>),
      }))
      .filter((row: UploadRow) => {
        return (
          cleanText(row.rootId) === input.rootId &&
          cleanUpper(row.entityType) === "SOLICITUDES" &&
          row.active === true &&
          cleanUpper(row.status) === "READY" &&
          [
            "FACTURA_PDF",
            "FACTURA_XML",
          ].includes(
            cleanUpper(row.documentType)
          ) &&
          Boolean(cleanText(row.storagePath))
        );
      });

  active.sort(
    (a, b) =>
      Number(b.version || 0) -
      Number(a.version || 0)
  );

  // IQ importa PDF y XML secuencialmente desde el mismo ZIP.
  // Cuando el evento viene de IQ, solo se permite emparejar
  // documentos pertenecientes al MISMO ZIP.
  const triggerSource =
    cleanUpper(input.triggerRow.source);

  const triggerZipHash =
    cleanText(
      input.triggerRow.iqInvoiceZipHash
    );

  if (
    triggerSource === "IQ_INVOICE_ZIP" &&
    triggerZipHash
  ) {
    active = active.filter(
      (row) =>
        cleanText(row.iqInvoiceZipHash) ===
        triggerZipHash
    );
  }

  const pdf = active.find(
    (row) =>
      cleanUpper(row.documentType) ===
      "FACTURA_PDF"
  );

  const xml = active.find(
    (row) =>
      cleanUpper(row.documentType) ===
      "FACTURA_XML"
  );

  if (!pdf || !xml) {
    return null;
  }

  return { pdf, xml };
}

export const processWhatsAppInvoiceAutomation =
  onDocumentWritten(
    {
      document: "uploads/{uploadId}",
      region: "us-central1",
      memory: "256MiB",
      timeoutSeconds: 60,
    },
    async (event) => {
      const afterSnap = event.data?.after;
      const beforeSnap = event.data?.before;

      if (!afterSnap?.exists) {
        return;
      }

      const after =
        (afterSnap.data() || {}) as Record<string, any>;

      if (!isReadyInvoiceDocument(after)) {
        return;
      }

      const before =
        beforeSnap?.exists
          ? ((beforeSnap.data() || {}) as Record<string, any>)
          : {};

      // Una actualizacion posterior de la misma version
      // no vuelve a disparar envio.
      if (sameReadyVersion(before, after)) {
        return;
      }

      const rootId =
        cleanText(after.rootId);

      const solicitudId =
        cleanText(
          after.solicitudId ??
          after.entityId
        );

      if (!rootId || !solicitudId) {
        return;
      }

      const automation =
        await readWhatsAppAutomationState(rootId);

      // Switch OFF = no crear ningun trabajo automatico.
      if (automation.enabled !== true) {
        console.log(
          "[WHATSAPP AUTO] OFF",
          solicitudId
        );
        return;
      }

      // La disponibilidad del conector se registra como salud,
      // pero no perdemos el evento si temporalmente esta caido.
      // El job puede quedar en cola hasta que el conector vuelva.
      if (automation.effectiveReady !== true) {
        console.warn(
          "[WHATSAPP AUTO] CONECTOR NO LISTO; SE ENCOLARA",
          solicitudId,
          automation.connector?.status || "UNKNOWN"
        );
      }

      const pair =
        await activeInvoicePair({
          rootId,
          solicitudId,
          triggerRow: after,
        });

      if (!pair) {
        console.log(
          "[WHATSAPP AUTO] ESPERANDO PAREJA PDF/XML",
          solicitudId
        );
        return;
      }

      const clienteId =
        cleanText(
          after.clienteId ??
          after.clientId ??
          pair.pdf.clienteId ??
          pair.xml.clienteId
        );

      if (!clienteId) {
        console.warn(
          "[WHATSAPP AUTO] SIN CLIENTE",
          solicitudId
        );
        return;
      }

      const documents = [
        pair.pdf,
        pair.xml,
      ].map((row: UploadRow) => ({
        name:
          cleanText(
            row.originalName ??
            row.filename
          ) ||
          cleanText(row.storagePath)
            .split("/")
            .pop() ||
          cleanUpper(row.documentType),

        fileName:
          cleanText(
            row.originalName ??
            row.filename
          ) ||
          cleanText(row.storagePath)
            .split("/")
            .pop() ||
          cleanUpper(row.documentType),

        contentType:
          cleanText(row.contentType) || null,

        storagePath:
          cleanText(row.storagePath),

        documentType:
          cleanUpper(row.documentType),
      }));

      const prepared: any =
        await prepareDocumentDeliveryJobCore(
          {
            data: {
              sourceType: "FACTURA_PDF_XML",
              sourceId: solicitudId,
              clienteId,

              clienteNombre:
                cleanText(
                  after.clienteNombre ??
                  after.clientName ??
                  pair.pdf.clienteNombre ??
                  pair.xml.clienteNombre
                ) || null,

              documents,

              notes:
                "Envio automatico de factura PDF/XML desde Solicitudes.",
            },
          },
          {
            origin: "AUTOMATIC",
            rootId,
            actorUid: "system",
            actorName: "Sistema",
            actorRole: "system",
          }
        );

      if (
        prepared.action ===
        "REQUIRES_CONFIRMATION"
      ) {
        // Misma version ya enviada.
        // AUTOMATIC nunca hace forceResend.
        console.log(
          "[WHATSAPP AUTO] YA ENVIADA",
          solicitudId,
          prepared.jobId
        );
        return;
      }

      if (
        prepared.action ===
        "ALREADY_IN_PROGRESS"
      ) {
        console.log(
          "[WHATSAPP AUTO] YA EN PROCESO",
          solicitudId,
          prepared.jobId
        );
        return;
      }

      if (
        prepared.action !== "CREATED" &&
        prepared.action !== "RETRY_EXISTING"
      ) {
        console.log(
          "[WHATSAPP AUTO] SIN ACCION",
          solicitudId,
          prepared.action
        );
        return;
      }

      if (
        prepared.action === "CREATED" &&
        Number(prepared.destinationsCount || 0) === 0
      ) {
        console.warn(
          "[WHATSAPP AUTO] ESPERANDO DESTINO",
          solicitudId,
          prepared.jobId,
          prepared.targetResolutionStatus || "ROUTE_NOT_CONFIGURED"
        );
        return;
      }

      const released =
        await releaseWhatsAppJobDeliveriesCore({
          jobId: prepared.jobId,
          uid: "system",
          actorName: "Sistema",
        });

      console.log(
        "[WHATSAPP AUTO] LIBERADO",
        solicitudId,
        prepared.jobId,
        released.releasedCount
      );
    }
  );
