const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const req = createRequire(path.resolve('functions/package.json'));
const ts = req('typescript'), admin = req('firebase-admin');
assert.equal(process.env.GCLOUD_PROJECT, 'demo-pay0-security-pages');
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^127\.0\.0\.1:\d+$/);
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
const { readAuthorizedRelatedRecords: related } = require('../../functions/src/modules/documents/relatedReads.ts');
const { readAuthorizedOperationalRecord: operation } = require('../../functions/src/modules/documents/operationalReads.ts');
const request = (collection, id, extra = {}) => ({ auth: { uid: 'actor' }, data: { collection, id, ...extra } });
const put = (p, d) => db.doc(p).set(d);
const denied = (promise) => assert.rejects(promise, e => ['permission-denied', 'failed-precondition'].includes(e.code));
let checks = 0;
(async () => {
  await put('users/actor', { role: 'admin', rootId: 'root', active: true });
  await put('clients/client', { rootId: 'root', active: true, adminId: 'actor' });
  await put('clients/foreign', { rootId: 'foreign', active: true, adminId: 'actor' });
  await put('solicitudes/operation', { rootId: 'root', clientId: 'client', adminId: 'actor' });
  for (const collection of ['clientBeneficiaries', 'clientBeneficiaryMethods', 'pagoAplicaciones']) {
    const batch = db.batch();
    for (let i = 0; i < 105; i++) batch.set(db.doc(`${collection}/page-${String(i).padStart(3, '0')}`), { rootId: 'root', clientId: 'client', solicitudId: 'operation', createdAt: admin.firestore.Timestamp.fromMillis(1000) });
    batch.set(db.doc(`${collection}/foreign`), { rootId: 'foreign', clientId: 'client', solicitudId: 'operation' });
    await batch.commit();
    const id = collection === 'pagoAplicaciones' ? 'operation' : 'client';
    const first = await related(request(collection, id));
    assert.equal(first.items.length, 100); assert.equal(first.nextCursor, 'page-099');
    const second = await related(request(collection, id, { cursor: first.nextCursor }));
    assert.equal(second.items.length, 5); assert.equal(second.nextCursor, null);
    assert.equal(new Set([...first.items, ...second.items].map(x => x.id)).size, 105);
    assert.equal(first.items[0].createdAt.seconds, 1);
    await assert.rejects(related(request(collection, id, { cursor: '../foreign' })), e => e.code === 'invalid-argument');
    checks += 7;
  }
  await denied(related(request('clientBeneficiaries', 'foreign'))); checks++;
  for (const collection of ['solicitudes', 'pagos', 'clientDispersions']) {
    for (const aliases of [{ clientId: 'client' }, { clienteId: 'client' }, { clientId: 'foreign', clienteId: 'client' }]) {
      await put(`${collection}/alias`, { rootId: 'root', ...aliases });
      assert.equal((await operation(request(collection, 'alias'))).item.id, 'alias'); checks++;
    }
    await put(`${collection}/alias`, { rootId: 'foreign', adminId: 'actor', createdBy: 'actor', operadorId: 'actor' });
    await denied(operation(request(collection, 'alias'))); checks++;
  }
  const batchResult = await operation({ auth: { uid: 'actor' }, data: { collection: 'pagos', ids: ['alias', 'missing'] } });
  assert.deepEqual(batchResult.deniedIds.sort(), ['alias', 'missing']); checks++;
  await put('pagos/owned', { rootId: 'root', createdBy: 'actor' });
  const mixed = await operation({ auth: { uid: 'actor' }, data: { collection: 'pagos', ids: ['owned', 'missing'] } });
  assert.deepEqual(mixed.items.map(row => row.id), ['owned']); assert.deepEqual(mixed.deniedIds, ['missing']); checks += 2;
  await assert.rejects(operation({ auth: { uid: 'actor' }, data: { collection: 'pagos', ids: Array.from({ length: 21 }, (_, i) => String(i)) } }), e => e.code === 'invalid-argument'); checks++;
  await put('clients/unrelated', { rootId: 'root', active: false, adminId: 'other' });
  for (const collection of ['clientBeneficiaries', 'clientBeneficiaryMethods', 'pagoAplicaciones']) {
    for (const field of collection === 'pagoAplicaciones' ? ['adminId', 'createdBy'] : ['adminId', 'operadorId', 'createdBy']) {
      await put(`${collection}/owned-${field}`, { rootId: 'root', clientId: 'unrelated', solicitudId: 'missing', [field]: 'actor' });
    }
    await put(`${collection}/not-owned`, { rootId: 'root', clientId: 'unrelated', solicitudId: 'missing', createdBy: 'other' });
    const own = await related(request(collection, collection === 'pagoAplicaciones' ? 'missing' : 'unrelated'));
    assert.equal(own.items.length, collection === 'pagoAplicaciones' ? 2 : 3);
    assert(own.items.every(row => row.id.startsWith('owned-'))); checks += 2;
  }
  await db.doc('users/actor').update({ modules: { wallet: { view: true, beneficiarios: false }, pagos: { view: true, create: false, conciliate: false } } });
  for (const collection of ['clientBeneficiaries', 'clientBeneficiaryMethods', 'pagoAplicaciones']) { await denied(related(request(collection, collection === 'pagoAplicaciones' ? 'operation' : 'client'))); checks++; }
  await db.doc('users/actor').update({ modules: admin.firestore.FieldValue.delete() });
  // Revoke between the two actual read transactions: the response must not escape.
  const original = db.runTransaction.bind(db); let transactions = 0;
  db.runTransaction = async (...args) => { const result = await original(...args); if (++transactions === 1) await db.doc('users/actor').update({ disabled: true }); return result; };
  try { await denied(related(request('clientBeneficiaries', 'client'))); checks++; } finally { db.runTransaction = original; }
  console.log(JSON.stringify({ mode: 'SECURITY_READFLOW_PAGINATION_SCOPE', checks, pagination: 105, aliases: true, revocationBetweenReads: true, productionEffects: false }));
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => admin.app().delete());
