const assert = require('node:assert/strict');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || process.env.GCLOUD_PROJECT !== 'demo-pay0') throw Error('Local emulator required');
global.fetch = async () => { throw Error('EXTERNAL_NETWORK_FORBIDDEN'); };
const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: 'demo-pay0' });
const db = admin.firestore(), stamp = admin.firestore.Timestamp;
const api = require('../../functions/lib/modules/paymentApplications/complementAutomation');
const { complementRequestId } = require('../../functions/lib/modules/paymentApplications/complementFollowup');
const { claimIqComplementGate } = require('../../functions/lib/modules/paymentApplications/complementGates');
const { inventoryPage } = require('../../functions/lib/modules/paymentApplications/complementInventory');
const { assessLocalIqRecovery } = require('../../functions/lib/modules/paymentApplications/complementRecoveryPlan');
const uuid = '11111111-1111-4111-8111-111111111111';

async function fixture(label) {
  const root = `gate-${label}-${Date.now()}`, profileId = `${root}-profile`, appId = `${root}-app`;
  await db.doc(`users/${root}`).set({ rootId: root, role: 'superadmin', active: true });
  await db.doc(`clients/${root}`).set({ rootId: root, adminId: root, active: true });
  await db.doc(`iqIntegrationConfigs/${root}`).set({ rootId: root, enabled: true, automation: { aplicacionPagos: true } });
  await db.doc(`paymentComplementConfigs/${root}`).set({ rootId: root, activatedAt: stamp.fromMillis(Date.now() - 60000), iqEnabled: true, iqLookupEnabled: true, facturamaEnabled: false });
  await db.doc(`iqUserAccess/${root}`).set({ rootId: root, active: true, iqEnabled: true, iqCredentialProfileId: profileId, allowedModules: { pagos: true } });
  await db.doc(`iqCredentialProfiles/${profileId}`).set({ rootId: root, active: true, hasPassword: true, username: 'smoke' });
  await db.doc(`solicitudes/${root}`).set({ rootId: root, folio: 'S1', tipoFactura: 'PPD', clienteId: root, companyId: root, iqFolio: '123', facturaUuid: uuid, status: 'PROCESANDO' });
  await db.doc(`pagos/${root}`).set({ rootId: root, folio: 'P1', clienteId: root, companyId: root, status: 'CONCILIADO', moneda: 'MXN' });
  await db.doc(`pagoApplicationIqPlans/${root}`).set({ rootId: root, pagoId: root, iqExecutionProfileId: profileId, plan: { pagoIqFolio: '220483' } });
  await db.doc(`pagoApplicationIqAttempts/${root}`).set({ rootId: root, profileId, planId: root, createdBy: root });
  await db.doc(`pagoAplicaciones/${appId}`).set({ rootId: root, solicitudId: root, pagoId: root, createdBy: root, status: 'APLICADA', invoiceType: 'PPD', montoAplicado: 58,
    numeroParcialidad: 1, saldoAnterior: 116, saldoInsoluto: 58, createdAt: stamp.now(), iqPlanId: root, iqExecutionAttemptId: root,
    iqApplicationStatus: 'IQ_APPLIED', iqActionExecuted: true });
  await api.enqueueComplement(appId);
  const request = (await db.doc(`paymentComplementRequests/${complementRequestId(root, appId)}`).get()).data();
  assert(request?.automationJobId);
  return { root, profileId, appId, jobId: request.automationJobId };
}

function adapter() {
  const calls = { session: 0, preflight: 0, lookup: 0, request: 0 };
  return { calls, iqSession: async () => { calls.session++; return {}; }, preflightIqComplement: async () => { calls.preflight++; return 'REQUEST'; },
    availableIqComplement: async () => { calls.lookup++; return null; }, requestIqComplement: async () => { calls.request++; } };
}

async function runCase(label, change, expected) {
  const item = await fixture(label), mock = adapter();
  await change(item);
  await api.executeComplement(item.jobId, mock);
  assert.deepEqual(mock.calls, expected, label);
  const job = (await db.doc(`paymentComplementJobs/${item.jobId}`).get()).data();
  assert.equal(job.status, expected.request ? 'REQUESTED' : 'PAUSED');
  assert(job.lastGateReason || job.gateReason);
  return item;
}

