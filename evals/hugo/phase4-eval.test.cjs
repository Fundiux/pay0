const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cases = require('./phase4-dataset.cjs');
const result = require('./phase4-model-results.json');
const blind = require('./phase4-model-results-blind-review.json');

test('Phase 4 dataset keeps the five Phase 3 business fixtures and 18 unique paired cases', () => {
  assert.deepEqual(cases.slice(0, 5).map(x => x.id), ['solicitud-found', 'solicitud-missing', 'sample-boundary', 'iq-unknown', 'conversation-followup']);
  assert.equal(cases.length, 18); assert.equal(new Set(cases.map(x => x.id)).size, cases.length);
  assert.equal(cases[2].legacyContext.pagos.length, 1);
  assert.equal(cases[2].legacyContext.pagos[0].folio, 'P12345');
  assert.equal(cases[4].history[0].text, '¿Qué pasó con S12345?');
});

test('A/B artifact preserves paired model outputs and correction history', () => {
  assert.equal(result.pairedCases, cases.length); assert.equal(result.results.length, cases.length * 2);
  for (const row of cases) assert.deepEqual(result.results.filter(x => x.caseId === row.id).map(x => x.promptVersion), ['legacy-v1', 'hugo-v2']);
  assert.equal(result.scoringRevision, 4); assert.equal(result.scoringCorrections.length, 1); assert(result.pilotScoringCorrections.length >= 3);
  assert.equal(result.results.find(x => x.caseId === 'sample-boundary' && x.promptVersion === 'legacy-v1').responseClassification, 'FAIL');
  assert(result.results.filter(x => x.caseId === 'sample-boundary').every(x => x.rawModelResponse !== undefined));
  assert.equal(result.results.find(x => x.caseId === 'experience-relevant' && x.promptVersion === 'hugo-v2').error, 'MAX_TOKENS');
  assert.equal(blind.cases.length, cases.length);
  assert(blind.cases.every(x => x.reviewerChoice === null && x.responseA !== undefined && x.responseB !== undefined));
});

test('Hugo Core keeps Firestore collection names outside its modules', () => {
  const dir = path.resolve(__dirname, '../../functions/src/modules/agent007/hugoCore');
  for (const file of fs.readdirSync(dir).filter(x => x.endsWith('.ts'))) assert.doesNotMatch(fs.readFileSync(path.join(dir, file), 'utf8'), /agent007(?:Memory|Observations|Recommendations|Traces|Messages|Conversations)|\.collection\(/, file);
});
