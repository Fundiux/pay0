const test = require('node:test');
const assert = require('node:assert/strict');

if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || !/^demo-pay0-e1-/.test(process.env.GCLOUD_PROJECT || '')) throw Error('Isolated demo emulator required');
const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
const callables = require('../../functions/lib/modules/agent007/callables');
const { FirestoreHugoLearningStore } = require('../../functions/lib/modules/agent007/firestoreHugoLearningStore');
const { decideWithoutModel, measureLearningEffect } = require('../../functions/lib/modules/agent007/hugoCore/learningEvaluation');
const { internalTrainingAuthorization, externalProviderAuthorization } = require('../../functions/lib/modules/agent007/hugoCore/learningGovernance');
global.fetch = async () => { throw Error('MODEL_OR_EXTERNAL_FETCH_FORBIDDEN'); };

const rootId = 'learning-root', uid = 'learning-reviewer';
const request = data => ({ auth: { uid, token: {} }, data });
const query = { rootId, domain: 'SOLICITUDES', taskType: 'REASON', entityType: 'SOLICITUD', features: { entityType: 'SOLICITUD', status: 'PENDIENTE', issueCode: 'DOCUMENT_MISSING' }, limit: 5 };
const task = { caseId: 'new-similar-case', query, expectedBehavior: 'VERIFY_DOCUMENT_BEFORE_DECISION', currentFacts: { documentStatus: 'UNVERIFIED' }, modelNecessity: 'MODEL_NOT_REQUIRED' };
const invoke = (name, data) => callables[name].run(request(data));
const store = () => new FirestoreHugoLearningStore(db); // Every check reloads persisted state.

async function seed(id, scope = rootId) {
  const at = offset => admin.firestore.Timestamp.fromMillis(Date.now() - 60000 + offset);
  const entityReference = { sourceSystem: 'PAY0', entityType: 'SOLICITUD', entityId: id };
  await Promise.all([
    db.doc(`agent007Observations/obs_${id}`).set({ rootId: scope, caseId: id, caseType: 'SOLICITUD', sourceSystem: 'PAY0', source: 'ACTIVITY_LOG', createdAt: at(0) }),
    db.doc(`agent007Observations/outcome_${id}`).set({ rootId: scope, caseId: id, caseType: 'SOLICITUD', sourceSystem: 'PAY0', source: 'ACTIVITY_LOG', sourceEvent: 'SOLICITUD_COMPLETADA', createdAt: at(20000) }),
    db.doc(`agent007Memory/decision_${id}`).set({ rootId: scope, kind: 'DECISION', status: 'CONFIRMED', entityReference, decision: { actorUid: uid, decisionType: 'APPROVED', decisionAt: at(10000).toDate().toISOString() } }),
    db.doc(`agent007Memory/memory_${id}`).set({ rootId: scope, kind: 'EXPERIENCE', status: 'CONFIRMED', entityReference, links: { observationId: `obs_${id}`, decisionId: `decision_${id}`, outcomeId: `outcome_${id}` }, createdAt: at(30000).toDate().toISOString() }),
  ]);
  return { memoryId: `memory_${id}`, domain: query.domain, taskType: query.taskType, intent: 'EXPLAIN_DELAY', questionClass: 'DOCUMENT_REVIEW', features: query.features };
}
function correction(id, experienceId, behavior = task.expectedBehavior) {
  return { experienceId, originalBehavior: 'COPY_PRIOR_ACTION', correctedBehavior: behavior, expectedBehavior: behavior, reasonCode: 'OUTCOME_SUPPORTED_CORRECTION', scope: 'ENTITY_TYPE', evidenceReferences: [{ system: 'PAY0', kind: 'OUTCOME', id: `outcome_${id}` }] };
}

