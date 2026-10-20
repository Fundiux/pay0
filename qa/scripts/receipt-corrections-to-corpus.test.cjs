const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { importCorrections, writePrivateManifest } = require('./receipt-corrections-to-corpus.cjs');
const { evaluate } = require('./evaluate-receipt-corpus.cjs');
const { createEvaluationReader } = require('./remediation-ocr-quota.test.cjs');

function fixture() {
  return { schemaVersion: 1, kind: 'SYNTHETIC', samples: [{ id: 'review-01', bank: 'SYNTHETIC', format: 'PDF_TEXT', text: 'Monto: 123.45 MXN', reviewedExpected: { 'semantic.transferAmount': 123.45 },
    review: { approved: true, anonymizedTextAndExpectedReviewed: true, reference: 'review-ticket-1' },
    analysis: { id: 'a'.repeat(64), rootId: 'PRIVATE_ROOT', contentSha256: 'b'.repeat(64), readerVersion: 'test-reader', correctionVersion: 1 },
    correction: { id: 'c'.repeat(64), rootId: 'PRIVATE_ROOT', analysisId: 'a'.repeat(64), documentFingerprint: 'b'.repeat(64), readerVersion: 'test-reader', version: 1, field: 'transferAmount', humanCorrection: { correctedField: 'transferAmount', correctedValue: 987654321, actorUid: 'PRIVATE_ACTOR' } } }] };
}

test('curated correction becomes executable corpus without copying source identities or values', () => {
  const input = fixture(), manifest = importCorrections(input), text = JSON.stringify(manifest);
  for (const secret of ['PRIVATE_ROOT', 'PRIVATE_ACTOR', '987654321', 'a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)]) assert.ok(!text.includes(secret));
  assert.equal(manifest.samples[0].expected['semantic.transferAmount'], 123.45);
  assert.match(manifest.samples[0].provenance.sourceDigest, /^[a-f0-9]{64}$/);
  assert.equal(evaluate(manifest, createEvaluationReader()).exactFields, 1);
});

test('scope, fingerprint, reader, version and field inconsistencies fail closed', () => {
  for (const mutate of [
    s => { s.correction.rootId = 'foreign'; }, s => { s.correction.analysisId = 'd'.repeat(64); },
    s => { s.correction.documentFingerprint = 'e'.repeat(64); }, s => { s.correction.readerVersion = 'other'; },
    s => { s.correction.version = 2; }, s => { s.correction.field = 'sourceAccount'; },
    s => { s.reviewedExpected = { amount: 123.45 }; }, s => { s.review.approved = false; },
    s => { s.review.anonymizedTextAndExpectedReviewed = false; }, s => { delete s.text; },
  ]) { const input = fixture(); mutate(input.samples[0]); assert.throws(() => importCorrections(input)); }
  const duplicate = fixture(); duplicate.samples.push(structuredClone(duplicate.samples[0])); assert.throws(() => importCorrections(duplicate), /DUPLICATE/);
});

test('real text requires explicit authorization and human anonymization attestation', () => {
  const input = fixture(); input.kind = 'REAL_ANONYMIZED';
  assert.throws(() => importCorrections(input), /AUTHORIZATION/);
  input.authorization = { approvedForEvaluation: true, anonymized: true, reference: 'consent-01' };
  assert.equal(importCorrections(input).kind, 'REAL_ANONYMIZED');
  input.authorization.anonymized = false;
  assert.throws(() => importCorrections(input), /AUTHORIZATION/);
});

test('output defaults to isolated private directory without overwriting prior evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pay0-receipt-import-'));
  try {
    const manifest = importCorrections(fixture());
    const first = writePrivateManifest(manifest, root), second = writePrivateManifest(manifest, root);
    assert.equal(path.dirname(first), path.join(fs.realpathSync(root), '.firebase', 'receipt-corpus'));
    assert.notEqual(first, second);
    assert.deepEqual(JSON.parse(fs.readFileSync(first, 'utf8')), manifest);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});


test('actor-scoped snapshots validate the correct actor version without exporting identity', () => {
  const input = fixture(), sample = input.samples[0];
  delete sample.analysis.correctionVersion;
  sample.analysis.correctionVersionsByActor = { PRIVATE_ACTOR: 1, OTHER_ACTOR: 9 };
  const output = importCorrections(input);
  assert.equal(output.samples[0].expected['semantic.transferAmount'], 123.45);
  assert.ok(!JSON.stringify(output).includes('PRIVATE_ACTOR'));
  sample.analysis.correctionVersionsByActor.PRIVATE_ACTOR = 2;
  assert.throws(() => importCorrections(input), /VERSION_MISMATCH/);
  delete sample.correction.humanCorrection.actorUid;
  assert.throws(() => importCorrections(input), /ACTOR_REQUIRED/);
});
