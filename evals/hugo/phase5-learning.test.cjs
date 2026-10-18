const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const coreDir = '../../functions/lib/modules/agent007/hugoCore/';
const { buildDraftExperience, buildVerifiedExperience, withCorrection, withOutcome } = require(coreDir + 'experienceBuilder');
const { trainingEligibility } = require(coreDir + 'learningContract');
const { relevantExperience } = require(coreDir + 'learningStore');
const { decideWithoutModel, measureLearningEffect, proposeRuleCandidates } = require(coreDir + 'learningEvaluation');
const { HugoConversationCore } = require(coreDir + 'conversationCore');
const { emptyConversationState, advanceConversationState, resolveConversationReference } = require(coreDir + 'conversationState');
const { canonicalModelRequest } = require(coreDir + 'modelContract');
const { prepare, exportFromStore } = require('./learning/export.cjs');
const rootId = 'synthetic-root';
const iso = n => new Date(Date.UTC(2026, 8, 22, 12, n)).toISOString();
const artifacts = (id = 'case-a') => ({ rootId, experienceId: `learning_${id}`, domain: 'SOLICITUDES', taskType: 'REASON', intent: 'EXPLAIN_DELAY', questionClass: 'DOCUMENT_REVIEW',
  memory: { id: `experience_${id}`, rootId, status: 'CONFIRMED', kind: 'EXPERIENCE', entityReference: { sourceSystem: 'PAY0', entityType: 'SOLICITUD', entityId: id },
    links: { observationId: `obs_${id}`, decisionId: `decision_${id}`, outcomeId: `outcome_${id}` }, createdAt: iso(3) },
  observation: { id: `obs_${id}`, rootId, caseId: id, source: 'ACTIVITY_LOG', createdAt: iso(0) },
  decision: { id: `decision_${id}`, rootId, kind: 'DECISION', status: 'CONFIRMED', entityId: id, actorUid: 'admin', decisionType: 'APPROVED', decidedAt: iso(1) },
  outcome: { id: `outcome_${id}`, rootId, caseId: id, source: 'ACTIVITY_LOG', sourceEvent: 'SOLICITUD_COMPLETADA', occurredAt: iso(2) },
  trace: { id: `trace_${id}`, rootId, evidenceReferences: [{ sourceSystem: 'PAY0', entityType: 'solicitud', entityId: id }], promptVersion: 'hugo-v2', model: 'FakeA', modelVersion: '1', modelProvider: 'TEST', resultStatus: 'MODEL_RESPONSE' },
  features: { entityType: 'SOLICITUD', status: 'PENDIENTE', issueCode: 'DOCUMENT_MISSING' }, now: iso(3) });
const correction = id => ({ originalBehavior: 'COPY_PRIOR_ACTION', correctedBehavior: 'VERIFY_DOCUMENT_BEFORE_DECISION', reasonCode: 'OUTCOME_SUPPORTED_CORRECTION',
  actorUid: 'admin', correctedAt: iso(4), scope: 'ENTITY', evidenceReferences: [{ system: 'PAY0', kind: 'OUTCOME', id: `outcome_${id}`, rootId }] });
function verified(id = 'case-a') { return withCorrection(buildVerifiedExperience(artifacts(id)), correction(id), 'VERIFY_DOCUMENT_BEFORE_DECISION'); }
const query = (features = { entityType: 'SOLICITUD', status: 'PENDIENTE', issueCode: 'DOCUMENT_MISSING' }) => ({ rootId, domain: 'SOLICITUDES', taskType: 'REASON', entityType: 'SOLICITUD', features });

