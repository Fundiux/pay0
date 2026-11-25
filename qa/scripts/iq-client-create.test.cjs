'use strict';
// Pure test: when the daily sync creates a PAY0 client from IQ's own client record, and when it must not.
//   npm --prefix functions run build && node qa/scripts/iq-client-create.test.cjs
const assert = require('node:assert/strict');
const { planClientCreates, clientRowForPlan, clientCreateDocId, catalogFromOperations, clientCreateCandidateStats } = require('../../functions/lib/modules/iqDailySync/clientCreate.js');
const { resolveDispersionClient } = require('../../functions/lib/modules/iqDailySync/dispersionPlan.js');

let checks = 0;
const check = (name, fn) => { fn(); checks += 1; console.log('ok', name); };
const BETELL = 'lcOz4nO5DTbksM3Lbz3hJcCpCdu1', EBASOR = 'Ab4z0RttIqXbZFT0NuWsDjBkt6J2', ROOT = EBASOR;
const iq = (id, name, rfc) => ({ id, name, rfc });
const pay0 = (id, data) => ({ collection: 'clients', id, data: { rootId: ROOT, active: true, ...data } });
const plan = (names, catalog, pay0Rows = [], groupId = 'iq-group-rr') => planClientCreates({ rootId: ROOT, groupId, names, catalog, pay0Rows });

check('creates a client with a real unique RFC for the owner of the group', () => {
  const [c] = plan(['Roal Parace Desarrolladora'], [iq('77', 'ROAL PARACE DESARROLLADORA', 'RPD190101AB1')]);
  assert.equal(c.ownerAdminId, BETELL); assert.equal(c.iqClientId, '77'); assert.equal(c.rfc, 'RPD190101AB1'); assert.equal(c.docId, clientCreateDocId(ROOT, 'iq-group-rr', '77'));
});
check('ELIUT clients belong to EBASOR', () => assert.equal(plan(['CAIT MONTERREY'], [iq('9', 'CAIT MONTERREY', 'CMO190101AB1')], [], 'iq-group-pay0')[0].ownerAdminId, EBASOR));
check('accents and case do not matter in the name', () => assert.equal(plan(['  garcía  ñ sa '], [iq('1', 'GARCIA Ñ SA', 'GAN190101AB1')]).length, 1));
check('no IQ client with that name: nothing', () => assert.equal(plan(['OTRO'], [iq('1', 'ROAL', 'RPD190101AB1')]).length, 0));
check('two IQ clients with the same name: a person decides', () => assert.equal(plan(['ROAL'], [iq('1', 'ROAL', 'RPD190101AB1'), iq('2', 'ROAL', 'RPD190101AB2')]).length, 0));
check('generic public RFC is never used', () => { assert.equal(plan(['X'], [iq('1', 'X', 'XAXX010101000')]).length, 0); assert.equal(plan(['X'], [iq('1', 'X', '')]).length, 0); });
check('a live PAY0 client with the same RFC (any owner) blocks creation', () => {
  assert.equal(plan(['ROAL'], [iq('1', 'ROAL', 'RPD190101AB1')], [pay0('c1', { rfc: 'RPD190101AB1', adminId: EBASOR })]).length, 0);
});
check('a PAY0 client already pointing at that IQ client blocks creation', () => {
  assert.equal(plan(['ROAL'], [iq('1', 'ROAL', 'RPD190101AB1')], [pay0('c1', { rfc: 'OTRO', iqClientId: '1', adminId: BETELL })]).length, 0);
});
check('a deleted PAY0 client does not block creation', () => {
  assert.equal(plan(['ROAL'], [iq('1', 'ROAL', 'RPD190101AB1')], [pay0('c1', { rfc: 'RPD190101AB1', isDeleted: true })]).length, 1);
});
check('the created client is then found by the dispersion rules', () => {
  const [c] = plan(['ROAL PARACE'], [iq('77', 'ROAL PARACE', 'RPD190101AB1')]);
  const row = clientRowForPlan(ROOT, c);
  assert.deepEqual(resolveDispersionClient({ groupId: 'iq-group-rr', clientName: 'ROAL PARACE', pay0Rows: [row] }), { ok: true, clientId: c.docId });
  assert.equal(row.data.source, 'IQ_IMPORT'); assert.equal(row.data.importMode, 'DAILY_SYNC');
});
check('same inputs, same document id', () => assert.equal(plan(['A'], [iq('5', 'A', 'AAA190101AB1')])[0].docId, plan(['A'], [iq('5', 'A', 'AAA190101AB1')])[0].docId));
const op = (kind, id, name, rfc, status = 'FOUND_EXACT') => ({ kind, raw: { __p4ClientResolution: { status, iqClientId: id, clientName: name, rfc } } });
check('clients named by invoices, deposits and applications become catalog entries, once each', () => {
  const catalog = catalogFromOperations([op('SOLICITUD', '5', 'FUTURITE', 'FUT190101AB1'), op('PAYMENT', '5', 'FUTURITE', 'FUT190101AB1'), op('APPLICATION', '6', 'TOCA CLEAN', ''), op('SOLICITUD', '7', 'OTRO', 'OTR190101AB1', 'NOT_FOUND'), { kind: 'SOLICITUD', raw: {} }]);
  assert.deepEqual(catalog.map((row) => row.id), ['5', '6']);
});
check('only real unique RFCs are created and the counts say how many are not', () => {
  const catalog = catalogFromOperations([op('SOLICITUD', '5', 'FUTURITE', 'FUT190101AB1'), op('SOLICITUD', '6', 'TOCA CLEAN', ''), op('SOLICITUD', '8', 'GENERICO', 'XAXX010101000')]);
  const creates = plan(catalog.map((row) => row.name), catalog);
  assert.deepEqual(clientCreateDocIds(creates), [clientCreateDocId(ROOT, 'iq-group-rr', '5')]);
  assert.deepEqual(clientCreateCandidateStats(catalog, creates), { distinct: 3, withRealRfc: 1, withoutRealRfc: 2, creatable: 1 });
});
check('an existing PAY0 client with that RFC (merged or not) is never duplicated', () => {
  const catalog = catalogFromOperations([op('SOLICITUD', '5', 'FUTURITE', 'FUT190101AB1')]);
  assert.equal(plan(['FUTURITE'], catalog, [pay0('c1', { rfc: 'FUT190101AB1', adminId: BETELL })]).length, 0);
});
function clientCreateDocIds(creates) { return creates.map((create) => create.docId); }
console.log(`${checks} checks passed`);
