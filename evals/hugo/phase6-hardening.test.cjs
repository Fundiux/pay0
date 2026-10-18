const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = '../../functions/lib/modules/agent007/hugoCore/';
const { buildVerifiedExperience, withCorrection, buildDraftExperience, withOutcome } = require(core + 'experienceBuilder');
const { selectLearningExperiences } = require(core + 'learningStore');
const { applyHugoContextBudget, compactLearningExperience } = require(core + 'learningContextBudget');
const { proposeRuleCandidates } = require(core + 'learningEvaluation');
const { approveSyntheticRule, applyCompiledRule, invalidateCompiledRule } = require(core + 'compiledRule');
const { internalTrainingAuthorization, externalProviderAuthorization } = require(core + 'learningGovernance');
const { validateStructuredCandidate } = require(core + 'claimValidation');
const { HugoConversationCore } = require(core + 'conversationCore');
const { emptyConversationState } = require(core + 'conversationState');
const rootId = 'phase6-synthetic-root', at = n => new Date(Date.UTC(2026, 8, 22, 12, n)).toISOString();
function source(id) { const entityId = `case_${id}`; return { rootId, experienceId: `learning_${id}`, domain: 'SOLICITUDES', taskType: 'REASON', intent: 'EXPLAIN_DELAY', questionClass: 'OPERATIONAL_CAUSE',
  memory: { id: `memory_${id}`, rootId, status: 'CONFIRMED', kind: 'EXPERIENCE', entityReference: { sourceSystem: 'PAY0', entityType: 'SOLICITUD', entityId },
    links: { observationId: `obs_${id}`, decisionId: `decision_${id}`, outcomeId: `outcome_${id}` }, createdAt: at(3) },
  observation: { id: `obs_${id}`, rootId, caseId: entityId, source: 'ACTIVITY_LOG', createdAt: at(0) },
  decision: { id: `decision_${id}`, rootId, kind: 'DECISION', status: 'CONFIRMED', entityId, actorUid: 'admin', decisionType: 'APPROVED', decidedAt: at(1) },
  outcome: { id: `outcome_${id}`, rootId, caseId: entityId, source: 'ACTIVITY_LOG', sourceEvent: 'SOLICITUD_COMPLETADA', occurredAt: at(2) },
  features: { entityType: 'SOLICITUD', status: 'PENDIENTE', issueCode: 'DOCUMENT_MISSING' }, now: at(3) }; }
function verified(id, behavior = 'VERIFY_DOCUMENT_BEFORE_DECISION') { const a = source(id), row = buildVerifiedExperience(a);
  return withCorrection(row, { originalBehavior: 'COPY_PRIOR_ACTION', correctedBehavior: behavior, reasonCode: 'OUTCOME_SUPPORTED_CORRECTION',
    actorUid: 'admin', correctedAt: at(4), scope: 'ENTITY_TYPE', evidenceReferences: [{ system: 'PAY0', kind: 'OUTCOME', id: a.outcome.id, rootId }] }, behavior); }
const query = { rootId, domain: 'SOLICITUDES', taskType: 'REASON', entityType: 'SOLICITUD', features: { entityType: 'SOLICITUD', status: 'PENDIENTE', issueCode: 'DOCUMENT_MISSING' }, limit: 2 };

test('retrieval excludes protected and superseded teaching; unresolved contradiction escalates', () => {
  const a = verified('a'), b = verified('b', 'CHECK_INVOICE_FIRST');
  assert.equal(selectLearningExperiences([a, b], query).conflict, true);
  assert.equal(selectLearningExperiences([a, b], query).selected.length, 0);
  assert.deepEqual(selectLearningExperiences([{ ...a, state: 'SUPERSEDED', supersededById: b.experienceId }, b], query).selected.map(x => x.experienceId), [b.experienceId]);
  assert.equal(selectLearningExperiences([{ ...a, split: 'HOLDOUT', protectedCaseIds: [a.experienceId] }], query).selected.length, 0);
  assert.equal(selectLearningExperiences([a], { ...query, rootId: 'other' }).selected.length, 0);
});