test('builder requires exact root, links, chronology and terminal outcome; correction creates eligible revision', () => {
  const draft = buildVerifiedExperience(artifacts());
  assert.equal(draft.state, 'VERIFIED'); assert.equal(draft.trainingEligibility.eligible, false); assert(draft.trainingEligibility.reasons.includes('EXPECTED_BEHAVIOR_MISSING'));
  const record = verified(); assert.equal(record.revision, 2); assert.equal(record.trainingEligibility.eligible, true); assert.equal(record.correction.reasonCode, 'OUTCOME_SUPPORTED_CORRECTION');
  for (const changed of [a => { a.outcome.rootId = 'other'; }, a => { a.memory.links.decisionId = 'wrong'; }, a => { a.outcome.occurredAt = iso(0); }, a => { a.outcome.sourceEvent = 'UNKNOWN'; }]) {
    const source = artifacts(); changed(source); assert.throws(() => buildVerifiedExperience(source), /LEARNING_LINEAGE_INVALID/);
  }
  assert.equal(trainingEligibility({ ...record, input: { ...record.input, ambiguity: 'UNRESOLVED' } }).eligible, false);
});

test('draft correction remains ineligible until a later linked outcome verifies it', () => {
  const source = artifacts('case-draft');
  const draft = buildDraftExperience({ ...source, decisionMemoryId: source.decision.id });
  assert.equal(draft.state, 'WAITING_FOR_OUTCOME'); assert.equal(draft.trainingEligibility.eligible, false);
  const corrected = withCorrection(draft, { ...correction('case-draft'), evidenceReferences: [{ system: 'HUGO', kind: 'OBSERVATION', id: source.observation.id, rootId }] }, 'VERIFY_DOCUMENT_BEFORE_DECISION');
  assert.equal(corrected.trainingEligibility.eligible, false);
  const complete = withOutcome(corrected, { type: 'SOLICITUD_COMPLETADA', verified: true, occurredAt: iso(5), reference: { system: 'PAY0', kind: 'OUTCOME', id: source.outcome.id, rootId } });
  assert.equal(complete.state, 'VERIFIED'); assert.equal(complete.trainingEligibility.eligible, true); assert.equal(complete.revision, 3);
  assert.throws(() => withOutcome(complete, complete.outcome), /LEARNING_OUTCOME_INVALID/);
});

test('structured retrieval excludes material counterexample and foreign root', () => {
  const record = verified(); assert.equal(relevantExperience(record, query()).selected, true);
  assert.match(relevantExperience(record, query({ entityType: 'SOLICITUD', status: 'PENDIENTE', issueCode: 'BANK_REJECTED' })).reason, /MATERIAL_DIFFERENCE/);
  assert.equal(relevantExperience(record, { ...query(), rootId: 'other' }).selected, false);
});

test('same deterministic policy improves after verified experience and rejects the counterexample', () => {
  const record = verified(), task = { caseId: 'case-b', query: query(), expectedBehavior: 'VERIFY_DOCUMENT_BEFORE_DECISION',
    currentFacts: { documentStatus: 'UNVERIFIED', status: 'PENDIENTE' }, modelNecessity: 'MODEL_OPTIONAL' };
  const before = decideWithoutModel(task, []), after = decideWithoutModel(task, [record]);
  const effect = measureLearningEffect({ task, experience: record, before, after, modelAdapter: 'NONE', promptVersion: 'policy-v1', evidenceDigest: 'same-evidence' });
  assert.equal(before.behavior, 'ESCALATE_UNKNOWN'); assert.equal(after.behavior, 'VERIFY_DOCUMENT_BEFORE_DECISION'); assert.equal(effect.improved, true);
  const different = { ...task, caseId: 'case-c', query: query({ entityType: 'SOLICITUD', status: 'PENDIENTE', issueCode: 'BANK_REJECTED' }), expectedBehavior: 'ESCALATE_UNKNOWN' };
  assert.equal(decideWithoutModel(different, [record]).behavior, 'ESCALATE_UNKNOWN');
  assert.equal(proposeRuleCandidates([record]).length, 0);
  assert.equal(proposeRuleCandidates([record, verified('case-d')])[0].status, 'RULE_CANDIDATE');
});

