const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { createRequire } = require('node:module');
const functionsRequire = createRequire(require('node:path').resolve('functions/package.json'));
const projectId = 'demo-pay0-financial';
assert.equal(process.env.GCLOUD_PROJECT, projectId);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:18087');
global.fetch = async () => { throw Error('EXTERNAL_NETWORK_FORBIDDEN'); };
const bundleArtifact = process.env.PAY0_QA_BUNDLE_ARTIFACT;
if (!bundleArtifact) require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true} }).outputText, filename);
const admin = functionsRequire('firebase-admin');
const {FieldValue, Timestamp} = functionsRequire('firebase-admin/firestore');
admin.initializeApp({projectId});
const db = admin.firestore(), stamp = Timestamp;
const bundle = bundleArtifact ? require('./helpers/functions-bundle-harness.cjs').loadBundle({artifact:bundleArtifact,dependencyRoot:require('node:path').resolve('functions')}) : null;
const internal = name => bundle ? bundle.loadInternal(`${name}.js`) : require(`../../functions/src/${name}.ts`);
const api = internal('modules/paymentApplications/complementAutomation');
const {complementRequestId} = internal('modules/paymentApplications/complementFollowup');
const {claimIqComplementGate} = internal('modules/paymentApplications/complementGates');
const {SafetyRuntime, CONSERVATIVE_POLICY} = internal('modules/automationSafety/runtime');
const {onPaymentReadyForCommissionDistribution} = internal('modules/commissionDistributions/triggers');
const uuid = '11111111-1111-4111-8111-111111111111';
function load(file, dependencies = {}) {
  if (bundle) {
    assert.equal(file, 'functions/src/modules/iq/depositHttpCreateCore.ts');
    // The real bundled IQ HTTP client and policy remain in the execution path.
    // Only its external transport is synthetic; no internal factory is replaced.
    process.env.PAY0_ENVIRONMENT = 'production';
    delete process.env.PAY0_EXTERNAL_ACTIONS_MODE;
    global.fetch = dependencies['./iqHttpClient'].fetchIq;
    return internal('modules/iq/depositHttpCreateCore');
  }
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  new Function('exports', 'require', code)(exports, name => { assert(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name]; });
  return exports;
}
const adapters = internal('modules/iq/depositHttpCreateFirebaseAdapters');
let posts = 0, transportMode = 'success';
const iqRow = { id: 991, created_at: '2026-10-06T20:00:01Z', sum: 100, currency: 'mxn',
  partner: 'Partner', client: 'Client', company: 'Company', operation_type: 'Deposit', sale_type: 'standard',
  base_percentage: '0', sale_percentage: '0', operation_status: 'pending', conciliation_status: 'pending' };
