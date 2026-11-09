// Behavioural test for the automatic IQ dispersion receipt download against local emulators.
// Runs the compiled scan (functions/lib) with synthetic data; the IQ transport and credentials are stubbed.
//   npm run qa:dispersion-iq-receipt-auto
const assert = require("node:assert/strict");

for (const key of ["FIRESTORE_EMULATOR_HOST", "FIREBASE_STORAGE_EMULATOR_HOST"]) {
  if (!/^127\.0\.0\.1:\d+$/.test(process.env[key] || "")) throw new Error(`Local ${key} required`);
}
const projectId = process.env.GCLOUD_PROJECT || "demo-pay0";
if (!projectId.startsWith("demo-")) throw new Error("A demo project is mandatory");
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

// Stub the two IQ boundaries before the scan loads them: credentials and the receipt fetch.
const creation = require("../../functions/lib/modules/iq/dispersionCreationCallables.js");
const http = require("../../functions/lib/modules/dispersionDocuments/iqReceiptHttp.js");
const prefix = `iq-rcpt-${Date.now()}`;
const root = `${prefix}-root`, superUid = `${prefix}-super`;
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const fetchCalls = [];
let fetchMode = "AVAILABLE"; // AVAILABLE | NOT_AVAILABLE | NETWORK
creation.loadIqAccess = async () => ({ username: "stub", password: "stub", erpUrl: "https://iq.invalid" });
creation.buildDispersionSchedulerAuth = async (principal) => ({ uid: principal.createdBy, role: "superadmin", rootId: root, username: "stub" });
http.fetchIqDispersionReceipt = async ({ folio }) => {
  fetchCalls.push(folio);
  if (fetchMode === "NETWORK") throw new Error("ETIMEDOUT");
  if (fetchMode === "NOT_AVAILABLE") return { status: "NOT_AVAILABLE" };
  return { status: "AVAILABLE", bytes: PDF, contentType: "application/pdf", filename: `IQ-${folio}.pdf`, sha256: "a".repeat(64) };
};

const auto = require("../../functions/lib/modules/dispersionDocuments/iqReceiptAuto.js");
const domain = require("../../functions/lib/modules/dispersionDocuments/iqReceiptAutoDomain.js");
const runtimeGate = require("../../functions/lib/modules/iq/automationRuntime.js");

let checks = 0, seq = 0;
function check(condition, label) { assert.ok(condition, label); checks++; }
function same(actual, expected, label) { assert.equal(actual, expected, label); checks++; }

async function seed(overrides = {}, legStatus = "CREATED") {
  const id = `${prefix}-d${++seq}`, folio = String(70000 + seq);
  await db.doc(`clientDispersions/${id}`).set({
    rootId: root, adminId: superUid, clientId: `${prefix}-client`, clienteId: `${prefix}-client`, clienteNombre: "CLIENTE SINTETICO",
    folio: `D${seq}`, status: "REGISTRADA", amount: 1000, currency: "MXN", createdBy: superUid, createdAt: Timestamp.now(),
    iqGenerationStatus: "IQ_GENERADA", iqDispersionFolio: folio, iqDispersionId: folio, iqGenerationUpdatedAt: Timestamp.now(), ...overrides,
  });
  await db.doc(`clientDispersionLegs/${id}-leg`).set({ rootId: root, principalDispersionId: id, iqCreationStatus: legStatus, iqDispersionFolio: folio, despachoId: `${prefix}-desp` });
  return { id, folio };
}
const row = async (id) => (await db.doc(`clientDispersions/${id}`).get()).data();
const activeReceipts = async (id) => (await db.collection("uploads").where("rootId", "==", root).where("dispersionId", "==", id)
  .where("documentType", "==", "COMPROBANTE_DISPERSION").where("active", "==", true).get()).docs;
async function auditEvents(id) {
  let found = [];
  for (const collection of await db.listCollections()) {
    const snap = await collection.where("event", "==", "IQ_COMPROBANTE_DISPERSION_IMPORTADO").where("referenceId", "==", id).get().catch(() => ({ docs: [] }));
    found = found.concat(snap.docs);
  }
  return found;
}
// The safety runtime paces IQ operations by the real clock (1/s), independent of the simulated `nowMs`.
const scan = async (nowMs) => { await new Promise((resolve) => setTimeout(resolve, 1300)); return auto.runIqDispersionReceiptScan(root, nowMs); };

