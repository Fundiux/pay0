import { createHash } from "crypto";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";
import { db, getMyUser, requireAuth } from "../sharedCallables/helpers";
import { finalizeSolicitudDocumentVersionTx } from "../solicitudDocuments/lifecycle";
import { isOwnInvoiceIssuerCompany } from "./service";
import { logActivityBatch } from "../../utils/logActivity";

const USERNAME = defineSecret("FACTURAMA_SANDBOX_USERNAME");
const PASSWORD = defineSecret("FACTURAMA_SANDBOX_PASSWORD");
const SANDBOX_BASE_URL = "https://apisandbox.facturama.mx";
const PRODUCTION_BASE_URL = "https://api.facturama.mx";
type FacturamaEnvironment = "SANDBOX" | "PRODUCTION";

function clean(value: unknown, max = 254): string {
  return String(value ?? "").trim().slice(0, max);
}

function money(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function xmlAttribute(tag: string, attribute: string): string {
  const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`\\s${escaped}\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')`, "i").exec(tag);
  return clean(match?.[1] || match?.[2] || "", 128);
}

function issuedCfdiMetadata(xmlBuffer: Buffer) {
  const xml = xmlBuffer.toString("utf8");
  const comprobante = /<(?:[\w-]+:)?Comprobante\b[^>]*>/i.exec(xml)?.[0] || "";
  const timbre = /<(?:[\w-]+:)?TimbreFiscalDigital\b[^>]*>/i.exec(xml)?.[0] || "";
  const serie = xmlAttribute(comprobante, "Serie") || null;
  const folio = xmlAttribute(comprobante, "Folio") || null;
  const uuid = xmlAttribute(timbre, "UUID").toUpperCase() || null;
  const fecha = xmlAttribute(comprobante, "Fecha") || null;
  const display = folio ? (serie && !folio.toUpperCase().startsWith(serie.toUpperCase()) ? `${serie}${folio}` : folio) : uuid;
  const rawTotal = xmlAttribute(comprobante, "Total");
  const total = rawTotal && Number.isFinite(Number(rawTotal)) ? money(rawTotal) : null;
  return { serie, folio, uuid, fecha, display, total };
}

function authorization(): string {
  const username = clean(USERNAME.value(), 500);
  const password = clean(PASSWORD.value(), 500);
  if (!username || !password) throw new HttpsError("failed-precondition", "Credenciales sandbox Facturama no configuradas.");
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

async function requestFacturama(baseUrl: string, path: string, init: RequestInit = {}): Promise<any> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { Authorization: authorization(), Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers || {}) },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.text();
  let parsed: any = null;
  try { parsed = body ? JSON.parse(body) : null; } catch { parsed = body; }
  if (!response.ok) {
    const detail = clean(parsed?.Message || parsed?.message || parsed?.ModelState || body || `HTTP ${response.status}`, 1000);
    throw new HttpsError(response.status === 401 || response.status === 403 ? "permission-denied" : "failed-precondition", `Facturama ${baseUrl.includes("apisandbox") ? "sandbox" : "producción"} rechazó la solicitud (${response.status}): ${detail}`);
  }
  return parsed;
}

function issuerConfig(company: any, config: any) {
  const fiscalRegime = clean(config?.fiscalRegime || company?.fiscalRegime || company?.regimenFiscal, 3);
  const expeditionPlace = clean(config?.expeditionPlace || company?.postalCode || company?.codigoPostal, 5);
  const name = clean(config?.issuerName || company?.razonSocial || company?.nombre, 254).toUpperCase();
  const rfc = clean(company?.rfc, 13).toUpperCase();
  if (!/^\d{3}$/.test(fiscalRegime) || !/^\d{5}$/.test(expeditionPlace) || !name || !rfc) {
    throw new HttpsError("failed-precondition", "Configura razon social, regimen fiscal y codigo postal de expedicion del emisor.");
  }
  return { fiscalRegime, expeditionPlace, name, rfc };
}

