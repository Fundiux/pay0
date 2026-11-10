const assert = require('node:assert/strict');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || !String(process.env.GCLOUD_PROJECT || '').startsWith('demo-')) throw Error('LOCAL_EMULATOR_REQUIRED');
const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({projectId: process.env.GCLOUD_PROJECT});
const db = admin.firestore();
global.fetch = async () => { throw Error('EXTERNAL_NETWORK_FORBIDDEN'); };
const domain = require('../../functions/lib/modules/businessIndicators/domain');
const callables = require('../../functions/lib/modules/businessIndicators/callables');
let checks = 0;
function check(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++; }
const rejects = async (promise, code, label) => { try { await promise; } catch (error) { check(error.code, code, label); return; } assert.fail(`${label}: expected ${code}`); };
const run = (uid, data) => callables.getBusinessIndicators.run({auth: {uid, token: {}}, data, rawRequest: {}});
const rootId = `biz-${Date.now()}`, otherRoot = `${rootId}-other`, adminUid = `${rootId}-admin`;
const at = iso => admin.firestore.Timestamp.fromDate(new Date(iso));
const U1 = '11111111-1111-4111-8111-111111111111', U2 = '22222222-2222-4222-8222-222222222222', U3 = '33333333-3333-4333-8333-333333333333', U4 = '44444444-4444-4444-8444-444444444444';