test('canonical request and persisted experience survive FakeA to FakeB replacement', async () => {
  const record = verified(), store = { list: async () => [record], retrieve: async request => ({ considered: 1, selected: relevantExperience(record, request).selected ? [record] : [], rejected: [] }) };
  let adapter = { name: 'FakeA', answer: request => request.intelligence.learningExperiences.length ? 'VERIFY_DOCUMENT_BEFORE_DECISION' : 'COPY_PRIOR_ACTION' };
  const request = canonicalModelRequest({ message: '¿Por qué?', name: 'Prueba', context: { learningExperiences: [record] }, history: [], promptVersion: 'hugo-v2' });
  assert.equal(request.intelligence.learningExperiences[0].experienceId, record.experienceId);
  assert.equal(adapter.answer(request), 'VERIFY_DOCUMENT_BEFORE_DECISION');
  adapter = { name: 'FakeB', answer: request => request.intelligence.learningExperiences.length ? 'VERIFY_DOCUMENT_BEFORE_DECISION' : 'COPY_PRIOR_ACTION' };
  assert.equal(adapter.answer(request), 'VERIFY_DOCUMENT_BEFORE_DECISION'); assert.equal((await store.list())[0].correction.correctedBehavior, 'VERIFY_DOCUMENT_BEFORE_DECISION');
  assert.doesNotMatch(fs.readFileSync(path.resolve(__dirname, '../../functions/src/modules/agent007/hugoCore/learningContract.ts'), 'utf8'), /firebase|vertex|gemini|openai/i);
});

test('full Core gives identical current evidence to two adapters while experience changes later behavior', async () => {
  const record = verified(), records = [], requests = [];
  const learningStore = { retrieve: async query => ({ considered: records.length, selected: records.filter(row => relevantExperience(row, query).selected), rejected: [] }) };
  const data = { loadConversationState: async () => ({ history: [], memory: { recommendations: [], rules: [] }, recentEntities: [], conversationState: emptyConversationState(rootId) }),
    retrieveMemory: async () => ({ considered: 0, selected: [], legacyObservationsConsidered: 0, legacyObservations: [] }) };
  const router = { assertIdentity() {}, execute: async request => ({ sourceSystem: 'PAY0', tool: request.name, scope: { rootId }, retrievedAt: iso(5), completeness: request.name === 'getSolicitud' ? 'COMPLETE' : 'UNKNOWN',
    evidence: [], data: request.name === 'getSolicitud' ? { id: 'case-b', folio: 'S12345', estado: 'PENDIENTE', monto: 120 } : [], trace: { latencyMs: 1, result: 'OK' } }) };
  const makeAdapter = name => ({ generate: async () => { throw Error('canonical path expected'); }, generateCanonical: async request => {
    requests.push({ adapter: name, request }); const answer = request.intelligence.learningExperiences.length ? 'VERIFY_DOCUMENT_BEFORE_DECISION' : 'COPY_PRIOR_ACTION';
    return { text: answer, answer, claims: [], entityReferences: [], uncertainties: [], proposedActions: [], model: name, modelVersion: '1', provider: 'TEST', promptVersion: 'hugo-v2', tokenUsage: null };
  } });
  const input = { channel: 'WEB', conversationId: 'synthetic-root_admin', identity: { uid: 'admin', rootId, role: 'superadmin' }, name: 'Prueba',
    message: '¿Por qué sigue pendiente S12345 si falta el documento?', promptVersion: 'hugo-v2' };
  const first = await new HugoConversationCore(router, makeAdapter('FakeA'), data, learningStore).respond(input);
  records.push(record);
  const second = await new HugoConversationCore(router, makeAdapter('FakeA'), data, learningStore).respond(input);
  const replaced = await new HugoConversationCore(router, makeAdapter('FakeB'), data, learningStore).respond(input);
  assert.equal(first.text, 'COPY_PRIOR_ACTION'); assert.equal(second.text, 'VERIFY_DOCUMENT_BEFORE_DECISION'); assert.equal(replaced.text, second.text);
  assert.deepEqual(requests[0].request.intelligence.currentEvidence, requests[1].request.intelligence.currentEvidence);
  assert.deepEqual(requests[1].request.intelligence.learningExperiences, requests[2].request.intelligence.learningExperiences);
  assert.deepEqual(second.learningUsage.includedIds, [record.experienceId]);
  const unavailable = await new HugoConversationCore(router, makeAdapter('FakeB'), data, { retrieve: async () => { throw Error('INDEX_UNAVAILABLE'); } }).respond(input);
  assert.equal(unavailable.learningUsage.error, 'LEARNING_RETRIEVAL_UNAVAILABLE'); assert.equal(unavailable.source, 'POLICY_RESPONSE'); assert.match(unavailable.text, /No pude consultar/);
});

