const assert = require('node:assert/strict');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || process.env.GCLOUD_PROJECT !== 'demo-pay0') throw Error('Local emulator required');
global.fetch = async () => { throw Error('EXTERNAL_NETWORK_FORBIDDEN'); };
const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: 'demo-pay0' });
const db = admin.firestore();
const callables = require('../../functions/lib/modules/agent007/callables');
const { FirestoreHugoLearningStore } = require('../../functions/lib/modules/agent007/firestoreHugoLearningStore');
const { HugoConversationCore } = require('../../functions/lib/modules/agent007/hugoCore/conversationCore');
const { emptyConversationState } = require('../../functions/lib/modules/agent007/hugoCore/conversationState');
const store = new FirestoreHugoLearningStore(db);
const root = `hugo-phase5-${Date.now()}`, other = `${root}-other`, caseId = `${root}-sol`;
const auth = { uid: root, token: { role: 'superadmin' } };
const time = minutes => admin.firestore.Timestamp.fromDate(new Date(Date.now() - (10 - minutes) * 60000));
async function rejects(call, code) { await assert.rejects(call, error => error.code === code || error.code?.endsWith(`/${code}`)); }
async function main() {
  await db.doc(`users/${root}`).set({ role: 'superadmin', rootId: root, active: true });
  await db.doc(`users/${other}`).set({ role: 'superadmin', rootId: other, active: true });
  const ids = { observation: `obs_${root}`, decision: `decision_${root}`, outcome: `outcome_${root}`, memory: `experience_${root}`, trace: `trace_${root}` };
  await db.doc(`agent007Observations/${ids.observation}`).set({ rootId: root, caseId, source: 'ACTIVITY_LOG', sourceEvent: 'SOLICITUD_STATUS_ACTUALIZADO', createdAt: time(0) });
  await db.doc(`agent007Memory/${ids.decision}`).set({ rootId: root, kind: 'DECISION', status: 'CONFIRMED', entityReference: { sourceSystem: 'PAY0', entityType: 'SOLICITUD', entityId: caseId },
    links: { observationId: ids.observation, linkStatus: 'LINKED' }, decision: { actorUid: root, actorRole: 'superadmin', decisionType: 'APPROVED', decisionAt: time(1).toDate().toISOString() } });
  await db.doc(`agent007Observations/${ids.outcome}`).set({ rootId: root, caseId, source: 'ACTIVITY_LOG', sourceEvent: 'SOLICITUD_COMPLETADA', createdAt: time(2) });
  await db.doc(`agent007Memory/${ids.memory}`).set({ rootId: root, kind: 'EXPERIENCE', status: 'CONFIRMED', entityReference: { sourceSystem: 'PAY0', entityType: 'SOLICITUD', entityId: caseId },
    links: { observationId: ids.observation, decisionId: ids.decision, outcomeId: ids.outcome }, createdAt: time(3).toDate().toISOString() });
  await db.doc(`agent007Traces/${ids.trace}`).set({ rootId: root, evidenceReferences: [{ sourceSystem: 'PAY0', entityType: 'solicitud', entityId: caseId }],
    promptVersion: 'hugo-v2', model: 'FakeA', modelProvider: 'TEST', modelVersion: '1', resultStatus: 'MODEL_RESPONSE' });
  await rejects(() => callables.createAgent007LearningExperience.run({ auth: null, data: { memoryId: ids.memory } }), 'unauthenticated');
  await rejects(() => callables.createAgent007LearningExperience.run({ auth: { uid: other, token: { role: 'superadmin' } }, data: { memoryId: ids.memory,
    domain: 'SOLICITUDES', taskType: 'REASON', intent: 'EXPLAIN_DELAY', questionClass: 'DOCUMENT_REVIEW', features: { entityType: 'SOLICITUD' } } }), 'failed-precondition');
  const input = { memoryId: ids.memory, traceId: ids.trace, domain: 'SOLICITUDES', taskType: 'REASON', intent: 'EXPLAIN_DELAY', questionClass: 'DOCUMENT_REVIEW',
    features: { entityType: 'SOLICITUD', status: 'PENDIENTE', issueCode: 'DOCUMENT_MISSING' } };
  const created = await callables.createAgent007LearningExperience.run({ auth, data: input });
  assert.equal(created.created, true); assert.equal(created.trainingEligibility.eligible, false);
  assert.equal((await callables.createAgent007LearningExperience.run({ auth, data: input })).created, false);
  const evidenceReferences = [{ system: 'PAY0', kind: 'OUTCOME', id: ids.outcome }];
  const corrected = await callables.correctAgent007LearningExperience.run({ auth, data: { experienceId: created.id, originalBehavior: 'COPY_PRIOR_ACTION',
    correctedBehavior: 'VERIFY_DOCUMENT_BEFORE_DECISION', reasonCode: 'OUTCOME_SUPPORTED_CORRECTION', expectedBehavior: 'VERIFY_DOCUMENT_BEFORE_DECISION', evidenceReferences } });
  assert.equal(corrected.trainingEligibility.eligible, true);
  await rejects(() => callables.correctAgent007LearningExperience.run({ auth, data: { experienceId: created.id, originalBehavior: 'COPY_PRIOR_ACTION',
    correctedBehavior: 'VERIFY_DOCUMENT_BEFORE_DECISION', reasonCode: 'DUPLICATE', expectedBehavior: 'VERIFY_DOCUMENT_BEFORE_DECISION', evidenceReferences } }), 'failed-precondition');
  const query = { rootId: root, domain: 'SOLICITUDES', taskType: 'REASON', entityType: 'SOLICITUD', features: input.features };
  assert.equal((await store.retrieve(query)).selected[0].experienceId, created.id);
  assert.equal((await store.retrieve({ ...query, features: { ...query.features, issueCode: 'BANK_REJECTED' } })).selected.length, 0);
  assert.equal((await store.retrieve({ ...query, rootId: other })).selected.length, 0);
  const fakeData = { loadConversationState: async () => ({ history: [], memory: { recommendations: [], rules: [] }, recentEntities: [], conversationState: emptyConversationState(root) }),
    retrieveMemory: async () => ({ considered: 0, selected: [], legacyObservationsConsidered: 0, legacyObservations: [] }) };
  const fakeRouter = { assertIdentity() {}, execute: async request => ({ sourceSystem: 'PAY0', tool: request.name, scope: { rootId: root }, retrievedAt: new Date().toISOString(),
    completeness: request.name === 'getSolicitud' ? 'COMPLETE' : 'UNKNOWN', evidence: [],
    data: request.name === 'getSolicitud' ? { id: caseId, folio: 'S12345', estado: 'PENDIENTE', monto: 120 } : [], trace: { latencyMs: 1, result: 'OK' } }) };
  const fakeModel = name => ({ generate: async () => { throw Error('canonical expected'); }, generateCanonical: async request => {
    const text = request.intelligence.learningExperiences.length ? 'VERIFY_DOCUMENT_BEFORE_DECISION' : 'COPY_PRIOR_ACTION';
    return { text, answer: text, claims: [], entityReferences: [], uncertainties: [], proposedActions: [], model: name, modelVersion: '1', provider: 'TEST', promptVersion: 'hugo-v2', tokenUsage: null }; } });
  const conversationInput = { channel: 'WEB', conversationId: `${root}_${root}`, identity: { uid: root, rootId: root, role: 'superadmin' }, name: 'Prueba',
    message: '¿Por qué sigue pendiente S12345 si falta el documento?', promptVersion: 'hugo-v2' };
  const beforeLearning = await new HugoConversationCore(fakeRouter, fakeModel('FakeA'), fakeData, { retrieve: async () => ({ considered: 0, selected: [], rejected: [] }) }).respond(conversationInput);
  const afterLearning = await new HugoConversationCore(fakeRouter, fakeModel('FakeA'), fakeData, store).respond(conversationInput);
  const replacedModel = await new HugoConversationCore(fakeRouter, fakeModel('FakeB'), fakeData, store).respond(conversationInput);
  assert.equal(beforeLearning.text, 'COPY_PRIOR_ACTION'); assert.equal(afterLearning.text, 'VERIFY_DOCUMENT_BEFORE_DECISION');
  assert.equal(replacedModel.text, afterLearning.text); assert.deepEqual(afterLearning.learningUsage.includedIds, [created.id]);
  const laterTrace = `later_${root}`;
  await db.doc(`agent007Traces/${laterTrace}`).set({ rootId: root, model: 'FakeA', promptVersion: 'hugo-v2', learningUsage: afterLearning.learningUsage,
    evidenceReferences: [{ sourceSystem: 'PAY0', entityType: 'solicitud', entityId: caseId }] });
  await store.appendEvent(root, created.id, 'EXPERIENCE_RETRIEVED', root, { traceId: laterTrace });
  await store.recordEffect(root, { caseId: `${root}-later-eval`, experienceId: created.id, beforeCorrect: false, afterCorrect: true, currentFactsCorrect: true,
    overgeneralized: false, improved: true, modelAdapter: 'FakeA', promptVersion: 'hugo-v2', evidenceDigest: 'same-current-evidence' });
  assert.equal((await db.doc(`agent007LearningRevisions/${created.id}_1`).get()).exists, true);
  assert.equal((await db.doc(`agent007LearningRevisions/${created.id}_2`).get()).exists, true);
  const assigned = await callables.assignAgent007LearningSplit.run({ auth, data: { experienceId: created.id, split: 'HOLDOUT' } });
  assert.equal(assigned.trainingEligibility.eligible, false);
  await rejects(() => callables.assignAgent007LearningSplit.run({ auth, data: { experienceId: created.id, split: 'TRAIN' } }), 'failed-precondition');
  assert.equal((await store.listExportCandidates(root)).length, 0);
  const diagnostics = await callables.listAgent007LearningDiagnostics.run({ auth, data: {} });
  assert.equal(diagnostics.experiences.length, 1); assert.equal(diagnostics.experiences[0].state, 'VERIFIED');
  const ledger = await callables.listAgent007LearningLineage.run({ auth, data: { experienceId: created.id } });
  assert.deepEqual(new Set(ledger.events.map(x => x.type)), new Set(['EXPERIENCE_CREATED', 'EXPERIENCE_VERIFIED', 'CORRECTION_RECORDED', 'EXPERIENCE_RETRIEVED', 'LEARNING_EFFECT_MEASURED', 'SPLIT_ASSIGNED']));
  const laterCase = `${root}-later`, laterObs = `obs_${laterCase}`, laterDecision = `decision_${laterCase}`, laterOutcome = `outcome_${laterCase}`;
  await db.doc(`agent007Observations/${laterObs}`).set({ rootId: root, caseId: laterCase, source: 'ACTIVITY_LOG', sourceEvent: 'SOLICITUD_STATUS_ACTUALIZADO', createdAt: time(0) });
  await db.doc(`agent007Memory/${laterDecision}`).set({ rootId: root, kind: 'DECISION', status: 'CONFIRMED', entityReference: { sourceSystem: 'PAY0', entityType: 'SOLICITUD', entityId: laterCase },
    links: { observationId: laterObs, linkStatus: 'LINKED' }, decision: { actorUid: root, actorRole: 'superadmin', decisionType: 'APPROVED', decisionAt: time(1).toDate().toISOString() } });
  const draft = await callables.createAgent007LearningDraft.run({ auth, data: { decisionId: laterDecision, domain: 'SOLICITUDES', taskType: 'REASON', intent: 'EXPLAIN_DELAY',
    questionClass: 'DOCUMENT_REVIEW', features: input.features } });
  assert.equal(draft.state, 'WAITING_FOR_OUTCOME'); assert.equal(draft.trainingEligibility.eligible, false);
  const early = await callables.correctAgent007LearningExperience.run({ auth, data: { experienceId: draft.id, originalBehavior: 'COPY_PRIOR_ACTION',
    correctedBehavior: 'VERIFY_DOCUMENT_BEFORE_DECISION', reasonCode: 'HUMAN_CORRECTION', expectedBehavior: 'VERIFY_DOCUMENT_BEFORE_DECISION',
    evidenceReferences: [{ system: 'HUGO', kind: 'OBSERVATION', id: laterObs }] } });
  assert.equal(early.trainingEligibility.eligible, false);
  await db.doc(`agent007Observations/${laterOutcome}`).set({ rootId: root, caseId: laterCase, source: 'ACTIVITY_LOG', sourceEvent: 'SOLICITUD_COMPLETADA', createdAt: admin.firestore.Timestamp.now() });
  const linked = await callables.linkAgent007LearningOutcome.run({ auth, data: { experienceId: draft.id, outcomeId: laterOutcome } });
  assert.equal(linked.state, 'VERIFIED'); assert.equal(linked.trainingEligibility.eligible, true);
  const draftEvents = (await callables.listAgent007LearningLineage.run({ auth, data: { experienceId: draft.id } })).events.map(x => x.type);
  assert.deepEqual(new Set(draftEvents), new Set(['EXPERIENCE_CREATED', 'CORRECTION_RECORDED', 'OUTCOME_LINKED', 'EXPERIENCE_VERIFIED']));
  await rejects(() => callables.linkAgent007LearningOutcome.run({ auth, data: { experienceId: draft.id, outcomeId: laterOutcome } }), 'failed-precondition');
  await rejects(() => callables.listAgent007LearningLineage.run({ auth: { uid: other, token: { role: 'superadmin' } }, data: { experienceId: created.id } }), 'not-found');
  console.log(JSON.stringify({ ok: true, created: 2, correction: 2, outcomeLinked: 2, draftLifecycleVerified: true, crossRootDenied: true, holdoutProtected: true }));
}
main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
