const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { test, before, after } = require('node:test');
const { createRequire } = require('node:module');
const functionsRequire = createRequire(require('node:path').resolve('functions/package.json'));
// Never permit this suite to fall through to a live project.
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8088');
const projectId = `demo-pay0-latency-${Date.now().toString(36)}`;
const admin = functionsRequire('firebase-admin');
const { FieldValue, Timestamp } = functionsRequire('firebase-admin/firestore');
const firestore = require('firebase/firestore');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
admin.initializeApp({ projectId });
const db = admin.firestore();
let env;
function load(file, dependencies = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  new Function('exports', 'require', code)(exports, name => { assert(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name]; });
  return exports;
}
function extract(names, context, file = 'functions/src/modules/iq/pagoDepositCallables.ts') {
  const source = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile('module.ts', source, ts.ScriptTarget.Latest, true);
  const parts = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) parts.push(node.getText(ast));
    if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(ast))) parts.push(`const ${node.getText(ast)};`);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(parts.length, names.length);
  const exports = {};
  const code = ts.transpileModule(`${parts.join('\n')}\n${names.map(n => `exports.${n}=${n};`).join('\n')}`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function('exports', ...Object.keys(context), code)(exports, ...Object.values(context));
  return exports;
}
const tasks = new Map();
let failEnqueue = false;
const queue = load('functions/src/modules/iq/iqOnDemandTaskQueue.ts', {
  'firebase-admin/functions': { getFunctions: () => ({ taskQueue: functionName => ({
    async enqueue(data, options) {
      if (failEnqueue) throw new Error('local enqueue unavailable');
      if (tasks.has(options.id)) throw { code: 'already-exists' };
      tasks.set(options.id, { data, options, functionName });
    },
  }) }) },
});
const runtime = load('functions/src/modules/iq/automationRuntime.ts', {
  'firebase-admin/firestore': functionsRequire('firebase-admin/firestore'),
  './operatingCalendar': load('functions/src/modules/iq/operatingCalendar.ts'),
});
const immediate = load('functions/src/modules/iq/pagoImmediateDispatch.ts', {
  'node:crypto': require('node:crypto'), 'firebase-admin': admin,
  'firebase-admin/firestore': { FieldValue }, './iqOnDemandTaskQueue': queue,
  './automationRuntime': runtime,
});
const adapters = functionsRequire('./lib/modules/iq/depositHttpCreateFirebaseAdapters.js');
let posts = 0, transportMode = 'success';
const iqRow = { id: 991, created_at: '2026-10-06T20:00:01Z', sum: 100, currency: 'mxn',
  partner: 'Partner', client: 'Client', company: 'Company', operation_type: 'Deposit', sale_type: 'standard',
  base_percentage: '0', sale_percentage: '0', operation_status: 'pending', conciliation_status: 'pending' };
