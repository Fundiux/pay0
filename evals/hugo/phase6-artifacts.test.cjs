const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, 'phase6');
const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));

test('real-model artifact keeps controlled before/after and explicit provider errors', () => {
  const report = read('phase6-analysis.json'), original = read('phase6-real-model-results.json');
  assert.equal(report.syntheticOnly, true); assert.equal(report.familyCount, 10);
  assert.equal(report.classifications.POSITIVE_LEARNING_EFFECT, 1); assert.equal(report.classifications.NO_EFFECT, 7);
  assert.equal(report.retrieval.expectedRelevantIncluded, 10); assert.equal(report.retrieval.expectedCounterexamplesExcluded, 10);
  assert.equal(report.families.find(row => row.caseId === 'duplicate-document').validRunCount, 3);
  assert(original.families.slice(5).flatMap(row => row.arms).some(arm => arm.modelError === 'VERTEX_UNAVAILABLE'));
  assert.equal(report.humanReviewsCompleted, 0);
  for (const row of report.families) assert(row.observations.every(observation => observation.sameEvidence && observation.sameModelConfig && observation.retrieved && observation.counterExcluded));
});

test('token diagnostic retains failed attempts and separates mitigation experiment', () => {
  const diagnostic = read('phase6-token-diagnostic.json'), bounded = read('phase6-thinking-budget.json');
  const failures = diagnostic.results.flatMap(row => row.attempts).filter(attempt => attempt.finishReason === 'MAX_TOKENS');
  assert(failures.length >= 3); assert(failures.every(attempt => attempt.reasoningTokens >= 1100));
  assert(diagnostic.results.some(row => row.finish === 'MODEL_TIMEOUT'));
  assert.equal(bounded.experimentOnly, true); assert.equal(bounded.thinkingBudget, 512);
  assert(bounded.results.every(row => row.finishReason === 'STOP'));
});

test('structured, pressure, rule and blind-review artifacts preserve their limits', () => {
  const structured = read('phase6-structured-response.json'), pressure = read('phase6-pressure.json'), rule = read('phase6-rule-experiment.json'), blind = read('phase6-blind-review.json'), workload = read('phase6-workload.json');
  assert.equal(structured.results[1].validation.jsonParsed, true);
  assert(structured.results[1].validation.unknownEvidenceIds.length > 0);
  assert(pressure.scenarios.every(row => row.currentFactsPreserved)); assert.equal(pressure.noise.irrelevantIncluded, 0);
  assert.equal(rule.approval.synthetic, true); assert.equal(rule.counterexampleResult, null); assert.equal(rule.invalidation.resultAfterInvalidation, null);
  assert.equal(blind.cases.length, 10); assert.equal(blind.humanReviewStatus, 'PENDING');
  assert.equal(workload.totalTasks, 14); assert.equal(workload.safelyResolvedWithoutModel, 4);
});
