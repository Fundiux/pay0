const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const projectId = process.env.GCLOUD_PROJECT || '';
if (!projectId.startsWith('demo-')) throw Error('Demo project required');
for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST'])
  if (!/^127\.0\.0\.1:\d+$/.test(process.env[key] || '')) throw Error(`Local ${key} required`);
for (const protocol of ['http', 'https']) {
  const api = require(`node:${protocol}`), original = api.request;
  api.request = function (url, ...args) {
    const host = typeof url === 'string' || url instanceof URL ? new URL(url).hostname : String(url.hostname || url.host || '').split(':')[0];
    assert.ok(['127.0.0.1', 'localhost'].includes(host), 'External transport forbidden');
    return original.call(this, url, ...args);
  };
}
const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` });
const db = admin.firestore(), bucket = admin.storage().bucket();
const { identifyParsedReceipt, assertReceiptCreation, receiptRegisteredPatch } = require('../../functions/lib/modules/pagos/receiptIdentification.js');
const { parseReceiptText, parsePagoReceiptPdf } = require('../../functions/lib/modules/pagos/receiptPdfCallables.js');
const { receiptRegistrationReasons, matchReceiptIdentity } = require('../../functions/lib/modules/pagos/receiptIdentificationDomain.js');
const { initializeTestEnvironment, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc } = require('firebase/firestore');
const docs = require('../../functions/lib/modules/pagoDocuments/service.js');
const ts = require('typescript');
const ui = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/receiptAutomaticRegistration.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: ui.exports });
const { automaticReceiptPayload, automaticReceiptMissing } = ui.exports;
const reviewUi = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/automaticPaymentReview.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: reviewUi.exports });
const prefix = `receipt-${Date.now()}`, root = `${prefix}-root`, foreignRoot = `${prefix}-foreign`;
const actors = ['superadmin', 'admin', 'operador'].map(role => ({ uid: `${prefix}-${role}`, role, rootId: root }));
const clientId = `${prefix}-client`, companyId = `${prefix}-company`, dispatchId = `${prefix}-dispatch`, operation = `${prefix}-OP`.toUpperCase();
const body = ['Transferencia SPEI MXN', 'Estado: Aplicada', 'Ordenante: Cliente Prueba', 'RFC ordenante: ABC010101AB1',
  'Beneficiario: Empresa Prueba', 'RFC beneficiario: DEF020202CD2', 'Monto: $1,000.50', 'Fecha: 2026-09-27',
  'Referencia: 0123-abc-456', 'Concepto: factura 123e4567-e89b-12d3-a456-426614174000'].join('\n');
const bytes = Buffer.from(body), sha = createHash('sha256').update(bytes).digest('hex');
let checks = 0, env;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
const denied = async (fn, message) => { await assert.rejects(fn, undefined, message); checks++; };
async function identify(overrides = {}, actor = actors[0], contentSha256 = sha) {
  return identifyParsedReceipt({ db, actor, receipt: { ...parseReceiptText(body), ...overrides }, contentSha256, operationTypeKey: operation });
}
async function main() {
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  env = await initializeTestEnvironment({ projectId, firestore: { host, port: Number(port), rules: fs.readFileSync('firestore.rules', 'utf8') } });
  for (const actor of actors) await db.doc(`users/${actor.uid}`).set({ rootId: root, role: actor.role, active: true, modules: { pagos: { create: true } } });
  await db.doc(`clients/${clientId}`).set({ rootId: root, active: true, razonSocial: 'Cliente Prueba', rfc: 'ABC010101AB1', adminId: actors[1].uid, operadorId: actors[2].uid });
  await db.doc(`companies/${companyId}`).set({ rootId: root, active: true, razonSocial: 'Empresa Prueba', rfc: 'DEF020202CD2', despachoId: dispatchId });
  await db.doc(`despachos/${dispatchId}`).set({ rootId: root, active: true, iqEnabled: false });
  await db.doc(`operationTypes/${operation}`).set({ active: true, name: 'Operación sintética' });
  for (const actor of actors.slice(1)) await db.doc(`userCompanyAccess/${actor.uid}/companies/${companyId}`).set({ active: true });
  const parsed = parseReceiptText(body);
  check(parsed.payerRfc === 'ABC010101AB1' && parsed.beneficiaryRfc === 'DEF020202CD2', 'Multiline party RFCs never collapse');
  check(parsed.reference === '0123-abc-456' && parsed.concept.endsWith('123e4567-e89b-12d3-a456-426614174000'), 'Exact reference and concept preserved');
  check(parsed.amount === 1000.5 && receiptRegistrationReasons(parsed, operation).length === 0, 'Confirmed explicit receipt eligible');
  for (const [replace, expected] of [['$1,000', 1000], ['$1.000,50', 1000.5], ['$1,000.50', 1000.5], ['$100', 100]])
    check(parseReceiptText(body.replace('$1,000.50', replace)).amount === expected, 'Thousand and decimal formats retain magnitude');
  for (const [text, reason] of [
    [body.replace('Monto: $1,000.50', 'Saldo disponible: $9,999.00'), 'AMOUNT_REQUIRES_REVIEW'],
    [body.replace('Monto: $1,000.50', 'Monto: $100\nMonto: $200'), 'AMOUNT_REQUIRES_REVIEW'],
    [body.replace('Estado: Aplicada', 'Estado: Pendiente de autorización'), 'EXECUTION_REQUIRES_REVIEW'],
    [body.replace('Estado: Aplicada', 'Estado: Programada'), 'EXECUTION_REQUIRES_REVIEW'],
    [body.replace('Estado: Aplicada', ''), 'EXECUTION_REQUIRES_REVIEW'],
    [body.replace('Estado: Aplicada', 'Estado: No aplicada'), 'EXECUTION_REQUIRES_REVIEW'],
    [body + '\nResultado: No efectuada', 'EXECUTION_REQUIRES_REVIEW'],
    [body + '\nResultado: No completada', 'EXECUTION_REQUIRES_REVIEW'],
    [body + '\nResultado: No liquidada', 'EXECUTION_REQUIRES_REVIEW'],
    [body + '\nResultado: Desconocido', 'EXECUTION_REQUIRES_REVIEW'],
    [body.replace('$1,000.50', '$1,00.50'), 'AMOUNT_REQUIRES_REVIEW'],
    [body.replace('2026-09-27', '04/05/2026'), 'DATE_REQUIRES_REVIEW'],
    [body.replace('2026-09-27', '2026-02-31'), 'MISSING_DATE'],
    [body.replace('SPEI MXN', 'SPEI USD MXN'), 'UNSUPPORTED_CURRENCY'],
    [body + '\nRFC ordenante: GHI030303EF3', 'CONFLICTING_RFC'],
  ]) check(receiptRegistrationReasons(parseReceiptText(text), operation).includes(reason), reason);
  for (const actor of actors) {
    const result = await identify({}, actor);
    check(result.status === 'READY' && result.createPayload.clienteId === clientId && result.createPayload.companyId === companyId, `${actor.role} exact authorized identity`);
  }
  for (const [overrides, reason] of [
    [{ payerRfc: '', account: '****1234' }, 'CLIENT_INSUFFICIENT_IDENTITY_SIGNALS'],
    [{ senderName: 'Cliente Parecido', payerRfc: 'ABC010101AB1' }, 'CLIENT_IDENTITY_NOT_CORROBORATED'],
    [{ beneficiaryName: 'Empresa Parecida', beneficiaryRfc: '' }, 'COMPANY_INSUFFICIENT_IDENTITY_SIGNALS'],
    [{ executionConfirmed: false }, 'EXECUTION_REQUIRES_REVIEW'],
  ]) check((await identify(overrides)).reasons.includes(reason), reason);
  await db.doc(`clients/${clientId}-duplicate`).set({ rootId: root, active: true, razonSocial: 'Cliente Prueba', rfc: 'ABC010101AB1' });
  check((await identify()).reasons.includes('CLIENT_MULTIPLE_CANDIDATES'), 'Duplicate catalog identity never auto selects');
  await db.doc(`clients/${clientId}-duplicate`).delete();
  await db.doc(`clients/${clientId}`).update({ active: false });
  check((await identify()).status === 'REQUIRES_REVIEW', 'Inactive client excluded');
  await db.doc(`clients/${clientId}`).update({ active: true });
  await db.doc(`userCompanyAccess/${actors[1].uid}/companies/${companyId}`).update({ active: false });
  check((await identify({}, actors[1])).reasons.includes('COMPANY_ACCESS_REQUIRES_REVIEW'), 'Revoked company access reviewed');
  await db.doc(`userCompanyAccess/${actors[1].uid}/companies/${companyId}`).update({ active: true });
  check((await identify({}, { ...actors[0], rootId: foreignRoot })).status === 'REQUIRES_REVIEW', 'Foreign root cannot match local identities');
  await denied(() => parsePagoReceiptPdf.run({ data: {} }), 'Anonymous parser rejected');
  await db.doc(`users/${prefix}-inactive`).set({ rootId: root, role: 'admin', active: false });
  await denied(() => parsePagoReceiptPdf.run({ auth: { uid: `${prefix}-inactive` }, data: {} }), 'Inactive parser rejected before bytes/OCR');
  const ready = await identify();
  for (const actor of actors) {
    const clientDb = env.authenticatedContext(actor.uid).firestore();
    await assertFails(getDoc(doc(clientDb, 'pagoReceiptIdentifications', ready.id))); checks++;
    await assertFails(setDoc(doc(clientDb, 'pagoReceiptIdentifications', ready.id), { status: 'READY' })); checks++;
  }
  const conflicted = matchReceiptIdentity([{ id: 'one', rfc: 'ABC010101AB1', cuenta: '1234567890', name: 'Cliente Prueba' },
    { id: 'two', rfc: 'GHI030303EF3', cuenta: '9876543210', name: 'Cliente Prueba' }],
    { name: 'Cliente Prueba', rfc: 'ABC010101AB1', account: '9876543210' });
  check(conflicted.reasons.includes('CONFLICTING_SIGNALS'), 'RFC and full account pointing to different identities rejected');
  check(automaticReceiptPayload(ready, operation) === ready.createPayload, 'UI uses actual server proposal');
  check(!automaticReceiptPayload(ready, 'OTHER'), 'Changed operation needs server revalidation');
  check(!automaticReceiptPayload({ ...ready, status: 'REQUIRES_REVIEW' }, operation), 'Review cannot register');
  check(!automaticReceiptPayload({ ...ready, id: 'forged' }, operation), 'Malformed identification cannot register');
  check(automaticReceiptMissing({ ...ready, status: 'REQUIRES_REVIEW', reasons: ['AMOUNT_REQUIRES_REVIEW'], createPayload: null }, operation)[0].includes('importe'), 'Visible Spanish reason');
  check(reviewUi.exports.automaticPaymentReviewMessage({ status: 'REQUIRES_REVIEW', reason: 'AMOUNT_EXCEEDS_INVOICE' }).includes('saldo'), 'Automatic application exposes a human reason');
  check(!reviewUi.exports.automaticPaymentReviewMessage({ status: 'APPLIED' }), 'Completed application has no review badge');
  check(!reviewUi.exports.automaticPaymentReviewMessage({ status: 'REQUIRES_REVIEW', reason: 'internal-private-id' }).includes('internal-private-id'), 'Unknown internal identifiers never reach the badge');
  const idRef = db.doc(`pagoReceiptIdentifications/${ready.id}`), snap = await idRef.get();
  for (const field of ['clienteId', 'companyId', 'despachoId', 'operationTypeKey', 'concepto', 'referencia', 'paymentForm'])
    check(assert.throws(() => assertReceiptCreation(snap, actors[0], { ...ready.createPayload, [field]: 'forged' })) === undefined, `Reject ${field} tamper`);
  await denied(async () => assertReceiptCreation(snap, { ...actors[0], rootId: foreignRoot }, ready.createPayload), 'Root mismatch rejected');
  await denied(async () => assertReceiptCreation(snap, actors[1], ready.createPayload), 'Actor mismatch rejected');
  await denied(async () => assertReceiptCreation(snap, actors[0], { ...ready.createPayload, montoTotal: 0.01 }), 'Amount tamper rejected');
  const pagoId = `${prefix}-pago`, pagoRef = db.doc(`pagos/${pagoId}`);
  const register = () => db.runTransaction(async tx => {
    assertReceiptCreation(await tx.get(idRef), actors[0], ready.createPayload);
    tx.set(pagoRef, { ...ready.createPayload, rootId: root, createdBy: actors[0].uid, actorUid: actors[0].uid, status: 'CONCILIACION_PENDIENTE', registrationSource: 'RECEIPT_AUTOMATIC' });
    tx.update(idRef, receiptRegisteredPatch(pagoId));
  });
  const outcomes = await Promise.allSettled([register(), register()]);
  check(outcomes.filter(row => row.status === 'fulfilled').length === 1, 'Concurrent registration consumes identification once');
  const pending = await identify();
  check(pending.status === 'REGISTERED' && pending.receiptPending && pending.pagoId === pagoId, 'Failed upload recoverable for same actor/root/bytes and canonical payment');
  check(!automaticReceiptPayload(pending, operation), 'Registered recovery never creates payment');
  const recoverWithoutOperation = await identifyParsedReceipt({ db, actor: actors[0], receipt: parseReceiptText(body), contentSha256: sha });
  check(recoverWithoutOperation.receiptPending && recoverWithoutOperation.pagoId === pagoId, 'New session recovers existing payment without inventing a new operation type');
  await pagoRef.update({ rootId: foreignRoot });
  check(!(await identify()).receiptPending, 'Recovery rejects changed payment scope');
  await pagoRef.update({ rootId: root });
  const request = data => ({ auth: { uid: actors[0].uid }, data });
  const init = async (payload = bytes) => {
    const upload = await docs.initPagoDocumentUploadCore(request({ pagoId, documentType: 'COMPROBANTE_PAGO', originalName: 'synthetic.txt', contentType: 'text/plain', sizeBytes: payload.length, sha256: sha }));
    await bucket.file(upload.storagePath).save(payload);
    return upload;
  };
  const bad = await init(Buffer.from('different bytes'));
  await denied(() => docs.finalizePagoDocumentUploadCore({ auth: { uid: `${prefix}-inactive` }, data: bad }), 'Inactive user cannot finalize receipt');
  await denied(() => docs.finalizePagoDocumentUploadCore(request(bad)), 'Client hash cannot authorize different actual bytes');
  check((await idRef.get()).get('stage') === 'REGISTERED_AWAITING_RECEIPT', 'Hash failure preserves awaiting stage');
  const first = await init(), second = await init();
  const finalized = await Promise.all([docs.finalizePagoDocumentUploadCore(request(first)), docs.finalizePagoDocumentUploadCore(request(second))]);
  const identification = await idRef.get(), canonicalId = identification.get('receiptUploadId');
  check(identification.get('stage') === 'RECEIPT_READY' && identification.get('receiptSha256') === sha, 'Receipt stage and server hash committed');
  check(finalized.every(row => row.uploadId === canonicalId), 'Concurrent identical uploads converge to single published receipt');
  const canonicalRef = db.doc(`uploads/${canonicalId}`), beforeUpload = await canonicalRef.get(), beforeId = await idRef.get();
  const eventsBefore = await db.collection('activityLog').where('rootId', '==', root).get();
  await docs.finalizePagoDocumentUploadCore(request({ uploadId: canonicalId }));
  check((await canonicalRef.get()).updateTime.isEqual(beforeUpload.updateTime) && (await idRef.get()).updateTime.isEqual(beforeId.updateTime), 'Finalize replay performs no writes');
  check((await db.collection('activityLog').where('rootId', '==', root).get()).size === eventsBefore.size, 'Finalize replay adds no audit log');
  check(!(await identify()).receiptPending, 'Complete receipt not recoverable as pending');
  const active = await db.collection('uploads').where('pagoId', '==', pagoId).where('active', '==', true).get();
  check(active.size === 1 && active.docs[0].get('version') === 1, 'One active receipt and one version after races');
  await idRef.update({ rootId: foreignRoot });
  await denied(() => docs.finalizePagoDocumentUploadCore(request({ uploadId: canonicalId })), 'Identification scope reread inside finalize transaction');
  console.log(JSON.stringify({ test: 'receipt-identification', checks, productionCalls: 0, result: 'PASS' }));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (env) await env.cleanup(); await db.terminate(); await admin.app().delete(); });
