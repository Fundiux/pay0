const assert = require('node:assert/strict');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || process.env.GCLOUD_PROJECT !== 'demo-pay0') throw Error('Local Firestore emulator required');
global.fetch = async () => { throw Error('EXTERNAL_NETWORK_FORBIDDEN'); };
const admin = require('../../functions/node_modules/firebase-admin'); admin.initializeApp({ projectId: 'demo-pay0' }); const db = admin.firestore();
const callables = require('../../functions/lib/modules/agent007/callables'); const runId = `phase7_review_${Date.now()}`, root = `${runId}_root`, other = `${runId}_other`;
const auth = uid => ({ uid, token: { role: 'superadmin' } });
async function main() {
  await db.doc(`users/${root}`).set({ role: 'superadmin', rootId: root, active: true }); await db.doc(`users/${other}`).set({ role: 'superadmin', rootId: other, active: true });
  const first = await callables.saveAgent007HumanReview.run({ auth: auth(root), data: { evalRunId: 'phase6-synthetic-gemini-v1', caseId: 'document-review', status: 'REVIEWED', choice: 'A_BETTER', reasons: ['CORRECTNESS'], note: 'synthetic' } });
  assert.equal(first.review.revision, 1); assert.equal(first.review.reviewerUid, root);
  const revised = await callables.saveAgent007HumanReview.run({ auth: auth(root), data: { evalRunId: 'phase6-synthetic-gemini-v1', caseId: 'document-review', status: 'REVIEWED', choice: 'B_BETTER', reasons: ['EVIDENCE_USE'] } });
  assert.equal(revised.review.revision, 2); assert.equal(revised.review.choice, 'B_BETTER');
  const listed = await callables.listAgent007HumanReviews.run({ auth: auth(root), data: { evalRunId: 'phase6-synthetic-gemini-v1' } }); assert.equal(listed.reviews.length, 1);
  const foreign = await callables.listAgent007HumanReviews.run({ auth: auth(other), data: { evalRunId: 'phase6-synthetic-gemini-v1' } }); assert.equal(foreign.reviews.length, 0);
  const events = await db.collection('agent007EvalReviewEvents').where('rootId','==',root).get(); assert.equal(events.size, 2); assert.deepEqual(events.docs.map(doc=>doc.data().eventType).sort(), ['REVIEW_CREATED','REVIEW_REVISED']);
  await assert.rejects(() => callables.saveAgent007HumanReview.run({ auth: auth(root), data: { evalRunId: 'phase6-synthetic-gemini-v1', caseId: 'x', status: 'SKIPPED', choice: 'A_BETTER', reasons: [] } }));
  console.log(JSON.stringify({ ok: true, reviewPersisted: true, revisionPreserved: true, reviewerIdentityStored: true, crossRootIsolated: true }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
