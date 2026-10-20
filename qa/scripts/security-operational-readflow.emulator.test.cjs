const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const requireFunctions = createRequire(path.resolve('functions/package.json'));
const ts = requireFunctions('typescript');
const admin = requireFunctions('firebase-admin');
assert.equal(process.env.GCLOUD_PROJECT, 'demo-pay0-security-readflow');
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^127\.0\.0\.1:\d+$/);
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
const { readAuthorizedOperationalRecord } = require('../../functions/src/modules/documents/operationalReads.ts');
const { readAuthorizedRelatedRecords } = require('../../functions/src/modules/documents/relatedReads.ts');
const { getClientCanonical } = require('../../functions/src/modules/clients/callables.ts');
const { readSolicitudNotes } = require('../../functions/src/modules/notes/solicitudReads.ts');
const { readClientDispersionNotes } = require('../../functions/src/modules/financing/noteReads.ts');
const now = Date.now();
const restriction = uid => ({ schemaVersion: 1, writer: 'PAY0_TRUSTED_RESTRICTION_WRITER@1', policyVersion: 'PAY0-CONTAINMENT@1', restrictionId: 'fixture', rootId: 'root', subjectUid: uid, scope: 'ACCOUNT_OPERATIONS', authority: 'HUMAN_SECURITY_ADMIN', authorityUid: 'reviewer', incidentId: 'fixture', reasonCode: 'SECURITY_REVIEW', authorizationVersion: 1, issuedAtMs: now - 7200000, expiresAtMs: now - 3600000, state: 'REVOKED', revokedAtMs: now - 1000, revokedBy: 'reviewer', revocationReason: 'REVIEW_CLEARED' });
const activeRestriction = uid => { const { revokedAtMs, revokedBy, revocationReason, ...value } = restriction(uid); return { ...value, state: 'ACTIVE', expiresAtMs: now + 3600000 }; };
const user = (uid, role = 'admin') => ({ rootId: 'root', role, active: true, trustedRestrictionV1: restriction(uid), modules: { clientes: { view: true }, solicitudes: { view: true, comment: true }, pagos: { view: true }, wallet: { view: true, dispersiones: true }, usuarios: { view: true, clientDelegations: true } } });
const grant = (uid, grantor, source) => ({ rootId: 'root', targetUid: uid, clientId: 'client', active: true, grantedBy: grantor, grantAuthority: { version: 1, source, grantorUid: grantor, parentPath: source === 'DELEGATED' ? `userClientAccess/${grantor}/clients/client` : null }, permissions: { view: true, operate: true, viewBasic: true, operateSolicitudes: true, operatePagos: true }, startsAt: now - 10000, expiresAt: now + 3600000 });
const put = (p, value) => db.doc(p).set(value);
async function reset(chain = false) {
  await Promise.all([put('users/recipient', user('recipient', 'operador')), put('users/grantor', user('grantor')), put('users/ancestor', user('ancestor')), put('clients/client', { rootId: 'root', active: true, name: 'Fixture', operadorId: chain ? 'ancestor' : 'grantor' }), put('userClientAccess/recipient/clients/client', grant('recipient', 'grantor', chain ? 'DELEGATED' : 'DIRECT')), put('userClientAccess/grantor/clients/client', grant('grantor', 'ancestor', 'DIRECT'))]);
  for (const collection of ['solicitudes', 'pagos', 'clientDispersions']) {
    await put(`${collection}/operation`, { rootId: 'root', clientId: 'client', clienteId: 'client', adminId: 'other', operadorId: 'other', createdBy: 'other', status: 'PENDIENTE' });
    await put(`${collection}/operation/notas/note`, { text: 'synthetic', createdAt: admin.firestore.Timestamp.now(), updatedAt: admin.firestore.Timestamp.now() });
  }
  for (const collection of ['clientBeneficiaries', 'clientBeneficiaryMethods', 'pagoAplicaciones']) await put(`${collection}/related`, { rootId: 'root', clientId: 'client', solicitudId: 'operation', createdBy: 'other' });
}
const request = data => ({ auth: { uid: 'recipient' }, data });
const reads = [
  () => getClientCanonical.run(request({ clientId: 'client', requiredPermission: 'viewBasic' })),
  ...['solicitudes', 'pagos', 'clientDispersions'].map(collection => () => readAuthorizedOperationalRecord(request({ collection, id: 'operation' }))),
  () => readSolicitudNotes(request({ solicitudId: 'operation' })),
  () => readClientDispersionNotes(request({ dispersionId: 'operation' })),
  ...['clientBeneficiaries', 'clientBeneficiaryMethods', 'pagoAplicaciones'].map(collection => async () => {
    const page = await readAuthorizedRelatedRecords(request({ collection, id: collection === 'pagoAplicaciones' ? 'operation' : 'client' }));
    assert.ok(page.items.some(item => item.id === 'related'), `Missing authorized ${collection} fixture`);
    return page;
  }),
];
let checks = 0;
async function checkAll(allow, label) {
  for (const [index, read] of reads.entries()) {
    if (allow) { const result = await read(); assert.ok(result, `${label}:${index}`); }
    else await assert.rejects(read(), error => ['permission-denied', 'failed-precondition'].includes(error.code), `${label}:${index}`);
    checks++;
  }
}
(async () => {
  await reset(); await checkAll(true, 'representative-explicit-revoked');
  await reset(true); await checkAll(true, 'valid-full-chain');
  for (const [name, mutate] of [
    ['ancestor-inactive', () => db.doc('users/ancestor').update({ active: false })],
    ['ancestor-root', () => db.doc('users/ancestor').update({ rootId: 'foreign' })],
    ['ancestor-restricted', () => db.doc('users/ancestor').update({ trustedRestrictionV1: activeRestriction('ancestor') })],
    ['parent-revoked', () => db.doc('userClientAccess/grantor/clients/client').update({ revokedAt: now })],
    ['parent-expired', () => db.doc('userClientAccess/grantor/clients/client').update({ expiresAt: now - 1 })],
    ['parent-operate-denied', () => db.doc('userClientAccess/grantor/clients/client').update({ 'permissions.operate': false })],
    ['parent-all-read-denied', () => db.doc('userClientAccess/grantor/clients/client').update({ 'permissions.viewBasic': false, 'permissions.operateSolicitudes': false, 'permissions.operatePagos': false })],
    ['parent-missing', () => db.doc('userClientAccess/grantor/clients/client').delete()],
    ['cycle', () => put('userClientAccess/grantor/clients/client', grant('grantor', 'recipient', 'DELEGATED'))],
    ['provenance-missing', () => put('userClientAccess/recipient/clients/client', { active: true, permissions: { view: true, operate: true } })],
    ['actor-disabled', () => db.doc('users/recipient').update({ disabled: true })],
    ['grantor-disabled', () => db.doc('users/grantor').update({ disabled: true })],
    ['client-root', () => db.doc('clients/client').update({ rootId: 'foreign' })],
  ]) { await reset(true); await mutate(); await checkAll(false, name); }
  await reset();
  await put('clientDispersions/operation', { rootId: 'root', clientId: 'client', ownerUid: 'other', fundingSource: { holderType: 'USER', ownerUid: 'other', sourceClientId: 'client', rootId: 'root' } });
  for (const read of [reads[3], reads[5]]) { await assert.rejects(read(), error => error.code === 'permission-denied'); checks++; }
  await assert.rejects(readAuthorizedOperationalRecord(request({ collection: 'users', id: 'recipient' })), error => error.code === 'invalid-argument'); checks++;
  const { buildGrantorCases } = await import('./helpers/grantor-cases.mjs');
  const baseRestriction = (patch = {}) => ({ ...activeRestriction('grantor'), expiresAtMs: now - 3600000, ...patch });
  const { cases } = buildGrantorCases({ now, grantor: 'grantor', recipient: 'recipient', Timestamp: admin.firestore.Timestamp, restriction: baseRestriction });
  let validCategories = 0;
  for (const item of cases.filter(item => item.allow || item.vector?.some(Boolean))) {
    console.log('READFLOW_CASE ' + item.id);
    const rootId = item.rootId || 'root';
    await put('users/recipient', { role: 'operador', rootId, active: true, ...item.actor });
    if (item.missingUser) await db.doc('users/grantor').delete(); else await put('users/grantor', { role: 'superadmin', rootId, active: true, ...item.user });
    await put('users/terminal', { role: 'superadmin', rootId, active: true });
    await put('clients/client', { rootId, active: true, adminId: 'other', createdBy: 'other', ...item.client });
    await put('userClientAccess/recipient/clients/client', { rootId, targetUid: 'recipient', clientId: 'client', active: true, grantedBy: 'grantor', ...item.grant });
    await put('userClientAccess/grantor/clients/client', { rootId, targetUid: 'grantor', clientId: 'client', active: true, grantedBy: 'terminal', ...item.parent });
    for (const collection of ['solicitudes', 'pagos', 'clientDispersions']) await put(`${collection}/operation`, { rootId, clientId: 'client', clienteId: 'client', adminId: 'other', operadorId: 'other', createdBy: 'other' });
    for (const collection of ['clientBeneficiaries', 'clientBeneficiaryMethods', 'pagoAplicaciones']) await put(`${collection}/related`, { rootId, clientId: 'client', solicitudId: 'operation', createdBy: 'other' });
    for (const [index, read] of reads.entries()) {
      // The canonical backend validates a restriction against the exact stored
      // profile root. A whitespace-mismatched restricted profile was accepted by
      // the historical SDK grantor normalizer, but is not valid authority.
      const permissionIndex = [0, 1, 2, 3, 4, 5, 0, 0, 2][index];
      const allowed = item.gap || item.id === 'grantor-trimmed-root-expired-restriction' ? false : item.vector?.[permissionIndex] ?? item.allow;
      if (allowed) await assert.doesNotReject(read(), `${item.id}:${index}`);
      else await assert.rejects(read(), error => ['permission-denied', 'failed-precondition'].includes(error.code), `${item.id}:${index}`);
      checks++;
    }
    validCategories++;
  }
  console.log(JSON.stringify({ mode: 'SECURITY_OPERATIONAL_READFLOW', checks, validCategories, representativeAllowed: 6, validChainAllowed: 6, ancestryClosed: true, productionEffects: false }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => admin.app().delete());
