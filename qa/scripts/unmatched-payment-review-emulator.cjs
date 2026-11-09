const assert = require('node:assert/strict');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || !String(process.env.GCLOUD_PROJECT || '').startsWith('demo-')) throw Error('LOCAL_EMULATOR_REQUIRED');
const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({projectId: process.env.GCLOUD_PROJECT});
const db = admin.firestore();
global.fetch = async () => { throw Error('EXTERNAL_NETWORK_FORBIDDEN'); };
const domain = require('../../functions/lib/modules/paymentApplications/unmatchedPaymentDomain');
const review = require('../../functions/lib/modules/paymentApplications/unmatchedPaymentReview');
const pendingLib = require('../../functions/lib/modules/agentOperations/pendingItems');
const recipientsLib = require('../../functions/lib/modules/agentOperations/alertRecipients');
let checks = 0;
function check(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++; }
const rejects = async (promise, code, label) => { try { await promise; } catch (error) { check(error.code, code, label); return; } assert.fail(`${label}: expected ${code}`); };
const run = (fn, uid, data) => fn.run({auth: {uid, token: {}}, data, rawRequest: {}});
const rootId = `unmatched-${Date.now()}`, otherRoot = `${rootId}-other`, adminUid = `${rootId}-admin`, otherAdminUid = `${rootId}-admin2`, operadorUid = `${rootId}-op`, revokedUid = `${rootId}-revoked`;
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
  check(classify([], {reason: 'CANDIDATE_LIMIT'}).case, 'B', 'a client the matcher gave up on is never case A');
  check(classify([pending]).pendingCount, 1, 'pending count');
  // No Telegram: the module neither exports an alert sender nor references the bot or its secret.
  check(['sendUnmatchedAlert', 'buildUnmatchedPaymentMessage'].filter(name => name in review), [], 'the review module exports no alert sender');
  const source = require('fs').readFileSync(require.resolve('../../functions/lib/modules/paymentApplications/unmatchedPaymentReview'), 'utf8');
  check(/telegram|sendTelegramMessage|TELEGRAM_BOT_TOKEN|alertRecipients/i.test(source), false, 'the review module never reaches Telegram nor its secret');

  // Fixtures.
  await db.doc(`users/${rootId}`).set({rootId, role: 'superadmin', active: true, name: 'Dueña'});
  await db.doc(`users/${adminUid}`).set({rootId, role: 'admin', active: true, name: 'Admin', modules: pagoModules});
  await db.doc(`users/${otherAdminUid}`).set({rootId, role: 'admin', active: true, name: 'Otro admin', modules: pagoModules});
  await db.doc(`users/${operadorUid}`).set({rootId, role: 'operador', active: true, name: 'Operador', modules: pagoModules});
  await db.doc(`users/${revokedUid}`).set({rootId, role: 'admin', active: true, name: 'Sin permiso', modules: {pagos: {view: true, create: false}}});
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
  // Without a pre-seeded cutover the first event creates it now, and the pago it is evaluating already exists.
  await db.doc('unmatchedPaymentReviewConfig/global').delete();
  await newPago('recent', {clienteId: 'c2', createdAt: admin.firestore.Timestamp.fromMillis(Date.now() - 5 * 60_000)});
  await newPago('dayold', {clienteId: 'c2', createdAt: admin.firestore.Timestamp.fromMillis(Date.now() - 24 * 3600_000)});
  await review.syncUnmatchedReview('recent', 'MISSING_INVOICE_REFERENCE');
  check((await db.doc('pagos/recent').get()).get('unmatchedReview.case'), 'A', 'the first pago after deploy is classified even though its event creates the cutover');
  check((await db.doc('unmatchedPaymentReviewConfig/global').get()).exists, true, 'the first event created the cutover');
  await review.syncUnmatchedReview('dayold', 'MISSING_INVOICE_REFERENCE');
  check((await db.doc('pagos/dayold').get()).get('unmatchedReview'), undefined, 'a pago a day older than the first event is never classified');
  await db.doc('unmatchedPaymentReviewConfig/global').set({activatedAt: admin.firestore.Timestamp.fromMillis(Date.now() - 3600_000)});

  // Closing: a pago that enters or changes list is never notified; only full application closes it.
  const open = (kind) => ({...pagoBase, unmatchedReview: {open: true, case: kind}});
  check(await review.handleUnmatchedPaymentWrite('pe', {...pagoBase, status: 'APLICADO_TOTAL', montoDisponibleSolicitudes: 0}), 'IGNORED', 'an exactly matched pago has no review');
  check(await review.handleUnmatchedPaymentWrite('pe', open('A')), 'IGNORED', 'entering the list changes nothing and sends nothing');
  check(await review.handleUnmatchedPaymentWrite('pe', open('B')), 'IGNORED', 'a new case sends nothing either');
  check((await db.collection('pagoSinSolicitudAlerts').limit(1).get()).size, 0, 'no alert marker is ever written');
  await newPago('pc', {unmatchedReview: {open: true, case: 'A'}});
  check(await review.handleUnmatchedPaymentWrite('pc', {...open('A'), status: 'APLICADO_TOTAL', montoDisponibleSolicitudes: 0}), 'CLOSED', 'a fully applied pago leaves the list');
  check((await db.doc('pagos/pc').get()).get('unmatchedReview.open'), false, 'the review is closed in the document');
  await newPago('pg', {unmatchedReview: {open: true, case: 'B'}});
  check(await review.handleUnmatchedPaymentWrite('pg', {...open('B'), montoDisponibleSolicitudes: 0}), 'CLOSED', 'a pago with nothing available also leaves the list');

  // Recipients of the daily summary.
  await db.doc('telegramUsers/t1').set({role: 'superadmin', active: true, uid: rootId, chatId: '111'});
  await db.doc('telegramUsers/t2').set({role: 'superadmin', active: true, uid: adminUid, chatId: '222'});

  // Recipients ignore the role copied into the link: the root owner and canonical superadmins receive it.
  const rootB = `${rootId}-b`;
  await db.doc(`users/${rootB}`).set({rootId: rootB, role: 'superadmin', active: true, name: 'Dueno B'});
  await db.doc(`users/${rootB}-sa`).set({rootId: rootB, role: 'superadmin', active: true, name: 'SA B'});
  await db.doc(`users/${rootB}-op`).set({rootId: rootB, role: 'operador', active: true, name: 'Op B'});
  await db.doc('telegramUsers/b1').set({uid: rootB, active: true, chatId: '900', role: ''});
  await db.doc('telegramUsers/b2').set({uid: rootB, active: false, chatId: '901', role: 'superadmin'});
  await db.doc('telegramUsers/b3').set({uid: rootB, active: true, chatId: '900', role: 'superadmin'});
  await db.doc('telegramUsers/b4').set({uid: `${rootB}-sa`, active: true, chatId: '903', role: 'operador'});
  await db.doc('telegramUsers/b5').set({uid: `${rootB}-op`, active: true, chatId: '904', role: 'superadmin'});
  await db.doc('telegramUsers/b6').set({uid: otherRoot, active: true, chatId: '905'});
  await db.doc('telegramUsers/b7').set({uid: `${rootB}-ghost`, active: true, chatId: '906', role: 'superadmin'});
  const recipients = await recipientsLib.loadSuperadminAlertRecipients();
  check(recipients.get(rootB).map(row => row.chatId).sort(), ['900', '903'], 'a root owner link with an empty role and a canonical superadmin with a stale link role receive it, once per chat');
  check(recipients.get(otherRoot).map(row => row.chatId), ['905'], 'a link from another root reaches only its own root');
  check(recipients.get(rootId).map(row => row.chatId), ['111'], 'an admin link whose role says superadmin is excluded by the canonical role');

  // Counts for the daily alert.
  await newPago('pcount-a', {unmatchedReview: {open: true, case: 'A'}});
  await newPago('pcount-b', {unmatchedReview: {open: true, case: 'B'}});
  await newPago('pcount-closed', {unmatchedReview: {open: false, case: 'A'}});
  const counts = await review.countOpenUnmatchedPayments(rootId);
  check(counts.a >= 1 && counts.b >= 1, true, 'open pagos are counted by case');
  check((await review.countOpenUnmatchedPayments(otherRoot)), {a: 0, b: 0}, 'counts are scoped to the root');

  // Decisions: authorization, idempotency, history.
  const openReview = {unmatchedReview: {open: true, case: 'A', classifiedAt: admin.firestore.Timestamp.now()}};
  await newPago('pd2', openReview);
  await newPago('pd3', {...openReview, createdBy: operadorUid});
  await newPago('pd4', {...openReview, adminId: otherAdminUid, createdBy: operadorUid});
  await newPago('pd5', {...openReview, adminId: revokedUid, createdBy: revokedUid});
  const decide = (uid, data) => run(review.decidePagoSinSolicitud, uid, data);
  const base = {pagoId: 'pd2', option: 'ESPERAR_FACTURA', note: 'anticipo', requestId: 'request-0001'};
  await rejects(decide(undefined, base), 'unauthenticated', 'anonymous caller is rejected');
  await rejects(decide(operadorUid, base), 'permission-denied', 'an operador outside the scope of the pago cannot decide');
  await rejects(decide(otherRoot, base), 'permission-denied', 'another root cannot decide');
  await rejects(decide(otherAdminUid, base), 'permission-denied', 'an admin outside the scope of the pago cannot decide');
  await rejects(decide(revokedUid, {...base, pagoId: 'pd5'}), 'permission-denied', 'a user whose pagos.create was revoked is rejected even on their own pago');
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
  check((await decide(adminUid, {pagoId: 'pd3', option: 'DEVOLVER', note: '', requestId: 'request-0004'})).reused, false, 'an admin decides on a pago of theirs');
  check((await decide(operadorUid, {pagoId: 'pd4', option: 'ESPERAR_FACTURA', note: 'anticipo', requestId: 'request-0005'})).reused, false, 'an operador decides on a pago they created');
  await rejects(decide(otherAdminUid, {pagoId: 'pd3', option: 'DEVOLVER', note: '', requestId: 'request-0006'}), 'permission-denied', 'an admin cannot decide on a pago of another admin');

  // The list.
  const list = (uid) => run(review.listPagosSinSolicitud, uid, {});
  const asRoot = await list(rootId);
  check(asRoot.rows.some(row => row.pagoId === 'pd2' && row.clienteNombre === 'ACME SA' && row.latestDecision.option === 'FACTURAR_PUE'), true, 'the superadmin sees the pago with its latest decision');
  const ids = async uid => (await list(uid)).rows.map(row => row.pagoId);
  const asAdmin = await ids(adminUid), asOther = await ids(otherAdminUid), asOperador = await ids(operadorUid);
  check([asAdmin.includes('pd2'), asAdmin.includes('pd3'), asAdmin.includes('pd4')], [true, true, false], 'an admin sees the pagos that belong to them and not those of another admin');
  check([asOther.includes('pd2'), asOther.includes('pd3'), asOther.includes('pd4')], [false, false, true], 'another admin sees only theirs');
  check([asOperador.includes('pd2'), asOperador.includes('pd3'), asOperador.includes('pd4')], [false, true, true], 'an operador sees only the pagos they created');
  check((await list(otherRoot)).rows.length, 0, 'another root sees none');
  await rejects(list(revokedUid), 'permission-denied', 'a user whose pagos.create was revoked cannot list');

  // Pending items for the daily summary and the dashboard: root-scoped counts, each one independent.
  const days = n => admin.firestore.Timestamp.fromMillis(Date.now() - n * 24 * 3600_000);
  const job = (id, extra) => db.doc(`paymentComplementJobs/${id}`).set({rootId, ...extra});
  await job('j1', {status: 'PAUSED'}); await job('j2', {status: 'BLOCKED'}); await job('j3', {status: 'RECEIVED'});
  await job('j4', {status: 'REQUESTED', requestedAt: days(6)}); await job('j5', {status: 'REQUESTED', requestedAt: days(2)});
  await db.doc('paymentComplementJobs/jx').set({rootId: otherRoot, status: 'PAUSED'});
  await db.doc('clientDispersions/d1').set({rootId, status: 'REGISTRADA', cashReceiptStatus: 'PENDIENTE_FIRMA'});
  await db.doc('clientDispersions/d2').set({rootId, status: 'REGISTRADA', cashReceiptStatus: 'FIRMADA'});
  await db.doc('clientDispersions/d3').set({rootId, status: 'CANCELADA', cashReceiptStatus: 'PENDIENTE_FIRMA'});
  await db.doc('clientDispersions/dx').set({rootId: otherRoot, status: 'REGISTRADA', cashReceiptStatus: 'PENDIENTE_FIRMA'});
  await db.doc('solicitudes/x1').set({rootId, iqCancellationStatus: 'CONFIRMED_REVIEW_REQUIRED'});
  await db.doc('solicitudes/x2').set({rootId, iqCancellationStatus: 'CONFIRMED'});
  await db.doc('solicitudes/x3').set({rootId: otherRoot, iqCancellationStatus: 'CONFIRMED_REVIEW_REQUIRED'});
  check(await pendingLib.loadPendingItems(rootId), {complementsHeld: 2, complementsLate: 1, cashUnsigned: 1, cancellationReview: 1}, 'each pending count is root-scoped and exact');
  check(await pendingLib.loadPendingItems(`${rootId}-empty`), {complementsHeld: 0, complementsLate: 0, cashUnsigned: 0, cancellationReview: 0}, 'a root with nothing pending reports zeros');
  await rejects(run(pendingLib.getPendingOperationsSummary, adminUid, {}), 'permission-denied', 'an admin cannot read the pending summary');
  await rejects(run(pendingLib.getPendingOperationsSummary, operadorUid, {}), 'permission-denied', 'an operador cannot read the pending summary');
  check((await run(pendingLib.getPendingOperationsSummary, rootId, {})).items.cashUnsigned, 1, 'the superadmin reads their own root only');
  console.log('UNMATCHED PAYMENT REVIEW OK', checks);
})().catch(error => { console.error(error); process.exit(1); });
