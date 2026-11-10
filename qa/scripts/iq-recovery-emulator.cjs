const assert = require('node:assert/strict');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || !String(process.env.GCLOUD_PROJECT || '').startsWith('demo-')) throw Error('LOCAL_EMULATOR_REQUIRED');
const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({projectId: process.env.GCLOUD_PROJECT});
const db = admin.firestore();
global.fetch = async () => { throw Error('EXTERNAL_NETWORK_FORBIDDEN'); };
const {recoverNotEnqueuedSolicitudes} = require('../../functions/lib/modules/iq/solicitudCreateQueueCallables');
let checks = 0;
const check = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
const rootId = `rec-${Date.now()}`, otherRoot = `${rootId}-off`;
const base = {iqCreateQueueStatus: 'NOT_ENQUEUED', status: 'PROCESANDO', createdBy: 'u1'};

(async () => {
  const batch = db.batch();
  for (let i = 0; i < 25; i++) batch.set(db.doc(`solicitudes/old${i}`), {...base, rootId, iqCreateRecoveryAttempts: 4});
  batch.set(db.doc('solicitudes/fresh'), {...base, rootId});
  batch.set(db.doc('solicitudes/folio'), {...base, rootId, iqId: '99'});
  batch.set(db.doc('solicitudes/gone'), {...base, rootId, isDeleted: true});
  batch.set(db.doc('solicitudes/anon'), {...base, rootId, createdBy: ''});
  batch.set(db.doc('solicitudes/offroot'), {...base, rootId: otherRoot});
  await batch.commit();

  const calls = [];
  const enqueue = async input => { calls.push(input); return {queued: true, jobId: input.solicitudId, batchId: '', reused: false, message: ''}; };
  const first = await recoverNotEnqueuedSolicitudes(new Set([rootId]), enqueue);
  check(calls.map(c => c.solicitudId), ['fresh'], '25 exhausted ones do not hide the new one, and only it is retried');
  check(calls[0].source, 'AUTO_RECOVERY', 'recovery source');
  check([first.retried, first.queued, first.stopped], [1, 1, 28], 'one retried; exhausted, folio, deleted and no-requester are stopped');
  const status = async id => (await db.doc(`solicitudes/${id}`).get()).data();
  check((await status('old0')).iqCreateQueueStatus, 'RECOVERY_STOPPED', 'exhausted leaves NOT_ENQUEUED');
  check((await status('old0')).iqCreateRecoveryStopReason, 'SKIP_EXHAUSTED', 'with its reason');
  check((await status('folio')).iqCreateQueueStatus, 'SKIPPED_ALREADY_HAS_FOLIO', 'folio is closed with the existing status');
  check((await status('gone')).iqCreateQueueStatus, 'RECOVERY_STOPPED', 'deleted is stopped');
  check((await status('anon')).iqCreateQueueStatus, 'RECOVERY_STOPPED', 'no requester is stopped');
  check((await status('offroot')).iqCreateQueueStatus, 'NOT_ENQUEUED', 'a root without automation is not touched');
  check((await status('fresh')).iqCreateRecoveryAttempts, 1, 'the attempt is counted');

  const second = await recoverNotEnqueuedSolicitudes(new Set([rootId]), enqueue);
  check([calls.length, second.stopped], [1, 0], 'the next pass finds nothing stale and does not retry too soon');
  check(await recoverNotEnqueuedSolicitudes(new Set(), enqueue), {scanned: 0, retried: 0, queued: 0, stopped: 0}, 'no enabled roots, no query');
  console.log('IQ RECOVERY OK', checks);
})().catch(error => { console.error(error); process.exit(1); });