const core = load('functions/src/modules/iq/depositHttpCreateCore.ts', {
  'node:crypto': require('node:crypto'),
  './iqDateTime': functionsRequire('./lib/modules/iq/iqDateTime.js'),
  '../../utils/operationTiming': { operationTiming() {} },
  './iqHttpClient': { async fetchIq(url, options) {
    assert.equal(url.origin, 'http://127.0.0.1');
    if (options.method === 'POST') {
      posts++;
      if (transportMode === 'unknown') throw new Error('simulated response lost after dispatch');
      return new Response(JSON.stringify({ message: 'success' }), { status: 201 });
    }
    return new Response(JSON.stringify(transportMode === 'unknown' ? [] : [iqRow]), { status: 200 });
  } },
});
let attempt = 0;
async function runCore(pagoId, uploadId = 'receipt') {
  const context = { pagoId, actorUid: 'local-test', source: 'AUTO_TASK', fingerprint: 'fixed-test-fingerprint', expectedUploadId: uploadId };
  return core.createIqDepositHttpControlled({
    auth: { apiOrigin: 'http://127.0.0.1', bearerToken: 'synthetic' },
    identity: { pay0PagoId: pagoId, iqAttemptId: `attempt-${++attempt}`, pay0CreatedAtIso: '2026-10-06T20:00:00Z',
      partnerId: 1, partnerName: 'Partner', clientId: 2, clientName: 'Client', companyId: 3, companyName: 'Company',
      operationTypeId: 4, operationTypeName: 'Deposit', saleType: 'standard', sum: 100, currency: 'mxn',
      expectedSalePercentageId: 1, expectedBasePercentage: '0', expectedSalePercentage: '0' },
    voucher: { bytes: new Uint8Array([1, 2, 3]), originalName: 'synthetic.pdf', mimeType: 'application/pdf' },
    lock: adapters.createPagoAttemptLockAdapter(context), journal: adapters.createPagoAttemptJournal(context),
    allowHttpPost: true, recovery: { pollingBackoffMs: [0], pageSize: 100, maxPages: 1 },
  });
}
let failContext = false, coreExecutions = 0;
const handlers = extract(['shouldProcessPagoIqCreateQueueH4D62C', 'markPagoIqAutoCreateErrorH4D62C',
  'dispatchQueuedPagoIqCreation', 'processIqPagoDepositAutomaticTask'], {
  db, FieldValue, asRecord: value => value || {}, cleanText: value => String(value || '').trim(),
  cleanUpper: value => String(value || '').toUpperCase(),
  isPagoIqAutomationOmittedH4D44: row => row.iqDepositAutomationOmitted === true,
  isPagoIqTerminalLockedH4D58H: row => row.iqDepositTerminalLocked === true,
  ...immediate, IQ_CREDENTIALS_KEY: 'local', TELEGRAM_BOT_TOKEN: 'local',
  onDocumentWritten: (options, run) => ({ options, run }), onTaskDispatched: (options, run) => ({ options, run }),
  ...runtime,
  buildPagoIqSystemAuthH4D44: async () => { if (failContext) throw new Error('local transient context error'); return { rootId: 'root' }; },
  createPagoIqDepositFromQueueCoreH4D62C: input => { coreExecutions++; return runCore(input.pagoId, input.expectedUploadId); },
});
const receiptBytes = Buffer.from('local synthetic receipt bytes');
let documentAuditCalls = 0;
const documents = load('functions/src/modules/pagoDocuments/service.ts', {
  'node:crypto': require('node:crypto'),
  '../notes/domain': functionsRequire('./lib/modules/notes/domain.js'),
  'firebase-admin': { firestore: () => db, storage: () => ({ bucket: () => ({ file: () => ({ exists: async () => [true], getMetadata: async () => [{ size: receiptBytes.length }], download: async () => [receiptBytes] }) }) }) },
  'firebase-admin/firestore': { FieldValue },
  'firebase-functions/v2/https': functionsRequire('firebase-functions/v2/https'),
  '../../utils/auth': { requireAuthLike: () => 'test-user', getUser: async () => ({ role: 'superadmin', rootId: 'root' }),
    getRole: user => user.role, getRootIdFromUser: user => user.rootId, getUsername: () => 'test-user' },
  './domain': functionsRequire('./lib/modules/pagoDocuments/domain.js'),
  '../../utils/logActivity': { logActivityTx() { documentAuditCalls++; }, logActivity() {} },
  '../iq/pagoTelegramNotifications': { notifyIqPagoTelegramH4D59B() { throw Error('Unexpected notification'); } },
  '../dispatches/domain': functionsRequire('./lib/modules/dispatches/domain.js'),
  '../iq/pagoImmediateDispatch': immediate,
});
const configRef = db.doc('iqIntegrationConfigs/root');
const gateInput = { process: 'pagoCreate', purpose: 'CREATION', respectWindow: false };
async function seedPago(id, patch = {}) {
  await db.collection('pagos').doc(id).set({ rootId: 'root', adminId: 'admin', createdBy: 'operator',
    status: 'CONCILIACION_PENDIENTE', iqDepositCreationStatus: 'QUEUED',
    iqDepositCreationQueuedUploadId: 'receipt', iqDepositCreationQueuedAt: Timestamp.now(), ...patch });
}
before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8088,
    rules: fs.readFileSync('firestore.rules', 'utf8') } });
  await configRef.set({ enabled: true, automation: { pagos: true }, intervalMinutes: { pagoCreate: 1 } });
});
after(async () => { await env?.cleanup(); await admin.app().delete(); });

test('finalize plus durable event enqueue one immediate task; worker dispatches without scheduler', async () => {
  // An existing scheduler claim must neither suppress nor be changed by immediate work.
  await configRef.update({ 'automationRuntime.pagoCreate.lastClaimedAt': Timestamp.now() });
  const configBefore = await configRef.get();
  await seedPago('immediate', { despachoId: 'iq-dispatch', iqDepositCreationStatus: 'READY' });
  await db.doc('despachos/iq-dispatch').set({ active: true, automationMode: 'ERP', erpProvider: 'IQ' });
  await db.doc('uploads/receipt').set({ rootId: 'root', entityType: 'pagos', pagoId: 'immediate',
    documentType: 'COMPROBANTE_PAGO', storagePath: 'synthetic.pdf', status: 'PENDING', active: false });
  await documents.finalizePagoDocumentUploadCore({ data: { uploadId: 'receipt' } });
  assert.equal((await db.doc('uploads/receipt').get()).data().status, 'READY');
  const row = (await db.doc('pagos/immediate').get()).data();
  const event = { params: { pagoId: 'immediate' }, data: { before: { data: () => ({}) }, after: { exists: true, data: () => row } } };
  await Promise.all([immediate.enqueueAutomaticPagoCreation('immediate', 'receipt'),
    handlers.dispatchQueuedPagoIqCreation.run(event), handlers.dispatchQueuedPagoIqCreation.run(event)]);
  const id = immediate.automaticPagoTaskId('immediate', 'receipt');
  assert.notEqual(id, immediate.automaticPagoTaskId('Immediate', 'receipt'), 'case-sensitive document IDs do not collide');
  assert.equal(tasks.size, 1);
  const task = tasks.get(id);
  assert.equal(task.options.scheduleDelaySeconds, 0);
  assert.equal(immediate.isAutomaticPagoRecoveryDue((await db.doc('pagos/immediate').get()).data()), false);
  const beforePosts = posts, beforeCore = coreExecutions;
  await handlers.processIqPagoDepositAutomaticTask.run({ data: task.data });
  assert.equal(coreExecutions - beforeCore, 1);
  assert((await configRef.get()).updateTime.isEqual(configBefore.updateTime), "finalize/enqueue/worker must not write config or lastClaimedAt");
  assert.equal(posts - beforePosts, 1);
  assert.equal((await db.doc('pagos/immediate').get()).data().iqDepositId, '991');
  await handlers.processIqPagoDepositAutomaticTask.run({ data: task.data });
  await handlers.dispatchQueuedPagoIqCreation.run(event);
  assert.equal(posts - beforePosts, 1, 'replayed worker/event must not POST again');
  assert.equal(coreExecutions - beforeCore, 1);
  console.log('REGRESSION: tasks=1 core=1 POST=1 configWrites=0 replayPOST=0');
});