async function main() {
  await db.doc(`users/${superUid}`).set({ uid: superUid, role: "superadmin", rootId: root, active: true });
  await db.doc(`clients/${prefix}-client`).set({ rootId: root, adminId: superUid, nombre: "CLIENTE SINTETICO", active: true });

  // --- Pure rules ---------------------------------------------------------------
  const now = Date.now();
  const base = { rootId: root, iqGenerationStatus: "IQ_GENERADA", iqDispersionFolio: "123", iqGenerationUpdatedAt: Timestamp.fromMillis(now) };
  same(domain.decideReceiptAuto(base, root, now).action, "CHECK", "A generated dispersion with a folio is checked");
  same(domain.decideReceiptAuto({ ...base, iqGenerationStatus: "IQ_PARCIAL" }, root, now).reason, "NOT_PROCESSED_BY_IQ", "Only IQ-processed dispersions");
  same(domain.decideReceiptAuto({ ...base, iqDispersionFolio: "0" }, root, now).reason, "NO_UNIQUE_FOLIO", "Folio must be valid");
  same(domain.decideReceiptAuto({ ...base, iqReceiptStatus: "READY" }, root, now).reason, "HAS_RECEIPT", "Existing receipt is skipped");
  same(domain.decideReceiptAuto({ ...base, iqGenerationUpdatedAt: Timestamp.fromMillis(now - 8 * 86400000) }, root, now).reason, "OUTSIDE_WINDOW", "Untried old dispersion is skipped");
  same(domain.decideReceiptAuto({ ...base, iqReceiptAutoStatus: "WAITING", iqGenerationUpdatedAt: Timestamp.fromMillis(now - 8 * 86400000) }, root, now).action, "EXPIRED", "Tried old dispersion expires");
  same(domain.decideReceiptAuto({ ...base, iqGenerationUpdatedAt: undefined }, root, now).reason, "NO_GENERATION_TIME", "No timestamp is never checked or expired");

  // --- Gate: the IQ master switch and the dispersiones flow ---------------------
  await db.doc(`iqIntegrationConfigs/${root}`).set({ enabled: false, automation: { dispersiones: true } });
  same((await runtimeGate.readEnabledIqAutomationRoots({ process: "dispersionReceipt", respectWindow: false })).has(root), false, "Master switch off blocks the job");
  await db.doc(`iqIntegrationConfigs/${root}`).set({ enabled: true, automation: { dispersiones: false } });
  same((await runtimeGate.readEnabledIqAutomationRoots({ process: "dispersionReceipt", respectWindow: false })).has(root), false, "Dispersiones flow off blocks the job");
  await db.doc(`iqIntegrationConfigs/${root}`).set({ enabled: true, automation: { dispersiones: true } });
  same((await runtimeGate.readEnabledIqAutomationRoots({ process: "dispersionReceipt", respectWindow: false })).has(root), true, "Enabled root is eligible");

  // --- Happy path: downloaded once, into the dispersion's own documents ---------
  const ok = await seed();
  const notProcessed = await seed({ iqGenerationStatus: "IQ_PARCIAL" });
  const manual = await seed();
  await db.collection("uploads").doc(`${prefix}-manual`).set({ rootId: root, dispersionId: manual.id, entityId: manual.id, entityType: "clientDispersions",
    documentType: "COMPROBANTE_DISPERSION", active: true, status: "READY", version: 1 });
  let result = await scan(now);
  same(result.counts.IMPORTED, 1, "One receipt imported");
  same(result.counts.ALREADY_ATTACHED, 1, "Manually attached receipt is not duplicated");
  const stored = await activeReceipts(ok.id);
  same(stored.length, 1, "Exactly one active receipt");
  const upload = stored[0].data();
  same(upload.status, "READY", "Receipt is finalized");
  same(upload.entityType, "clientDispersions", "Receipt belongs to the dispersion, not the solicitud");
  same(upload.source, "IQ_IMPORT", "Receipt marks its IQ origin");
  same(upload.importOrigin, "AUTOMATIC", "Receipt marks the automatic import");
  const [exists] = await bucket.file(upload.storagePath).exists();
  check(exists, "File written to Storage");
  same((await row(ok.id)).iqReceiptStatus, "READY", "Dispersion marked READY");
  same((await auditEvents(ok.id)).length, 1, "One audit event for the stored receipt");
  same((await row(manual.id)).iqReceiptAutoStatus, "HAS_RECEIPT", "Manual receipt is marked so it is never re-read");
  same((await activeReceipts(manual.id)).length, 1, "Manual receipt stays the only copy");
  check(!fetchCalls.includes(notProcessed.folio), "A dispersion IQ did not process is never queried");
  check(!fetchCalls.includes(manual.folio), "A dispersion that already has the receipt is never queried");

  // --- Idempotent: a second run changes nothing ----------------------------------
  const callsBefore = fetchCalls.length;
  result = await scan(now + 1000);
  same(fetchCalls.length, callsBefore, "Second run makes no IQ read");
  same((await activeReceipts(ok.id)).length, 1, "Still exactly one receipt");
  same((await auditEvents(ok.id)).length, 1, "No second audit event");

  // --- Not yet available: wait, do not hammer IQ ---------------------------------
  fetchMode = "NOT_AVAILABLE";
  const waiting = await seed();
  result = await scan(now + 2000);
  same(result.counts.NOT_AVAILABLE, 1, "Missing receipt reported as not available");
  const waitingRow = await row(waiting.id);
  same(waitingRow.iqReceiptAutoStatus, "WAITING", "Dispersion waits for IQ");
  check(waitingRow.iqReceiptAutoNextCheckAt.toMillis() > now + 2000, "Next check is scheduled");
  const before = fetchCalls.length;
  await scan(now + 3000);
  same(fetchCalls.length, before, "Waiting dispersion is not queried again before its time");

  // --- Retry-safe: a network failure keeps the cursor and imports later ----------
  fetchMode = "NETWORK";
  const flaky = await seed();
  const cursorBefore = (await db.doc(`iqIntegrationConfigs/${root}`).get()).data().automationRuntime?.dispersionReceipt?.scanCursorUpdatedAt;
  result = await scan(now + 40 * 60000);
  check(result.cursorHeld, "Network failure holds the cursor");
  same((await activeReceipts(flaky.id)).length, 0, "Nothing stored on a failed read");
  same((await db.doc(`iqIntegrationConfigs/${root}`).get()).data().automationRuntime?.dispersionReceipt?.scanCursorUpdatedAt?.toMillis?.(), cursorBefore?.toMillis?.(), "Cursor record untouched");
  fetchMode = "AVAILABLE";
  result = await scan(now + 90 * 60000);
  same((await activeReceipts(flaky.id)).length, 1, "Receipt imported once IQ answers");
  same((await auditEvents(flaky.id)).length, 1, "One audit event after the retry");

  // --- Window: history is never touched; only rows this job tried expire ----------
  const history = await seed({ iqGenerationUpdatedAt: Timestamp.fromMillis(now - 30 * 86400000) });
  const noTime = await seed({ iqGenerationUpdatedAt: null });
  const tried = await seed({ iqGenerationUpdatedAt: Timestamp.fromMillis(now - 9 * 86400000), iqReceiptAutoStatus: "WAITING", iqReceiptAutoNextCheckAt: Timestamp.fromMillis(now) });
  const historyBefore = await row(history.id), noTimeBefore = await row(noTime.id);
  const callsOld = fetchCalls.length;
  result = await scan(now + 100 * 60000);
  same(result.counts.EXPIRED, 1, "Only the row this job tried expires");
  const triedRow = await row(tried.id);
  same(triedRow.iqReceiptStatus, "PENDING_NOT_FOUND", "Tried row reported as pending");
  same(triedRow.iqReceiptAutoStatus, "EXPIRED", "Tried row closed");
  assert.deepEqual(await row(history.id), historyBefore); checks++;
  assert.deepEqual(await row(noTime.id), noTimeBefore); checks++;
  check(!fetchCalls.slice(callsOld).some((f) => [history.folio, noTime.folio, tried.folio].includes(f)), "Old and untimed dispersions are never queried");
  same((await auditEvents(history.id)).length + (await auditEvents(noTime.id)).length, 0, "No import event for untouched history");
  let pendingEvents = 0;
  for (const collection of await db.listCollections()) {
    const snap = await collection.where("event", "==", "IQ_COMPROBANTE_DISPERSION_PENDIENTE").get().catch(() => ({ docs: [] }));
    for (const doc of snap.docs) { check([history.id, noTime.id].every((id) => doc.data().referenceId !== id), "No pending event for untouched history"); pendingEvents++; }
  }
  same(pendingEvents, 1, "Exactly one pending event, for the tried row");

  // --- Kill switch ----------------------------------------------------------------
  const killed = await seed();
  await db.doc("automationSafetyControls/master").set({ paused: true });
  const callsKill = fetchCalls.length;
  result = await scan(now + 120 * 60000);
  check(result.stopped, "Kill switch stops the scan");
  same(fetchCalls.length, callsKill, "No IQ read while paused");
  same((await activeReceipts(killed.id)).length, 0, "Nothing stored while paused");
  await db.doc("automationSafetyControls/master").set({ paused: false });
  await scan(now + 150 * 60000);
  same((await activeReceipts(killed.id)).length, 1, "Resumes after the switch is released");

  console.log(`dispersion-iq-receipt-auto-emulator: ${checks} checks passed`);
}

main().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
