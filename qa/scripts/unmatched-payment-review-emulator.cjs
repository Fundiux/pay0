const assert = require('node:assert/strict');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || !String(process.env.GCLOUD_PROJECT || '').startsWith('demo-')) throw Error('LOCAL_EMULATOR_REQUIRED');
const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({projectId: process.env.GCLOUD_PROJECT});
const db = admin.firestore();
global.fetch = async () => { throw Error('EXTERNAL_NETWORK_FORBIDDEN'); };
const domain = require('../../functions/lib/modules/paymentApplications/unmatchedPaymentDomain');
const review = require('../../functions/lib/modules/paymentApplications/unmatchedPaymentReview');
let checks = 0;
function check(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++; }
const rejects = async (promise, code, label) => { try { await promise; } catch (error) { check(error.code, code, label); return; } assert.fail(`${label}: expected ${code}`); };
const run = (fn, uid, data) => fn.run({auth: {uid, token: {}}, data, rawRequest: {}});
const rootId = `unmatched-${Date.now()}`, otherRoot = `${rootId}-other`, adminUid = `${rootId}-admin`, otherAdminUid = `${rootId}-admin2`, operadorUid = `${rootId}-op`;
const pagoModules = {pagos: {view: true, create: true, conciliate: true}};
const pending = {rootId, clienteId: 'c1', companyId: 'e1', status: 'PROCESANDO', monto: 500, totalAbonado: 0, facturaUuid: '11111111-1111-4111-8111-111111111111'};
const pagoBase = {rootId, adminId: adminUid, clienteId: 'c1', companyId: 'e1', moneda: 'MXN', montoTotal: 300, montoDisponibleSolicitudes: 300, status: 'CONCILIADO', folio: 'P1C1U1E1', paymentDateTimeLocal: '2026-11-05T10:00:00'};