test('real scheduler helper claims once, excludes immediate repeat and admits the next interval', async () => {
  await configRef.update({ automationRuntime: {} });
  const now = new Date();
  assert.equal((await runtime.loadEnabledIqAutomationRoots({ ...gateInput, now })).has('root'), true);
  const claimed = await configRef.get();
  assert.equal(claimed.data().automationRuntime.pagoCreate.lastClaimedAt.toMillis(), now.getTime());
  assert.equal((await runtime.loadEnabledIqAutomationRoots({ ...gateInput, now })).has('root'), false, 'reproduces the former worker suppression');
  assert.equal((await runtime.readEnabledIqAutomationRoots({ ...gateInput, now })).has('root'), true);
  assert((await configRef.get()).updateTime.isEqual(claimed.updateTime));
  assert.equal((await runtime.loadEnabledIqAutomationRoots({ ...gateInput, now: new Date(now.getTime() + 60000) })).has('root'), true);
  assert.equal((await configRef.get()).data().automationRuntime.pagoCreate.lastClaimedAt.toMillis(), now.getTime() + 60000);
});

test('Master OFF and flow OFF prevent enqueue and worker POST without consuming an interval', async () => {
  await seedPago('disabled');
  for (const patch of [{ enabled: false, 'automation.pagos': true }, { enabled: true, 'automation.pagos': false }]) {
    await configRef.update(patch);
    const before = await configRef.get(), count = tasks.size, beforePosts = posts, beforeCore = coreExecutions;
    await immediate.enqueueAutomaticPagoCreation('disabled', 'receipt');
    await handlers.processIqPagoDepositAutomaticTask.run({ data: { pagoId: 'disabled', uploadId: 'receipt' } });
    assert.equal(tasks.size, count); assert.equal(posts, beforePosts); assert.equal(coreExecutions, beforeCore);
    assert.equal((await runtime.loadEnabledIqAutomationRoots(gateInput)).size, 0);
    assert((await configRef.get()).updateTime.isEqual(before.updateTime));
  }
  await configRef.update({ enabled: true, 'automation.pagos': true });
});

test('five concurrent real workers produce one POST and replay cannot POST twice', async () => {
  await seedPago('worker-race');
  const before = await configRef.get(), beforePosts = posts;
  const request = { data: { pagoId: 'worker-race', uploadId: 'receipt' } };
  await Promise.allSettled(Array.from({ length: 5 }, () => handlers.processIqPagoDepositAutomaticTask.run(request)));
  assert.equal(posts - beforePosts, 1);
  await handlers.processIqPagoDepositAutomaticTask.run(request);
  assert.equal(posts - beforePosts, 1);
  assert((await configRef.get()).updateTime.isEqual(before.updateTime));
});

test('transient enqueue/context errors retain a retryable generation and fallback has a grace period', async () => {
  await seedPago('retry'); failEnqueue = true;
  await assert.rejects(immediate.enqueueAutomaticPagoCreation('retry', 'receipt'));
  let row = (await db.doc('pagos/retry').get()).data();
  assert(row.iqDepositAutoDispatchEnqueueFailedAt);
  assert.equal(immediate.isAutomaticPagoRecoveryDue(row, row.iqDepositCreationQueuedAt.toMillis() + 60_001), true);
  failEnqueue = false;
  await immediate.enqueueAutomaticPagoCreation('retry', 'receipt');
  row = (await db.doc('pagos/retry').get()).data();
  assert.equal(row.iqDepositAutoDispatchEnqueueFailedAt, undefined);
  assert.equal(immediate.isAutomaticPagoRecoveryDue(row, row.iqDepositAutoDispatchRequestedAt.toMillis() + 60_001), false);
  assert.equal(immediate.isAutomaticPagoRecoveryDue(row, row.iqDepositAutoDispatchRequestedAt.toMillis() + 45 * 60_000), true);
  const configBeforeFailure = await configRef.get();
  failContext = true; const beforePosts = posts;
  await assert.rejects(handlers.processIqPagoDepositAutomaticTask.run({ data: { pagoId: 'retry', uploadId: 'receipt' } }));
  assert.equal(posts, beforePosts);
  assert.equal((await db.doc('pagos/retry').get()).data().iqDepositCreationStatus, 'QUEUED');
  assert((await configRef.get()).updateTime.isEqual(configBeforeFailure.updateTime));
  assert.equal(handlers.processIqPagoDepositAutomaticTask.options.retryConfig.maxAttempts, 3);
  failContext = false;
  await handlers.processIqPagoDepositAutomaticTask.run({ data: { pagoId: 'retry', uploadId: 'receipt' } });
  assert.equal(posts - beforePosts, 1);
});

