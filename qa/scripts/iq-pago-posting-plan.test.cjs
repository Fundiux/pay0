'use strict';
// Pure rules to credit to the wallet a pago recovered from an IQ deposit.
//   npm --prefix functions run build && node qa/scripts/iq-pago-posting-plan.test.cjs
const assert = require('node:assert/strict');
const { planPagoPosting, baseAmountFromGross } = require('../../functions/lib/modules/iqDailySync/pagoPostingPlan.js');

let checks = 0;
const check = (name, fn) => { fn(); checks += 1; console.log('ok', name); };

// The three deposits the owner pasted from IQ (2026-11-21, client GRUPO INTERNACIONAL AYEKAN, type CRUCE, 2% of the subtotal).
const deposit = (id, sum, over = {}) => ({ id, created_at: '2026-11-21T11:07:00', operation_status: 'En Operacion', conciliation_status: 'Conciliado', sum, currency: 'mxn', client: 'GRUPO INTERNACIONAL AYEKAN',
  operation_type: 'CRUCE', sale_type: 'Subtotal', sale_percentage: '2.0', base_percentage: '2.0', ...over });
const pago = (amount, over = {}) => ({ clienteId: 'c1', status: 'CONCILIADO', monto: amount, montoTotal: amount, moneda: 'MXN', ...over });
const ok = (d, p) => { const result = planPagoPosting(d, p); assert.equal(result.ok, true, JSON.stringify(result)); return result.plan; };
const bad = (d, p, code) => { const result = planPagoPosting(d, p); assert.equal(result.ok, false); assert.equal(result.code, code); };

check('the three real deposits give exactly the net IQ shows on its card', () => {
  const a = ok(deposit(237159, '200000.00'), pago(200000));
  assert.deepEqual([a.grossAmount, a.clientChargeAmount, a.clientNetAmount], [200000, 3448.28, 196551.72]);
  const b = ok(deposit(237160, '450000.00'), pago(450000));
  assert.deepEqual([b.grossAmount, b.clientChargeAmount, b.clientNetAmount], [450000, 7758.62, 442241.38]);
  const c = ok(deposit(237161, '350000.00'), pago(350000));
  assert.deepEqual([c.grossAmount, c.clientChargeAmount, c.clientNetAmount], [350000, 6034.48, 343965.52]);
});

check('the subtotal is the total without the 16% VAT; a total-based sale takes the percentage of the total', () => {
  assert.equal(baseAmountFromGross(200000, 'SUBTOTAL'), 172413.79);
  assert.equal(baseAmountFromGross(200000, 'TOTAL'), 200000);
  const total = ok(deposit(1, '200000', { sale_type: 'Total' }), pago(200000));
  assert.deepEqual([total.baseType, total.clientChargeAmount, total.clientNetAmount], ['TOTAL', 4000, 196000]);
});

check('the original date, type, percentages and currency are kept', () => {
  const plan = ok(deposit(237159, '200000.00'), pago(200000));
  assert.equal(plan.originalIso, '2026-11-21T17:07:00.000Z', 'IQ sends Mexico City time');
  assert.equal(plan.operationType, 'CRUCE'); assert.equal(plan.salePercentage, 2); assert.equal(plan.basePercentage, 2); assert.equal(plan.currency, 'MXN'); assert.equal(plan.baseType, 'SUBTOTAL');
});

check('a 0% sale credits the whole amount', () => {
  const plan = ok(deposit(1, '1000', { sale_percentage: 0 }), pago(1000));
  assert.deepEqual([plan.clientChargeAmount, plan.clientNetAmount], [0, 1000]);
});

check('a pago already applied to invoices still receives its money', () => {
  for (const status of ['CONCILIADO', 'APLICADO_PARCIAL', 'APLICADO_TOTAL']) ok(deposit(1, '1000'), pago(1000, { status }));
});

check('the money is credited only once IQ says it arrived', () => {
  bad(deposit(1, '1000', { conciliation_status: 'Sin Conciliar' }), pago(1000), 'PAGO_NOT_CONCILIATED_IN_IQ');
  bad(deposit(1, '1000', { conciliation_status: '' }), pago(1000), 'PAGO_NOT_CONCILIATED_IN_IQ');
  bad(deposit(1, '1000', { operation_status: 'Cancelada' }), pago(1000), 'PAGO_CANCELLED_IN_IQ');
  bad(deposit(1, '1000', { operation_status: 'Rechazada' }), pago(1000), 'PAGO_CANCELLED_IN_IQ');
});

check('a pago that is not conciliated in PAY0, has no client or is already posted is left alone', () => {
  bad(deposit(1, '1000'), pago(1000, { status: 'PENDIENTE' }), 'PAGO_NOT_CONCILIATED');
  bad(deposit(1, '1000'), pago(1000, { status: 'CANCELADO' }), 'PAGO_NOT_CONCILIATED');
  bad(deposit(1, '1000'), pago(1000, { clienteId: '' }), 'PAGO_CLIENT_MISSING');
  bad(deposit(1, '1000'), pago(1000, { financialPostingStatus: 'POSTED' }), 'PAGO_ALREADY_POSTED');
});

check('the amount, the currency and the percentage must be readable and agree', () => {
  bad(deposit(1, '1000'), pago(999.99), 'PAGO_AMOUNT_MISMATCH');
  bad(deposit(1, '', { amount: undefined }), pago(1000), 'PAGO_AMOUNT_INVALID');
  bad(deposit(1, '0'), pago(0), 'PAGO_AMOUNT_INVALID');
  bad(deposit(1, '1000', { currency: 'usd' }), pago(1000), 'PAGO_CURRENCY_MISMATCH');
  bad(deposit(1, '1000', { sale_percentage: undefined }), pago(1000), 'PAGO_PERCENTAGE_INVALID');
  bad(deposit(1, '1000', { sale_percentage: 'abc' }), pago(1000), 'PAGO_PERCENTAGE_INVALID');
  bad(deposit(1, '1000', { sale_percentage: 150 }), pago(1000), 'PAGO_PERCENTAGE_INVALID');
  bad(deposit(1, '1000', { created_at: 'ayer' }), pago(1000), 'PAGO_DATE_INVALID');
});

console.log(JSON.stringify({ status: 'PASS', checks }));
