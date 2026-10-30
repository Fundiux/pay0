import assert from 'node:assert/strict';
import test from 'node:test';
import { isTsWithinRange } from '../../src/lib/dateScope.ts';

const from = new Date('2026-10-30T00:00:00.000Z');
const to = new Date('2026-10-30T23:59:59.999Z');
const inside = Date.parse('2026-10-30T17:32:39.631Z') / 1000;
const outside = Date.parse('2026-10-31T00:00:00.000Z') / 1000;

test('accepts callable and Firestore timestamp shapes for the same day', () => {
  assert.equal(isTsWithinRange({ _seconds: inside, _nanoseconds: 631000000 }, from, to), true);
  assert.equal(isTsWithinRange({ seconds: inside, nanoseconds: 631000000 }, from, to), true);
  assert.equal(isTsWithinRange({ _seconds: outside }, from, to), false);
  assert.equal(isTsWithinRange({ seconds: outside }, from, to), false);
});

test('rejects absent and invalid timestamps rather than showing a wrong date', () => {
  for (const value of [null, {}, { _seconds: NaN }, { seconds: '1793381559' }]) {
    assert.equal(isTsWithinRange(value, from, to), false);
  }
});
