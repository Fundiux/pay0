// Operator permissions are inherited from the parent (admin or superadmin): role ceiling ∩ own ∩ parent effective.
// Pure unit tests with synthetic users; no Firebase, network or production data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { test } = require('node:test');

function load(file, deps = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function('exports', 'require', source)(exports, name => { assert(Object.hasOwn(deps, name), name); return deps[name]; });
  return exports;
}

class HttpsError extends Error { constructor(code, message, details) { super(message); this.code = code; this.details = details; } }
const restrictions = load('functions/src/modules/users/restrictions.ts');
const generated = load('functions/src/modules/users/authorizationPolicy.generated.ts');
const defaults = load('functions/src/modules/users/defaultModules.ts', { './authorizationPolicy.generated': generated });
const authorization = load('functions/src/modules/users/authorization.ts', { './defaultModules': defaults, './restrictions': restrictions });
const warnings = [];
const guard = load('functions/src/utils/authGuard.ts', {
  'firebase-functions': { https: { HttpsError }, logger: { warn: (...args) => warnings.push(args) } },
  '../modules/users/authorization': authorization,
});
const inheritedAuthority = load('functions/src/modules/users/inheritedAuthority.ts', {
  'firebase-admin/firestore': { getFirestore: () => { throw Error('DEFAULT_READER_FORBIDDEN_IN_TEST'); } },
  './authorization': authorization,
});

const NOW = 1800000000000;
const admin = (patch = {}) => ({ role: 'admin', rootId: 'root', active: true, ...patch });
const superadmin = (patch = {}) => ({ role: 'superadmin', rootId: 'root', active: true, ...patch });
const operator = (patch = {}) => ({ role: 'operador', rootId: 'root', active: true, parentUserId: 'parent', parentRole: 'admin', ...patch });
const resolve = async (user, parents, uid = 'op') => inheritedAuthority.withInheritedAuthority(user, uid, async id => parents[id] ?? null);
const decide = (user, module, action) => authorization.decideUserAuthorization({ authenticatedUid: 'op', user, requirement: { module, action }, nowMs: NOW });

test('restricted parent restricts its operator even if the operator document grants the action', async () => {
  const user = await resolve(operator({ modules: { pagos: { view: true, create: true } } }), { parent: admin({ modules: { pagos: { view: true, create: false } } }) });
  assert.equal(authorization.getEffectiveUserModules(user).pagos.create, false);
  assert.equal(authorization.getEffectiveUserModules(user).pagos.view, true);
  assert.equal(decide(user, 'pagos', 'create').reason, 'ACTION_NOT_ALLOWED');
  assert.equal(decide(user, 'pagos', 'view').allowed, true);
});

test('operator never exceeds the parent and the parent may restrict further', async () => {
  const parent = admin();
  const own = await resolve(operator({ modules: { solicitudes: { create: false } } }), { parent });
  assert.equal(decide(own, 'solicitudes', 'create').reason, 'ACTION_NOT_ALLOWED');
  const full = await resolve(operator(), { parent });
  const effective = authorization.getEffectiveUserModules(full);
  const parentEffective = authorization.getEffectiveUserModules(parent);
  for (const [moduleKey, actions] of Object.entries(effective)) {
    for (const [actionKey, value] of Object.entries(actions)) {
      if (value) assert.equal(parentEffective[moduleKey]?.[actionKey], true, `${moduleKey}.${actionKey}`);
    }
  }
  // Operator role ceiling still applies: admin-only actions never reach an operator.
  assert.equal(effective.usuarios?.permissions === true, false);
});

test('superadmin parent leaves the operator at role ceiling ∩ own permissions', async () => {
  const user = await resolve(operator({ parentRole: 'superadmin', modules: { wallet: { dispersiones: false } } }), { parent: superadmin({ modules: { wallet: { dispersiones: false } } }) });
  const effective = authorization.getEffectiveUserModules(user);
  assert.equal(effective.pagos.create, true);
  assert.equal(effective.wallet.dispersiones, false);
  assert.deepEqual(authorization.getAttachedInheritedModuleCeiling(user).status, 'RESOLVED');
  assert.equal(decide(user, 'pagos', 'create').allowed, true);
});

test('unresolved parent fails closed for every module permission', async () => {
  const cases = [
    [operator({ parentUserId: '' }), {}, 'NO_PARENT'],
    [operator(), {}, 'PARENT_NOT_FOUND'],
    [operator(), { parent: admin({ active: false }) }, 'PARENT_NOT_ALLOWED'],
    [operator(), { parent: admin({ isDeleted: true }) }, 'PARENT_NOT_ALLOWED'],
    [operator(), { parent: admin({ rootId: 'other-root' }) }, 'PARENT_ROOT_MISMATCH'],
    [operator(), { parent: { role: 'operador', rootId: 'root', active: true } }, 'PARENT_ROLE_INVALID'],
    [operator({ parentUserId: 'op' }), { op: admin() }, 'NO_PARENT'],
  ];
  for (const [profile, parents, reason] of cases) {
    const user = await resolve(profile, parents);
    const ceiling = authorization.getAttachedInheritedModuleCeiling(user);
    assert.deepEqual(ceiling, { status: 'UNRESOLVED', reason }, reason);
    assert.equal(Object.values(authorization.getEffectiveUserModules(user)).every(actions => Object.values(actions).every(value => value === false)), true, reason);
    assert.equal(decide(user, 'pagos', 'view').reason, 'PARENT_AUTHORITY_UNRESOLVED', reason);
  }
});

