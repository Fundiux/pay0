const assert = require('node:assert/strict');
const { test } = require('node:test');
const manifest = require('../fixtures/receipt-extraction-synthetic-v3.json');
const { validateManifest, evaluate } = require('./evaluate-receipt-corpus.cjs');
const { createEvaluationReader } = require('./remediation-ocr-quota.test.cjs');
const reader = createEvaluationReader();

for (const sample of manifest.samples) test(`receipt extraction: ${sample.id}`, () => {
  const result = evaluate({ ...manifest, samples: [sample] }, reader);
  assert.equal(result.exactFields, result.fields, JSON.stringify(result.errors));
});

test('real corpus is gated by anonymization and explicit authorization provenance', () => {
  assert.throws(() => validateManifest({ ...manifest, kind: 'REAL_ANONYMIZED' }), /authorization/);
  assert.throws(() => validateManifest({ ...manifest, kind: 'REAL_ANONYMIZED', authorization: { approvedForEvaluation: true, anonymized: false, reference: 'consent-01' } }), /authorization/);
  assert.equal(validateManifest({ ...manifest, kind: 'REAL_ANONYMIZED', authorization: { approvedForEvaluation: true, anonymized: true, reference: 'consent-01' } }).kind, 'REAL_ANONYMIZED');
  assert.throws(() => validateManifest({ ...manifest, samples: [manifest.samples[0], manifest.samples[0]] }), /unique/);
});

test('field errors expose opaque case and category without document values', () => {
  const sample = { id: 'opaque-01', bank: 'UNKNOWN', format: 'PDF_TEXT', text: 'Ordenante: PRIVATE_EXAMPLE', expected: { senderName: 'SECRET_EXPECTED' } };
  const result = evaluate({ ...manifest, samples: [sample] }, reader);
  assert.equal(result.byField.senderName.mismatch, 1);
  assert.deepEqual(result.errors, [{ sampleId: 'opaque-01', field: 'senderName', reason: 'mismatch' }]);
  assert.ok(!JSON.stringify(result).includes('PRIVATE_EXAMPLE'));
  assert.ok(!JSON.stringify(result).includes('SECRET_EXPECTED'));
});

test('explicit negative execution and missing identity remain review-only after improved extraction', () => {
  const text = 'Monto transferido\n100 MXN\nFecha de operación: 2026-10-16\nEstado: Pendiente';
  const receipt = reader.parse(text);
  assert.equal(receipt.amountVerified, true);
  assert.equal(receipt.dateVerified, true);
  assert.equal(receipt.executionConfirmed, false);
  assert.equal(reader.semantic(text, receipt).reviewRequired, true);
});
