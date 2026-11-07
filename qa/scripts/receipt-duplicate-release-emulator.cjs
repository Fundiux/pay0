const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const projectId = process.env.GCLOUD_PROJECT || '';
if (!projectId.startsWith('demo-') || !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('LOCAL_DEMO_EMULATORS_REQUIRED');
const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId });
const db = admin.firestore();
const { createPago, changePagoStatus } = require('../../functions/lib/index');
const { identifyParsedReceipt, releaseReceiptForTerminalPago } = require('../../functions/lib/modules/pagos/receiptIdentification');
const { parseReceiptText } = require('../../functions/lib/modules/pagos/receiptPdfCallables');
const { buildSemanticReceipt } = require('../../functions/lib/modules/pagos/receiptSemantics');
const root = `receipt-release-${Date.now()}`, dispatchId = `${root}-dispatch`, operation = `${root}-OP`.toUpperCase(), companyId = `${root}-company`;
const clients = { X: { id: `${root}-cx`, name: 'Cliente Prueba', rfc: 'ABC010101AB1', number: 7 }, Y: { id: `${root}-cy`, name: 'Cliente Otro', rfc: 'GHI030303EF3', number: 8 } };
let checks = 0;
const check = (condition, label) => { assert.ok(condition, label); checks++; };
const call = (fn, data) => fn.run({ auth: { uid: root, token: {} }, data });
const body = ({ who, clave, ref = 'REF-7788', note = '' }) => ['Transferencia SPEI MXN', 'Estado: Aplicada', `Ordenante: ${clients[who].name}`, `RFC ordenante: ${clients[who].rfc}`,
  'Beneficiario: Empresa Prueba', 'RFC beneficiario: DEF020202CD2', 'Monto: $1,000.50', 'Fecha: 2026-09-27', `Referencia: ${ref}`, ...(clave ? [`Clave de rastreo: ${clave}`] : []), note].filter(Boolean).join('\n');
