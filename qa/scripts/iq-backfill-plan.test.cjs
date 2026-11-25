'use strict';
// Pure test: months of the historical backfill, when a month is closed and which IQ operations are left out.
//   npm --prefix functions run build && node qa/scripts/iq-backfill-plan.test.cjs
const assert = require('node:assert/strict');
const admin = require('../../functions/node_modules/firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-backfill' });
const { monthWindow, nextMonth, monthRunIsQuiet } = require('../../functions/lib/modules/iqDailySync/backfill.js');
const { isDiscardedIqStatus } = require('../../functions/lib/modules/iqDailySync/service.js');
let checks = 0;
const check = (name, fn) => { fn(); checks += 1; console.log('ok', name); };
const END = '2026-11-23';

check('a month covers its first to last day', () => { assert.deepEqual(monthWindow('2025-02', END), { start: '2025-02-01', end: '2025-02-28' }); assert.deepEqual(monthWindow('2024-02', END), { start: '2024-02-01', end: '2024-02-29' }); assert.deepEqual(monthWindow('2025-12', END), { start: '2025-12-01', end: '2025-12-31' }); });
check('the last month stops at the cutoff date', () => assert.deepEqual(monthWindow('2026-11', END), { start: '2026-11-01', end: '2026-11-23' }));
check('a month after the cutoff has no window', () => { assert.equal(monthWindow('2026-12', END), null); assert.equal(monthWindow('bad', END), null); assert.equal(monthWindow('2025-13', END), null); });
check('months advance and roll over the year', () => { assert.equal(nextMonth('2025-01'), '2025-02'); assert.equal(nextMonth('2025-12'), '2026-01'); });
check('from 2025-01 to the cutoff there are 23 months', () => { let m = '2025-01', n = 0; while (monthWindow(m, END)) { n++; m = nextMonth(m); } assert.equal(n, 23); });
const g = (over = {}) => ({ status: 'COMPLETE', created: {}, ...over });
check('a month closes only when every group is complete and found nothing to do', () => {
  assert.equal(monthRunIsQuiet([g(), g()]), true);
  assert.equal(monthRunIsQuiet([g(), g({ created: { SOLICITUD: 3 } })]), false);
  assert.equal(monthRunIsQuiet([g({ dispersionsImported: 2 })]), false);
  assert.equal(monthRunIsQuiet([g({ pagosPosted: 1 })]), false);
  assert.equal(monthRunIsQuiet([g({ clientsCreated: 1 })]), false);
  assert.equal(monthRunIsQuiet([g({ clientsLinked: 1 })]), false);
  assert.equal(monthRunIsQuiet([g(), g({ status: 'PARTIAL' })]), false);
  assert.equal(monthRunIsQuiet([]), false);
});
check('cancelled, rejected, deleted or failed operations are left out', () => {
  for (const status of ['CANCELADA', 'cancelado', 'RECHAZADO', 'Eliminada', 'FALLIDA', 'ERROR', 'ANULADA']) assert.equal(isDiscardedIqStatus({ operation_status: status }), true, status);
  for (const status of ['TERMINADA', 'CONCILIADO', 'COMPLETADA', '']) assert.equal(isDiscardedIqStatus({ operation_status: status }), false, status);
  assert.equal(isDiscardedIqStatus({ status: 'CANCELADA' }), true);
  assert.equal(isDiscardedIqStatus({}), false);
});
console.log(`${checks} checks passed`);