test('budget retains current evidence and drops lower priority history before verified experience', () => {
  const context = { solicitudes: [{ folio: 'S61001', estado: 'PENDIENTE' }], pagos: [], activeEntity: { type: 'SOLICITUD', folio: 'S61001' }, evidenceBoundaries: {},
    observacionesHistoricasNoVerificadas: [{ content: 'x'.repeat(2000) }], memoriasHistoricas: [{ content: 'y'.repeat(2000) }],
    learningExperiences: [compactLearningExperience(verified('a'))] };
  const base = JSON.stringify(context.solicitudes), report = applyHugoContextBudget(context, 1200);
  assert.equal(report.exceeded, false); assert.equal(report.historyDropped, 1); assert.equal(report.memoriesDropped, 1);
  assert.equal(JSON.stringify(context.solicitudes), base); assert.equal(context.learningExperiences.length, 1);
  assert.equal(JSON.stringify(compactLearningExperience(verified('a'))).includes('actorUid'), false);
});

test('weak chronology, missing outcome and unrelated correction evidence fail closed', () => {
  const a = source('bad');
  assert.throws(() => buildDraftExperience({ ...a, decisionMemoryId: a.decision.id, observation: { ...a.observation, createdAt: 'invalid' } }), /LINEAGE/);
  const draft = buildDraftExperience({ ...a, decisionMemoryId: a.decision.id });
  assert.equal(draft.trainingEligibility.eligible, false);
  assert.throws(() => withCorrection(draft, { originalBehavior: 'COPY', correctedBehavior: 'CHECK', reasonCode: 'HUMAN', actorUid: 'admin', correctedAt: at(4), scope: 'ENTITY',
    evidenceReferences: [{ system: 'PAY0', kind: 'OUTCOME', id: 'unrelated', rootId }] }, 'CHECK'), /CORRECTION_INVALID/);
  assert.throws(() => withOutcome(draft, { type: 'SOLICITUD_COMPLETADA', verified: true, occurredAt: at(0), reference: { system: 'PAY0', kind: 'OUTCOME', id: 'early', rootId } }), /OUTCOME_INVALID/);
});

test('two independent verified outcomes create one scoped candidate; approval and contradiction invalidate it', () => {
  const a = verified('a'), b = verified('b');
  assert.equal(proposeRuleCandidates([a, a]).length, 0);
  const [candidate] = proposeRuleCandidates([a, b]); assert.equal(candidate.supportingIds.length, 2);
  const rule = approveSyntheticRule(candidate, rootId, 'synthetic-reviewer', at(5));
  assert.equal(applyCompiledRule(rule, query), 'VERIFY_DOCUMENT_BEFORE_DECISION');
  assert.equal(applyCompiledRule(rule, { ...query, rootId: 'other' }), null);
  assert.equal(applyCompiledRule(rule, { ...query, features: { ...query.features, issueCode: 'BANK_REJECTED' } }), null);
  const invalidated = invalidateCompiledRule(rule, 'learning_contradiction');
  assert.equal(applyCompiledRule(invalidated, query), null); assert.equal(invalidated.invalidatedBy, 'learning_contradiction');
  assert.throws(() => approveSyntheticRule({ ...candidate, contradictoryIds: ['learning_contradiction'] }, rootId, 'reviewer', at(5)), /RULE_APPROVAL_UNSAFE/);
});

test('quality eligibility never implies internal or external training permission', () => {
  const record = verified('governance'); assert.equal(record.trainingEligibility.eligible, true);
  assert.equal(internalTrainingAuthorization(record).approved, false); assert.equal(externalProviderAuthorization(record).approved, false);
  const reviewed = { ...record, governance: { use: 'TRAINING_ELIGIBLE_INTERNAL', externalProvider: 'NOT_APPROVED', reviewedBy: 'human', reviewedAt: at(5) } };
  assert.equal(internalTrainingAuthorization(reviewed).approved, true); assert.equal(externalProviderAuthorization(reviewed).approved, false);
});

test('structured claims require real scoped evidence and cannot contradict current facts', () => {
  const scope = { evidenceIds: ['fact_s61003'], entityFacts: [{ id: 'S61003', status: 'PENDIENTE' }], experienceIds: ['learning_duplicate-document'], allowedActions: [], rootAggregateComplete: false };
  const good = { answer: 'Verificar la versión.', claims: [{ text: 'La solicitud está pendiente.', evidenceIds: ['fact_s61003'], entityId: 'S61003', field: 'status', value: 'PENDIENTE' }],
    referencedEntities: ['S61003'], experienceReferences: ['learning_duplicate-document'], proposedActions: [] };
  assert.equal(validateStructuredCandidate(good, scope).valid, true);
  const bad = { ...good, claims: [{ ...good.claims[0], evidenceIds: ['solicitudes[0]'], value: 'COMPLETADA' }] };
  assert.deepEqual(validateStructuredCandidate(bad, scope).reasons, ['CLAIM_EVIDENCE_UNKNOWN', 'CURRENT_FACT_CONTRADICTION']);
});

