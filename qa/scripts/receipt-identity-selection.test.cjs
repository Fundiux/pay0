const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectReceiptIdentity } = require('../../functions/lib/modules/pagos/receiptIdentificationDomain.js');
const a = { id: 'a', name: 'Cliente Prueba', rfc: 'ABC010101AB1', cuenta: '1234567890' };
const signals = { name: a.name, rfc: a.rfc, account: a.cuenta };

test('unique verified identity keeps automatic behavior', () => {
  assert.equal(selectReceiptIdentity([a], signals).match.id, 'a');
});
test('duplicate identities require explicit valid choice', () => {
  const items = [a, { ...a, id: 'b' }];
  assert.equal(selectReceiptIdentity(items, signals).match.status, 'REQUIRES_REVIEW');
  const chosen = selectReceiptIdentity(items, signals, 'b');
  assert.equal(chosen.match.id, 'b');
  assert.ok(chosen.match.evidence.includes('USER_SELECTED_VERIFIED_CANDIDATE'));
});
test('selection cannot hide contradictory RFC and account evidence', () => {
  const items = [a, { ...a, id: 'b', rfc: 'DEF020202CD2', cuenta: '9876543210' }];
  const result = selectReceiptIdentity(items, { ...signals, account: '9876543210' }, 'a');
  assert.equal(result.match.status, 'REQUIRES_REVIEW');
  assert.deepEqual(result.candidates, []);
});
test('name-only and masked account never become verified candidates', () => {
  for (const input of [{ name: a.name }, { name: a.name, account: '******7890' }]) {
    assert.equal(selectReceiptIdentity([a], input, 'a').match.status, 'REQUIRES_REVIEW');
    assert.deepEqual(selectReceiptIdentity([a], input).candidates, []);
  }
});
test('inactive and arbitrary selections fail closed', () => {
  assert.equal(selectReceiptIdentity([{ ...a, active: false }], signals, 'a').match.id, null);
  assert.equal(selectReceiptIdentity([a], signals, 'foreign').match.id, null);
});
