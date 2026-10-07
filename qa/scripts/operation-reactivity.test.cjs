const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');

function load(file, dependencies = {}) {
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, require(name) {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }});
  return exports;
}
const { replaceOperationRow, createOperationSubscriptions } = load('src/lib/liveOperationRows.ts');

test('Solicitud service unwraps the Firebase contract for single and bulk upload', async () => {
  const service = load('src/services/solicitudes.ts', {
    'firebase/functions': { httpsCallable: () => async () => ({ data: { ok: true, solicitudId: 's1', folio: 'TEST' } }) },
    '@/lib/firebaseClient': { functions: {} },
  });
  const result = await service.createSolicitud({});
  assert.equal(result.solicitudId, 's1');
  assert.equal(result.folio, 'TEST');
});

test('IQ folio, status and applications update only the affected row; removed fields disappear', () => {
  const a = { id: 'a', status: 'PROCESANDO', obsolete: true };
  const b = { id: 'b', status: 'PROCESANDO' };
  const next = replaceOperationRow([a, b], 'a', { id: 'a', status: 'COMPLETADA', solicitudIqFolio: '123', totalAbonado: 100 });
  assert.equal(next[0].status, 'COMPLETADA');
  assert.equal(next[0].solicitudIqFolio, '123');
  assert.equal(next[0].obsolete, undefined);
  assert.equal(next[1], b);
  assert.equal(replaceOperationRow(next, 'a', next[0]), next);
});

test('payment enrichment survives document updates and deleted documents are removed', () => {
  const rows = [{ id: 'p1', iqApplicable: false, status: 'CONCILIACION_PENDIENTE' }];
  const next = replaceOperationRow(rows, 'p1', { id: 'p1', status: 'CONCILIADO', pagoIqFolio: '456' });
  assert.equal(next[0].iqApplicable, false);
  assert.equal(next[0].status, 'CONCILIADO');
  assert.equal(replaceOperationRow(next, 'p1', { id: 'p1', iqApplicable: true })[0].iqApplicable, false, 'callable enrichment takes precedence over an older persisted flag');
  assert.equal(replaceOperationRow(next, 'p1', null).length, 0);
  assert.equal(replaceOperationRow(rows, 'unknown', { id: 'unknown' }), rows);
});

test('pagination adds subscriptions without replacing existing ones; cleanup is idempotent', () => {
  const starts = [], stops = [];
  const manager = createOperationSubscriptions(id => {
    starts.push(id);
    return () => stops.push(id);
  });
  manager.reconcile(['a', 'b']);
  manager.reconcile(['b', 'a', 'a']);
  manager.reconcile(['a', 'b', 'c']);
  assert.deepEqual(starts, ['a', 'b', 'c']);
  manager.reconcile(['c']);
  assert.deepEqual(stops, ['a', 'b']);
  manager.dispose(); manager.dispose();
  assert.deepEqual(stops, ['a', 'b', 'c']);
});

test('two independent consumers receive the same backend updates; leaving one does not stop the other', () => {
  const listeners = new Set();
  const results = [[], []];
  const managers = results.map(result => createOperationSubscriptions(id => {
    const listener = value => result.push({ id, value });
    listeners.add(listener);
    return () => listeners.delete(listener);
  }));
  managers.forEach(manager => manager.reconcile(['p1']));
  listeners.forEach(listener => listener('456'));
  assert.equal(results[0][0].value, '456');
  assert.equal(results[1][0].value, '456');
  managers[0].dispose();
  listeners.forEach(listener => listener('CONCILIADO'));
  assert.equal(results[0].length, 1);
  assert.equal(results[1].length, 2);
  managers[1].dispose();
  assert.equal(listeners.size, 0);
});

function paymentAction(source, failPay0 = false) {
  const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'applySelectedFolios') initializer = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert(initializer);
  let resolveIq, rejectIq;
  const iq = new Promise((resolve, reject) => { resolveIq = resolve; rejectIq = reject; });
  const state = { overlay: false, modalOpen: false, writes: 0, plans: 0, flow: null };
  const noop = () => {};
  const context = {
    exports: {}, canApplyPagos: true, applyFor: { id: 'p1', montoDisponible: 100 },
    actionId: '', iqFlowActionRef: { current: false }, applyRequestKeyRef: { current: 'stable-key' },
    foliosAplicables: [{ id: 's1', folio: 'TEST' }], applyAmounts: { s1: 10 },
    money2: Number, getSolicitudPendiente: () => 100, isPagoIqLinked: () => false,
    getSolicitudIqFolioVisible: () => '123', getIqFlowStage: () => 'READY',
    setPageMsg: noop, setIqHumanConfirmed: noop, setIqFlowOpen: value => { state.modalOpen = value; },
    setApplyFor: noop, setApplyAmounts: noop, setActionId: noop, setIqFlowBusy: noop,
    setIqFlow: value => { state.flow = typeof value === 'function' ? value(state.flow) : value; },
    globalLoading: { async run(_, action) { state.overlay = true; try { return await action(); } finally { state.overlay = false; } } },
    applyPagoToSolicitudesAtomic: async ({ idempotencyKey }) => {
      assert.equal(idempotencyKey, 'stable-key'); state.writes++;
      if (failPay0) throw new Error('controlled PAY0 failure');
      return { ok: true };
    },
    preparePagoApplicationIqPlan: () => { state.plans++; return iq; },
  };
  const compiled = ts.transpileModule(`exports.run = ${initializer}`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(compiled, context);
  return { run: context.exports.run, state, context, resolveIq, rejectIq };
}