(async () => {
  // Pure classification.
  const classify = (solicitudes, extra = {}) => domain.classifyUnmatchedPayment({pago: pagoBase, reason: 'MISSING_INVOICE_REFERENCE', solicitudes, limitReached: false, ...extra});
  check(classify([]).case, 'A', 'no solicitudes at all is case A');
  check(classify([pending]).case, 'B', 'a pending invoice makes it case B');
  check(classify([{...pending, status: 'CANCELADA'}, {...pending, totalAbonado: 500}]).case, 'A', 'closed or fully paid solicitudes are not pending');
  check(classify([{...pending, clienteId: 'other'}, {...pending, rootId: 'other'}, {...pending, companyId: 'other'}]).case, 'A', 'other client, root or company never counts');
  check(classify([{...pending, facturaUuid: ''}]).case, 'B', 'an open solicitud without an invoice counts as pending');
  check(classify([], {limitReached: true}).case, 'B', 'a client above the read limit is never case A');
  check(classify([pending], {reason: 'NO_EXACT_INVOICE_REFERENCE'}).case, 'B', 'a reference that points nowhere is also unmatched');
  check(classify([], {reason: 'CURRENCY_MISMATCH'}).case, null, 'other review reasons are not unmatched');
  check(classify([pending]).pendingCount, 1, 'pending count');
  const message = review.buildUnmatchedPaymentMessage('A', {cliente: 'ACME SA', monto: 1234.5, moneda: 'MXN', fecha: '2026-11-05', folio: 'P1'});
  check(message.includes('Estos pagos no cuentan con solicitud aún.') && message.includes('ACME SA') && message.includes('P1'), true, 'message names client, amount, date and folio');
  check(/\b(iban|clabe|rfc|token|swift)\b|cuenta (bancaria|clabe)/i.test(message), false, 'message carries no sensitive data');

  // Fixtures.
  await db.doc(`users/${rootId}`).set({rootId, role: 'superadmin', active: true, name: 'Dueña'});
  await db.doc(`users/${adminUid}`).set({rootId, role: 'admin', active: true, name: 'Admin', modules: pagoModules});
  await db.doc(`users/${otherAdminUid}`).set({rootId, role: 'admin', active: true, name: 'Otro admin', modules: pagoModules});
  await db.doc(`users/${operadorUid}`).set({rootId, role: 'operador', active: true, name: 'Operador', modules: pagoModules});
  await db.doc(`users/${otherRoot}`).set({rootId: otherRoot, role: 'superadmin', active: true, name: 'Otra raíz'});
  await db.doc('clients/c1').set({rootId, razonSocial: 'ACME SA'});
  await db.doc('unmatchedPaymentReviewConfig/global').set({activatedAt: admin.firestore.Timestamp.fromMillis(Date.now() - 3600_000)});
  const newPago = (id, extra = {}) => db.doc(`pagos/${id}`).set({...pagoBase, createdAt: admin.firestore.Timestamp.now(), ...extra});

  // Persisting the classification.
  await newPago('pa');
  await review.syncUnmatchedReview('pa', 'MISSING_INVOICE_REFERENCE');
  check((await db.doc('pagos/pa').get()).get('unmatchedReview.case'), 'A', 'client without pending invoices is recorded as A');
  await db.doc('solicitudes/s1').set(pending);
  await review.syncUnmatchedReview('pa', 'MISSING_INVOICE_REFERENCE');
  check((await db.doc('pagos/pa').get()).get('unmatchedReview.case'), 'B', 'a pending invoice later reclassifies it as B');
  await review.syncUnmatchedReview('pa', 'CURRENCY_MISMATCH');
  check((await db.doc('pagos/pa').get()).get('unmatchedReview.open'), false, 'a different review reason closes it');
  await newPago('old', {createdAt: admin.firestore.Timestamp.fromMillis(Date.now() - 7200_000)});
  await review.syncUnmatchedReview('old', 'MISSING_INVOICE_REFERENCE');
  check((await db.doc('pagos/old').get()).get('unmatchedReview'), undefined, 'a pago created before activation is never classified');

  // Alerts: once per pago+case, never for exact matches, never twice.
  const sent = [];
  const alerting = {send: async (pagoId, pago, kind) => { sent.push([pagoId, kind]); }};
  const open = (kind) => ({...pagoBase, unmatchedReview: {open: true, case: kind}});
  check(await review.handleUnmatchedPaymentWrite('pe', undefined, {...pagoBase, status: 'APLICADO_TOTAL', montoDisponibleSolicitudes: 0}, alerting.send), 'IGNORED', 'an exactly matched pago has no review and no alert');
  check(await review.handleUnmatchedPaymentWrite('pe', {...pagoBase}, open('A'), alerting.send), 'ALERTED', 'entering the list alerts');
  check(await review.handleUnmatchedPaymentWrite('pe', open('A'), {...open('A'), notes: 1}, alerting.send), 'IGNORED', 'a re-fired write of the same case does not alert');
  check(await review.handleUnmatchedPaymentWrite('pe', open('A'), open('B'), alerting.send), 'ALERTED', 'a new case alerts once');
  check(sent.length, 2, 'two alerts in total');
  await newPago('pc', {unmatchedReview: {open: true, case: 'A'}});
  check(await review.handleUnmatchedPaymentWrite('pc', open('A'), {...open('A'), status: 'APLICADO_TOTAL', montoDisponibleSolicitudes: 0}, alerting.send), 'CLOSED', 'a fully applied pago leaves the list');
  check((await db.doc('pagos/pc').get()).get('unmatchedReview.open'), false, 'the review is closed in the document');

  // Alert delivery markers: recipients are canonical superadmins and a repeat sends nothing.
  await db.doc('telegramUsers/t1').set({role: 'superadmin', active: true, uid: rootId, chatId: '111'});
  await db.doc('telegramUsers/t2').set({role: 'superadmin', active: true, uid: adminUid, chatId: '222'});
  const delivered = [];
  const deliver = async (chatId, text) => { delivered.push([chatId, text]); };
  await review.sendUnmatchedAlert('pd', {...pagoBase, montoTotal: 300}, 'A', deliver);
  check(delivered.map(row => row[0]), ['111'], 'only canonical active superadmins receive it');
  await review.sendUnmatchedAlert('pd', {...pagoBase, montoTotal: 300}, 'A', deliver);
  check(delivered.length, 1, 'a retry never resends the same pago and case');
  await review.sendUnmatchedAlert('pd', {...pagoBase, montoTotal: 300}, 'B', deliver);
  check(delivered.length, 2, 'the other case is a separate alert');

  // Counts for the daily alert.
  await newPago('pcount-a', {unmatchedReview: {open: true, case: 'A'}});
  await newPago('pcount-b', {unmatchedReview: {open: true, case: 'B'}});
  await newPago('pcount-closed', {unmatchedReview: {open: false, case: 'A'}});
  const counts = await review.countOpenUnmatchedPayments(rootId);
  check(counts.a >= 1 && counts.b >= 1, true, 'open pagos are counted by case');
  check((await review.countOpenUnmatchedPayments(otherRoot)), {a: 0, b: 0}, 'counts are scoped to the root');

  // Decisions: authorization, idempotency, history.
  await newPago('pd2', {unmatchedReview: {open: true, case: 'A', classifiedAt: admin.firestore.Timestamp.now()}});
  const decide = (uid, data) => run(review.decidePagoSinSolicitud, uid, data);
  const base = {pagoId: 'pd2', option: 'ESPERAR_FACTURA', note: 'anticipo', requestId: 'request-0001'};
  await rejects(decide(undefined, base), 'unauthenticated', 'anonymous caller is rejected');
  await rejects(decide(operadorUid, base), 'permission-denied', 'an operador cannot decide');
  await rejects(decide(otherRoot, base), 'permission-denied', 'another root cannot decide');
  await rejects(decide(adminUid, base), 'permission-denied', 'an admin cannot decide: the role policy gives admin no pagos.conciliate, and a user permission never raises the role ceiling');
  await rejects(decide(rootId, {...base, option: 'INVENTADA'}), 'invalid-argument', 'unknown option');
  await rejects(decide(rootId, {...base, note: 'x'.repeat(501)}), 'invalid-argument', 'note too long');
  const first = await decide(rootId, base);
  check(first.reused, false, 'the superadmin decides');
  const decision = (await db.doc(`pagoSinSolicitudDecisions/${first.decisionId}`).get()).data();
  check([decision.option, decision.note, decision.decidedBy, decision.snapshot.clienteNombre, decision.snapshot.monto, decision.snapshot.folio], ['ESPERAR_FACTURA', 'anticipo', rootId, 'ACME SA', 300, 'P1C1U1E1'], 'who, option, note and snapshot are recorded');
  check((await decide(rootId, base)).reused, true, 'the same request is idempotent');
  await rejects(decide(rootId, {...base, option: 'DEVOLVER'}), 'already-exists', 'the same request id with other data is refused');
  check((await db.collection('pagoSinSolicitudDecisions').where('pagoId', '==', 'pd2').get()).size, 1, 'a retry created no second row');
  const second = await decide(rootId, {...base, option: 'FACTURAR_PUE', requestId: 'request-0002'});
  check((await db.doc('pagos/pd2').get()).get('unmatchedReview.latestDecision.option'), 'FACTURAR_PUE', 'a new row becomes the latest decision');
  check((await db.collection('pagoSinSolicitudDecisions').where('pagoId', '==', 'pd2').get()).size, 2, 'earlier decisions stay as history');
  check((await db.doc('pagos/pd2').get()).get('montoDisponibleSolicitudes'), 300, 'a decision moves no money');
  check((await db.collection('pay0ActivityLog').where('event', '==', 'PAGO_SIN_SOLICITUD_DECISION').where('referenceId', '==', 'pd2').get()).size >= 2, true, 'every decision writes an audit event');
  await rejects(decide(rootId, {...base, pagoId: 'pa', requestId: 'request-0003'}), 'failed-precondition', 'a pago that left the list cannot be decided');

  // The list.
  const list = (uid) => run(review.listPagosSinSolicitud, uid, {});
  const asRoot = await list(rootId);
  check(asRoot.rows.some(row => row.pagoId === 'pd2' && row.clienteNombre === 'ACME SA' && row.latestDecision.option === 'FACTURAR_PUE'), true, 'the superadmin sees the pago with its latest decision');
  await rejects(list(adminUid), 'permission-denied', 'an admin cannot list while the role policy gives admin no pagos.conciliate');
  check((await list(otherRoot)).rows.length, 0, 'another root sees none');
  await rejects(list(operadorUid), 'permission-denied', 'an operador cannot list');
  console.log('UNMATCHED PAYMENT REVIEW OK', checks);
})().catch(error => { console.error(error); process.exit(1); });
