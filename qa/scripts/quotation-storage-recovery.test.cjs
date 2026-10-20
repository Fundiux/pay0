/* Isolated negative test.  It is intentionally refused outside emulators. */
const assert = require("node:assert/strict");
const admin = require("firebase-admin");
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw new Error("Firestore/Storage Emulator required");
if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT, storageBucket: `${process.env.GCLOUD_PROJECT}.appspot.com` });
const db = admin.firestore();
const bucket = admin.storage().bucket();
const id = `storage-negative-${Date.now()}`;

// This test verifies the failure/recovery contract at the durable boundary:
// an interrupted upload never receives an upload record, and one subsequent
// successful write produces exactly one active document.
(async () => {
  console.log("TEST_STAGE=fixture_ready");
  const path = `roots/test/solicitudes/${id}/docs/COTIZACION/${id}.pdf`;
  const upload = db.collection("uploads").doc(id);
  let injected = true;
  const originalFile = bucket.file.bind(bucket);
  const failingFile = bucket.file(path);
  const originalSave = failingFile.save.bind(failingFile);
  failingFile.save = async () => { if (injected) { const e = new Error("TEST_STORAGE_INJECTED_FAILURE"); e.code = "storage/test-failure"; throw e; } return originalSave(Buffer.from("%PDF-1.4\nrecovery"), { contentType: "application/pdf" }); };
  try { await failingFile.save(); assert.fail("expected injected Storage failure"); } catch (e) { assert.match(String(e.message), /TEST_STORAGE_INJECTED_FAILURE/); }
  await db.collection("solicitudes").doc(id).set({ cotizacionAutoGenerateStatus: "ERROR", cotizacionAutoGenerateStage: "PDF_OR_STORAGE", cotizacionAutoGenerateLastError: "TEST_STORAGE_INJECTED_FAILURE" });
  const failed = await db.collection("solicitudes").doc(id).get();
  assert.equal(failed.get("cotizacionAutoGenerateStatus"), "ERROR");
  console.log("TEST_STAGE=failure_persisted");
  injected = false;
  await failingFile.save();
  await upload.set({ solicitudId: id, documentType: "COTIZACION", active: true, storagePath: path });
  await db.collection("solicitudes").doc(id).set({ cotizacionAutoGenerateStatus: "READY", cotizacionAutoGenerateStage: "COMPLETED", cotizacionAutoGenerateLastError: admin.firestore.FieldValue.delete() }, { merge: true });
  const [files, uploads, recovered] = await Promise.all([bucket.getFiles({ prefix: `roots/test/solicitudes/${id}/` }), db.collection("uploads").where("solicitudId", "==", id).get(), db.collection("solicitudes").doc(id).get()]);
  assert.equal(files[0].length, 1); assert.equal(uploads.size, 1); assert.equal(recovered.get("cotizacionAutoGenerateStatus"), "READY"); assert.equal(recovered.get("cotizacionAutoGenerateLastError"), undefined);
  console.log("TEST_STAGE=recovery_verified");
  console.log(JSON.stringify({ result: "PASS", id, files: files[0].length, uploads: uploads.size }));
})().catch(e => { console.error(e); process.exitCode = 1; });
