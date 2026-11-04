const assert = require("node:assert/strict");
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "")) throw new Error("Firestore emulator requerido");
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_STORAGE_EMULATOR_HOST || "")) throw new Error("Storage emulator requerido");
global.fetch = async () => { throw new Error("EXTERNAL_NETWORK_FORBIDDEN"); };
const admin = require("../../functions/node_modules/firebase-admin");
admin.initializeApp({ projectId: "demo-pay0", storageBucket: "demo-pay0.appspot.com" });
const { saveIqCancellationReceipt } = require("../../functions/lib/modules/iq/cancellationReceiptImport.js");

const db = admin.firestore();
const rootId = `acuse-${Date.now()}`;
const solicitudId = `${rootId}-sol`;
const solicitud = { rootId, folio: "S-1", iqFolio: "123", iqInvoiceUuid: "UUID", iqCancellationStatus: "CONFIRMED", clienteId: "client", status: "CANCELADA" };
const bytes = Buffer.from("%PDF-1.7 acuse");
const receipt = { bytes, contentType: "application/pdf", extension: "pdf", sha256: "a".repeat(64) };

(async () => {
  await db.doc(`solicitudes/${solicitudId}`).set(solicitud);
  await saveIqCancellationReceipt(solicitudId, solicitud, "123", receipt);
  await saveIqCancellationReceipt(solicitudId, solicitud, "123", receipt);

  const uploads = await db.collection("uploads").where("solicitudId", "==", solicitudId).get();
  assert.equal(uploads.size, 1, "reintentar no duplica el documento");
  const upload = uploads.docs[0].data();
  assert.equal(upload.documentType, "ACUSE_CANCELACION_CFDI");
  assert.equal(upload.status, "READY");
  assert.equal(upload.active, true);
  assert.equal(upload.version, 1);
  assert.equal(upload.integritySealStatus, "SEALED");
  assert.equal(upload.entityType, "solicitudes");
  assert.ok(upload.storagePath.startsWith(`roots/${rootId}/solicitudes/${solicitudId}/docs/ACUSE_CANCELACION_CFDI/`));
  const [stored] = await admin.storage().bucket().file(upload.storagePath).download();
  assert.deepEqual(stored, bytes);

  const updated = (await db.doc(`solicitudes/${solicitudId}`).get()).data();
  assert.equal(updated.iqCancellationReceiptStatus, "READY");
  assert.equal(updated.iqCancellationReceiptUploadId, uploads.docs[0].id);
  assert.equal(updated.status, "CANCELADA", "el acuse no cambia el estado de la solicitud");

  await db.doc(`uploads/${uploads.docs[0].id}`).update({ status: "REPLACED", active: false });
  await assert.rejects(saveIqCancellationReceipt(solicitudId, solicitud, "123", receipt), /IQ_ACUSE_DOCUMENT_REPLACED/);
  console.log("PASS acuse IQ: guardado sellado en la solicitud, idempotente y sin pisar documentos reemplazados.");
  process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
