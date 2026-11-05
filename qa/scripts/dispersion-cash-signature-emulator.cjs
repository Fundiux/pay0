// Behavioural test for the cash-receipt signature callables against local emulators.
// Runs the compiled handlers directly (functions/lib) with synthetic data only.
//   npm run qa:dispersion-cash-signature
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

for (const key of ["FIRESTORE_EMULATOR_HOST", "FIREBASE_STORAGE_EMULATOR_HOST"]) {
  if (!/^127\.0\.0\.1:\d+$/.test(process.env[key] || "")) throw new Error(`Local ${key} required`);
}
const projectId = process.env.GCLOUD_PROJECT || "demo-pay0";
if (!projectId.startsWith("demo-")) throw new Error("A demo project is mandatory");
// Handlers must never leave the machine: no IQ, no messaging, no production.
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
const { Timestamp } = admin.firestore;
const api = require("../../functions/lib/modules/dispersionCashReceipt/callables.js");
const { signaturePng, blankCanvasPng } = require("./canonical-document-fixtures.cjs");

const prefix = `cash-sig-${Date.now()}`;
const root = `${prefix}-root`, otherRoot = `${prefix}-other-root`;
const superUid = `${prefix}-super`, adminUid = `${prefix}-admin`, foreignUid = `${prefix}-foreign`;
const clientId = `${prefix}-client`;
const AMOUNT = 15000;
const BENEFICIARY = "Leonel Cortez Perez";
const dataUrl = (png) => `data:image/png;base64,${png.toString("base64")}`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const inkDataUrl = dataUrl(signaturePng());

let checks = 0;
function check(condition, label) { assert.ok(condition, label); checks++; }
function same(actual, expected, label) { assert.equal(actual, expected, label); checks++; }
const call = (name, data = {}, actor = superUid) => api[name].run({ auth: actor ? { uid: actor } : undefined, data });
async function rejects(operation, code, label) {
  await assert.rejects(operation, (error) => {
    if (code) assert.equal(error.code, code, `${label}: expected ${code}, got ${error.code} (${error.message})`);
    return true;
  }, label);
  checks++;
}

let seq = 0;
const OMIT = Symbol("omit");
async function seedDispersion(overrides = {}) {
  const id = `${prefix}-disp-${++seq}`;
  const row = {
    rootId: root,
    adminId: adminUid,
    clientId,
    clienteId: clientId,
    clienteNombre: "CLIENTE SINTETICO SA DE CV",
    folio: `D${seq}CASH`,
    status: "REGISTRADA",
    operationTypeKey: "EFECTIVO",
    methodTipo: "EFECTIVO",
    destinationKind: "EFECTIVO",
    amount: AMOUNT,
    currency: "MXN",
    beneficiaryNombre: BENEFICIARY,
    beneficiaryId: `${prefix}-beneficiary`,
    cashReceiptStatus: "PENDIENTE_FIRMA",
    createdBy: superUid,
    createdAt: Timestamp.now(),
    ...overrides,
  };
  for (const key of Object.keys(row)) if (row[key] === OMIT) delete row[key];
  await db.doc(`clientDispersions/${id}`).set(row);
  return id;
}
const dispersionRow = async (id) => (await db.doc(`clientDispersions/${id}`).get()).data();
const requestRow = async (token) => (await db.doc(`dispersionSignatureRequests/${sha256(token)}`).get()).data();
const submit = (token, extra = {}) => call("submitDispersionCashSignature", {
  token, signerName: BENEFICIARY, acceptedReceipt: true, signatureDataUrl: inkDataUrl, ...extra,
}, null);