test('concurrent automatic/manual/recovery deliveries share a transaction lock and write-once IQ ID', async () => {
  await seedPago('race'); const beforePosts = posts;
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => runCore('race')));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(posts - beforePosts, 1);
  await assert.rejects(runCore('race'), /ALREADY_LINKED/);
  const journal = adapters.createPagoAttemptJournal({ pagoId: 'race', actorUid: 'test', source: 'TEST', fingerprint: 'test' });
  await assert.rejects(journal.linkIqIdWriteOnce({ pay0PagoId: 'race', iqAttemptId: 'conflict', iqId: 992, verifiedPayload: iqRow }), /WRITE_ONCE_CONFLICT/);
  await handlers.markPagoIqAutoCreateErrorH4D62C({ pagoId: 'race', source: 'SCHEDULER', error: new Error('losing worker'), expectedUploadId: 'receipt' });
  assert.equal((await db.doc('pagos/race').get()).data().iqDepositCreationStatus, 'CREATED_RECOVERED');
});

test('unknown POST outcome is blocked across retries, including after lease expiry', async () => {
  await seedPago('unknown'); transportMode = 'unknown'; const beforePosts = posts;
  const result = await runCore('unknown');
  assert.equal(result.state, 'OUTCOME_UNKNOWN');
  await db.doc('pagos/unknown').update({ iqDepositCreationLeaseExpiresAt: Timestamp.fromMillis(1) });
  await assert.rejects(runCore('unknown'), /RETRY_BLOCKED/);
  await handlers.processIqPagoDepositAutomaticTask.run({ data: { pagoId: 'unknown', uploadId: 'receipt' } });
  assert.equal(posts - beforePosts, 1);
  assert.equal((await db.doc('pagos/unknown').get()).data().iqDepositCreationRetryBlocked, true);
  transportMode = 'success';
});

test('stale receipt events and the lock-time generation race never POST', async () => {
  await seedPago('stale', { iqDepositCreationQueuedUploadId: 'replacement' }); const beforePosts = posts;
  await immediate.enqueueAutomaticPagoCreation('stale', 'receipt');
  await handlers.processIqPagoDepositAutomaticTask.run({ data: { pagoId: 'stale', uploadId: 'receipt' } });
  await assert.rejects(runCore('stale', 'receipt'), /STALE_OR_INELIGIBLE_GENERATION/);
  await seedPago('terminal', { iqDepositTerminalLocked: true });
  await assert.rejects(runCore('terminal'), /STALE_OR_INELIGIBLE_GENERATION/);
  assert.equal(posts, beforePosts);
});

const rowsLib = load('src/lib/liveOperationRows.ts');
const discovery = load('src/lib/operationDiscovery.ts', { 'firebase/firestore': firestore });
async function eventually(predicate, message) {
  const until = Date.now() + 15000;
  while (!predicate() && Date.now() < until) await new Promise(r => setTimeout(r, 25));
  assert(predicate(), message);
}
function mountLiveRows(clientDb, collectionName, scope, initialRows, firstPage = initialRows) {
  // Minimal effect/ref lifecycle; real hook, queries, snapshots and production rules.
  const refs = [], effects = []; let cursor = 0, effectCursor = 0, active = true, queued = false;
  const state = { rows: initialRows, errors: [], updates: 0 };
  const hook = load('src/lib/useLiveOperationRows.ts', {
    react: {
      useRef(value) { const i = cursor++; return refs[i] ||= { current: value }; },
      useEffect(run, deps) {
        const i = effectCursor++, previous = effects[i];
        if (!previous || deps.some((d, k) => d !== previous.deps[k])) {
          previous?.cleanup?.(); effects[i] = { deps, run, pending: true };
        }
      },
    },
    'firebase/firestore': firestore, '@/lib/firebaseClient': { db: clientDb },
    '@/lib/liveOperationRows': rowsLib, '@/lib/operationDiscovery': discovery,
    '@/lib/operationTiming': { traceReactiveOperation() {} },
  });
  const seed = rowsLib.operationDiscoverySeed('scope', firstPage);
  function render() {
    if (!active) return; queued = false; cursor = 0; effectCursor = 0;
    hook.useLiveOperationRows({ collectionName, scopeKey: 'scope', enabled: true, scope, discovery: seed,
      rows: state.rows, onError: error => state.errors.push(error), setRows(update) {
        if (!active) throw new Error('State update after cleanup');
        const next = update(state.rows);
        if (next !== state.rows) { state.rows = next; state.updates++; }
        if (!queued) { queued = true; queueMicrotask(render); }
      } });
    for (const effect of effects) if (effect.pending) { effect.pending = false; effect.cleanup = effect.run(); }
  }
  render();
  return { state, stop() { active = false; for (const effect of effects) effect.cleanup?.(); } };
}

