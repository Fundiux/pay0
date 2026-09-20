import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { HttpsError } from "firebase-functions/v2/https";
import { assertAuthorized, getUserRole } from "../../utils/authGuard";
import { logActivity } from "../../utils/logActivity";
import { db, getActivityAdminId, getMyUser, requireAuth } from "../sharedCallables/helpers";

// Both libraries are pure JavaScript/WASM.  A native SQLite module would make
// Cloud Functions deployments platform-dependent.
const Bunzip: { decode(input: Buffer): Buffer } = require("seek-bzip");
const initSqlJs: (config: { locateFile: (name: string) => string }) => Promise<any> = require("sql.js");

const MAX_BZIP_BYTES = 40 * 1024 * 1024;
const MAX_SQLITE_BYTES = 140 * 1024 * 1024;
const PRODUCT_COLLECTION = "satProductServiceCatalog";
const UNIT_COLLECTION = "satUnitCatalog";
const SAT_STATE_REF = db.doc("satCatalogState/current");

type SatProduct = { code: string; description: string; ivaTransferred: string; iepsTransferred: string; complement: string; validFrom: string; validTo: string; borderStimulus: boolean; similarTerms: string };
type SatUnit = { code: string; name: string; description: string; notes: string; validFrom: string; validTo: string; symbol: string };

