const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');

function loadSource(filename, mocks = {}) {
  const resolved = path.resolve(filename);
  const output = ts.transpileModule(fs.readFileSync(resolved, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  const localRequire = (id) => {
    if (id in mocks) return mocks[id];
    if (id.startsWith('.')) return loadSource(path.resolve(path.dirname(resolved), `${id}.ts`), mocks);
    return require(id);
  };
  vm.runInNewContext(output, { require: localRequire, module: mod, exports: mod.exports, Buffer, Date, console }, { filename: resolved });
  return mod.exports;
}

function harness() {
  const records = new Map();
  let user = { role: 'operador', rootId: 'root-a', active: true };
  let tail = Promise.resolve();
  const db = {
    collection(name) { return { doc(id) { return { path: `${name}/${id}` }; } }; },
    runTransaction(fn) {
      const next = tail.then(() => fn({
        async get(ref) { return { exists: records.has(ref.path) }; },
        create(ref, data) {
          assert.ok(ref.path.startsWith('securityClientReports/'), 'untrusted report must not write account/incident/notification');
          assert.ok(!records.has(ref.path));
          records.set(ref.path, data);
        },
      }));
      tail = next.catch(() => {});
      return next;
    },
  };
  const firestore = Object.assign(() => db, {
    FieldValue: { serverTimestamp: () => 'SERVER_TIME' },
    Timestamp: { fromMillis: (ms) => ms },
  });
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const authz = loadSource('functions/src/modules/users/authorization.ts');
  const module = loadSource('functions/src/modules/activityLog/callables.ts', {
    'firebase-admin': { apps: [{}], firestore },
    'firebase-functions/v2/https': { onCall: (_opts, handler) => handler, HttpsError },
    '../../utils/authGuard': {
      getUserRole: (u) => u?.role,
      assertAuthorized: (auth, u) => {
        const result = authz.decideUserAuthorization({ authenticatedUid: auth?.uid, user: u });
        if (!result.allowed) throw new HttpsError('permission-denied', result.reason);
      },
    },
    '../../utils/logActivity': { logActivity: () => { throw new Error('Unexpected trusted activity event'); } },
    '../sharedCallables/helpers': {
      requireAuth: (r) => { if (!r.auth?.uid) throw new HttpsError('unauthenticated', 'Auth required'); return r.auth.uid; },
      getMyUser: async () => user,
      getActivityAdminId: () => 'root-a',
    },
  });
  return { call: module.logUnauthorizedRouteAttempt, records, setUser: (u) => { user = u; }, authz };
}

const request = (path = '/pagos') => ({ auth: { uid: 'actor-a' }, data: { path, requiredModule: 'usuarios', superadminOnly: true, rootId: 'foreign', locationHref: 'https://example.invalid/?token=SECRET', referrer: 'SECRET' } });

test('fabricated reports cannot restrict accounts, notify recipients or become trusted evidence', async () => {
  const h = harness();
  const result = await h.call(request('/pagos?token=SECRET#SECRET'));
  assert.equal(result.restricted, false);
  assert.equal(h.records.size, 1);
  const entry = [...h.records.values()][0];
  assert.equal(entry.pathHash, require('node:crypto').createHash('sha256').update('/pagos').digest('hex'));
  assert.equal(entry.path, undefined);
  assert.equal(entry.rootId, 'root-a');
  assert.equal(entry.origin, 'CLIENT_REPORTED');
  assert.equal(entry.verified, false);
  assert.equal(entry.decision, 'OBSERVE_ONLY');
  assert.ok(!JSON.stringify(entry).includes('SECRET'));
});

test('changing client path does not bypass actor-wide transactional deduplication', async () => {
  const h = harness();
  const results = await Promise.all(Array.from({ length: 40 }, (_, i) => h.call(request(`/route-${i}`))));
  assert.equal(h.records.size, 1);
  assert.equal(results.filter((r) => !r.deduped).length, 1);
});

test('unknown, absent and inactive PAY0 identities are denied before persistence', async () => {
  const h = harness();
  for (const user of [null, {}, { role: 'invented' }, { role: 'operador', active: false }]) {
    h.setUser(user);
    await assert.rejects(h.call(request()), { code: 'permission-denied' });
  }
  await assert.rejects(h.call({ data: { path: '/pagos' } }), { code: 'unauthenticated' });
  assert.equal(h.records.size, 0);
});

test('only local path reports accepted', async () => {
  const h = harness();
  for (const value of ['https://example.invalid', '//example.invalid', '']) {
    await assert.rejects(h.call(request(value)), { code: 'invalid-argument' });
  }
  assert.equal(h.records.size, 0);
});