for (const collectionName of ['pagos', 'solicitudes']) test(`${collectionName}: two sessions discover rows, retain older pages and reconnect after a burst`, async () => {
  await db.doc('users/viewer').set({ role: 'superadmin', rootId: 'root' });
  const a = env.authenticatedContext('viewer').firestore();
  const b = env.authenticatedContext('viewer').firestore();
  const scope = { uid: 'viewer', rootId: 'root', role: 'superadmin', fromMillis: 1000, toMillis: 100000 };
  const initial = { id: 'initial', rootId: 'root', createdAt: firestore.Timestamp.fromMillis(5000), status: 'initial' };
  const old = { id: 'older-page', rootId: 'root', createdAt: firestore.Timestamp.fromMillis(2000), status: 'old' };
  await db.doc(`${collectionName}/initial`).set({ ...initial, createdAt: Timestamp.fromMillis(5000) });
  await db.doc(`${collectionName}/older-page`).set({ ...old, createdAt: Timestamp.fromMillis(2000) });
  // Discovery boundary belongs to the first page; old rows must keep their document listeners.
  const left = mountLiveRows(a, collectionName, scope, [initial, old], [initial]);
  const right = mountLiveRows(b, collectionName, scope, [initial, old], [initial]);
  try {
    await db.doc(`${collectionName}/new`).set({ rootId: 'root', createdAt: Timestamp.fromMillis(6000), status: 'new' });
    await eventually(() => left.state.rows.length === 3 && right.state.rows.length === 3, 'both sessions discover external insert');
    const stable = left.state.rows.find(r => r.id === 'initial');
    const iqField = collectionName === 'pagos' ? 'iqDepositFolio' : 'solicitudIqFolio';
    await db.doc(`${collectionName}/new`).update({ [iqField]: '991' });
    await eventually(() => left.state.rows[0][iqField] === '991' && right.state.rows[0][iqField] === '991', 'IQ update reaches both sessions');
    assert.equal(left.state.rows.find(r => r.id === 'initial'), stable, 'unaffected row identity retained');
    await firestore.disableNetwork(b);
    const batch = db.batch();
    for (let i = 0; i < 150; i++) batch.set(db.doc(`${collectionName}/burst-${i}`), { rootId: 'root', createdAt: Timestamp.fromMillis(7000 + i) });
    batch.set(db.doc(`${collectionName}/other-root`), { rootId: 'other', createdAt: Timestamp.fromMillis(8000) });
    await batch.commit();
    await firestore.enableNetwork(b);
    await eventually(() => right.state.rows.length === 153 && left.state.rows.length === 153, 'reconnection recovers all 150 new rows without sliding-limit loss');
    assert.equal(new Set(right.state.rows.map(r => r.id)).size, 153);
    await db.doc(`${collectionName}/older-page`).update({ status: 'updated' });
    await eventually(() => right.state.rows.find(r => r.id === 'older-page')?.status === 'updated', 'older loaded page still reactive');
    await db.doc(`${collectionName}/new`).delete();
    await eventually(() => !left.state.rows.some(r => r.id === 'new') && !right.state.rows.some(r => r.id === 'new'), 'deleted row removed');
    assert.deepEqual(left.state.errors, []); assert.deepEqual(right.state.errors, []);
    left.stop(); const stoppedUpdates = left.state.updates;
    await db.doc(`${collectionName}/after-unmount`).set({ rootId: 'root', createdAt: Timestamp.fromMillis(9000) });
    await eventually(() => right.state.rows.some(r => r.id === 'after-unmount'), 'remaining session continues');
    assert.equal(left.state.updates, stoppedUpdates);
  } finally { left.stop(); right.stop(); }
});

