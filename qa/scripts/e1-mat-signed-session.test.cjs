const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const runtime = path.resolve(process.env.PAY0_MAT_RUNTIME || 'functions');
const token = 'synthetic-mat-signing-key';
let rows = {};
const snapshot = (id, data) => ({ id, exists: !!data, data: () => data });
const db = { ledgerRoot: 'r', statementRoot: 'r', collection: name => {
  const filters = []; let limit = Infinity;
  const query = { doc: id => ({ get: async () => snapshot(id, rows[`${name}/${id}`]) }),
    where: (key, op, value) => { assert.equal(op, '=='); filters.push([key, value]); return query; },
    limit: value => { limit = value; return query; },
    get: async () => { const docs = Object.entries(rows).filter(([key, value]) => key.startsWith(name + '/') && filters.every(([k, v]) => value[k] === v)).slice(0, limit).map(([key, value]) => snapshot(key.split('/').pop(), value)); return { docs, empty: !docs.length }; } };
  return query;
} };
function load(file, deps) {
  const exports = {};
  vm.runInNewContext(fs.readFileSync(path.join(runtime, 'lib/modules/telegramMiniApp', file), 'utf8'), {
    exports, Date, Set, Map, URLSearchParams, Buffer, Error, console,
    require: name => { assert.ok(name in deps, `Unexpected dependency ${name}`); return deps[name]; },
  });
  return exports;
}
const auth = load('auth.js', { crypto });
const service = load('service.js', {
  '../ledger/service': { readCanonicalBalanceSummary: async () => ({ rootId: db.ledgerRoot, availableBalance: 0, netBalance: 0, pendingAdvance: 0 }), readCanonicalStatement: async () => ({ summary: { rootId: db.statementRoot }, rows: [] }) },
  '../financing/dispersionFunding': { assertDispersionFundingOwner: () => {} },
});
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
const callables = load('callables.js', {
  'firebase-admin/app': { getApps: () => [{}], initializeApp: () => {} },
  'firebase-admin/firestore': { getFirestore: () => db },
  'firebase-functions/params': { defineSecret: () => ({ value: () => token }) },
  'firebase-functions/v2/https': { HttpsError, onCall: (_, handler) => handler },
  'firebase-admin/storage': { getStorage: () => ({ bucket: () => ({}) }) },
  '../documents/generationBoundDownload': { signGenerationBoundDownload: async (_, storagePath) => `https://signed.example/${encodeURIComponent(storagePath)}` },
  './auth': auth, './service': service,
});
function signed(age = 0) {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000) - age), user: JSON.stringify({ id: 101, first_name: 'Synthetic' }) });
  const payload = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(payload).digest('hex'));
  return params.toString();
}
for (const [name, scope] of [['getMatUserHome', 'USERS'], ['getMatClientHome', 'CLIENTS'], ['verifyTelegramMiniAppSession', 'USERS']]) {
  test(`${name}: signed session rejects missing scope, missing data, altered HMAC and expiry`, async () => {
    const invoke = data => callables[name]({ data });
    await assert.rejects(invoke({}), e => e.code === 'invalid-argument');
    for (const [initData, status] of [['', 'INVALID_INIT_DATA'], [signed().replace(/hash=[^&]+/, 'hash=' + '0'.repeat(64)), 'INVALID_INIT_DATA'], [signed(7200), 'EXPIRED']]) {
      if (name === 'verifyTelegramMiniAppSession') assert.equal((await invoke({ botScope: scope, initData })).status, status);
      else await assert.rejects(invoke({ botScope: scope, initData }));
    }
  });
  test(`${name}: valid synthetic signature preserves linking and explicit revocation`, async () => {
    rows = { 'telegramUsers/101': { uid: 'u', active: true }, 'users/u': { uid: 'spoofed', id: 'spoofed', rootId: 'r', role: 'operador', active: true }, 'clientTelegramUsers/101': { rootId: 'r', clientId: 'c', active: true }, 'clients/c': { rootId: 'r', active: true } };
    const request = { data: { botScope: scope, initData: signed() } };
    const result = await callables[name](request);
    assert.equal(result.linked, true);
    if (scope === 'USERS') assert.equal(result.pay0UserId, 'u');
    rows['telegramUsers/101'].active = false; rows['users/u'].telegramUserId = '101';
    rows['clientTelegramUsers/101'].active = false;
    rows['clientTelegramUsers/legacy'] = { rootId: 'r', clientId: 'c', telegramUserId: '101', active: true };
    assert.equal((await callables[name](request)).linked, false);
  });
}
test('home scope cannot be swapped despite a valid signed Telegram session', async () => {
  await assert.rejects(callables.getMatUserHome({data:{botScope:'CLIENTS',initData:signed()}}), e=>e.code==='permission-denied');
  await assert.rejects(callables.getMatClientHome({data:{botScope:'USERS',initData:signed()}}), e=>e.code==='permission-denied');
});
test('user home returns every visible client for the dispersion picker', async () => {
  rows = {
    'telegramUsers/101': { uid: 'u', active: true },
    'users/u': { rootId: 'r', role: 'operador', active: true },
    ...Object.fromEntries(Array.from({ length: 12 }, (_, index) => [
      `clients/client-${index + 1}`,
      { rootId: 'r', createdBy: 'u', name: `Cliente ${index + 1}`, active: true },
    ])),
    'clients/foreign': { rootId: 'foreign', createdBy: 'u', name: 'Ajeno', active: true },
  };
  const result = await callables.getMatUserHome({ data: { botScope: 'USERS', initData: signed() } });
  assert.equal(result.clients.length, 12);
  assert.equal(result.metrics.find(item => item.label === 'Clientes').value, '12');
  assert.equal(result.clients.some(item => item.id === 'foreign'), false);
});
test('same compiled service rejects foreign client roots and filters foreign financial rows', async () => {
  rows = {'clientTelegramUsers/101':{rootId:'r',clientId:'c',active:true},'clients/c':{rootId:'foreign',active:true}};
  const invoke=()=>callables.getMatClientHome({data:{botScope:'CLIENTS',initData:signed()}});
  assert.equal((await invoke()).linked,false);
  rows['clients/c']={rootId:'r',active:true};
  rows['solicitudes/allowed']={rootId:'r',clienteId:'c',clienteNombre:'Cliente Visible',folio:'S-123'};
  rows['solicitudes/foreign']={rootId:'foreign',clienteId:'c'};
  rows['clientDispersions/foreign']={rootId:'foreign',clienteId:'c'};
  const result=await invoke();
  assert.equal(result.linked,true);
  assert.deepEqual(Array.from(result.solicitudes,x=>x.id),['allowed']);
  assert.equal(result.solicitudes[0].title,'Cliente Visible');
  assert.match(result.solicitudes[0].caption,/S-123/);
  assert.equal(result.dispersiones.length,0);
  db.ledgerRoot='foreign';
  await assert.rejects(invoke(),/MAT_LEDGER_SCOPE_DENIED/);
  db.ledgerRoot='r';db.statementRoot='foreign';
  await assert.rejects(invoke(),/MAT_LEDGER_SCOPE_DENIED/);
  db.statementRoot='r';
});
test('MAT documents require a signed, linked session and stay inside the visible solicitud', async () => {
  rows = {
    'clientTelegramUsers/101': { rootId: 'r', clientId: 'c', active: true },
    'clients/c': { rootId: 'r', name: 'Cliente', active: true },
    'solicitudes/s': { rootId: 'r', clienteId: 'c', folio: 'S-1' },
    'uploads/ok': { rootId: 'r', solicitudId: 's', entityType: 'solicitudes', active: true, status: 'READY', documentType: 'OC', storagePath: 'roots/r/solicitudes/s/docs/OC/ok.pdf' },
    'uploads/other': { rootId: 'r', solicitudId: 's', entityType: 'solicitudes', active: true, status: 'READY', storagePath: 'roots/r/solicitudes/other/docs/OC/other.pdf' },
  };
  const data = { botScope: 'CLIENTS', initData: signed(), solicitudId: 's' };
  const result = await callables.getMatSolicitudDocuments({ data });
  assert.equal(result.documents.length, 1);
  assert.match(result.documents[0].url, /^https:\/\/signed\.example\//);
  await assert.rejects(callables.getMatSolicitudDocuments({ data: { ...data, solicitudId: 'other' } }), e => e.code === 'permission-denied');
  await assert.rejects(callables.getMatSolicitudDocuments({ data: { ...data, initData: 'forged' } }));
  rows['clientTelegramUsers/101'].active = false;
  await assert.rejects(callables.getMatSolicitudDocuments({ data }), e => e.code === 'permission-denied');
});
test.after(() => {
  const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(runtime,'lib/modules/telegramMiniApp',file))).digest('hex');
  console.log(JSON.stringify({status:'ASSERTIONS_RECORDED',invalidSignatureRejected:true,expiredSignatureRejected:true,
    membershipRevocationRejected:true,foreignRootsIsolated:true,emptyScopeDenied:true,canonicalUidPreserved:true,
    coverage:'Signed home and document handlers with shared service/auth modules in this archive; foreign-root checks apply to homes and documents',
    dependencies:'Synthetic database/ledger/provider and secret accessor; real compiled HMAC validator, handlers and service',
    moduleHashes:Object.fromEntries(['auth.js','callables.js','service.js'].map(f=>[f,sha(f)])),productionWrites:0}));
});
