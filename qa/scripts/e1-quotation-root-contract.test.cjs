const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');

function load(rootId) {
  const calls = { authorization: 0, clientAccess: 0, uploads: 0 };
  const db = { collection(name) {
    if (name === 'solicitudes') return { doc: () => ({ get: async () => ({ exists: true, data: () => ({ rootId, clienteId: 'same-client', companyId: 'same-company' }) }) }) };
    if (name === 'uploads') {
      calls.uploads++;
      const query = { where: () => query, limit: () => query, get: async () => ({ empty: false, docs: [{ id: 'existing-quote', data: () => ({ documentType: 'COTIZACION', active: true }) }] }) };
      return query;
    }
    throw Error(`Unexpected collection ${name}`);
  }};
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const dependencies = {
    'firebase-admin': { apps: [{}], firestore: () => db },
    crypto: require('node:crypto'), fs: require('node:fs'), path,
    'firebase-admin/firestore': { FieldValue: {} },
    'firebase-functions/v2/https': { HttpsError, onCall: (_options, handler) => handler },
    '../../utils/authGuard': { assertAuthorized: () => { calls.authorization++; }, getUserRole: () => 'superadmin' },
    '../../utils/logActivity': {},
    '../sharedCallables/helpers': { requireAuth: () => 'actor', getMyUser: async () => ({ rootId: 'allowed-root', role: 'superadmin' }) },
    '../solicitudDocuments/lifecycle': {}, '../materiality/service': {}, '../documents/canonicalPdf': {}, '../canonicalCenter/service': {},
    '../clientDelegations/access': { requireClientOperationalAccess: async () => { calls.clientAccess++; } },
  };
  const exports = {};
  const file = path.resolve('functions/src/modules/cotizaciones/callables.ts');
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(source, { exports, __dirname: path.dirname(file), Buffer, console, require: name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name];
  }});
  return { calls, core: exports.generateCotizacionForSolicitudCore };
}

test('foreign-root request is denied before client/quote access even with local related IDs', async () => {
  const { calls, core } = load('foreign-root');
  await assert.rejects(core({ auth: { uid: 'actor' }, data: { solicitudId: 'foreign-solicitud' } }), error => error.code === 'permission-denied');
  assert.deepEqual(calls, { authorization: 1, clientAccess: 0, uploads: 0 });
});
test('missing solicitud root fails closed', async () => {
  const { calls, core } = load(undefined);
  await assert.rejects(core({ auth: { uid: 'actor' }, data: { solicitudId: 'legacy-solicitud' } }), error => error.code === 'permission-denied');
  assert.equal(calls.uploads, 0);
});
test('same-root request preserves idempotent existing quotation response', async () => {
  const { calls, core } = load('allowed-root');
  const result = await core({ auth: { uid: 'actor' }, data: { solicitudId: 'local-solicitud' } });
  assert.equal(result.alreadyExists, true);
  assert.equal(result.uploadId, 'existing-quote');
  assert.deepEqual(calls, { authorization: 1, clientAccess: 1, uploads: 1 });
});