async function identify(text) {
  const analysisId = createHash('sha256').update(`${root}-${text}`).digest('hex');
  await db.doc(`pagoReceiptAnalyses/${analysisId}`).set({ rootId: root, correctionVersionsByActor: { [root]: 0 } });
  const identified = await identifyParsedReceipt({ db, actor: { uid: root, role: 'superadmin', rootId: root }, receipt: parseReceiptText(text), semanticReceipt: buildSemanticReceipt(text, parseReceiptText(text)), contentSha256: createHash('sha256').update(text).digest('hex'), operationTypeKey: operation, analysisId });
  return identified;
}
const register = async text => { const identified = await identify(text); check(identified.status === 'READY' && identified.createPayload, `identified READY: ${identified.status} ${JSON.stringify(identified.reasons || identified.reviewReasons || '')}`); return call(createPago, identified.createPayload); };
const blocked = async text => { const identified = await identify(text); if (!identified.createPayload) { check(identified.status === 'REGISTERED' || identified.pagoId, `identical file is stopped at identification: ${identified.status}`); return { details: { pagoId: identified.pagoId || null } }; } try { await call(createPago, identified.createPayload); } catch (error) { check(error.code === 'already-exists', 'blocked with already-exists'); return error; } assert.fail('expected a duplicate block'); };
async function main() {
  await db.doc(`users/${root}`).set({ rootId: root, role: 'superadmin', active: true, userNumber: 3 });
  for (const c of Object.values(clients)) {
    await db.doc(`clients/${c.id}`).set({ rootId: root, active: true, createdBy: root, adminId: root, clientNumber: c.number, razonSocial: c.name, rfc: c.rfc });
    await db.doc(`clients/${c.id}/costos/${dispatchId}__${operation}`).set({ active: true, assignedCost: 5, pricingMode: 'PERCENT', calculationBaseType: 'TOTAL' });
  }
  await db.doc(`companies/${companyId}`).set({ rootId: root, active: true, companyNumber: 5, razonSocial: 'Empresa Prueba', rfc: 'DEF020202CD2', despachoId: dispatchId });
  await db.doc(`despachos/${dispatchId}`).set({ rootId: root, active: true, iqEnabled: false });
  await db.doc(`operationTypes/${operation}`).set({ active: true, name: 'Operación sintética' });
  await db.doc(`despachos/${dispatchId}/costos/${operation}`).set({ active: true, baseCost: 2, pricingMode: 'PERCENT', calculationBaseType: 'TOTAL' });

  // 1. Wrong client, then cancel releases the receipt and it registers to the right client.
  const clave = 'BNET0123456789';
  const first = await register(body({ who: 'X', clave }));
  const screenshot = body({ who: 'Y', clave, note: 'captura de pantalla' });
  const crossBlock = await blocked(screenshot);
  check(crossBlock.details.pagoId === null && crossBlock.details.crossClient === true, 'cross-client clave block hides the first pago id');
  const sameFile = await blocked(body({ who: 'X', clave }));
  check(sameFile.details.pagoId === first.pagoId, 'identical file by the same client points at its own pago');
  await call(changePagoStatus, { pagoId: first.pagoId, newStatus: 'CANCELADO', conciliationNote: 'cliente equivocado' });
  check((await db.doc(`pagos/${first.pagoId}`).get()).get('status') === 'CANCELADO', 'first pago cancelled');
  const second = await register(screenshot);
  check(second.pagoId !== first.pagoId, 'after cancel the receipt registers to the right client');
  check((await blocked(body({ who: 'X', clave, note: 'otra vez' }))).details.pagoId === null, 'new registration blocks a further resend while active');

  // 2. Soft match (no clave on either receipt): warns and registers, same client and cross-client.
  const softA = await register(body({ who: 'X', ref: 'SOFT-4455' }));
  check(!softA.duplicateWarning, 'first no-clave receipt has no warning');
  const softSame = await register(body({ who: 'X', ref: 'SOFT-4455', note: 'copia mismo cliente' }));
  check(typeof softSame.duplicateWarning === 'string' && softSame.duplicateWarning.includes(softA.pagoId), 'same-client soft match warns and names the earlier pago');
  const warnedPago = await db.doc(`pagos/${softSame.pagoId}`).get();
  check(warnedPago.get('receiptDuplicateWarning') === softSame.duplicateWarning, 'warning is stored on the pago');
  const softCross = await register(body({ who: 'Y', ref: 'SOFT-4455', note: 'copia otro cliente' }));
  check(typeof softCross.duplicateWarning === 'string' && !softCross.duplicateWarning.includes(softA.pagoId), 'cross-client soft match warns without revealing the pago id');

  // 3. Cancelling a warned pago leaves the first pago's claims intact.
  const keysBefore = (await db.collection('pagoReceiptDedup').where('pagoId', '==', softA.pagoId).get()).size;
  check(keysBefore >= 1, 'first soft pago owns its claims');
  await call(changePagoStatus, { pagoId: softSame.pagoId, newStatus: 'CANCELADO', conciliationNote: 'copia' });
  await call(changePagoStatus, { pagoId: softCross.pagoId, newStatus: 'CANCELADO', conciliationNote: 'copia' });
  check((await db.collection('pagoReceiptDedup').where('pagoId', '==', softA.pagoId).get()).size === keysBefore, 'cancelling warned pagos keeps the first pago claims');

  // 4. The same release hook the IQ terminal paths call.
  const third = await register(body({ who: 'X', clave: 'BNET9999999999', ref: 'IQ-3344' }));
  assert.ok(third.pagoId);
  await db.doc(`pagos/${third.pagoId}`).set({ status: 'RECHAZADO' }, { merge: true });
  await releaseReceiptForTerminalPago(db, root, third.pagoId, 'IQ_RECONCILE');
  check((await db.collection('pagoReceiptDedup').where('pagoId', '==', third.pagoId).get()).empty, 'IQ-style terminal release frees every claim');
  const retried = await register(body({ who: 'Y', clave: 'BNET9999999999', ref: 'IQ-3344', note: 'reenviado a otro cliente' }));
  check(retried.pagoId && retried.pagoId !== third.pagoId, 'after an IQ rejection the receipt registers to the right client');
  console.log(JSON.stringify({ test: 'receipt-duplicate-release', checks, result: 'PASS', externalActions: 0 }));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await db.terminate(); await admin.app().delete(); });
