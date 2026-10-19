const test = require('node:test');
const assert = require('node:assert/strict');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || !/^demo-pay0-e1-/.test(process.env.GCLOUD_PROJECT || '')) throw Error('Isolated demo emulator required');
const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
const callables = require('../../functions/lib/modules/agent007/callables');
const { FirestoreHugoLearningStore } = require('../../functions/lib/modules/agent007/firestoreHugoLearningStore');
const { FirestoreHugoLearningRuleStore } = require('../../functions/lib/modules/agent007/firestoreHugoLearningRuleStore');
const { HugoConversationCore } = require('../../functions/lib/modules/agent007/hugoCore/conversationCore');
const { HugoToolRouter } = require('../../functions/lib/modules/agent007/hugoCore/toolRouter');
const { Pay0Connector } = require('../../functions/lib/modules/agent007/pay0Connector');
global.fetch = async () => { throw Error('EXTERNAL_PROVIDER_FORBIDDEN'); };
const rootId = 'supervised-root', uid = 'supervised-reviewer', reader = 'supervised-reader';
const identity = { uid, rootId, role: 'superadmin' };
const query = { rootId, domain: 'SOLICITUDES', taskType: 'REASON', entityType: 'SOLICITUD', features: { entityType: 'SOLICITUD', status: 'PENDIENTE', issueCode: 'DOCUMENT_MISSING' }, limit: 5 };
const invoke = (name, data, actor = uid) => callables[name].run({ auth: { uid: actor, token: {} }, data });
const rules = () => new FirestoreHugoLearningRuleStore(db);
const review = data => invoke('reviewAgent007LearningRule', data);

async function experience(id, behavior = 'VERIFY_DOCUMENT_BEFORE_DECISION') {
  const at = n => admin.firestore.Timestamp.fromMillis(Date.now() - 60000 + n);
  const entityReference = { sourceSystem: 'PAY0', entityType: 'SOLICITUD', entityId: id };
  await Promise.all([
    db.doc(`agent007Observations/obs_${id}`).set({ rootId, caseId: id, caseType: 'SOLICITUD', sourceSystem: 'PAY0', source: 'ACTIVITY_LOG', createdAt: at(0) }),
    db.doc(`agent007Observations/outcome_${id}`).set({ rootId, caseId: id, caseType: 'SOLICITUD', sourceSystem: 'PAY0', source: 'ACTIVITY_LOG', sourceEvent: 'SOLICITUD_COMPLETADA', createdAt: at(20000) }),
    db.doc(`agent007Memory/decision_${id}`).set({ rootId, kind: 'DECISION', status: 'CONFIRMED', entityReference, decision: { actorUid: uid, decisionType: 'APPROVED', decisionAt: at(10000).toDate().toISOString() } }),
    db.doc(`agent007Memory/memory_${id}`).set({ rootId, kind: 'EXPERIENCE', status: 'CONFIRMED', entityReference, links: { observationId: `obs_${id}`, decisionId: `decision_${id}`, outcomeId: `outcome_${id}` }, createdAt: at(30000).toDate().toISOString() }),
  ]);
  const result = await invoke('createAgent007LearningExperience', { memoryId: `memory_${id}`, domain: query.domain, taskType: query.taskType, intent: 'EXPLAIN_DELAY', questionClass: 'DOCUMENT_REVIEW', features: query.features });
  await invoke('correctAgent007LearningExperience', { experienceId: result.id, originalBehavior: 'COPY_PRIOR_ACTION', correctedBehavior: behavior, expectedBehavior: behavior,
    reasonCode: 'OUTCOME_SUPPORTED_CORRECTION', scope: 'ENTITY_TYPE', evidenceReferences: [{ system: 'PAY0', kind: 'OUTCOME', id: `outcome_${id}` }] });
  return result.id;
}
async function coreResponse(actor = reader) {
  const activeIdentity = { ...identity, uid: actor }, connector = new Pay0Connector(db, activeIdentity);
  const router = new HugoToolRouter(activeIdentity, { getSolicitud: ({ folio }) => connector.getSolicitud(folio),
    getPaymentComplementStatus: ({ folio }) => connector.getPaymentComplementStatus(folio), getIqCapabilities: () => connector.getIqCapabilities() });
  return new HugoConversationCore(router, null, undefined, new FirestoreHugoLearningStore(db)).respond({ channel: 'EVAL', conversationId: `${rootId}_${actor}`, identity: activeIdentity,
    name: 'Prueba', message: '¿Por qué sigue pendiente S123456 si falta el documento?', promptVersion: 'hugo-v2' });
}

