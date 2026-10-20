const test = require('node:test');
const assert = require('node:assert/strict');
const { validateUniversalQuery, queryDigest } = require('../../functions/lib/modules/agent007/universalQueryContract');

const query = () => ({ schemaVersion: 'hugo-query-v1', domain: 'PAY0', source: 'authorized.payments', operation: 'SUMMARY',
  filters: [{ field: 'status', operator: 'IN', value: ['CONCILIADO', 'APLICADO_TOTAL'] }],
  columns: ['amount'], groupBy: ['client.id'], orderBy: [{ field: 'createdAt', direction: 'DESC' }], limit: 100 });

test('validated queries detach and freeze every nested input used by the digest', () => {
  const input = query();
  const validated = validateUniversalQuery(input);
  const before = queryDigest(validated);
  input.filters[0].value.push('ANULADO');
  input.filters[0].field = 'other';
  input.orderBy[0].direction = 'ASC';
  input.columns.push('secret');
  assert.equal(queryDigest(validated), before);
  assert.notEqual(queryDigest(input), before);
  assert(Object.isFrozen(validated.filters[0]));
  assert(Object.isFrozen(validated.filters[0].value));
  assert(Object.isFrozen(validated.orderBy[0]));
});

test('query validation rejects malformed fields, operators and noncanonical filter values', () => {
  for (const filter of [null, { field: '../secret', operator: 'EQ', value: 1 },
    { field: 'amount', operator: 'SQL', value: 1 }, { field: 'amount', operator: 'EQ', value: NaN },
    { field: 'amount', operator: 'EQ', value: undefined }, { field: 'amount', operator: 'IN', value: [] },
    { field: 'amount', operator: 'BETWEEN', value: [1] }, { field: 'amount', operator: 'IN', value: [{}] }]) {
    assert.throws(() => validateUniversalQuery({ ...query(), filters: [filter] }), /HUGO_QUERY_FILTER/);
  }
  assert.throws(() => validateUniversalQuery({ ...query(), columns: ['../secret'] }), /FIELD_INVALID/);
  assert.throws(() => validateUniversalQuery({ ...query(), orderBy: [{ field: 'amount', direction: 'random' }] }), /FIELD_INVALID/);
  assert.throws(() => validateUniversalQuery({ ...query(), orderBy: [null] }), /FIELD_INVALID/);
});

test('equivalent canonical queries keep their digest independently of property insertion order', () => {
  const input = query();
  const reordered = { ...input, filters: [{ value: ['CONCILIADO', 'APLICADO_TOTAL'], operator: 'IN', field: 'status' }] };
  assert.equal(queryDigest(input), queryDigest(reordered));
});
