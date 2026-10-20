const assert = require('node:assert/strict');
const { test } = require('node:test');
const manifest = require('../fixtures/receipt-extraction-synthetic-v3.json');
const { validateManifest, evaluate } = require('./evaluate-receipt-corpus.cjs');
const { createEvaluationReader } = require('./remediation-ocr-quota.test.cjs');
const reader = createEvaluationReader();

test('sender header inference never consumes beneficiary fields or their next-line values', () => {
  for (const beneficiary of ['Beneficiario: EMPRESA SINTETICA', 'Beneficiario\nEMPRESA SINTETICA', 'Destinatario: EMPRESA SINTETICA']) {
    const text = `BBVA\n${beneficiary}\nMonto: 100 MXN`;
    assert.equal(reader.parse(text).senderName, '');
    assert.equal(reader.semantic(text, reader.parse(text)).fields.senderName.provenance, 'MISSING');
  }
  assert.equal(reader.parse('COMERCIAL SINTETICA SA\nBeneficiario: OTRO NEGOCIO\nMonto: 100').senderName, 'COMERCIAL SINTETICA SA');
  assert.equal(reader.parse('Ordenante: EMISOR EXPLICITO\nBeneficiario: OTRO NEGOCIO\nMonto: 100').senderName, 'EMISOR EXPLICITO');
});

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

test('negative execution remains unconfirmed evidence without blocking document review', () => {
  const text = 'Monto transferido\n100 MXN\nFecha de operación: 2026-10-16\nEstado: Pendiente';
  const receipt = reader.parse(text);
  assert.equal(receipt.amountVerified, true);
  assert.equal(receipt.dateVerified, true);
  assert.equal(receipt.executionConfirmed, false);
  const semantic = reader.semantic(text, receipt);
  assert.equal(semantic.reviewRequired, false);
  assert.equal(semantic.fields.executionStatus.value, 'UNCONFIRMED');
  assert.equal(semantic.fields.executionStatus.decision, 'REVIEW');
});

test('evidence distinguishes detected values from inference and absent fields', () => {
  const text = 'BBVA\nMonto: 100 MXN\nFecha: 2026-10-16';
  const semantic = reader.semantic(text, reader.parse(text));
  assert.equal(semantic.fields.transferAmount.provenance, 'DETECTED');
  assert.equal(semantic.fields.bankName.provenance, 'INFERRED');
  assert.equal(semantic.fields.bankName.decision, 'REVIEW');
  assert.equal(semantic.fields.trackingKey.provenance, 'MISSING');
  assert.equal(semantic.reviewRequired, false);
  assert.equal(semantic.fields.executionStatus.decision, 'REVIEW');
});
