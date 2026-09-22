const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildDraftExperience, withCorrection, withOutcome } = require('../../../functions/lib/modules/agent007/hugoCore/experienceBuilder');
const { decideWithoutModel, measureLearningEffect, proposeRuleCandidates } = require('../../../functions/lib/modules/agent007/hugoCore/learningEvaluation');
const { prepare } = require('./export.cjs');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const rootId = 'synthetic-root';
const at = minute => new Date(Date.UTC(2026, 8, 22, 12, minute)).toISOString();
function experience(id) {
  const refs = { observationId: `obs_${id}`, decisionId: `decision_${id}`, outcomeId: `outcome_${id}` };
  const built = buildDraftExperience({ rootId, experienceId: `learning_${id}`, decisionMemoryId: refs.decisionId, domain: 'SOLICITUDES', taskType: 'REASON', intent: 'EXPLAIN_DELAY', questionClass: 'DOCUMENT_REVIEW',
    observation: { id: refs.observationId, rootId, caseId: id, source: 'ACTIVITY_LOG', createdAt: at(0) },
    decision: { id: refs.decisionId, rootId, kind: 'DECISION', status: 'CONFIRMED', entityId: id, actorUid: 'human', decisionType: 'APPROVED', decidedAt: at(1) },
    trace: { id: `trace_${id}`, rootId, evidenceReferences: [{ sourceSystem: 'PAY0', entityType: 'SOLICITUD', entityId: id }], promptVersion: 'hugo-v2', model: 'FakeA', modelVersion: '1', modelProvider: 'TEST', resultStatus: 'MODEL_RESPONSE' },
    features: { entityType: 'SOLICITUD', status: 'PENDIENTE', issueCode: 'DOCUMENT_MISSING' }, now: at(3) });
  const corrected = withCorrection(built, { originalBehavior: 'COPY_PRIOR_ACTION', correctedBehavior: 'VERIFY_DOCUMENT_BEFORE_DECISION', reasonCode: 'OUTCOME_SUPPORTED_CORRECTION', actorUid: 'human', correctedAt: at(4),
    scope: 'ENTITY', evidenceReferences: [{ system: 'HUGO', kind: 'OBSERVATION', id: refs.observationId, rootId }] }, 'VERIFY_DOCUMENT_BEFORE_DECISION');
  return withOutcome(corrected, { type: 'SOLICITUD_COMPLETADA', verified: true, occurredAt: at(5), reference: { system: 'PAY0', kind: 'OUTCOME', id: refs.outcomeId, rootId } });
}
const record = experience('case-a');
const baseQuery = { rootId, domain: 'SOLICITUDES', taskType: 'REASON', entityType: 'SOLICITUD', features: { entityType: 'SOLICITUD', status: 'PENDIENTE', issueCode: 'DOCUMENT_MISSING' } };
const task = { caseId: 'case-b', query: baseQuery, currentFacts: { documentStatus: 'UNVERIFIED', status: 'PENDIENTE' }, expectedBehavior: 'VERIFY_DOCUMENT_BEFORE_DECISION', modelNecessity: 'MODEL_OPTIONAL' };
const before = decideWithoutModel(task, []), after = decideWithoutModel(task, [record]);
const effect = measureLearningEffect({ task, experience: record, before, after, modelAdapter: 'NONE', promptVersion: 'policy-v1', evidenceDigest: hash(task.currentFacts) });
const counterTask = { ...task, caseId: 'case-c', query: { ...baseQuery, features: { ...baseQuery.features, issueCode: 'BANK_REJECTED' } }, expectedBehavior: 'ESCALATE_UNKNOWN' };
const counter = decideWithoutModel(counterTask, [record]);
const tasks = [
  { id: 'partial-total', necessity: 'MODEL_NOT_REQUIRED', task: { ...task, caseId: 'partial-total', query: { ...baseQuery, taskType: 'GLOBAL_COUNT' }, currentFacts: { completeness: 'PARTIAL' }, expectedBehavior: 'REFUSE_UNSUPPORTED_TOTAL' } },
  { id: 'ambiguous-reference', necessity: 'MODEL_NOT_REQUIRED', task: { ...task, caseId: 'ambiguous-reference', query: { ...baseQuery, taskType: 'AMBIGUOUS_REFERENCE' }, currentFacts: { ambiguity: 'UNRESOLVED' }, expectedBehavior: 'CLARIFY_FOLIO' } },
  { id: 'exact-status', necessity: 'MODEL_NOT_REQUIRED', task: { ...task, caseId: 'exact-status', query: { ...baseQuery, taskType: 'EXACT_STATUS' }, currentFacts: { evidenceComplete: 'COMPLETE_EXACT', status: 'PENDIENTE' }, expectedBehavior: 'REPORT_STATUS_PENDIENTE' } },
  { id: 'verified-pattern', necessity: 'MODEL_OPTIONAL', task },
  { id: 'material-counterexample', necessity: 'MODEL_OPTIONAL', task: counterTask },
  { id: 'novel-multisource-explanation', necessity: 'MODEL_REQUIRED', task: { ...task, caseId: 'novel-multisource-explanation', query: { ...baseQuery, features: { entityType: 'SOLICITUD', status: 'PENDIENTE', issueCode: 'NOVEL_MULTISOURCE' } }, expectedBehavior: 'SYNTHESIZE_CAUSE' } },
];
const measured = tasks.map(row => { const decision = decideWithoutModel(row.task, [record]); return { caseId: row.id, modelNecessity: row.necessity,
  observedModelFreeBehavior: decision.behavior, expectedBehavior: row.task.expectedBehavior, modelFreeCorrect: decision.behavior === row.task.expectedBehavior }; });