test('legacy adminId identifies the parent when parentUserId is missing', async () => {
  const user = await resolve(operator({ parentUserId: undefined, adminId: 'legacy-admin' }), { 'legacy-admin': admin({ modules: { pagos: { create: false } } }) });
  assert.equal(authorization.getAttachedInheritedModuleCeiling(user).parentUid, 'legacy-admin');
  assert.equal(decide(user, 'pagos', 'view').allowed, true);
  assert.equal(decide(user, 'pagos', 'create').reason, 'ACTION_NOT_ALLOWED');
});

test('a server path that never resolved the parent denies module access and is logged; role-only checks are unchanged', () => {
  warnings.length = 0;
  const bare = operator();
  assert.equal(decide(bare, 'pagos', 'view').reason, 'PARENT_AUTHORITY_UNRESOLVED');
  assert.throws(() => guard.assertAuthorized({ uid: 'op' }, bare, { allowedRoles: ['operador'], requiredModule: 'pagos', requiredAction: 'view' }), error => error.code === 'permission-denied');
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][1].ceiling, 'NOT_ATTACHED');
  assert.equal(guard.assertAuthorized({ uid: 'op' }, bare, { allowedRoles: ['operador'] }), 'operador');
  // Admin and superadmin keep their previous behaviour without any parent read.
  assert.equal(decide(admin(), 'pagos', 'create').allowed, true);
  assert.equal(decide(admin({ modules: { pagos: { create: false } } }), 'pagos', 'create').reason, 'ACTION_NOT_ALLOWED');
  assert.equal(decide(superadmin(), 'usuarios', 'permissions').allowed, true);
});

test('the ceiling is server-only: it survives spreads but not data copies, and cannot come from stored fields', async () => {
  const user = await resolve(operator(), { parent: admin() });
  assert.equal(decide({ ...user, extra: 1 }, 'pagos', 'view').allowed, true);
  assert.equal(decide(JSON.parse(JSON.stringify(user)), 'pagos', 'view').reason, 'PARENT_AUTHORITY_UNRESOLVED');
  const forged = operator({ inheritedModuleCeiling: { status: 'RESOLVED', modules: { pagos: { view: true } } } });
  assert.equal(decide(forged, 'pagos', 'view').reason, 'PARENT_AUTHORITY_UNRESOLVED');
  assert.equal(JSON.stringify(user).includes('RESOLVED'), false);
});

test('when the parent later loses a permission its operators lose it on the next request', async () => {
  const parents = { parent: admin() };
  assert.equal(decide(await resolve(operator(), parents), 'wallet', 'dispersiones').allowed, true);
  parents.parent = admin({ modules: { wallet: { view: true, dispersiones: false } } });
  assert.equal(decide(await resolve(operator(), parents), 'wallet', 'dispersiones').reason, 'ACTION_NOT_ALLOWED');
  parents.parent = admin({ active: false });
  assert.equal(decide(await resolve(operator(), parents), 'wallet', 'view').reason, 'PARENT_AUTHORITY_UNRESOLVED');
});

test('admin and superadmin profiles are returned untouched without a parent read', async () => {
  let reads = 0;
  for (const profile of [admin(), superadmin()]) {
    const result = await inheritedAuthority.withInheritedAuthority(profile, 'x', async () => { reads++; return null; });
    assert.equal(result, profile);
    assert.equal(authorization.getAttachedInheritedModuleCeiling(result), null);
  }
  const user = await resolve(operator(), { parent: admin() });
  await inheritedAuthority.withInheritedAuthority(user, 'op', async () => { reads++; return null; });
  assert.equal(reads, 0, 'an attached ceiling is reused within the request');
});

// ---- updateUserModules / getUserPermissionCeiling callable contract ----
function callableHarness(rows) {
  const writes = [];
  const db = {
    doc: id => ({
      get: async () => ({ exists: Object.hasOwn(rows, id), data: () => rows[id] }),
      set: async (data, options) => { writes.push({ id, data, options }); },
    }),
  };
  const firebaseAdmin = { apps: [{}], initializeApp: () => {}, firestore: () => db };
  const callables = load('functions/src/modules/users/modules.ts', {
    'firebase-functions/v2/https': { onCall: (_options, handler) => handler, HttpsError },
    'firebase-admin': firebaseAdmin,
    'firebase-admin/firestore': { FieldValue: { serverTimestamp: () => 'SERVER_TIME' } },
    '../../utils/authGuard': guard,
    './authorization': authorization,
  });
  return { callables, writes };
}