function text(value: unknown, max = 1000): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function safeName(value: unknown): string {
  return text(value, 180).replace(/[^a-zA-Z0-9._-]/g, "_") || "catalogs.db.bz2";
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function effectiveDate(value: unknown): string {
  const date = text(value, 10);
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return new Date().toISOString().slice(0, 10);
}

function storagePath(rootId: string, importId: string, _originalName: string): string {
  // The immutable object name equals the Firestore import id so Storage Rules
  // can authorize it without parsing a file name (Rules has no split API).
  return `roots/${rootId}/fiscal-catalogs/sat/${importId}`;
}

function importRef(id: string) {
  return db.collection("satCatalogImports").doc(id);
}

async function getSuperadminContext(request: any) {
  const uid = requireAuth(request);
  const user = await getMyUser(uid);
  assertAuthorized(request.auth, user, { allowedRoles: ["superadmin"] });
  return { uid, user, rootId: text(user?.rootId || uid, 128) };
}

export async function initGlobalSatCatalogUploadCore(request: any) {
  const { uid, user, rootId } = await getSuperadminContext(request);
  const originalName = safeName(request.data?.originalName);
  const fileSize = Number(request.data?.fileSize);
  const reportedHash = text(request.data?.sha256, 64).toLowerCase();
  const versionLabel = text(request.data?.versionLabel, 120);
  if (!/\.db\.bz2$/i.test(originalName)) throw new HttpsError("invalid-argument", "El catálogo SAT debe ser un archivo .db.bz2.");
  if (!Number.isFinite(fileSize) || fileSize < 1 || fileSize > MAX_BZIP_BYTES) throw new HttpsError("invalid-argument", "El archivo SAT debe pesar entre 1 byte y 40 MB.");
  if (reportedHash && !/^[a-f0-9]{64}$/.test(reportedHash)) throw new HttpsError("invalid-argument", "El hash SHA-256 informado no es válido.");

  const ref = db.collection("satCatalogImports").doc();
  const path = storagePath(rootId, ref.id, originalName);
  await ref.set({
    rootId, id: ref.id, originalName, storagePath: path, fileSize, reportedSha256: reportedHash || null,
    versionLabel: versionLabel || null, status: "PENDING_UPLOAD", createdBy: uid,
    createdByName: text(user?.email || uid, 254), createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });
  return { ok: true, importId: ref.id, storagePath: path, maxSizeBytes: MAX_BZIP_BYTES };
}

function rows(dbHandle: any, query: string, params: unknown[]): any[][] {
  const result = dbHandle.exec(query, params);
  return result?.[0]?.values || [];
}

async function parseSatSqlite(bzip: Buffer, asOf: string): Promise<{ products: SatProduct[]; units: SatUnit[] }> {
  if (bzip.length > MAX_BZIP_BYTES || bzip.subarray(0, 3).toString("ascii") !== "BZh") throw new HttpsError("invalid-argument", "El archivo no es una base SQLite comprimida BZip2 válida.");
  let raw: Buffer;
  try { raw = Bunzip.decode(bzip); } catch { throw new HttpsError("invalid-argument", "No se pudo descomprimir el catálogo SAT."); }
  if (raw.length > MAX_SQLITE_BYTES || raw.subarray(0, 16).toString("ascii") !== "SQLite format 3\u0000") throw new HttpsError("invalid-argument", "La descompresión no contiene una base SQLite válida.");
  const SQL = await initSqlJs({ locateFile: (name) => require.resolve(`sql.js/dist/${name}`) });
  const database = new SQL.Database(new Uint8Array(raw));
  try {
    const names = new Set(rows(database, "SELECT name FROM sqlite_master WHERE type='table'", []).map((row) => String(row[0])));
    if (!names.has("cfdi_40_productos_servicios") || !names.has("cfdi_40_claves_unidades")) throw new HttpsError("invalid-argument", "La base no contiene los catálogos CFDI 4.0 requeridos.");
    const products = rows(database, `SELECT id, texto, iva_trasladado, ieps_trasladado, complemento, vigencia_desde, vigencia_hasta, estimulo_frontera, similares
      FROM cfdi_40_productos_servicios WHERE vigencia_desde <= ? AND (vigencia_hasta = '' OR vigencia_hasta >= ?)`, [asOf, asOf])
      .map((r) => ({ code: text(r[0], 8), description: text(r[1], 1000), ivaTransferred: text(r[2], 120), iepsTransferred: text(r[3], 120), complement: text(r[4], 160), validFrom: text(r[5], 10), validTo: text(r[6], 10), borderStimulus: Number(r[7]) === 1, similarTerms: text(r[8], 1000) }))
      .filter((row) => /^\d{8}$/.test(row.code) && !!row.description);
    const units = rows(database, `SELECT id, texto, descripcion, notas, vigencia_desde, vigencia_hasta, simbolo
      FROM cfdi_40_claves_unidades WHERE vigencia_desde <= ? AND (vigencia_hasta = '' OR vigencia_hasta >= ?)`, [asOf, asOf])
      .map((r) => ({ code: text(r[0], 3).toUpperCase(), name: text(r[1], 500), description: text(r[2], 1000), notes: text(r[3], 2000), validFrom: text(r[4], 10), validTo: text(r[5], 10), symbol: text(r[6], 80) }))
      .filter((row) => /^[A-Z0-9]{2,3}$/.test(row.code) && !!row.name);
    if (!products.length || !units.length) throw new HttpsError("invalid-argument", "No hay claves CFDI 4.0 vigentes para la fecha indicada.");
    return { products, units };
  } finally { database.close(); }
}

async function writeInChunks(collection: string, entries: Array<SatProduct | SatUnit>, versionId: string, importedAt: FieldValue, asOf: string) {
  for (let start = 0; start < entries.length; start += 400) {
    const batch = db.batch();
    entries.slice(start, start + 400).forEach((entry) => {
      batch.set(db.collection(collection).doc(entry.code), { ...entry, sourceVersionId: versionId, effectiveAsOf: asOf, active: true, updatedAt: importedAt }, { merge: true });
    });
    await batch.commit();
  }
}

export async function finalizeGlobalSatCatalogImportCore(request: any) {
  const { uid, user, rootId } = await getSuperadminContext(request);
  const importId = text(request.data?.importId, 128);
  if (!importId) throw new HttpsError("invalid-argument", "importId es obligatorio.");
  const ref = importRef(importId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Importación SAT no encontrada.");
  const row: any = snap.data() || {};
  if (text(row.rootId, 128) !== rootId) throw new HttpsError("permission-denied", "Importación fuera de tu alcance.");
  if (row.status === "IMPORTED") return { ok: true, reused: true, importId, productCount: Number(row.productCount || 0), unitCount: Number(row.unitCount || 0) };
  if (row.status !== "PENDING_UPLOAD") throw new HttpsError("failed-precondition", "La importación no está disponible para procesarse.");
  const file = getStorage().bucket().file(text(row.storagePath, 1200));
  const [exists] = await file.exists();
  if (!exists) throw new HttpsError("failed-precondition", "El archivo SAT aún no existe en Storage.");
  const [bzip] = await file.download();
  if (bzip.length !== Number(row.fileSize)) throw new HttpsError("failed-precondition", "El tamaño cargado no coincide con el tamaño registrado.");
  const actualHash = sha256(bzip);
  if (row.reportedSha256 && text(row.reportedSha256, 64).toLowerCase() !== actualHash) throw new HttpsError("failed-precondition", "El hash cargado no coincide con el hash informado.");
  const asOf = effectiveDate(request.data?.effectiveAsOf);
  const parsed = await parseSatSqlite(bzip, asOf);
  const importedAt = FieldValue.serverTimestamp();
  await ref.update({ status: "IMPORTING", sourceSha256: actualHash, effectiveAsOf: asOf, updatedAt: importedAt });
  try {
    await writeInChunks(PRODUCT_COLLECTION, parsed.products, importId, importedAt, asOf);
    await writeInChunks(UNIT_COLLECTION, parsed.units, importId, importedAt, asOf);
    await db.runTransaction(async (tx) => {
      tx.set(SAT_STATE_REF, { activeImportId: importId, sourceSha256: actualHash, effectiveAsOf: asOf, productCount: parsed.products.length, unitCount: parsed.units.length, activatedAt: importedAt, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      tx.update(ref, { status: "IMPORTED", sourceSha256: actualHash, integrityHashAlgorithm: "SHA-256", productCount: parsed.products.length, unitCount: parsed.units.length, importedBy: uid, importedAt, updatedAt: FieldValue.serverTimestamp() });
    });
  } catch (error) {
    await ref.update({ status: "IMPORT_FAILED", error: text((error as Error)?.message, 500), updatedAt: FieldValue.serverTimestamp() });
    throw error;
  }
  await logActivity({ event: "CATALOGO_SAT_GLOBAL_IMPORTADO", rootId, adminId: getActivityAdminId(user, uid, rootId), actorUid: uid, actorName: text(user?.email || uid), actorRole: String(getUserRole(user)), referenceId: importId, referenceType: "satCatalogImport", description: `Catálogo SAT global importado: ${parsed.products.length} productos/servicios y ${parsed.units.length} unidades.`, extra: { importId, sourceSha256: actualHash, effectiveAsOf: asOf, productCount: parsed.products.length, unitCount: parsed.units.length } });
  return { ok: true, reused: false, importId, sourceSha256: actualHash, productCount: parsed.products.length, unitCount: parsed.units.length, effectiveAsOf: asOf };
}

export async function lookupGlobalSatConcept(productCode: string, unitCode: string) {
  const state = await SAT_STATE_REF.get();
  const activeImportId = text(state.data()?.activeImportId, 128);
  if (!activeImportId) return { product: null, unit: null };
  const [product, unit] = await Promise.all([db.collection(PRODUCT_COLLECTION).doc(productCode).get(), db.collection(UNIT_COLLECTION).doc(unitCode).get()]);
  const isCurrent = (snap: FirebaseFirestore.DocumentSnapshot) => snap.exists && snap.data()?.active === true && text(snap.data()?.sourceVersionId, 128) === activeImportId;
  return { product: isCurrent(product) ? product.data() : null, unit: isCurrent(unit) ? unit.data() : null };
}
