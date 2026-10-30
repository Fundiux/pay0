const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || !/^demo-pay0-e1-/.test(process.env.GCLOUD_PROJECT || '')) throw Error('Isolated demo emulator required');
const workspace = path.resolve(__dirname, '../..');
const artifact = process.env.PAY0_RECOVERY_ARTIFACT_ROOT;
const base = artifact ? path.resolve(artifact) : path.join(workspace, 'functions');
assert.ok(base.startsWith(workspace + path.sep));
const load = createRequire(path.join(base, 'package.json'));
const admin = load('firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
// Only the edited recovery module is transpiled. Its domain, authorization,
// Firestore and audit dependencies are the existing compiled implementations.
const recovery = artifact ? load('./lib/modules/controlCenter/recovery.js') : {};
if (!artifact) {
  const ts = load('typescript');
  const source = fs.readFileSync(path.join(base, 'src/modules/controlCenter/recovery.ts'), 'utf8');
  new Function('require', 'exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)(createRequire(path.join(base, 'lib/modules/controlCenter/recovery.js')), recovery);
}
function verifyArtifact() {
  if (!artifact) return;
  const crypto = require('node:crypto'), sha = b => crypto.createHash('sha256').update(b).digest('hex');
  const receipt = JSON.parse(fs.readFileSync(path.join(base, '../entry-hashes.json')));
  assert.equal(sha(fs.readFileSync(receipt.archive)), receipt.archiveSha256);
  for (const [file, hash] of Object.entries(receipt.entries)) assert.equal(sha(fs.readFileSync(path.join(base, file))), hash, file);
}
verifyArtifact();
const rootId = 'recovery-outcome-root', actorUid = 'recovery-outcome-admin';
const old = admin.firestore.Timestamp.fromMillis(1);
async function fixture(id, delta = {}) {
  const row = { rootId, createdBy: actorUid, status: 'PROCESANDO', clienteId: 'outcome-client', companyId: 'outcome-company', materialitySyncStatus: 'ERROR', ocFiscalMetadataUploadId: 'one', ...delta };
  await db.doc(`solicitudes/${id}`).set(row);
  await db.doc(`operationRecoveryJobs/${id}`).set({ rootId, actorUid, solicitudId: id, kind: 'MATERIALITY', generation: 'one', status: 'PENDING', attempts: 0, nextAttemptAt: old });
  return db.doc(`operationRecoveryJobs/${id}`);
}
async function audit(id, event) {
  const snap = await db.collection('pay0ActivityLog').where('referenceId', '==', id).get();
  return snap.docs.filter(doc => doc.get('event') === event);
}
async function run() {
  await db.doc(`users/${actorUid}`).set({ rootId, role: 'superadmin', active: true });
  await db.doc('clients/outcome-client').set({ rootId, active: true, nombre: 'Cliente sintetico' });
  await db.doc('companies/outcome-company').set({ rootId, active: true, nombre: 'Empresa sintetica' });
  for (const [id, delta, status, reason] of [
    ['terminal', { status: 'CANCELADA' }, 'SUPERSEDED', 'SOURCE_TERMINAL'],
    ['stale', { ocFiscalMetadataUploadId: 'two' }, 'SUPERSEDED', 'SOURCE_GENERATION_CHANGED'],
    ['external', { materialitySyncStatus: 'RECOVERED' }, 'RESOLVED_EXTERNALLY', 'SOURCE_NOT_IN_ERROR'],
  ]) {
    const job = await fixture(id, delta);
    const before = (await db.doc(`solicitudes/${id}`).get()).data();
    await recovery.processRecoveryJobs();
    assert.equal((await job.get()).get('status'), status);
    assert.equal((await job.get()).get('resolutionReason'), reason);
    assert.deepEqual((await db.doc(`solicitudes/${id}`).get()).data(), before);
    assert.equal((await audit(id, 'OPERACION_RECUPERADA')).length, 0);
    assert.equal((await audit(id, 'OPERACION_RECUPERACION_OMITIDA')).length, 1);
    assert.equal((await db.doc(`materialityOperations/${id}`).get()).exists, false);
  }
  const successful = await fixture('real-domain');
  await recovery.processRecoveryJobs();
  assert.equal((await successful.get()).get('status'), 'COMPLETED');
  assert.equal((await db.doc('materialityOperations/real-domain').get()).exists, true, 'real materiality projection executed');
  assert.equal((await db.doc('solicitudes/real-domain').get()).get('materialitySyncStatus'), 'RECOVERED');
  await recovery.processRecoveryJobs();
  assert.equal((await audit('real-domain', 'OPERACION_RECUPERADA')).length, 1);
  const domain = load('./lib/modules/materiality/service.js');
  const actual = domain.linkSolicitudToMaterialityOperationCore;
  const updated = await fixture('domain-updated-status');
  // Execute the real domain, then emulate its successful source-status update
  // before the recovery postcondition reads the source again.
  domain.linkSolicitudToMaterialityOperationCore = async request => {
    const result = await actual(request);
    await db.doc(`solicitudes/${request.data.solicitudId}`).update({ materialitySyncStatus: 'SYNCED' });
    return result;
  };
  try { await recovery.processRecoveryJobs(); } finally { domain.linkSolicitudToMaterialityOperationCore = actual; }
  assert.equal((await updated.get()).get('status'), 'COMPLETED');
  assert.equal((await db.doc('materialityOperations/domain-updated-status').get()).exists, true);
  assert.equal((await audit('domain-updated-status', 'OPERACION_RECUPERADA')).length, 1);
  const terminalized = await fixture('same-lease-terminal');
  await recovery.processRecoveryJobs(async () => {
    await terminalized.update({ status: 'SUPERSEDED' });
    return { status: 'COMPLETED' };
  });
  assert.equal((await terminalized.get()).get('status'), 'SUPERSEDED');
  assert.equal((await audit('same-lease-terminal', 'OPERACION_RECUPERADA')).length, 0);
  const takeover = await fixture('lease-takeover');
  await recovery.processRecoveryJobs(async () => { await takeover.update({ lease: 'other-owner' }); });
  assert.equal((await takeover.get()).get('status'), 'RUNNING');
  assert.equal((await audit('lease-takeover', 'OPERACION_RECUPERADA')).length, 0);
  const exhausted = await fixture('retry-budget');
  await exhausted.update({ attempts: 4 });
  await recovery.processRecoveryJobs(async () => { throw Error('SYNTHETIC_FAILURE'); });
  assert.equal((await exhausted.get()).get('status'), 'NEEDS_REVIEW');
  assert.equal((await exhausted.get()).get('attempts'), 5);
  assert.equal((await exhausted.get()).get('nextAttemptAt'), undefined);
  const foreign = await fixture('foreign-source', { rootId: 'another-root' });
  const foreignSource = (await db.doc('solicitudes/foreign-source').get()).data();
  await recovery.processRecoveryJobs();
  assert.equal((await foreign.get()).get('status'), 'PENDING');
  assert.equal((await foreign.get()).get('lastErrorCode'), 'RECOVERY_SCOPE_DENIED');
  assert.deepEqual((await db.doc('solicitudes/foreign-source').get()).data(), foreignSource);
  assert.equal((await db.doc('materialityOperations/foreign-source').get()).exists, false);
  assert.equal((await audit('foreign-source', 'OPERACION_RECUPERADA')).length, 0);
  verifyArtifact();
  console.log(JSON.stringify({ status: 'PASS', mode: artifact ? 'EXACT_ARCHIVE_REAL_FIRESTORE_REAL_MATERIALITY_PRE_POST_ENTRY_HASHES' : 'SOURCE_TRANSPILED_RECOVERY_REAL_FIRESTORE_REAL_MATERIALITY', cases: 9, financialWrites: 0, externalActions: 0 }));
}
run().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
