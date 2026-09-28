const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
    !/^demo-pay0(?:-[a-z0-9-]+)?$/.test(process.env.GCLOUD_PROJECT || '')) {
  throw Error('Local Firestore emulator and demo-pay0 project required');
}
let externalActions = 0;
const forbidden = () => { externalActions++; throw Error('EXTERNAL_NETWORK_FORBIDDEN'); };
global.fetch = forbidden;
// Firestore uses its loopback gRPC emulator. Storage is an in-memory fixture;
// HTTP(S) and every provider adapter remain unavailable throughout this test.
for (const transport of [require('node:http'), require('node:https')]) {
  transport.request = forbidden;
  transport.get = forbidden;
}
const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT, storageBucket: 'demo-pay0.appspot.com' });
const db = admin.firestore();
const blobs = new Map();
let downloads = 0, saves = 0, onDownload = async () => {};
admin.storage().bucket = () => ({ file: path => ({
  save: async bytes => { saves++; blobs.set(path, Buffer.from(bytes)); },
  download: async () => {
    downloads++;
    await onDownload(path);
    assert(blobs.has(path), 'synthetic storage fixture must exist');
    return [Buffer.from(blobs.get(path))];
  },
}) });
const api = require('../../functions/lib/modules/paymentApplications/complementAutomation');
const follow = require('../../functions/lib/modules/paymentApplications/complementFollowup');
const providers = require('../../functions/lib/modules/paymentApplications/complementProviders');
for (const key of Object.keys(providers)) if (typeof providers[key] === 'function') providers[key] = forbidden;

const invoiceUuid = '11111111-1111-4111-8111-111111111111';
const repUuid = '22222222-2222-4222-8222-222222222222';
const xml = Buffer.from(`<Comprobante TipoDeComprobante="P"><TimbreFiscalDigital UUID="${repUuid}"/><DoctoRelacionado IdDocumento="${invoiceUuid}" NumParcialidad="1" ImpPagado="58" ImpSaldoAnt="116" ImpSaldoInsoluto="58" MonedaDR="MXN"/><DoctoRelacionado IdDocumento="${invoiceUuid}" NumParcialidad="2" ImpPagado="58" ImpSaldoAnt="58" ImpSaldoInsoluto="0" MonedaDR="MXN"/></Comprobante>`);
const pdf = Buffer.from('%PDF-1.4\n% Synthetic REP idempotency fixture');
const collections = ['pagoAplicaciones', 'paymentComplementRequests', 'paymentComplementJobs', 'uploads',
  'solicitudes', 'pagos', 'activityLog', 'pay0ActivityLog', 'agent007Observations', 'agent007Recommendations', 'agent007Messages'];
const checks = [];

async function fixture(label, { withJob = true, shared, installment = 1 } = {}) {
  const rootId = shared?.rootId || `rep-idempotency-${label}-${randomUUID()}`, applicationId = `${rootId}-${label}-app`;
  const appRef = db.doc(`pagoAplicaciones/${applicationId}`);
  const requestRef = db.doc(`paymentComplementRequests/${follow.complementRequestId(rootId, applicationId)}`);
  const jobRef = db.doc(`paymentComplementJobs/${rootId}-job`);
  const legacyXml = `${applicationId}-xml`, legacyPdf = `${applicationId}-pdf`;
  const batch = db.batch();
  batch.set(db.doc(`solicitudes/${rootId}`), { rootId, folio: 'S-TEST', tipoFactura: 'PPD', companyId: rootId,
    clienteId: rootId, iqFolio: '123', facturaUuid: invoiceUuid, status: 'PROCESANDO' });
  batch.set(db.doc(`pagos/${rootId}`), { rootId, folio: 'P-TEST', companyId: rootId, clienteId: rootId,
    status: 'CONCILIADO', moneda: 'MXN' });
  batch.set(appRef, { rootId, solicitudId: rootId, pagoId: rootId, folio: 'AP-TEST', invoiceType: 'PPD', status: 'APLICADA',
    montoAplicado: 58, numeroParcialidad: installment, saldoAnterior: installment === 1 ? 116 : 58,
    saldoInsoluto: installment === 1 ? 58 : 0, montoTotal: 116,
    createdAt: admin.firestore.Timestamp.now(), iqApplicationStatus: 'IQ_APPLIED', iqActionExecuted: true,
    iqComplementStatus: 'IMPORTED', iqComplementXmlUploadId: legacyXml, iqComplementPdfUploadId: legacyPdf });
  for (const [id, extension, bytes] of [[legacyXml, 'XML', xml], [legacyPdf, 'PDF', pdf]]) {
    const path = `roots/${rootId}/solicitudes/${rootId}/docs/COMPLEMENTO_PAGO_${extension}/${id}`;
    blobs.set(path, bytes);
    batch.set(db.doc(`uploads/${id}`), { rootId, pagoId: rootId, solicitudId: rootId, pagoAplicacionId: applicationId,
      entityType: 'solicitudes', entityId: rootId, documentType: `COMPLEMENTO_PAGO_${extension}`,
      storagePath: path, active: true, status: 'READY' });
  }
  await batch.commit();
  await follow.reconcilePaymentComplement(applicationId);
  if (withJob) {
    await jobRef.set({ rootId, provider: 'IQ', applicationId, status: 'BLOCKED', error: 'SYNTHETIC_PENDING' });
    await requestRef.update({ automationJobId: jobRef.id, automationStatus: 'BLOCKED' });
  }
  return { rootId, applicationId, appRef, requestRef, jobRef, legacyXml, legacyPdf };
}

