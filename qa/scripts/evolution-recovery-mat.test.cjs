const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
function load(path, deps) {
  const exports = {};
  const js = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(js, { exports, Date, Set, Map, console, require: name => {
    assert.ok(name in deps, `Unexpected dependency: ${name}`); return deps[name];
  }});
  return exports;
}
function database(rows = {}) {
  const snapshot = (id, data) => ({ id, exists: Boolean(data), data: () => data, get: key => data?.[key] });
  return {
    doc: path => ({ get: async () => snapshot(path.split('/').pop(), rows[path]) }),
    collection: name => {
      let conditions = [], maxRows = Infinity, cursorId = null;
      const q = {
        doc: id => ({ get: async () => snapshot(id, rows[`${name}/${id}`]) }),
        where: (key, op, value) => { conditions.push([key, value]); return q; },
        limit: value => { maxRows = value; return q; },
        startAfter: cursor => { cursorId = cursor.id; return q; },
        get: async () => {
          const docs = Object.entries(rows).filter(([path, data]) => path.startsWith(name + '/') && conditions.every(([key, value]) => data[key] === value)).map(([path, data]) => snapshot(path.split('/').pop(), data)).sort((a, b) => a.id.localeCompare(b.id)).filter(doc => cursorId === null || doc.id.localeCompare(cursorId) > 0).slice(0, maxRows);
          return { docs, empty: !docs.length };
        },
      }; return q;
    },
  };
}
const mat = load('functions/src/modules/telegramMiniApp/service.ts', {
  '../ledger/service': { readCanonicalBalanceSummary: async db => ({ rootId: db.ledgerRoot, availableBalance: 10, netBalance: 10, pendingAdvance: 0 }), readCanonicalStatement: async db => ({ summary: { rootId: db.statementRoot }, rows: [] }) },
  '../financing/dispersionFunding': { assertDispersionFundingOwner: ({ uid, dispersion }) => { if (dispersion.fundingSource?.holderType === 'USER' && dispersion.fundingSource.holderId !== uid) throw Error('Denied'); } },
});
const home = db => mat.buildMatUserHome({ db, telegramUserId: 'tg', displayName: 'Test', username: '' });
test('MAT empty client scope exposes no root requests and preserves own withdrawal', async () => {
  const db = database({ 'telegramUsers/tg': { uid: 'u', active: true }, 'users/u': { role: 'operador', rootId: 'r' }, 'solicitudes/s': { rootId: 'r', clienteId: 'other' }, 'clientDispersions/d': { rootId: 'r', fundingSource: { holderType: 'USER', holderId: 'u' } } });
  const result = await home(db);
  assert.equal(result.solicitudes.length, 0); assert.equal(result.dispersiones.length, 1);
});
test('MAT visible client remains accessible and foreign clients remain excluded', async () => {
  const result = await home(database({ 'telegramUsers/tg': { uid: 'u' }, 'users/u': { role: 'operador', rootId: 'r', uid: 'spoofed' }, 'clients/c': { rootId: 'r', createdBy: 'u' }, 'clients/f': { rootId: 'foreign', createdBy: 'u' }, 'solicitudes/s': { rootId: 'r', clienteId: 'c' }, 'solicitudes/f': { rootId: 'r', clienteId: 'f' } }));
  assert.equal(result.pay0UserId, 'u'); assert.equal(result.solicitudes.length, 1); assert.equal(result.solicitudes[0].id, 's');
});
test('explicit revoked Telegram links cannot fall back to legacy records', async () => {
  const db = database({ 'telegramUsers/tg': { uid: 'u', active: false }, 'users/u': { telegramUserId: 'tg', rootId: 'r' }, 'clientTelegramUsers/tg': { active: false, clientId: 'c' }, 'clientTelegramUsers/legacy': { telegramUserId: 'tg', clientId: 'c', active: true } });
  assert.equal(await mat.resolveInternalUserByTelegramId(db, 'tg'), null);
  assert.equal(await mat.resolveClientLinkByTelegramId(db, 'tg'), null);
});
test('client home denies missing and foreign-root clients and filters contaminated rows', async () => {
  const request = db => mat.buildMatClientHome({ db, telegramUserId: 'tg', displayName: '', username: '' });
  for (const client of [undefined, { rootId: 'foreign' }, { rootId: 'r', deletedAt: 1 }]) {
    const result = await request(database({ 'clientTelegramUsers/tg': { rootId: 'r', clientId: 'c' }, ...(client ? { 'clients/c': client } : {}) }));
    assert.equal(result.linked, false);
  }
  const result = await request(database({ 'clientTelegramUsers/tg': { rootId: 'r', clientId: 'c' }, 'clients/c': { rootId: 'r' }, 'solicitudes/s': { rootId: 'r', clienteId: 'c' }, 'solicitudes/f': { rootId: 'foreign', clienteId: 'c' } }));
  assert.equal(result.linked, true); assert.equal(result.solicitudes.length, 1);
});
const recoveryDb = { collection: () => ({ doc: () => ({}) }), doc: () => ({}) };
const recovery = load('functions/src/modules/controlCenter/recovery.ts', {
  '../iq/historicalImportGuard': { isIqHistoricalImport: () => false }, crypto: require('node:crypto'),
  'firebase-admin/firestore': { FieldValue: { serverTimestamp: () => 1, delete: () => null }, Timestamp: { now: () => 1, fromMillis: value => ({ toMillis: () => value }) } },
  'firebase-functions/v2/firestore': { onDocumentWritten: (_, handler) => handler },
  'firebase-functions/v2/scheduler': { onSchedule: (_, handler) => handler },
  '../sharedCallables/helpers': { db: recoveryDb }, '../../utils/logActivity': { logActivityTx: () => {} }, '../../utils/authGuard': {},
  '../clientDelegations/access': {}, '../facturama/issuerGuard': { belongsToPay0Dispatch: () => true },
});
test('recovery terminal source guards include soft deletion and cancellation/rejection', () => {
  for (const row of [{ deletedAt: 1 }, { isDeleted: true }, ...['ELIMINADA', 'CANCELADA', 'RECHAZADA'].map(status => ({ status }))]) assert.equal(recovery.recoverySourceIsTerminal(row), true);
  assert.equal(recovery.recoverySourceIsTerminal({ status: 'PROCESANDO' }), false);
});
test('duplicate recovery events never reset completed or exhausted generation budgets', async () => {
  let writes = 0;
  for (const status of ['COMPLETED', 'NEEDS_REVIEW', 'PENDING', 'RUNNING', 'SUPERSEDED']) {
    recoveryDb.runTransaction = async callback => callback({ get: async ref => ref.source ? { exists: true, data: () => ({ rootId: 'r', materialitySyncStatus: 'ERROR' }), get: key => ({ rootId: 'r', materialitySyncStatus: 'ERROR' })[key] } : { exists: true, data: () => ({ status, attempts: 5 }) }, set: () => writes++ });
    recoveryDb.doc = () => ({ source: true });
    await recovery.enqueueRecovery('s', { rootId: 'r', createdBy: 'u' }, 'MATERIALITY');
  }
  assert.equal(writes, 0);
});

