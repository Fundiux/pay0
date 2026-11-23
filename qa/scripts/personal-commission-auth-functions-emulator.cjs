/**
 * End-to-end Auth + Functions + Firestore emulator smoke for personal commission
 * configuration. Uses demo-only identities, no IQ connections or real transfers.
 */
const assert = require("node:assert/strict");
const admin = require("../../functions/node_modules/firebase-admin");
const { initializeApp, deleteApp } = require("firebase/app");
const { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } = require("firebase/auth");
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require("firebase/functions");
const { getFirestore, connectFirestoreEmulator, doc, getDoc } = require("firebase/firestore");

const projectId = "demo-pay0-pr43";
const loopback = /^127\.0\.0\.1:\d+$/;
for (const [key, required] of Object.entries({
  FIRESTORE_EMULATOR_HOST: true, FIREBASE_AUTH_EMULATOR_HOST: true,
})) {
  if (required && !loopback.test(process.env[key] || "")) {
    throw Error("LOCAL_EMULATOR_REQUIRED: " + key);
  }
}
if (process.env.GCLOUD_PROJECT !== projectId || process.env.FIREBASE_PROJECT_ID !== projectId)
  throw Error("ONLY_ISOLATED_DEMO_PROJECT_ALLOWED");
if (!admin.apps.length) admin.initializeApp({ projectId });
const db = admin.firestore();
const apps = [];
const stamp = Date.now().toString(36);
function appFor(label) {
  const app = initializeApp({ apiKey: "fake-key", projectId, appId: "demo-pay0-" + label }, "commission-" + label + "-" + stamp);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://" + process.env.FIREBASE_AUTH_EMULATOR_HOST, { disableWarnings: true });
  const fn = getFunctions(app, "us-central1");
  connectFunctionsEmulator(fn, "127.0.0.1", 5001);
  const firestore = getFirestore(app);
  connectFirestoreEmulator(firestore, "127.0.0.1", 8080);
  const invoke = (name, data = {}) => httpsCallable(fn, name, { timeout: 20000 })(data).then(response => response.data);
  return { app, auth, fn, firestore, invoke };
}
async function expectDenied(action, label) {
  let denied = false;
  try { await action(); } catch (error) {
    denied = ["permission-denied", "unauthenticated", "failed-precondition", "aborted", "invalid-argument"].some(code => String(error.code || "").includes(code));
    if (!denied) throw error;
  }
  assert.ok(denied, label);
}
async function run() {
  const superadmin = appFor("super"), owner = appFor("owner"), outside = appFor("outside");
  const [s, o, e] = await Promise.all([
    createUserWithEmailAndPassword(superadmin.auth, "s-" + stamp + "@example.invalid", "test-password-123"),
    createUserWithEmailAndPassword(owner.auth, "o-" + stamp + "@example.invalid", "test-password-123"),
    createUserWithEmailAndPassword(outside.auth, "e-" + stamp + "@example.invalid", "test-password-123"),
  ]);
  const rootId = s.user.uid, ownerUid = o.user.uid, foreignId = e.user.uid;
  const clientId = "qa-commission-" + stamp, accountId = "qa-account-" + stamp;
  await Promise.all([
    db.doc("users/" + rootId).set({ role: "superadmin", rootId, active: true, isActive: true, username: "qa-super-" + stamp }),
    db.doc("users/" + ownerUid).set({ role: "operador", rootId, active: true, isActive: true, parentUserId: rootId, username: "qa-owner-" + stamp }),
    db.doc("users/" + foreignId).set({ role: "superadmin", rootId: foreignId, active: true, isActive: true, username: "qa-other-" + stamp }),
    db.doc("clients/" + clientId).set({ rootId, active: true, nombre: "QA Commission Client" }),
    db.doc("personalCommissionAccounts/" + accountId).set({
      rootId, ownerUid, bankName: "Banco prueba", beneficiaryName: "Titular prueba",
      instrumentType: "CLABE", last4: "5678", active: true,
      iqLinkStatus: "PENDING", instrumentFingerprint: "fixture-do-not-use-for-iq",
    }),
  ]);
  const noDraft = await superadmin.invoke("getClientCommissionAllocationDraft", { clientId, ownerUid });
  assert.equal(noDraft.draft, null);
  const own = await owner.invoke("listPersonalCommissionAccounts", {});
  assert.equal(own.accounts.find(a => a.id === accountId)?.instrumentNumber, "••5678");
  const listed = await superadmin.invoke("listPersonalCommissionAccounts", { ownerUid, clientId, purpose: "CLIENT_COSTS" });
  assert.equal(listed.accounts.find(a => a.id === accountId)?.iqLinkStatus, "PENDING");
  await expectDenied(() => owner.invoke("getClientCommissionAllocationDraft", { clientId, ownerUid }), "Owner cannot read superadmin client drafts");
  await expectDenied(() => outside.invoke("listPersonalCommissionAccounts", { ownerUid, clientId, purpose: "CLIENT_COSTS" }), "Cross-root must not read accounts");
  // A server-side IQ match is scoped to both the client and the posted payment
  // origin; an otherwise valid-looking link from another despacho is not selectable.
  const paymentId = "qa-pago-" + stamp, snapshotId = "qa-snapshot-" + stamp;
  const linkId = require("node:crypto").createHash("sha256")
    .update(JSON.stringify([rootId, clientId, ownerUid, accountId])).digest("hex");
  const iqRef = db.doc("personalCommissionIqLinks/" + linkId);
  await Promise.all([
    db.doc("clients/" + clientId).update({ iqClientId: "101" }),
    db.doc("pagos/" + paymentId).set({
      rootId, clientId, status: "CONCILIADO", financialPostingStatus: "POSTED",
      financialSnapshotId: snapshotId, moneda: "MXN",
    }),
    db.doc("paymentFinancialSnapshots/" + snapshotId).set({
      rootId, clienteId: clientId, pagoId: paymentId, despachoId: "despacho-correcto", currency: "MXN",
    }),
    iqRef.set({
      rootId, clientId, ownerUid, accountId, iqLinkStatus: "VERIFIED",
      iqFullDigitsMatched: true, accountFingerprint: "fixture-do-not-use-for-iq",
      last4: "5678", iqClientId: "101", despachoId: "despacho-incorrecto",
      iqPartnerId: "201", iqBeneficiaryId: "301", iqAccountId: "401",
      iqCredentialProfileId: "profile-qa",
      verifiedAt: new Date(), // Firestore converts Date to its local SDK Timestamp; no cross-package instance
    }),
  ]);
  const scopedList = () => superadmin.invoke("listPersonalCommissionAccounts", {
    ownerUid, clientId, purpose: "CLIENT_COSTS", paymentId,
  });
  assert.equal((await scopedList()).accounts.find(a => a.id === accountId)?.iqLinkStatus, "PENDING",
    "Matching client but wrong despacho must fail closed");
  await iqRef.update({ despachoId: "despacho-correcto" });
  assert.equal((await scopedList()).accounts.find(a => a.id === accountId)?.iqLinkStatus, "VERIFIED",
    "Exact IQ proof from the posted source is selectable");
  await iqRef.update({ iqBeneficiaryId: "invalid-id" });
  assert.equal((await scopedList()).accounts.find(a => a.id === accountId)?.iqLinkStatus, "PENDING",
    "Malformed IQ beneficiary IDs must fail closed");
  await iqRef.update({ iqBeneficiaryId: "301", accountFingerprint: "wrong-fingerprint" });
  assert.equal((await scopedList()).accounts.find(a => a.id === accountId)?.iqLinkStatus, "PENDING",
    "Instrument fingerprint changes invalidate client selection");
  await iqRef.update({ accountFingerprint: "fixture-do-not-use-for-iq" });
  await expectDenied(() => superadmin.invoke("listPersonalCommissionAccounts", {
    ownerUid, clientId, purpose: "CLIENT_COSTS", paymentId: "another-payment",
  }), "Unknown posted source is not accepted");
  const save = await superadmin.invoke("saveClientCommissionAllocationDraft", {
    clientId, ownerUid, expectedVersion: 0,
    instructions: [{ accountId, pointsBps: 20, earningsPercentBps: null }],
  });
  assert.equal(save.version, 1);
  const loaded = await superadmin.invoke("getClientCommissionAllocationDraft", { clientId, ownerUid });
  assert.equal(loaded.draft.version, 1);
  await expectDenied(() => superadmin.invoke("saveClientCommissionAllocationDraft", {
    clientId, ownerUid, expectedVersion: 0, instructions: [],
  }), "Stale version rejected");
  await expectDenied(() => superadmin.invoke("saveClientCommissionAllocationDraft", {
    clientId, ownerUid, expectedVersion: 1,
    instructions: [{ accountId, pointsBps: 10, earningsPercentBps: 100 }],
  }), "Conflicting rate modes rejected");
  await expectDenied(() => owner.invoke("saveClientCommissionAllocationDraft", {
    clientId, ownerUid, expectedVersion: 1, instructions: [],
  }), "Only superadmin may save client rules");
  await expectDenied(() => outside.invoke("getPublishedClientCommissionAllocation", { clientId, ownerUid }), "Cross-root may not read published rules");
  await expectDenied(() => getDoc(doc(superadmin.firestore, "personalCommissionAccounts", accountId)), "Firestore clients cannot read protected account documents");
  const published = await superadmin.invoke("getPublishedClientCommissionAllocation", { clientId, ownerUid });
  assert.equal(published.rule, null);
  await db.doc("personalCommissionAccounts/" + accountId).update({ active: false });
  await expectDenied(() => superadmin.invoke("saveClientCommissionAllocationDraft", {
    clientId, ownerUid, expectedVersion: 1,
    instructions: [{ accountId, earningsPercentBps: 2000, pointsBps: null }],
  }), "Revoked bank account rejected");
  assert.equal((await db.doc("clientCommissionAllocationDrafts/" + require("node:crypto").createHash("sha256").update(JSON.stringify([rootId, clientId, ownerUid])).digest("hex")).get()).data()?.version, 1);
  console.log("PASS Auth+Functions+Firestore commission E2E: real callable auth, tenant guards, versioning, revocation, masked instruments; zero IQ/production calls");
}
run().catch(e => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await Promise.all(apps.map(deleteApp)); await admin.app().delete(); });
