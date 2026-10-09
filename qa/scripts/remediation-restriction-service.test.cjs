const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { test } = require('node:test');
function load(file, deps = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function('exports', 'require', code)(exports, name => { assert(Object.hasOwn(deps, name), name); return deps[name]; });
  return exports;
}
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
const restrictions = load('functions/src/modules/users/restrictions.ts');
const generated = load('functions/src/modules/users/authorizationPolicy.generated.ts');
const defaults = load('functions/src/modules/users/defaultModules.ts', { './authorizationPolicy.generated': generated });
const authorization = load('functions/src/modules/users/authorization.ts', { './defaultModules': defaults, './restrictions': restrictions });
const guard = load('functions/src/utils/authGuard.ts', { 'firebase-functions': { https: { HttpsError } }, '../modules/users/authorization': authorization });
const { createRestrictionService } = load('functions/src/modules/users/restrictionService.ts', {
  'node:crypto': require('node:crypto'), 'firebase-functions/v2/https': { HttpsError }, '../../utils/authGuard': guard, './authorization': authorization, './restrictions': restrictions,
});
function harness() {
  let now = Date.now(); let sequence = 0; let tail = Promise.resolve(); let failAudit = false;
  const records = new Map([
    ['users/admin', { rootId: 'r1', role: 'superadmin', active: true }],
    ['users/recovery', { rootId: 'r1', role: 'superadmin', active: true }],
    ['users/target', { rootId: 'r1', role: 'operador', active: true }],
  ]);
  const db = {
    collection: name => ({ doc: id => `${name}/${id}` }),
    runTransaction(callback) {
      const job = tail.then(async () => {
        const pending = new Map();
        const result = await callback({
          get: async ref => ({ exists: records.has(ref), data: () => structuredClone(records.get(ref)) }),
          update(ref, data) { assert(records.has(ref)); pending.set(ref, { ...records.get(ref), ...structuredClone(data) }); },
          create(ref, data) { if (failAudit) throw new Error('Audit unavailable'); assert(!records.has(ref)); pending.set(ref, structuredClone(data)); },
        });
        for (const [key, data] of pending) records.set(key, data);
        return result;
      });
      tail = job.catch(() => {}); return job;
    },
  };
  return { records, service: createRestrictionService(db, () => now, () => `id-${++sequence}`), auth: (uid = 'admin', age = 0) => ({ uid, token: { auth_time: Math.floor(now / 1000) - age } }), advance: ms => { now += ms; }, auditFailure: () => { failAudit = true; }, instant: () => now };
}
const input = { subjectUid: 'target', incidentId: 'incident1', reasonCode: 'SECURITY_REVIEW' };
const audits = h => [...h.records.keys()].filter(key => key.startsWith('trustedRestrictionAudit/'));
test('manual issue writes bounded trusted record and audit atomically; payload cannot choose authority', async () => {
  const h = harness();
  for (const patch of [{ writer: 'FORGED' }, { rootId: 'elsewhere' }, { authority: 'AI' }, { ttlMs: 0 }, { ttlMs: 86400001 }, { reasonCode: 'CLIENT_REPORT' }]) {
    await assert.rejects(h.service.issue(h.auth(), { ...input, ...patch }), { code: 'invalid-argument' });
  }
  const result = await h.service.issue(h.auth(), input);
  const row = h.records.get('users/target').trustedRestrictionV1;
  assert.equal(row.expiresAtMs - row.issuedAtMs, 900000); assert.equal(row.authorityUid, 'admin');
  assert.equal(result.authorizationVersion, 1); assert.equal(audits(h).length, 1);
  assert.equal(restrictions.evaluateTrustedRestriction(h.records.get('users/target'), 'target', h.instant()).state, 'ACTIVE');
  await assert.rejects(h.service.issue(h.auth(), input), { code: 'failed-precondition' });
  const failed = harness(); failed.auditFailure();
  await assert.rejects(failed.service.issue(failed.auth(), input), /Audit unavailable/);
  assert.equal(failed.records.get('users/target').trustedRestrictionV1, undefined); assert.equal(audits(failed).length, 0);
});
test('fresh authentication, current role, same root and independent actor are mandatory', async () => {
  for (const kind of ['anonymous', 'old', 'future', 'missing-time', 'admin-role', 'inactive', 'cross-root', 'self']) {
    const h = harness(); let auth = h.auth(); let data = input;
    if (kind === 'anonymous') auth = null;
    if (kind === 'old') auth = h.auth('admin', 301);
    if (kind === 'future') auth = h.auth('admin', -2);
    if (kind === 'missing-time') auth = { uid: 'admin', token: {} };
    if (kind === 'admin-role') h.records.get('users/admin').role = 'admin';
    if (kind === 'inactive') h.records.get('users/admin').active = false;
    if (kind === 'cross-root') h.records.get('users/target').rootId = 'r2';
    if (kind === 'self') data = { ...input, subjectUid: 'admin' };
    await assert.rejects(h.service.issue(auth, data), e => ['permission-denied', 'unauthenticated'].includes(e.code), kind);
    assert.equal(audits(h).length, 0);
  }
});
test('concurrent issue and revoke serialize with CAS; stale recovery never revokes replacement', async () => {
  const h = harness();
  const results = await Promise.allSettled([h.service.issue(h.auth(), input), h.service.issue(h.auth(), input)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const issued = results.find(r => r.status === 'fulfilled').value;
  const recovery = { subjectUid: 'target', restrictionId: issued.restrictionId, authorizationVersion: issued.authorizationVersion, revocationReason: 'REVIEW_CLEARED' };
  await assert.rejects(h.service.revoke(h.auth('recovery'), { ...recovery, authorizationVersion: 9 }), { code: 'aborted' });
  const revoked = await h.service.revoke(h.auth('recovery'), recovery);
  assert.equal(revoked.authorizationVersion, 2); assert.equal((await h.service.getMyStatus(h.auth('target'))).state, 'REVOKED');
  const replacement = await h.service.issue(h.auth(), input);
  assert.equal(replacement.authorizationVersion, 3);
  await assert.rejects(h.service.revoke(h.auth('recovery'), recovery), { code: 'aborted' });
  assert.equal((await h.service.getMyStatus(h.auth('target'))).restricted, true);
  assert.equal(audits(h).length, 3);
});
test('restricted recovery actor cannot mutate; own status is narrow and contains no authority or incident', async () => {
  const h = harness(); await h.service.issue(h.auth(), { ...input, subjectUid: 'recovery' });
  await assert.rejects(h.service.issue(h.auth('recovery'), input), { code: 'permission-denied' });
  const status = await h.service.getMyStatus(h.auth('recovery'));
  assert.deepEqual(Object.keys(status).sort(), ['expiresAtMs', 'recovery', 'restricted', 'state']);
  assert.equal(status.restricted, true);
  h.records.get('users/recovery').active = false;
  await assert.rejects(h.service.getMyStatus(h.auth('recovery')), { code: 'permission-denied' });
});
test('malformed restriction cannot be bypassed through normal recovery or last-admin self recovery', async () => {
  const h = harness(); h.records.get('users/admin').trustedRestrictionV1 = { state: 'REVOKED' };
  assert.equal((await h.service.getMyStatus(h.auth())).state, 'INVALID');
  await assert.rejects(h.service.issue(h.auth(), input), { code: 'permission-denied' });
  await assert.rejects(h.service.revoke(h.auth(), { subjectUid: 'admin', restrictionId: 'x', authorizationVersion: 1, revocationReason: 'SUPPORT_RECOVERY' }), { code: 'permission-denied' });
  await assert.rejects(h.service.issue(h.auth('recovery'), { ...input, subjectUid: 'admin' }), { code: 'failed-precondition' });
  assert.equal(audits(h).length, 0); // IAM breakglass stays outside app authorization.
});
test('expiry does not need cleanup and reissue increments version; maximum TTL accepted exactly', async () => {
  const h = harness(); await h.service.issue(h.auth(), { ...input, ttlMs: 86400000 });
  h.advance(86400000); assert.equal((await h.service.getMyStatus(h.auth('target'))).state, 'EXPIRED');
  const reissued = await h.service.issue(h.auth(), input); assert.equal(reissued.authorizationVersion, 2);
});