test('an admin cannot grant its operator a permission the admin does not have; dropped actions are reported', async () => {
  const rows = {
    'users/admin1': admin({ modules: { pagos: { view: true, create: false }, wallet: { view: true, dispersiones: false } } }),
    'users/op1': operator({ parentUserId: 'admin1', modules: { pagos: { view: true, create: false } } }),
  };
  const { callables, writes } = callableHarness(rows);
  const result = await callables.updateUserModules({
    auth: { uid: 'admin1' },
    data: { targetUid: 'op1', modules: { pagos: { view: true, create: true }, wallet: { dispersiones: true, beneficiarios: false }, usuarios: { permissions: true } } },
  });
  assert.deepEqual(result.dropped, ['pagos.create', 'usuarios.permissions', 'wallet.dispersiones']);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].data.modules, { pagos: { view: true }, wallet: { beneficiarios: false } });
  assert.deepEqual(writes[0].options, { merge: true });

  const ceiling = await callables.getUserPermissionCeiling({ auth: { uid: 'admin1' }, data: { targetUid: 'op1' } });
  assert.equal(ceiling.inherited, true);
  assert.equal(ceiling.parentResolved, true);
  assert.equal(ceiling.assignable.pagos.create, false);
  assert.equal(ceiling.assignable.pagos.view, true);
  assert.equal(ceiling.assignable.wallet.dispersiones, false);
  assert.equal(ceiling.assignable.usuarios?.permissions === true, false);
});

test('a superadmin editing another admin\'s operator is clipped to that admin; admins only edit their own operators', async () => {
  const rows = {
    'users/super1': superadmin({ rootId: 'root' }),
    'users/admin2': admin({ modules: { solicitudes: { view: true, create: false } } }),
    'users/admin3': admin(),
    'users/op2': operator({ parentUserId: 'admin2' }),
  };
  const { callables, writes } = callableHarness(rows);
  const result = await callables.updateUserModules({ auth: { uid: 'super1' }, data: { targetUid: 'op2', modules: { solicitudes: { create: true, view: true } } } });
  assert.deepEqual(result.dropped, ['solicitudes.create']);
  assert.deepEqual(writes[0].data.modules, { solicitudes: { view: true } });
  await assert.rejects(callables.updateUserModules({ auth: { uid: 'admin3' }, data: { targetUid: 'op2', modules: { solicitudes: { view: true } } } }), error => error.code === 'permission-denied');
  assert.equal(writes.length, 1);
});

test('an operator whose parent cannot be validated keeps its stored permissions untouched', async () => {
  const rows = { 'users/super1': superadmin(), 'users/op3': operator({ parentUserId: 'gone' }) };
  const { callables, writes } = callableHarness(rows);
  await assert.rejects(callables.updateUserModules({ auth: { uid: 'super1' }, data: { targetUid: 'op3', modules: { pagos: { view: false } } } }), error => error.code === 'failed-precondition');
  assert.equal(writes.length, 0);
  const ceiling = await callables.getUserPermissionCeiling({ auth: { uid: 'super1' }, data: { targetUid: 'op3' } });
  assert.equal(ceiling.parentResolved, false);
  assert.equal(Object.values(ceiling.assignable).every(actions => Object.values(actions).every(value => value === false)), true);
});

// ---- Static coverage: every operator-reachable module check resolves the parent first ----
// Files listed here receive an already-resolved profile from a caller that resolves it.
const RESOLVED_BY_CALLER = new Map([
  ['functions/src/modules/agent007/platformReadConnector.ts', 'superadmin-only Hugo callers pass a getMyUser profile'],
  ['functions/src/modules/commissionDistributions/userDestinations.ts', 'assertCommissionWithdrawalOwner callers resolve the owner'],
]);
test('operator-reachable module checks only run on profiles that resolved the parent', () => {
  const root = path.resolve('functions/src');
  const files = [];
  const walk = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full); else if (full.endsWith('.ts')) files.push(full); } };
  walk(root);
  const missing = [];
  for (const file of files) {
    const rel = path.relative(process.cwd(), file).split(path.sep).join('/');
    if (rel.endsWith('utils/authGuard.ts')) continue;
    const source = fs.readFileSync(file, 'utf8');
    let index = 0, gated = false;
    while ((index = source.indexOf('assertAuthorized(', index)) >= 0) {
      let end = index + 17, depth = 1;
      while (depth && end < source.length) { if (source[end] === '(') depth++; else if (source[end] === ')') depth--; end++; }
      const call = source.slice(index, end);
      index = end;
      const roles = (call.match(/allowedRoles:\s*(\[[^\]]*\]|[A-Za-z_.]+)/) || [])[1];
      if (/requiredModule/.test(call) && (!roles || /operador/.test(roles) || !roles.startsWith('['))) gated = true;
    }
    if (!gated) continue;
    const resolves = source.includes('withInheritedAuthority(') || /import\s*\{[^}]*\bgetMyUser\b[^}]*\}\s*from\s*["']\.\.\/sharedCallables\/helpers["']/.test(source) || RESOLVED_BY_CALLER.has(rel);
    if (!resolves) missing.push(rel);
  }
  assert.deepEqual(missing, []);
});