async function saveIssuedDocument(input: {
  rootId: string; solicitud: any; solicitudId: string; uid: string; invoiceId: string;
  environment: FacturamaEnvironment; type: "FACTURA_XML" | "FACTURA_PDF" | "ACUSE_CANCELACION_CFDI"; contentType: string; extension: string; buffer: Buffer;
}) {
  const sha256 = createHash("sha256").update(input.buffer).digest("hex");
  const uploadId = createHash("sha256").update(`${input.rootId}:${input.invoiceId}:${input.environment}:${input.type}`).digest("hex");
  const previous = await db.collection("uploads").doc(uploadId).get();
  if (previous.exists && ["REPLACED", "INACTIVE"].includes(String(previous.data()?.status))) throw new HttpsError("failed-precondition", "El documento fiscal fue reemplazado; revisa el expediente antes de reintentar.");
  if (previous.exists && previous.data()?.status === "READY") {
    if (previous.data()?.active !== true) throw new HttpsError("failed-precondition", "El documento fiscal fue reemplazado; revisa el expediente antes de reintentar.");
    return { uploadId, storagePath: String(previous.data()?.storagePath || ""), sha256: String(previous.data()?.sha256 || ""), version: Number(previous.data()?.version || 1) };
  }
  const folio = clean(input.solicitud.folio || input.solicitudId, 80);
  const filename = input.type === "ACUSE_CANCELACION_CFDI" ? `ACUSE-CANCELACION-${folio}.${input.extension}` : `CFDI-${folio}.${input.extension}`;
  const storagePath = `roots/${input.rootId}/solicitudes/${input.solicitudId}/docs/${input.type}/${uploadId}-${filename}`;
  await admin.storage().bucket().file(storagePath).save(input.buffer, {
    resumable: false, contentType: input.contentType,
    metadata: { metadata: { uploadid: uploadId, sha256, facturamainvoiceid: input.invoiceId, environment: input.environment } },
  });
  const ref = db.collection("uploads").doc(uploadId);
  await ref.set({
    rootId: input.rootId, adminId: input.solicitud.adminId || input.rootId,
    clienteId: input.solicitud.clienteId || input.solicitud.clientId || null,
    clienteNombre: input.solicitud.clienteNombre || input.solicitud.clientName || null,
    companyId: input.solicitud.companyId || null, empresaNombre: input.solicitud.empresaNombre || input.solicitud.companyName || null,
    entityType: "solicitudes", entityId: input.solicitudId, solicitudId: input.solicitudId,
    solicitudFolio: input.solicitud.folio || null, documentType: input.type,
    documentTypeLabel: input.type === "FACTURA_XML" ? "Factura XML" : input.type === "FACTURA_PDF" ? "Factura PDF" : "Acuse de Cancelacion CFDI",
    originalName: filename, filename, contentType: input.contentType, sizeBytes: input.buffer.length,
    storagePath, sha256, integrityHashAlgorithm: "SHA-256", integritySealStatus: "HASH_SERVER_GENERATED",
    generatedBySystem: true, generatedByModule: "facturama", facturamaInvoiceId: input.invoiceId,
    facturamaEnvironment: input.environment, status: "PENDING", active: false, version: null,
    createdBy: input.uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });
  let version = 1;
  await db.runTransaction(async tx => {
    version = await finalizeSolicitudDocumentVersionTx({
      tx, db, rootId: input.rootId, solicitudId: input.solicitudId, documentType: input.type,
      uploadId, uploadRef: ref, mode: "update",
      readyPatch: { finalizedBy: input.uid, finalizedAt: FieldValue.serverTimestamp(), integritySealStatus: "SEALED", integritySealedAt: FieldValue.serverTimestamp(), integritySealedBy: input.uid },
    });
  });
  return { uploadId, storagePath, sha256, version };
}