test('recovery exhausts the fifth failed attempt and a stale worker cannot complete a newer lease', async () => {
  let row;
  const ref = {};
  recoveryDb.collection = () => ({ where: () => ({ limit: () => ({ get: async () => ({ docs: [{ ref }] }) }) }) });
  recoveryDb.runTransaction = async callback => callback({
    get: async () => ({ data: () => ({ ...row }) }),
    update: (_, update) => { Object.assign(row, update); },
  });
  row = { status: 'PENDING', attempts: 4, nextAttemptAt: { toMillis: () => 0 }, rootId: 'r', solicitudId: 's', kind: 'MATERIALITY' };
  await recovery.processRecoveryJobs(async () => { throw Error('TRANSIENT_ERROR'); });
  assert.equal(row.status, 'NEEDS_REVIEW'); assert.equal(row.attempts, 5);
  row = { status: 'PENDING', attempts: 0, nextAttemptAt: { toMillis: () => 0 }, rootId: 'r', solicitudId: 's', kind: 'MATERIALITY' };
  await recovery.processRecoveryJobs(async () => { row.lease = 'new-owner'; });
  assert.equal(row.status, 'RUNNING'); assert.equal(row.lease, 'new-owner');
});


test('MAT request and return actions navigate to guarded PAY0 workflows', () => {
  for (const scope of ['usuarios', 'clientes']) {
    const file = `src/app/mat/${scope}/page.tsx`;
    const source = fs.readFileSync(file, 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const panel = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ActionPanel');
    assert.ok(panel);
    const js = ts.transpileModule('export ' + panel.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const exports = {}, destinations = [];
    const runtime = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    vm.runInNewContext(js, { exports, require: () => runtime, window: { location: { assign: target => destinations.push(target) } } });
    const links = [];
    function visit(node) {
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'ActionPanel') {
        const values = Object.fromEntries(node.attributes.properties.filter(ts.isJsxAttribute).map(attribute => [attribute.name.getText(ast), attribute.initializer?.text]));
        if (values.primaryHref) links.push(values);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    assert.deepEqual(links.map(link => link.primaryHref), ['/solicitudes', '/wallet/dispersiones']);
    for (const props of links) {
      const rendered = exports.ActionPanel(props);
      rendered.props.children[0].props.onClick();
      rendered.props.children[1].props.onClick();
      assert.match(rendered.props.children[2].props.children, /iniciar sesión.*permisos/);
    }
    assert.deepEqual(destinations, ['/solicitudes', '/solicitudes', '/wallet/dispersiones', '/wallet/dispersiones']);
  }
});

test('MAT rejects explicitly foreign ledger roots and retains legacy missing-root compatibility', async () => {
  const db = database({ 'telegramUsers/tg': { uid: 'u' }, 'users/u': { rootId: 'r', role: 'operador' } });
  assert.equal((await home(db)).balance.availableBalance, 10);
  db.ledgerRoot = 'foreign';
  await assert.rejects(home(db), /MAT_LEDGER_SCOPE_DENIED/);
  db.ledgerRoot = 'r'; db.statementRoot = 'foreign';
  await assert.rejects(home(db), /MAT_LEDGER_SCOPE_DENIED/);
  const clientDb = database({ 'clientTelegramUsers/tg': { rootId: 'r', clientId: 'c' }, 'clients/c': { rootId: 'r' } });
  clientDb.ledgerRoot = 'foreign';
  await assert.rejects(mat.buildMatClientHome({ db: clientDb, telegramUserId: 'tg', displayName: '', username: '' }), /MAT_LEDGER_SCOPE_DENIED/);
});

test('MAT authorizes clients beyond the six displayed cards', async () => {
  const rows = { 'telegramUsers/tg': { uid: 'u' }, 'users/u': { rootId: 'r', role: 'operador' } };
  for (let i = 0; i < 8; i++) rows[`clients/c${i}`] = { rootId: 'r', createdBy: 'u', name: `Client ${i}` };
  rows['solicitudes/last'] = { rootId: 'r', clienteId: 'c7' };
  const result = await home(database(rows));
  assert.equal(result.clients.length, 6);
  assert.equal(result.solicitudes.length, 1);
  assert.equal(result.solicitudes[0].id, 'last');
});

test('MAT client authorization follows the next page before slicing cards', async () => {
  const rows = { 'telegramUsers/tg': { uid: 'u' }, 'users/u': { rootId: 'r', role: 'operador' } };
  for (let i = 0; i < 251; i++) rows[`clients/c${String(i).padStart(3, '0')}`] = { rootId: 'r', createdBy: 'u', name: `Client ${i}` };
  rows['solicitudes/last-page'] = { rootId: 'r', clienteId: 'c250' };
  const result = await home(database(rows));
  assert.equal(result.clients.length, 6);
  assert.equal(result.solicitudes[0].id, 'last-page');
});