test('production rules accept scoped discovery for both collections and roles; deny widened operator query', async () => {
  for (const role of ['superadmin', 'admin', 'operador', 'operator']) {
    const uid = `scope-${role}`;
    await db.doc(`users/${uid}`).set({ role, rootId: 'scope-root' });
    const client = env.authenticatedContext(uid).firestore();
    for (const collectionName of ['pagos', 'solicitudes']) {
      const scope = { uid, rootId: 'scope-root', role, fromMillis: 1000, toMillis: 2000 };
      const query = discovery.buildOperationDiscoveryQuery(client, collectionName, scope, { scopeKey: 'test', boundary: null });
      await db.collection(collectionName).doc(`scope-${role}`).set({ rootId: 'scope-root', adminId: uid, createdBy: uid, createdAt: Timestamp.fromMillis(1500) });
      const result = await firestore.getDocsFromServer(query);
      assert(result.docs.some(d => d.id === `scope-${role}`));
      if (role !== 'superadmin') assert(result.docs.every(d => d.data()[role === 'admin' ? 'adminId' : 'createdBy'] === uid));
    }
  }
  const operator = env.authenticatedContext('scope-operator').firestore();
  await assert.rejects(firestore.getDocsFromServer(firestore.query(firestore.collection(operator, 'pagos'), firestore.where('rootId', '==', 'scope-root'))), error => error.code === 'permission-denied');
});

test('fixed first-page boundary, scope and nanosecond order preserve data identity without duplicates', () => {
  const first = { id: 'a', createdAt: { seconds: 10, nanoseconds: 1 }, rootId: 'root' };
  const second = { id: 'b', createdAt: { seconds: 10, nanoseconds: 2 }, rootId: 'root' };
  const seed = rowsLib.operationDiscoverySeed('scope', [second, first]);
  assert.equal(seed.boundary.nanoseconds, 1);
  const merged = rowsLib.mergeDiscoveredOperationRows([first], [second, second]);
  assert.equal(merged.length, 2); assert.equal(merged[0].id, 'b'); assert.equal(merged[1], first);
  assert.equal(rowsLib.mergeDiscoveredOperationRows(merged, [second]), merged);
  const scope = { uid: 'u', rootId: 'root', role: 'admin', fromMillis: 0, toMillis: 20000 };
  assert.equal(rowsLib.operationBelongsToScope({ ...first, adminId: 'someone-else' }, 'pagos', scope), false);
  assert.equal(rowsLib.operationBelongsToScope({ ...first, adminId: 'u' }, 'pagos', scope), true);
});


test('Solicitud AUTO task ignores a prior scheduler claim without changing configuration', async () => {
  await configRef.update({ enabled: true, 'automation.solicitudes': true, 'intervalMinutes.solicitudCreate': 1 });
  const input = { process: 'solicitudCreate', purpose: 'CREATION', respectWindow: false };
  assert.equal((await runtime.loadEnabledIqAutomationRoots(input)).has('root'), true);
  assert.equal((await runtime.loadEnabledIqAutomationRoots(input)).has('root'), false);
  const before = await configRef.get();
  await db.doc('iqCreateJobs/solicitud-gate').set({ rootId: 'root', status: 'QUEUED', profileId: 'test-profile' });
  let executions = 0, fail = false;
  const { processIqCreateOnDemandTask: task } = extract(['processIqCreateOnDemandTask'], {
    db, ...runtime, IQ_CREDENTIALS_KEY: 'local', TELEGRAM_BOT_TOKEN: 'local',
    onTaskDispatched: (options, run) => ({ options, run }), asRecord: value => value || {},
    cleanText: value => String(value || '').trim(), cleanUpper: value => String(value || '').toUpperCase(),
    processProfileJobs: async (profileId, jobs) => {
      assert.equal(profileId, 'test-profile'); assert.equal(jobs[0].id, 'solicitud-gate');
      if (fail) throw new Error('controlled processing failure');
      executions++;
    },
  }, 'functions/src/modules/iq/solicitudCreateQueueCallables.ts');
  const request = { data: { jobId: 'solicitud-gate', source: 'AUTO' } };
  await task.run(request);
  assert.equal(executions, 1, 'previously zero after the scheduler claim');
  assert((await configRef.get()).updateTime.isEqual(before.updateTime));
  fail = true;
  await assert.rejects(task.run(request), /controlled processing failure/, 'processing failure must propagate, not silently skip on the interval');
  assert((await configRef.get()).updateTime.isEqual(before.updateTime));
  fail = false;
  for (const patch of [{ enabled: false, 'automation.solicitudes': true }, { enabled: true, 'automation.solicitudes': false }]) {
    await configRef.update(patch); const off = await configRef.get();
    await task.run(request); assert.equal(executions, 1);
    assert((await configRef.get()).updateTime.isEqual(off.updateTime));
  }
  await configRef.update({ enabled: true, 'automation.solicitudes': true });
  await db.doc('iqCreateJobs/solicitud-gate').update({ status: 'COMPLETED' });
  await task.run(request); assert.equal(executions, 1, 'terminal job replay is ignored');
  assert.equal(task.options.retryConfig.maxAttempts, 1, 'existing Solicitudes retry configuration is unchanged');
  console.log('SOLICITUD REGRESSION: processProfileJobs=1 priorClaim=true configWrites=0');
});
// R5: exercise restored production identity and receipt protections on local data.
test('Solicitud associate is independent of login and catalog ambiguity fails closed', async () => {
  const { requireIqAssociatedName } = functionsRequire('./lib/modules/iq/associatedName.js');
  const invoice = functionsRequire('./lib/modules/iq/solicitudHttpCreateA53.js');
  assert.throws(() => requireIqAssociatedName(' '), /Asociado IQ/);
  assert.equal(requireIqAssociatedName(' Asociado   ACME '), 'Asociado ACME');
  assert.equal(invoice.resolveIqPartnerForInvoiceA53([{ id: 2, name: 'ACME' }], 'ASOCIADO ACME').id, 2);
  assert.throws(() => invoice.resolveIqPartnerForInvoiceA53([{ id: 2, name: 'ACME' }, { id: 3, name: 'ACME' }], 'ACME'), /NO_UNICO/);
  const catalog = [{ id: 10, name: 'Client' }, { id: 11, name: 'Other' }];
  assert.equal(invoice.resolveIqClientForInvoiceA53(catalog, { iqClientId: '11', clientName: 'Client' }).row.id, 11);
  assert.equal(invoice.resolveIqClientForInvoiceA53(catalog, { iqClientId: '999', clientName: 'Client' }).strategy, 'HTTP_CATALOG_STALE_ID_EXACT_NAME');
  assert.throws(() => invoice.resolveIqClientForInvoiceA53([...catalog, { id: 12, name: 'Client' }], { clientName: 'Client' }), /NO_UNICO/);
});

