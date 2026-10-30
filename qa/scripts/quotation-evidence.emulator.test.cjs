const assert = require("node:assert/strict");
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "") ||
    !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_STORAGE_EMULATOR_HOST || "") ||
    !/^demo-/.test(process.env.GCLOUD_PROJECT || "")) throw Error("ISOLATED_FIRESTORE_AND_STORAGE_EMULATORS_REQUIRED");

const admin = require("firebase-admin");
const { createHash } = require("node:crypto");
if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT, storageBucket: `${process.env.GCLOUD_PROJECT}.appspot.com` });
const db = admin.firestore();
const { verifyQuotationEvidence } = require("../../functions/lib/modules/agentOperations/quotationEvidence.js");

(async () => {
  const input = { rootId: "root-1", solicitudId: "sol-1", jobId: "job-1", uploadId: "upload-1", iqFolio: "IQ-1", ocUploadId: "OC-1" };
  const path = "roots/root-1/solicitudes/sol-1/docs/COTIZACION/upload-1.pdf";
  const ocPath = "roots/root-1/solicitudes/sol-1/docs/ORDEN_COMPRA/OC-1.xlsx";
  const pdf = Buffer.from("%PDF-1.4\nfixture\n");
  const sha256 = createHash("sha256").update(pdf).digest("hex");
  await db.doc("solicitudes/sol-1").set({ rootId: input.rootId, iqFolio: input.iqFolio, ocFiscalMetadataUploadId: input.ocUploadId, status: "PROCESANDO" });
  await db.doc("uploads/OC-1").set({ rootId: input.rootId, solicitudId: input.solicitudId, documentType: "ORDEN_COMPRA", status: "READY", active: true, storagePath: ocPath });
  await admin.storage().bucket().file(ocPath).save(Buffer.from("OC fixture"));
  await db.doc("uploads/upload-1").set({ rootId: input.rootId, solicitudId: input.solicitudId, quotationJobId: input.jobId, documentType: "COTIZACION", status: "READY", active: true, storagePath: path, sha256 });
  await assert.rejects(verifyQuotationEvidence(input), /COTIZACION_SIN_ARCHIVO_STORAGE/);
  await admin.storage().bucket().file(path).save(pdf, { contentType: "application/pdf", metadata: { metadata: { sha256 } } });
  assert.equal((await verifyQuotationEvidence(input)).uploadId, input.uploadId);
  await db.doc("uploads/upload-1").update({ sha256: "0".repeat(64) });
  await assert.rejects(verifyQuotationEvidence(input), /COTIZACION_HASH_NO_COINCIDE/);
  await db.doc("uploads/upload-1").update({ sha256 });
  await admin.storage().bucket().file(ocPath).delete();
  await assert.rejects(verifyQuotationEvidence(input), /OC_SIN_ARCHIVO_STORAGE/);
  await admin.storage().bucket().file(ocPath).save(Buffer.from("OC fixture"));
  await assert.rejects(verifyQuotationEvidence({ ...input, iqFolio: "IQ-OLD" }), /COTIZACION_NO_LIGADA_O_NO_ACTIVA/);
  await db.doc("uploads/upload-1").update({ active: false });
  await assert.rejects(verifyQuotationEvidence(input), /COTIZACION_NO_LIGADA_O_NO_ACTIVA/);
  await db.doc("uploads/upload-1").update({ active: true });
  await db.doc("solicitudes/sol-1").update({ status: "CANCELADA" });
  await assert.rejects(verifyQuotationEvidence(input), /COTIZACION_NO_LIGADA_O_NO_ACTIVA/);
  console.log("PASS quotation Firestore/Storage linkage, missing object, stale IQ, inactive upload, terminal solicitud");
})().catch(error => { console.error(error); process.exitCode = 1; });
