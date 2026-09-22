const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { proposeRuleCandidates } = require('../../../functions/lib/modules/agent007/hugoCore/learningEvaluation');
const { approveSyntheticRule, applyCompiledRule, invalidateCompiledRule } = require('../../../functions/lib/modules/agent007/hugoCore/compiledRule');
const rootId = 'phase6-synthetic-root';
const record = n => ({ experienceId: `learning_rule_${n}`, rootId, state: 'VERIFIED', outcome: { verified: true, type: 'SOLICITUD_COMPLETADA' },
  quality: { provenance: 'VERIFIED' }, expectedBehavior: 'VERIFY_DOCUMENT_BEFORE_DECISION', domain: 'SOLICITUDES', taskType: 'REASON',
  entityReferences: [{ entityId: `prior_case_${n}`, entityType: 'SOLICITUD' }], features: { entityType: 'SOLICITUD', status: 'PENDIENTE', issueCode: 'DOCUMENT_MISSING' } });
const supporting = [record(1), record(2)], candidates = proposeRuleCandidates(supporting);
if (candidates.length !== 1) throw Error('CANDIDATE_NOT_UNIQUE');
const candidate = candidates[0], rule = approveSyntheticRule(candidate, rootId, 'synthetic-human-approval', '2026-09-22T12:10:00.000Z');
const query = { rootId, domain: 'SOLICITUDES', taskType: 'REASON', entityType: 'SOLICITUD', features: supporting[0].features };
const started = performance.now(), behavior = applyCompiledRule(rule, query), latencyMs = performance.now() - started;
const counterexample = applyCompiledRule(rule, { ...query, features: { ...query.features, issueCode: 'BANK_REJECTED' } });
const invalidated = invalidateCompiledRule(rule, 'learning_later_contradiction');
const afterInvalidation = applyCompiledRule(invalidated, query);
const run = JSON.parse(fs.readFileSync(path.join(__dirname, 'phase6-real-model-results.json'), 'utf8'));
const modelArm = run.families.find(row => row.id === 'document-review').arms[1];
const artifact = { schemaVersion: 'hugo-phase6-rule-experiment-v1', syntheticOnly: true, supportingExperiences: supporting.map(row => row.experienceId),
  candidate: { ...candidate, status: 'RULE_CANDIDATE' }, approval: { actor: rule.approvedBy, synthetic: true, at: rule.approvedAt },
  rule: { ruleId: rule.ruleId, version: rule.version, scope: { rootId, domain: rule.domain, taskType: rule.taskType }, conditions: rule.features,
    exceptions: rule.exceptions, status: rule.status }, deterministicResult: { behavior, latencyMs, modelCalls: 0 },
  realModelComparison: { sourceCase: 'document-review', latencyMs: modelArm.elapsedMs, modelCalls: 1, response: modelArm.systemServed },
  counterexampleResult: counterexample, invalidation: { contradictoryExperienceId: invalidated.invalidatedBy, status: invalidated.status, resultAfterInvalidation: afterInvalidation },
  limit: 'Approval is synthetic. A code-valued deterministic behavior is not a production user response or a financial action.' };
fs.writeFileSync(path.join(__dirname, 'phase6-rule-experiment.json'), JSON.stringify(artifact, null, 2) + '\n');
console.log(JSON.stringify({ candidateCount: candidates.length, behavior, counterexample, afterInvalidation }));
