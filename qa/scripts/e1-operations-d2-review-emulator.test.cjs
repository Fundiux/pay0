const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^127\.0\.0\.1:\d+$/);
assert.match(process.env.GCLOUD_PROJECT || '', /^demo-pay0-e1-/);
const load = createRequire(path.join(process.env.PAY0_D2_FUNCTIONS_ROOT || path.resolve(__dirname, '../../functions'), 'package.json'));
const admin = load('firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore(), calls = load('./lib/modules/agent007/callables');
global.fetch = async () => { throw Error('EXTERNAL_PROVIDER_FORBIDDEN'); };
const rootId = 'd2-root', uid = 'd2-supervisor';
const invoke = (data, actor = uid) => calls.listAgent007LearningDiagnostics.run({ auth: actor ? { uid: actor, token: {} } : undefined, data });
const encoded = (kind, id, scope = rootId) => Buffer.from(JSON.stringify({ v: 1, kind, rootId: scope, id })).toString('base64url');
async function experience(id) {
  const stamp = offset => admin.firestore.Timestamp.fromMillis(Date.now() - 60000 + offset);
  const entityReference = { sourceSystem: 'PAY0', entityType: 'SOLICITUD', entityId: id };
  await Promise.all([
    db.doc(`agent007Observations/obs_${id}`).set({ rootId, caseId: id, caseType: 'SOLICITUD', sourceSystem: 'PAY0', source: 'ACTIVITY_LOG', createdAt: stamp(0) }),
    db.doc(`agent007Observations/out_${id}`).set({ rootId, caseId: id, caseType: 'SOLICITUD', sourceSystem: 'PAY0', source: 'ACTIVITY_LOG', sourceEvent: 'SOLICITUD_COMPLETADA', createdAt: stamp(20000) }),
    db.doc(`agent007Memory/dec_${id}`).set({ rootId, kind: 'DECISION', status: 'CONFIRMED', entityReference, decision: { actorUid: uid, decisionType: 'APPROVED', decisionAt: stamp(10000).toDate().toISOString() } }),
    db.doc(`agent007Memory/mem_${id}`).set({ rootId, kind: 'EXPERIENCE', status: 'CONFIRMED', entityReference, links: { observationId: `obs_${id}`, decisionId: `dec_${id}`, outcomeId: `out_${id}` }, createdAt: stamp(30000).toDate().toISOString() }),
  ]);
  const auth = { uid, token: {} };
  const made = await calls.createAgent007LearningExperience.run({ auth, data: { memoryId: `mem_${id}`, domain: 'SOLICITUDES', taskType: 'REASON', intent: 'EXPLAIN_DELAY', questionClass: 'DOCUMENT_REVIEW', features: { entityType: 'SOLICITUD', status: 'PENDIENTE', issueCode: 'DOCUMENT_MISSING' } } });
  await calls.correctAgent007LearningExperience.run({ auth, data: { experienceId: made.id, originalBehavior: 'COPY_PRIOR_ACTION', correctedBehavior: 'VERIFY_DOCUMENT_BEFORE_DECISION', expectedBehavior: 'VERIFY_DOCUMENT_BEFORE_DECISION', reasonCode: 'OUTCOME_SUPPORTED_CORRECTION', scope: 'ENTITY_TYPE', evidenceReferences: [{ system: 'PAY0', kind: 'OUTCOME', id: `out_${id}` }] } });
  return made.id;
}
test('D2 review reads current scoped evidence and paginates without writes', { timeout: 120000 }, async t => {
  await Promise.all([
    db.doc(`users/${uid}`).set({ role: 'superadmin', rootId, active: true }),
    db.doc('users/foreign-supervisor').set({ role: 'superadmin', rootId: 'foreign-root', active: true }),
    db.doc('users/admin').set({ role: 'admin', rootId, active: true }),
  ]);
  const ids = [await experience('verified-a'), await experience('verified-b')];
  const legacy = await invoke({});
  const batch = db.batch();
  for (let i = 0; i < 28; i++) {
    batch.set(db.doc(`agent007LearningExperiences/page_${String(i).padStart(2, '0')}`), { rootId, domain: 'SOLICITUDES', taskType: 'REASON', state: 'WAITING_FOR_OUTCOME', revision: 1 });
    batch.set(db.doc(`agent007LearnedRules/rule_${String(i).padStart(2, '0')}`), { rootId, schemaVersion: 'supervised-rule-v1', status: 'ACTIVE', version: 1, supportingIds: ['one'], supportingRevisions: { one: 1 }, behavior: 'VERIFY_DOCUMENT_BEFORE_DECISION', approvedBy: uid, approvedAt: '2026-01-01T00:00:00Z', expiresAt: '2026-01-02T00:00:00Z' });
  }
  batch.set(db.doc('agent007LearnedRules/foreign-rule'), { rootId: 'foreign-root', schemaVersion: 'supervised-rule-v1', status: 'ACTIVE' });
  batch.set(db.doc('agent007LearningExperiences/foreign-experience'), { rootId: 'foreign-root', domain: 'SOLICITUDES', taskType: 'REASON' });
  await batch.commit();
  delete process.env.HUGO_SUPERVISED_RULES_ENABLED;
  await t.test('legacy remains compatible and new mode reads while local gate is OFF', async () => {
    assert.equal(legacy.boundedTo, 100); assert.ok(Array.isArray(legacy.experiences));
    const page = await invoke({ mode: 'SUPERVISED_REVIEW', limit: 25 });
    assert.deepEqual(page.gateStatus, { diagnosticsLocalFlag: false, review: 'UNKNOWN', chat: 'UNKNOWN' });
    assert.equal(page.candidates.length, 25); assert.equal(page.rules.length, 25);
    assert.ok(page.nextCandidateCursor); assert.ok(page.nextRuleCursor);
    assert.equal(page.rules.some(row => row.id === 'foreign-rule'), false);
    const second = await invoke({ mode: 'SUPERVISED_REVIEW', limit: 25, candidateCursor: page.nextCandidateCursor, ruleCursor: page.nextRuleCursor });
    assert.equal(second.candidates.length, 5); assert.equal(second.rules.length, 3);
    assert.equal(second.nextCandidateCursor, null); assert.equal(second.nextRuleCursor, null);
    const all = [...page.candidates, ...second.candidates];
    assert.equal(new Set(all.map(row => row.id)).size, 30);
    assert.deepEqual(all.filter(row => row.selectionEligible).map(row => row.id).sort(), [...ids].sort());
    assert.ok(all.find(row => row.id === 'page_00').reasons.includes('INCOMPLETE_RECORD'));
  });
  await t.test('malformed cursors, foreign scope, mixed cursor kinds and malformed input fail closed', async () => {
    for (const data of [[], 'bad', { limit: 2 }, { mode: 'OTHER' }, { mode: 'SUPERVISED_REVIEW', limit: null }, { mode: 'SUPERVISED_REVIEW', limit: 26 },
      { mode: 'SUPERVISED_REVIEW', limit: 0 }, { mode: 'SUPERVISED_REVIEW', limit: 1.5 }, { mode: 'SUPERVISED_REVIEW', limit: '2' },
      { mode: 'SUPERVISED_REVIEW', candidateCursor: encoded('RULES', 'rule_00') },
      { mode: 'SUPERVISED_REVIEW', candidateCursor: encoded('CANDIDATES', 'page_00', 'foreign-root') },
      { mode: 'SUPERVISED_REVIEW', ruleCursor: encoded('RULES', 'foreign-rule') },
      { mode: 'SUPERVISED_REVIEW', unexpected: true }]) await assert.rejects(invoke(data), error => error.code === 'invalid-argument');
    await assert.rejects(invoke({ mode: 'SUPERVISED_REVIEW', focusedRuleId: 'foreign-rule' }), error => error.code === 'not-found');
  });
  await t.test('every page rechecks actor activity, role and root', async () => {
    await assert.rejects(invoke({ mode: 'SUPERVISED_REVIEW' }, null), error => error.code === 'unauthenticated');
    await assert.rejects(invoke({ mode: 'SUPERVISED_REVIEW' }, 'admin'), error => error.code === 'permission-denied');
    await db.doc(`users/${uid}`).update({ active: false });
    await assert.rejects(invoke({ mode: 'SUPERVISED_REVIEW' }), error => error.code === 'permission-denied');
    await db.doc(`users/${uid}`).update({ active: true, rootId: 'foreign-root' });
    await assert.rejects(invoke({ mode: 'SUPERVISED_REVIEW', candidateCursor: encoded('CANDIDATES', 'page_00') }), error => error.code === 'invalid-argument');
    await db.doc(`users/${uid}`).update({ rootId });
  });
  await t.test('approval and revocation refresh canonical rule; reads never invalidate or write ledger', async () => {
    process.env.HUGO_SUPERVISED_RULES_ENABLED = 'true';
    const approved = await calls.reviewAgent007LearningRule.run({ auth: { uid, token: {} }, data: { action: 'APPROVE', supportingIds: ids } });
    const before = (await db.collection('agent007LearningLedger').get()).size;
    let page = await invoke({ mode: 'SUPERVISED_REVIEW', focusedRuleId: approved.ruleId });
    assert.equal(page.focusedRule.status, 'ACTIVE'); assert.equal(page.focusedRule.version, 1);
    await db.doc('agent007Observations/out_verified-a').update({ sourceSystem: 'ASSETS' });
    page = await invoke({ mode: 'SUPERVISED_REVIEW', focusedRuleId: approved.ruleId, limit: 25 });
    const rest = await invoke({ mode: 'SUPERVISED_REVIEW', candidateCursor: page.nextCandidateCursor, limit: 25 });
    const candidate = [...page.candidates, ...rest.candidates].find(row => row.id === ids[0]);
    assert.equal(candidate.selectionEligible, false); assert.ok(candidate.reasons.includes('EVIDENCE_NOT_VERIFIED'));
    assert.equal(page.focusedRule.status, 'ACTIVE', 'Reading does not call resolve or mutate stored state');
    assert.equal((await db.collection('agent007LearningLedger').get()).size, before);
    await calls.reviewAgent007LearningRule.run({ auth: { uid, token: {} }, data: { action: 'REVOKE', ruleId: approved.ruleId } });
    page = await invoke({ mode: 'SUPERVISED_REVIEW', focusedRuleId: approved.ruleId });
    assert.equal(page.focusedRule.status, 'INVALIDATED'); assert.equal(page.focusedRule.version, 2);
  });
  await t.test('malformed references produce bounded ineligible rows without leaking extra fields', async () => {
    const original = (await db.doc(`agent007LearningExperiences/${ids[1]}`).get()).data();
    for (const [name, refs] of [['null', [null]], ['empty', [{}]], ['numeric', [{ id: 123, system: 'HUGO', kind: 'OBSERVATION', rootId }]]])
      await db.doc(`agent007LearningExperiences/zz-malformed-${name}`).set({ ...original, experienceId: `zz-malformed-${name}`, evidenceReferences: refs, rawPrivateNote: 'DO_NOT_RETURN_RAW_NOTE', amount: 999999 });
    await db.doc('agent007LearningExperiences/zz-malformed-correction').set({ ...original, experienceId: 'zz-malformed-correction', correction: { ...original.correction, evidenceReferences: [null] } });
    const first = await invoke({ mode: 'SUPERVISED_REVIEW', limit: 25 });
    const next = await invoke({ mode: 'SUPERVISED_REVIEW', limit: 25, candidateCursor: first.nextCandidateCursor });
    const malformed = next.candidates.filter(row => row.id.startsWith('zz-malformed-'));
    assert.equal(malformed.length, 4);
    for (const row of malformed) { assert.equal(row.selectionEligible, false); assert.ok(row.reasons.includes('INCOMPLETE_RECORD')); }
    assert.doesNotMatch(JSON.stringify(next), /DO_NOT_RETURN_RAW_NOTE|999999/);
  });
  await t.test('Firestore failures propagate instead of becoming an empty or ineligible page', async () => {
    const { FirestoreHugoLearningRuleStore } = load('./lib/modules/agent007/firestoreHugoLearningRuleStore');
    const broken = { collection: name => db.collection(name), doc: name => db.doc(name), runTransaction: callback => db.runTransaction(tx => callback({ get: ref => {
      if (ref.path === 'agent007Memory/mem_verified-b') throw Error('SENTINEL_FIRESTORE_UNAVAILABLE');
      return tx.get(ref);
    } })) };
    await assert.rejects(new FirestoreHugoLearningRuleStore(broken).readReview({ uid, rootId }, {}), /SENTINEL_FIRESTORE_UNAVAILABLE/);
  });
  await db.terminate();
});