test('export is canonical, sanitized and blocks holdout contamination', async () => {
  const record = { ...verified(), split: 'TRAIN', privateNote: 'Juan juan@example.com 012345678901234567' };
  const holdout = { ...verified('case-holdout'), split: 'HOLDOUT', protectedCaseIds: ['case-holdout'] };
  const options = { salt: 'synthetic-salt-at-least-sixteen', createdAt: iso(5), exportId: 'phase5-fixture' };
  const prepared = prepare([record, holdout], options);
  assert.equal(prepared.manifest.recordCount, 1); assert.equal(prepared.manifest.holdoutExcludedCount, 1);
  assert.doesNotMatch(prepared.lines, /Juan|juan@example|012345678901234567|synthetic-root|case-a/);
  assert.equal(prepared.manifest.contentDigest, crypto.createHash('sha256').update(prepared.lines).digest('hex'));
  assert.throws(() => prepare([{ ...record, protectedCaseIds: ['golden'] }], options), /EXPORT_HOLDOUT_CONTAMINATION/);
  assert.throws(() => prepare([{ ...record, features: { email: 'juan@example.com' } }], options), /EXPORT_UNSAFE_FEATURE/);
  assert.equal((await exportFromStore({ list: async () => [record] }, rootId, options)).manifest.recordCount, 1);
});

test('full served flow clarifies two folios without asking a model, and MAX_TOKENS falls back safely', async () => {
  const now = Date.now(), entity = folio => ({ system: 'PAY0', entityType: 'SOLICITUD', entityId: folio.toLowerCase(), folio, rootId, resolvedAt: now, resolvedTurn: 1, source: 'PAY0_EXACT_TOOL', confidence: 1 });
  const state = advanceConversationState(resolveConversationReference('S12345', emptyConversationState(rootId), rootId, now), [entity('S12345'), entity('S67890')], rootId);
  let calls = 0;
  const router = { assertIdentity() {}, execute: async request => ({ sourceSystem: 'PAY0', tool: request.name, scope: { rootId }, retrievedAt: new Date().toISOString(), completeness: 'COMPLETE', evidence: [],
    data: request.name === 'getSolicitud' ? { id: 's12345', folio: 'S12345', estado: 'PENDIENTE', monto: 120 } : [], trace: { latencyMs: 1, result: 'OK' } }) };
  const data = { loadConversationState: async () => ({ history: [], memory: { recommendations: [], rules: [] }, recentEntities: [], conversationState: state }),
    retrieveMemory: async () => ({ considered: 0, selected: [], legacyObservationsConsidered: 0, legacyObservations: [] }) };
  const model = { generate: async () => { calls++; return { text: null, error: 'MAX_TOKENS', model: 'FakeA', modelVersion: '1', promptVersion: 'hugo-v2', tokenUsage: null }; } };
  const core = new HugoConversationCore(router, model, data);
  const identity = { uid: 'admin', rootId, role: 'superadmin' };
  const ambiguous = await core.respond({ channel: 'WEB', conversationId: 'synthetic-root_admin', identity, name: 'Prueba', message: '¿Y el otro?', promptVersion: 'hugo-v2' });
  assert.equal(ambiguous.source, 'POLICY_RESPONSE'); assert.match(ambiguous.text, /S12345.*S67890/); assert.equal(calls, 0);
  const failed = await core.respond({ channel: 'WEB', conversationId: 'synthetic-root_admin', identity, name: 'Prueba', message: '¿Qué pasó con S12345?', promptVersion: 'hugo-v2' });
  assert.equal(failed.source, 'DETERMINISTIC_FALLBACK'); assert.match(failed.text, /No pude completar/); assert.equal(calls, 1);
});
