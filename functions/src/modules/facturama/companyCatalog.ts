import { createHash } from "node:crypto";
import { getStorage } from "firebase-admin/storage";
import { FieldValue } from "firebase-admin/firestore";
import JSZip from "jszip";
import { HttpsError } from "firebase-functions/v2/https";
import { logActivity } from "../../utils/logActivity";
import { assertAuthorized, getUserRole } from "../../utils/authGuard";
import { db, getActivityAdminId, getMyUser, requireAuth } from "../sharedCallables/helpers";
import { lookupGlobalSatConcept } from "./satGlobalCatalog";
import { getCanonicalCatalogAttestation } from "./canonicalCatalogAttestations";

const REQUIRED_HEADERS = [
  "CLAVE_SAT",
  "DESCRIPCION_SAT",
  "TIPO",
  "CLAVE_UNIDAD_SUGERIDA",
  "UNIDAD_SUGERIDA",
  "CONCEPTO_COMERCIAL_SUGERIDO",
  "FAMILIA",
  "ACTIVIDAD_CSF_RESPALDO",
  "OBJETO_SOCIAL_RESPALDO",
  "RETENCION_OBLIGATORIA_POR_NATURALEZA",
  "ESTATUS",
] as const;

const ALLOWED_STATUS = new Set(["AUTORIZADO", "CONDICIONADO", "REVISIÓN"]);
const ACTIVE_STATUS = "ACTIVE";
const MAX_CATALOG_BYTES = 1024 * 1024;
const MAX_CATALOG_ROWS = 500;

export type CompanyCatalogEntry = {
  productCode: string;
  satDescription: string;
  type: "PRODUCTO" | "SERVICIO";
  unitCode: string;
  unit: string;
  commercialDescription: string;
  family: string;
  csfSupport: string;
  corporatePurposeSupport: string;
  retentionRequired: "SI" | "NO";
  status: "AUTORIZADO" | "CONDICIONADO" | "REVISIÓN";
  notes: string;
};

function text(value: unknown, max = 1000): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function isOwnInvoiceIssuerCompany(company: any): boolean {
  const rfc = text(company?.rfc, 13).toUpperCase();
  return company?.isOwnCompany === true || company?.ownedByRoot === true || company?.pay0OwnCompany === true ||
    text(company?.ownership || company?.companyOwnership || company?.companyType).toUpperCase() === "PROPIA" ||
    rfc === "TRO230717L64";
}

function normalizedHeader(value: unknown): string {
  return text(value, 120).toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function catalogStoragePath(input: { rootId: string; companyId: string; version: string; hash: string; originalName: string }) {
  const safeVersion = text(input.version, 80).replace(/[^a-zA-Z0-9._-]/g, "_") || "unversioned";
  const safeName = text(input.originalName, 160).replace(/[^a-zA-Z0-9._-]/g, "_") || "catalogo.xlsx";
  return `roots/${input.rootId}/companies/${input.companyId}/invoice-catalogs/${safeVersion}/${input.hash}-${safeName}`;
}

function decodeXml(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function xmlText(value: string): string {
  return decodeXml(value.replace(/<[^>]+>/g, ""));
}

function columnNumber(reference: string): number {
  let result = 0;
  for (const char of reference.replace(/\d/g, "")) result = result * 26 + char.charCodeAt(0) - 64;
  return result;
}

function readCellValue(cellXml: string, sharedStrings: string[]): string {
  const type = /\bt="([^"]+)"/.exec(cellXml)?.[1] || "";
  if (type === "s") {
    const index = Number(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/.exec(cellXml)?.[1] || -1);
    return Number.isInteger(index) ? sharedStrings[index] || "" : "";
  }
  if (type === "inlineStr") return xmlText(/<(?:\w+:)?is>([\s\S]*?)<\/(?:\w+:)?is>/.exec(cellXml)?.[1] || "");
  return xmlText(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/.exec(cellXml)?.[1] || "");
}