const core = load('functions/src/modules/iq/depositHttpCreateCore.ts', {
  'node:crypto': require('node:crypto'),
  './iqDateTime': internal('modules/iq/iqDateTime'),
  '../../utils/operationTiming': { operationTiming() {} },
  './iqHttpClient': { async fetchIq(url, options) {
    assert.equal(url.origin, 'http://127.0.0.1');
    if (options.method === 'POST') {
      posts++;
      if (transportMode === 'unknown') throw new Error('simulated response lost after dispatch');
      if (transportMode.startsWith('response-')) return new Response(JSON.stringify({message: 'unexpected response after provider commit'}), {status: Number(transportMode.slice(9))});
      if (transportMode === 'slow') await new Promise(resolve => setTimeout(resolve, 700));
      return new Response(JSON.stringify({ message: 'success' }), { status: 201 });
    }
    return new Response(JSON.stringify(transportMode === 'success' || transportMode === 'slow' ? [iqRow] : []), { status: 200 });
  } },
});
let attempt = 0;
async function runCore(pagoId, uploadId = 'receipt') {
  const context = { pagoId, actorUid: 'local-test', source: 'AUTO_TASK', fingerprint: 'fixed-test-fingerprint', expectedUploadId: uploadId };
  return core.createIqDepositHttpControlled({
    auth: { apiOrigin: 'http://127.0.0.1', bearerToken: 'synthetic' },
    identity: { pay0PagoId: pagoId, iqAttemptId: `attempt-${++attempt}`, pay0CreatedAtIso: '2026-10-06T20:00:00Z',
      partnerId: 1, partnerName: 'Partner', clientId: 2, clientName: 'Client', companyId: 3, companyName: 'Company',
      operationTypeId: 4, operationTypeName: 'Deposit', saleType: 'standard', sum: 100, currency: 'mxn',
      expectedSalePercentageId: 1, expectedBasePercentage: '0', expectedSalePercentage: '0' },
    voucher: { bytes: new Uint8Array([1, 2, 3]), originalName: 'synthetic.pdf', mimeType: 'application/pdf' },
    lock: adapters.createPagoAttemptLockAdapter(context), journal: adapters.createPagoAttemptJournal(context),
    allowHttpPost: true, recovery: { pollingBackoffMs: [0], pageSize: 100, maxPages: 1 },
  });
}
async function seedPago(id, patch = {}) {
  await db.collection('pagos').doc(id).set({ rootId: 'root', adminId: 'admin', createdBy: 'operator',
    status: 'CONCILIACION_PENDIENTE', iqDepositCreationStatus: 'QUEUED',
    iqDepositCreationQueuedUploadId: 'receipt', iqDepositCreationQueuedAt: Timestamp.now(), ...patch });
}
async function fixture(label) {
  const root = `gate-${label}-${Date.now()}`, profileId = `${root}-profile`, appId = `${root}-app`;
  await db.doc(`users/${root}`).set({ rootId: root, role: 'superadmin', active: true });
  await db.doc(`clients/${root}`).set({ rootId: root, adminId: root, active: true });
  await db.doc(`iqIntegrationConfigs/${root}`).set({ rootId: root, enabled: true, automation: { aplicacionPagos: true } });
  await db.doc(`paymentComplementConfigs/${root}`).set({ rootId: root, activatedAt: stamp.fromMillis(Date.now() - 60000), iqEnabled: true, iqLookupEnabled: true, iqRequestEnabled: true, facturamaEnabled: false });
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

async function run() {
  await seedPago('deposit-race');
  const race = await Promise.allSettled(Array.from({length: 5}, () => runCore('deposit-race')));
  assert.equal(race.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(posts, 1);
  await assert.rejects(runCore('deposit-race'), /ALREADY_LINKED/);
  assert.equal(posts, 1);
  console.log('PASS deposit: five workers, one POST, replay zero POST');
  transportMode = 'unknown';
  await seedPago('deposit-timeout');
  assert.equal((await runCore('deposit-timeout')).state, 'OUTCOME_UNKNOWN');
  await db.doc('pagos/deposit-timeout').update({iqDepositCreationLeaseExpiresAt: Timestamp.fromMillis(1)});
  await assert.rejects(runCore('deposit-timeout'), /RETRY_BLOCKED/);
  assert.equal(posts, 2);
  console.log('PASS deposit: provider success with lost response, expired lease, replay zero POST');
  for (const status of [408, 500, 502, 503, 504, 200, 201, 409, 429]) {
    transportMode = `response-${status}`;
    const id = `deposit-ambiguous-${status}`, before = posts;
    await seedPago(id);
    assert.equal((await runCore(id)).state, 'OUTCOME_UNKNOWN');
    await assert.rejects(runCore(id), /RETRY_BLOCKED/);
    assert.equal(posts - before, 1);
    console.log(`PASS IQ ambiguous HTTP${status}: lookup without match, replay blocked, one POST`);
  }
  transportMode = 'response-422';
  await seedPago('deposit-explicit-rejection');
  assert.equal((await runCore('deposit-explicit-rejection')).state, 'POST_REJECTED');
  assert.equal((await db.doc('pagos/deposit-explicit-rejection').get()).data().iqDepositCreationRetryBlocked, false);

  let clock = Date.now();
  const safety = new SafetyRuntime(db, () => clock);
  const input = {rootId: 'safety-root', process: 'REP', operationType: 'TEST', operationId: 'one', idempotencyKey: 'one', origin: 'AUTOMATIC', technicalOrigin: 'TASK', externalTarget: 'IQ', policy: {...CONSERVATIVE_POLICY, leaseMs: 1000}};
  const claims = await Promise.all(['TASK', 'TRIGGER', 'SCHEDULER'].map(technicalOrigin => safety.claim({...input, technicalOrigin})));
  assert.equal(claims.filter(x => x.ticket).length, 1);
  const ticket = claims.find(x => x.ticket).ticket;
  await safety.reserveExternal(ticket, true);
  clock += 1001;
  assert.equal((await safety.claim(input)).reason, 'OUTCOME_UNKNOWN');
  await assert.rejects(safety.reserveExternal(ticket, true), /SAFETY_FENCE_LOST/);
  assert.equal(await safety.finish(ticket, 'SUCCEEDED'), 'STALE');
  console.log('PASS safety: Task/trigger/scheduler collision; expired effect lease quarantined and fenced');

  const rep = await fixture('timeout'), mock = adapter();
  mock.requestIqComplement = async () => { mock.calls.request++; throw Error('ETIMEDOUT'); };
  await Promise.all(Array.from({length: 4}, () => api.executeComplement(rep.jobId, mock)));
  assert.equal(mock.calls.request, 1);
  assert.equal((await db.doc(`paymentComplementJobs/${rep.jobId}`).get()).data().status, 'UNKNOWN');
  await api.executeComplement(rep.jobId, mock);
  await api.protectedExecuteComplement(rep.jobId, 'TASK', mock);
  await api.checkComplementDaily(rep.jobId, new Date(Date.now() + 86400000), mock);
  assert.equal(mock.calls.request, 1);
  assert.equal(mock.calls.lookup, 1);
  console.log('PASS REP: four workers, timeout after effect, replay and daily lookup never POST again');

  for (const action of ['LOOKUP', 'REQUEST']) {
    const quota = await fixture(`quota-${action}`);
    await db.doc(`paymentComplementConfigs/${quota.root}`).update({[action === 'LOOKUP' ? 'iqLookupDailyLimit' : 'iqRequestDailyLimit']: 1});
    const jobRef = db.doc(`paymentComplementJobs/${quota.jobId}`);
    await jobRef.update({status: 'PREPARING'});
    const cloneId = `${quota.jobId}-competitor`;
    await db.doc(`paymentComplementJobs/${cloneId}`).set((await jobRef.get()).data());
    const results = await Promise.all([quota.jobId, cloneId].map(id => claimIqComplementGate(id, action)));
    assert.equal(results.filter(x => x.allowed).length, 1);
    assert.equal(results.find(x => !x.allowed).reason, 'REP_GATE_QUOTA_EXHAUSTED');
    console.log(`PASS REP quota ${action}: distinct jobs contend for final slot; one admitted`);
  }

  const payment = {rootId: 'commission-root', clienteId: 'commission-client', status: 'CONCILIADO', financialPostingStatus: 'POSTED', montoTotal: 10000, totalComisionCliente: 600, finalClientRate: 6};
  await db.doc('pagos/commission-payment').set(payment);
  await db.doc('clientCommissionRules/commission-client').set({rootId: payment.rootId, active: true, automationEnabled: true, version: 1, totalRateBps: 600, legs: [
    {kind: 'BASE', alias: 'BASE', rateBps: 200, beneficiaryId: 'b0', methodId: 'm0'},
    {kind: 'COMMISSIONER', alias: 'EJCT', rateBps: 300, beneficiaryId: 'b1', methodId: 'm1'},
    {kind: 'COMMISSIONER', alias: 'JFCC', rateBps: 100, beneficiaryId: 'b2', methodId: 'm2'}]});
  const event = {params: {paymentId: 'commission-payment'}, data: {before: {data: () => ({status: 'PENDIENTE'})}, after: {data: () => payment}}};
  await Promise.all(Array.from({length: 5}, () => onPaymentReadyForCommissionDistribution.run(event)));
  await onPaymentReadyForCommissionDistribution.run(event);
  const distributions = await db.collection('commissionDistributions').where('paymentId', '==', 'commission-payment').get();
  const audits = await db.collection('commissionAuditEvents').where('paymentId', '==', 'commission-payment').get();
  assert.equal(distributions.size, 1);
  assert.equal(audits.size, 1);
  assert.equal(distributions.docs[0].data().legs.reduce((sum, leg) => sum + leg.amountMinor, 0), 60000);
  console.log('PASS commission: five trigger deliveries plus replay produce one distribution, one audit, conserved cents');
  console.log('PASS financial concurrency: isolated demo Firestore; external network forbidden');
}
run().then(() => admin.app().delete()).catch(error => { console.error(error); process.exitCode = 1; return admin.app().delete(); });
