const assert = require('node:assert/strict');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || !process.env.FIREBASE_STORAGE_EMULATOR_HOST || process.env.GCLOUD_PROJECT !== 'demo-pay0') throw Error('Local emulators required');
global.fetch = async () => { throw Error('EXTERNAL_NETWORK_FORBIDDEN'); };
const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: 'demo-pay0', storageBucket: 'demo-pay0.appspot.com' });
const db = admin.firestore(), stamp = admin.firestore.Timestamp;
const { runIqRepReadCanary, IQ_REP_CANARY_ID } = require('../../functions/lib/modules/paymentApplications/complementCanary');
const { reconcilePaymentComplement, complementRequestId } = require('../../functions/lib/modules/paymentApplications/complementFollowup');
const { saveComplementDocuments } = require('../../functions/lib/modules/paymentApplications/complementDocuments');
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
  console.log(JSON.stringify({ ok: true, pendingWithoutPost: true, masterBlocksExternal: true, verifiedReceipt: true, idempotentCanary: true, externalNetworkCalls: 0 }));
}
run().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