async function main() {
  await db.doc(`users/${superUid}`).set({ uid: superUid, role: "superadmin", rootId: root, active: true });
  await db.doc(`users/${adminUid}`).set({ uid: adminUid, role: "admin", rootId: root, active: true, adminId: adminUid });
  await db.doc(`users/${foreignUid}`).set({ uid: foreignUid, role: "superadmin", rootId: otherRoot, active: true });
  await db.doc(`clients/${clientId}`).set({ rootId: root, adminId: adminUid, nombre: "CLIENTE SINTETICO SA DE CV", active: true });

  // --- Happy path: create -> get -> submit ----------------------------------
  const dispersionId = await seedDispersion();
  const created = await call("createDispersionCashSignatureLink", { dispersionId, origin: "https://pay0.test/" });
  check(created.ok && /^[A-Za-z0-9_-]{24,160}$/.test(created.token), "Link carries a one-time token");
  same(created.url, `https://pay0.test/firma/efectivo/${encodeURIComponent(created.token)}`, "Public URL built from origin");
  same(created.alreadySigned, false, "First link is not a replacement");
  check(created.expiresAtMillis > Date.now() + 6 * 24 * 60 * 60 * 1000, "Link lives about seven days");
  check((await db.doc(`dispersionSignatureRequests/${created.token}`).get()).exists === false, "Raw token is not a document id");
  const stored = await requestRow(created.token);
  same(stored.status, "PENDING", "Request stored by token hash");
  same(stored.amount, AMOUNT, "Request freezes the amount");
  same(stored.expectedReceiverName, BENEFICIARY, "Request freezes the beneficiary");

  const info = await call("getDispersionCashSignatureRequest", { token: created.token }, null);
  same(info.amount, AMOUNT, "Public read shows the frozen amount");
  same(info.expectedReceiverName, BENEFICIARY, "Public read shows the expected receiver");
  same(info.clienteNombre, undefined, "Public read does not expose the client");
  check(info.acceptanceText.includes("$15,000.00 MXN") && info.acceptanceText.includes("D1CASH"), "Acceptance text carries amount and folio");

  await rejects(submit(created.token, { acceptedReceipt: false }), "failed-precondition", "Submit requires the acceptance");
  await rejects(submit(created.token, { signerName: "A" }), "invalid-argument", "Submit requires a real name");
  await rejects(submit(created.token, { signatureDataUrl: dataUrl(blankCanvasPng()) }), "invalid-argument", "Blank canvas is rejected");
  same((await requestRow(created.token)).status, "PENDING", "Rejected attempts leave the link usable");

  const signed = await submit(created.token);
  check(signed.ok && signed.version === 1 && signed.receiverMatches === true, "Signature sealed as version 1");
  const upload = (await db.doc(`uploads/${signed.uploadId}`).get()).data();
  same(upload.status, "READY", "Upload is ready");
  same(upload.active, true, "Upload is the active signature");
  same(upload.documentType, "FIRMA_RECEPCION_EFECTIVO", "Upload is the receipt signature document");
  same(upload.entityType, "clientDispersions", "Upload belongs to the dispersion family");
  same(upload.dispersionId, dispersionId, "Upload references the dispersion");
  same(upload.integritySealStatus, "SEALED", "Upload is sealed");
  same(upload.sha256, sha256(signaturePng()), "Stored hash matches the PNG");
  same(upload.signatureCapture.signerName, BENEFICIARY, "Capture keeps the signer");
  same(upload.signatureCapture.amount, AMOUNT, "Capture keeps the immutable amount");
  check(upload.storagePath.startsWith(`roots/${root}/dispersiones/${dispersionId}/docs/FIRMA_RECEPCION_EFECTIVO/${signed.uploadId}-`), "Storage path follows the dispersion document layout");
  const [exists] = await bucket.file(upload.storagePath).exists();
  check(exists, "PNG written to Storage");
  const [metadata] = await bucket.file(upload.storagePath).getMetadata();
  same(metadata.metadata.sha256, upload.sha256, "Storage metadata carries the hash");
  same(String(metadata.generation), String(upload.storageGeneration), "Upload pins the storage generation");

  const row = await dispersionRow(dispersionId);
  same(row.cashReceiptStatus, "FIRMADA", "Dispersion marked as signed");
  same(row.cashReceipt.uploadId, signed.uploadId, "Dispersion points to the signature upload");
  same(row.cashReceipt.signerName, BENEFICIARY, "Dispersion keeps the signer");
  same(row.cashReceipt.receiverMatches, true, "Dispersion records the receiver match");
  same(row.cashReceipt.amount, AMOUNT, "Dispersion receipt keeps the amount");
  same(row.cashReceipt.token, undefined, "Raw token never stored on the dispersion");
  same(row.cashReceipt.requestId, sha256(created.token), "Dispersion references the request by hash");
  same(row.status, "REGISTRADA", "Signing does not change the dispersion status");
  const used = await requestRow(created.token);
  same(used.status, "SIGNED", "Token consumed");
  same(used.uploadId, signed.uploadId, "Token references the upload");
  const events = await db.collection("pay0ActivityLog").where("entityId", "==", dispersionId).get().catch(() => ({ docs: [] }));
  const eventNames = events.docs.map((d) => d.get("event"));
  check(eventNames.includes("DISPERSION_FIRMA_EFECTIVO_LINK_CREADO") && eventNames.includes("DISPERSION_FIRMA_EFECTIVO_CAPTURADA"), `Activity log has both events (${eventNames.join(",")})`);

  // --- One-time token --------------------------------------------------------
  await rejects(submit(created.token), "failed-precondition", "Second submit with the same token is rejected");
  await rejects(call("getDispersionCashSignatureRequest", { token: created.token }, null), "failed-precondition", "Used token cannot be read");
  same((await dispersionRow(dispersionId)).cashReceipt.uploadId, signed.uploadId, "Second submit did not alter the sealed receipt");

  // --- Invalid and expired tokens -------------------------------------------
  await rejects(call("getDispersionCashSignatureRequest", { token: "nope" }, null), "not-found", "Malformed token");
  await rejects(call("getDispersionCashSignatureRequest", { token: "A".repeat(43) }, null), "not-found", "Unknown token");
  await rejects(submit("A".repeat(43)), "not-found", "Submit with unknown token");
  const expiringId = await seedDispersion();
  const expiring = await call("createDispersionCashSignatureLink", { dispersionId: expiringId });
  await db.doc(`dispersionSignatureRequests/${sha256(expiring.token)}`).update({ expiresAt: Timestamp.fromMillis(Date.now() - 60_000) });
  await rejects(call("getDispersionCashSignatureRequest", { token: expiring.token }, null), "deadline-exceeded", "Expired token cannot be read");
  await rejects(submit(expiring.token), "deadline-exceeded", "Expired token cannot sign");
  same((await dispersionRow(expiringId)).cashReceiptStatus, "PENDIENTE_FIRMA", "Expired link leaves the dispersion pending");

  // --- Amount changed after the link was created -----------------------------
  const changedId = await seedDispersion();
  const changed = await call("createDispersionCashSignatureLink", { dispersionId: changedId });
  await db.doc(`clientDispersions/${changedId}`).update({ amount: AMOUNT + 1 });
  await rejects(submit(changed.token), "failed-precondition", "Amount drift blocks the signature");
  same((await requestRow(changed.token)).status, "PENDING", "Amount drift does not consume the token");
  same((await dispersionRow(changedId)).cashReceiptStatus, "PENDIENTE_FIRMA", "Amount drift leaves the dispersion pending");

  // --- Token re-pointed at another root / dispersion -------------------------
  const foreignDispersion = await seedDispersion({ rootId: otherRoot, adminId: foreignUid });
  const victimId = await seedDispersion();
  const victim = await call("createDispersionCashSignatureLink", { dispersionId: victimId });
  await db.doc(`dispersionSignatureRequests/${sha256(victim.token)}`).update({ dispersionId: foreignDispersion });
  await rejects(submit(victim.token), "permission-denied", "Token cannot sign a dispersion outside its root");
  same((await dispersionRow(foreignDispersion)).cashReceiptStatus, "PENDIENTE_FIRMA", "Foreign dispersion untouched");
  await db.doc(`dispersionSignatureRequests/${sha256(victim.token)}`).update({ dispersionId: victimId, rootId: otherRoot });
  await rejects(submit(victim.token), "permission-denied", "Token cannot change root");
  await rejects(call("createDispersionCashSignatureLink", { dispersionId: victimId }, foreignUid), "permission-denied", "User from another root cannot create a link");
  await rejects(call("createDispersionCashSignatureLink", { dispersionId: victimId }, null), "unauthenticated", "Anonymous cannot create a link");

  // --- Dispersions that do not admit a signature -----------------------------
  const transferId = await seedDispersion({ operationTypeKey: "TRANSFERENCIA", methodTipo: "TRANSFERENCIA", destinationKind: "CLABE", cashReceiptStatus: OMIT });
  await rejects(call("createDispersionCashSignatureLink", { dispersionId: transferId }), "failed-precondition", "Non-cash dispersion has no receipt");
  const cancelledId = await seedDispersion({ status: "CANCELADA" });
  await rejects(call("createDispersionCashSignatureLink", { dispersionId: cancelledId }), "failed-precondition", "Cancelled dispersion has no receipt");
  const incidentId = await seedDispersion({ incidentStatus: "SOLICITADA" });
  await rejects(call("createDispersionCashSignatureLink", { dispersionId: incidentId }), "failed-precondition", "Pending incident blocks the link");
  const userFundedId = await seedDispersion({ fundingSource: { holderType: "USER", sourceClientId: clientId, ownerUid: superUid }, ownerUid: superUid });
  await rejects(call("createDispersionCashSignatureLink", { dispersionId: userFundedId }), "failed-precondition", "User-funded withdrawals have no receipt");
  const lateIncidentId = await seedDispersion();
  const lateIncident = await call("createDispersionCashSignatureLink", { dispersionId: lateIncidentId });
  await db.doc(`clientDispersions/${lateIncidentId}`).update({ incidentStatus: "SOLICITADA" });
  await rejects(submit(lateIncident.token), "failed-precondition", "Incident raised after the link blocks the signature");
  await db.doc(`clientDispersions/${lateIncidentId}`).update({ status: "CANCELADA", incidentStatus: admin.firestore.FieldValue.delete() });
  await rejects(submit(lateIncident.token), "failed-precondition", "Cancelled after the link blocks the signature");

  // --- A newer link cancels the pending one, without storing raw tokens ------
  const twiceId = await seedDispersion();
  const first = await call("createDispersionCashSignatureLink", { dispersionId: twiceId });
  const second = await call("createDispersionCashSignatureLink", { dispersionId: twiceId });
  const cancelled = await requestRow(first.token);
  same(cancelled.status, "CANCELLED", "Earlier pending link cancelled");
  same(cancelled.replacedByRequestId, sha256(second.token), "Cancelled row references the new request by hash");
  same(cancelled.replacedByToken, undefined, "Cancelled row holds no raw token");
  await rejects(call("getDispersionCashSignatureRequest", { token: first.token }, null), "failed-precondition", "Cancelled token cannot be read");
  await rejects(submit(first.token), "failed-precondition", "Cancelled token cannot sign");
  const mismatch = await submit(second.token, { signerName: "Maria Lopez Ruiz" });
  same(mismatch.receiverMatches, false, "A different signer is accepted but flagged");
  same((await dispersionRow(twiceId)).cashReceipt.receiverMatches, false, "Dispersion carries the mismatch flag");

  // --- FIRMADA is final: only superadmin, with a reason, may replace ----------
  await rejects(call("createDispersionCashSignatureLink", { dispersionId, reason: "Firma ilegible" }, adminUid), "permission-denied", "Admin cannot replace a signed receipt");
  await rejects(call("createDispersionCashSignatureLink", { dispersionId }), "invalid-argument", "Superadmin needs a reason to replace");
  await rejects(call("createDispersionCashSignatureLink", { dispersionId, reason: "ok" }), "invalid-argument", "Reason must be meaningful");
  const replacement = await call("createDispersionCashSignatureLink", { dispersionId, reason: "Firma ilegible, se vuelve a capturar" });
  same(replacement.alreadySigned, true, "Replacement link flags the signed state");
  same((await requestRow(replacement.token)).replacementReason, "Firma ilegible, se vuelve a capturar", "Reason stored with the request");
  const replaceEvents = await db.collection("pay0ActivityLog").where("entityId", "==", dispersionId).where("event", "==", "DISPERSION_FIRMA_EFECTIVO_LINK_CREADO").get();
  check(replaceEvents.docs.some((d) => String(d.get("description") || "").includes("Firma ilegible")), "Reason reaches the activity log");
  const resigned = await submit(replacement.token, { signerName: "Leonel Cortez" });
  same(resigned.version, 2, "Replacement signature is version 2");
  const previous = (await db.doc(`uploads/${signed.uploadId}`).get()).data();
  same(previous.status, "REPLACED", "Previous signature kept as history");
  same(previous.active, false, "Previous signature no longer active");
  same(previous.replacedByUploadId, resigned.uploadId, "History points to the replacement");
  const current = (await db.doc(`uploads/${resigned.uploadId}`).get()).data();
  same(current.active, true, "Replacement is the active signature");
  const finalRow = await dispersionRow(dispersionId);
  same(finalRow.cashReceipt.uploadId, resigned.uploadId, "Dispersion points to the replacement");
  same(finalRow.cashReceipt.version, 2, "Dispersion receipt version advanced");

  // --- Admin with direct client access may open a link; legacy cash rows too --
  const adminId = await seedDispersion();
  const byAdmin = await call("createDispersionCashSignatureLink", { dispersionId: adminId }, adminUid);
  check(byAdmin.ok, "Admin who owns the client can create a link");
  const legacyId = await seedDispersion({ cashReceiptStatus: OMIT });
  const legacy = await call("createDispersionCashSignatureLink", { dispersionId: legacyId });
  const legacySigned = await submit(legacy.token);
  check(legacySigned.ok && (await dispersionRow(legacyId)).cashReceiptStatus === "FIRMADA", "Legacy cash dispersion can still be signed");

  console.log(JSON.stringify({ result: "PASS", checks, scope: "dispersion cash receipt signature callables", externalCalls: 0 }));
}

main().then(() => process.exit(0), (error) => {
  console.error(error);
  console.log(JSON.stringify({ result: "FAIL", checks, message: String(error && error.message || error) }));
  process.exit(1);
});
