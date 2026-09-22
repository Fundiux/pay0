const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || process.env.GCLOUD_PROJECT !== 'demo-pay0') throw Error('Local Firestore emulator required');
global.fetch = async () => { throw Error('EXTERNAL_NETWORK_FORBIDDEN'); };
const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: 'demo-pay0' });
const db = admin.firestore();
const { FirestoreHugoLearningStore } = require('../../functions/lib/modules/agent007/firestoreHugoLearningStore');
const { HugoConversationCore } = require('../../functions/lib/modules/agent007/hugoCore/conversationCore');
const { emptyConversationState } = require('../../functions/lib/modules/agent007/hugoCore/conversationState');
const store = new FirestoreHugoLearningStore(db);
const runId = process.argv[3] || `phase6_${Date.now()}`;
const root = runId, other = `${runId}_other`, auth = { uid: root, token: { role: 'superadmin' } };
const callables = require('../../functions/lib/modules/agent007/callables');
const stamp = minute => admin.firestore.Timestamp.fromDate(new Date(Date.now() - (10 - minute) * 60000));
async function seed(label, behavior) {
  const caseId = `${runId}_${label}`, ids = { obs: `obs_${caseId}`, decision: `decision_${caseId}`, outcome: `outcome_${caseId}`, memory: `memory_${caseId}` };
  await db.doc(`agent007Observations/${ids.obs}`).set({ rootId: root, caseId, source: 'ACTIVITY_LOG', sourceEvent: 'SOLICITUD_STATUS_ACTUALIZADO', createdAt: stamp(0) });
  await db.doc(`agent007Memory/${ids.decision}`).set({ rootId: root, kind: 'DECISION', status: 'CONFIRMED', entityReference: { sourceSystem: 'PAY0', entityType: 'SOLICITUD', entityId: caseId },
    decision: { actorUid: root, decisionType: 'APPROVED', decisionAt: stamp(1).toDate().toISOString() } });
  await db.doc(`agent007Observations/${ids.outcome}`).set({ rootId: root, caseId, source: 'ACTIVITY_LOG', sourceEvent: 'SOLICITUD_COMPLETADA', createdAt: stamp(2) });
  await db.doc(`agent007Memory/${ids.memory}`).set({ rootId: root, kind: 'EXPERIENCE', status: 'CONFIRMED', entityReference: { sourceSystem: 'PAY0', entityType: 'SOLICITUD', entityId: caseId },
    links: { observationId: ids.obs, decisionId: ids.decision, outcomeId: ids.outcome }, createdAt: stamp(3).toDate().toISOString() });
  const input = { rootId: root, memoryId: ids.memory, actorUid: root, domain: 'SOLICITUDES', taskType: 'REASON', intent: 'EXPLAIN_DELAY', questionClass: 'DOCUMENT_REVIEW',
    features: { entityType: 'SOLICITUD', status: 'PENDIENTE', issueCode: 'DOCUMENT_MISSING' } };
  const created = await store.createFromVerifiedMemory(input);
  assert.equal((await store.createFromVerifiedMemory(input)).created, false);
  await store.addCorrection(root, created.id, { originalBehavior: 'COPY_PRIOR_ACTION', correctedBehavior: behavior, reasonCode: 'OUTCOME_SUPPORTED_CORRECTION',
    actorUid: root, correctedAt: new Date().toISOString(), scope: 'ENTITY_TYPE', evidenceReferences: [{ system: 'PAY0', kind: 'OUTCOME', id: ids.outcome, rootId: root }] }, behavior);
  return created.id;
}
async function write() {
  await db.doc(`users/${root}`).set({ role: 'superadmin', rootId: root, active: true });
  await db.doc(`users/${other}`).set({ role: 'superadmin', rootId: other, active: true });
  const oldId = await seed('old', 'COPY_PRIOR_ACTION');
  await new Promise(resolve => setTimeout(resolve, 20));
  const newId = await seed('new', 'VERIFY_DOCUMENT_BEFORE_DECISION');
  await db.doc(`phase6TestRuns/${runId}`).set({ rootId: root, oldId, newId });
  console.log('writer: verified experiences and corrections persisted');
}
async function read() {
  const { oldId, newId } = (await db.doc(`phase6TestRuns/${runId}`).get()).data();
  const query = { rootId: root, domain: 'SOLICITUDES', taskType: 'REASON', entityType: 'SOLICITUD',
    features: { entityType: 'SOLICITUD', status: 'PENDIENTE', issueCode: 'DOCUMENT_MISSING' } };
  assert.equal((await store.retrieve(query)).conflict, true);
  await assert.rejects(() => callables.supersedeAgent007LearningExperience.run({ auth: { uid: other, token: { role: 'superadmin' } },
    data: { experienceId: oldId, replacementId: newId } }), error => error.code?.endsWith('not-found'));
  const superseded = await callables.supersedeAgent007LearningExperience.run({ auth, data: { experienceId: oldId, replacementId: newId } });
  assert.equal(superseded.state, 'SUPERSEDED');
  assert.equal((await callables.supersedeAgent007LearningExperience.run({ auth, data: { experienceId: oldId, replacementId: newId } })).revision, superseded.revision);
  assert.deepEqual((await store.retrieve(query)).selected.map(row => row.experienceId), [newId]);
  assert.equal((await store.retrieve({ ...query, rootId: other })).selected.length, 0);
  const ledger = await store.listLedger(root, oldId); assert(ledger.some(row => row.type === 'EXPERIENCE_SUPERSEDED'));
  assert.equal((await db.doc(`agent007LearningRevisions/${oldId}_2`).get()).exists, true);
  const identity = { uid: root, rootId: root, role: 'superadmin' };
  const router = { assertIdentity() {}, execute: async request => ({ sourceSystem: 'PAY0', tool: request.name, scope: { rootId: root }, retrievedAt: new Date().toISOString(),
    completeness: request.name === 'getSolicitud' ? 'COMPLETE' : 'UNKNOWN', evidence: [],
    data: request.name === 'getSolicitud' ? { id: `${runId}_current`, folio: 'S61001', estado: 'PENDIENTE', monto: 120, issueCode: 'DOCUMENT_MISSING' } : [],
    trace: { latencyMs: 0, result: 'OK' } }) };
  const data = { loadConversationState: async () => ({ history: [], memory: { recommendations: [], rules: [] }, recentEntities: [], conversationState: emptyConversationState(root) }),
    retrieveMemory: async () => ({ considered: 0, selected: [], legacyObservationsConsidered: 0, legacyObservations: [] }) };
  const input = { channel: 'EVAL', conversationId: `${root}_${root}`, identity, name: 'Prueba', message: '¿Por qué sigue pendiente S61001?', promptVersion: 'hugo-v2' };
  const noModel = await new HugoConversationCore(router, null, data, store).respond(input);
  assert.equal(noModel.model.error, 'MODEL_UNAVAILABLE'); assert.deepEqual(noModel.learningUsage.includedIds, [newId]);
  const fake = { generate: async () => { throw Error('canonical expected'); }, generateCanonical: async request => ({ text: request.intelligence.learningExperiences[0]?.expectedBehavior || null,
    answer: null, claims: [], entityReferences: [], uncertainties: [], proposedActions: [], model: 'FakeB', modelVersion: '1', provider: 'TEST', promptVersion: 'hugo-v2', tokenUsage: null }) };
  const replaced = await new HugoConversationCore(router, fake, data, store).respond(input);
  assert.equal(replaced.text, 'VERIFY_DOCUMENT_BEFORE_DECISION');
  await store.assignSplit(root, newId, 'HOLDOUT', root);
  await assert.rejects(() => store.assignSplit(root, newId, 'TEST', root), error => error.code?.endsWith('failed-precondition'));
  console.log(JSON.stringify({ ok: true, separateProcesses: true, verifiedPersisted: 2, superseded: true, oldRevisionRetained: true, modelFreeContinues: true, replacementAdapterUsesLearning: true }));
}
async function main() {
  if (process.argv[2] === '--write') await write(); else if (process.argv[2] === '--read') await read();
  else { execFileSync(process.execPath, [__filename, '--write', runId], { stdio: 'inherit', env: process.env });
    execFileSync(process.execPath, [__filename, '--read', runId], { stdio: 'inherit', env: process.env }); }
}
main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