test('Hugo Core handles no model and timeout without fabricating a business fact', async () => {
  const identity = { uid: 'admin', rootId, role: 'superadmin' }, router = { assertIdentity() {}, execute: async request => ({ sourceSystem: 'PAY0', tool: request.name, scope: { rootId }, retrievedAt: at(5),
    completeness: request.name === 'getSolicitud' ? 'COMPLETE' : 'UNKNOWN', evidence: [], data: request.name === 'getSolicitud' ? { id: 'current', folio: 'S61001', estado: 'PENDIENTE', monto: 120 } : [],
    trace: { latencyMs: 0, result: 'OK' } }) }, data = { loadConversationState: async () => ({ history: [], memory: { recommendations: [], rules: [] }, recentEntities: [], conversationState: emptyConversationState(rootId) }),
      retrieveMemory: async () => ({ considered: 0, selected: [], legacyObservationsConsidered: 0, legacyObservations: [] }) };
  const input = { channel: 'EVAL', conversationId: `${rootId}_admin`, identity, name: 'Prueba', message: '¿Por qué sigue pendiente S61001?', promptVersion: 'hugo-v2' };
  const missing = await new HugoConversationCore(router, null, data).respond(input);
  assert.equal(missing.model.error, 'MODEL_UNAVAILABLE'); assert.match(missing.text, /razonamiento generativo no está disponible/);
  const timed = await new HugoConversationCore(router, { generate: async () => { throw Error('timeout'); } }, data).respond(input);
  assert.equal(timed.model.error, 'MODEL_TIMEOUT'); assert.equal(timed.source, 'DETERMINISTIC_FALLBACK');
  const count = await new HugoConversationCore(router, null, data).respond({ ...input, message: '¿Cuántas solicitudes hay en total?' });
  assert.equal(count.source, 'POLICY_RESPONSE'); assert.match(count.text, /muestra parcial/);
  const exact = await new HugoConversationCore(router, null, data).respond({ ...input, message: '¿Cuál es el estado de S61001?' });
  assert.equal(exact.responsePolicy, 'EXACT_FACT'); assert.match(exact.text, /PENDIENTE/);
  const prior = verified('reference');
  const withId = await new HugoConversationCore(router, { generate: async () => ({ text: `Seguí ${prior.experienceId}.`, model: 'Fake', modelVersion: '1', promptVersion: 'hugo-v2', tokenUsage: null }) },
    data, { retrieve: async () => ({ considered: 1, selected: [prior], rejected: [] }) }).respond({ ...input, message: '¿Por qué sigue pendiente S61001 si falta el documento?' });
  assert.equal(withId.responsePolicy, 'INTERNAL_EXPERIENCE_REFERENCE_REDACTED'); assert.doesNotMatch(withId.text, /learning_reference/);
  assert.deepEqual(withId.learningUsage.referencedByModel, [prior.experienceId]); assert.equal(withId.learningUsage.effectClassification, 'NOT_EVALUATED');
});

test('tool failure remains an infrastructure error with requested-tool lineage', async () => {
  const identity = { uid: 'admin', rootId, role: 'superadmin' };
  const router = { assertIdentity() {}, execute: async () => { throw Error('SYNTHETIC_TOOL_UNAVAILABLE'); } };
  const core = new HugoConversationCore(router, null);
  await assert.rejects(() => core.respond({ channel: 'EVAL', conversationId: `${rootId}_admin`, identity, name: 'Prueba',
    message: '¿Cuál es el estado de S61001?', promptVersion: 'hugo-v2' }), error => {
      assert.equal(error.message, 'SYNTHETIC_TOOL_UNAVAILABLE'); assert(error.hugoToolsRequested.includes('getSolicitud')); return true;
    });
});

test('non-generative learning modules remain free of Vertex and provider SDK imports', () => {
  for (const file of ['learningContract.ts', 'learningStore.ts', 'experienceBuilder.ts', 'learningEvaluation.ts', 'learningContextBudget.ts', 'compiledRule.ts', 'learningGovernance.ts', 'claimValidation.ts']) {
    const body = fs.readFileSync(path.resolve(__dirname, '../../functions/src/modules/agent007/hugoCore', file), 'utf8');
    assert.doesNotMatch(body, /from\s+["'][^"']*(?:vertex|firebase|openai|gemini)/i);
  }
});
