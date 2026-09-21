const assert = require('node:assert/strict');
const observation = require('../fixtures/iq-rep-canary-ap1c4u1e6-observation.json');
const realAttachment = require('../fixtures/iq-rep-attachment-ap1c4u1e6-2026-09-21.json');
const createHash = require('node:crypto').createHash;
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || !process.env.FIREBASE_STORAGE_EMULATOR_HOST || process.env.GCLOUD_PROJECT !== 'demo-pay0') throw Error('Local emulators required');
global.fetch = async () => { throw Error('EXTERNAL_NETWORK_FORBIDDEN'); };
const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: 'demo-pay0', storageBucket: 'demo-pay0.appspot.com' });
const db = admin.firestore(), stamp = admin.firestore.Timestamp;
const { runIqRepReadCanary, IQ_REP_CANARY_ID } = require('../../functions/lib/modules/paymentApplications/complementCanary');
const { runRepAttachmentExperiment, IQ_REP_ATTACHMENT_EXPERIMENT_ID } = require('../../functions/lib/modules/paymentApplications/repAttachmentExperiment');
const { assessLocalIqRecovery } = require('../../functions/lib/modules/paymentApplications/complementRecoveryPlan');
const { reconcilePaymentComplement, complementRequestId } = require('../../functions/lib/modules/paymentApplications/complementFollowup');
const { saveComplementDocuments } = require('../../functions/lib/modules/paymentApplications/complementDocuments');
const provider = require('../../functions/lib/modules/paymentApplications/complementProviders');
const { inventoryPage } = require('../../functions/lib/modules/paymentApplications/complementInventory');
const root = `canary-${Date.now()}`, appId = `${root}-app`, profileId = `${root}-profile`;
const uuid = '11111111-1111-4111-8111-111111111111';
const rep = Buffer.from(`<Comprobante TipoDeComprobante="P"><TimbreFiscalDigital UUID="22222222-2222-4222-8222-222222222222"/><DoctoRelacionado IdDocumento="${uuid}" NumParcialidad="1" ImpPagado="58" ImpSaldoAnt="116" ImpSaldoInsoluto="58" MonedaDR="MXN"/></Comprobante>`);
const pdf = Buffer.from('%PDF-1.4\n% Hugo canary emulator');
const ref = db.doc(`hugoComplementCanaries/${IQ_REP_CANARY_ID}`);
async function run() {
  await db.doc(`users/${root}`).set({ rootId: root, role: 'superadmin', active: true });
  await db.doc(`clients/${root}`).set({ rootId: root, adminId: root, active: true });
  await db.doc(`iqIntegrationConfigs/${root}`).set({ rootId: root, enabled: true, automation: { aplicacionPagos: false } });
  await db.doc(`paymentComplementConfigs/${root}`).set({ rootId: root, iqLookupEnabled: true, iqEnabled: false, activatedAt: stamp.now() });
  await db.doc(`iqUserAccess/${root}`).set({ rootId: root, active: true, iqEnabled: true, iqCredentialProfileId: profileId, allowedModules: { pagos: true } });
  await db.doc(`iqCredentialProfiles/${profileId}`).set({ rootId: root, active: true, hasPassword: true, username: 'smoke' });
  await db.doc(`solicitudes/${root}`).set({ rootId: root, folio: 'S1', tipoFactura: 'PPD', clienteId: root, companyId: root, iqFolio: '123', facturaUuid: uuid, status: 'PROCESANDO' });
  await db.doc(`pagos/${root}`).set({ rootId: root, folio: 'P1', clienteId: root, companyId: root, status: 'CONCILIADO', moneda: 'MXN' });
  await db.doc(`pagoApplicationIqPlans/${root}`).set({ rootId: root, pagoId: root, iqExecutionProfileId: profileId, plan: { pagoIqFolio: '220483' } });
  await db.doc(`pagoApplicationIqAttempts/${root}`).set({ rootId: root, planId: root, profileId, createdBy: root });
  await db.doc(`pagoAplicaciones/${appId}`).set({ rootId: root, folio: 'AP1C4U1E6', solicitudId: root, pagoId: root, status: 'APLICADA', invoiceType: 'PPD', montoAplicado: 58, numeroParcialidad: 1,
    saldoAnterior: 116, saldoInsoluto: 58, iqApplicationStatus: 'IQ_APPLIED', iqActionExecuted: true, iqPlanId: root, iqExecutionAttemptId: root });
  await reconcilePaymentComplement(appId);
  const requestRef = db.doc(`paymentComplementRequests/${complementRequestId(root, appId)}`);
  await ref.set({ rootId: root, applicationFolio: 'AP1C4U1E6', capability: 'LOOKUP', status: 'QUEUED', steps: [] });
  let calls = { session: 0, deposit: 0, rep: 0, import: 0 };
  const pending = { iqSession: async () => { calls.session++; return {}; }, preflightIqComplement: async () => { calls.deposit++; return 'REQUEST'; },
    availableIqComplement: async () => { calls.rep++; return null; }, importIqComplement: async () => { calls.import++; } };
  await runIqRepReadCanary(IQ_REP_CANARY_ID, pending);
  assert.deepEqual(calls, { session: 1, deposit: 1, rep: 0, import: 0 });
  assert.equal((await requestRef.get()).data().status, 'PENDING');
  assert((await requestRef.get()).data().nextCheckAt);
  assert.equal((await ref.get()).data().status, 'PENDING');
  assert.equal((await inventoryPage(root)).counts.pending, 1);
  await ref.update({ status: 'QUEUED', steps: [] });
  await db.doc(`iqIntegrationConfigs/${root}`).update({ enabled: false });
  calls = { session: 0, deposit: 0, rep: 0, import: 0 };
  await runIqRepReadCanary(IQ_REP_CANARY_ID, pending);
  assert.deepEqual(calls, { session: 0, deposit: 0, rep: 0, import: 0 });
  assert.equal((await ref.get()).data().status, 'STOPPED');
  await db.doc(`iqIntegrationConfigs/${root}`).update({ enabled: true });
  await ref.update({ status: 'QUEUED', steps: [] });
  const available = { iqSession: pending.iqSession, preflightIqComplement: async () => 'AVAILABLE', availableIqComplement: async () => 'https://iq.test/rep.zip',
    importIqComplement: async (_url, sources) => [{ source: sources[0], documents: await saveComplementDocuments(sources[0], rep, pdf) }] };
  await runIqRepReadCanary(IQ_REP_CANARY_ID, available);
  assert.equal((await ref.get()).data().status, 'RECEIVED', (await ref.get()).data().error);
  assert.equal((await requestRef.get()).data().status, 'RECEIVED');
  assert.equal((await inventoryPage(root)).counts.processed, 1);
  await runIqRepReadCanary(IQ_REP_CANARY_ID, available);
  assert.equal((await ref.get()).data().status, 'RECEIVED');
  assert.equal(observation.kind, 'SANITIZED_RUNTIME_OBSERVATION_NOT_RAW_IQ_RESPONSE');
  assert.equal(observation.repAvailability, 'UNKNOWN');
  const job = { rootId: root, provider: 'IQ', profileId, actorUid: root, clientId: root, depositId: '220483' };
  for (const fields of [{}, { rep: false, can_request_rep: false }, { rep: null, can_request_rep: null }]) {
    let gets = 0;
    global.fetch = async url => { gets++; assert.match(String(url), /^https:\/\/iq-produccion-ccc570f75402\.herokuapp\.com\/deposits\?/);
      return { ok: true, json: async () => [{ id: job.depositId, conciliation_status: observation.conciliationStatus,
        operation_status: observation.operationStatus, ...fields }] }; };
    await assert.rejects(provider.preflightIqComplement(job, { accessToken: 'fixture-only' }), /IQ_REP_REQUEST_STATE_REQUIRES_REVIEW/);
    assert.equal(gets, 1, 'ambiguous deposit does not reach REP resource');
  }
  global.fetch = async url => { assert.match(String(url), /\/deposits\/complement\/220483$/);
    return { status: 400, json: async () => ({ errors: ['El depósito no tiene ningún REP adjunto'] }) }; };
  assert.equal(await provider.availableIqComplement(job, { accessToken: 'fixture-only' }), null);
  global.fetch = async url => { assert.match(String(url), /\/deposits\/complement\/220483$/);
    return { status: 200, json: async () => ({ url: 'https://iq.test/rep.zip' }) }; };
  assert.equal(await provider.availableIqComplement(job, { accessToken: 'fixture-only' }), 'https://iq.test/rep.zip');
  global.fetch = async () => { throw Error('EXTERNAL_NETWORK_FORBIDDEN'); };
  let realAdapterGets = 0;
  const realBody = JSON.stringify(realAttachment.body);
  assert.equal(Buffer.byteLength(realBody), realAttachment.bodyBytes);
  assert.equal(createHash('sha256').update(realBody).digest('hex'), realAttachment.bodySha256);
  global.fetch = async (url, init) => { realAdapterGets++; assert.match(String(url), /\/deposits\/complement\/220483$/);
    assert.equal(init.method, 'GET'); return new Response(realBody,
      { status: 400, headers: { 'content-type': 'application/json' } }); };
  const observedMissing = await provider.observeIqRepAttachment({ rootId: root, provider: 'IQ', profileId, actorUid: root, clientId: root, depositId: '220483' }, { accessToken: 'fixture-only' });
  assert.equal(realAdapterGets, 1); assert.equal(observedMissing.classification, 'REP_ATTACHMENT_NOT_AVAILABLE');
  assert.equal(observedMissing.shape.exactNoAttachmentMessage, true);
  assert.equal(observedMissing.shape.rep.present, false);
  assert.equal(observedMissing.shape.canRequestRep.present, false);
  assert.equal(observedMissing.shape.bodySha256, realAttachment.bodySha256);
  assert.equal(JSON.stringify(observedMissing).includes('fixture-only'), false);
  global.fetch = async () => { throw Error('EXTERNAL_NETWORK_FORBIDDEN'); };
  await requestRef.update({ status: 'PENDING', automationStatus: 'PENDING' });
  const preview = await assessLocalIqRecovery(root, appId);
  await ref.update({ status: 'STOPPED', error: 'IQ_REP_REQUEST_STATE_REQUIRES_REVIEW',
    steps: [{ stage: 'LOCAL_EVIDENCE_VERIFIED', fingerprint: preview.planFingerprint }] });
  const experimentRef = db.doc(`hugoRepAttachmentExperiments/${IQ_REP_ATTACHMENT_EXPERIMENT_ID}`);
  const seedExperiment = async () => experimentRef.set({ rootId: root, applicationFolio: 'AP1C4U1E6', applicationId: appId,
    capability: 'LOOKUP', status: 'QUEUED', steps: [] });
  await seedExperiment();
  let observed = 0, downloaded = 0;
  const missing = { iqSession: async () => ({}), observeIqRepAttachment: async () => { observed++; return {
    classification: 'REP_ATTACHMENT_NOT_AVAILABLE', shape: { httpStatus: 400, exactNoAttachmentMessage: true }, url: null }; },
    validateIqRepAttachmentDownload: async () => { downloaded++; throw Error('UNEXPECTED_DOWNLOAD'); } };
  await runRepAttachmentExperiment(IQ_REP_ATTACHMENT_EXPERIMENT_ID, missing);
  assert.equal(observed, 1); assert.equal(downloaded, 0);
  assert.equal((await experimentRef.get()).data().status, 'PENDING_B');
  assert.equal((await requestRef.get()).data().repGenerationStatus, 'REP_GENERATION_UNKNOWN');
  assert.equal((await requestRef.get()).data().repAttachmentStatus, 'REP_ATTACHMENT_NOT_AVAILABLE');
  await runRepAttachmentExperiment(IQ_REP_ATTACHMENT_EXPERIMENT_ID, missing);
  assert.equal(observed, 1, 'one-time experiment does not repeat GET');
  await seedExperiment();
  const availableAttachment = { ...missing, observeIqRepAttachment: async () => { observed++; return {
    classification: 'REP_ATTACHMENT_AVAILABLE', shape: { httpStatus: 200, urlPresent: true }, url: 'https://iq.test/rep.zip' }; },
    validateIqRepAttachmentDownload: async () => { downloaded++; return { repUuid: '22222222-2222-4222-8222-222222222222', validated: true }; } };
  await runRepAttachmentExperiment(IQ_REP_ATTACHMENT_EXPERIMENT_ID, availableAttachment);
  assert.equal(downloaded, 1);
  assert.equal((await experimentRef.get()).data().status, 'VALIDATED_NOT_RECEIVED');
  assert.notEqual((await requestRef.get()).data().status, 'RECEIVED');
  await seedExperiment();
  const ambiguous = { ...missing, observeIqRepAttachment: async () => { observed++; return {
    classification: 'REP_ATTACHMENT_AMBIGUOUS', shape: { httpStatus: 502 }, url: null }; } };
  await runRepAttachmentExperiment(IQ_REP_ATTACHMENT_EXPERIMENT_ID, ambiguous);
  assert.equal((await experimentRef.get()).data().status, 'STOPPED');
  assert.equal((await experimentRef.get()).data().responseShape.httpStatus, 502);
  assert.equal(downloaded, 1);
  console.log(JSON.stringify({ ok: true, pendingWithoutPost: true, masterBlocksExternal: true, verifiedReceipt: true, idempotentCanary: true,
    ambiguousDepositRegression: true, repEndpointContract: true, oneGetExperiment: true, noReceivedFromObservation: true, externalNetworkCalls: 0 }));
}
run().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
