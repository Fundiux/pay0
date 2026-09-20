import assert from "node:assert/strict";
import crypto from "node:crypto";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
  throw new Error("Este smoke requiere Firestore y Storage Emulator; se niega a ejecutarse fuera de emuladores.");
}

const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT || "pay-0-system";
// El Functions Emulator inicializa Admin con el bucket que declara FIREBASE_CONFIG.
// El smoke debe usar exactamente ese bucket para simular al navegador, no inferir
// el sufijo de producción.
const firebaseConfig = process.env.FIREBASE_CONFIG ? JSON.parse(process.env.FIREBASE_CONFIG) : {};
if (!getApps().length) initializeApp({ projectId, storageBucket: firebaseConfig.storageBucket || `${projectId}.appspot.com` });

const db = getFirestore();
const bucket = getStorage().bucket();
const suffix = `matoc${Date.now()}`;
const rootId = `root-${suffix}`;
const uid = `superadmin-${suffix}`;
const solicitudId = `sol-${suffix}`;
const clientId = `client-${suffix}`;
const companyId = `trostre-${suffix}`;
const auth = { uid };
const hash = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

async function activeUpload(type) {
  const snap = await db.collection("uploads").where("solicitudId", "==", solicitudId).where("documentType", "==", type).where("active", "==", true).limit(1).get();
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

console.log("=== MATERIALIDAD OC AUTOMATICA SMOKE (EMULATOR ONLY) ===");

await db.doc(`users/${uid}`).set({
  rootId, role: "superadmin", email: "smoke@pay0.local", username: "Smoke Superadmin",
  modules: { solicitudes: { uploadDocs: true, view: true } }, active: true,
});
await db.doc(`companies/${companyId}`).set({ rootId, active: true, rfc: "TRO230717L64", nombre: "TROSTRE", isOwnCompany: true });
await db.doc(`clients/${clientId}`).set({ rootId, active: true, rfc: "XAXX010101000", razonSocial: "CLIENTE SMOKE", fiscalRegime: "601", postalCode: "01000", cfdiUse: "G03" });
await db.doc(`companyInvoiceCatalogs/${companyId}`).set({
  rootId, companyId, status: "ACTIVE", version: "smoke-1", sourceSha256: "a".repeat(64), satGlobalValidationStatus: "VALID",
  entries: [{ productCode: "72141702", satDescription: "Servicio de alquiler o leasing de equipo para construcción", type: "SERVICIO", unitCode: "E48", unit: "Unidad de servicio", commercialDescription: "RENTA SMOKE", family: "SMOKE", csfSupport: "SMOKE", corporatePurposeSupport: "SMOKE", retentionRequired: "NO", status: "AUTORIZADO", notes: "" }],
});
await db.doc("satCatalogState/current").set({ activeImportId: "smoke-sat", active: true });
await db.doc("satProductServiceCatalog/72141702").set({ active: true, sourceVersionId: "smoke-sat", code: "72141702", description: "Servicio de alquiler o leasing de equipo para construcción" });
await db.doc("satUnitCatalog/E48").set({ active: true, sourceVersionId: "smoke-sat", code: "E48", name: "Unidad de servicio" });
await db.doc(`solicitudes/${solicitudId}`).set({
  rootId, adminId: uid, createdBy: uid, folio: `SMOKE-${suffix}`, status: "PROCESANDO",
  clienteId: clientId, clienteNombre: "CLIENTE SMOKE", clienteRfc: "XAXX010101000",
  companyId, empresaNombre: "TROSTRE", monto: 1000, moneda: "MXN",
  concepto: "Renta de barrera anti-derrame", operationTypeName: "Renta de barrera anti-derrame",
  satProductCode: "72141702", satUnitCode: "E48", paymentForm: "03", paymentMethod: "PUE",
  createdAt: Timestamp.now(), updatedAt: FieldValue.serverTimestamp(),
});

console.log("SMOKE_STAGE=fixture_ready");
const { initSolicitudDocumentUploadCore, finalizeSolicitudDocumentUploadCore } = await import("../../functions/lib/modules/solicitudDocuments/service.js");
const init = await initSolicitudDocumentUploadCore({ auth, data: {
  solicitudId, documentType: "ORDEN_COMPRA", originalName: "oc-smoke.xlsx",
  contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sizeBytes: 32,
  sha256: hash(Buffer.from("OC SMOKE CONTENT")),
} });
await bucket.file(init.storagePath).save(Buffer.from("OC SMOKE CONTENT"), { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
console.log("SMOKE_STAGE=oc_saved");
await finalizeSolicitudDocumentUploadCore({ auth, data: { uploadId: init.uploadId, storagePath: init.storagePath } });
console.log("SMOKE_STAGE=oc_finalized");

const [oc, quote, operation, invoice] = await Promise.all([
  activeUpload("ORDEN_COMPRA"), activeUpload("COTIZACION"), db.doc(`materialityOperations/${solicitudId}`).get(),
  db.collection("facturamaInvoices").where("sourceSolicitudId", "==", solicitudId).limit(1).get(),
]);
assert.ok(oc, "La OC debe quedar activa.");
assert.ok(quote, "La OC debe generar cotización automática.");
assert.ok(operation.exists, "La OC debe crear/actualizar el expediente de Materialidad.");
assert.equal(invoice.size, 1, "La OC debe crear un único borrador Facturama idempotente.");
assert.equal(invoice.docs[0].data().status, "AUTO_DRAFT_FISCAL_VALIDATED", "El borrador debe usar la clasificación fiscal autorizada.");

console.log("SMOKE_STAGE=automatic_documents_verified");
// Simula el enlace que recibe el cliente. submitSolicitudSignature se invoca
// por HTTP contra Functions Emulator: valida también la ruta pública, Storage
// y el disparo automático de la constancia.
const token = `smoke-token-${suffix}`;
await db.doc(`signatureRequests/${token}`).set({ rootId, solicitudId, solicitudFolio: `SMOKE-${suffix}`, clienteId: clientId, clienteNombre: "CLIENTE SMOKE", companyId, status: "PENDING", createdBy: uid, createdAt: FieldValue.serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000) });
const signature = Buffer.concat([Buffer.from("\x89PNG\r\n\x1a\n"), crypto.randomBytes(700)]).toString("base64");
let signatureHandledByCore = false;
if (process.env.SMOKE_SIGNATURE_MODE === "core") {
  const { submitSolicitudSignature } = await import("../../functions/lib/modules/signatureLinks/callables.js");
  const signatureResult = await submitSolicitudSignature.run({ data: { token, signerName: "Receptor Smoke", signerRole: "Autorizado", acceptedNoClaimPolicy: true, signatureDataUrl: `data:image/png;base64,${signature}` } });
  assert.equal(signatureResult?.ok, true, "La firma publica debe confirmar exito.");
  console.log("SMOKE_STAGE=signature_core_passed");
  signatureHandledByCore = true;
}
if (!signatureHandledByCore) {
const functionsHost = process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5001";
const response = await fetch(`http://${functionsHost}/${projectId}/us-central1/submitSolicitudSignature`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ data: { token, signerName: "Receptor Smoke", signerRole: "Autorizado", acceptedNoClaimPolicy: true, signatureDataUrl: `data:image/png;base64,${signature}` } }),
});
const payload = await response.json();
assert.equal(response.status, 200, `La firma pública falló: ${JSON.stringify(payload)}`);
assert.equal(payload?.data?.ok, true, "La firma pública debe confirmar éxito.");

}
console.log("SMOKE_STAGE=signature_submitted");
const [signatureUpload, constancia, signedRequest, finalOperation] = await Promise.all([
  activeUpload("FIRMA_AUTORIZADA_CLIENTE"), activeUpload("CONSTANCIA_RECEPCION_SATISFACCION"),
  db.doc(`signatureRequests/${token}`).get(), db.doc(`materialityOperations/${solicitudId}`).get(),
]);
assert.ok(signatureUpload, "La firma pública debe guardarse como evidencia canónica.");
assert.ok(constancia, "La firma debe generar constancia automáticamente.");
assert.equal(signedRequest.data()?.status, "SIGNED", "El enlace debe quedar consumido.");
assert.equal(finalOperation.data()?.solicitudId, solicitudId, "La constancia debe seguir en el mismo expediente Materialidad.");

console.log(JSON.stringify({
  result: "PASS", solicitudId, quoteUploadId: quote.id, facturamaInvoiceId: invoice.docs[0].id,
  signatureUploadId: signatureUpload.id, constanciaUploadId: constancia.id,
  materialityOperationId: solicitudId, facturamaStatus: invoice.docs[0].data().status,
}, null, 2));
