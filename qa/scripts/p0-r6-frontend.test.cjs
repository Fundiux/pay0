const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { test } = require('node:test');
const policy = require('../../config/authorization-policy.json');
function load(file, deps = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  new Function('exports', 'require', code)(exports, key => { assert(key in deps, `Unexpected dependency ${key}`); return deps[key]; });
  return exports;
}
function extract(file, name, context = {}) {
  const source = fs.readFileSync(file, 'utf8'), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  const visit = n => { if (n.name?.text === name && (ts.isFunctionDeclaration(n) || ts.isVariableDeclaration(n))) found = n; ts.forEachChild(n, visit); }; visit(ast);
  assert(found, name);
  const value = ts.isFunctionDeclaration(found) ? `(${found.getText(ast)})` : found.initializer.getText(ast);
  const code = ts.transpileModule(`return ${value};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  return new Function(...Object.keys(context), code)(...Object.values(context));
}
const roles = load('src/lib/roles.ts', { '../../config/authorization-policy.json': policy });
test('restored routes preserve production role boundaries and account validation', () => {
  for (const role of ['admin', 'operador', 'superadmin']) {
    const profile = { role };
    assert.equal(roles.canAccessRoutePath(profile, '/cuenta'), true);
    assert.equal(roles.canAccessRoutePath(profile, '/administracion/recursos-corporativos'), role === 'superadmin');
    assert.equal(roles.canAccessRoutePath(profile, '/hugo/evaluation'), role === 'superadmin');
  }
  const account = load('src/lib/accountValidation.ts');
  assert.equal(account.normalizeAccountUsername('  TEST.User  '), 'test.user');
  assert.throws(() => account.normalizeAccountUsername('bad name'));
  for (const args of [['', 'new-pass', 'new-pass'], ['old-pass', 'short', 'short'], ['old-pass', 'new-pass', 'mismatch'], ['old-pass', 'old-pass', 'old-pass']]) assert.throws(() => account.validatePasswordChange(...args));
  const manifest = load('src/app/manifest.ts').default();
  assert.equal(manifest.start_url, '/'); assert.equal(manifest.display, 'standalone'); assert.equal(manifest.lang, 'es-MX');
  const blind = require('../../evals/hugo/phase9/phase9-blind-review.json');
  assert(Array.isArray(blind.cases));
});

test('receipt UI accepts only the matching server identification and preserves review reasons', () => {
  const ui = load('src/lib/receiptAutomaticRegistration.ts');
  const id = 'a'.repeat(64), payload = { receiptIdentificationId: id, operationTypeKey: 'deposit', montoTotal: 100 };
  const valid = { id, status: 'READY', reasons: [], createPayload: payload };
  assert.equal(ui.automaticReceiptPayload(valid, 'deposit'), payload);
  for (const invalid of [undefined, { ...valid, status: 'REGISTERED' }, { ...valid, id: 'invalid' }, { ...valid, reasons: ['DUPLICATE'] }, { ...valid, createPayload: { ...payload, receiptIdentificationId: 'b'.repeat(64) } }]) assert.equal(ui.automaticReceiptPayload(invalid, 'deposit'), null);
  assert.equal(ui.automaticReceiptPayload(valid, 'changed-operation'), null);
  assert.match(ui.automaticReceiptMissing(valid, 'changed-operation')[0], /vuelve a validar/);
  assert.match(ui.receiptReviewReason('AMOUNT_REQUIRES_REVIEW'), /importe/);
  for (const role of ['admin', 'operador']) {
    const modules = roles.mergeModules(role, { pagos: { create: true, uploadDocs: false, conciliate: true } });
    assert.equal(extract('src/app/pagos/page.tsx', 'canManagePagoDocs', { modules }), false);
    assert.equal(modules.pagos.conciliate, false);
  }
});

test('Pago UI preserves identified payload, finalization barrier and upload-failure recovery', async () => {
  let createCalls = [], uploadCalls = 0, uploaded = false, failUpload = false, finishUpload;
  const upload = new Promise(resolve => { finishUpload = resolve; });
  const scope = { uid: 'u', rootId: 'r', role: 'superadmin', fromMillis: 0, toMillis: 100 };
  const action = extract('src/app/pagos/page.tsx', 'createPagoWithReceipt', {
    pagosRequestSeq: { current: 1 }, createPago: async input => { createCalls.push(input); return { pagoId: 'p1' }; },
    uploadPagoDoc: async () => { uploadCalls++; if (failUpload) throw new Error("local upload failure"); await upload; uploaded = true; },
    getDoc: async () => ({ exists: () => false }), doc() {}, db: {}, setPagos() {}, setPageMsg() {},
    myUid: 'u', rootId: 'r', role: 'superadmin', range: { from: new Date(0), to: new Date(100) }, creatorUid: '',
    isSuperAdmin: roles.isSuperAdmin, isAdmin: roles.isAdmin, operationBelongsToScope() { return true; },
    window: { confirm() { throw Error('Identified receipts must not use manual RFC override'); } },
  });
  const input = { clienteId: 'c', companyId: 'co', receiptIdentificationId: 'a'.repeat(64), operationTypeKey: 'deposit', file: {}, montoTotal: 100 };
  let settled = false;
  const result = action(input).then(value => { settled = true; return value; });
  await new Promise(setImmediate); assert.equal(uploadCalls, 1); assert.equal(settled, false); assert.equal(uploaded, false);
  assert.equal(createCalls[0].receiptIdentificationId, input.receiptIdentificationId);
  finishUpload(); assert.equal(await result, 'p1'); assert.equal(uploaded, true);
  failUpload = true;
  await assert.rejects(action(input), error => error.pagoId === 'p1' && error.message === 'local upload failure');
});

test('new-row discovery preserves the production creator filter and stable existing rows', () => {
  const rows = load('src/lib/liveOperationRows.ts');
  const calls = [];
  const query = load('src/lib/operationDiscovery.ts', { 'firebase/firestore': {
    collection: (_, name) => name, documentId: () => '__name__', where: (...args) => { calls.push(args); return args; }, orderBy: (...args) => args, query: (...args) => args,
    Timestamp: Object.assign(class { constructor(seconds, nanoseconds) { Object.assign(this, { seconds, nanoseconds }); } }, { fromMillis: value => value }),
  } });
  const scope = { uid: 'admin', rootId: 'r', role: 'admin', fromMillis: 0, toMillis: 9999, creatorUid: 'selected-user' };
  query.buildOperationDiscoveryQuery({}, 'pagos', scope, { boundary: null });
  assert(calls.some(c => JSON.stringify(c) === JSON.stringify(['createdBy', '==', 'selected-user'])));
  const row = { id: 'p1', rootId: 'r', adminId: 'admin', createdBy: 'selected-user', createdAt: { seconds: 1, nanoseconds: 0 } };
  assert(rows.operationBelongsToScope(row, 'pagos', scope));
  calls.length = 0;
  query.buildOperationDiscoveryQuery({}, 'solicitudes', scope, { boundary: null });
  assert(calls.some(c => JSON.stringify(c) === JSON.stringify(['rootId', '==', 'r'])));
  assert(!rows.operationBelongsToScope({ ...row, rootId: 'foreign' }, 'solicitudes', scope));
  assert(!rows.operationBelongsToScope({ ...row, createdBy: 'other' }, 'pagos', scope));
  const next = rows.mergeDiscoveredOperationRows([row], [{ ...row, id: 'p2', createdAt: { seconds: 2, nanoseconds: 0 } }]);
  assert.equal(next[1], row); assert.equal(next[0].id, 'p2');
});

test('activity query scopes each role, includes current PAY0 source and excludes other systems', () => {
  const system = load('src/lib/systemActivity.ts');
  const ui = load('src/lib/activityLogQuery.ts', { 'firebase/firestore': {
    collection: (_, name) => name, where: (...args) => ['where', ...args], orderBy: (...args) => ['order', ...args], limit: n => ['limit', n], query: (...args) => args,
  } });
  for (const role of ['superadmin', 'admin', 'operador']) {
    const q = ui.buildActivityLogQuery({}, system.SYSTEM_ACTIVITY_COLLECTIONS.PAY0, { uid: 'u', rootId: 'r', role, maxRows: 20 });
    assert.equal(q[0], 'pay0ActivityLog');
    assert(q.some(c => JSON.stringify(c) === JSON.stringify(['where', 'sourceSystem', '==', 'PAY0'])));
    assert(q.some(c => JSON.stringify(c) === JSON.stringify(['where', 'rootId', '==', 'r'])));
    if (role !== 'superadmin') assert(q.some(c => c[1] === (role === 'admin' ? 'adminId' : 'actorUid') && c[3] === 'u'));
    assert.deepEqual(q.slice(-2), [['order', 'createdAt', 'desc'], ['limit', 20]]);
  }
  assert(system.belongsToSystem({ event: 'PAGO_CREADO' }, 'PAY0'));
  assert(!system.belongsToSystem({ event: 'ASSET_CREATED' }, 'PAY0'));
  assert(!system.belongsToSystem({ sourceSystem: 'HUGO', event: 'PAGO_CREADO' }, 'PAY0'));
  assert.throws(() => ui.buildActivityLogQuery({}, 'hugoActivityLog', { uid: 'u', rootId: 'r', role: 'superadmin', maxRows: 20 }));
});


test('Solicitud hide and delete send distinct commands and do not claim deletion on a failed backend response', async () => {
 const calls=[];let error='';let fail=false;
 const ctx={window:{confirm:()=>true},setPageMsg:v=>{error=v;},changeSolicitudStatus:async data=>{calls.push(data);if(fail)throw Error('controlled rejection');return {data:{isDeleted:data.newStatus==='ELIMINADA'}};}};
 const hide=extract('src/app/solicitudes/page.tsx','handleHide',ctx),del=extract('src/app/solicitudes/page.tsx','handleDelete',ctx);
 await hide('synthetic',true);await hide('synthetic',false);await del('synthetic');
 assert.deepEqual(calls,[{solicitudId:'synthetic',ocultar:true},{solicitudId:'synthetic',ocultar:false},{solicitudId:'synthetic',newStatus:'ELIMINADA'}]);
 fail=true;await del('synthetic');assert.match(error,/controlled rejection/);
});
