const assert = require('node:assert/strict');
const { test, after } = require('node:test');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || !/^demo-/.test(process.env.GCLOUD_PROJECT || '')) throw new Error('Loopback emulator and demo project required');
const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
const { listOperationalDocumentsCore } = require('../../functions/lib/modules/canonicalCenter/documentDossier');
const run = `dossier-${Date.now()}`;
const root = `${run}-root`, uid = `${run}-super`;
const paths = new Set();
const seed = async (path, data) => { paths.add(path); await db.doc(path).set(data); };
const request = (data = {}, actor = uid) => ({ auth: { uid: actor, token: {} }, data });
after(async () => { await Promise.all([...paths].map(path => db.doc(path).delete())); await admin.app().delete(); });

test('dossier scopes existing uploads, preserves explicit IQ provenance and paginates without storage URLs', async () => {
  await seed(`users/${uid}`, { rootId: root, role: 'superadmin', active: true });
  for (const [family, idField, storage] of [['solicitudes', 'solicitudId', 'solicitudes'], ['pagos', 'pagoId', 'pagos'], ['clientDispersions', 'dispersionId', 'dispersiones']]) {
    const parentId = `${run}-${family}`;
    await seed(`${family}/${parentId}`, { rootId: root, folio: `TEST-${family}`, empresaNombre: 'Empresa sintética' });
    for (let n = 0; n < 20; n++) await seed(`uploads/${run}-${family}-${String(n).padStart(2, '0')}`, {
      rootId: root, entityType: family, [idField]: parentId, active: true, status: 'READY', originalName: `${n}.pdf`,
      source: n === 0 ? 'IQ_INVOICE_ZIP' : 'MANUAL', iqFolio: n === 0 ? 'IQ-TEST' : 'DO-NOT-EXPOSE',
      storagePath: `roots/${root}/${storage}/${parentId}/docs/${n}.pdf`, secret: 'DO-NOT-EXPOSE', downloadURL: 'https://private.invalid',
    });
  }
  const first = await listOperationalDocumentsCore(request({ rootId: 'attacker-root' }));
  assert.equal(first.documents.length, 50); assert.ok(first.nextCursor);
  const second = await listOperationalDocumentsCore(request({ cursor: first.nextCursor }));
  assert.equal(second.documents.length, 10); assert.equal(second.nextCursor, null);
  const rows = [...first.documents, ...second.documents];
  assert.equal(new Set(rows.map(row => row.id)).size, 60);
  assert.equal(rows.filter(row => row.origin === 'IQ').length, 3);
  assert.equal(rows.filter(row => row.origin === 'PAY0' && row.iqFolio === '').length, 57);
  assert.ok(!JSON.stringify(rows).includes('DO-NOT-EXPOSE')); assert.ok(!JSON.stringify(rows).includes('storagePath'));
  await seed(`uploads/${run}-foreign`, { rootId: 'foreign', entityType: 'pagos', pagoId: `${run}-pagos` });
  const invalidBase = { rootId: root, entityType: 'pagos', pagoId: `${run}-pagos`, active: true, status: 'READY', storagePath: `roots/${root}/pagos/${run}-pagos/docs/x.pdf` };
  for (const [name, overrides] of Object.entries({ inactive: { active: false }, replaced: { status: 'REPLACED' }, wrongPath: { storagePath: 'roots/foreign/pagos/x/a.pdf' }, missingParent: { pagoId: `${run}-missing` }, malformedParent: { pagoId: 'bad/id' }, unsupported: { entityType: 'users' } })) await seed(`uploads/${run}-00-${name}`, { ...invalidBase, ...overrides });
  await seed(`pagos/${run}-foreign-parent`, { rootId: 'foreign' });
  await seed(`uploads/${run}-00-foreign-parent`, { ...invalidBase, pagoId: `${run}-foreign-parent`, storagePath: `roots/${root}/pagos/${run}-foreign-parent/docs/x.pdf` });
  const filtered = await listOperationalDocumentsCore(request());
  assert.equal(filtered.scanned, 50); assert.equal(filtered.documents.length, 43);
  assert.ok(filtered.documents.every(row => !row.id.includes('-00-')));
  for (const [name, overrides] of Object.entries({ pending: { status: 'PENDING' }, deleted: { isDeleted: true }, deletedAt: { deletedAt: '2026-01-01' } })) await seed(`uploads/${run}-00-${name}`, { ...invalidBase, ...overrides });
  await seed(`pagos/${run}-deleted-parent`, { rootId: root, status: 'ELIMINADA', isDeleted: true });
  await seed(`uploads/${run}-00-deleted-parent`, { ...invalidBase, pagoId: `${run}-deleted-parent`, storagePath: `roots/${root}/pagos/${run}-deleted-parent/docs/x.pdf` });
  const noDeleted = await listOperationalDocumentsCore(request());
  assert.equal(noDeleted.documents.length, 39);
  assert.ok(noDeleted.documents.every(row => !row.id.includes('-00-')));
});

test('dossier denies anonymous, ordinary roles, disabled profiles, restrictions and module revocation', async () => {
  await assert.rejects(listOperationalDocumentsCore({ data: {} }), { code: 'unauthenticated' });
  for (const [name, changes] of Object.entries({ admin: { role: 'admin' }, operator: { role: 'operador' }, inactive: { active: false }, malformedRestriction: { trustedRestrictionV1: null }, module: { modules: { corporateResources: { view: false } } } })) {
    const actor = `${run}-${name}`;
    await seed(`users/${actor}`, { rootId: root, role: 'superadmin', active: true, ...changes });
    await assert.rejects(listOperationalDocumentsCore(request({}, actor)), { code: 'permission-denied' }, name);
  }
  await assert.rejects(listOperationalDocumentsCore(request({ cursor: 'bad/id' })), { code: 'invalid-argument' });
  await assert.rejects(listOperationalDocumentsCore(request({ cursor: { rootId: root } })), { code: 'invalid-argument' });
  await seed(`users/${uid}`, { rootId: root, role: 'superadmin', active: true, modules: { pagos: { view: false } } });
  const sourceRevoked = await listOperationalDocumentsCore(request());
  assert.ok(sourceRevoked.documents.every(row => row.family !== 'pagos'));
  assert.ok(sourceRevoked.documents.some(row => row.family === 'clientDispersions'));
});
