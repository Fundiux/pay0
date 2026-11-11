'use strict';
const assert = require('node:assert/strict');
const { normalizeOperatorNumbers, countNumberConflicts, classifyGroupSender, MAX_OPERATOR_NUMBERS } = require('../../functions/lib/modules/operatorNumbers/domain.js');

const n = normalizeOperatorNumbers(['5512345678', '52 55 1234 5678', '+521 55 8765 4321', '123', '', 'abc', null]);
assert.deepEqual(n.numbers, ['525512345678', '525587654321']);
assert.equal(n.invalid, 4);
assert.equal(n.duplicates, 1);
assert.deepEqual(normalizeOperatorNumbers('no es lista'), { numbers: [], invalid: 0, duplicates: 0 });
assert.equal(MAX_OPERATOR_NUMBERS, 20);

const dir = [{ userUid: 'betell', numbers: ['525511111111', '525522222222'] }, { userUid: 'ebasor', numbers: ['525533333333'] }];
assert.equal(countNumberConflicts(['525533333333'], dir, 'betell'), 1);
assert.equal(countNumberConflicts(['525511111111'], dir, 'betell'), 0);
assert.equal(countNumberConflicts(['525599999999'], dir, 'betell'), 0);

assert.deepEqual(classifyGroupSender('5215511111111@c.us', dir), { kind: 'OPERATOR', userUid: 'betell' });
assert.deepEqual(classifyGroupSender('525511111111@c.us', dir), { kind: 'OPERATOR', userUid: 'betell' });
assert.deepEqual(classifyGroupSender('525533333333', dir), { kind: 'OPERATOR', userUid: 'ebasor' });
assert.deepEqual(classifyGroupSender('525500000000@c.us', dir), { kind: 'CLIENT' });
assert.deepEqual(classifyGroupSender('', dir), { kind: 'CLIENT' });
assert.deepEqual(classifyGroupSender(undefined, dir), { kind: 'CLIENT' });
console.log('operator-numbers-domain: 14 checks passed');
