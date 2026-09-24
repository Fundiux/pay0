const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const admin = require("../../functions/node_modules/firebase-admin");

if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "")) throw new Error("Firestore emulator requerido");
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_STORAGE_EMULATOR_HOST || "")) throw new Error("Storage emulator requerido");
if (!admin.apps.length) admin.initializeApp({ projectId: "demo-pay0", storageBucket: "demo-pay0.appspot.com" });

const db = admin.firestore();
const clients = require("../../functions/lib/modules/clients/callables.js");
const csf = require("../../functions/lib/modules/clients/csfCallables.js");
const entityDocuments = require("../../functions/lib/modules/entityDocuments/service.js");
const rootId = "root-csf-create";
const pdf = Buffer.from("%PDF-1.4\nCSF REGRESSION FIXTURE\n%%EOF");
const sha256 = createHash("sha256").update(pdf).digest("hex");
let testEnv;
let storageRef;
let uploadBytes;

const auth = uid => ({ uid, token: {} });
const parsed = suffix => ({
  rfc: `ABC010101${suffix}`.slice(0, 13),
  razonSocial: `CLIENTE CSF ${suffix}`,
  regimenFiscal: "601",
  codigoPostal: "64000",
  rawTextSample: "fixture post-parser",
});

async function rejectsCode(operation, code) {
  await assert.rejects(operation, error => {
    assert.equal(error.code, code);
    return true;
  });
}

async function seedUser(uid, role, modules) {
  await db.doc(`users/${uid}`).set({ uid, role, rootId, active: true, adminId: role === "operador" ? "admin-csf" : uid, ...(modules ? { modules } : {}) });
}

async function save(uid, name, rfc, csfIntakeId = null) {
  return clients.saveClientCallable.run({
    auth: auth(uid),
    data: { editingId: null, effectiveRootId: rootId, adminId: uid, uid, managedByUserId: uid, name, rfc, email: "", whatsapp: "", csfIntakeId },
  });
}

async function runAuthorized(role, index) {
  const uid = `${role}-csf`;
  await seedUser(uid, role, role === "superadmin" ? undefined : {
    clientes: { view: true, create: true, edit: false, costs: true },
  });

  const manual = await save(uid, `CLIENTE MANUAL ${role}`, `MAN01010${index}AA`);
  assert.equal(manual.created, true);

  const intakeId = `intake-${role}`;
  const extracted = parsed(String(index));
  await db.doc(`clientCsfIntakes/${intakeId}`).set({ rootId, createdBy: uid, sha256, parsed: extracted, status: "PARSED" });
  const created = await save(uid, extracted.razonSocial, extracted.rfc, intakeId);
  assert.equal(created.created, true);

  const clientSnap = await db.doc(`clients/${created.id}`).get();
  assert.equal(clientSnap.data().rootId, rootId);
  assert.equal(clientSnap.data().createdBy, uid);
  assert.equal(clientSnap.data().fiscalProfile.csfIntakeId, intakeId);

  const initialized = await entityDocuments.initEntityDocumentUploadCore({
    auth: auth(uid),
    data: {
      entityType: "CLIENTE", entityId: created.id, documentType: "CONSTANCIA_SITUACION_FISCAL",
      legalPersonType: "PERSONA_MORAL", fiscalAdminType: "SOLO_OPERATIVO", originalName: `${role}.pdf`,
      fileSize: pdf.length, contentType: "application/pdf", sha256, periodYear: 2026, periodMonth: 9,
    },
  });
  if (role !== "superadmin") {
    await rejectsCode(entityDocuments.initEntityDocumentUploadCore({
      auth: auth(uid),
      data: {
        entityType: "CLIENTE", entityId: created.id, documentType: "OTRO",
        legalPersonType: "PERSONA_MORAL", fiscalAdminType: "SOLO_OPERATIVO", originalName: `${role}-other.pdf`,
        fileSize: pdf.length, contentType: "application/pdf", sha256,
      },
    }), "permission-denied");
  }
  const clientStorage = testEnv.authenticatedContext(uid).storage("gs://demo-pay0.appspot.com");
  await uploadBytes(storageRef(clientStorage, initialized.storagePath), new Uint8Array(pdf), {
    contentType: "application/pdf",
    customMetadata: {
      sha256,
      entityDocumentId: initialized.entityDocumentId,
      documentid: initialized.documentId,
      entityType: "CLIENTE",
      entityId: created.id,
      documentType: "CONSTANCIA_SITUACION_FISCAL",
    },
  });
  const finalizedDocument = await entityDocuments.finalizeEntityDocumentUploadCore({
    auth: auth(uid),
    data: { entityDocumentId: initialized.entityDocumentId, storagePath: initialized.storagePath },
  });
  assert.equal(finalizedDocument.ok, true);

  const finalizedCsf = await csf.finalizeClientCsfIntakeCallable.run({
    auth: auth(uid),
    data: { intakeId, clientId: created.id, entityDocumentId: initialized.entityDocumentId },
  });
  assert.equal(finalizedCsf.ok, true);
  assert.equal((await db.doc(`clientCsfIntakes/${intakeId}`).get()).data().status, "FINALIZED");

  if (role !== "superadmin") {
    await rejectsCode(entityDocuments.listEntityDocumentsCore({
      auth: auth(uid),
      data: { entityType: "CLIENTE", entityId: created.id },
    }), "permission-denied");
    await rejectsCode(entityDocuments.initEntityDocumentUploadCore({
      auth: auth(uid),
      data: {
        entityType: "CLIENTE", entityId: created.id, documentType: "CONSTANCIA_SITUACION_FISCAL",
        legalPersonType: "PERSONA_MORAL", fiscalAdminType: "SOLO_OPERATIVO", originalName: `${role}-replacement.pdf`,
        fileSize: pdf.length, contentType: "application/pdf", sha256, periodYear: 2026, periodMonth: 9,
      },
    }), "permission-denied");
  }
  return { role, manualClientId: manual.id, csfClientId: created.id };
}