test('supervised learning persists and fails closed across correction, contradiction and revocation', { timeout: 90000 }, async t => {
  await db.doc(`users/${uid}`).set({ rootId, role: 'superadmin', active: true });
  let first, contradictory;
  const before = decideWithoutModel(task, []);

  await t.test('concurrent callable creation persists one experience and exact lineage', async () => {
    const input = await seed('source-a');
    const results = await Promise.all(Array.from({ length: 4 }, () => invoke('createAgent007LearningExperience', input)));
    assert.equal(results.filter(x => x.created).length, 1);
    first = results[0].id;
    const stored = (await db.doc(`agent007LearningExperiences/${first}`).get()).data();
    assert.equal(stored.revision, 1);
    assert.equal(stored.trainingEligibility.eligible, false);
    assert.equal((await store().retrieve(query)).selected.length, 0);
    const ledger = await invoke('listAgent007LearningLineage', { experienceId: first });
    assert.deepEqual(ledger.events.map(e => e.type), ['EXPERIENCE_CREATED', 'EXPERIENCE_VERIFIED']);
  });

  await t.test('unrelated correction is rejected; valid correction improves a reloaded similar case', async () => {
    await assert.rejects(invoke('correctAgent007LearningExperience', { ...correction('unrelated', first) }), e => e.code === 'failed-precondition');
    assert.equal((await db.doc(`agent007LearningExperiences/${first}`).get()).get('revision'), 1);
    const saved = await invoke('correctAgent007LearningExperience', correction('source-a', first));
    assert.equal(saved.revision, 2);
    assert.equal(saved.trainingEligibility.eligible, true);
    const retrieval = await store().retrieve(query);
    assert.deepEqual(retrieval.selected.map(x => x.experienceId), [first]);
    const after = decideWithoutModel(task, retrieval.selected);
    assert.equal(before.behavior, 'ESCALATE_UNKNOWN');
    assert.equal(after.behavior, task.expectedBehavior);
    const effect = measureLearningEffect({ task, experience: retrieval.selected[0], before, after, modelAdapter: 'NONE', promptVersion: 'policy-v1', evidenceDigest: 'controlled-emulator-evidence' });
    assert.equal(effect.improved, true);
    assert.equal(effect.overgeneralized, false);
    await store().recordEffect(rootId, effect);
    const ledger = await store().listLedger(rootId, first);
    assert.equal(ledger.filter(e => e.type === 'CORRECTION_RECORDED').length, 1);
    assert.equal(ledger.find(e => e.type === 'LEARNING_EFFECT_MEASURED').metadata.improved, true);
    const revisions = await db.collection('agent007LearningRevisions').where('experienceId', '==', first).get();
    assert.equal(revisions.size, 2);
  });

  await t.test('verified contradiction disables use; supersession persists the retirement', async () => {
    contradictory = (await invoke('createAgent007LearningExperience', await seed('source-b'))).id;
    await invoke('correctAgent007LearningExperience', correction('source-b', contradictory, 'CHECK_INVOICE_FIRST'));
    const retrieval = await store().retrieve(query);
    assert.equal(retrieval.conflict, true);
    assert.equal(retrieval.selected.length, 0);
    assert.equal(decideWithoutModel(task, retrieval.selected).behavior, 'ESCALATE_UNKNOWN');
    assert.equal(retrieval.rejected.filter(x => x.reason === 'CONTRADICTORY_VERIFIED_EXPERIENCE').length, 2);
    const retired = await invoke('supersedeAgent007LearningExperience', { experienceId: first, replacementId: contradictory });
    assert.equal(retired.state, 'SUPERSEDED');
    assert.equal(retired.revision, 3);
    assert.equal((await invoke('supersedeAgent007LearningExperience', { experienceId: first, replacementId: contradictory })).revision, 3, 'repeat is idempotent');
    const previous = (await db.doc(`agent007LearningExperiences/${first}`).get()).data();
    assert.equal(previous.trainingEligibility.eligible, false);
    assert.deepEqual((await store().retrieve(query)).selected.map(x => x.experienceId), [contradictory]);
    assert.equal((await store().listLedger(rootId, first)).filter(x => x.type === 'EXPERIENCE_SUPERSEDED').length, 1);
    assert.equal((await db.doc(`agent007LearningRevisions/${first}_2`).get()).get('state'), 'VERIFIED', 'earlier revision remains immutable');
  });

  await t.test('protected partition withdraws remaining experience and cached training grants', async () => {
    await invoke('assignAgent007LearningSplit', { experienceId: contradictory, split: 'HOLDOUT' });
    assert.equal((await store().retrieve(query)).selected.length, 0);
    assert.equal(decideWithoutModel(task, (await store().retrieve(query)).selected).behavior, 'ESCALATE_UNKNOWN');
    const protectedRecord = (await db.doc(`agent007LearningExperiences/${contradictory}`).get()).data();
    assert.equal(protectedRecord.split, 'HOLDOUT');
    // Deliberately persist stale approval flags to prove current revision wins.
    await db.doc(`agent007LearningExperiences/${contradictory}`).update({ 'trainingEligibility.eligible': true, governance: { use: 'TRAINING_ELIGIBLE_INTERNAL', externalProvider: 'APPROVED', reviewedBy: uid, reviewedAt: new Date().toISOString() } });
    const reloaded = (await db.doc(`agent007LearningExperiences/${contradictory}`).get()).data();
    assert.equal(internalTrainingAuthorization(reloaded).approved, false);
    assert.equal(externalProviderAuthorization(reloaded).approved, false);
    assert.equal((await store().retrieve(query)).selected.length, 0);
  });

  await t.test('callables reload actor role, activity and root; denials make no learning writes', async () => {
    const ledgerBefore = (await db.collection('agent007LearningLedger').get()).size;
    const denied = (name, data, code) => assert.rejects(invoke(name, data), e => e.code === code);
    await assert.rejects(callables.listAgent007LearningDiagnostics.run({ data: {} }), e => e.code === 'unauthenticated');
    await db.doc(`users/${uid}`).update({ role: 'admin' });
    await denied('listAgent007LearningDiagnostics', {}, 'permission-denied');
    await db.doc(`users/${uid}`).update({ role: 'superadmin', active: false });
    await denied('assignAgent007LearningSplit', { experienceId: first, split: 'TRAIN' }, 'permission-denied');
    await db.doc(`users/${uid}`).update({ active: true, rootId: 'foreign-root' });
    await denied('listAgent007LearningLineage', { experienceId: first, rootId }, 'not-found');
    await denied('correctAgent007LearningExperience', { ...correction('source-a', first), rootId }, 'not-found');
    assert.equal((await invoke('listAgent007LearningDiagnostics', { rootId })).experiences.length, 0);
    assert.equal((await store().retrieve({ ...query, rootId: 'foreign-root' })).selected.length, 0);
    assert.equal((await db.collection('agent007LearningLedger').get()).size, ledgerBefore);
    await db.doc(`users/${uid}`).update({ rootId });
    assert.equal((await invoke('listAgent007LearningDiagnostics', {})).experiences.length, 2);
  });
  await db.terminate();
});
