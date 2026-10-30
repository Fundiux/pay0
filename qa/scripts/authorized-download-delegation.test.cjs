const assert = require('node:assert/strict');
const projectId = 'demo-pay0-authorized-download-delegation';
assert.equal(process.env.GCLOUD_PROJECT, projectId, 'Isolated demo project required');
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^127\.0\.0\.1:\d+$/, 'Loopback Firestore emulator required');
global.fetch = async () => { throw Error('EXTERNAL_NETWORK_FORBIDDEN'); };
for (const protocol of ['http', 'https']) {
  const api = require(`node:${protocol}`), original = api.request;
  api.request = function (url, ...args) {
    const host = typeof url === 'string' || url instanceof URL ? new URL(url).hostname : String(url.hostname || url.host || '').split(':')[0];
    assert.ok(['127.0.0.1', 'localhost'].includes(host), 'External HTTP transport forbidden');
    return original.call(this, url, ...args);
  };
}
const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId });
const db = admin.firestore();
const { getAuthorizedDocumentDownloadUrlCore } = require('../../functions/lib/modules/documents/authorizedDownload');
const runId = `delegated-download-${Date.now()}`;
const rootId = `${runId}-root`, grantorUid = `${runId}-owner`, delegateUid = `${runId}-delegate`, clientId = `${runId}-client`;
const signedPaths = [], results = [];
const signer = async storagePath => {
  signedPaths.push(storagePath);
  return `https://signed.invalid/${encodeURIComponent(storagePath)}`;
};
const families = [
  { collection: 'solicitudes', idField: 'solicitudId', storage: 'solicitudes' },
  { collection: 'pagos', idField: 'pagoId', storage: 'pagos' },
  { collection: 'clientDispersions', idField: 'dispersionId', storage: 'dispersiones' },
];
const restriction = (uid, patch = {}) => ({
  schemaVersion: 1, writer: 'PAY0_TRUSTED_RESTRICTION_WRITER@1', policyVersion: 'PAY0-CONTAINMENT@1',
  restrictionId: 'restriction1', rootId, subjectUid: uid, state: 'ACTIVE', scope: 'ACCOUNT_OPERATIONS',
  authority: 'HUMAN_SECURITY_ADMIN', authorityUid: 'independent-admin', reasonCode: 'SECURITY_REVIEW', incidentId: 'incident1',
  issuedAtMs: Date.now() - 10000, expiresAtMs: Date.now() + 3600000, authorizationVersion: 1, ...patch,
});
const grant = () => ({ rootId, targetUid: delegateUid, clientId, active: true,
  mode: 'TEMPORARY', expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 3600000),
  grantedBy: grantorUid, grantAuthority: { version: 1, source: 'DIRECT', grantorUid },
  permissions: { viewBasic: true, operateSolicitudes: true, operatePagos: true, operateDispersiones: true },
});
async function reset() {
  await Promise.all([
    db.doc(`users/${grantorUid}`).set({ rootId, role: 'admin', active: true, modules: { usuarios: { view: true, clientDelegations: true } } }),
    db.doc(`users/${delegateUid}`).set({ rootId, role: 'operador', active: true }),
    db.doc(`userClientAccess/${delegateUid}/clients/${clientId}`).set(grant()),
  ]);
}
async function check(label, allowed) {
  for (const family of families) {
    const before = signedPaths.length;
    const request = { auth: { uid: delegateUid, token: {} }, data: { uploadId: `${runId}-${family.collection}` } };
    if (allowed) {
      const result = await getAuthorizedDocumentDownloadUrlCore(request, signer);
      assert.equal(result.ok, true, label);
      assert.equal(result.expiresInSeconds, 300, label);
      assert.match(result.url, /^https:\/\/signed\.invalid\//);
      assert.equal(signedPaths.length, before + 1, label);
      assert.equal(signedPaths.at(-1), `roots/${rootId}/${family.storage}/${runId}/docs/OTRO/synthetic.pdf`);
    } else {
      await assert.rejects(getAuthorizedDocumentDownloadUrlCore(request, signer), error => error.code === 'permission-denied', `${label}/${family.collection}`);
      assert.equal(signedPaths.length, before, `${label}: denied request never reaches signer`);
    }
    results.push({ case: label, family: family.collection, allowed });
  }
}
async function run() {
  await db.doc(`clients/${clientId}`).set({ rootId, active: true, adminId: grantorUid, createdBy: grantorUid });
  for (const family of families) {
    await db.doc(`${family.collection}/${runId}`).set({ rootId, clientId, createdBy: grantorUid });
    await db.doc(`uploads/${runId}-${family.collection}`).set({ rootId, entityType: family.collection, [family.idField]: runId,
      active: true, status: 'READY', documentType: 'OTRO', storagePath: `roots/${rootId}/${family.storage}/${runId}/docs/OTRO/synthetic.pdf` });
  }
  const states = [
    ['none', () => undefined, true],
    ['expired', () => restriction(delegateUid, { expiresAtMs: Date.now() - 1000 }), true],
    ['revoked', () => restriction(delegateUid, { state: 'REVOKED', revokedAtMs: Date.now() - 1000, revokedBy: 'support', revocationReason: 'REVIEW_CLEARED' }), true],
    ['legacy-only', () => undefined, true],
    ['active', () => restriction(delegateUid), false],
    ['malformed-revoked', () => restriction(delegateUid, { state: 'REVOKED' }), false],
    ['wrong-root', () => restriction(delegateUid, { rootId: 'other' }), false],
    ['fake-writer', () => restriction(delegateUid, { writer: 'CLIENT_REPORTED' }), false],
    ['null', () => null, false],
    ['unknown-field', () => restriction(delegateUid, { bypass: true }), false],
    ['replaced-required-field', () => { const value = restriction(delegateUid); delete value.incidentId; value.extra = true; return value; }, false],
    ['ttl-too-long', () => restriction(delegateUid, { issuedAtMs: Date.now() - 1000, expiresAtMs: Date.now() + 86400000 }), false],
  ];
  for (const [label, value, allowed] of states) {
    await reset();
    const trustedRestrictionV1 = value();
    if (trustedRestrictionV1 !== undefined) await db.doc(`users/${delegateUid}`).update({ trustedRestrictionV1 });
    if (label === 'legacy-only') await db.doc(`users/${delegateUid}`).update({ securityLock: { active: true } });
    await check(label, allowed);
  }
  for (const [label, mutate] of [
    ['grantor-blocked', () => db.doc(`users/${grantorUid}`).update({ trustedRestrictionV1: restriction(grantorUid) })],
    ['grantor-foreign-root', () => db.doc(`users/${grantorUid}`).update({ rootId: 'foreign' })],
    ['delegation-expired', () => db.doc(`userClientAccess/${delegateUid}/clients/${clientId}`).update({ expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() - 1000) })],
    ['delegation-revoked', () => db.doc(`userClientAccess/${delegateUid}/clients/${clientId}`).update({ revokedAt: admin.firestore.Timestamp.now() })],
    ['actor-foreign-root', () => db.doc(`users/${delegateUid}`).update({ rootId: 'foreign' })],
  ]) { await reset(); await mutate(); await check(label, false); }
  assert.equal(results.length, 51);
  assert.equal(signedPaths.length, 12);
  const report = { ok: true, projectId, checks: results.length, permitted: 12, denied: 39, families: families.map(row => row.collection), actualCallableCore: true, mockSigner: true, directStorageDelegation: 'INTENTIONALLY_DENIED_SEPARATE_RULES_GATE', externalActions: 0, results };
  require('node:fs').mkdirSync('output', { recursive: true });
  require('node:fs').writeFileSync('output/authorized-download-delegation.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, results: undefined }));
}
run().catch(error => { console.error({ name: error.name, code: error.code || 'ASSERTION_FAILED', message: error.message }); process.exitCode = 1; }).finally(() => admin.app().delete());
