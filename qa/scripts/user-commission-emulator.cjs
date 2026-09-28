const assert = require("node:assert/strict");
const projectId = process.env.GCLOUD_PROJECT || "";
if (!projectId.startsWith("demo-") || !["FIRESTORE_EMULATOR_HOST", "FIREBASE_STORAGE_EMULATOR_HOST"].every(key => /^127\.0\.0\.1:\d+$/.test(process.env[key] || ""))) throw Error("Loopback Firestore/Storage emulators and a demo project are required.");
const originalFetch = global.fetch;
global.fetch = (url, options) => { assert.ok(["127.0.0.1", "localhost"].includes(new URL(String(url)).hostname), "External requests are forbidden"); return originalFetch(url, options); };
const admin = require("../../functions/node_modules/firebase-admin");
admin.initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` });
const db = admin.firestore(), TS = admin.firestore.Timestamp;
const domain = require("../../functions/lib/modules/commissionDistributions/domain.js");
const api = require("../../functions/lib/modules/commissionDistributions/userDestinations.js");
const service = require("../../functions/lib/modules/commissionDistributions/service.js");
const requests = require("../../functions/lib/modules/commissionDistributions/requests.js");
const withdrawal = require("../../functions/lib/modules/commissionDistributions/withdrawal.js");
const execution = require("../../functions/lib/modules/commissionDistributions/execution.js");
const daily = require("../../functions/lib/modules/commissionDistributions/daily.js");
const financing = require("../../functions/lib/modules/financing/callables.js");
const { assertDispersionFundingOwner } = require("../../functions/lib/modules/financing/dispersionFunding.js");
const { reverseCanonicalDispersionFinancialsTx } = require("../../functions/lib/modules/financing/dispersionFinancial.js");
const { releaseForwardOnlyDispersionTx } = require("../../functions/lib/modules/dispatchBalances/forwardOnly.js");
const documents = require("../../functions/lib/modules/dispersionDocuments/service.js");
const { getAuthorizedDocumentDownloadUrlCore } = require("../../functions/lib/modules/documents/authorizedDownload.js");
const { runCreateClientDispersionIqCore } = require("../../functions/lib/modules/iq/dispersionCreationCallables.js");
const { dispatchBalanceAccountRef } = require("../../functions/lib/modules/dispatchBalances/repository.js");
const root = `commission-fixture-${Date.now()}`, client = `${root}-client`, other = `${root}-other`, dispatch = `${root}-dispatch`, profile = `${root}-iq`;
const now = Date.now(), yesterday = now - 86400000;
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }
function call(fn, uid, data) { return fn.run({ auth: { uid, token: {} }, data }); }
const set = (path, value) => db.doc(path).set(value);
const get = async path => (await db.doc(path).get()).data();
const destinations = weights => weights.map((shareBps, index) => ({ beneficiaryId: `${root}-b${index}`, methodId: `${root}-m${index}`, shareBps }));
const snapshot = (paymentId, at = now, amount = 30.03) => ({ rootId: root, pagoId: paymentId, clienteId: client, despachoId: dispatch, adminId: null, operadorId: null, currency: "MXN", createdAt: TS.fromMillis(at), assignmentSnapshot: { despachoCost: { rate: 2, pricingMode: "PERCENT", calculationBaseType: "TOTAL" }, clientCost: { rate: 5, pricingMode: "PERCENT", calculationBaseType: "TOTAL" } }, resultSnapshot: { superadminEarningAmount: amount, adminEarningAmount: 0, operadorEarningAmount: 0 }, operationFlags: { userEarningsEnabled: true } });
async function payment(suffix, at = now, amount = 30.03) { const id = `${root}-${suffix}`; await set(`pagos/${id}`, { rootId: root, clienteId: client, despachoId: dispatch, financialSnapshotId: id, status: "CONCILIADO", financialPostingStatus: "POSTED", folio: `P-${suffix}`, moneda: "MXN" }); await set(`paymentFinancialSnapshots/${id}`, snapshot(id, at, amount)); return id; }
async function backdateConfig(version, at) { const key = api.commissionSettingsId(root, client, root); for (const path of [`commissionUserEntitlements/${key}`, `commissionUserEntitlementHistory/${key}__v1`, `commissionUserDestinationRules/${key}`, `commissionUserDestinationHistory/${key}__v${version}`]) await db.doc(path).update({ effectiveFrom: TS.fromMillis(at) }); }
async function checkDailyScanProgress() {
  // Isolate scheduling from the already-tested financial executor. Firestore cursor,
  // leases, source reads and page audits stay real; no IQ adapter can be imported.
  const scanRoot = `${root}-scan`, ownerIds = [scanRoot, `${scanRoot}-admin`, `${scanRoot}-operator`];
  const day = daily.commissionOperationalClock(now).date;
  const runAt = new Date(`${day}T23:59:30-06:00`).getTime();
  const batch = db.batch();
  for (let index = 0; index < 251; index++) batch.set(db.doc(`pagos/${scanRoot}-${String(index).padStart(4, "0")}`), { rootId: scanRoot, status: "REGISTRADO" });
  for (const suffix of ["z1", "z2"]) {
    const paymentId = `${scanRoot}-${suffix}`;
    batch.set(db.doc(`pagos/${paymentId}`), { rootId: scanRoot, status: "APLICADO_TOTAL", financialPostingStatus: "POSTED", financialSnapshotId: paymentId });
    batch.set(db.doc(`paymentFinancialSnapshots/${paymentId}`), { rootId: scanRoot, adminId: ownerIds[1], operadorId: ownerIds[2], createdAt: TS.fromMillis(yesterday) });
  }
  batch.set(db.doc(`commissionAutomationConfigs/${scanRoot}`), { rootId: scanRoot, enabled: true, executionEnabled: true, timeZone: "America/Mexico_City", cutoff: "23:59", weekdays: [0, 1, 2, 3, 4, 5, 6], startDate: daily.commissionOperationalClock(yesterday).date, version: 1 });
  await batch.commit();
  const originalRequest = requests.requestUserCommissionDispersionCore, originalExecute = execution.executeUserCommissionRequestCore;
  const reserved = new Map(), submits = new Map();
  let fixturePosts = 0;
  requests.requestUserCommissionDispersionCore = async input => {
    const requestId = `${input.paymentId}|${input.ownerUid}`;
    if (!reserved.has(requestId)) reserved.set(requestId, { ownerUid: input.ownerUid, status: "RESERVED_AWAITING_EXECUTION" });
    return { distributionId: requestId, requestId, status: reserved.get(requestId).status };
  };
  execution.executeUserCommissionRequestCore = async (input, executor) => {
    const request = reserved.get(input.requestId);
    assert.equal(request.ownerUid, input.ownerUid);
    assert.equal(request.status, "RESERVED_AWAITING_EXECUTION");
    submits.set(input.requestId, (submits.get(input.requestId) || 0) + 1);
    for (let destination = 0; destination <= ownerIds.indexOf(input.ownerUid); destination++) await executor({ dispersionId: `${input.requestId}|${destination}` });
    request.status = "COMPLETED";
    return { status: request.status };
  };
  const executor = async () => { fixturePosts++; return { data: { results: [{ status: "CREATED", iqId: "FAKE-DAILY" }] } }; };
  const invoke = at => daily.runDailyUserCommissionPreflightCore(scanRoot, scanRoot, at, executor);
  try {
    const first = await invoke(runAt);
    check(first.scanned === 250 && first.executions === 0 && !first.complete, "daily scans 250 ineligible payments without spending the execution budget");
    const second = await invoke(runAt + 86400000);
    check(second.runId === first.runId && second.scanned === 2 && second.executions === 1, "unfinished scan crosses the day and reaches an eligible tail");
    let state = await get(`commissionDailyRuns/${first.runId}`);
    assert.deepEqual(state.pendingOwnerUids, ownerIds.slice(1)); checks++;
    check(state.operationalDate === day && state.pendingPaymentId === `${scanRoot}-z1`, "checkpoint preserves the old cutoff and remaining owners");
    check(fixturePosts === 1, "first invocation sends only the first owner's destinations");
    const third = await invoke(runAt + 2 * 86400000);
    check(third.executions === 1 && fixturePosts === 3, "next day resumes the next owner and all of its destinations");
    state = await get(`commissionDailyRuns/${first.runId}`);
    assert.deepEqual(state.pendingOwnerUids, ownerIds.slice(2)); checks++;
    for (let attempt = 0; attempt < 10 && !state.complete; attempt++) {
      const result = await invoke(runAt + 2 * 86400000);
      check(result.executions <= 1 && result.scanned <= 250, "each invocation has separate scan and execution bounds");
      state = await get(`commissionDailyRuns/${first.runId}`);
    }
    check(state.complete && submits.size === 6 && fixturePosts === 12, "all owners and all destinations at the tail finish across days");
    check([...submits.values()].every(count => count === 1), "daily checkpoints never repeat an owner submission");
    // New eligible rows before the old cursor must be found by the next completed sweep.
    const earlierId = `${scanRoot}-0000-new`;
    await set(`pagos/${earlierId}`, { rootId: scanRoot, status: "APLICADO_PARCIAL", financialPostingStatus: "POSTED", financialSnapshotId: earlierId });
    await set(`paymentFinancialSnapshots/${earlierId}`, { rootId: scanRoot, createdAt: TS.fromMillis(runAt + 3600000) });
    const newSweep = await invoke(runAt + 2 * 86400000);
    check(newSweep.executions === 1 && submits.has(`${earlierId}|${scanRoot}`), "new sweep finds a newer posting behind the previous cursor");
    for (let attempt = 0; attempt < 5; attempt++) { const result = await invoke(runAt + 2 * 86400000); if (result.skipped) break; }
    check((await invoke(runAt + 2 * 86400000)).skipped && submits.size === 7 && fixturePosts === 13, "completed current-date sweep is idempotent");
    const pages = await db.collection("commissionDailyRunPages").where("runId", "==", first.runId).get();
    check(pages.docs.every(row => row.data().executions <= 1) && new Set(pages.docs.map(row => row.data().invocationDate)).size === 3, "immutable page audit records all three invocation dates");
  } finally {
    requests.requestUserCommissionDispersionCore = originalRequest;
    execution.executeUserCommissionRequestCore = originalExecute;
  }
}
async function run() {
  for (const status of ["CONCILIADO", "APLICADO_PARCIAL", "APLICADO_TOTAL"]) check(domain.isPostedCommissionPayment({ status, financialPostingStatus: "POSTED" }), `posted earnings remain eligible: ${status}`);
  for (const status of ["CANCELADO", "RECHAZADO", "REGISTRADO"]) check(!domain.isPostedCommissionPayment({ status, financialPostingStatus: "POSTED" }), `ineligible payment: ${status}`);
  for (const [mode, weights] of [["CONTRACT_COMMISSION_POINTS", [300]], ["CONTRACT_COMMISSION_POINTS", [100, 200]], ["CONTRACT_COMMISSION_POINTS", [50, 100, 150]], ["USER_EARNINGS_PERCENTAGE", [2000, 8000]], ["USER_EARNINGS_PERCENTAGE", [1000, 3000, 6000]]]) {
    const result = domain.calculateUserCommissionDestinations(1000000, 300, mode, destinations(weights));
    check(result.destinations.reduce((sum, row) => sum + row.amountMinor, 0) === 1000000, `exact sum ${mode}/${weights.length}`);
  }
  assert.throws(() => domain.validateUserCommissionDestinations(300, "CONTRACT_COMMISSION_POINTS", destinations([100, 100])));
  assert.throws(() => domain.validateUserCommissionDestinations(300, "CONTRACT_COMMISSION_POINTS", destinations([100, 300])));
  assert.throws(() => domain.validateUserCommissionDestinations(300, "USER_EARNINGS_PERCENTAGE", destinations([5000, 6000])));
  assert.throws(() => domain.validateUserCommissionDestinations(300, "USER_EARNINGS_PERCENTAGE", destinations([5000, 4000])));
  assert.throws(() => domain.validateUserCommissionDestinations(300, "CONTRACT_COMMISSION_POINTS", destinations([0.5, 299.5])));
  checks += 5;
  const pennies = domain.calculateUserCommissionDestinations(101, 300, "CONTRACT_COMMISSION_POINTS", destinations([100, 100, 100]));
  assert.deepEqual(pennies.destinations.map(row => row.amountMinor), [34, 34, 33]); checks++;
  check(domain.allocateMinorExactly(Number.MAX_SAFE_INTEGER, [1, 2, 3]).reduce((sum, row) => sum + row.amountMinor, 0) === Number.MAX_SAFE_INTEGER, "large exact integers");
  const fixed = snapshot("fixed"); fixed.assignmentSnapshot.clientCost.pricingMode = "FIXED";
  check(domain.canonicalUserCommission(fixed, root).contractRateBps === null, "fixed price blocks points");
  const mixed = snapshot("mixed"); mixed.assignmentSnapshot.clientCost.calculationBaseType = "SUBTOTAL";
  check(domain.canonicalUserCommission(mixed, root).contractRateBps === null, "mixed bases block points");
  check(domain.calculateUserCommissionDestinations(3003, 0, "USER_EARNINGS_PERCENTAGE", destinations([10000])).earnedMinor === 3003, "earnings mode needs no invented rate");
  await set(`users/${root}`, { rootId: root, role: "superadmin", isActive: true, userNumber: 1, username: "fixture" });
  await set(`users/${other}`, { rootId: root, role: "operador", isActive: true, userNumber: 2 });
  await set(`clients/${client}`, { rootId: root, nombre: "Fixture client", clientNumber: 1 });
  await set(`despachos/${dispatch}`, { rootId: root, active: true, provider: "IQ", nombre: "Fixture IQ" });
  await set(`operationTypes/TRANSFERENCIA`, { category: "DISPERSION", active: true, name: "Transferencia" });
  await set(`despachos/${dispatch}/costos/TRANSFERENCIA`, { active: true, baseCost: 1, pricingMode: "PERCENT" });
  await set(`clients/${client}/costos/${dispatch}__TRANSFERENCIA`, { active: true, assignedCost: 2, pricingMode: "PERCENT" });
  await set(`iqCredentialProfiles/${profile}`, { rootId: root, active: true, hasPassword: true, username: "fixture-iq", associatedName: "Fixture", erpUrl: "https://example.invalid" });
  await set(`iqUserAccess/${root}`, { rootId: root, active: true, iqEnabled: true, iqCredentialProfileId: profile, allowedModules: { dispersiones: true } });
  for (let index = 0; index < 3; index++) {
    const last4 = `100${index}`;
    await set(`clientBeneficiaries/${root}-b${index}`, { rootId: root, clientId: client, active: true, nombre: `Fixture ${index}` });
    await set(`clientBeneficiaryMethods/${root}-m${index}`, { rootId: root, clientId: client, beneficiaryId: `${root}-b${index}`, active: true, tipo: "DEBITO", destinationKind: "CLABE", clabe: `03218000000000${last4}`, last4, masked: `****${last4}`, bankName: "Fixture", iqLinkStatus: "VERIFIED", iqVerifiedAt: TS.fromMillis(now), iqInstrumentLast4: last4, iqBeneficiaryId: `ib${index}`, iqAccountId: `ia${index}`, iqDespachoId: dispatch, iqCredentialProfileId: profile });
  }
  const reference = await payment("reference", yesterday - 5000);
  const entitlementInput = { clientId: client, ownerUid: root, referencePaymentId: reference, methodIds: destinations([1, 1, 1]).map(row => row.methodId), active: true, expectedVersion: 0 };
  await assert.rejects(() => call(api.configureUserCommissionEntitlement, other, entitlementInput)); checks++;
  await call(api.configureUserCommissionEntitlement, root, { ...entitlementInput, contractRateBps: 9999 });
  const settings = await call(api.getMyCommissionSettings, root, {});
  check(settings.configurations[0].contractRateBps === 300, "ignore caller-supplied entitlement rate");
  await assert.rejects(() => call(api.getMyCommissionSettings, other, { ownerUid: root })); checks++;
  const ruleA = { clientId: client, distributionMode: "CONTRACT_COMMISSION_POINTS", destinations: destinations([100, 100, 100]), expectedVersion: 0 };
  await assert.rejects(() => call(api.saveMyCommissionDestinations, other, { ...ruleA, ownerUid: root })); checks++;
  const preview = await call(api.previewMyCommissionDestinations, root, { ...ruleA, earnedMinor: 101 });
  assert.deepEqual(preview.destinations.map(row => row.amountMinor), [34, 34, 33]); checks++;
  for (const status of ["NOT_FOUND", "AMBIGUOUS", "STALE"]) {
    await db.doc(`clientBeneficiaryMethods/${root}-m0`).update({ iqLinkStatus: status });
    await assert.rejects(() => call(api.saveMyCommissionDestinations, root, ruleA)); checks++;
  }
  await db.doc(`clientBeneficiaryMethods/${root}-m0`).update({ iqLinkStatus: "VERIFIED", commissionOwnerUid: other });
  await assert.rejects(() => call(api.saveMyCommissionDestinations, root, ruleA)); checks++;
  await db.doc(`clientBeneficiaryMethods/${root}-m0`).update({ commissionOwnerUid: root });
  await call(api.saveMyCommissionDestinations, root, ruleA);
  await backdateConfig(1, yesterday - 2000);
  const first = await payment("first", yesterday);
  const created = await service.materializeCommissionDistribution({ paymentId: first, ownerUid: root, actorUid: root, expectedRootId: root });
  const historical = JSON.stringify((await get(`commissionDistributions/${created.distributionId}`)).legs);
  await call(api.saveMyCommissionDestinations, root, { clientId: client, distributionMode: "USER_EARNINGS_PERCENTAGE", destinations: destinations([10000]), expectedVersion: 1 });
  const repeated = await service.materializeCommissionDistribution({ paymentId: first, ownerUid: root, actorUid: root, expectedRootId: root });
  check(repeated.distributionId === created.distributionId && repeated.idempotent, "rule change does not create a second payout");
  check(JSON.stringify((await get(`commissionDistributions/${created.distributionId}`)).legs) === historical, "historical legs immutable");
  const historyCount = (await db.collection("commissionUserDestinationHistory").where("configurationId", "==", api.commissionSettingsId(root, client, root)).get()).size;
  check(historyCount === 2, "immutable rule versions");
  const pf = await service.preflightCommissionDistribution({ distributionId: created.distributionId, actorUid: root });
  check(pf.status === "READY_FOR_EXECUTION", "verified scope preflight");
  const userBalance = { rootId: root, holderType: "USER", holderId: root, holderRole: "superadmin", holderName: "Fixture", availableBalance: 1000, totalIn: 1000, totalOut: 0 };
  await set(`balanceAccounts/USER_${root}`, userBalance);
  await set(`balanceAccounts/CLIENT_${client}`, { rootId: root, holderType: "CLIENT", holderId: client, availableBalance: 2000 });
  const dispatchRef = dispatchBalanceAccountRef(db, { rootId: root, holderType: "USER", holderId: root, sourceClientId: client, despachoId: dispatch, currency: "MXN", channel: "IQ" });
  await dispatchRef.set({ ...userBalance, sourceClientId: client, despachoId: dispatch, currency: "MXN", channel: "IQ", reservedBalance: 0, executableBalance: 1000, totalGenerated: 1000, totalSpent: 0, totalReturned: 0, totalAdjusted: 0, status: "ACTIVE" });
  const previewWithdrawal = await withdrawal.reserveUserCommissionWithdrawal({ distributionId: created.distributionId, rootId: root, ownerUid: root, actorUid: root, source: "MANUAL", dryRun: true });
  check(previewWithdrawal.totalDebitMinor === 3063, "canonical fee included in preview");
  check((await get(`balanceAccounts/USER_${root}`)).availableBalance === 1000, "preview has no financial mutation");
  check((await call(requests.previewUserCommissionWithdrawal, root, { paymentId: "P-first", clientId: client })).paymentId === first, "manual preview resolves the visible payment folio");
  await assert.rejects(() => call(requests.previewUserCommissionWithdrawal, root, { paymentId: "P-first", clientId: `${client}-wrong` })); checks++;
  for (const flag of ["disabled", "deleted", "deletedAt"]) {
    await db.doc(`users/${root}`).update({ [flag]: true });
    await assert.rejects(() => withdrawal.reserveUserCommissionWithdrawal({ distributionId: created.distributionId, rootId: root, ownerUid: root, actorUid: root, source: "MANUAL", dryRun: true })); checks++;
    await db.doc(`users/${root}`).update({ [flag]: admin.firestore.FieldValue.delete() });
  }
  assert.throws(() => api.assertCommissionWithdrawalOwner(other, { rootId: root, role: "operador", modules: { wallet: { view: true, dispersiones: false } } }, root)); checks++;
  await db.doc(`balanceAccounts/USER_${root}`).update({ availableBalance: 1 });
  await assert.rejects(() => withdrawal.reserveUserCommissionWithdrawal({ distributionId: created.distributionId, rootId: root, ownerUid: root, actorUid: root, source: "MANUAL", dryRun: true })); checks++;
  await db.doc(`balanceAccounts/USER_${root}`).update({ availableBalance: 1000 });
  await dispatchRef.update({ availableBalance: 0, executableBalance: 0 });
  const foreignOrigin = dispatchBalanceAccountRef(db, { rootId: root, holderType: "USER", holderId: root, sourceClientId: `${client}-foreign`, despachoId: dispatch, currency: "MXN", channel: "IQ" });
  await foreignOrigin.set({ ...(await dispatchRef.get()).data(), sourceClientId: `${client}-foreign`, availableBalance: 99999, executableBalance: 99999 });
  await assert.rejects(() => withdrawal.reserveUserCommissionWithdrawal({ distributionId: created.distributionId, rootId: root, ownerUid: root, actorUid: root, source: "MANUAL", dryRun: true })); checks++;
  await dispatchRef.update({ availableBalance: 1000, executableBalance: 1000 });
  const reserved = await requests.requestUserCommissionDispersionCore({ rootId: root, paymentId: first, ownerUid: root, actorUid: root, source: "MANUAL", acceptTotalDebitMinor: previewWithdrawal.totalDebitMinor });
  check(reserved.principalIds.length === 3, "one canonical principal per destination");
  check((await get(`balanceAccounts/CLIENT_${client}`)).availableBalance === 2000, "CLIENT ledger is never debited");
  check((await get(`balanceAccounts/USER_${root}`)).availableBalance === 969.67, "own fee earning retains post-debit balance");
  check((await dispatchRef.get()).data().reservedBalance === 30.63, "USER dispatch funds reserved");
  check((await dispatchRef.get()).data().availableBalance === 969.67, "USER source-client channel preserved");
  const again = await requests.requestUserCommissionDispersionCore({ rootId: root, paymentId: first, ownerUid: root, actorUid: root, source: "DAILY", reserve: true });
  check(again.idempotent && again.requestId === reserved.requestId, "manual and daily share one reservation");
  await execution.cancelUserCommissionRequestCore({ requestId: reserved.requestId, rootId: root, ownerUid: root, actorUid: root });
  await execution.cancelUserCommissionRequestCore({ requestId: reserved.requestId, rootId: root, ownerUid: root, actorUid: root });
  check((await get(`balanceAccounts/USER_${root}`)).availableBalance === 1000, "cancel restores USER balance once");
  check((await dispatchRef.get()).data().availableBalance === 1000 && (await dispatchRef.get()).data().reservedBalance === 0, "cancel restores USER origin once");
  const second = await payment("second", Date.now() + 1);
  await db.doc(`pagos/${second}`).update({ status: "APLICADO_PARCIAL" });
  const made2 = await service.materializeCommissionDistribution({ paymentId: second, ownerUid: root, actorUid: root });
  const pv2 = await withdrawal.reserveUserCommissionWithdrawal({ distributionId: made2.distributionId, rootId: root, ownerUid: root, actorUid: root, source: "MANUAL", dryRun: true });
  const reserved2 = await requests.requestUserCommissionDispersionCore({ rootId: root, paymentId: second, ownerUid: root, actorUid: root, source: "MANUAL", acceptTotalDebitMinor: pv2.totalDebitMinor });
  let fakePosts = 0;
  const fakeExecutor = async input => { fakePosts++; const legs = await db.collection("clientDispersionLegs").where("principalDispersionId", "==", input.dispersionId).get(); await Promise.all(legs.docs.map(doc => doc.ref.update({ iqCreationStatus: "CREATED", iqDispersionId: "FAKE-IQ-1" }))); return { data: { results: [{ status: "CREATED", iqId: "FAKE-IQ-1" }] } }; };
  const executionInput = { requestId: reserved2.requestId, rootId: root, ownerUid: root, actorUid: root };
  await Promise.all([execution.executeUserCommissionRequestCore(executionInput, fakeExecutor), execution.executeUserCommissionRequestCore(executionInput, fakeExecutor)]);
  await execution.executeUserCommissionRequestCore(executionInput, fakeExecutor);
  check(fakePosts === 1, "concurrent execution + retry submits once");
  await assert.rejects(() => execution.cancelUserCommissionRequestCore(executionInput)); checks++;
  await service.preflightCommissionDistribution({ distributionId: made2.distributionId, actorUid: root });
  check((await get(`commissionDistributions/${made2.distributionId}`)).status === "COMPLETED", "preflight preserves completed state");
  const third = await payment("third", Date.now() + 1);
  await db.doc(`pagos/${third}`).update({ status: "APLICADO_TOTAL" });
  const made3 = await service.materializeCommissionDistribution({ paymentId: third, ownerUid: root, actorUid: root });
  const pv3 = await withdrawal.reserveUserCommissionWithdrawal({ distributionId: made3.distributionId, rootId: root, ownerUid: root, actorUid: root, source: "MANUAL", dryRun: true });
  const reserved3 = await requests.requestUserCommissionDispersionCore({ rootId: root, paymentId: third, ownerUid: root, actorUid: root, source: "MANUAL", acceptTotalDebitMinor: pv3.totalDebitMinor });
  const uncertainInput = { ...executionInput, requestId: reserved3.requestId };
  const uncertainExecutor = async () => { fakePosts++; throw Error("simulated accepted response lost"); };
  await execution.executeUserCommissionRequestCore(uncertainInput, uncertainExecutor);
  await execution.executeUserCommissionRequestCore(uncertainInput, uncertainExecutor);
  check(fakePosts === 2, "uncertain result never repeats POST");
  await assert.rejects(() => execution.cancelUserCommissionRequestCore(uncertainInput)); checks++;
  const uncertainRef = db.doc(`clientDispersions/${reserved3.principalIds[0]}`);
  await assert.rejects(() => runCreateClientDispersionIqCore({ auth: { uid: root, rootId: root, role: "superadmin", username: "fixture" }, dispersionId: uncertainRef.id, previewOnly: false })); checks++;
  await assert.rejects(() => runCreateClientDispersionIqCore({ auth: { uid: other, rootId: root, role: "operador", username: "fixture" }, dispersionId: uncertainRef.id, previewOnly: true })); checks++;
  await assert.rejects(() => db.runTransaction(async tx => {
    const principal = await tx.get(uncertainRef);
    return reverseCanonicalDispersionFinancialsTx({ tx, db, dispersion: principal.data(), dispersionId: principal.id, actorUid: root, actorUsername: root, decision: "CANCELACION_APLICADA" });
  })); checks++;
  await assert.rejects(() => db.runTransaction(async tx => {
    const principal = await tx.get(uncertainRef);
    return releaseForwardOnlyDispersionTx({ tx, db, dispersionRef: uncertainRef, dispersion: { ...principal.data(), status: "CANCELADA" }, actorUsername: root });
  })); checks++;
  const beforeDaily = (await db.collection("clientDispersions").where("rootId", "==", root).get()).size;
  check((await daily.runDailyUserCommissionPreflightCore(root, root)).reason === "DAILY_PREPARATION_DISABLED", "daily default off");
  assert.throws(() => daily.validateCommissionAutomation({ enabled: true, timeZone: "America/Mexico_City", weekdays: [] })); checks++;
  const date = daily.commissionOperationalClock(yesterday).date;
  await call(daily.saveCommissionAutomationConfig, root, { enabled: true, executionEnabled: false, timeZone: "America/Mexico_City", weekdays: [0, 1, 2, 3, 4, 5, 6], cutoff: "00:00", startDate: date, expectedVersion: 0 });
  const preparationTime = new Date(`${date}T23:59:30-06:00`).getTime();
  await daily.runDailyUserCommissionPreflightCore(root, root, preparationTime);
  check((await daily.runDailyUserCommissionPreflightCore(root, root, preparationTime)).reason === "RUN_COMPLETED_OR_IN_PROGRESS", "repeated daily run is idempotent");
  check((await db.collection("clientDispersions").where("rootId", "==", root).get()).size === beforeDaily, "preparation-only automation never reserves money");
  const dailyPayment = await payment("daily-enabled", Date.now() + 1);
  await db.doc(`pagos/${dailyPayment}`).update({ status: "APLICADO_TOTAL" });
  await call(daily.saveCommissionAutomationConfig, root, { enabled: true, executionEnabled: true, timeZone: "America/Mexico_City", weekdays: [0, 1, 2, 3, 4, 5, 6], cutoff: "23:59", startDate: date, expectedVersion: 1 });
  const futureDate = daily.commissionOperationalClock(Date.now()).date;
  const futureRunTime = new Date(`${futureDate}T23:59:30-06:00`).getTime();
  for (let page = 0; page < 20; page++) { const result = await daily.runDailyUserCommissionPreflightCore(root, root, futureRunTime, fakeExecutor); if (result.skipped) break; }
  check(fakePosts === 3, "enabled daily uses canonical shared request/executor once for applied payment");
  await daily.runDailyUserCommissionPreflightCore(root, root, futureRunTime, fakeExecutor);
  check(fakePosts === 3, "completed daily run does not repeat submissions");

  await checkDailyScanProgress();

  await set(`userClientAccess/${other}/clients/${client}`, { rootId: root, active: true, permissions: { view: true, operate: true, operateDispersiones: true, commentDispersionNotes: true, requestDispersionIncidents: true } });
  await assert.rejects(() => call(financing.addClientDispersionNota, other, { dispersionId: uncertainRef.id, text: "forbidden" })); checks++;
  await assert.rejects(() => call(financing.requestClientDispersionIncident, other, { dispersionId: uncertainRef.id, incidentType: "CANCELACION" })); checks++;
  await assert.rejects(() => call(financing.requestClientDispersionIncident, root, { dispersionId: uncertainRef.id, incidentType: "CANCELACION" })); checks++;
  await assert.rejects(() => documents.initDispersionDocumentUploadCore({ auth: { uid: other }, data: { dispersionId: uncertainRef.id, originalName: "fixture.pdf", contentType: "application/pdf", sizeBytes: 100 } })); checks++;
  const uploadId = `${root}-doc`;
  await set(`uploads/${uploadId}`, { rootId: root, dispersionId: uncertainRef.id, entityType: "clientDispersions", active: true, status: "READY", documentType: "COMPROBANTE_DISPERSION", clientId: client, storagePath: `roots/${root}/dispersiones/${uncertainRef.id}/fixture.pdf` });
  let signed = 0;
  await assert.rejects(() => getAuthorizedDocumentDownloadUrlCore({ auth: { uid: other }, data: { uploadId } }, async () => { signed++; return "https://example.invalid"; })); checks++;
  await getAuthorizedDocumentDownloadUrlCore({ auth: { uid: root }, data: { uploadId } }, async () => { signed++; return "https://example.invalid"; });
  check(signed === 1, "only owner/root can obtain a temporary document URL");
  check((await documents.notifyClientDispersionComprobanteFromUploadId(uploadId, "fake-unused-token")).reason === "private_user_withdrawal", "private withdrawal never notifies the client's Telegram group");
  const uncertainPrincipal = (await uncertainRef.get()).data();
  assert.throws(() => assertDispersionFundingOwner({ rootId: "different-root", uid: root, role: "superadmin", dispersion: uncertainPrincipal })); checks++;
  const batch = db.batch();
  for (let index = 0; index < 225; index++) batch.set(db.doc(`clientDispersions/${root}-foreign-${index}`), { rootId: root, clientId: client, ownerUid: root, createdBy: root, createdAt: TS.fromMillis(now + 60000 + index), fundingSource: { holderType: "USER", ownerUid: root, sourceClientId: client } });
  const ownedId = `${root}-owned-row`, legacyId = `${root}-legacy-row`;
  batch.set(db.doc(`clientDispersions/${ownedId}`), { rootId: root, clientId: client, ownerUid: other, createdBy: other, createdAt: TS.fromMillis(now - 1000), fundingSource: { holderType: "USER", ownerUid: other, sourceClientId: client } });
  batch.set(db.doc(`clientDispersions/${legacyId}`), { rootId: root, clientId: client, createdBy: other, createdAt: TS.fromMillis(now - 2000) });
  await batch.commit();
  const firstPage = await call(financing.listScopedClientDispersions, other, { limit: 1 });
  check(firstPage.rows.length === 1 && firstPage.rows[0].id === ownedId, "visible first page survives more than 200 private foreign rows");
  const cursor = firstPage.nextCursor;
  const secondPage = await call(financing.listScopedClientDispersions, other, { limit: 1, cursorSeconds: cursor.seconds, cursorNanoseconds: cursor.nanoseconds, cursorId: cursor.id });
  check(secondPage.rows.length === 1 && secondPage.rows[0].id === legacyId, "scan cursor preserves subsequent legacy CLIENT row");

  const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
  const { doc, getDoc, setDoc } = require("firebase/firestore");
  const { ref: storageRef, getBytes } = require("firebase/storage");
  const rules = require("node:fs").readFileSync(require("node:path").join(__dirname, "../../firestore.rules"), "utf8");
  const storageRules = require("node:fs").readFileSync(require("node:path").join(__dirname, "../../storage.rules"), "utf8");
  const env = await initializeTestEnvironment({ projectId, firestore: { host: "127.0.0.1", port: Number(process.env.FIRESTORE_EMULATOR_HOST.split(":")[1]), rules }, storage: { host: "127.0.0.1", port: Number(process.env.FIREBASE_STORAGE_EMULATOR_HOST.split(":")[1]), rules: storageRules } });
  try {
    const ownerDb = env.authenticatedContext(other).firestore(), rootDb = env.authenticatedContext(root).firestore();
    await assertSucceeds(getDoc(doc(ownerDb, "clientDispersions", ownedId))); checks++;
    await assertSucceeds(getDoc(doc(rootDb, "clientDispersions", ownedId))); checks++;
    await assertSucceeds(getDoc(doc(ownerDb, "clientDispersions", legacyId))); checks++;
    await assertFails(getDoc(doc(ownerDb, "clientDispersions", uncertainRef.id))); checks++;
    await set(`clientDispersions/${uncertainRef.id}/notas/private`, { text: "private", rootId: root });
    await assertFails(getDoc(doc(ownerDb, "clientDispersions", uncertainRef.id, "notas", "private"))); checks++;
    await assertFails(getDoc(doc(ownerDb, "commissionUserEntitlements", api.commissionSettingsId(root, client, root)))); checks++;
    await assertFails(setDoc(doc(ownerDb, "clientDispersions", ownedId), { amount: 1 }, { merge: true })); checks++;
    const foreignRoot = `${root}-external-root`;
    await set(`users/${foreignRoot}`, { rootId: foreignRoot, role: "superadmin", isActive: true });
    await assertFails(getDoc(doc(env.authenticatedContext(foreignRoot).firestore(), "clientDispersions", ownedId))); checks++;
    const storagePath = `roots/${root}/dispersiones/${ownedId}/docs/COMPROBANTE_DISPERSION/fixture.pdf`;
    await admin.storage().bucket().file(storagePath).save(Buffer.from("local-private-fixture"), { contentType: "application/pdf", resumable: false });
    const readObject = uid => getBytes(storageRef(env.authenticatedContext(uid).storage(`gs://${projectId}.appspot.com`), storagePath));
    await assertSucceeds(readObject(other)); checks++;
    await assertSucceeds(readObject(root)); checks++;
    await assertFails(readObject(foreignRoot)); checks++;
    const delegated = `${root}-delegated`;
    await set(`users/${delegated}`, { rootId: root, role: "operador", isActive: true });
    await set(`userClientAccess/${delegated}/clients/${client}`, { rootId: root, active: true, permissions: { view: true, operate: true } });
    await assertFails(readObject(delegated)); checks++;
    await db.doc(`users/${other}`).update({ modules: { wallet: { view: true, dispersiones: false } } });
    await assertFails(getDoc(doc(ownerDb, "clientDispersions", ownedId))); checks++;
    await assertFails(readObject(other)); checks++;
    await db.doc(`users/${other}`).update({ modules: admin.firestore.FieldValue.delete(), disabled: true });
    await assertFails(getDoc(doc(ownerDb, "clientDispersions", ownedId))); checks++;
    await assertFails(readObject(other)); checks++;
  } finally { await env.cleanup(); }
  check((await get(`balanceAccounts/CLIENT_${client}`)).availableBalance === 2000, "CLIENT unchanged through entire fixture");
  console.log(JSON.stringify({ result: "PASS", checks, fakeExecutorCalls: fakePosts, realIqPosts: 0, productionCalls: 0 }));
}
run().then(() => admin.app().delete()).catch(error => { console.error(error); process.exitCode = 1; return admin.app().delete(); });
