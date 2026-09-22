const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, 'learning');
const result = require('./learning/phase5-experiment-results.json');
const manifest = require('./learning/phase5-synthetic-v1.manifest.json');
const historical = require('./learning/phase4-historical-assets.json');
const phase4 = require('./phase4-model-results.json');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('Phase 5 report distinguishes measured synthetic effect from model or production improvement', () => {
  assert.equal(result.syntheticOnly, true); assert.equal(result.modelWeightsChanged, false);
  assert.equal(result.learningEffect.improved, true); assert.equal(result.counterexample.copiedPriorExperience, false);
  assert.equal(result.tasks.length, 6); assert.deepEqual(result.modelNecessityCounts, { MODEL_REQUIRED: 1, MODEL_OPTIONAL: 2, MODEL_NOT_REQUIRED: 3 });
  assert(result.tasks.every(row => typeof row.modelFreeCorrect === 'boolean'));
});

test('portable JSONL digest, splits, provenance and historical Phase 4 assets are consistent', () => {
  const lines = fs.readFileSync(path.join(dir, 'phase5-synthetic-v1.jsonl'), 'utf8');
  assert.equal(crypto.createHash('sha256').update(lines).digest('hex'), manifest.contentDigest); assert.equal(manifest.recordCount, 1); assert.equal(manifest.trainCount, 1);
  assert.equal(manifest.holdoutExcludedCount, 1);
  assert.equal(manifest.sourceExperienceDigests.length, 1);
  const record = JSON.parse(lines.trim()); assert.equal(record.schemaVersion, 'hugo-learning-v1'); assert.equal(record.split, 'TRAIN');
  assert(record.provenance.createdFromMemory); assert.doesNotMatch(lines, /synthetic-root|juan@example/i);
  for (const asset of historical.records) {
    const source = phase4.results.find(row => row.caseId === asset.caseId && row.promptVersion === asset.promptVersion);
    assert(source); assert.equal(asset.rawDigest, hash(source.rawModelResponse)); assert(['GOLDEN', 'HOLDOUT'].includes(asset.split));
  }
  assert(historical.records.some(row => row.caseId === 'ambiguous-other'));
  assert(historical.records.some(row => row.caseId === 'experience-relevant' && row.error === 'MAX_TOKENS'));
});

test('Hugo Learning Core and learning dataset formats have no provider or Firestore imports', () => {
  for (const name of ['learningContract.ts', 'learningStore.ts', 'experienceBuilder.ts', 'learningEvaluation.ts']) {
    const source = fs.readFileSync(path.join(__dirname, '../../functions/src/modules/agent007/hugoCore', name), 'utf8');
    assert.doesNotMatch(source, /firebase-admin|firebase-functions|vertexGeminiAdapter|\.collection\(/, name);
  }
});
