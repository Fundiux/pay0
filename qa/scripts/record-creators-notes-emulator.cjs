const assert = require('node:assert/strict');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || process.env.GCLOUD_PROJECT !== 'demo-pay0') throw Error('Local demo emulator required');
global.fetch = async () => { throw Error('EXTERNAL_NETWORK_FORBIDDEN'); };
const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: 'demo-pay0' });
const db = admin.firestore(), stamp = admin.firestore.Timestamp;
const api = require('../../functions/lib/index');
const notes = require('../../functions/lib/modules/notes/callables');
const { systemNoteAuthor } = require('../../functions/lib/modules/notes/domain');
const suffix = Date.now(), root = `creator-root-${suffix}`, owner = `creator-admin-${suffix}`, operator = `creator-operator-${suffix}`, other = `creator-other-${suffix}`, foreign = `creator-foreign-${suffix}`;
const call = (fn, uid, data = {}) => fn.run({ auth: { uid, token: {} }, data });
let checks = 0;
const check = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
const denied = async (fn, code = 'permission-denied') => { await assert.rejects(fn, error => error.code === code); checks++; };

async function run() {
  for (const [uid, role, rootId, displayName, parentUserId] of [
    [root, 'superadmin', root, 'Supervisión', null],
    [owner, 'admin', root, 'Administración Norte', root],
    [operator, 'operador', root, 'Ana Operaciones', owner],
    [other, 'admin', root, 'Administración Sur', root],
    [foreign, 'superadmin', foreign, 'Usuario externo', null],
  ]) await db.doc(`users/${uid}`).set({ role, rootId, displayName, username: displayName.split(' ')[0], parentUserId, active: true });

  const time = stamp.fromMillis(1800000000000);
  for (const collection of ['pagos', 'solicitudes']) {
    for (const [id, adminId, createdBy, rootId] of [
      ['a', owner, operator, root], ['b', owner, operator, root], ['c', owner, operator, root],
      ['d', owner, owner, root], ['e', other, other, root], ['f', owner, operator, foreign],
    ]) await db.doc(`${collection}/${root}-${id}`).set({ rootId, adminId, createdBy, createdAt: time, folio: `TEST-${id}`, monto: 100, totalAbonado: 40, status: 'PENDIENTE' });
    const fn = collection === 'pagos' ? api.listPagos : api.listSolicitudes;
    const all = await call(fn, root);
    check(all.items.length, 5, `${collection} root isolation`);
    check(all.creatorOptions.some(x => x.uid === foreign), false, 'foreign identity not exposed');
    check(all.items.find(x => x.createdBy === operator).createdByDisplayName, 'Ana Operaciones', 'human creator');
    const first = await call(fn, owner, { creatorUid: operator, limit: 2 });
    check(first.items.length, 2, 'filtered page size');
    check(first.hasMore, true, 'filtered pagination');
    check(first.creatorOptions.some(x => x.uid === other || x.uid === foreign), false, 'admin directory scope');
    const cursor = first.nextCursor;
    const second = await call(fn, owner, { creatorUid: operator, limit: 2, cursorSeconds: cursor.seconds, cursorNanoseconds: cursor.nanoseconds, cursorId: cursor.id });
    check(second.items.length, 1, 'filtered second page');
    check(new Set([...first.items, ...second.items].map(x => x.id)).size, 3, 'equal-time stable cursor');
    check(second.hasMore, false, 'filtered end');
    check((await call(fn, owner, { creatorUid: other })).items.length, 0, 'other admin author cannot widen access');
    check((await call(fn, owner, { creatorUid: foreign })).items.length, 0, 'foreign filter cannot widen access');
    check((await call(fn, operator)).items.length, 3, 'operator owns rows only');
    check((await call(fn, operator)).creatorOptions, [], 'operator has no directory');
    await denied(() => call(fn, operator, { creatorUid: operator }));
    await denied(() => call(fn, root, { creatorUid: 'invalid/path' }), 'invalid-argument');
    check((await call(fn, root, { fromMillis: time.toMillis() + 1 })).items.length, 0, 'date range applied with creator query');
  }
  for (const [collection, fn, key] of [['solicitudes', notes.addSolicitudNota, 'solicitudId'], ['pagos', notes.addPagoNota, 'pagoId']]) {
    await call(fn, operator, { [key]: `${root}-a`, text: '  Revisar cuenta destino  ', createdByName: 'Suplantación', authorType: 'SYSTEM' });
    const saved = await db.collection(`${collection}/${root}-a/notas`).get();
    check(saved.size, 1, 'one explicit human note');
    const row = saved.docs[0].data();
    check([row.authorType, row.authorName, row.authorId, row.origin, row.text], ['USER', 'Ana Operaciones', operator, 'MANUAL', 'Revisar cuenta destino'], 'server-assigned author');
    await denied(() => call(fn, owner, { [key]: `${root}-e`, text: 'Fuera de delegación' }));
    await denied(() => call(fn, operator, { [key]: `${root}-d`, text: 'Registro ajeno' }));
    await denied(() => call(fn, root, { [key]: `${root}-f`, text: 'Otro root' }));
    await denied(() => call(fn, operator, { [key]: `${root}-a`, text: '   ' }), 'invalid-argument');
    check((await db.collection(`${collection}/${root}-b/notas`).get()).empty, true, 'reading and filtering do not create notes');
  }
  const rejection = { ...systemNoteAuthor('IQ', 'REJECTION', operator), text: 'Motivo: Cuenta destino no disponible', rootId: root, createdAt: time };
  await db.collection(`pagos/${root}-a/notas`).add(rejection);
  const system = (await db.collection(`pagos/${root}-a/notas`).where('authorType', '==', 'SYSTEM').get()).docs[0].data();
  check([system.authorName, system.createdByName, system.initiatedBy, system.text], ['Sistema', 'Sistema', operator, rejection.text], 'automatic rejection preserves reason and separates initiator');
  console.log(JSON.stringify({ ok: true, checks, suites: ['creator scope', 'pagination', 'human identity', 'manual notes', 'automatic rejection'], externalActions: 0 }));
}
run().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
