import * as admin from "firebase-admin";
import JSZip from "jszip";
import { logActivity, logActivityTx } from "../../utils/logActivity";
import { HttpsError } from "firebase-functions/v2/https";
import { MAX_SOLICITUD_DOCUMENT_SIZE_BYTES, buildSolicitudDocumentStoragePath, getSolicitudDocumentTypeLabel, normalizeSolicitudDocumentType, sanitizeDocumentLabel, sanitizeFilename } from "./domain";
import { enqueueIqCreationForSolicitud } from "../iq/solicitudCreateQueueCallables";
import { finalizeSolicitudDocumentVersionTx } from "./lifecycle";
import { linkSolicitudToMaterialityOperationCore } from "../materiality/service";
import { ensureAutomaticFacturamaDraftForSolicitud } from "../facturama/service";
import { generateCotizacionForSolicitudCore } from "../cotizaciones/callables";
import { generateConstanciaRecepcionForSolicitudCore } from "../constancias/service";

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
function isSolicitudIqTerminalForReplacementH4D58H(solicitud: Record<string, unknown>): boolean {
  if (solicitud.iqTerminalLocked === true) return true;
  if (solicitud.iqSolicitudTerminalLocked === true) return true;

  const text = [
    solicitud.status,
    solicitud.iqStatus,
    solicitud.iqReconciliationStatus,
    solicitud.iqTerminalStatus,
  ].map((value) => String(value || "")).join(" ").toUpperCase();

  return text.includes("RECHAZ") ||
    text.includes("REJECT") ||
    text.includes("CANCEL");
}

function buildSolicitudIqReplacementUnlockPatchH4D58H(input: {
  solicitud: Record<string, unknown>;
  uploadId: string;
  documentType: string;
  uid: string;
}): Record<string, unknown> {
  if (input.documentType !== "ORDEN_COMPRA") return {};
  if (!isSolicitudIqTerminalForReplacementH4D58H(input.solicitud)) return {};

  const previousIqId = String(input.solicitud.iqId || input.solicitud.iqFolio || "").trim();

  return {
    status: "PROCESANDO",

    iqPreviousTerminalIqId: previousIqId || null,
    iqPreviousTerminalStatus: input.solicitud.iqStatus || input.solicitud.iqReconciliationStatus || input.solicitud.iqTerminalStatus || null,
    iqPreviousTerminalUnlockedByUploadId: input.uploadId,

    iqId: FieldValue.delete(),
    iqFolio: FieldValue.delete(),

    iqStatus: "READY_FOR_NEW_IQ_FOLIO",
    iqReconciliationStatus: "RESET_BY_NEW_OC",
    iqCreationStatus: "READY_FOR_RECREATE",
    iqCreateQueueStatus: "PENDING_NEW_OC",

    iqTerminalLocked: false,
    iqSolicitudTerminalLocked: false,
    iqTerminalUnlockedAt: FieldValue.serverTimestamp(),
    iqTerminalUnlockedBy: input.uid,
    iqTerminalUnlockUploadId: input.uploadId,
    iqTerminalUnlockDocumentType: input.documentType,
    iqTerminalUnlockReason: "Nueva OC subida; se habilita crear nuevo folio IQ de solicitud.",

    iqAutomationOmitted: false,
    iqFollowupStatus: "PENDING_NEW_FOLIO",
    iqSyncUpdatedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}
// H4_D58H_B1_SOLICITUD_DOC_UNLOCK_HELPERS
const FieldValue = admin.firestore.FieldValue;

function requireAuthLike(request: any): string {
  const uid = request?.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "No autenticado.");
  }
  return String(uid);
}

async function getUser(uid: string): Promise<any> {
  const snap = await db.doc(`users/${uid}`).get();
  if (snap.exists) return snap.data() || {};
  return null;
}

function getRole(user: any): string {
  return String(user?.role || "").trim().toLowerCase();
}

function getUsername(user: any, uid: string): string {
  return String(user?.username || user?.displayName || user?.email || uid || "").trim();
}

function getRootIdFromUser(user: any, uid: string): string {
  return String(user?.rootId || uid || "").trim();
}


type FacturaXmlMetadata = {
  facturaSerie: string | null;
  facturaFolio: string | null;
  facturaDisplay: string | null;
  facturaUuid: string | null;
  facturaSubtotal: number | null;
  facturaTotal: number | null;
  facturaMetodoPago: string | null;
  facturaMoneda: string | null;
  facturaFecha: string | null;
};

type OcFiscalMetadata = {
  productCode: string; unitCode: string; description: string; quantity: number;
  clientName: string; clientRfc: string; clientAddress: string;
  cfdiUse: string; fiscalRegime: string; postalCode: string;
  paymentMethod: string; paymentForm: string; currency: string;
  deliveryLocation: string;
  items: Array<{ quantity: number; unit: string; productCode: string; description: string }>;
};

