const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const projectId = process.env.GCLOUD_PROJECT || "";
for (const key of ["FIRESTORE_EMULATOR_HOST", "FIREBASE_STORAGE_EMULATOR_HOST"]) {
  if (!/^127\.0\.0\.1:\d+$/.test(process.env[key] || "")) throw Error(`Local ${key} required`);
}
if (!projectId.startsWith("demo-")) throw Error("A demo project is mandatory");
// Backend handlers run directly against local emulators. Never invoke IQ or messaging.
for (const protocol of ["http", "https"]) {
  const api = require(`node:${protocol}`), original = api.request;
  api.request = function (url, ...args) {
    const host = typeof url === "string" || url instanceof URL ? new URL(url).hostname : String(url.hostname || url.host || "").split(":")[0];
    assert.ok(["127.0.0.1", "localhost"].includes(host), `External ${protocol} transport is forbidden`);
    return original.call(this, url, ...args);
  };
}
const admin = require("../../functions/node_modules/firebase-admin");
admin.initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` });
const db = admin.firestore(), bucket = admin.storage().bucket();
const api = require("../../functions/lib/modules/canonicalCenter/service.js");
const signatures = require("../../functions/lib/modules/signatureLinks/callables.js");
const { generateConstanciaRecepcionForSolicitudCore } = require("../../functions/lib/modules/constancias/service.js");
const { signaturePng, acceptance } = require("./canonical-document-fixtures.cjs");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
const { ref, uploadBytes, getBytes, deleteObject } = require("firebase/storage");
const { doc, getDoc, setDoc } = require("firebase/firestore");
const prefix = `corporate-${Date.now()}`, root = `${prefix}-root`, otherRoot = `${prefix}-other`;
const uid = `${prefix}-super`, adminUid = `${prefix}-admin`, inactive = `${prefix}-inactive`, blocked = `${prefix}-blocked`, foreign = `${prefix}-foreign`;
const companyId = `${prefix}-company`, companyB = `${prefix}-company-b`, clientId = `${prefix}-client`, solicitudId = `${prefix}-solicitud`;
let checks = 0, env;
function check(condition, label) { assert.ok(condition, label); checks++; }
const call = (name, data = {}, actor = uid) => api[name].run({ auth: actor ? { uid: actor } : undefined, data });
async function denied(operation, label) { await assert.rejects(operation, undefined, label); checks++; }
async function rulesDenied(operation) { await assertFails(operation); checks++; }
async function rulesAllowed(operation) { await assertSucceeds(operation); checks++; }
async function verifyDeletedCorporateUser(session, png) {
  await db.doc(`users/${uid}`).update({ isDeleted: true });
  try {
    await rulesDenied(uploadBytes(ref(env.authenticatedContext(uid).storage(`gs://${projectId}.appspot.com`), session.storagePath), png, { contentType: "image/png" }));
    await denied(call("finalizeCorporateResourceUpload", { sessionId: session.sessionId }), "Deleted user cannot finalize a prepared session");
    await denied(call("initCorporateResourceUpload", { companyId, kind: "BRAND_STATIONERY", key: "DELETED", title: "Synthetic", contentType: "image/png", sizeBytes: png.length }), "Deleted user cannot prepare a new upload");
  } finally { await db.doc(`users/${uid}`).update({ isDeleted: admin.firestore.FieldValue.delete() }); }
}
async function main() {
  const [fh, fp] = process.env.FIRESTORE_EMULATOR_HOST.split(":"), [sh, sp] = process.env.FIREBASE_STORAGE_EMULATOR_HOST.split(":");
  env = await initializeTestEnvironment({ projectId, firestore: { host: fh, port: Number(fp), rules: fs.readFileSync("firestore.rules", "utf8") },
    storage: { host: sh, port: Number(sp), rules: fs.readFileSync("storage.rules", "utf8") } });
  console.log("CORPORATE_STAGE=actual_rules_loaded");
  for (const [id, profile] of [[uid, { role: "superadmin" }], [adminUid, { role: "admin" }], [inactive, { role: "superadmin", active: false }],
    [blocked, { role: "superadmin", modules: { corporateResources: { view: false, manage: false } } }], [foreign, { role: "superadmin", rootId: otherRoot }]])
    await db.doc(`users/${id}`).set({ rootId: root, active: true, ...profile });
  await db.doc(`companies/${companyId}`).set({ rootId: root, active: true, isOwnCompany: true, nombre: "TROSTRE", rfc: "TRO230717L64" });
  await db.doc(`companies/${companyB}`).set({ rootId: root, active: true, isOwnCompany: true, nombre: "ECOLIMPIO", rfc: "ECO1907171N7" });
  await db.doc(`companies/${prefix}-outside`).set({ rootId: otherRoot, active: true, isOwnCompany: true, rfc: "TRO230717L64" });
  await db.doc(`companies/${prefix}-rootless`).set({ active: true, isOwnCompany: true, rfc: "TRO230717L64" });
  await db.doc(`companies/${prefix}-thirdparty`).set({ rootId: root, active: true, rfc: "XAXX010101000" });
  if (process.argv.includes("--revoked-user-only")) {
    const png = signaturePng();
    const session = await call("initCorporateResourceUpload", { companyId, kind: "BRAND_STATIONERY", key: "REVOCATION", title: "Synthetic", contentType: "image/png", sizeBytes: png.length });
    check(!!session.sessionId && !!session.storagePath, "Active user may prepare a session");
    await verifyDeletedCorporateUser(session, png);
    await rulesAllowed(uploadBytes(ref(env.authenticatedContext(uid).storage(`gs://${projectId}.appspot.com`), session.storagePath), png, { contentType: "image/png" }));
    console.log(JSON.stringify({ result: "PASS", checks, scope: "corporate isDeleted revocation", externalCalls: 0 }));
    return;
  }
  for (const actor of [null, adminUid, inactive, blocked]) await denied(call("listCorporateResources", {}, actor), "Server role/active/module gate");
  for (const id of [`${prefix}-outside`, `${prefix}-rootless`, `${prefix}-thirdparty`])
    await denied(call("prepareCorporateResourceMigration", { companyId: id }), "Only scoped own company");
  const plan = await call("prepareCorporateResourceMigration", { companyId });
  check(plan.readOnly && plan.candidates.length === 3, "Readonly migration includes three document families");
  check((await db.collection("pay0CanonicalResources").where("rootId", "==", root).get()).empty, "Prepare writes no resource");
  const imported = await call("importCorporateResource", { companyId, use: "CONSTANCIA_SERVICIO" });
  const id = imported.resourceId, versionPath = version => `pay0CanonicalResourceVersions/${id}:${version}`;
  check((await db.doc(versionPath(1)).get()).data().status === "REVIEW", "Import is not automatically active");
  await denied(call("activateCorporateResourceVersion", { resourceId: id, version: 1 }), "Unreviewed activation denied");
  await denied(call("getCorporateResource", { resourceId: id }, foreign), "Cross-root read denied");
  await call("reviewCorporateResourceVersion", { resourceId: id, version: 1, approve: true });
  await call("activateCorporateResourceVersion", { resourceId: id, version: 1 });
  const active = await api.resolveCorporateDocumentBundle(root, companyId, "TRO230717L64", "CONSTANCIA_SERVICIO");
  check(active.snapshot.corporateResourceVersion === 1 && active.snapshot.companyRfc === "TRO230717L64", "Generator consumes activated version");
  const next = await call("restoreCorporateResourceVersion", { resourceId: id, version: 1 });
  check(next.version === 2 && (await db.doc(versionPath(1)).get()).data().status === "ACTIVE", "Restore is forward and leaves active immutable");
  await call("reviewCorporateResourceVersion", { resourceId: id, version: 2, approve: true });
  await Promise.all([call("activateCorporateResourceVersion", { resourceId: id, version: 2 }), call("activateCorporateResourceVersion", { resourceId: id, version: 2 })]);
  check((await db.doc(versionPath(1)).get()).data().status === "RETIRED" && (await db.doc(versionPath(2)).get()).data().status === "ACTIVE", "Concurrent activation leaves one active version");
  await call("retireCorporateResourceVersion", { resourceId: id, version: 2 });
  await denied(api.resolveCorporateDocumentBundle(root, companyId, "TRO230717L64", "CONSTANCIA_SERVICIO"), "Retired active template never silently falls back");
  const restore = await call("restoreCorporateResourceVersion", { resourceId: id, version: 2 });
  await call("reviewCorporateResourceVersion", { resourceId: id, version: restore.version, approve: true });
  await call("activateCorporateResourceVersion", { resourceId: id, version: restore.version });
  console.log("CORPORATE_STAGE=version_lifecycle_passed");

  const migrationCompany = `${prefix}-migration`;
  await db.doc(`companies/${migrationCompany}`).set({ rootId: root, active: true, isOwnCompany: true, nombre: "DCP SINTÉTICO", rfc: "DCP191121H35" });
  const migrationPlan = await api.inspectBundledCorporateMigration(root, migrationCompany);
  check(migrationPlan.length === 3 && migrationPlan.every(row => !row.managed) &&
    (await db.collection("pay0CanonicalResources").where("ownCompanyId", "==", migrationCompany).get()).empty, "Migration inspector is readonly");
  const candidate = migrationPlan[0], migrationInput = { rootId: root, companyId: migrationCompany, use: candidate.use, expectedDigest: candidate.contentDigest };
  await denied(api.migrateBundledCorporateResource({ ...migrationInput, expectedDigest: "0".repeat(64) }), "Changed plan digest rejected");
  const migrated = await api.migrateBundledCorporateResource(migrationInput);
  const migratedBundle = await api.resolveCorporateDocumentBundle(root, migrationCompany, "DCP191121H35", candidate.use);
  check(!migrated.skipped && migratedBundle.snapshot.corporateResourceVersion === 1 && migratedBundle.snapshot.companyRfc === "DCP191121H35", "Verified bundled migration becomes actual active consumer");
  const managedRef = db.doc(`pay0CanonicalResources/${candidate.resourceId}`), beforeMigrationRetry = await managedRef.get();
  check((await api.migrateBundledCorporateResource(migrationInput)).skipped &&
    (await managedRef.get()).updateTime.isEqual(beforeMigrationRetry.updateTime), "Repeated migration is a no-op");
  await call("retireCorporateResourceVersion", { resourceId: candidate.resourceId, version: 1 });
  const retiredManaged = await managedRef.get();
  check((await api.migrateBundledCorporateResource(migrationInput)).skipped &&
    (await managedRef.get()).updateTime.isEqual(retiredManaged.updateTime) && !(await managedRef.get()).get("activeVersion"), "Migration preserves managed retired decisions");
  const storageFile = require("../../functions/node_modules/@google-cloud/storage").File;
  const originalSave = storageFile.prototype.save, draftCandidate = migrationPlan[1];
  storageFile.prototype.save = function (...args) {
    if (this.name.includes(draftCandidate.resourceId)) return Promise.reject(new Error("Synthetic Storage failure"));
    return originalSave.apply(this, args);
  };
  const draftInput = { ...migrationInput, use: draftCandidate.use, expectedDigest: draftCandidate.contentDigest };
  try { await denied(api.migrateBundledCorporateResource(draftInput), "Interrupted migration retains draft"); }
  finally { storageFile.prototype.save = originalSave; }
  const draftVersion = await db.doc(`pay0CanonicalResourceVersions/${draftCandidate.resourceId}:1`).get();
  check(draftVersion.get("status") === "DRAFT" && draftVersion.get("createdBy") === "SYSTEM", "Recoverable draft is explicitly owned by System");
  const resumedDraft = await api.migrateBundledCorporateResource(draftInput);
  check(resumedDraft.version === 1 && (await db.doc(`pay0CanonicalResourceVersions/${draftCandidate.resourceId}:1`).get()).get("status") === "ACTIVE", "Migration resumes same draft without another version");
  const reviewCandidate = migrationPlan[2], reviewInput = { ...migrationInput, use: reviewCandidate.use, expectedDigest: reviewCandidate.contentDigest };
  const originalTransaction = db.runTransaction; let transactionCount = 0;
  db.runTransaction = function (...args) {
    if (++transactionCount === 3) return Promise.reject(new Error("Synthetic activation interruption"));
    return originalTransaction.apply(this, args);
  };
  try { await denied(api.migrateBundledCorporateResource(reviewInput), "Interrupted activation retains review version"); }
  finally { db.runTransaction = originalTransaction; }
  check((await db.doc(`pay0CanonicalResourceVersions/${reviewCandidate.resourceId}:1`).get()).get("status") === "REVIEW", "Review phase persists before activation");
  const resumedReview = await api.migrateBundledCorporateResource(reviewInput);
  const reviewBundle = await api.resolveCorporateDocumentBundle(root, migrationCompany, "DCP191121H35", reviewCandidate.use);
  check(resumedReview.version === 1 && reviewBundle.snapshot.corporateResourceVersion === 1, "Migration resumes reviewed version with actual readable artifacts");

  const png = signaturePng();
  async function init(overrides = {}) { return call("initCorporateResourceUpload", { companyId, kind: "BRAND_STATIONERY", key: "LOGO", title: "Logo sintético", contentType: "image/png", sizeBytes: png.length, ...overrides }); }
  const session = await init();
  await verifyDeletedCorporateUser(session, png);
  const object = ref(env.authenticatedContext(uid).storage(`gs://${projectId}.appspot.com`), session.storagePath);
  for (const actor of [adminUid, inactive, foreign]) await rulesDenied(uploadBytes(ref(env.authenticatedContext(actor).storage(`gs://${projectId}.appspot.com`), session.storagePath), png, { contentType: "image/png" }));
  await rulesDenied(uploadBytes(ref(env.unauthenticatedContext().storage(`gs://${projectId}.appspot.com`), session.storagePath), png, { contentType: "image/png" }));
  await rulesDenied(uploadBytes(object, png.subarray(0, png.length - 1), { contentType: "image/png" }));
  await rulesDenied(uploadBytes(object, png, { contentType: "image/jpeg" }));
  await rulesDenied(uploadBytes(ref(env.authenticatedContext(uid).storage(`gs://${projectId}.appspot.com`), session.storagePath.replace(root, otherRoot)), png, { contentType: "image/png" }));
  await rulesAllowed(uploadBytes(object, png, { contentType: "image/png" }));
  await rulesDenied(uploadBytes(object, png, { contentType: "image/png" }));
  await rulesDenied(getBytes(object));
  await rulesDenied(deleteObject(object));
  const expired = await init({ key: "EXPIRED" });
  await db.doc(`pay0CanonicalUploadSessions/${expired.sessionId}`).update({ expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() - 1000) });
  await rulesDenied(uploadBytes(ref(env.authenticatedContext(uid).storage(`gs://${projectId}.appspot.com`), expired.storagePath), png, { contentType: "image/png" }));
  const revoked = await init({ key: "REVOKED" });
  await db.doc(`users/${uid}`).update({ modules: { corporateResources: { view: true, manage: false } } });
  await rulesDenied(uploadBytes(ref(env.authenticatedContext(uid).storage(`gs://${projectId}.appspot.com`), revoked.storagePath), png, { contentType: "image/png" }));
  await denied(call("finalizeCorporateResourceUpload", { sessionId: revoked.sessionId }), "Revoked management permission checked at finalize");
  await db.doc(`users/${uid}`).update({ modules: admin.firestore.FieldValue.delete() });
  const retired = await init({ key: "RETIRED" });
  await rulesAllowed(uploadBytes(ref(env.authenticatedContext(uid).storage(`gs://${projectId}.appspot.com`), retired.storagePath), png, { contentType: "image/png" }));
  await call("retireCorporateResourceVersion", { resourceId: retired.resourceId, version: retired.version });
  await denied(call("finalizeCorporateResourceUpload", { sessionId: retired.sessionId }), "Retired draft cannot resurrect during finalize");
  check((await db.doc(`pay0CanonicalResourceVersions/${retired.resourceId}:${retired.version}`).get()).data().status === "RETIRED", "Retired status preserved");
  await Promise.all([call("finalizeCorporateResourceUpload", { sessionId: session.sessionId }), call("finalizeCorporateResourceUpload", { sessionId: session.sessionId })]);
  check((await call("finalizeCorporateResourceUpload", { sessionId: session.sessionId })).alreadyFinalized, "Finalize replay is idempotent");
  const logoVersion = (await db.doc(`pay0CanonicalResourceVersions/${session.resourceId}:${session.version}`).get()).data();
  await rulesDenied(getBytes(ref(env.authenticatedContext(uid).storage(`gs://${projectId}.appspot.com`), logoVersion.artifacts[0].storagePath)));
  await call("reviewCorporateResourceVersion", { resourceId: session.resourceId, version: session.version, approve: true });
  await call("activateCorporateResourceVersion", { resourceId: session.resourceId, version: session.version });
  check((await api.resolveCorporateDocumentBundle(root, companyId, "TRO230717L64", "COTIZACION")).logo.equals(png), "Active LOGO used by document renderer");
  for (const collection of ["pay0CanonicalResources", "pay0CanonicalResourceVersions", "pay0CanonicalAuditLog", "pay0CanonicalUploadSessions"]) {
    const clientDb = env.authenticatedContext(uid).firestore();
    await rulesDenied(getDoc(doc(clientDb, collection, id)));
    await rulesDenied(setDoc(doc(clientDb, collection, "forged"), { rootId: root }));
  }
  console.log("CORPORATE_STAGE=storage_rules_and_uploads_passed");

  await db.doc(`clients/${clientId}`).set({ rootId: root, active: true, razonSocial: "CLIENTE SINTÉTICO", rfc: "XAXX010101000" });
  await db.doc(`solicitudes/${solicitudId}`).set({ rootId: root, adminId: adminUid, createdBy: uid, companyId: companyB, clienteId: clientId,
    folio: "SOL-SINTETICA", status: "PROCESANDO", concepto: "Servicios sintéticos", monto: 100, moneda: "MXN" });
  const request = await signatures.createSolicitudSignatureLink.run({ auth: { uid: adminUid }, data: { solicitudId } });
  const submission = { token: request.token, ...acceptance, signatureDataUrl: `data:image/png;base64,${png.toString("base64")}` };
  for (const patch of [{ acceptedNoClaimPolicy: false }, { receiptLocation: "" }, { receiptAddress: "" }, { signerRole: "" }])
    await denied(signatures.submitSolicitudSignature.run({ data: { ...submission, ...patch } }), "Incomplete acceptance denied server-side");
  const invalidPng = Buffer.alloc(600); png.copy(invalidPng, 0, 0, 24);
  await denied(signatures.submitSolicitudSignature.run({ data: { ...submission, signatureDataUrl: `data:image/png;base64,${invalidPng.toString("base64")}` } }), "PNG header alone cannot seal invalid evidence");
  check((await db.doc(`signatureRequests/${request.token}`).get()).data().status === "PENDING", "Validation does not consume token");
  const abandoned = await signatures.createSolicitudSignatureLink.run({ auth: { uid }, data: { solicitudId } });
  await db.doc(`signatureRequests/${abandoned.token}`).update({ status: "PROCESSING", processingAt: admin.firestore.Timestamp.fromMillis(Date.now() - 180_000), uploadId: `${prefix}-abandoned` });
  await signatures.getSolicitudSignatureRequest.run({ data: { token: abandoned.token } });
  check((await db.doc(`signatureRequests/${abandoned.token}`).get()).data().status === "PENDING", "Crashed unpublished reservation recovers after lease");
  await db.doc(`signatureRequests/${abandoned.token}`).update({ status: "PROCESSING", processingAt: admin.firestore.Timestamp.now(), uploadId: `${prefix}-inflight` });
  await denied(signatures.getSolicitudSignatureRequest.run({ data: { token: abandoned.token } }), "Live reservation is not stolen");
  const concurrent = await Promise.allSettled([signatures.submitSolicitudSignature.run({ data: submission }), signatures.submitSolicitudSignature.run({ data: submission })]);
  check(concurrent.filter(row => row.status === "fulfilled").length === 1, "One concurrent receipt is accepted");
  const success = concurrent.find(row => row.status === "fulfilled").value;
  check(!success.constanciaPending, "Canonical constancia generated after receipt");
  const signed = (await db.doc(`uploads/${success.uploadId}`).get()).data();
  check(signed.signatureCapture.receiptAddress === acceptance.receiptAddress && signed.signatureCapture.acceptanceVersion && signed.integritySealStatus === "SEALED", "Declared location and acceptance sealed");
  await denied(signatures.submitSolicitudSignature.run({ data: submission }), "Signed token replay denied");
  const certificate = await generateConstanciaRecepcionForSolicitudCore({ auth: { uid: adminUid }, data: { solicitudId, signatureUploadId: success.uploadId } });
  check(certificate.alreadyExists === true, "Admin recovery reuses existing sealed certificate without corporate management rights");
  const certificateRow = (await db.doc(`uploads/${certificate.uploadId}`).get()).data();
  check(certificateRow.clienteNombre === "CLIENTE SINTÉTICO", "Client legal name retained when solicitud has no name snapshot");
  check(certificateRow.constanciaSnapshot.receiptLocation === acceptance.receiptLocation && certificateRow.constanciaTemplate.companyRfc === "ECO1907171N7", "Correct company and receipt snapshot");
  await denied(generateConstanciaRecepcionForSolicitudCore({ auth: { uid: foreign }, data: { solicitudId, signatureUploadId: success.uploadId } }), "Cross-root certificate denied");
  const changed = await signatures.createSolicitudSignatureLink.run({ auth: { uid }, data: { solicitudId } });
  await db.doc(`solicitudes/${solicitudId}`).update({ companyId });
  await denied(signatures.submitSolicitudSignature.run({ data: { ...submission, token: changed.token } }), "Link scope change denied");
  const artifacts = path.resolve("tmp/pdfs/corporate-resources"); fs.mkdirSync(artifacts, { recursive: true });
  const [pdf] = await bucket.file(certificate.storagePath).download();
  fs.writeFileSync(path.join(artifacts, "emulator-admin-receipt.pdf"), pdf);
  console.log(JSON.stringify({ result: "PASS", checks, projectId, externalCalls: 0, signature: "one concurrent winner", resources: "immutable versions with scoped rules" }));
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; }).finally(async () => {
  if (env) await env.cleanup();
  await Promise.all(admin.apps.map(app => app.delete()));
});
