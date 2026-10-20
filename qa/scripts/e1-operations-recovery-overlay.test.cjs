const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { createRequire } = require('node:module');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || !/^demo-pay0-e1-/.test(process.env.GCLOUD_PROJECT || '')) throw Error('Isolated demo emulator required');
const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
const candidate = require('../../functions/lib/modules/controlCenter/recovery');
const before = {}, code = fs.readFileSync(path.resolve(__dirname, '../../tmp/e1-deployed-recovery/queueOperationRecovery/recovery.js'), 'utf8');
new Function('require', 'exports', code)(createRequire(path.resolve(__dirname, '../../functions/lib/modules/controlCenter/recovery.js')), before);
async function run() {
  const source = db.doc('solicitudes/recovery-overlay'), row = { rootId: 'overlay-root', createdBy: 'overlay-actor', materialitySyncStatus: 'ERROR', status: 'PROCESANDO' };
  await source.set(row);
  await before.enqueueRecovery(source.id, row, 'MATERIALITY');
  const job = (await db.collection('operationRecoveryJobs').get()).docs[0].ref;
  await job.update({ status: 'COMPLETED', attempts: 3 });
  await before.enqueueRecovery(source.id, row, 'MATERIALITY');
  assert.equal((await job.get()).get('attempts'), 0, 'deployed baseline reproduces budget reset');
  await job.update({ status: 'COMPLETED', attempts: 3 });
  await candidate.enqueueRecovery(source.id, row, 'MATERIALITY');
  assert.equal((await job.get()).get('attempts'), 3);
  assert.equal((await job.get()).get('status'), 'COMPLETED');
  assert.equal((await source.get()).get('materialitySyncStatus'), 'ERROR');
  console.log(JSON.stringify({ result: 'PASS', persistence: 'REAL_ISOLATED_FIRESTORE_EMULATOR', deployedRegressionReproduced: true, finiteGuardPreventsReset: true, domainSideEffectsInvoked: false }));
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.terminate());