async function run() {
  const zero = { session: 0, preflight: 0, lookup: 0, request: 0 };
  const lookupOnly = { session: 1, preflight: 1, lookup: 0, request: 0 };
  await runCase('master-off', x => db.doc(`iqIntegrationConfigs/${x.root}`).update({ enabled: false }), zero);
  await runCase('lookup-off', x => db.doc(`paymentComplementConfigs/${x.root}`).update({ iqLookupEnabled: false }), zero);
  await runCase('access-off', x => db.doc(`iqUserAccess/${x.root}`).update({ active: false }), zero);
  await runCase('profile-off', x => db.doc(`iqCredentialProfiles/${x.profileId}`).update({ active: false }), zero);
  await runCase('profile-changed', x => db.doc(`iqUserAccess/${x.root}`).update({ iqCredentialProfileId: 'different' }), zero);
  await runCase('root-changed', x => db.doc(`iqCredentialProfiles/${x.profileId}`).update({ rootId: 'foreign' }), zero);
  await runCase('lookup-quota-zero', x => db.doc(`paymentComplementConfigs/${x.root}`).update({ iqLookupDailyLimit: 0 }), zero);
  await runCase('request-off', x => db.doc(`paymentComplementConfigs/${x.root}`).update({ iqEnabled: false }), lookupOnly);
  await runCase('request-flag-off', x => db.doc(`paymentComplementConfigs/${x.root}`).update({ iqRequestEnabled: false }), lookupOnly);
  await runCase('flow-off', x => db.doc(`iqIntegrationConfigs/${x.root}`).update({ 'automation.aplicacionPagos': false }), lookupOnly);
  await runCase('request-quota-zero', x => db.doc(`paymentComplementConfigs/${x.root}`).update({ iqRequestDailyLimit: 0 }), lookupOnly);
  const live = await runCase('allowed', async () => {}, { session: 2, preflight: 1, lookup: 0, request: 1 });
  await db.doc(`iqIntegrationConfigs/${live.root}`).update({ enabled: false });
  const paused = adapter();
  await api.checkComplementDaily(live.jobId, new Date(Date.now() + 86400000), paused);
  assert.deepEqual(paused.calls, zero, 'pause stops daily IQ reads');
  const inventory = await inventoryPage(live.root, '', 25);
  assert.equal(inventory.counts.detected, 1, 'local detection continues while Master is off');
  assert.equal((await assessLocalIqRecovery(live.root, live.appId)).state, 'GATE_BLOCKED');
  const waiting = await fixture('waiting-application');
  await db.doc(`pagoAplicaciones/${waiting.appId}`).update({ iqActionExecuted: false });
  assert.equal((await assessLocalIqRecovery(waiting.root, waiting.appId)).state, 'WAITING_IQ_APPLICATION');
  const ready = await fixture('ready-preview');
  assert.equal((await assessLocalIqRecovery(ready.root, ready.appId)).state, 'READY_FOR_IQ_LOOKUP');
  const recovery = await fixture('read-while-request-paused');
  await db.doc(`paymentComplementConfigs/${recovery.root}`).update({ iqEnabled: false });
  const recoveryCalls = adapter();
  recoveryCalls.preflightIqComplement = async () => { recoveryCalls.calls.preflight++; return 'AVAILABLE'; };
  await api.executeComplement(recovery.jobId, recoveryCalls);
  assert.equal((await db.doc(`paymentComplementJobs/${recovery.jobId}`).get()).data().status, 'REQUESTED');
  await api.checkComplementDaily(recovery.jobId, new Date(Date.now() + 86400000), recoveryCalls);
  assert.equal(recoveryCalls.calls.lookup, 1, 'lookup continues when request permission is paused');
  assert.equal(recoveryCalls.calls.request, 0);
  const midFlight = await fixture('pause-during-session');
  const midCalls = adapter();
  midCalls.iqSession = async () => { midCalls.calls.session++; await db.doc(`iqIntegrationConfigs/${midFlight.root}`).update({ enabled: false }); return {}; };
  await api.executeComplement(midFlight.jobId, midCalls);
  assert.equal(midCalls.calls.preflight, 0);
  assert.equal(midCalls.calls.request, 0);
  const noCreate = await fixture('no-create-permission');
  const permissionCalls = adapter();
  permissionCalls.iqSession = async (_job, action) => { permissionCalls.calls.session++; if (action === 'REQUEST') throw Error('REP_IQ_PERMISSION_REQUIRED'); return {}; };
  await api.executeComplement(noCreate.jobId, permissionCalls);
  assert.equal(permissionCalls.calls.preflight, 1);
  assert.equal(permissionCalls.calls.request, 0);
  const quota = await fixture('concurrent-quota');
  await db.doc(`paymentComplementConfigs/${quota.root}`).update({ iqLookupDailyLimit: 1 });
  await db.doc(`paymentComplementJobs/${quota.jobId}`).update({ status: 'PREPARING' });
  const claims = await Promise.all([claimIqComplementGate(quota.jobId, 'LOOKUP'), claimIqComplementGate(quota.jobId, 'LOOKUP')]);
  assert.equal(claims.filter(row => row.allowed).length, 1, 'quota is claimed transactionally');
  console.log(JSON.stringify({ ok: true, cases: 16, concurrentQuota: 'PASS', inventoryWhilePaused: 'PASS', lookupWithoutRequest: 'PASS', localRecoveryPreview: 'PASS', externalNetworkCalls: 0 }));
}
run().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