(async () => {
  const rulesTesting = await import("@firebase/rules-unit-testing");
  const storage = await import("firebase/storage");
  storageRef = storage.ref;
  uploadBytes = storage.uploadBytes;
  testEnv = await rulesTesting.initializeTestEnvironment({
    projectId: "demo-pay0",
    firestore: { rules: fs.readFileSync("firestore.rules", "utf8") },
    storage: { rules: fs.readFileSync("storage.rules", "utf8") },
  });

  const results = [];
  results.push(await runAuthorized("superadmin", 1));
  results.push(await runAuthorized("admin", 2));
  results.push(await runAuthorized("operador", 3));

  const deniedUid = "admin-csf-denied";
  await seedUser(deniedUid, "admin", { clientes: { view: true, create: false, edit: true, costs: true } });
  await rejectsCode(save(deniedUid, "MANUAL DENEGADO", "DEN010101AA1"), "permission-denied");
  const deniedIntake = "intake-denied";
  await db.doc(`clientCsfIntakes/${deniedIntake}`).set({ rootId, createdBy: deniedUid, sha256, parsed: parsed("4"), status: "PARSED" });
  await rejectsCode(save(deniedUid, parsed("4").razonSocial, parsed("4").rfc, deniedIntake), "permission-denied");

  const otherRootUid = "admin-csf-other-root";
  await db.doc(`users/${otherRootUid}`).set({ uid: otherRootUid, role: "admin", rootId: "root-other", active: true });
  const foreignIntake = "intake-foreign";
  await db.doc(`clientCsfIntakes/${foreignIntake}`).set({ rootId, createdBy: otherRootUid, sha256, parsed: parsed("5"), status: "PARSED" });
  await rejectsCode(save(otherRootUid, parsed("5").razonSocial, parsed("5").rfc, foreignIntake), "permission-denied");

  const page = require("node:fs").readFileSync("src/app/clientes/page.tsx", "utf8");
  assert.match(page, /setEditing\(null\);[\s\S]*setCsfIntake\(result\)/);
  assert.match(page, /editingId: editing\?\.id \|\| null/);
  assert.match(page, /await saveClient\([\s\S]*csfIntakeId: csfIntake\?\.intakeId \|\| null/);

  console.log(JSON.stringify({
    ok: true,
    equivalentCreatePaths: results,
    createOnlyRoles: ["admin", "operador"],
    unauthorized403: true,
    crossRoot403: true,
    entityDocumentManagerStillDenied: true,
    finalizedReplacementRequiresEdit: true,
    uiRemainsCreateMode: true,
    externalActions: 0,
  }));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (testEnv) await testEnv.cleanup();
});
