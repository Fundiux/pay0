const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { resolve } = require("node:path");
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "") || !/^demo-/.test(process.env.GCLOUD_PROJECT || "")) throw Error("ISOLATED_FIRESTORE_EMULATOR_REQUIRED");
const functionRequire = createRequire(resolve("functions/package.json"));
const admin = functionRequire("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
const { Timestamp } = functionRequire("firebase-admin/firestore");
const { scanMissingQuotationPage, detectMissingSolicitudQuotations } = require("../../functions/lib/modules/cotizaciones/missingQuoteDetector.js");

(async () => {
  const now = Date.now();
  const old = Timestamp.fromMillis(now - 20 * 60_000);
  const recent = Timestamp.fromMillis(now - 60_000);
  const rootId = "root-detector", uid = "superadmin-detector";
  const base = { rootId, ocFiscalMetadataUploadId: "oc", status: "PROCESANDO", cotizacionAutoGenerateUpdatedAt: old };
  await Promise.all([
    db.doc("solicitudes/missing-a").set({ ...base, iqFolio: "IQ-A" }),
    db.doc("solicitudes/missing-b").set({ ...base, iqFolio: "IQ-B" }),
    db.doc("solicitudes/recent").set({ ...base, iqFolio: "IQ-RECENT", cotizacionAutoGenerateUpdatedAt: recent }),
    db.doc("solicitudes/no-iq").set({ ...base, iqFolio: "" }),
    db.doc("solicitudes/terminal").set({ ...base, iqFolio: "IQ-TERMINAL", status: "CANCELADA" }),
    db.doc("solicitudes/foreign").set({ ...base, rootId: "other-root", iqFolio: "IQ-FOREIGN" }),
    db.doc("agentScannerState/missing-quotation-v1").set({ afterId: "historical" }),
  ]);
  const original = (await db.doc("solicitudes/missing-a").get()).data();
  assert.equal(typeof detectMissingSolicitudQuotations.run, "function");
  await detectMissingSolicitudQuotations.run({});
  assert.deepEqual(await scanMissingQuotationPage(now), { scanned: 0, incidents: 0, wrapped: false, paused: true });
  assert.equal((await db.collection("agentIncidents").get()).size, 0);
  assert.equal((await db.collection("agentProposals").get()).size, 0);
  assert.equal((await db.collection("agentScannerState").get()).size, 1);

  const activationId = "a".repeat(32), activatedAt = Timestamp.fromMillis(now - 1000), expiresAt = Timestamp.fromMillis(now + 30 * 60_000);
  await Promise.all([
    db.doc(`users/${uid}`).set({ rootId, role: "superadmin", active: true, modules: { solicitudes: { view: true } } }),
    db.doc(`agentControls/${rootId}`).set({ killSwitch: false }),
    db.doc("agentScannerControls/missing-quotation-v2").set({ state: "ACTIVE", killSwitch: false, rootId, approvedBy: uid, activationId, activatedAt, expiresAt }),
    db.doc(`agentScannerActivations/missing-quotation-v2-${activationId}`).set({ detectorId: "missing-quotation-v2", activationId, rootId, approvedBy: uid, authorization: "EXPLICIT_SUPERADMIN", status: "ACTIVE", activatedAt, expiresAt }),
  ]);
  const runs = await Promise.all([scanMissingQuotationPage(now), scanMissingQuotationPage(now)]);
  assert.equal(runs.reduce((sum, run) => sum + run.incidents, 0), 2);
  assert.equal((await db.collection("agentIncidents").get()).size, 2);
  assert.equal((await db.collection("agentProposals").get()).size, 0);
  assert.deepEqual((await db.doc("solicitudes/missing-a").get()).data(), original);
  assert.equal((await db.doc("agentScannerState/missing-quotation-v1").get()).get("afterId"), "historical");
  const cursorBefore = (await db.doc(`agentScannerState/missing-quotation-v2-${rootId}`).get()).updateTime.toMillis();

  await db.doc(`agentScannerActivations/missing-quotation-v2-${activationId}`).update({ revokedAt: Timestamp.now() });
  assert.deepEqual(await scanMissingQuotationPage(now), { scanned: 0, incidents: 0, wrapped: false, paused: true });
  await detectMissingSolicitudQuotations.run({});
  assert.equal((await db.doc(`agentScannerState/missing-quotation-v2-${rootId}`).get()).updateTime.toMillis(), cursorBefore);
  assert.equal((await db.collection("agentIncidents").get()).size, 2);
  await db.doc(`agentControls/${rootId}`).update({ killSwitch: true });
  assert.equal((await scanMissingQuotationPage(now)).paused, true);
  console.log("PASS default pause, scheduler, audited activation, root scope, concurrent idempotency, revocation, kill switch");
})().catch(error => { console.error(error); process.exitCode = 1; });