async function snapshot(rootId) {
  const result = {};
  for (const collection of collections) {
    const rows = await db.collection(collection).where('rootId', '==', rootId).get();
    result[collection] = rows.docs.map(doc => ({ id: doc.id,
      updateTime: { seconds: doc.updateTime.seconds, nanoseconds: doc.updateTime.nanoseconds }, data: doc.data() }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
  return result;
}
async function adoptionLogCount(f) {
  const rows = await db.collection('pay0ActivityLog').where('rootId', '==', f.rootId).get();
  return rows.docs.filter(doc => doc.data().event === 'COMPLEMENTO_PAGO_SEGUIMIENTO' &&
    doc.data().referenceId === f.applicationId && /reconciliado como documento/.test(doc.data().description)).length;
}
async function assertReceived(f) {
  const app = (await f.appRef.get()).data(), request = (await f.requestRef.get()).data();
  assert.equal(app.iqComplementDocumentOwner, 'PAGO_APPLICATION');
  assert.equal(request.status, 'RECEIVED');
  assert.equal(request.automationStatus, 'RECEIVED');
  assert.equal(request.uuid, repUuid);
  assert.equal(app.iqComplementXmlUploadId, request.xmlUploadId);
  assert.equal(app.iqComplementPdfUploadId, request.pdfUploadId);
  for (const id of [f.legacyXml, f.legacyPdf]) assert.equal((await db.doc(`uploads/${id}`).get()).data().active, false);
  const active = await db.collection('uploads').where('applicationId', '==', f.applicationId).where('active', '==', true).get();
  assert.equal(active.size, 2);
  for (const row of active.docs) {
    assert.equal(row.data().entityType, 'pagos');
    assert.equal(row.data().integritySealStatus, 'SEALED');
  }
  return { app, request };
}
async function replay(f, before) {
  await api.enqueueAutomaticPaymentComplement.run({ params: { applicationId: f.applicationId },
    data: { before, after: await f.appRef.get() } });
}
async function assertStable(f, operation, label) {
  const before = await snapshot(f.rootId), io = { downloads, saves };
  await operation();
  assert.deepEqual(await snapshot(f.rootId), before, `${label}: no writes, including timestamps, activity or Hugo events`);
  assert.deepEqual({ downloads, saves }, io, `${label}: no storage work`);
  checks.push(label);
}

async function run() {
  const once = await fixture('once'), original = await once.appRef.get();
  await api.enqueueComplement(once.applicationId);
  await assertReceived(once);
  assert.equal((await once.jobRef.get()).data().status, 'RECEIVED');
  assert.equal(await adoptionLogCount(once), 1);
  checks.push('first adoption retires legacy evidence and logs one completed transition');
  await assertStable(once, async () => {
    for (let i = 0; i < 4; i++) await api.enqueueComplement(once.applicationId);
  }, 'repeated enqueue is a strict no-op');
  await assertStable(once, () => Promise.all([api.enqueueComplement(once.applicationId), api.enqueueComplement(once.applicationId)]),
    'two concurrent completed deliveries are strict no-ops');
  await assertStable(once, async () => {
    await replay(once, original);
    await replay(once, original);
  }, 'actual application-written handler replays are strict no-ops');

  const concurrent = await fixture('concurrent');
  let arrivals = 0, release;
  const barrier = new Promise(resolve => { release = resolve; });
  onDownload = async path => {
    if (!path.includes(concurrent.rootId) || !path.includes('COMPLEMENTO_PAGO_XML')) return;
    if (++arrivals === 2) release();
    await barrier;
  };
  const timeout = setTimeout(() => release(), 10_000);
  try { await Promise.all([api.enqueueComplement(concurrent.applicationId), api.enqueueComplement(concurrent.applicationId)]); }
  finally { clearTimeout(timeout); onDownload = async () => {}; }
  assert.equal(arrivals, 2, 'both initial adopters must reach the same download barrier');
  await assertReceived(concurrent);
  assert.equal(await adoptionLogCount(concurrent), 1, 'transaction contention must not duplicate adoption activity');
  checks.push('two simultaneous first adoptions publish one transition');
  await assertStable(concurrent, () => replay(concurrent, original), 'concurrent winner trigger terminates');

  const legacyReceived = await fixture('legacy-received', { withJob: false });
  await legacyReceived.requestRef.update({ status: 'RECEIVED', automationStatus: 'RECEIVED' });
  await api.enqueueComplement(legacyReceived.applicationId);
  await assertReceived(legacyReceived);
  assert.equal(await adoptionLogCount(legacyReceived), 1);
  checks.push('legacy RECEIVED without canonical ownership is still adopted');
  await assertStable(legacyReceived, () => api.enqueueComplement(legacyReceived.applicationId), 'received adoption without a job is stable');

  await once.requestRef.update({ pdfUploadId: admin.firestore.FieldValue.delete(), automationStatus: 'BLOCKED', automationError: 'SYNTHETIC_PARTIAL' });
  await once.jobRef.update({ status: 'BLOCKED', error: 'SYNTHETIC_PARTIAL' });
  await once.appRef.update({ iqComplementDocumentOwner: admin.firestore.FieldValue.delete() });
  await api.enqueueComplement(once.applicationId);
  await assertReceived(once);
  assert.equal((await once.jobRef.get()).data().status, 'RECEIVED');
  assert.equal((await once.jobRef.get()).data().error, null);
  assert.equal(await adoptionLogCount(once), 2, 'one additional transition repairs partial ownership/request/job');
  checks.push('partial canonical ownership and request/job linkage are repaired');
  await assertStable(once, () => replay(once, original), 'repaired partial state stops the trigger');

  const canonical = (await once.requestRef.get()).data();
  await db.doc(`uploads/${canonical.xmlUploadId}`).update({ integritySealStatus: admin.firestore.FieldValue.delete() });
  const damaged = await snapshot(once.rootId);
  for (let i = 0; i < 2; i++) await assert.rejects(api.enqueueComplement(once.applicationId), /REP_IMPORTED_CANONICAL_DOCUMENT_INVALID/);
  assert.deepEqual(await snapshot(once.rootId), damaged, 'invalid READY canonical metadata never republishes RECEIVED or activity');
  checks.push('incomplete canonical READY metadata fails without any Firestore write');

  const cancelled = await fixture('cancelled');
  await cancelled.requestRef.update({ status: 'RECEIVED', automationStatus: 'RECEIVED' });
  await db.doc(`pagos/${cancelled.rootId}`).update({ status: 'CANCELADO' });
  await assertStable(cancelled, () => assert.rejects(api.enqueueComplement(cancelled.applicationId), /REP_SOURCE_CANCELLED/),
    'cancelled payment cannot be adopted or changed');

  const race = await fixture('reversal-race');
  const requestBefore = await race.requestRef.get(), jobBefore = await race.jobRef.get();
  let reversed = false;
  onDownload = async path => {
    if (!reversed && path.includes(race.rootId)) {
      reversed = true;
      await race.appRef.update({ status: 'REVERTIDA' });
    }
  };
  try { await assert.rejects(api.enqueueComplement(race.applicationId), /REP_NOT_APPLICABLE/); }
  finally { onDownload = async () => {}; }
  assert.equal((await race.appRef.get()).data().status, 'REVERTIDA');
  assert.equal((await race.appRef.get()).data().iqComplementDocumentOwner, undefined);
  assert.deepEqual((await race.requestRef.get()).updateTime, requestBefore.updateTime);
  assert.deepEqual((await race.jobRef.get()).updateTime, jobBefore.updateTime);
  assert.equal(await adoptionLogCount(race), 0);
  checks.push('source reversed during download is not finalized by a stale adopter');

  const sharedA = await fixture('shared-a');
  const sharedB = await fixture('shared-b', { shared: sharedA, installment: 2 });
  assert.equal(sharedA.jobRef.path, sharedB.jobRef.path);
  await api.enqueueComplement(sharedA.applicationId);
  await api.enqueueComplement(sharedB.applicationId);
  const receiptA = await assertReceived(sharedA), receiptB = await assertReceived(sharedB);
  assert.notEqual(receiptA.request.xmlUploadId, receiptB.request.xmlUploadId, 'each application owns its canonical upload');
  await assertStable(sharedA, () => Promise.all([api.enqueueComplement(sharedA.applicationId), api.enqueueComplement(sharedB.applicationId)]),
    'two canonical partialities sharing a job do not alternate its upload owner');
  const beforeReversal = await sharedB.appRef.get();
  await sharedB.appRef.update({ status: 'REVERTIDA' });
  await replay(sharedB, beforeReversal);
  const reviewedJob = (await sharedA.jobRef.get()).data();
  assert.equal(reviewedJob.status, 'REVIEW_REQUIRED');
  assert.equal(reviewedJob.error, 'REP_SOURCE_REVERSED');
  assert.equal((await sharedA.requestRef.get()).data().automationStatus, 'REVIEW_REQUIRED');
  await assertStable(sharedA, async () => {
    await api.enqueueComplement(sharedA.applicationId);
    await replay(sharedA, await sharedA.appRef.get());
  }, 'a valid sibling cannot erase a shared job reversal review');

  assert.equal(externalActions, 0);
  checks.push('no IQ, issuance, messaging or external network action');
  console.log(JSON.stringify({ ok: true, checks, count: checks.length, externalActions, storage: 'in-memory synthetic fixtures' }));
}

run().then(async () => { await db.terminate(); await admin.app().delete(); })
  .catch(error => { console.error(error); process.exitCode = 1; return db.terminate().catch(() => {}); });
