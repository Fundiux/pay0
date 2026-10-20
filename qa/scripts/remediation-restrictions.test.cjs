const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { test } = require('node:test');
function load(file, deps = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function('exports', 'require', source)(exports, name => { assert(Object.hasOwn(deps, name), name); return deps[name]; });
  return exports;
}
const restrictions = load('functions/src/modules/users/restrictions.ts');
const generated = load('functions/src/modules/users/authorizationPolicy.generated.ts');
const defaults = load('functions/src/modules/users/defaultModules.ts', { './authorizationPolicy.generated': generated });
const authorization = load('functions/src/modules/users/authorization.ts', { './defaultModules': defaults, './restrictions': restrictions });
class HttpsError extends Error { constructor(code, message, details) { super(message); this.code = code; this.details = details; } }
const guard = load('functions/src/utils/authGuard.ts', { 'firebase-functions': { https: { HttpsError } }, '../modules/users/authorization': authorization });
const NOW = 1800000000000;
const record = (patch = {}) => ({
  schemaVersion: 1, writer: restrictions.TRUSTED_RESTRICTION_WRITER, policyVersion: restrictions.TRUSTED_RESTRICTION_POLICY,
  restrictionId: 'restriction1', rootId: 'r1', subjectUid: 'u1', state: 'ACTIVE', scope: 'ACCOUNT_OPERATIONS',
  authority: 'HUMAN_SECURITY_ADMIN', authorityUid: 'security-admin', reasonCode: 'SECURITY_REVIEW', incidentId: 'incident1',
  issuedAtMs: NOW - 1000, expiresAtMs: NOW + 1000, authorizationVersion: 1, ...patch,
});
const profile = (restriction, patch = {}) => ({ role: 'operador', rootId: 'r1', active: true, ...(restriction === undefined ? {} : { trustedRestrictionV1: restriction }), ...patch });
const decide = (user, nowMs = NOW) => authorization.decideUserAuthorization({ authenticatedUid: 'u1', user, requirement: { module: 'pagos', action: 'create' }, nowMs });

test('new trusted record blocks every role before superadmin bypass; absent/legacy field never activates it', () => {
  for (const role of ['superadmin', 'admin', 'operador']) {
    assert.equal(decide(profile(record(), { role })).reason, 'USER_RESTRICTED');
    assert.equal(decide(profile(undefined, { role, securityLock: { active: true, policyVersion: 'untrusted', unlockCodeHash: 'x' } })).allowed, true);
  }
  assert.deepEqual(restrictions.evaluateTrustedRestriction(profile(undefined), 'u1', NOW), { restricted: false, state: 'NONE' });
});

test('expiry and maximum TTL are exact and require no cleanup', () => {
  const expires = NOW + 1000;
  assert.equal(decide(profile(record()), expires - 1).reason, 'USER_RESTRICTED');
  assert.equal(decide(profile(record()), expires).allowed, true);
  assert.equal(restrictions.evaluateTrustedRestriction(profile(record()), 'u1', expires).state, 'EXPIRED');
  const full = record({ issuedAtMs: NOW, expiresAtMs: NOW + restrictions.MAX_RESTRICTION_TTL_MS });
  assert.equal(decide(profile(full)).reason, 'USER_RESTRICTED');
  assert.equal(decide(profile({ ...full, expiresAtMs: full.expiresAtMs + 1 })).reason, 'USER_RESTRICTION_INVALID');
});

test('present invalid record fails closed for scope, authority, marker, timestamps and unknown fields', () => {
  const invalid = [null, false, [], {}, 'ACTIVE',
    record({ rootId: 'r2' }), record({ subjectUid: 'other' }), record({ writer: 'CLIENT_REPORTED' }),
    record({ authority: 'DETERMINISTIC_POLICY' }), record({ authorityUid: 'u1' }),
    record({ issuedAtMs: NOW + 1 }), record({ expiresAtMs: NOW - 1000 }),
    record({ expiresAtMs: String(NOW + 1000) }), record({ expiresAtMs: NaN }),
    record({ expiresAtMs: Infinity }), record({ expiresAtMs: NOW + 0.5 }),
    record({ expiresAtMs: 253402300800000 }), record({ authorizationVersion: 0 }),
    record({ authorizationVersion: 1.1 }), record({ policyVersion: 'future' }),
    record({ state: 'UNLOCKED' }), record({ reasonCode: 'arbitrary payload' }),
    record({ scope: 'ROOT_WIDE' }), record({ verified: true }), record({ revokedBy: 'support' }),
  ];
  for (const row of invalid) assert.equal(decide(profile(row, { role: 'superadmin' })).reason, 'USER_RESTRICTION_INVALID');
  assert.equal(decide(profile(record(), { rootId: 'new-root' })).reason, 'USER_RESTRICTION_INVALID');
  const getter = Object.defineProperty(record(), 'expiresAtMs', { get() { throw Error('must not execute getter'); } });
  assert.equal(decide(profile(getter)).reason, 'USER_RESTRICTION_INVALID');
});

test('revocation requires valid record and independent support actor; old unlock does not affect new restriction', () => {
  const revoked = record({ state: 'REVOKED', revokedAtMs: NOW, revokedBy: 'support', revocationReason: 'REVIEW_CLEARED' });
  assert.equal(decide(profile(revoked)).allowed, true);
  assert.equal(restrictions.evaluateTrustedRestriction(profile(revoked), 'u1', NOW).state, 'REVOKED');
  for (const bad of [{ revokedBy: 'u1' }, { revokedBy: '' }, { revokedAtMs: NOW + 1 },
    { revokedAtMs: NOW - 2000 }, { revokedAtMs: 'now' }, { revocationReason: 'unknown' }, { writer: 'old-writer' }, { rootId: 'r2' }]) {
    assert.equal(decide(profile({ ...revoked, ...bad })).reason, 'USER_RESTRICTION_INVALID');
  }
  assert.equal(decide(profile(record({ restrictionId: 'restriction2', authorizationVersion: 2 }), {
    securityLock: { active: false, unlockedBy: 'SELF_ONE_TIME_CODE' },
  })).reason, 'USER_RESTRICTED');
});

test('expired/revoked restriction cannot override inactive profile or revoked permissions', () => {
  const expired = record({ expiresAtMs: NOW });
  for (const flag of [{ active: false }, { isActive: false }, { deleted: true }, { disabled: true }, { isDeleted: true }, { deletedAt: NOW }]) {
    assert.equal(decide(profile(expired, flag)).reason, 'USER_INACTIVE');
  }
  assert.equal(decide(profile(expired, { modules: { pagos: { view: true, create: false } } })).reason, 'ACTION_NOT_ALLOWED');
  assert.equal(authorization.decideUserAuthorization({ user: profile(record()), nowMs: NOW }).reason, 'UNAUTHENTICATED');
  assert.equal(decide(null).reason, 'USER_NOT_FOUND');
});

test('authGuard provides safe support contract with no incident or authority details; no option bypass exists', () => {
  const now = Date.now();
  const user = profile(record({ issuedAtMs: now - 1000, expiresAtMs: now + 60000, incidentId: 'PRIVATE_INCIDENT' }), { role: 'superadmin' });
  assert.throws(() => guard.assertAuthorized({ uid: 'u1' }, user, { bypassRestriction: true, recovery: true }), error => {
    assert.equal(error.code, 'permission-denied');
    assert.deepEqual(error.details, { reason: 'ACCOUNT_RESTRICTED', recovery: 'CONTACT_SUPPORT' });
    assert(!error.message.includes('PRIVATE_INCIDENT')); assert(!error.message.includes('security-admin')); return true;
  });
});
