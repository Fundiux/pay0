const assert = require('node:assert/strict');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || process.env.GCLOUD_PROJECT !== 'demo-pay0') throw Error('Local emulator required');
global.fetch = async () => { throw Error('EXTERNAL_NETWORK_FORBIDDEN'); };
const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: 'demo-pay0' });
const db = admin.firestore();
const { Pay0Connector } = require('../../functions/lib/modules/agent007/pay0Connector');
const callables = require('../../functions/lib/modules/agent007/callables');
const { inventoryPage } = require('../../functions/lib/modules/paymentApplications/complementInventory');
const rootId = `hugo-phase1-${Date.now()}`, foreignRoot = `${rootId}-foreign`;
const uid = rootId, auth = { uid, token: { role: 'superadmin' } };
const identity = { uid, rootId, role: 'superadmin' };
const observations = {};
const pass = id => { observations[id] = { primary: true }; };

async function businessState() {
  const collections = ['solicitudes', 'pagos', 'paymentComplementRequests', 'agent007Recommendations', 'agent007LearnedRules', 'pagoAplicaciones', 'uploads'];
  const state = {};
  for (const name of collections) {
    const snap = await db.collection(name).get();
    state[name] = snap.docs.map(doc => ({ id: doc.id, data: doc.data() })).filter(row => row.data.rootId === rootId).sort((a, b) => a.id.localeCompare(b.id));
  }
  return JSON.stringify(state, (key, value) => value?.toMillis ? value.toMillis() : value);
}

async function main() {
  await db.doc(`users/${uid}`).set({ role: 'superadmin', rootId, active: true, email: 'synthetic@example.test' });
  await db.doc(`solicitudes/${rootId}-sol`).set({ rootId, folio: 'S12345', status: 'PENDIENTE', amount: 100, createdAt: admin.firestore.Timestamp.now() });
  await db.doc(`solicitudes/${rootId}-foreign`).set({ rootId: foreignRoot, folio: 'S54321', status: 'SECRETO', createdAt: admin.firestore.Timestamp.now() });
  await db.doc(`pagos/${rootId}-pay`).set({ rootId, folio: 'P12345', status: 'APLICADO', createdAt: admin.firestore.Timestamp.now() });
  await db.doc(`agent007Recommendations/${rootId}-rec`).set({ rootId, kind: 'OC_FISCAL_REVIEW', caseId: `${rootId}-sol`, proposal: 'Revisar', status: 'PENDING_REVIEW', createdAt: admin.firestore.Timestamp.now() });
  const traces = [], pay0 = new Pay0Connector(db, identity, trace => traces.push(trace));
  const before = await businessState();
  const found = await pay0.getSolicitud('S12345');
  assert.equal(found.data.status, 'PENDIENTE');
  assert.equal(found.evidence[0].sourceSystem, 'PAY0');
  assert.equal(found.evidence[0].scope.rootId, rootId);
  assert.equal(found.completeness, 'COMPLETE');
  assert.equal(found.trace.actorUid, uid);
  pass('solicitud-found');
  const missing = await pay0.getSolicitud('S99999');
  assert.equal(missing.data, null); assert.equal(missing.completeness, 'UNKNOWN'); assert.deepEqual(missing.evidence, []);
  const missingReply = await callables.sendAgent007Message.run({ auth, data: { text: '¿Qué pasó con S99999?' } });
  assert.doesNotMatch(missingReply.message.text, /S99999.*está en/i);
  pass('solicitud-missing');
  const payment = await pay0.getPago('P12345');
  assert.equal(payment.evidence[0].entityType, 'pago'); pass('pago-found');
  const recent = await pay0.searchSolicitudes();
  assert.equal(recent.completeness, 'PARTIAL'); assert(recent.data.every(row => row.rootId === rootId));
  const totalReply = await callables.sendAgent007Message.run({ auth, data: { text: '¿Cuántos pagos hay en total?' } });
  assert.doesNotMatch(totalReply.message.text, /total de pagos es/i);
  pass('sample-boundary');
  const foreign = await pay0.getSolicitud('S54321');
  assert.equal(foreign.completeness, 'UNKNOWN'); assert.equal(foreign.data, null);
  pass('root-isolation');
  assert.throws(() => new Pay0Connector(db, { uid: 'viewer', rootId, role: 'cliente' }), /UNAUTHORIZED/);
  await db.doc(`users/${rootId}-viewer`).set({ role: 'cliente', rootId, active: true });
  await assert.rejects(callables.sendAgent007Message.run({ auth: { uid: `${rootId}-viewer`, token: { role: 'cliente' } }, data: { text: 'Solicita el REP P12345' } }));
  pass('action-denied');
  const originalCollection = db.collection.bind(db);
  const broken = { collection: name => { if (name === 'solicitudes') throw Error('PAY0_READ_FAILED'); return originalCollection(name); } };
  await assert.rejects(new Pay0Connector(broken, identity).getSolicitud('S12345'), /PAY0_READ_FAILED/);
  assert.equal((await pay0.getPaymentComplementStatus()).completeness, 'PARTIAL');
  const summary = await pay0.getPay0OperationalSummary();
  assert.equal(summary.completeness, 'PARTIAL');
  assert(summary.evidence.some(row => row.entityType === 'solicitud'));
  assert(summary.evidence.some(row => row.entityType === 'pago'));
  const list = await callables.listAgent007Recommendations.run({ auth, data: {} });
  assert.equal(list.recommendations.find(row => row.id === `${rootId}-rec`).status, 'PENDING_REVIEW');
  const answer = await callables.sendAgent007Message.run({ auth, data: { text: '¿Qué pasó con S12345?' } });
  assert.match(answer.message.text, /S12345/); assert.match(answer.message.text, /PENDIENTE/);
  const afterRead = await businessState();
  assert.equal(afterRead, before, 'READ paths must not change business state');
  const inventory = await inventoryPage(rootId, '', 5);
  assert.equal(inventory.counts.scanned, 0);
  assert.equal(await businessState(), before);
  assert.equal((await pay0.getSolicitud('S12345')).data.status, 'PENDIENTE');
  assert.equal(await businessState(), before, 'repeated READ must be pure');
  const reconciliation = await callables.reconcileAgent007RecommendationsNow.run({ auth, data: {} });
  assert.equal(reconciliation.changed, 1);
  assert.equal((await db.doc(`agent007Recommendations/${rootId}-rec`).get()).data().status, 'OBSERVATION_ONLY');
  assert(traces.length >= 7);
  console.log(JSON.stringify({ ok: true, readBusinessWrites: 0, explicitReconciliationWrites: reconciliation.changed, traces: traces.length, observations }));
}
main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