export async function parseCompanyInvoiceCatalogWorkbook(buffer: Buffer): Promise<CompanyCatalogEntry[]> {
    const zip = await JSZip.loadAsync(buffer);
    const sharedXml = await zip.file("xl/sharedStrings.xml")?.async("string") || "";
    const sharedStrings = [...sharedXml.matchAll(/<(?:\w+:)?si(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((match) => xmlText(match[1]));
    const sheetNames = Object.keys(zip.files).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
    let rows: Map<number, Map<number, string>> | null = null;
    for (const sheetName of sheetNames) {
      const xml = await zip.file(sheetName)?.async("string") || "";
      const candidate = new Map<number, Map<number, string>>();
      for (const rowMatch of xml.matchAll(/<(?:\w+:)?row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g)) {
        const cells = new Map<number, string>();
        for (const cellMatch of rowMatch[2].matchAll(/<(?:\w+:)?c\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?c>/g)) {
          const reference = /\br="([A-Z]+\d+)"/.exec(cellMatch[1])?.[1] || "";
          if (reference) cells.set(columnNumber(reference), readCellValue(`${cellMatch[1]}>${cellMatch[2]}`, sharedStrings));
        }
        candidate.set(Number(rowMatch[1]), cells);
      }
      if (normalizedHeader(candidate.get(4)?.get(1)) === "CLAVE_SAT") { rows = candidate; break; }
    }
    if (!rows) throw new HttpsError("invalid-argument", "El Excel no contiene una hoja de catálogo con CLAVE_SAT en la fila 4.");

    const headerRow = 4;
    const headerToColumn = new Map<string, number>();
    rows.get(headerRow)?.forEach((cell, col) => {
      const header = normalizedHeader(cell);
      if (header) headerToColumn.set(header, col);
    });
    const missingHeaders = REQUIRED_HEADERS.filter((header) => !headerToColumn.has(header));
    if (missingHeaders.length) {
      throw new HttpsError("invalid-argument", `El Excel no cumple el contrato canónico. Faltan: ${missingHeaders.join(", ")}.`);
    }

    const value = (row: Map<number, string>, header: string, max?: number) => text(row.get(headerToColumn.get(header) || 0), max);
    const entries: CompanyCatalogEntry[] = [];
    const seen = new Set<string>();
    const rowNumbers = [...rows.keys()].filter((rowNumber) => rowNumber > headerRow).sort((a, b) => a - b);
    for (const rowNumber of rowNumbers) {
      const row = rows.get(rowNumber) || new Map<number, string>();
      const productCode = value(row, "CLAVE_SAT", 8);
      if (!productCode) continue;
      if (!/^\d{8}$/.test(productCode)) throw new HttpsError("invalid-argument", `Fila ${rowNumber}: CLAVE_SAT debe tener ocho dígitos.`);
      if (seen.has(productCode)) throw new HttpsError("invalid-argument", `Fila ${rowNumber}: CLAVE_SAT duplicada (${productCode}).`);
      seen.add(productCode);

      const status = value(row, "ESTATUS", 20).toUpperCase() as CompanyCatalogEntry["status"];
      const type = value(row, "TIPO", 20).toUpperCase() as CompanyCatalogEntry["type"];
      const unitCode = value(row, "CLAVE_UNIDAD_SUGERIDA", 3).toUpperCase();
      const retention = value(row, "RETENCION_OBLIGATORIA_POR_NATURALEZA", 3).toUpperCase();
      if (!ALLOWED_STATUS.has(status)) throw new HttpsError("invalid-argument", `Fila ${rowNumber}: ESTATUS inválido.`);
      if (type !== "PRODUCTO" && type !== "SERVICIO") throw new HttpsError("invalid-argument", `Fila ${rowNumber}: TIPO debe ser PRODUCTO o SERVICIO.`);
      if (!/^[A-Z0-9]{2,3}$/.test(unitCode)) throw new HttpsError("invalid-argument", `Fila ${rowNumber}: CLAVE_UNIDAD_SUGERIDA inválida.`);
      if (retention !== "SI" && retention !== "NO") throw new HttpsError("invalid-argument", `Fila ${rowNumber}: RETENCION_OBLIGATORIA_POR_NATURALEZA debe ser SI o NO.`);

      const entry: CompanyCatalogEntry = {
        productCode,
        satDescription: value(row, "DESCRIPCION_SAT", 500),
        type,
        unitCode,
        unit: value(row, "UNIDAD_SUGERIDA", 100),
        commercialDescription: value(row, "CONCEPTO_COMERCIAL_SUGERIDO", 1000),
        family: value(row, "FAMILIA", 160),
        csfSupport: value(row, "ACTIVIDAD_CSF_RESPALDO", 1000),
        corporatePurposeSupport: value(row, "OBJETO_SOCIAL_RESPALDO", 1000),
        retentionRequired: retention,
        status,
        notes: value(row, "OBSERVACIONES", 1500),
      };
      if (!entry.satDescription || !entry.unit || !entry.commercialDescription) {
        throw new HttpsError("invalid-argument", `Fila ${rowNumber}: faltan campos descriptivos obligatorios.`);
      }
      entries.push(entry);
    }
    if (!entries.length) throw new HttpsError("invalid-argument", "El catálogo no contiene conceptos.");
    if (entries.length > MAX_CATALOG_ROWS) throw new HttpsError("invalid-argument", "El catálogo excede el límite de conceptos.");
    return entries;
}

function decodeBase64(value: unknown): Buffer {
  const raw = String(value || "").replace(/^data:[^;]+;base64,/, "").trim();
  if (!raw || !/^[A-Za-z0-9+/=\s]+$/.test(raw)) throw new HttpsError("invalid-argument", "Archivo Excel inválido.");
  const buffer = Buffer.from(raw, "base64");
  if (!buffer.length || buffer.length > MAX_CATALOG_BYTES) throw new HttpsError("invalid-argument", "El Excel debe pesar entre 1 byte y 1 MB.");
  return buffer;
}

async function getOwnCompanyOrThrow(companyId: string, rootId: string) {
  const snap = await db.doc(`companies/${companyId}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "Empresa emisora no encontrada.");
  const company: any = snap.data() || {};
  if (text(company.rootId, 128) !== rootId || company.active === false) throw new HttpsError("permission-denied", "Empresa fuera de tu alcance o inactiva.");
  if (!isOwnInvoiceIssuerCompany(company)) throw new HttpsError("failed-precondition", "Solo las empresas propias pueden tener catálogo emisor CFDI.");
  return { snap, company };
}

export async function importCompanyInvoiceCatalogCore(request: any) {
  const uid = requireAuth(request);
  const user = await getMyUser(uid);
  assertAuthorized(request.auth, user, { allowedRoles: ["superadmin"] });
  const rootId = text(user?.rootId || uid, 128);
  const companyId = text(request.data?.companyId, 128);
  const version = text(request.data?.version, 80);
  const originalName = text(request.data?.originalName, 160);
  if (!companyId || !version || !originalName) throw new HttpsError("invalid-argument", "companyId, version y originalName son obligatorios.");

  const buffer = decodeBase64(request.data?.workbookBase64);
  const actualSha256 = sha256(buffer);
  const reportedSha256 = text(request.data?.sha256, 64).toLowerCase();
  if (reportedSha256 && reportedSha256 !== actualSha256) throw new HttpsError("invalid-argument", "El hash informado no coincide con el archivo.");
  const [entries, companyResult] = await Promise.all([parseCompanyInvoiceCatalogWorkbook(buffer), getOwnCompanyOrThrow(companyId, rootId)]);
  const catalogRef = db.doc(`companyInvoiceCatalogs/${companyId}`);
  const existingSnap = await catalogRef.get();
  const existing: any = existingSnap.exists ? existingSnap.data() || {} : {};
  if (existingSnap.exists && text(existing.rootId, 128) !== rootId) throw new HttpsError("permission-denied", "Catálogo fuera de tu alcance.");
  if (existingSnap.exists && text(existing.sourceSha256, 64) === actualSha256) {
    const canonicalAttestation = getCanonicalCatalogAttestation(existing.companyRfc || companyResult.company.rfc, actualSha256);
    const satGlobalValidationStatus = canonicalAttestation ? "VERIFIED_CANONICAL_SAT_SNAPSHOT" : String(existing.satGlobalValidationStatus || "PENDING_GLOBAL_SAT_CATALOG");
    if (canonicalAttestation && existing.satGlobalValidationStatus !== satGlobalValidationStatus) {
      await catalogRef.update({
        satGlobalValidationStatus,
        canonicalSatAttestation: {
          satSourceSha256: canonicalAttestation.satSourceSha256,
          sourceLabel: canonicalAttestation.sourceLabel,
          verificationMode: "IMMUTABLE_CANONICAL_SNAPSHOT",
        },
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    return { ok: true, reused: true, companyId, version: existing.version, entryCount: Number(existing.entryCount || 0), sourceSha256: actualSha256, satGlobalValidationStatus };
  }

  const importId = `${companyId}__${actualSha256}`;
  const importRef = db.doc(`companyInvoiceCatalogImports/${importId}`);
  const storagePath = catalogStoragePath({ rootId, companyId, version, hash: actualSha256, originalName });
  const bucket = getStorage().bucket();
  const file = bucket.file(storagePath);
  const [fileExists] = await file.exists();
  if (!fileExists) {
    await file.save(buffer, {
      resumable: false,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      metadata: { metadata: { rootId, companyId, version, sha256: actualSha256, kind: "COMPANY_INVOICE_CATALOG" } },
    });
  }

  const counts = entries.reduce((acc: Record<string, number>, entry) => {
    acc[entry.status] = Number(acc[entry.status] || 0) + 1;
    return acc;
  }, {});
  const issuerRfc = text(companyResult.company.rfc, 13).toUpperCase();
  const canonicalAttestation = getCanonicalCatalogAttestation(issuerRfc, actualSha256);
  const satGlobalValidationStatus = canonicalAttestation
    ? "VERIFIED_CANONICAL_SAT_SNAPSHOT"
    : "PENDING_GLOBAL_SAT_CATALOG";
  const now = FieldValue.serverTimestamp();
  await db.runTransaction(async (tx) => {
    const current = await tx.get(catalogRef);
    if (current.exists && text((current.data() || {}).rootId, 128) !== rootId) throw new HttpsError("permission-denied", "Catálogo fuera de tu alcance.");
    tx.set(importRef, {
      rootId, companyId, companyRfc: issuerRfc, version, originalName, storagePath,
      sourceSha256: actualSha256, integrityHashAlgorithm: "SHA-256", entryCount: entries.length, statusCounts: counts,
      status: "IMPORTED", importedBy: uid, importedAt: now, createdAt: now, updatedAt: now,
    }, { merge: true });
    tx.set(catalogRef, {
      rootId, companyId, companyRfc: text(companyResult.company.rfc, 13).toUpperCase(), version, originalName, storagePath,
      sourceSha256: actualSha256, integrityHashAlgorithm: "SHA-256", entryCount: entries.length, statusCounts: counts, entries,
      status: ACTIVE_STATUS,
      satGlobalValidationStatus,
      canonicalSatAttestation: canonicalAttestation ? {
        satSourceSha256: canonicalAttestation.satSourceSha256,
        sourceLabel: canonicalAttestation.sourceLabel,
        verificationMode: "IMMUTABLE_CANONICAL_SNAPSHOT",
      } : null,
      automaticUseStatuses: ["AUTORIZADO"],
      importedBy: uid, importedAt: now, updatedAt: now,
    }, { merge: true });
  });

  await logActivity({
    event: "CATALOGO_FISCAL_EMPRESA_IMPORTADO", rootId, adminId: getActivityAdminId(user, uid, rootId), actorUid: uid,
    actorName: text(user?.email || uid), actorRole: String(getUserRole(user)), referenceId: companyId, referenceType: "companyInvoiceCatalog",
    description: `Catálogo fiscal ${version} importado para ${text(companyResult.company.nombre || companyId, 254)}.`,
    extra: { companyId, version, sourceSha256: actualSha256, entryCount: entries.length, statusCounts: counts, storagePath },
  });

  return { ok: true, reused: false, companyId, version, entryCount: entries.length, statusCounts: counts, sourceSha256: actualSha256, satGlobalValidationStatus };
}

export type FiscalResolution = {
  status: "VALID" | "SAT_CLASSIFICATION_REVIEW_REQUIRED" | "COMPANY_SAT_KEY_NOT_AUTHORIZED" | "SAT_UNIT_INVALID" | "PENDING_GLOBAL_SAT_CATALOG";
  entry?: CompanyCatalogEntry;
  productCode?: string;
  unitCode?: string;
  companyCatalogVersion?: string;
  companyCatalogSha256?: string;
  reason?: string;
};

export async function resolveCompanyInvoiceConcept(input: { rootId: string; companyId: string; productCode: string; unitCode?: string }): Promise<FiscalResolution> {
  const catalogSnap = await db.doc(`companyInvoiceCatalogs/${input.companyId}`).get();
  if (!catalogSnap.exists) return { status: "SAT_CLASSIFICATION_REVIEW_REQUIRED", reason: "COMPANY_CATALOG_NOT_IMPORTED" };
  const catalog: any = catalogSnap.data() || {};
  if (text(catalog.rootId, 128) !== input.rootId || catalog.status !== ACTIVE_STATUS) return { status: "SAT_CLASSIFICATION_REVIEW_REQUIRED", reason: "COMPANY_CATALOG_NOT_ACTIVE" };
  const productCode = text(input.productCode, 8);
  const unitCode = text(input.unitCode, 3).toUpperCase();
  if (!productCode) return { status: "SAT_CLASSIFICATION_REVIEW_REQUIRED", reason: "MISSING_EXPLICIT_SAT_CLASSIFICATION" };
  const entry = Array.isArray(catalog.entries) ? catalog.entries.find((item: any) => text(item?.productCode, 8) === productCode) as CompanyCatalogEntry | undefined : undefined;
  if (!entry || entry.status !== "AUTORIZADO") return { status: "COMPANY_SAT_KEY_NOT_AUTHORIZED", productCode, reason: entry ? `ENTRY_${entry.status}` : "PRODUCT_CODE_NOT_IN_COMPANY_CATALOG" };
  if (unitCode && unitCode !== entry.unitCode) return { status: "SAT_UNIT_INVALID", productCode, unitCode, reason: "UNIT_DOES_NOT_MATCH_COMPANY_CATALOG" };
  const snapshot = { companyCatalogVersion: text(catalog.version, 80), companyCatalogSha256: text(catalog.sourceSha256, 64) };
  const canonicalAttestation = getCanonicalCatalogAttestation(catalog.companyRfc, snapshot.companyCatalogSha256);
  // La atestación se deriva del RFC y del hash inmutable, no de una bandera
  // editable. También permite operar con el catálogo canónico ya importado
  // antes de esta mejora; la siguiente reimportación solo actualiza su UI.
  if (canonicalAttestation) {
    return { status: "VALID", productCode, unitCode: entry.unitCode, entry, ...snapshot };
  }
  const global = await lookupGlobalSatConcept(productCode, entry.unitCode);
  if (!global.product || !global.unit) return { status: "PENDING_GLOBAL_SAT_CATALOG", productCode, unitCode: entry.unitCode, entry, reason: "GLOBAL_SAT_CATALOG_NOT_IMPORTED_OR_KEY_NOT_EFFECTIVE", ...snapshot };
  return { status: "VALID", productCode, unitCode: entry.unitCode, entry, ...snapshot };
}

export async function resolveSolicitudFiscalClassification(input: { rootId: string; companyId: string; solicitud: any }): Promise<FiscalResolution> {
  const productCode = text(input.solicitud?.satProductCode || input.solicitud?.claveProdServ || input.solicitud?.fiscalClassification?.productCode, 8);
  const unitCode = text(input.solicitud?.satUnitCode || input.solicitud?.claveUnidad || input.solicitud?.fiscalClassification?.unitCode, 3).toUpperCase();
  return resolveCompanyInvoiceConcept({ rootId: input.rootId, companyId: input.companyId, productCode, unitCode });
}
