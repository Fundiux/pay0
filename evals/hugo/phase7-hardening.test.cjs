const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto');
const { classifyAppropriateEffect, normalizeProviderError, shouldRetryProviderError } = require('../../functions/lib/modules/agent007/hugoCore/evaluationContract');
const { validateHumanReview } = require('../../functions/lib/modules/agent007/hugoCore/humanReviewContract');
const { validateStructuredCandidate } = require('../../functions/lib/modules/agent007/hugoCore/claimValidation');
const cases = require('./phase7/case-specs.cjs'); const manifest = require('./phase7/phase7-tournament-dataset-v1.manifest.json'); const dataset = require('./phase7/phase7-tournament-dataset-v1.json');
const analysis = require('./phase7/phase7-analysis.json'); const reanalysis = require('./phase7/phase7-phase6-reanalysis.json'); const experiments = require('./phase7/phase7-experiment-summary.json'); const privacy = require('./phase7/phase7-privacy-sanitization.json');
const invalidIntentRun = require('./phase7/phase7-real-model-invalid-intent.json');
const caseDiagnostics = require('./phase7/phase7-case-diagnostics.json');
const humanReview = require('./phase7/phase7-human-review-analysis.json');

test('appropriate-effect semantics distinguish useful change, correct stability and negative transfer', () => {
  assert.equal(classifyAppropriateEffect({ shouldChange: true, beforeAcceptable: false, afterAcceptable: true, materiallyChanged: true, counterexampleSafe: true }), 'APPROPRIATE_CHANGE');
  assert.equal(classifyAppropriateEffect({ shouldChange: false, beforeAcceptable: true, afterAcceptable: true, materiallyChanged: false, counterexampleSafe: true }), 'APPROPRIATE_STABILITY');
  assert.equal(classifyAppropriateEffect({ shouldChange: false, beforeAcceptable: true, afterAcceptable: false, materiallyChanged: true, counterexampleSafe: true }), 'INAPPROPRIATE_CHANGE');
  assert.equal(classifyAppropriateEffect({ shouldChange: true, beforeAcceptable: false, afterAcceptable: false, materiallyChanged: false, counterexampleSafe: true }), 'MISSED_BENEFICIAL_CHANGE');
});

test('provider errors normalize neutrally and retry policy is bounded', () => {
  assert.equal(normalizeProviderError('HTTP_429'), 'RATE_LIMIT'); assert.equal(normalizeProviderError('MODEL_TIMEOUT'), 'TIMEOUT'); assert.equal(normalizeProviderError('MAX_TOKENS'), 'MAX_TOKENS');
  assert.equal(normalizeProviderError('COMMAND_HANDLED'), null); assert.equal(shouldRetryProviderError('HTTP_429', 0), true); assert.equal(shouldRetryProviderError('HTTP_429', 2), false); assert.equal(shouldRetryProviderError('MAX_TOKENS', 0), false);
});

test('human review validation separates reviewed and skipped states', () => {
  const ids = { evalRunId: 'phase6-synthetic-gemini-v1', caseId: 'document-review' };
  assert.deepEqual(validateHumanReview({ ...ids, status: 'REVIEWED', choice: 'A_BETTER', reasons: ['CORRECTNESS'] }), []);
  assert.deepEqual(validateHumanReview({ ...ids, status: 'SKIPPED', reasons: [] }), []);
  assert.ok(validateHumanReview({ ...ids, status: 'SKIPPED', choice: 'A_BETTER', reasons: [] }).includes('SKIPPED_WITH_CHOICE'));
  assert.ok(validateHumanReview({ evalRunId: ids.evalRunId, caseId: 'invented', status: 'SKIPPED', reasons: [] }).includes('CASE_NOT_IN_FROZEN_REVIEW_SET'));
});

test('user-provided blind reviews are validated and decoded without inventing provenance', () => {
  assert.equal(humanReview.validationStatus, 'VALID'); assert.equal(humanReview.reviewed, 28); assert.equal(humanReview.incomplete, 0);
  assert.equal(humanReview.phases.PHASE4.reviewed, 18); assert.equal(humanReview.phases.PHASE4.preferenceCounts.LEGACY, 10);
  assert.equal(humanReview.phases.PHASE4.preferenceCounts.HUGO_V2, 4); assert.equal(humanReview.phases.PHASE4.bothAcceptable, 1);
  assert.equal(humanReview.phases.PHASE4.bothUnacceptable, 3); assert.equal(humanReview.phases.PHASE6.reviewed, 10);
  assert.equal(humanReview.phases.PHASE6.preferenceCounts.AFTER, 9); assert.equal(humanReview.phases.PHASE6.preferenceCounts.BEFORE, 1);
  assert.equal(humanReview.phases.PHASE6.incomplete, 0); assert.equal(humanReview.sourceArtifacts.length, 3);
  assert.equal(humanReview.phases.PHASE4.reasonsCaptured, 0); assert.equal(humanReview.phases.PHASE6.reviewerIdentity, 'NOT_CAPTURED_IN_LEGACY_EXPORT');
  assert.equal(analysis.humanReviewsCompleted, 28); assert.equal(analysis.humanReviewsPending, 0);
  assert.ok(analysis.domains.every(row => row.humanReviewStatus === 'NOT_REVIEWED_DIRECTLY'));
  assert.equal(reanalysis.humanReviewsCompleted, 7); assert.equal(reanalysis.humanReviewsPending, 0);
});