test('baseline blocks UI on IQ preparation; corrected action releases it after PAY0 and prevents duplicate submit', async () => {
  const baselineSource = execFileSync('git', ['show', 'fe2b98b:src/app/pagos/page.tsx'], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  const baseline = paymentAction(baselineSource);
  const before = baseline.run();
  await new Promise(setImmediate);
  assert.equal(baseline.state.overlay, true, 'reproduces P0-A while IQ is pending');
  baseline.resolveIq({}); await before;

  const current = paymentAction(fs.readFileSync('src/app/pagos/page.tsx', 'utf8'));
  const after = current.run();
  await new Promise(setImmediate);
  assert.equal(current.state.overlay, false, 'UI released while IQ remains pending');
  assert.equal(current.state.modalOpen, false, 'IQ progress does not block the page with a modal');
  await current.run();
  assert.equal(current.state.writes, 1, 'in-flight lock prevents duplicate financial application');
  current.rejectIq(new Error('controlled IQ failure')); await after;
  assert.equal(current.state.flow.stage, 'PREPARATION_ERROR');
  assert.equal(current.context.applyRequestKeyRef.current, 'stable-key', 'retry retains idempotency key');
  assert.equal(current.context.iqFlowActionRef.current, false);
});

test('PAY0 failure never proceeds to IQ preparation', async () => {
  const current = paymentAction(fs.readFileSync('src/app/pagos/page.tsx', 'utf8'), true);
  await current.run();
  assert.equal(current.state.plans, 0);
  assert.equal(current.state.overlay, false);
  assert.equal(current.context.applyRequestKeyRef.current, 'stable-key');
});

test('actual hook ignores cached snapshots and late callbacks, surfaces revoked access and unsubscribes', () => {
  const effects = [], subscriptions = [], errors = [];
  let rows = [{ id: 'p1', status: 'CONCILIACION_PENDIENTE' }];
  const hook = load('src/lib/useLiveOperationRows.ts', {
    react: { useRef: current => ({ current }), useEffect: effect => effects.push(effect) },
    'firebase/firestore': {
      doc: (_, collectionName, id) => ({ collectionName, id }),
      onSnapshot: (ref, options, next, error) => {
        const sub = { ref, options, next, error, stopped: false };
        subscriptions.push(sub);
        return () => { sub.stopped = true; };
      },
    },
    '@/lib/firebaseClient': { db: {} },
    '@/lib/liveOperationRows': { replaceOperationRow, createOperationSubscriptions },
    '@/lib/operationTiming': { traceReactiveOperation() {} },
    '@/lib/operationDiscovery': { buildOperationDiscoveryQuery() { return null; } },
  });
  hook.useLiveOperationRows({ collectionName: 'pagos', scopeKey: 'user:root:range', enabled: true,
    rows, setRows: update => { rows = update(rows); }, onError: message => errors.push(message) });
  const cleanup = effects.map(effect => effect()).filter(Boolean);
  const subscription = subscriptions[0];
  const snapshot = fromCache => ({ metadata: { fromCache }, exists: () => true,
    data: () => ({ status: 'CONCILIADO', pagoIqFolio: '456' }) });
  subscription.next(snapshot(true));
  assert.equal(rows[0].status, 'CONCILIACION_PENDIENTE');
  subscription.next(snapshot(false));
  assert.equal(rows[0].status, 'CONCILIADO');
  subscription.error({ code: 'permission-denied' });
  assert.equal(rows.length, 0);
  assert.equal(errors.length, 1);
  cleanup.forEach(dispose => dispose());
  assert.equal(subscription.stopped, true);
  subscription.next(snapshot(false));
  subscription.error({ code: 'permission-denied' });
  assert.equal(errors.length, 1);
  assert.equal(rows.length, 0);
});