export const saveFacturamaIssuerConfig = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async request => {
    const uid = requireAuth(request); const user = await getMyUser(uid);
    assertAuthorized(request.auth, user, { allowedRoles: ["superadmin"] });
    const rootId = clean(user?.rootId || uid, 128); const companyId = clean(request.data?.companyId, 128);
    const company = await db.doc(`companies/${companyId}`).get();
    if (!company.exists || clean(company.data()?.rootId, 128) !== rootId) throw new HttpsError("permission-denied", "Empresa fuera de alcance.");
    const config = issuerConfig(company.data(), request.data);
    await db.doc(`facturamaIssuerConfigs/${companyId}`).set({ rootId, companyId, issuerName: config.name, fiscalRegime: config.fiscalRegime, expeditionPlace: config.expeditionPlace, updatedBy: uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { ok: true, companyId, ...config };
  },
);

async function issueFacturamaInvoice(request: any, options: { environment: FacturamaEnvironment; baseUrl: string; requireProductionConfirmation?: boolean }) {
    if (options.requireProductionConfirmation && clean(request.data?.confirmation, 64) !== "EMITIR_CFDI_REAL") {
      throw new HttpsError("failed-precondition", "Confirma explícitamente la emisión fiscal real.");
    }
    const uid = requireAuth(request); const user = await getMyUser(uid);
    assertAuthorized(request.auth, user, { allowedRoles: ["superadmin"] });
    const rootId = clean(user?.rootId || uid, 128); const invoiceId = clean(request.data?.invoiceId, 128);
    if (!invoiceId) throw new HttpsError("invalid-argument", "invoiceId requerido.");
    const invoiceRef = db.doc(`facturamaInvoices/${invoiceId}`); const invoiceSnap = await invoiceRef.get();
    if (!invoiceSnap.exists) throw new HttpsError("not-found", "Borrador no encontrado.");
    const invoice: any = invoiceSnap.data() || {};
    if (clean(invoice.rootId, 128) !== rootId) throw new HttpsError("permission-denied", "Borrador fuera de alcance.");
    if (invoice.fiscalValidation?.status !== "VALID") throw new HttpsError("failed-precondition", "El borrador no tiene validación fiscal vigente.");
    const issuedStatus = `${options.environment}_ISSUED`;
    const emittingStatus = `${options.environment}_EMITTING`;
    const errorStatus = `${options.environment}_ERROR`;
    if (invoice.facturamaCfdiId && clean(invoice.facturamaEnvironment || invoice.environment, 16) !== options.environment) {
      throw new HttpsError("failed-precondition", "El borrador ya tiene un CFDI asociado a otro ambiente y no puede reutilizarse para emitir en producción.");
    }
    if (invoice.status === issuedStatus && invoice.facturamaCfdiId) return { ok: true, reused: true, invoiceId, status: invoice.status, facturamaCfdiId: invoice.facturamaCfdiId, uuid: invoice.uuid || null };
    const solicitudId = clean(invoice.sourceSolicitudId, 128);
    if (!solicitudId) throw new HttpsError("failed-precondition", "El borrador no esta ligado a una Solicitud.");
    const [companySnap, configSnap, solicitudSnap] = await Promise.all([db.doc(`companies/${invoice.companyId}`).get(), db.doc(`facturamaIssuerConfigs/${invoice.companyId}`).get(), db.doc(`solicitudes/${solicitudId}`).get()]);
    if (!companySnap.exists || !solicitudSnap.exists) throw new HttpsError("failed-precondition", "Emisor o Solicitud no encontrados.");
    if (companySnap.data()?.rootId !== rootId || solicitudSnap.data()?.rootId !== rootId ||
        (solicitudSnap.data()?.companyId || solicitudSnap.data()?.empresaId) !== invoice.companyId ||
        (configSnap.exists && configSnap.data()?.rootId !== rootId)) throw new HttpsError("permission-denied", "Emisor, configuración o solicitud fuera del ámbito del CFDI.");
    const issuer = issuerConfig(companySnap.data(), configSnap.data()); const solicitud: any = solicitudSnap.data() || {};
    const folio = clean(solicitud.folio || invoiceId, 40).replace(/[^A-Za-z0-9_-]/g, "");
    const items = (invoice.concepts || []).map((item: any) => {
      const subtotal = money(Number(item.quantity) * Number(item.unitPrice)); const taxable = item.taxObject === "02";
      const tax = taxable ? money(subtotal * 0.16) : 0;
      return { ProductCode: item.productCode, Description: item.description, Unit: item.unit, UnitCode: item.unitCode, Quantity: item.quantity, UnitPrice: item.unitPrice, Subtotal: subtotal, TaxObject: item.taxObject, ...(taxable ? { Taxes: [{ Total: tax, Name: "IVA", Base: subtotal, Rate: 0.16, IsRetention: false }] } : {}), Total: money(subtotal + tax) };
    });
    const payload = { NameId: 1, CfdiType: "I", ExpeditionPlace: issuer.expeditionPlace, Folio: folio, PaymentForm: invoice.paymentForm, PaymentMethod: invoice.paymentMethod, Currency: invoice.currency || "MXN", Issuer: { FiscalRegime: issuer.fiscalRegime, Rfc: issuer.rfc, Name: issuer.name }, Receiver: { Rfc: invoice.receiver.rfc, Name: clean(invoice.receiver.name, 254).toUpperCase(), CfdiUse: invoice.receiver.cfdiUse, FiscalRegime: invoice.receiver.fiscalRegime, TaxZipCode: invoice.receiver.postalCode }, Items: items, OrderNumber: clean(solicitud.ordenCompraFolio || solicitud.folio, 100), Observations: `${options.environment === "PRODUCTION" ? "Operación PAY0" : "Prueba sandbox PAY0"} ${folio}` };
    const replacementOfUuid = clean(solicitud.replacementOfUuid, 64).toUpperCase();
    if (solicitud.replacementOfSolicitudId && !/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/.test(replacementOfUuid)) {
      throw new HttpsError("failed-precondition", "La sustitucion no tiene UUID original valido para la relacion 04.");
    }
    if (solicitud.replacementOfSolicitudId && solicitud.replacementOcStatus !== "UPLOADED") {
      throw new HttpsError("failed-precondition", "La sustitucion requiere una nueva Orden de Compra finalizada.");
    }
    if (replacementOfUuid) Object.assign(payload, { Relations: { Type: "04", Cfdis: [{ Uuid: replacementOfUuid }] } });
    const configuredLogoUrl = clean((companySnap.data() as any)?.facturamaLogoUrl || (companySnap.data() as any)?.logoUrl, 1000);
    const issuerLogoUrl = configuredLogoUrl || (issuer.rfc === "TRO230717L64" ? "https://pay-0-system.web.app/brand/Trostre.png" : "");
    if (issuerLogoUrl) Object.assign(payload, { LogoUrl: issuerLogoUrl });
    let claimedInvoice: any = invoice;
    await db.runTransaction(async tx => {
      const currentSnap = await tx.get(invoiceRef);
      if (!currentSnap.exists) throw new HttpsError("not-found", "Borrador no encontrado.");
      const current: any = currentSnap.data() || {};
      if (clean(current.rootId, 128) !== rootId) throw new HttpsError("permission-denied", "Borrador fuera de alcance.");
      if (current.status === issuedStatus && current.facturamaCfdiId) {
        claimedInvoice = current;
        return;
      }
      if (current.status === emittingStatus) throw new HttpsError("aborted", "Ya existe una emisión en proceso; no se reintenta para evitar duplicados.");
      claimedInvoice = current;
      tx.update(invoiceRef, { status: emittingStatus, facturamaEnvironment: options.environment, facturamaAttemptedAt: FieldValue.serverTimestamp(), facturamaAttemptedBy: uid, updatedAt: FieldValue.serverTimestamp() });
    });
    if (claimedInvoice.status === issuedStatus && claimedInvoice.facturamaCfdiId) {
      return { ok: true, reused: true, invoiceId, status: claimedInvoice.status, facturamaCfdiId: claimedInvoice.facturamaCfdiId, uuid: claimedInvoice.uuid || null };
    }
    try {
      let issued: any = null;
      let cfdiId = clean(claimedInvoice.facturamaCfdiId, 256);
      if (!cfdiId) {
        issued = await requestFacturama(options.baseUrl, "/api-lite/3/cfdis", { method: "POST", body: JSON.stringify(payload) });
        cfdiId = clean(issued?.Id || issued?.id, 256);
        if (!cfdiId) throw new Error("Facturama no devolvio Id de CFDI.");
        await invoiceRef.update({ facturamaCfdiId: cfdiId, facturamaAcceptedAt: FieldValue.serverTimestamp(), facturamaEnvironment: options.environment, updatedAt: FieldValue.serverTimestamp() });
      }
      const [xmlResult, pdfResult] = await Promise.all([requestFacturama(options.baseUrl, `/api/Cfdi/xml/issuedLite/${encodeURIComponent(cfdiId)}`), requestFacturama(options.baseUrl, `/api/Cfdi/pdf/issuedLite/${encodeURIComponent(cfdiId)}`)]);
      const xml = Buffer.from(clean(xmlResult?.Content, 20_000_000), "base64"); const pdf = Buffer.from(clean(pdfResult?.Content, 20_000_000), "base64");
      if (!xml.length || !pdf.length) throw new Error("Facturama no devolvio XML/PDF.");
      const [xmlDoc, pdfDoc] = await Promise.all([saveIssuedDocument({ rootId, solicitud, solicitudId, uid, invoiceId, environment: options.environment, type: "FACTURA_XML", contentType: "application/xml", extension: "xml", buffer: xml }), saveIssuedDocument({ rootId, solicitud, solicitudId, uid, invoiceId, environment: options.environment, type: "FACTURA_PDF", contentType: "application/pdf", extension: "pdf", buffer: pdf })]);
      const xmlMetadata = issuedCfdiMetadata(xml);
      const uuid = clean(xmlMetadata.uuid || issued?.Complement?.TaxStamp?.Uuid || issued?.Uuid || issued?.uuid || claimedInvoice.uuid, 64).toUpperCase();
      const solicitudPatch: Record<string, unknown> = {
        facturamaAutoDraftStatus: issuedStatus, facturamaInvoiceId: invoiceId,
        facturaXmlUploadId: xmlDoc.uploadId, facturaPdfUploadId: pdfDoc.uploadId,
        facturamaEnvironment: options.environment,
        facturaSerie: xmlMetadata.serie, facturaFolio: xmlMetadata.folio,
        facturaDisplay: xmlMetadata.display, numFactura: xmlMetadata.display,
        facturaFecha: xmlMetadata.fecha, facturaMetadataSource: "FACTURAMA_XML",
        facturaMetadataUpdatedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      };
      const materialityPatch: Record<string, unknown> = {
        facturamaInvoiceId: invoiceId, facturaXmlUploadId: xmlDoc.uploadId,
        facturaPdfUploadId: pdfDoc.uploadId, facturamaEnvironment: options.environment,
        facturaFolio: xmlMetadata.folio, facturaDisplay: xmlMetadata.display,
        facturaFecha: xmlMetadata.fecha, updatedAt: FieldValue.serverTimestamp(),
      };
      if (options.environment === "PRODUCTION") { solicitudPatch.facturaUuid = uuid || null; solicitudPatch.uuidCfdi = uuid || null; materialityPatch.facturamaUuid = uuid || null; }
      else { solicitudPatch.facturaUuidSandbox = uuid || null; materialityPatch.facturamaSandboxUuid = uuid || null; }
      // Publish the local fiscal result atomically after both files exist.
      // A failed commit leaves all three records unchanged and preserves cfdiId.
      const fiscalBatch = db.batch();
      fiscalBatch.update(invoiceRef, { status: issuedStatus, environment: options.environment, productionBlocked: options.environment !== "PRODUCTION", facturamaCfdiId: cfdiId, uuid: uuid || null, facturamaIssuedAt: FieldValue.serverTimestamp(), xmlUploadId: xmlDoc.uploadId, pdfUploadId: pdfDoc.uploadId, updatedAt: FieldValue.serverTimestamp() });
      fiscalBatch.set(solicitudSnap.ref, solicitudPatch, { merge: true });
      fiscalBatch.set(db.doc(`materialityOperations/${solicitudId}`), { ...materialityPatch, rootId, solicitudId }, { merge: true });
      fiscalBatch.update(invoiceRef, { total: xmlMetadata.total });
      logActivityBatch(fiscalBatch, db, { event: "FACTURA_EMITIDA", rootId, actorUid: uid,
        referenceId: solicitudId, referenceType: "SOLICITUD", amount: xmlMetadata.total,
        description: `CFDI ${options.environment} vinculado al expediente.`,
        extra: { invoiceId, environment: options.environment, uuid },
      }, db.collection("activityLog").doc(`factura-issued-${invoiceId}`));
      await fiscalBatch.commit();
      if (options.environment === "PRODUCTION" && solicitud.replacementOfSolicitudId && uuid) {
        try {
          const originalRef = db.doc(`solicitudes/${clean(solicitud.replacementOfSolicitudId, 128)}`);
          const originalSnap = await originalRef.get();
          const original: any = originalSnap.data() || {};
          const originalInvoiceId = clean(original.facturamaInvoiceId, 128);
          const originalInvoiceSnap = originalInvoiceId ? await db.doc(`facturamaInvoices/${originalInvoiceId}`).get() : null;
          const originalInvoice: any = originalInvoiceSnap?.data() || {};
          if (!originalSnap.exists || clean(original.rootId, 128) !== rootId || !originalInvoice.facturamaCfdiId || !originalInvoiceSnap) throw new Error("No se encontro el CFDI original.");
          const cancelResult = await requestFacturama(PRODUCTION_BASE_URL, `/api-lite/cfdis/${encodeURIComponent(originalInvoice.facturamaCfdiId)}?${new URLSearchParams({ motive: "01", uuidReplacement: uuid }).toString()}`, { method: "DELETE" });
          const cancellationStatus = clean(cancelResult?.Status || cancelResult?.status, 32).toUpperCase() || "REQUESTED";
          const cancellationTerminal = ["CANCELED", "ACEPTED", "EXPIRED"].includes(cancellationStatus);
          await Promise.all([
            originalRef.set({
              uuidCfdiSustituido: clean(original.facturaUuid || original.uuidCfdi, 64).toUpperCase() || null,
              uuidCfdiSustituto: uuid, relatedSolicitudId: solicitudId,
              relatedSolicitudFolio: solicitud.folio || null,
              facturamaCancellationStatus: cancellationStatus,
              sustitucionStatus: cancellationTerminal ? "CANCELADA_SAT" : "CANCELACION_SOLICITADA",
              ...(cancellationTerminal ? { status: "CANCELADA" } : {}),
              updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true }),
            solicitudSnap.ref.set({
              uuidCfdiSustituido: replacementOfUuid, uuidCfdiSustituto: uuid,
              replacementUuid: uuid, replacementCancellationStatus: cancellationStatus,
              updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true }),
            originalInvoiceSnap.ref.set({ cancellationStatus, cancellationMotive: "01", cancellationUuidReplacement: uuid, updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
          ]);
        } catch (cancellationError: any) {
          await solicitudSnap.ref.set({ replacementCancellationStatus: "ERROR", replacementCancellationError: clean(cancellationError?.message || cancellationError, 1000), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        }
      }
      return { ok: true, reused: false, invoiceId, status: issuedStatus, facturamaCfdiId: cfdiId, uuid: uuid || null, xmlUploadId: xmlDoc.uploadId, pdfUploadId: pdfDoc.uploadId };
    } catch (error: any) {
      await invoiceRef.update({ status: errorStatus, facturamaLastError: clean(error?.message || error, 1500), facturamaFailedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", clean(error?.message || "Fallo al emitir CFDI.", 1500));
    }
}

export const issueFacturamaSandboxInvoice = onCall(
  { region: "us-central1", timeoutSeconds: 120, memory: "512MiB", secrets: [USERNAME, PASSWORD] },
  async request => issueFacturamaInvoice(request, { environment: "SANDBOX", baseUrl: SANDBOX_BASE_URL }),
);

export const issueFacturamaProductionInvoice = onCall(
  { region: "us-central1", timeoutSeconds: 120, memory: "512MiB", secrets: [USERNAME, PASSWORD] },
  async request => issueFacturamaInvoice(request, { environment: "PRODUCTION", baseUrl: PRODUCTION_BASE_URL, requireProductionConfirmation: true }),
);

// Repairs only missing metadata for CFDIs already issued before PAY0 parsed
// the response XML. It never emits, cancels, replaces, or uploads a document.
export const reconcileFacturamaIssuedMetadata = onCall(
  { region: "us-central1", timeoutSeconds: 120, memory: "512MiB", secrets: [USERNAME, PASSWORD] },
  async request => {
    const uid = requireAuth(request); const user = await getMyUser(uid);
    assertAuthorized(request.auth, user, { allowedRoles: ["superadmin"] });
    const rootId = clean(user?.rootId || uid, 128);
    const invoices = await db.collection("facturamaInvoices").where("rootId", "==", rootId).where("environment", "==", "PRODUCTION").limit(50).get();
    let repaired = 0; let skipped = 0; let failed = 0;
    for (const invoiceSnap of invoices.docs) {
      const invoice: any = invoiceSnap.data() || {};
      if (!String(invoice.status || "").toUpperCase().endsWith("_ISSUED") || !invoice.facturamaCfdiId || !invoice.sourceSolicitudId) { skipped++; continue; }
      const solicitudRef = db.doc(`solicitudes/${clean(invoice.sourceSolicitudId, 128)}`);
      const solicitudSnap = await solicitudRef.get(); const solicitud: any = solicitudSnap.data() || {};
      if (!solicitudSnap.exists || clean(solicitud.rootId, 128) !== rootId || (clean(solicitud.facturaDisplay, 128) && clean(solicitud.facturaFecha, 64))) { skipped++; continue; }
      try {
        const xmlResult = await requestFacturama(PRODUCTION_BASE_URL, `/api/Cfdi/xml/issuedLite/${encodeURIComponent(clean(invoice.facturamaCfdiId, 256))}`);
        const metadata = issuedCfdiMetadata(Buffer.from(clean(xmlResult?.Content, 20_000_000), "base64"));
        if (!metadata.folio && !metadata.uuid) { failed++; continue; }
        const patch = { facturaSerie: metadata.serie, facturaFolio: metadata.folio, facturaDisplay: metadata.display, numFactura: metadata.display, facturaFecha: metadata.fecha, facturaMetadataSource: "FACTURAMA_XML_RECONCILED", facturaMetadataUpdatedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() };
        await Promise.all([
          solicitudRef.set({ ...patch, ...(metadata.uuid ? { facturaUuid: metadata.uuid, uuidCfdi: metadata.uuid } : {}) }, { merge: true }),
          invoiceSnap.ref.set({ ...patch, ...(metadata.uuid ? { uuid: metadata.uuid } : {}) }, { merge: true }),
          db.doc(`materialityOperations/${clean(invoice.sourceSolicitudId, 128)}`).set({ facturaFolio: metadata.folio, facturaDisplay: metadata.display, facturaFecha: metadata.fecha, ...(metadata.uuid ? { facturamaUuid: metadata.uuid } : {}), updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
        ]);
        repaired++;
      } catch { failed++; }
    }
    return { ok: true, repaired, skipped, failed };
  },
);

export const cancelFacturamaProductionInvoice = onCall(
  { region: "us-central1", timeoutSeconds: 60, memory: "256MiB", secrets: [USERNAME, PASSWORD] },
  async request => {
    const uid = requireAuth(request); const user = await getMyUser(uid);
    assertAuthorized(request.auth, user, { allowedRoles: ["superadmin"] });
    const rootId = clean(user?.rootId || uid, 128); const solicitudId = clean(request.data?.solicitudId, 128);
    const motive = clean(request.data?.motive, 2); const replacement = clean(request.data?.uuidReplacement, 64).toUpperCase();
    if (!solicitudId || !["01", "02", "03", "04"].includes(motive)) throw new HttpsError("invalid-argument", "Solicitud y motivo SAT válidos son requeridos.");
    if (motive === "01" && !/^[0-9A-F]{8}-[0-9A-F-]{27}$/.test(replacement)) throw new HttpsError("invalid-argument", "Motivo 01 requiere UUID sustituto.");
    const solSnap = await db.doc(`solicitudes/${solicitudId}`).get(); if (!solSnap.exists) throw new HttpsError("not-found", "Solicitud no encontrada.");
    const sol: any = solSnap.data() || {}; if (clean(sol.rootId, 128) !== rootId) throw new HttpsError("permission-denied", "Solicitud fuera de alcance.");
    const invoiceId = clean(sol.facturamaInvoiceId, 128); if (!invoiceId) throw new HttpsError("failed-precondition", "La Solicitud no tiene CFDI Facturama.");
    const invRef = db.doc(`facturamaInvoices/${invoiceId}`); const invSnap = await invRef.get(); const inv: any = invSnap.data() || {};
    if (!invSnap.exists || clean(inv.rootId, 128) !== rootId || inv.environment !== "PRODUCTION" || !inv.facturamaCfdiId) throw new HttpsError("failed-precondition", "CFDI productivo Facturama no disponible.");
    const qs = new URLSearchParams({ motive, ...(replacement ? { uuidReplacement: replacement } : {}) });
    const result = await requestFacturama(PRODUCTION_BASE_URL, `/api-lite/cfdis/${encodeURIComponent(inv.facturamaCfdiId)}?${qs.toString()}`, { method: "DELETE" });
    const externalStatus = clean(result?.Status || result?.status, 32).toUpperCase();
    const terminal = ["CANCELED", "ACEPTED", "EXPIRED"].includes(externalStatus);
    await Promise.all([
      invRef.set({ cancellationStatus: externalStatus || "REQUESTED", cancellationMotive: motive, cancellationUuidReplacement: replacement || null, cancellationRequestedAt: FieldValue.serverTimestamp(), cancellationRequestedBy: uid, cancellationResponse: clean(result?.Message || result?.message, 500) || null, updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
      solSnap.ref.set({ facturamaCancellationStatus: externalStatus || "REQUESTED", motivoCancelacionSAT: motive, uuidCfdiSustituido: inv.uuid || sol.facturaUuid || null, uuidCfdiSustituto: replacement || null, ...(terminal ? { status: "CANCELADA" } : {}), updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
    ]);
    return { ok: true, status: externalStatus || "REQUESTED", terminal, uuid: inv.uuid || sol.facturaUuid || null, message: clean(result?.Message || result?.message, 500) || null };
  },
);

// This is an explicit, auditable status refresh. It does not request a second
// cancellation and uses the SAT-status endpoint with the CFDI's own UUID/RFCs.
export const refreshFacturamaProductionCancellationStatus = onCall(
  { region: "us-central1", timeoutSeconds: 45, memory: "256MiB", secrets: [USERNAME, PASSWORD] },
  async request => {
    const uid = requireAuth(request); const user = await getMyUser(uid);
    assertAuthorized(request.auth, user, { allowedRoles: ["superadmin"] });
    const rootId = clean(user?.rootId || uid, 128);
    const solicitudId = clean(request.data?.solicitudId, 128);
    if (!solicitudId) throw new HttpsError("invalid-argument", "solicitudId requerido.");
    const solSnap = await db.doc(`solicitudes/${solicitudId}`).get();
    if (!solSnap.exists) throw new HttpsError("not-found", "Solicitud no encontrada.");
    const sol: any = solSnap.data() || {};
    if (clean(sol.rootId, 128) !== rootId) throw new HttpsError("permission-denied", "Solicitud fuera de alcance.");
    const invoiceId = clean(sol.facturamaInvoiceId, 128);
    const invSnap = invoiceId ? await db.doc(`facturamaInvoices/${invoiceId}`).get() : null;
    const inv: any = invSnap?.data() || {};
    // The cancellation path also heals legacy records that were issued before
    // metadata extraction existed, so Solicitudes never remains at S/F.
    let metadata = { serie: null as string | null, folio: null as string | null, uuid: null as string | null, fecha: null as string | null, display: null as string | null };
    if (inv.facturamaCfdiId && (!clean(sol.facturaDisplay, 128) || !clean(sol.facturaFecha, 64))) {
      try {
        const xmlResult = await requestFacturama(PRODUCTION_BASE_URL, `/api/Cfdi/xml/issuedLite/${encodeURIComponent(clean(inv.facturamaCfdiId, 256))}`);
        metadata = issuedCfdiMetadata(Buffer.from(clean(xmlResult?.Content, 20_000_000), "base64"));
        if (metadata.folio || metadata.uuid) {
          const metadataPatch = { facturaSerie: metadata.serie, facturaFolio: metadata.folio, facturaDisplay: metadata.display, numFactura: metadata.display, facturaFecha: metadata.fecha, facturaMetadataSource: "FACTURAMA_XML_RECONCILED", facturaMetadataUpdatedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() };
          await Promise.all([
            solSnap.ref.set({ ...metadataPatch, ...(metadata.uuid ? { facturaUuid: metadata.uuid, uuidCfdi: metadata.uuid } : {}) }, { merge: true }),
            invSnap?.exists ? invSnap.ref.set({ ...metadataPatch, ...(metadata.uuid ? { uuid: metadata.uuid } : {}) }, { merge: true }) : Promise.resolve(),
          ]);
        }
      } catch { /* Status verification remains available even if XML recovery fails. */ }
    }
    const uuid = clean(metadata.uuid || sol.facturaUuid || sol.uuidCfdi || inv.uuid, 64).toUpperCase();
    const issuerSnap = sol.companyId ? await db.doc(`companies/${sol.companyId}`).get() : null;
    const issuerRfc = clean(issuerSnap?.data()?.rfc, 13).toUpperCase();
    const receiverRfc = clean(inv?.receiver?.rfc || sol.clienteRfc || sol.clientRfc, 13).toUpperCase();
    const total = Number(inv?.totals?.total || inv?.total || sol.facturaTotal || sol.monto);
    if (!uuid || !issuerRfc || !receiverRfc || !Number.isFinite(total) || total <= 0) {
      throw new HttpsError("failed-precondition", "Faltan UUID, RFC emisor, RFC receptor o total para consultar el estado SAT.");
    }
    const query = new URLSearchParams({ uuid, issuerRfc, receiverRfc, total: total.toFixed(2) });
    const result = await requestFacturama(PRODUCTION_BASE_URL, `/cfdi/status?${query.toString()}`);
    const satStatus = clean(result?.Status || result?.status, 64).toUpperCase();
    const isCanceled = satStatus === "CANCELADO" || satStatus === "CANCELED";
    let receiptUploadId = clean(inv.cancellationReceiptUploadId, 128) || null;
    let receiptError: string | null = null;
    if (isCanceled && !receiptUploadId && inv.facturamaCfdiId) {
      try {
        const receipt = await requestFacturama(PRODUCTION_BASE_URL, `/api/Acuse/pdf/issuedLite/${encodeURIComponent(clean(inv.facturamaCfdiId, 256))}`);
        const receiptBuffer = Buffer.from(clean(receipt?.Content, 20_000_000), "base64");
        if (!receiptBuffer.length) throw new Error("Facturama no devolvio el acuse PDF.");
        const saved = await saveIssuedDocument({ rootId, solicitud: { ...sol, facturaDisplay: metadata.display || sol.facturaDisplay }, solicitudId, uid, invoiceId, environment: "PRODUCTION", type: "ACUSE_CANCELACION_CFDI", contentType: "application/pdf", extension: "pdf", buffer: receiptBuffer });
        receiptUploadId = saved.uploadId;
      } catch (error: any) {
        receiptError = clean(error?.message || error, 500) || "No se pudo descargar el acuse de cancelacion.";
      }
    }
    const patch = {
      facturamaCancellationStatus: satStatus || "UNKNOWN",
      facturamaCancellationSatStatus: satStatus || "UNKNOWN",
      facturamaCancellationIsCancelable: clean(result?.IsCancelable || result?.isCancelable, 180) || null,
      facturamaCancellationCheckedAt: FieldValue.serverTimestamp(),
      facturamaCancellationCheckedBy: uid,
      ...(receiptUploadId ? { cancellationReceiptUploadId: receiptUploadId, cancellationReceiptStatus: "ACTIVE", cancellationReceiptDownloadedAt: FieldValue.serverTimestamp() } : {}),
      ...(receiptError ? { cancellationReceiptStatus: "PENDING_RETRY", cancellationReceiptError: receiptError } : {}),
      ...(isCanceled ? { status: "CANCELADA", sustitucionStatus: "CANCELADA_SAT" } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    };
    await Promise.all([
      solSnap.ref.set(patch, { merge: true }),
      invSnap?.exists ? invSnap.ref.set({ cancellationSatStatus: satStatus || "UNKNOWN", cancellationCheckedAt: FieldValue.serverTimestamp(), cancellationCheckedBy: uid, ...(receiptUploadId ? { cancellationReceiptUploadId: receiptUploadId, cancellationReceiptStatus: "ACTIVE", cancellationReceiptDownloadedAt: FieldValue.serverTimestamp() } : {}), ...(receiptError ? { cancellationReceiptStatus: "PENDING_RETRY", cancellationReceiptError: receiptError } : {}), updatedAt: FieldValue.serverTimestamp() }, { merge: true }) : Promise.resolve(),
    ]);
    return { ok: true, solicitudId, status: satStatus || "UNKNOWN", isCancelable: clean(result?.IsCancelable || result?.isCancelable, 180) || null, terminal: isCanceled };
  },
);

function base64(value: unknown, label: string, maxBytes = 256_000): string {
  const normalized = clean(value, Math.ceil(maxBytes * 1.5)).replace(/\s/g, "");
  if (!normalized || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new HttpsError("invalid-argument", `${label} inválido.`);
  }
  const buffer = Buffer.from(normalized, "base64");
  if (!buffer.length || buffer.length > maxBytes) throw new HttpsError("invalid-argument", `${label} fuera de tamaño permitido.`);
  return normalized;
}

async function scopedOwnIssuer(request: any) {
  const uid = requireAuth(request); const user = await getMyUser(uid);
  assertAuthorized(request.auth, user, { allowedRoles: ["superadmin"] });
  const rootId = clean(user?.rootId || uid, 128); const companyId = clean(request.data?.companyId, 128);
  if (!companyId) throw new HttpsError("invalid-argument", "companyId requerido.");
  const snap = await db.doc(`companies/${companyId}`).get();
  const company: any = snap.exists ? snap.data() || {} : null;
  if (!company || clean(company.rootId, 128) !== rootId || company.active === false || !isOwnInvoiceIssuerCompany(company)) {
    throw new HttpsError("permission-denied", "Emisor propio fuera de alcance.");
  }
  const rfc = clean(company.rfc, 13).toUpperCase();
  if (!/^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc)) throw new HttpsError("failed-precondition", "El emisor no tiene RFC válido.");
  return { uid, user, rootId, companyId, company, rfc };
}

export const getFacturamaProductionCsdStatus = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB", secrets: [USERNAME, PASSWORD] },
  async request => {
    const issuer = await scopedOwnIssuer(request);
    const records = await requestFacturama(PRODUCTION_BASE_URL, "/api-lite/csds");
    const found = Array.isArray(records) ? records.find((item: any) => clean(item?.Rfc || item?.rfc, 13).toUpperCase() === issuer.rfc) : null;
    // Facturama's raw response can include the key. Never return or persist it.
    return {
      ok: true, companyId: issuer.companyId, rfc: issuer.rfc, registered: Boolean(found),
      expirationDate: found?.CsdExpirationDate || found?.csdExpirationDate || null,
      uploadedAt: found?.UploadDate || found?.uploadDate || null,
    };
  },
);

export const registerFacturamaProductionCsd = onCall(
  { region: "us-central1", timeoutSeconds: 60, memory: "256MiB", secrets: [USERNAME, PASSWORD] },
  async request => {
    const issuer = await scopedOwnIssuer(request);
    const certificate = base64(request.data?.certificateBase64, "Certificado");
    const privateKey = base64(request.data?.privateKeyBase64, "Llave privada");
    const privateKeyPassword = String(request.data?.privateKeyPassword || "");
    if (!privateKeyPassword || privateKeyPassword.length > 256) throw new HttpsError("invalid-argument", "Contraseña de llave inválida.");
    await requestFacturama(PRODUCTION_BASE_URL, "/api-lite/csds", {
      method: "POST",
      body: JSON.stringify({ Rfc: issuer.rfc, Certificate: certificate, PrivateKey: privateKey, PrivateKeyPassword: privateKeyPassword }),
    });
    // Deliberately do not write the files, Base64 or password anywhere. Only
    // non-sensitive audit metadata is saved for the issuer's operational status.
    await db.doc(`facturamaIssuerConfigs/${issuer.companyId}`).set({
      rootId: issuer.rootId, companyId: issuer.companyId, csdRegistrationStatus: "REGISTERED_API_MULTIISSUER",
      csdRfc: issuer.rfc, csdRegisteredAt: FieldValue.serverTimestamp(), csdRegisteredBy: issuer.uid,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { ok: true, companyId: issuer.companyId, rfc: issuer.rfc, registered: true };
  },
);