test('Pago persisted origin survives reassignment; wrong root, inactive or missing associate fail closed', async () => {
  const identity = functionsRequire('./lib/modules/iq/originIdentity.js');
  const canonical = functionsRequire('./lib/modules/iq/iqCanonicalAccess.js');
  await db.doc('iqCredentialProfiles/origin-a').set({ rootId: 'root', active: true, hasPassword: true,
    username: 'login-only', associatedName: 'ASOCIADO ACME', alias: 'A' });
  await db.doc('iqUserAccess/identity-actor').set({ rootId: 'root', active: true, iqEnabled: true,
    iqCredentialProfileId: 'origin-a', allowedModules: { pagos: true } });
  const captured = await identity.captureIqOriginIdentity({ actorUid: 'identity-actor', rootId: 'root', role: 'operador', moduleKey: 'pagos' });
  assert.equal(captured.originIqContext.associatedName, 'ASOCIADO ACME');
  assert.notEqual(captured.originIqContext.associatedName, 'login-only');
  await db.doc('iqUserAccess/identity-actor').update({ iqCredentialProfileId: 'different-profile' });
  const input = { movement: captured, rootId: 'root', authorizedActorUid: 'scheduler', encryptionSecret: 'unused', includePassword: false };
  const resolved = await identity.resolveEffectiveIqIdentity(input);
  assert.equal(resolved.effectiveIqProfileId, 'origin-a');
  identity.assertIqIdentityInvariant(resolved);
  await assert.rejects(identity.resolveEffectiveIqIdentity({ ...input, rootId: 'other-root' }), /root/);
  assert.throws(() => identity.assertIqIdentityInvariant({ originIqProfileId: 'origin-a', effectiveIqProfileId: 'different-profile' }), /SUBSTITUTION_BLOCKED/);
  await db.doc('iqCredentialProfiles/origin-a').update({ active: false });
  await assert.rejects(identity.resolveEffectiveIqIdentity(input), /inactiva/);
  await db.doc('iqCredentialProfiles/origin-a').update({ active: true, associatedName: '' });
  await assert.rejects(canonical.loadIqCanonicalProfileById({ profileId: 'origin-a', rootId: 'root', encryptionSecret: 'unused', includePassword: false, requireAssociatedName: true }), /Asociado IQ/);
  await assert.rejects(canonical.loadIqCanonicalProfileById({ profileId: 'origin-a', rootId: 'other-root', encryptionSecret: 'unused', includePassword: false }), /scope/);
});

test('Pago client resolution selects the origin profile and refuses unscoped legacy IDs', () => {
  const { resolveStoredIqClientIdForProfile: resolve } = functionsRequire('./lib/modules/iq/iqClientProfileLink.js');
  const access = { profileId: 'a', profileAlias: 'A', associatedName: 'ACME', username: 'login-only' };
  assert.equal(resolve({ iqClientId: 'wrong', iqLinksByProfile: { a: { clientId: 'correct' }, b: { clientId: 'other' } } }, access), 'correct');
  assert.equal(resolve({ iqClientId: 'unscoped' }, access), '');
  assert.equal(resolve({ iqLink: { profileId: 'b', clientId: 'foreign' } }, access), '');
  assert.equal(resolve({ iqLink: { profileId: 'a', clientId: 'legacy' } }, access), 'legacy');
});

