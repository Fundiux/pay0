const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const projectId = process.env.GCLOUD_PROJECT || '';
if (!projectId.startsWith('demo-') || !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
    !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_STORAGE_EMULATOR_HOST || '')) throw Error('LOCAL_DEMO_EMULATORS_REQUIRED');
const realFetch = global.fetch;
global.fetch = (url, ...args) => {
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(typeof url === 'string' ? url : url.url || url).hostname), 'No external fetch');
  return realFetch(url, ...args);
};
for (const protocol of ['http', 'https']) {
  const api = require(`node:${protocol}`), original = api.request;
  api.request = function (url, ...args) {
    const host = typeof url === 'string' || url instanceof URL ? new URL(url).hostname : String(url.hostname || url.host || '').split(':')[0];
    assert.ok(['127.0.0.1', 'localhost'].includes(host), 'No external transport');
    return original.call(this, url, ...args);
  };
}
const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` });
const db = admin.firestore(), bucket = admin.storage().bucket();
const { createPago } = require('../../functions/lib/index');
const { identifyParsedReceipt } = require('../../functions/lib/modules/pagos/receiptIdentification');
const { parseReceiptText } = require('../../functions/lib/modules/pagos/receiptPdfCallables');
const docs = require('../../functions/lib/modules/pagoDocuments/service');
const { activityCollectionForSystem } = require('../../functions/lib/modules/activityLog/systemBoundary');
const root = `receipt-create-${Date.now()}`, second = `${root}-second`, clientId = `${root}-client`, companyId = `${root}-company`, dispatchId = `${root}-dispatch`, operation = `${root}-OP`.toUpperCase();
const body = ['Transferencia SPEI MXN', 'Estado: Aplicada', 'Ordenante: Cliente Prueba', 'RFC ordenante: ABC010101AB1',
  'Beneficiario: Empresa Prueba', 'RFC beneficiario: DEF020202CD2', 'Monto: $1,000.50', 'Fecha: 2026-09-27',
  'Referencia: 0123-abc-456', 'Concepto: factura 123e4567-e89b-12d3-a456-426614174000'].join('\n');
const bytes = Buffer.from(body), sha = createHash('sha256').update(bytes).digest('hex');
let checks = 0;
const check = (condition, label) => { assert.ok(condition, label); checks++; };
const denied = async (fn, code) => { await assert.rejects(fn, error => error.code === code); checks++; };
const call = (fn, uid, data) => fn.run({ auth: { uid, token: {} }, data });
async function identify(uid = root) {
  return identifyParsedReceipt({ db, actor: { uid, role: 'superadmin', rootId: root }, receipt: parseReceiptText(body), contentSha256: sha, operationTypeKey: operation });
}
async function main() {
  for (const uid of [root, second]) await db.doc(`users/${uid}`).set({ rootId: root, role: 'superadmin', active: true, userNumber: uid === root ? 3 : 4 });
  await db.doc(`clients/${clientId}`).set({ rootId: root, active: true, createdBy: root, adminId: root, clientNumber: 7, razonSocial: 'Cliente Prueba', rfc: 'ABC010101AB1' });
  await db.doc(`companies/${companyId}`).set({ rootId: root, active: true, companyNumber: 5, razonSocial: 'Empresa Prueba', rfc: 'DEF020202CD2', despachoId: dispatchId });
  await db.doc(`despachos/${dispatchId}`).set({ rootId: root, active: true, iqEnabled: false });
  await db.doc(`operationTypes/${operation}`).set({ active: true, name: 'Operación sintética' });
  await db.doc(`clients/${clientId}/costos/${dispatchId}__${operation}`).set({ active: true, assignedCost: 5, pricingMode: 'PERCENT', calculationBaseType: 'TOTAL' });
  await db.doc(`despachos/${dispatchId}/costos/${operation}`).set({ active: true, baseCost: 2, pricingMode: 'PERCENT', calculationBaseType: 'TOTAL' });
  const identified = await identify(), payload = identified.createPayload;
  check(identified.status === 'READY' && payload, 'Server identifies explicit receipt');
  await denied(() => call(createPago, root, { ...payload, montoTotal: 10000 }), 'failed-precondition');
  await denied(() => call(createPago, second, payload), 'permission-denied');
  await db.doc(`operationTypes/${operation}`).update({ active: false });
  await denied(() => call(createPago, root, payload), 'failed-precondition');
  await db.doc(`operationTypes/${operation}`).update({ active: true });
  await db.doc(`users/${root}`).update({ disabled: true });
  await denied(() => call(createPago, root, payload), 'permission-denied');
  await db.doc(`users/${root}`).update({ disabled: false });
  await db.doc(`clients/${clientId}/costos/${dispatchId}__${operation}`).update({ active: false });
  await denied(() => call(createPago, root, payload), 'failed-precondition');
  await db.doc(`clients/${clientId}/costos/${dispatchId}__${operation}`).update({ active: true });
  check((await db.collection('pagos').where('rootId', '==', root).get()).empty, 'All rejected attempts leave zero payments');
  const results = await Promise.allSettled([call(createPago, root, payload), call(createPago, root, payload)]);
  check(results.filter(result => result.status === 'fulfilled').length === 1 && results.some(result => result.status === 'rejected' && result.reason.code === 'already-exists'), 'Concurrent create has one winner and one explicit duplicate');
  const result = results.find(result => result.status === 'fulfilled').value;
  const pago = await db.doc(`pagos/${result.pagoId}`).get(), idRef = db.doc(`pagoReceiptIdentifications/${identified.id}`);
  check(result.folio === 'P1C7U3E5', 'Canonical sequence and client owner preserved');
  check(pago.get('montoTotal') === 1000.5 && pago.get('concepto') === payload.concepto && pago.get('registrationSource') === 'RECEIPT_AUTOMATIC', 'Receipt source and money preserved');
  check(pago.get('financialAssignmentSnapshot.clientCost.rate') === 5 && pago.get('financialAssignmentSnapshot.despachoCost.rate') === 2, 'Current financial costs captured by canonical create');
  check((await idRef.get()).get('pagoId') === result.pagoId && (await idRef.get()).get('stage') === 'REGISTERED_AWAITING_RECEIPT', 'Payment and receipt claim commit atomically');
  const secondIdentity = await identify(second);
  await denied(() => call(createPago, second, secondIdentity.createPayload), 'already-exists');
  const upload = await docs.initPagoDocumentUploadCore({ auth: { uid: root }, data: { pagoId: result.pagoId, documentType: 'COMPROBANTE_PAGO', originalName: 'synthetic.txt', contentType: 'text/plain', sizeBytes: bytes.length, sha256: sha } });
  await bucket.file(upload.storagePath).save(bytes);
  await docs.finalizePagoDocumentUploadCore({ auth: { uid: root }, data: upload });
  check((await idRef.get()).get('stage') === 'RECEIPT_READY', 'Actual source bytes finalize same canonical payment');
  check((await db.collection('pagos').where('rootId', '==', root).get()).size === 1, 'Replay and cross-actor duplicate create no second payment');
  const activities = await db.collection(activityCollectionForSystem('PAY0')).where('rootId', '==', root).get();
  check(activities.docs.filter(doc => doc.get('event') === 'PAGO_CREADO').length === 1, 'One creation audit event');
  check((await db.collection('pagoAplicaciones').where('rootId', '==', root).get()).empty, 'Registration alone cannot apply unreconciled money');
  console.log(JSON.stringify({ test: 'receipt-canonical-create', checks, result: 'PASS', externalActions: 0 }));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await db.terminate(); await admin.app().delete(); });