const count = Object.fromEntries(['MODEL_REQUIRED', 'MODEL_OPTIONAL', 'MODEL_NOT_REQUIRED'].map(kind => [kind, measured.filter(row => row.modelNecessity === kind).length]));
const phase4 = require('../phase4-model-results.json');
const protectedIds = ['sample-boundary', 'partial-zero', 'partial-several', 'ambiguous-other', 'experience-relevant', 'conversation-followup'];
const historical = protectedIds.flatMap(caseId => phase4.results.filter(row => row.caseId === caseId).map(row => ({ caseId, promptVersion: row.promptVersion, split: caseId === 'ambiguous-other' ? 'HOLDOUT' : 'GOLDEN',
  sourceRunId: phase4.evalRunId, sourceArtifact: 'evals/hugo/phase4-model-results.json', rawDigest: hash(row.rawModelResponse), responseClassification: row.responseClassification,
  error: row.error, expectedBehavior: { 'sample-boundary': 'REFUSE_UNSUPPORTED_TOTAL', 'partial-zero': 'REFUSE_UNSUPPORTED_TOTAL', 'partial-several': 'REFUSE_UNSUPPORTED_TOTAL',
    'ambiguous-other': 'CLARIFY_FOLIO', 'experience-relevant': 'VERIFY_DOCUMENT_BEFORE_DECISION', 'conversation-followup': 'RESOLVE_ACTIVE_ENTITY' }[caseId] })));
const exportable = { ...record, split: 'TRAIN' };
const prepared = prepare([exportable, { ...experience('case-holdout'), split: 'HOLDOUT', protectedCaseIds: ['case-holdout'] }],
  { salt: 'phase5-synthetic-fixture-salt', createdAt: at(5), exportId: 'phase5-synthetic-v1' });
const report = { schemaVersion: 'hugo-phase5-eval-v1', syntheticOnly: true, policyVersion: 'policy-v1', modelAdapter: 'NONE', modelWeightsChanged: false,
  sourceExperience: record.experienceId, experienceCreated: 1, experienceVerified: 1, correctionCaptured: 1, outcomeLinked: 1,
  learningEffect: { ...effect, before: before.behavior, after: after.behavior }, counterexample: { caseId: counterTask.caseId, behavior: counter.behavior, copiedPriorExperience: counter.experienceId !== null },
  ruleCandidates: proposeRuleCandidates([record]).length, tasks: measured, modelNecessityCounts: count,
  modelNecessityPercent: Object.fromEntries(Object.entries(count).map(([key, value]) => [key, Math.round(1000 * value / measured.length) / 10])),
  interpretation: 'Controlled synthetic policy effect, not evidence of Gemini improvement or production task distribution.' };
fs.writeFileSync(path.join(__dirname, 'phase5-experiment-results.json'), JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(path.join(__dirname, 'phase4-historical-assets.json'), JSON.stringify({ schemaVersion: 'hugo-eval-assets-v1', records: historical }, null, 2) + '\n');
fs.writeFileSync(path.join(__dirname, 'phase5-synthetic-v1.jsonl'), prepared.lines);
fs.writeFileSync(path.join(__dirname, 'phase5-synthetic-v1.manifest.json'), JSON.stringify(prepared.manifest, null, 2) + '\n');
console.log(JSON.stringify({ effect: effect.improved, counterexampleSafe: !counter.experienceId, measuredTasks: measured.length, modelNecessityCounts: count,
  exportCount: prepared.manifest.recordCount, holdoutExcluded: prepared.manifest.holdoutExcludedCount }));