test('persisted supervised rule is evaluated, approved, used by Core and revoked with current evidence', { timeout: 90000 }, async t => {
  await Promise.all([uid, reader].map(id => db.doc(`users/${id}`).set({ rootId, role: 'superadmin', active: true })));
  await db.doc('solicitudes/current-case').set({ rootId, folio: 'S123456', status: 'PENDIENTE', amount: 1, createdAt: admin.firestore.Timestamp.now() });
  const originalCase = (await db.doc('solicitudes/current-case').get()).data();
  const support = [await experience('support-a'), await experience('support-b')];
  let ruleId;
  await t.test('default gate rejects activation and makes no rule', async () => {
    delete process.env.HUGO_SUPERVISED_RULES_ENABLED;
    await assert.rejects(review({ action: 'APPROVE', supportingIds: support }), e => e.code === 'failed-precondition');
    assert.equal((await db.collection('agent007LearnedRules').get()).size, 0);
    assert.notEqual((await coreResponse()).responsePolicy, 'SUPERVISED_DOCUMENT_REVIEW');
  });
  process.env.HUGO_SUPERVISED_RULES_ENABLED = 'true';
  await t.test('two independent verified outcomes and human review persist one evaluated rule', async () => {
    await assert.rejects(review({ action: 'APPROVE', supportingIds: [support[0]] }), e => e.code === 'invalid-argument');
    const approved = await review({ action: 'APPROVE', supportingIds: support });
    ruleId = approved.ruleId;
    assert.equal(approved.status, 'ACTIVE');
    assert.equal((await review({ action: 'APPROVE', supportingIds: support })).version, 1, 'repeated approval is idempotent');
    const persisted = (await db.doc(`agent007LearnedRules/${ruleId}`).get()).data();
    assert.equal(persisted.approvedBy, uid);
    assert.equal(persisted.evaluation.improved, true);
    assert.equal(persisted.evaluation.modelAdapter, 'NONE');
    assert.ok(Date.parse(persisted.expiresAt) > Date.now());
    const reply = await coreResponse();
    assert.equal(reply.responsePolicy, 'SUPERVISED_DOCUMENT_REVIEW');
    assert.equal(reply.learningUsage.appliedRuleId, ruleId);
    assert.match(reply.text, /no confirma que falte un documento/);
    assert.equal(reply.model.model, 'none');
    assert.deepEqual((await db.doc('solicitudes/current-case').get()).data(), originalCase);
  });
  await t.test('explicit human revocation persists and stops subsequent use', async () => {
    assert.equal((await review({ action: 'REVOKE', ruleId })).status, 'INVALIDATED');
    assert.equal((await review({ action: 'REVOKE', ruleId })).version, 2);
    assert.notEqual((await coreResponse()).responsePolicy, 'SUPERVISED_DOCUMENT_REVIEW');
    assert.equal((await db.doc(`agent007LearnedRules/${ruleId}`).get()).get('invalidatedBy'), 'HUMAN_REVOKED');
  });
  await t.test('current case boundary, expiry and evidence revocation are checked on every read', async () => {
    await review({ action: 'APPROVE', supportingIds: support });
    await db.doc('solicitudes/current-case').update({ status: 'COMPLETADA' });
    assert.equal(await rules().resolve(identity, query, 'current-case', 'S123456'), null);
    await db.doc('solicitudes/current-case').update({ status: 'PENDIENTE' });
    await db.doc('solicitudes/current-case').update({ isDeleted: true });
    assert.equal(await rules().resolve(identity, query, 'current-case', 'S123456'), null);
    await db.doc('solicitudes/current-case').update({ isDeleted: admin.firestore.FieldValue.delete() });
    await db.doc(`agent007LearnedRules/${ruleId}`).update({ expiresAt: new Date(1).toISOString() });
    assert.equal(await rules().resolve(identity, query, 'current-case', 'S123456'), null);
    assert.equal((await db.doc(`agent007LearnedRules/${ruleId}`).get()).get('invalidatedBy'), 'EXPIRED');
    await review({ action: 'APPROVE', supportingIds: support });
    await db.doc('agent007Memory/memory_support-a').update({ status: 'REJECTED' });
    assert.equal(await rules().resolve(identity, query, 'current-case', 'S123456'), null);
    assert.equal((await db.doc(`agent007LearnedRules/${ruleId}`).get()).get('invalidatedBy'), 'EVIDENCE_REVOKED');
    await assert.rejects(review({ action: 'APPROVE', supportingIds: support }), e => e.code === 'failed-precondition');
    await db.doc('agent007Memory/memory_support-a').update({ status: 'CONFIRMED' });
  });
  await t.test('contradiction invalidates active rule and blocks reapproval', async () => {
    await review({ action: 'APPROVE', supportingIds: support });
    const contradiction = await experience('counterexample', 'CHECK_INVOICE_FIRST');
    const reply = await coreResponse();
    assert.equal(reply.responsePolicy, 'LEARNING_CONFLICT');
    assert.equal((await db.doc(`agent007LearnedRules/${ruleId}`).get()).get('invalidatedBy'), 'CONTRADICTION');
    await assert.rejects(review({ action: 'APPROVE', supportingIds: support }), e => e.code === 'failed-precondition');
    await invoke('assignAgent007LearningSplit', { experienceId: contradiction, split: 'HOLDOUT' });
    await review({ action: 'APPROVE', supportingIds: support });
    await invoke('assignAgent007LearningSplit', { experienceId: support[0], split: 'HOLDOUT' });
    assert.equal(await rules().resolve(identity, query, 'current-case', 'S123456'), null);
    assert.equal((await db.doc(`agent007LearnedRules/${ruleId}`).get()).get('invalidatedBy'), 'SUPPORT_REVOKED');
  });
  await t.test('unauthenticated, revoked actor, foreign root and disabled gate cannot administer or use rules', async () => {
    await assert.rejects(callables.reviewAgent007LearningRule.run({ data: { action: 'REVOKE', ruleId } }), e => e.code === 'unauthenticated');
    await db.doc(`users/${uid}`).update({ role: 'admin' });
    await assert.rejects(review({ action: 'REVOKE', ruleId }), e => e.code === 'permission-denied');
    await db.doc(`users/${uid}`).update({ role: 'superadmin', active: false });
    await assert.rejects(rules().resolve(identity, query, 'current-case', 'S123456'), e => e.code === 'permission-denied');
    await db.doc(`users/${reader}`).update({ active: false });
    const blocked = await coreResponse();
    assert.equal(blocked.responsePolicy, 'LEARNING_RETRIEVAL_UNAVAILABLE');
    assert.doesNotMatch(blocked.text, /S123456|monto/i);
    await db.doc(`users/${reader}`).update({ active: true });
    await db.doc(`users/${uid}`).update({ active: true, rootId: 'other-root' });
    await assert.rejects(review({ action: 'REVOKE', ruleId, rootId }), e => e.code === 'not-found');
    await assert.rejects(rules().resolve(identity, query, 'current-case', 'S123456'), e => e.code === 'permission-denied');
    delete process.env.HUGO_SUPERVISED_RULES_ENABLED;
    assert.equal(await rules().resolve(identity, query, 'current-case', 'S123456'), null);
    assert.deepEqual((await db.doc('solicitudes/current-case').get()).data(), originalCase);
  });
  await db.terminate();
});