function xmlValue(value: string) { return String(value || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim(); }
function excelColumn(reference: string) { let value = 0; for (const char of String(reference || "").match(/[A-Z]+/i)?.[0]?.toUpperCase() || "") value = value * 26 + char.charCodeAt(0) - 64; return value; }

async function readOcFiscalMetadata(bucket: any, storagePath: string): Promise<OcFiscalMetadata | null> {
  const [buffer] = await bucket.file(storagePath).download();
  return parseOcFiscalMetadataBuffer(buffer);
}

/** Pure parser used by the upload flow and by emulator/fixture verification. */
export async function parseOcFiscalMetadataBuffer(buffer: Buffer): Promise<OcFiscalMetadata | null> {
  const zip = await JSZip.loadAsync(buffer);
  const sharedXml = await zip.file("xl/sharedStrings.xml")?.async("string") || "";
  const shared = [...sharedXml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map(match => xmlValue(match[1]));
  const sheetNames = Object.keys(zip.files).filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  const parseRows = async (sheetName: string): Promise<string[][]> => {
    const sheet = await zip.file(sheetName)?.async("string") || "";
    const parsed: string[][] = [];
    for (const row of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const values: string[] = [];
      // Ignore self-closing cells from merged ranges. The former expression
      // treated `<c .../>` as an opening tag and then consumed the next real
      // cell, shifting values such as regimen, CP and uso CFDI one column.
      for (const cell of row[1].matchAll(/<c\b([^>]*[^/])>([\s\S]*?)<\/c>/g)) {
        const reference = cell[1].match(/\br="([A-Z]+\d+)"/)?.[1] || "";
        const raw = cell[2].match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1] || cell[2].match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] || "";
        values[excelColumn(reference) - 1] = cell[1].includes('t="s"') ? shared[Number(raw)] || "" : xmlValue(raw);
      }
      if (values.some(Boolean)) parsed.push(values);
    }
    return parsed;
  };
  let rows: string[][] = [];
  for (const sheetName of sheetNames) {
    const candidate = await parseRows(sheetName);
    const hasOcTable = candidate.some(row => row.some(cell => String(cell || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim() === "CANTIDAD"));
    if (hasOcTable) { rows = candidate; break; }
    if (!rows.length) rows = candidate;
  }
  if (!rows.length) return null;
  const normalized = (value: unknown) => String(value || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/[.:;_\-/\\]+/g, " ").replace(/\s+/g, " ").trim();
  // Canonical OCs use merged cells. The value may be in a later physical cell,
  // so never assume it is column C; read every cell following the matched label.
  const field = (label: string) => {
    const target = normalized(label);
    const row = rows.find(item => item.some(cell => normalized(cell).startsWith(target)));
    if (!row) return "";
    const labelIndex = row.findIndex(cell => normalized(cell).startsWith(target));
    return row.slice(Math.max(0, labelIndex + 1)).filter(Boolean).join(" ");
  };
  // OC templates vary in the literal heading (CLAVE SAT, CLAVE PROD SERV,
  // CLAVE CONCEPTO, etc.).  Detect the semantic table, never its coordinates
  // nor one exact heading spelling.
  const isCodeHeader = (value: unknown) => /\b(CLAVE\s*(SAT|PROD|PRODUCTO|CONCEPTO|SERV)|CODIGO\s*SAT)\b/.test(normalized(value));
  const isDescriptionHeader = (value: unknown) => /\b(DESCRIPCION|CONCEPTO|PRODUCTO|SERVICIO)\b/.test(normalized(value));
  const header = rows.findIndex(row => row.some(cell => normalized(cell) === "CANTIDAD" || normalized(cell) === "CANT.") && row.some(isDescriptionHeader) && row.some(isCodeHeader));
  const headerRow = header >= 0 ? rows[header] || [] : [];
  const headerIndex = (test: (value: unknown) => boolean) => headerRow.findIndex(test);
  const quantityIndex = headerIndex(cell => /\bCANT(ID|IDAD)?\b/.test(normalized(cell)));
  const unitIndex = headerIndex(cell => /\b(CLAVE\s*)?UNIDAD\b/.test(normalized(cell)));
  const conceptIndex = headerIndex(isCodeHeader);
  // "Clave Concepto" contains the word Concepto, but it is the SAT code
  // column.  It must never win over the actual Concepto/Descripcion column.
  const descriptionIndex = headerIndex(cell => isDescriptionHeader(cell) && !isCodeHeader(cell));
  const parseQuantity = (value: unknown) => Number(String(value || "1").replace(/[^0-9.,-]/g, "").replace(",", ".")) || 1;
  const rowsAfterHeader = header >= 0 ? rows.slice(header + 1) : rows;
  const items: Array<{ quantity: number; unit: string; productCode: string; description: string }> = [];
  for (const row of rowsAfterHeader) {
    const rowText = row.map(normalized).filter(Boolean).join(" ");
    if (/\b(SUBTOTAL|TOTAL|IVA|IMPUESTO|RETENCION)\b/.test(rowText)) {
      if (items.length) break;
      continue;
    }
    // Algunos formatos canónicos traen visualmente invertidos "Clave Unidad"
    // y "Clave Concepto". La coordenada/encabezado es una pista, pero la
    // clasificación fiscal se reconoce por su forma: ocho dígitos SAT.
    // Nunca se debe dejar de buscar la clave válida sólo porque la celda
    // indicada por el encabezado contiene una unidad como E48.
    const headerProductCode = String(row[conceptIndex] || "").trim().match(/^\d{8}$/)?.[0] || "";
    const productCode = headerProductCode || String(row.find(cell => /^\d{8}$/.test(String(cell || "").trim())) || "").trim();
    if (!productCode) continue;
    const headerUnit = String(row[unitIndex] || "").trim();
    const unitCandidate = /^[A-Z0-9]{2,3}$/i.test(headerUnit) ? headerUnit : String(row.find(cell => /^[A-Z0-9]{2,3}$/i.test(String(cell || "").trim()) && !/^\d{2,3}$/.test(String(cell || "").trim())) || "").trim();
    const unit = unitCandidate.toUpperCase();
    const description = String(row[descriptionIndex] || "").replace(/\s+/g, " ").trim().slice(0, 1000)
      || row.filter(cell => /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(String(cell || "")) && !isCodeHeader(cell)).map(cell => String(cell).trim()).sort((a, b) => b.length - a.length)[0] || "";
    items.push({ quantity: parseQuantity(row[quantityIndex]), unit, productCode, description: String(description).replace(/\s+/g, " ").trim().slice(0, 1000) });
  }
  const firstItem = items.find(item => item.productCode && item.unit) || items[0];
  const code = firstItem?.productCode || "";
  const unit = firstItem?.unit || "";
  const description = firstItem?.description || "";
  const quantity = firstItem?.quantity || 1;
  // Some supplier templates preserve the fiscal value in a merged cell. Keep
  // the semantic label lookup first, then search the full OC text as a safe
  // structural fallback rather than relying on a particular adjacent cell.
  const fullOcText = rows.flat().map(cell => String(cell || "")).join(" ");
  const regimeRaw = field("REGIMEN FISCAL:") || fullOcText;
  const regimeText = normalized(regimeRaw);
  const regime = regimeRaw.match(/\b\d{3}\b/)?.[0]
    || (regimeText.includes("GENERAL DE LEY DE PERSONAS MORALES") ? "601" : "")
    || (regimeText.includes("PERSONAS MORALES CON FINES NO LUCRATIVOS") ? "603" : "")
    || (regimeText.includes("ACTIVIDADES EMPRESARIALES Y PROFESIONALES") ? "612" : "")
    || (regimeText.includes("INCORPORACION FISCAL") ? "621" : "")
    || (regimeText.includes("SIMPLIFICADO DE CONFIANZA") ? "626" : "");
  // A postal code must be tied to its label. Searching the complete sheet can
  // accidentally select an Excel date serial such as 46283.
  const postal = (field("C.P.") || field("CODIGO POSTAL")).match(/\b\d{5}\b/)?.[0] || "";
  const cfdiRaw = field("USO DE CFDI:") || fullOcText;
  const cfdiText = normalized(cfdiRaw);
  const cfdiUse = cfdiRaw.match(/\b[A-Z]\d{2}\b/)?.[0]
    || (cfdiText.includes("GASTOS EN GENERAL") ? "G03" : "")
    || (cfdiText.includes("ADQUISICION DE MERCANCIAS") ? "G01" : "")
    || (cfdiText.includes("DEVOLUCIONES DESCUENTOS O BONIFICACIONES") ? "G02" : "");
  const paymentMethod = field("METODO DE PAGO:").match(/\b(?:PUE|PPD)\b/)?.[0] || "";
  const paymentFormField = field("FORMA DE PAGO");
  // Prefer the explicit code at the beginning of the labelled OC field. This
  // avoids confusing 03 Transferencia with another numeric value elsewhere.
  const paymentForm = paymentFormField.match(/^\s*(0[1-9]|[12]\d|30|31)\b/)?.[1] || paymentFormField.match(/\b(?:0[1-9]|[12]\d|30|31)\b/)?.[0] || "";
  const currency = field("MONEDA").match(/\b[A-Z]{3}\b/)?.[0] || "";
  const clientName = field("RAZON SOCIAL:") || field("RAZON SOCIAL");
  const clientRfc = (field("RFC:") || field("RFC")).match(/[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}/i)?.[0] || "";
  const addressParts = [
    field("CALLE"), field("NUMERO EXTERIOR"), field("NUMERO INTERIOR"),
    field("COLONIA"), field("MUNICIPIO / DELEGACION"), field("CIUDAD"), field("ESTADO"), postal ? `CP ${postal}` : "",
  ].filter(Boolean);
  const clientAddress = addressParts.join(", ");
  const deliveryLocation = field("LUGAR DE ENTREGA") || field("LUGAR ENTREGA") || field("LUGAR DE PRESTACION") || field("DOMICILIO DE ENTREGA") || clientAddress;
  // The OC is the operational source for the quote and fiscal classification.
  // CSF remains a fiscal validation source, but no quote should display a
  // placeholder when the OC already supplies the data.
  return code && unit ? { productCode: code, unitCode: unit, description, quantity, clientName, clientRfc, clientAddress, cfdiUse, fiscalRegime: regime, postalCode: postal, paymentMethod, paymentForm, currency, deliveryLocation, items } : null;
}

function cleanCfdiText(value: any): string {
  return String(value || "").trim();
}

function readXmlAttribute(tag: string, attr: string): string {
  const escaped = attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rx = new RegExp("\\s" + escaped + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')", "i");
  const match = rx.exec(tag || "");
  return cleanCfdiText((match && (match[1] || match[2])) || "");
}

function findXmlTag(xml: string, localName: string): string {
  const rx = new RegExp("<(?:[A-Za-z0-9_]+:)?" + localName + "\\b[^>]*>", "i");
  const match = rx.exec(xml || "");
  return match ? match[0] : "";
}

function toCfdiNumber(value: string): number | null {
  const num = Number(String(value || "").replace(/,/g, "").trim());
  return Number.isFinite(num) ? num : null;
}

function buildFacturaDisplay(serie: string, folio: string, uuid: string): string {
  const cleanSerie = cleanCfdiText(serie);
  const cleanFolio = cleanCfdiText(folio);
  const cleanUuid = cleanCfdiText(uuid);

  if (cleanFolio) {
    if (cleanSerie && !cleanFolio.toUpperCase().startsWith(cleanSerie.toUpperCase())) {
      return cleanSerie + cleanFolio;
    }
    return cleanFolio;
  }

  return cleanUuid;
}

function parseFacturaXmlMetadata(xml: string): FacturaXmlMetadata | null {
  const comprobanteTag = findXmlTag(xml, "Comprobante");
  if (!comprobanteTag) return null;

  const timbreTag = findXmlTag(xml, "TimbreFiscalDigital");

  const facturaSerie = cleanCfdiText(readXmlAttribute(comprobanteTag, "Serie")) || null;
  const facturaFolio = cleanCfdiText(readXmlAttribute(comprobanteTag, "Folio")) || null;
  const facturaUuid = cleanCfdiText(readXmlAttribute(timbreTag, "UUID")).toUpperCase() || null;
  const facturaSubtotal = toCfdiNumber(readXmlAttribute(comprobanteTag, "SubTotal"));
  const facturaTotal = toCfdiNumber(readXmlAttribute(comprobanteTag, "Total"));
  const facturaMetodoPago = cleanCfdiText(readXmlAttribute(comprobanteTag, "MetodoPago")).toUpperCase() || null;
  const facturaMoneda = cleanCfdiText(readXmlAttribute(comprobanteTag, "Moneda")).toUpperCase() || null;
  const facturaFecha = cleanCfdiText(readXmlAttribute(comprobanteTag, "Fecha")) || null;
  const facturaDisplay = cleanCfdiText(buildFacturaDisplay(facturaSerie || "", facturaFolio || "", facturaUuid || "")) || null;

  if (!facturaDisplay && !facturaUuid && facturaTotal === null) return null;

  return {
    facturaSerie,
    facturaFolio,
    facturaDisplay,
    facturaUuid,
    facturaSubtotal,
    facturaTotal,
    facturaMetodoPago,
    facturaMoneda,
    facturaFecha,
  };
}

async function readFacturaXmlMetadataFromStorage(bucket: any, storagePath: string): Promise<FacturaXmlMetadata | null> {
  try {
    if (!storagePath) return null;
    const [buffer] = await bucket.file(storagePath).download();
    const xml = Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer || "");
    return parseFacturaXmlMetadata(xml);
  } catch (error) {
    console.warn("[solicitudDocuments] No se pudo parsear metadata CFDI XML", error);
    return null;
  }
}
function canUploadSolicitudDocs(user: any): boolean {
  const role = getRole(user);
  if (role === "superadmin") return true;

  const modules = user?.modules || {};
  if (modules?.solicitudes?.uploadDocs === true) return true;

  return false;
}

function canAccessSolicitud(user: any, uid: string, rootId: string, solicitud: any): boolean {
  const role = getRole(user);

  if (role === "superadmin") {
    return String(solicitud?.rootId || "") === rootId || String(solicitud?.createdBy || "") === uid;
  }

  if (role === "admin") {
    return String(solicitud?.rootId || "") === rootId && String(solicitud?.adminId || "") === uid;
  }

  if (role === "operador") {
    return String(solicitud?.rootId || "") === rootId && String(solicitud?.createdBy || "") === uid;
  }

  return false;
}

async function loadSolicitudOrThrow(input: {
  solicitudId: string;
  uid: string;
  user: any;
  rootId: string;
}) {
  const solicitudRef = db.collection("solicitudes").doc(input.solicitudId);
  const solicitudSnap = await solicitudRef.get();

  if (!solicitudSnap.exists) {
    throw new HttpsError("not-found", "Solicitud no existe.");
  }

  const solicitud = solicitudSnap.data() || {};

  if (!canAccessSolicitud(input.user, input.uid, input.rootId, solicitud)) {
    throw new HttpsError("permission-denied", "No autorizado.");
  }

  return {
    solicitudRef,
    solicitud,
  };
}

export async function initSolicitudDocumentUploadCore(request: any) {
  const uid = requireAuthLike(request);
  const user = await getUser(uid);

  if (!user) {
    throw new HttpsError("permission-denied", "Usuario no encontrado.");
  }

  if (!canUploadSolicitudDocs(user)) {
    throw new HttpsError("permission-denied", "No autorizado para subir documentos.");
  }

  const rootId = getRootIdFromUser(user, uid);
  const data = request.data || {};

  const solicitudId = String(data.solicitudId || "").trim();
  const originalName = String(data.originalName || data.filename || "").trim();
  const contentType = String(data.contentType || "application/octet-stream").trim();
  const sizeBytes = Number(data.sizeBytes || 0);
  const documentType = normalizeSolicitudDocumentType(data.documentType);
  const customDocumentTypeLabel = sanitizeDocumentLabel(data.customDocumentTypeLabel || data.otherDocumentTypeLabel || "");
  const documentTypeLabel =
    documentType === "OTRO" && customDocumentTypeLabel
      ? customDocumentTypeLabel
      : getSolicitudDocumentTypeLabel(documentType);

  if (!solicitudId || !originalName) {
    throw new HttpsError("invalid-argument", "solicitudId y originalName son obligatorios.");
  }

  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new HttpsError("invalid-argument", "Tamaño de archivo inválido.");
  }

  if (sizeBytes > MAX_SOLICITUD_DOCUMENT_SIZE_BYTES) {
    throw new HttpsError("invalid-argument", "El archivo excede el limite de 1 MB.");
  }

  
  const inputSha256 = String(data.sha256 || data.fileSha256 || "").trim().toLowerCase();
  const sha256 = /^[a-f0-9]{64}$/.test(inputSha256) ? inputSha256 : "";
const { solicitud } = await loadSolicitudOrThrow({
    solicitudId,
    uid,
    user,
    rootId,
  });

  
const safeName = sanitizeFilename(originalName);
  const uploadId = db.collection("uploads").doc().id;
  const storagePath = buildSolicitudDocumentStoragePath({ rootId, solicitudId, documentType, uploadId, originalName: safeName });

  await db.collection("uploads").doc(uploadId).set({
    rootId,
    adminId: solicitud.adminId || rootId,
    clienteId: solicitud.clienteId || solicitud.clientId || null,
    clienteNombre: solicitud.clienteNombre || solicitud.clientName || null,
    companyId: solicitud.companyId || null,
    empresaNombre: solicitud.empresaNombre || solicitud.companyName || null,

    entityType: "solicitudes",
    entityId: solicitudId,
    solicitudId,
    solicitudFolio: solicitud.folio || null,

    documentType,
    documentTypeLabel,
    originalName,
    filename: safeName,
    contentType,
    sizeBytes,
    storagePath,

    
      sha256: sha256 || null,
      integrityHashAlgorithm: sha256 ? "SHA-256" : null,
      integritySealStatus: sha256 ? "HASH_CLIENT_REPORTED" : "NO_HASH",
      integritySealVersion: "PAY0-MATERIALIDAD-V1",
    status: "PENDING",
    active: false,
    version: null,

    createdBy: uid,
    createdUsername: getUsername(user, uid),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return {
    ok: true,
    uploadId,
    storagePath,
    
      sha256: sha256 || null,
      integrityHashAlgorithm: sha256 ? "SHA-256" : null,
      integritySealStatus: sha256 ? "HASH_CLIENT_REPORTED" : "NO_HASH",
      integritySealVersion: "PAY0-MATERIALIDAD-V1",
    documentType,
  };
}

export async function finalizeSolicitudDocumentUploadCore(request: any) {
  const uid = requireAuthLike(request);
  const user = await getUser(uid);

  if (!user) {
    throw new HttpsError("permission-denied", "Usuario no encontrado.");
  }

  if (!canUploadSolicitudDocs(user)) {
    throw new HttpsError("permission-denied", "No autorizado para finalizar documentos.");
  }

  const rootId = getRootIdFromUser(user, uid);
  const data = request.data || {};

  const uploadId = String(data.uploadId || "").trim();
  const storagePathIn = String(data.storagePath || "").trim();

  if (!uploadId) {
    throw new HttpsError("invalid-argument", "uploadId requerido.");
  }

  const uploadRef = db.collection("uploads").doc(uploadId);
  const uploadSnap = await uploadRef.get();

  if (!uploadSnap.exists) {
    throw new HttpsError("not-found", "Upload no existe.");
  }

  const upload = uploadSnap.data() || {};

  if (String(upload.rootId || "") !== rootId) {
    throw new HttpsError("permission-denied", "No autorizado.");
  }

  const solicitudId = String(upload.solicitudId || upload.entityId || "").trim();
  const documentType = normalizeSolicitudDocumentType(upload.documentType);

  if (!solicitudId) {
    throw new HttpsError("failed-precondition", "Upload sin solicitudId.");
  }

  await loadSolicitudOrThrow({
    solicitudId,
    uid,
    user,
    rootId,
  });

  const solicitudRef = db.collection("solicitudes").doc(solicitudId);

  
if (storagePathIn && storagePathIn !== String(upload.storagePath || "")) {
    throw new HttpsError("invalid-argument", "storagePath no coincide con el registro.");
  }

  let facturaXmlMetadata: FacturaXmlMetadata | null = null;
  let ocFiscalMetadata: OcFiscalMetadata | null = null;

  try {
    const bucket = admin.storage().bucket();
    const [exists] = await bucket.file(String(upload.storagePath || "")).exists();

    if (!exists) {
      throw new HttpsError("failed-precondition", "El archivo no existe en Storage.");
    }

    facturaXmlMetadata =
      documentType === "FACTURA_XML"
        ? await readFacturaXmlMetadataFromStorage(bucket, String(upload.storagePath || ""))
        : null;
    ocFiscalMetadata = documentType === "ORDEN_COMPRA"
      ? await readOcFiscalMetadata(bucket, String(upload.storagePath || ""))
      : null;
  } catch (e: any) {
    if (e instanceof HttpsError) throw e;
    throw new HttpsError("internal", "No se pudo verificar el archivo en Storage.");
  }

  let finalVersion = 1;

  await db.runTransaction(async (tx) => {
    const solicitudSnapH4D58H = await tx.get(solicitudRef);
    const solicitudH4D58H = solicitudSnapH4D58H.exists ? ((solicitudSnapH4D58H.data() || {}) as Record<string, unknown>) : {};
    // H4_D58H_B1_SOLICITUD_DOC_TX_READ
    finalVersion = await finalizeSolicitudDocumentVersionTx({
      tx,
      db,
      rootId,
      solicitudId,
      documentType,
      uploadId,
      uploadRef,
      mode: "update",
      readyPatch: {
        finalizedBy: uid,
        finalizedUsername: getUsername(user, uid),
        finalizedAt: FieldValue.serverTimestamp(),
        integritySealStatus: upload.sha256 ? "SEALED" : "SEALED_NO_HASH",
        integritySealedAt: FieldValue.serverTimestamp(),
        integritySealedBy: uid,
        integritySealedUsername: getUsername(user, uid),
        ...(facturaXmlMetadata ? {
          facturaSerie: facturaXmlMetadata.facturaSerie,
          facturaFolio: facturaXmlMetadata.facturaFolio,
          facturaDisplay: facturaXmlMetadata.facturaDisplay,
          facturaUuid: facturaXmlMetadata.facturaUuid,
          facturaSubtotal: facturaXmlMetadata.facturaSubtotal,
          facturaTotal: facturaXmlMetadata.facturaTotal,
          facturaMetodoPago: facturaXmlMetadata.facturaMetodoPago,
          facturaMoneda: facturaXmlMetadata.facturaMoneda,
          facturaFecha: facturaXmlMetadata.facturaFecha,
        } : {}),
      },
    });

        
      if (facturaXmlMetadata) {
        tx.update(solicitudRef, {
          numFactura: facturaXmlMetadata.facturaDisplay || null,
          facturaSerie: facturaXmlMetadata.facturaSerie,
          facturaFolio: facturaXmlMetadata.facturaFolio,
          facturaDisplay: facturaXmlMetadata.facturaDisplay,
          facturaUuid: facturaXmlMetadata.facturaUuid,
          uuidCfdi: facturaXmlMetadata.facturaUuid,
          facturaSubtotal: facturaXmlMetadata.facturaSubtotal,
          facturaTotal: facturaXmlMetadata.facturaTotal,
          facturaMetodoPago: facturaXmlMetadata.facturaMetodoPago,
          facturaMoneda: facturaXmlMetadata.facturaMoneda,
          facturaFecha: facturaXmlMetadata.facturaFecha,
          facturaXmlUploadId: uploadId,
          facturaMetadataSource: "FACTURA_XML",
          facturaMetadataUpdatedAt: FieldValue.serverTimestamp(),
        });
      }
      if (ocFiscalMetadata) {
        tx.set(solicitudRef, {
          satProductCode: ocFiscalMetadata.productCode,
          satUnitCode: ocFiscalMetadata.unitCode,
          ocConceptDescription: ocFiscalMetadata.description || null,
          ocQuantity: ocFiscalMetadata.quantity || 1,
          ocClientName: ocFiscalMetadata.clientName || null,
          ocClientRfc: ocFiscalMetadata.clientRfc || null,
          ocClientAddress: ocFiscalMetadata.clientAddress || null,
          ocDeliveryLocation: ocFiscalMetadata.deliveryLocation || null,
          ocItems: ocFiscalMetadata.items,
          cfdiUse: ocFiscalMetadata.cfdiUse,
          regimenFiscalReceptor: ocFiscalMetadata.fiscalRegime,
          postalCode: ocFiscalMetadata.postalCode,
          paymentMethod: ocFiscalMetadata.paymentMethod || null,
          paymentForm: ocFiscalMetadata.paymentForm || null,
          currency: ocFiscalMetadata.currency || "MXN",
          ocFiscalMetadataSource: "ORDEN_COMPRA_XLSX",
          ocFiscalMetadataUploadId: uploadId,
          ocFiscalMetadataUpdatedAt: FieldValue.serverTimestamp(),
          replacementOcStatus: "UPLOADED",
          replacementRequiresOc: false,
        }, { merge: true });
      }
    const iqUnlockPatchH4D58H = buildSolicitudIqReplacementUnlockPatchH4D58H({
      solicitud: solicitudH4D58H,
      uploadId,
      documentType,
      uid,
    });

    if (Object.keys(iqUnlockPatchH4D58H).length > 0) {
      tx.set(solicitudRef, iqUnlockPatchH4D58H, { merge: true });
    }
    // H4_D58H_B1_SOLICITUD_DOC_UNLOCK_WRITE
logActivityTx(tx, db, {
      event: "DOCUMENTO_SOLICITUD_SUBIDO",
      rootId,
      adminId: upload.adminId || rootId,
      actorUid: uid,
      actorUsername: getUsername(user, uid),
      actorRole: getRole(user),
      entityType: "solicitudes",
      entityId: solicitudId,
      referenceId: solicitudId,
      referenceFolio: upload.solicitudFolio || solicitudId,
      referenceType: "solicitudDocument",
      description: `Documento ${upload.documentTypeLabel || getSolicitudDocumentTypeLabel(documentType)} subido a solicitud ${upload.solicitudFolio || solicitudId}.`,
      createdBy: uid,
      extra: {
        source: "docs",
        clientId: upload.clienteId || upload.clientId || null,
        clienteId: upload.clienteId || upload.clientId || null,
        clientName: upload.clienteNombre || upload.clientName || null,
        clienteNombre: upload.clienteNombre || upload.clientName || null,
        companyId: upload.companyId || null,
        empresaNombre: upload.empresaNombre || upload.companyName || null,
        documentType,
        documentTypeLabel: upload.documentTypeLabel || getSolicitudDocumentTypeLabel(documentType),
        uploadId,
      },
    });
  });

  if (documentType === "ORDEN_COMPRA") {
    await enqueueIqCreationForSolicitud({
      solicitudId,
      requestedBy: uid,
      source: "OC_UPLOAD",
    }).catch(async (error) => {
      await solicitudRef.set(
        {
          iqCreateQueueStatus: "NOT_ENQUEUED",
          iqCreateQueueLastError: String(error?.message || error || "No se pudo encolar envio al despacho."),
          iqSyncUpdatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });

    await ensureAutomaticFacturamaDraftForSolicitud({
      auth: request.auth,
      solicitudId,
      source: "OC_UPLOAD",
    }).catch(async (error) => {
      await solicitudRef.set(
        {
          facturamaAutoDraftStatus: "ERROR",
          facturamaAutoDraftLastError: String(error?.message || error || "No se pudo preparar el borrador CFDI automatico desde la OC."),
          facturamaSyncUpdatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });

    await generateCotizacionForSolicitudCore({
      auth: request.auth,
      // The active OC is the source of truth. Replacing it must also replace
      // the derivative quotation; returning an old active version leaves its
      // SAT key, concept, amount, and receiver data stale.
      data: { solicitudId, replaceExisting: true },
    }).catch(async (error) => {
      await solicitudRef.set(
        {
          cotizacionAutoGenerateStatus: "ERROR",
          cotizacionAutoGenerateLastError: String(error?.message || error || "No se pudo generar la cotizacion automatica desde la OC."),
          cotizacionAutoGenerateUpdatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });
  }

  if (documentType === "FIRMA_AUTORIZADA_CLIENTE") {
    await generateConstanciaRecepcionForSolicitudCore({
      auth: request.auth,
      data: {
        solicitudId,
        signatureUploadId: uploadId,
        source: "SIGNATURE_UPLOAD",
      },
    }).catch(async (error) => {
      await solicitudRef.set(
        {
          constanciaAutoGenerateStatus: "ERROR",
          constanciaAutoGenerateLastError: String(error?.message || error || "No se pudo generar la constancia automatica desde la firma."),
          constanciaAutoGenerateUpdatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });
  }

  await linkSolicitudToMaterialityOperationCore({
    auth: request.auth,
    data: { solicitudId },
  }).catch(async (error) => {
    await solicitudRef.set(
      {
        materialitySyncStatus: "ERROR",
        materialitySyncLastError: String(error?.message || error || "No se pudo actualizar Materialidad."),
        materialitySyncUpdatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });

  return {
    ok: true,
    uploadId,
    status: "READY",
    active: true,
    version: finalVersion,
  };
}

/** Re-read the currently active OC without asking the user to upload it again. */
export async function reprocessActiveSolicitudOcCore(request: any) {
  const uid = requireAuthLike(request);
  const user = await getUser(uid);
  if (!user || !canUploadSolicitudDocs(user)) throw new HttpsError("permission-denied", "No autorizado para reprocesar la OC.");
  const rootId = getRootIdFromUser(user, uid);
  const solicitudId = String(request?.data?.solicitudId || "").trim();
  if (!solicitudId) throw new HttpsError("invalid-argument", "solicitudId requerido.");
  const { solicitudRef, solicitud } = await loadSolicitudOrThrow({ solicitudId, uid, user, rootId });
  const activeOc = await db.collection("uploads")
    .where("solicitudId", "==", solicitudId)
    .where("documentType", "==", "ORDEN_COMPRA")
    .where("active", "==", true)
    .limit(1)
    .get();
  if (activeOc.empty) throw new HttpsError("failed-precondition", "No existe una Orden de Compra activa para reprocesar.");
  const oc: any = activeOc.docs[0].data() || {};
  const metadata = await readOcFiscalMetadata(admin.storage().bucket(), String(oc.storagePath || ""));
  if (!metadata) throw new HttpsError("failed-precondition", "No se pudo extraer clave SAT, unidad y concepto de la OC activa.");

  await solicitudRef.set({
    satProductCode: metadata.productCode,
    satUnitCode: metadata.unitCode,
    ocConceptDescription: metadata.description || null,
    ocQuantity: metadata.quantity || 1,
    ocClientName: metadata.clientName || null,
    ocClientRfc: metadata.clientRfc || null,
    ocClientAddress: metadata.clientAddress || null,
    ocDeliveryLocation: metadata.deliveryLocation || null,
    ocItems: metadata.items,
    cfdiUse: metadata.cfdiUse,
    regimenFiscalReceptor: metadata.fiscalRegime,
    postalCode: metadata.postalCode,
    paymentMethod: metadata.paymentMethod || null,
    paymentForm: metadata.paymentForm || null,
    currency: metadata.currency || "MXN",
    ocFiscalMetadataSource: "ORDEN_COMPRA_XLSX",
    ocFiscalMetadataUploadId: activeOc.docs[0].id,
    ocFiscalMetadataUpdatedAt: FieldValue.serverTimestamp(),
    facturamaAutoDraftStatus: "REPROCESSING_ACTIVE_OC",
    cotizacionAutoGenerateStatus: "REPROCESSING_ACTIVE_OC",
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  await ensureAutomaticFacturamaDraftForSolicitud({ auth: request.auth, solicitudId, source: "OC_UPLOAD" });
  const quote = await generateCotizacionForSolicitudCore({ auth: request.auth, data: { solicitudId, replaceExisting: true } });
  await linkSolicitudToMaterialityOperationCore({ auth: request.auth, data: { solicitudId } });
  await logActivity({
    event: "ORDEN_COMPRA_REPROCESADA",
    rootId,
    adminId: solicitud.adminId || rootId,
    actorUid: uid,
    actorUsername: getUsername(user, uid),
    actorRole: getRole(user),
    entityType: "solicitudes",
    entityId: solicitudId,
    referenceId: solicitudId,
    referenceFolio: solicitud.folio || solicitudId,
    referenceType: "solicitudDocument",
    description: `OC activa reprocesada para solicitud ${solicitud.folio || solicitudId}; se actualizaron Facturacion y Cotizacion.`,
    createdBy: uid,
    extra: { source: "docs", activeOcUploadId: activeOc.docs[0].id, productCode: metadata.productCode, unitCode: metadata.unitCode, quotationUploadId: (quote as any).uploadId || null },
  });
  return { ok: true, activeOcUploadId: activeOc.docs[0].id, productCode: metadata.productCode, unitCode: metadata.unitCode, quote };
}

export async function deactivateSolicitudDocumentCore(request: any) {
  const uid = requireAuthLike(request);
  const user = await getUser(uid);

  if (!user) {
    throw new HttpsError("permission-denied", "Usuario no encontrado.");
  }

  if (!canUploadSolicitudDocs(user)) {
    throw new HttpsError("permission-denied", "No autorizado para desactivar documentos.");
  }

  const rootId = getRootIdFromUser(user, uid);
  const uploadId = String(request?.data?.uploadId || "").trim();

  if (!uploadId) {
    throw new HttpsError("invalid-argument", "uploadId requerido.");
  }

  const uploadRef = db.collection("uploads").doc(uploadId);
  const uploadSnap = await uploadRef.get();

  if (!uploadSnap.exists) {
    throw new HttpsError("not-found", "Documento no existe.");
  }

  const upload = uploadSnap.data() || {};

  if (String(upload.rootId || "") !== rootId) {
    throw new HttpsError("permission-denied", "No autorizado.");
  }

  const solicitudId = String(upload.solicitudId || upload.entityId || "").trim();

  await loadSolicitudOrThrow({
    solicitudId,
    uid,
    user,
    rootId,
  });

  
  await uploadRef.update({
    active: false,
    status: "INACTIVE",
    deactivatedBy: uid,
    deactivatedUsername: getUsername(user, uid),
    deactivatedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

    await logActivity({
    event: "DOCUMENTO_SOLICITUD_DESACTIVADO",
    rootId,
    adminId: upload.adminId || rootId,
    actorUid: uid,
    actorUsername: getUsername(user, uid),
    actorRole: getRole(user),
    entityType: "solicitudes",
    entityId: solicitudId,
    referenceId: solicitudId,
    referenceFolio: upload.solicitudFolio || solicitudId,
    referenceType: "solicitudDocument",
    description: `Documento ${upload.documentTypeLabel || upload.documentType || "OTRO"} desactivado en solicitud ${upload.solicitudFolio || solicitudId}.`,
    createdBy: uid,
    extra: {
      source: "docs",
      clientId: upload.clienteId || upload.clientId || null,
      clienteId: upload.clienteId || upload.clientId || null,
      clientName: upload.clienteNombre || upload.clientName || null,
      clienteNombre: upload.clienteNombre || upload.clientName || null,
      companyId: upload.companyId || null,
      empresaNombre: upload.empresaNombre || upload.companyName || null,
      documentType: upload.documentType || null,
      documentTypeLabel: upload.documentTypeLabel || null,
      uploadId,
    },
  });

  await linkSolicitudToMaterialityOperationCore({
    auth: request.auth,
    data: { solicitudId },
  }).catch(async (error) => {
    await db.collection("solicitudes").doc(solicitudId).set(
      {
        materialitySyncStatus: "ERROR",
        materialitySyncLastError: String(error?.message || error || "No se pudo actualizar Materialidad."),
        materialitySyncUpdatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });

  return {
    ok: true,
    uploadId,
    status: "INACTIVE",
  };
}
