const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluate, compare } = require('./evaluate-receipt-corpus.cjs');
const manifest = { schemaVersion: 1, kind: 'SYNTHETIC', samples: [
  { id: 'case-a', bank: 'BANK_A', format: 'PDF_TEXT', text: 'private-a', expected: { amount: 100, senderName: 'private-name' } },
  { id: 'case-b', bank: 'BANK_B', format: 'IMAGE_OCR_TEXT', text: 'private-b', expected: { amount: 200 } },
] };
const reader = outputs => ({ readerVersion: 'test', parse: text => outputs[text], semantic: () => ({ reviewRequired: true, fields: {} }) });
const run = outputs => evaluate(manifest, reader(outputs));
test('paired gate catches a regression hidden by equal aggregate accuracy', () => {
  const before = run({ 'private-a': { amount: 100 }, 'private-b': {} });
  const after = run({ 'private-a': {}, 'private-b': { amount: 200 } });
  assert.equal(before.exactFields, after.exactFields);
  const result = compare(manifest, before, after);
  assert.equal(result.regressionGate, 'FAIL');
  assert.equal(result.improved, 1); assert.equal(result.regressed, 1);
  assert.equal(result.unchangedIncorrect, 1);
  assert.equal(result.byBankFormatField['BANK_A/PDF_TEXT/amount'].regressed, 1);
  assert.equal(result.byBankFormatField['BANK_B/IMAGE_OCR_TEXT/amount'].improved, 1);
  assert.ok(!JSON.stringify(result).includes('private-'));
});
test('all-correct improvement remains review-only and never certifies real accuracy', () => {
  const before = run({ 'private-a': {}, 'private-b': {} });
  const after = run({ 'private-a': { amount: 100, senderName: 'private-name' }, 'private-b': { amount: 200 } });
  const result = compare(manifest, before, after);
  assert.equal(result.improved, 3); assert.equal(result.regressionGate, 'PASS');
  assert.equal(result.productionAccuracy, 'NOT_EVALUATED');
  assert.equal(result.promotion, 'HUMAN_REVIEW_REQUIRED_NO_AUTOMATIC_PROMOTION');
});
test('unchanged failures are visible and authorized real text is not an OCR certification', () => {
  const result = run({ 'private-a': { amount: 100 }, 'private-b': {} });
  const corpus = { ...manifest, kind: 'REAL_ANONYMIZED', authorization: { approvedForEvaluation: true, anonymized: true, reference: 'consent-01' } };
  const comparison = compare(corpus, result, result);
  assert.equal(comparison.unchangedCorrect, 1); assert.equal(comparison.unchangedIncorrect, 2);
  assert.equal(comparison.productionAccuracy, 'USER_ATTESTED_EXTRACTED_TEXT_ONLY');
  assert.equal(comparison.changes.length, 0);
  assert.throws(() => compare({ ...corpus, authorization: undefined }, result, result), /authorization/);
});
