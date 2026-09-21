const assert = require('node:assert/strict');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || process.env.GCLOUD_PROJECT !== 'demo-pay0') throw Error('Local emulator required');
global.fetch = async () => { throw Error('EXTERNAL_NETWORK_FORBIDDEN'); };
const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: 'demo-pay0' });
const db = admin.firestore();
const { inventoryPage, getHugoComplementInventoryPage } = require('../../functions/lib/modules/paymentApplications/complementInventory');
const { complementRequestId } = require('../../functions/lib/modules/paymentApplications/complementFollowup');
const root = `inventory-${Date.now()}`, foreign = `${root}-foreign`;
const uuid = '11111111-1111-4111-8111-111111111111';
const rep = '22222222-2222-4222-8222-222222222222';
const app = id => ({ rootId: root, solicitudId: id, pagoId: id, status: 'APLICADA', invoiceType: 'PPD', montoAplicado: 58, numeroParcialidad: 1, folio: id });
const source = id => ({ rootId: root, applicationId: id, solicitudId: id, pagoId: id, provider: 'IQ', status: 'RECEIVED', automationStatus: 'RECEIVED', invoiceUuid: uuid, installment: 1, amountMinor: 5800, balanceBefore: 116, balanceAfter: 58, uuid: rep, xmlUploadId: `${id}-xml`, pdfUploadId: `${id}-pdf` });
async function setup(id) {
  await db.doc(`solicitudes/${id}`).set({ rootId: root, folio: `S-${id}`, tipoFactura: 'PPD', iqFolio: '123', facturaUuid: uuid, status: 'PROCESANDO' });
  await db.doc(`pagos/${id}`).set({ rootId: root, folio: `P-${id}`, status: 'CONCILIADO' });
  await db.doc(`pagoAplicaciones/${id}`).set({ ...app(id), saldoAnterior: 116, saldoInsoluto: 58 });
}
async function sizes() {
  const names = ['paymentComplementRequests', 'paymentComplementJobs', 'uploads', 'activityLog'];
  return Object.fromEntries(await Promise.all(names.map(async name => [name, (await db.collection(name).get()).size])));
}
async function run() {
  await db.doc(`users/${root}`).set({ rootId: root, role: 'superadmin', active: true });
  for (const suffix of ['a', 'b', 'c', 'd']) await setup(`${root}-${suffix}`);
  await db.doc(`pagoAplicaciones/${root}-a`).update({ invoiceType: 'PUE' });
  await db.doc(`paymentComplementRequests/${complementRequestId(root, `${root}-c`)}`).set(source(`${root}-c`));
  for (const type of ['xml', 'pdf']) await db.doc(`uploads/${root}-c-${type}`).set({ rootId: root, solicitudId: `${root}-c`, pagoId: `${root}-c`, applicationId: `${root}-c`, documentType: `COMPLEMENTO_PAGO_${type.toUpperCase()}`, status: 'READY', active: true, complementKey: rep, integritySealStatus: 'SEALED', sha256: 'a'.repeat(64) });
  await db.doc(`paymentComplementRequests/${complementRequestId(root, `${root}-d`)}`).set(source(`${root}-d`));
  await db.doc(`pagoAplicaciones/${foreign}`).set({ ...app(foreign), rootId: foreign });
  const before = await sizes();
  let cursor = '', complete = false;
  const total = { scanned: 0, detected: 0, processed: 0, pending: 0, errors: 0, excluded: 0, iq: 0, facturama: 0, emisor: 0 };
  const reasons = [];
  while (!complete) {
    const page = await inventoryPage(root, cursor, 2);
    for (const key of Object.keys(total)) total[key] += page.counts[key];
    reasons.push(...page.exceptions.map(row => row.reason));
    complete = page.complete;
    cursor = page.cursor || '';
  }
  assert.deepEqual(total, { scanned: 4, detected: 3, processed: 1, pending: 1, errors: 1, excluded: 1, iq: 3, facturama: 0, emisor: 0 });
  assert(reasons.includes('FOLLOWUP_NOT_RECORDED'));
  assert(reasons.includes('RECEIPT_EVIDENCE_MISMATCH'));
  assert.deepEqual(await sizes(), before, 'inventory must not write Firestore');
  await assert.rejects(getHugoComplementInventoryPage.run({ auth: null, data: {} }));
  const callable = await getHugoComplementInventoryPage.run({ auth: { uid: root, token: {} }, data: { pageSize: 2 } });
  assert.equal(callable.counts.scanned, 2);
  await assert.rejects(inventoryPage(root, 'invalid/cursor', 2));
  console.log(JSON.stringify({ ok: true, total, pages: 2, writes: 0, externalActions: 0 }));
}
run().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