test('declared evidence aliases resolve context positions without accepting unknown aliases', () => {
  const scope = { evidenceIds: ['current_1'], entityFacts: [{ id: 'S1', status: 'PENDIENTE' }], experienceIds: [], allowedActions: [], rootAggregateComplete: false, evidenceAliases: { 'solicitudes[0]': 'current_1' } };
  assert.equal(validateStructuredCandidate({ answer: 'ok', claims: [{ text: 'S1 pendiente', evidenceIds: ['solicitudes[0]'], entityId: 'S1', field: 'status', value: 'PENDIENTE' }], referencedEntities: ['S1'], experienceReferences: [], proposedActions: [] }, scope).valid, true);
  assert.equal(validateStructuredCandidate({ answer: 'bad', claims: [{ text: 'x', evidenceIds: ['solicitudes[99]'] }], referencedEntities: [], experienceReferences: [], proposedActions: [] }, scope).valid, false);
});

test('tournament dataset is frozen, split and protected by its committed digest', () => {
  assert.equal(cases.length, 28); assert.deepEqual(manifest.splitCounts, { DEVELOPMENT: 13, VALIDATION: 8, HOLDOUT: 7 });
  assert.equal(manifest.datasetDigest, 'd91845bc21be9fbcfe1f99377608a8fe72ddf57989f4c5c67c2d3072fd6b2096');
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(dataset)).digest('hex'), manifest.datasetDigest);
  assert.ok(dataset.cases.filter(row => row.split === 'HOLDOUT').every(row => row.automaticScoring && row.humanReviewDimensions.length));
});

test('Phase 6 history is preserved while seven no-effect cases receive a new analysis layer', () => {
  assert.equal(reanalysis.historicalArtifactMutated, false); assert.equal(reanalysis.count, 7); assert.equal(reanalysis.summary.appropriateStability, 7);
  assert.ok(reanalysis.rows.every(row => row.phase6Original === 'NO_EFFECT' && row.beforeRaw && row.afterRaw));
});

test('expanded real-model suite records full flow, retrieval and provider errors', () => {
  assert.equal(analysis.familyCount, 28); assert.equal(Object.values(analysis.classifications).reduce((a,b)=>a+b,0), 28);
  assert.equal(analysis.retrieval.retrieved, analysis.retrieval.expectedRelevant); assert.ok(analysis.tokenAndLatency.completedGenerativeArms > 80);
  assert.ok(analysis.providerErrors.MAX_TOKENS > 0); assert.ok(analysis.fullFlow.providerFailureGracefulDegradation >= analysis.providerErrors.MAX_TOKENS);
});

test('the invalid intent-encoding run is preserved and excluded from Phase 7 analysis', () => {
  assert.ok(invalidIntentRun.families.every(family => family.arms.every(arm => arm.learningUsage == null)));
  assert.notEqual(invalidIntentRun.executedAt, require('./phase7/phase7-real-model-results.json').executedAt);
});

test('post-run causal diagnosis preserves preregistered scoring and exposes task-design conflict', () => {
  assert.equal(caseDiagnostics.automaticScoringPreserved, true); assert.equal(caseDiagnostics.cases[0].automaticClassification, 'MISSED_BENEFICIAL_CHANGE');
  assert.equal(caseDiagnostics.cases[0].causalDiagnosis, 'TASK_DESIGN_CONFLICT');
});

test('ablation, token matrix and privacy conclusions remain evidence bounded', () => {
  assert.equal(experiments.ablation.compactVsFull.behavior, 'EQUIVALENT_ON_FOUR_CASES'); assert.ok(experiments.ablation.compactVsFull.averageInputTokenReductionPercent > 0);
  assert.equal(experiments.tokenInvestigation.outcome, 'UNDERSTOOD_NOT_MITIGATED'); assert.equal(privacy.productionExportReadiness, 'NOT_READY');
  assert.ok(Object.values(privacy.assertions).every(Boolean));
});

test('Phase 7 non-generative contracts have no provider SDK dependency', () => {
  for (const file of ['evaluationContract.ts','humanReviewContract.ts','claimValidation.ts']) { const source = fs.readFileSync(path.join(__dirname, '../../functions/src/modules/agent007/hugoCore', file), 'utf8'); assert.doesNotMatch(source, /VertexGeminiAdapter|aiplatform|@google|openai/i); }
});

test('no OpenAI dependency or call was added', () => {
  const packageFiles = [fs.readFileSync(path.join(__dirname, '../../package.json'),'utf8'), fs.readFileSync(path.join(__dirname, '../../functions/package.json'),'utf8')].join('\n'); assert.doesNotMatch(packageFiles, /openai/i);
});