test('identified receipt rejects hash mismatch; successful finalize and replay preserve document generation', async () => {
  const hash = require('node:crypto').createHash('sha256').update(receiptBytes).digest('hex');
  const pagoId = 'r5-receipt', uploadId = 'r5-upload', identificationId = 'r5-identification';
  await seedPago(pagoId, { despachoId: 'iq-dispatch', receiptIdentificationId: identificationId, iqDepositCreationStatus: 'READY' });
  const upload = { rootId: 'root', entityType: 'pagos', pagoId, documentType: 'COMPROBANTE_PAGO', storagePath: 'synthetic.pdf', status: 'PENDING', active: false };
  await db.doc(`uploads/${uploadId}`).set(upload);
  await db.doc(`pagoReceiptIdentifications/${identificationId}`).set({ rootId: 'root', pagoId, status: 'REGISTERED', stage: 'REGISTERED_AWAITING_RECEIPT', contentSha256: 'mismatch' });
  const count = tasks.size, audits = documentAuditCalls;
  await assert.rejects(documents.finalizePagoDocumentUploadCore({ data: { uploadId } }), /no coincide/);
  assert.equal(tasks.size, count); assert.equal(documentAuditCalls, audits);
  assert.equal((await db.doc(`uploads/${uploadId}`).get()).get('status'), 'PENDING');
  await db.doc(`pagoReceiptIdentifications/${identificationId}`).update({ contentSha256: hash });
  const first = await documents.finalizePagoDocumentUploadCore({ data: { uploadId } });
  assert.equal(first.version, 1); assert.equal(tasks.size, count + 1);
  const ready = await db.doc(`uploads/${uploadId}`).get(), pago = await db.doc(`pagos/${pagoId}`).get();
  const config = await configRef.get(), auditAfter = documentAuditCalls;
  assert.equal(ready.get('sha256'), hash);
  assert.equal(pago.get('iqApplicable'), true);
  assert.equal((await db.doc(`pagoReceiptIdentifications/${identificationId}`).get()).get('stage'), 'RECEIPT_READY');
  for (let i = 0; i < 3; i++) assert.deepEqual(await documents.finalizePagoDocumentUploadCore({ data: { uploadId } }), first);
  assert((await db.doc(`uploads/${uploadId}`).get()).updateTime.isEqual(ready.updateTime));
  assert((await db.doc(`pagos/${pagoId}`).get()).updateTime.isEqual(pago.updateTime));
  assert((await configRef.get()).updateTime.isEqual(config.updateTime));
  assert.equal(tasks.size, count + 1); assert.equal(documentAuditCalls, auditAfter);
  // A second upload of the same identified bytes reuses the canonical published receipt.
  await db.doc('uploads/r5-upload-copy').set(upload);
  const reused = await documents.finalizePagoDocumentUploadCore({ data: { uploadId: 'r5-upload-copy' } });
  assert.equal(reused.uploadId, uploadId); assert.equal(reused.version, 1);
  assert.equal(tasks.size, count + 1); assert.equal(documentAuditCalls, auditAfter);
});

test('receipt creation revalidates actor/root, payload and duplicate status transaction snapshot', () => {
  const { assertReceiptCreation } = functionsRequire('./lib/modules/pagos/receiptIdentification.js');
  const payload = { clienteId: 'client', companyId: 'own-company', montoTotal: 100, referencia: 'ref' };
  let row = { rootId: 'root', actorUid: 'actor', status: 'READY', createPayload: payload };
  const snapshot = { exists: true, get: field => row[field] };
  assertReceiptCreation(snapshot, { uid: 'actor', rootId: 'root' }, payload);
  assert.throws(() => assertReceiptCreation(snapshot, { uid: 'other', rootId: 'root' }, payload), /alcance/);
  assert.throws(() => assertReceiptCreation(snapshot, { uid: 'actor', rootId: 'other' }, payload), /alcance/);
  assert.throws(() => assertReceiptCreation(snapshot, { uid: 'actor', rootId: 'root' }, { ...payload, companyId: 'other' }), /cambi/);
  assert.throws(() => assertReceiptCreation(snapshot, { uid: 'actor', rootId: 'root' }, { ...payload, montoTotal: 101 }), /no coincide/);
  row = { ...row, status: 'REGISTERED', pagoId: 'existing' };
  assert.throws(() => assertReceiptCreation(snapshot, { uid: 'actor', rootId: 'root' }, payload), error => error.code === 'already-exists' && error.details.pagoId === 'existing');
});

test('restored transport protection blocks external actions in isolated environments', () => {
  const { externalActionsDecision, assertExternalActionsAllowed } = functionsRequire('./lib/modules/iq/externalActionsPolicy.js');
  assert.equal(externalActionsDecision({ GCLOUD_PROJECT: 'pay-0-system' }).allowed, true);
  for (const env of [{ GCLOUD_PROJECT: 'pay0-staging' }, { PAY0_ENVIRONMENT: 'test' }, { PAY0_EXTERNAL_ACTIONS_MODE: 'sandbox' }]) {
    assert.equal(externalActionsDecision(env).allowed, false);
    assert.throws(() => assertExternalActionsAllowed(env), /EXTERNAL_ACTIONS_DISABLED/);
  }
});