(async () => {
  // Pure domain.
  const sol = (id, extra) => ({id, rootId, clienteId: 'c1', clienteNombre: 'ACME', status: 'PROCESANDO', monto: 1000, totalAbonado: 0, tipoFactura: 'PPD', facturaUuid: U1, ...extra});
  const result = domain.computeBusinessIndicators({
    pagos: [{id: 'p1', montoTotal: 500, moneda: 'MXN', status: 'CONCILIADO'}, {id: 'p2', montoTotal: 100, moneda: 'USD', status: 'CONCILIADO'}, {id: 'p3', montoTotal: 900, status: 'CANCELADO'}, {id: 'p4', montoTotal: 50, isDeleted: true}],
    solicitudes: [
      sol('s1'), sol('s2', {facturaUuid: U2, tipoFactura: 'PUE', totalAbonado: 400}), sol('s3', {facturaUuid: U3, clienteId: 'c2', clienteNombre: 'BETA'}),
      sol('s4', {facturaUuid: U4, status: 'PROCESANDO'}), sol('s5', {facturaUuid: '', status: 'PROCESANDO'}), sol('s6', {status: 'RECHAZADA', facturaUuid: 'X'}),
      sol('s7', {facturaUuid: 'ABCDEF', tipoFactura: '', facturaMetodoPago: 'ppd', monto: 200, totalAbonado: 200}),
    ],
    facturas: [{uuid: U4.toLowerCase(), cancellationStatus: 'canceled'}, {uuid: U1, cancellationStatus: 'REQUESTED'}],
  });
  check(result.pagos, {total: 2, montoPorMoneda: {MXN: 500, USD: 100}}, 'dead and deleted pagos are excluded');
  check(result.solicitudes, {total: 6, conFactura: 4, sinFactura: 1, facturasCanceladasExcluidas: 1}, 'rejected solicitudes and confirmed-cancelled CFDIs are excluded');
  check(result.relacionadas, {conPagoAplicado: 2, sinPagoAplicado: 2}, 'invoices with and without an applied pago');
  check(result.pendientes.PPD, {facturas: 2, monto: 2000, otrasMonedas: 0}, 'PPD pending: s1 and s3; s7 is fully paid; a cancellation only requested still counts');
  check(result.pendientes.PUE, {facturas: 1, monto: 600, otrasMonedas: 0}, 'PUE pending uses the remaining balance');
  check(result.clienteConMasPendientes, {clienteId: 'c1', cliente: 'ACME', facturas: 2, monto: 1600}, 'client with most pending invoices');
  check(domain.invoiceKind({tipoFactura: 'ppd'}) + domain.invoiceKind({}), 'PPDSIN_TIPO', 'invoice kind falls back to SIN_TIPO');
  check(domain.computeBusinessIndicators({pagos: [], solicitudes: [sol('z1')], facturas: []}).advertencias.length, 1, 'missing Facturama data is flagged');

  // Callable: superadmin only, rootId scoped, period filtered.
  await db.doc(`users/${rootId}`).set({rootId, role: 'superadmin', active: true, name: 'Dueña'});
  await db.doc(`users/${adminUid}`).set({rootId, role: 'admin', active: true, name: 'Admin', modules: {dashboard: {view: true}}});
  await db.doc(`users/${otherRoot}`).set({rootId: otherRoot, role: 'superadmin', active: true, name: 'Otra raíz'});
  const today = new Date();
  const thisMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1, 18));
  const lastMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 15, 18));
  const put = (path, data) => db.doc(path).set(data);
  await put('solicitudes/a1', sol('a1', {createdAt: at(thisMonth), facturaUuid: U1}));
  await put('solicitudes/a2', sol('a2', {createdAt: at(thisMonth), facturaUuid: U4, clienteId: 'c2', clienteNombre: 'BETA'}));
  await put('solicitudes/a3', sol('a3', {createdAt: at(lastMonth), facturaUuid: U3}));
  await put('solicitudes/ax', sol('ax', {rootId: otherRoot, createdAt: at(thisMonth)}));
  await put('pagos/b1', {rootId, status: 'CONCILIADO', montoTotal: 700, moneda: 'MXN', createdAt: at(thisMonth)});
  await put('pagos/b2', {rootId, status: 'CONCILIADO', montoTotal: 300, moneda: 'MXN', createdAt: at(lastMonth)});
  await put('pagos/bx', {rootId: otherRoot, status: 'CONCILIADO', montoTotal: 9999, moneda: 'MXN', createdAt: at(thisMonth)});
  await put('facturamaInvoices/f1', {rootId, uuid: U4, cancellationStatus: 'canceled', createdAt: at(thisMonth)});
  const earning = (id, clienteId, nombre, total, extra = {}) => put(`earningsDistributions/${id}`, {rootId, clienteId, clienteNombre: nombre, totalEarningsAmount: total, status: 'GENERATED', createdAt: at(thisMonth), ...extra});
  await earning('e1', 'c1', 'ACME', 120); await earning('e2', 'c2', 'BETA', 450); await earning('e3', 'c2', 'BETA', 50);
  await earning('e4', 'c1', 'ACME', 9000, {createdAt: at(lastMonth)}); await earning('ex', 'cz', 'OTRA', 99999, {rootId: otherRoot});

  const current = await run(rootId, {});
  check([current.solicitudes.total, current.solicitudes.conFactura, current.solicitudes.facturasCanceladasExcluidas], [2, 1, 1], 'the default period is the current month and excludes the cancelled CFDI');
  check([current.pagos.total, current.pagos.montoPorMoneda.MXN], [1, 700], 'only pagos of the period and root');
  check(current.mejorClientePorUtilidad, {clienteId: 'c2', cliente: 'BETA', utilidad: 500, operaciones: 2}, 'best client by gross profit within the period and root');
  check(current.pendientes.PPD.facturas, 1, 'pending PPD of the period');
  const previous = await run(rootId, {desde: `${lastMonth.toISOString().slice(0, 7)}-01`, hasta: `${lastMonth.toISOString().slice(0, 7)}-28`});
  check([previous.solicitudes.total, previous.pagos.montoPorMoneda.MXN, previous.mejorClientePorUtilidad.utilidad], [1, 300, 9000], 'a selected period reads that period only');
  check((await run(otherRoot, {})).pagos.montoPorMoneda.MXN, 9999, 'another root only sees its own data');
  await rejects(run(adminUid, {}), 'permission-denied', 'an admin cannot read the indicators');
  await rejects(run(`${rootId}-nobody`, {}), 'permission-denied', 'an unknown user cannot read the indicators');
  await rejects(run(rootId, {desde: '2026-02-30'}), 'invalid-argument', 'an invalid date is rejected');
  await rejects(run(rootId, {desde: '2026-01-01', hasta: '2024-01-01'}), 'invalid-argument', 'an inverted period is rejected');
  await rejects(run(rootId, {desde: '2024-01-01', hasta: '2026-01-01'}), 'invalid-argument', 'a period over a year is rejected');
  console.log('BUSINESS INDICATORS OK', checks);
})().catch(error => { console.error(error); process.exit(1); });
