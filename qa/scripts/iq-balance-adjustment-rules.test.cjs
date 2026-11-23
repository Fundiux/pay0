'use strict';
// Pure rules of the exceptional balance adjustment (IQ vs PAY0).
//   npm --prefix functions run build && node qa/scripts/iq-balance-adjustment-rules.test.cjs
const assert = require('node:assert/strict');
const rules = require('../../functions/lib/modules/iqBalanceReconciliation/adjustmentDomain.js');

let checks = 0;
const check = (name, fn) => { fn(); checks += 1; console.log('ok', name); };
const fails = (fn, code) => assert.throws(fn, (error) => error instanceof rules.AdjustmentRuleError && error.code === code, code);

check('IQ above PAY0 is an IN; PAY0 above IQ is an OUT; difference is IQ minus PAY0', () => {
  assert.deepEqual(rules.planBalanceAdjustment({ iqBalance: 500, pay0Balance: 450, amount: 50 }), { direction: 'IN', amount: 50, difference: 50 });
  assert.deepEqual(rules.planBalanceAdjustment({ iqBalance: 450, pay0Balance: 500, amount: 50 }), { direction: 'OUT', amount: 50, difference: -50 });
});

check('a partial adjustment is allowed, one beyond the difference is not', () => {
  assert.equal(rules.planBalanceAdjustment({ iqBalance: 500, pay0Balance: 450, amount: 20.5 }).amount, 20.5);
  fails(() => rules.planBalanceAdjustment({ iqBalance: 500, pay0Balance: 450, amount: 50.01 }), 'AMOUNT_EXCEEDS_DIFFERENCE');
  fails(() => rules.planBalanceAdjustment({ iqBalance: 450, pay0Balance: 500, amount: 100 }), 'AMOUNT_EXCEEDS_DIFFERENCE');
});

check('a client that already matches (within a cent) needs no adjustment', () => {
  fails(() => rules.planBalanceAdjustment({ iqBalance: 1000.01, pay0Balance: 1000, amount: 0.01 }), 'NO_DIFFERENCE');
  fails(() => rules.planBalanceAdjustment({ iqBalance: 100, pay0Balance: 100, amount: 5 }), 'NO_DIFFERENCE');
});

check('the amount must be a positive number with at most two decimals', () => {
  for (const amount of [0, -5, 'abc', null, undefined, NaN, Infinity, 10.123]) fails(() => rules.planBalanceAdjustment({ iqBalance: 500, pay0Balance: 400, amount }), 'INVALID_AMOUNT');
  assert.equal(rules.planBalanceAdjustment({ iqBalance: 500, pay0Balance: 400, amount: '10.5' }).amount, 10.5);
});

check('an unreadable balance on either side is never treated as zero', () => {
  fails(() => rules.planBalanceAdjustment({ iqBalance: null, pay0Balance: 400, amount: 10 }), 'BALANCE_UNREADABLE');
  fails(() => rules.planBalanceAdjustment({ iqBalance: 400, pay0Balance: undefined, amount: 10 }), 'BALANCE_UNREADABLE');
  fails(() => rules.planBalanceAdjustment({ iqBalance: '400', pay0Balance: 300, amount: 10 }), 'BALANCE_UNREADABLE');
});

check('the reason is required, trimmed and bounded', () => {
  fails(() => rules.cleanReason(''), 'REASON_TOO_SHORT');
  fails(() => rules.cleanReason('   corto   '), 'REASON_TOO_SHORT');
  fails(() => rules.cleanReason('x'.repeat(501)), 'REASON_TOO_LONG');
  assert.equal(rules.cleanReason('  Cuadre   inicial  de migración con IQ  '), 'Cuadre inicial de migración con IQ');
});

check('the log comment says what was done, why it was allowed, who allowed it and the typed reason', () => {
  const text = rules.adjustmentLogComment({ actorName: 'DUENO', clientName: 'Cliente Dos', direction: 'OUT', amount: 50, before: 500, after: 450, iqBalance: 450, reason: 'Cuadre inicial de migración' });
  assert.match(text, /Ajuste excepcional de saldo/);
  assert.match(text, /cargo de \$50\.00/);
  assert.match(text, /de \$500\.00 a \$450\.00/);
  assert.match(text, /Autorizado por el superadmin DUENO/);
  assert.match(text, /el sistema todavía no estaba listo para registrar esta operación/);
  assert.match(text, /por única vez durante la migración/);
  assert.match(text, /Motivo: Cuadre inicial de migración$/);
  assert.match(rules.adjustmentLogComment({ actorName: 'D', clientName: '', direction: 'IN', amount: 1, before: 0, after: 1, iqBalance: 1, reason: 'Motivo suficiente' }), /abono de \$1\.00\) a un cliente/);
});

console.log(JSON.stringify({ status: 'PASS', checks }));
