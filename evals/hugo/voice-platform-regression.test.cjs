const test = require('node:test');
const assert = require('node:assert/strict');
const { buildHugoContextV2 } = require('../../functions/lib/modules/agent007/hugoCore/contextBuilderV2');
const { normalizeConversationState } = require('../../functions/lib/modules/agent007/hugoCore/conversationState');
const { formatVoicePlatformResult } = require('../../functions/lib/modules/agent007/voiceDelegation');
const { PlatformReadConnector } = require('../../functions/lib/modules/agent007/platformReadConnector');
const { HUGO_SYSTEM_CATALOG } = require('../../functions/lib/modules/agent007/systemCatalog');

function result(tool, data) { return { sourceSystem: 'PAY0', tool, retrievedAt: new Date().toISOString(), scope: { rootId: 'root-a' }, completeness: 'COMPLETE', evidence: [], data, trace: { latencyMs: 0, result: 'OK' } }; }
async function context(message, data) {
  const calls = [];
  const built = await buildHugoContextV2({ message, rootId: 'root-a', conversationState: normalizeConversationState(null, 'root-a'), router: { execute: async request => { calls.push(request); return result(request.name, data); } } });
  return { calls, built };
}
test('clientes de usuario usa una herramienta de alcance en lugar del muestreo operativo', async () => {
  const { calls, built } = await context('¿Cuántos clientes tiene el usuario Betel?', { matchStatus: 'EXACT', clientCount: 7, user: { displayName: 'Betel' } });
  assert.deepEqual(calls.map(x => x.name), ['countClientsForUser']); assert.equal(calls[0].input.query, 'Betel'); assert.equal(built.context.platformFacts.clientCount.clientCount, 7);
});
test('acceso efectivo y catálogo de sistemas tienen herramientas separadas', async () => {
  assert.deepEqual((await context('¿A qué tienes acceso?', {})).calls.map(x => x.name), ['getAuthorizedCapabilities', 'getLastOperationDiagnostic']);
  assert.deepEqual((await context('¿Cuáles son los sistemas que manejamos?', [])).calls.map(x => x.name), ['getSystemCatalog']);
});
test('variaciones naturales conservan la misma capacidad y no una frase exacta', async () => {
  assert.deepEqual((await context('Dime los clientes asignados a Betel', {})).calls.map(x => x.name), ['countClientsForUser']);
  assert.deepEqual((await context('Que puedes consultar dentro de mi cuenta?', {})).calls.map(x => x.name), ['getAuthorizedCapabilities', 'getLastOperationDiagnostic']);
  assert.deepEqual((await context('Que otras plataformas forman parte de la empresa?', [])).calls.map(x => x.name), ['getSystemCatalog']);
  const colloquial = await context('¿Me puedes decir cuántos usuarios tiene Betel?', { matchStatus: 'EXACT', clientCount: 7 });
  assert.deepEqual(colloquial.calls.map(x => x.name), ['countClientsForUser']);
  assert.equal(colloquial.calls[0].input.query, 'Betel');
});
test('conteo visible por nombre y usuario actual se resuelven sin hardcodear identidades', async () => {
  const named = await context('¿Cuántos clientes activos visibles tiene Operador Norte? Dime cuántos nada más.', { matchStatus: 'EXACT', clientCount: 4 });
  assert.deepEqual(named.calls.map(x => x.name), ['countClientsForUser']);
  assert.equal(named.calls[0].input.query, 'Operador Norte');
  assert.deepEqual((await context('¿Cuántos clientes activos puedo ver con mi usuario?', { clientCount: 3 })).calls.map(x => x.name), ['countClientsForCurrentUser']);
});
test('pagos recibidos, lista, anterior y seguimientos usan herramientas deterministas', async () => {
  assert.deepEqual((await context('¿Cuál fue el último pago recibido en PAY0?', { items: [] })).calls.map(x => x.name), ['searchReceivedPagos']);
  const list = await context('Muéstrame los últimos 5 pagos recibidos', { items: [] });
  assert.equal(list.calls[0].name, 'searchReceivedPagos'); assert.equal(list.calls[0].input.limit, 5);
  const activeEntity = { system: 'PAY0', entityType: 'PAGO', entityId: 'opaque-2', folio: 'PABCDE', rootId: 'root-a', resolvedAt: Date.now(), resolvedTurn: 1, source: 'PAY0_ORDERED_TOOL', confidence: 1 };
  const paymentState = normalizeConversationState({ version: 'conversation-state-v2', rootId: 'root-a', turn: 1, activeEntity, recentEntities: [activeEntity], pendingAmbiguity: [], lastIntent: 'STATUS' }, 'root-a');
  const calls = [];
  await buildHugoContextV2({ message: '¿Y el anterior?', rootId: 'root-a', conversationState: paymentState, router: { execute: async request => { calls.push(request); return result(request.name, { items: [] }); } } });
  assert.deepEqual(calls[0], { name: 'searchReceivedPagos', input: { limit: 1, beforePaymentId: 'opaque-2', position: 'PREVIOUS' } });
});
test('la salida de voz deterministica se deriva del resultado canonico de PAY0', () => {
  assert.equal(formatVoicePlatformResult('countClientsForUser', { matchStatus: 'EXACT', clientCount: 7, user: { displayName: 'Fixture' } }), 'Fixture tiene 7 clientes activos visibles en PAY0.');
  assert.match(formatVoicePlatformResult('getAuthorizedCapabilities', { role: 'superadmin', modules: { clientes: { view: true }, pagos: { view: false } } }), /clientes/);
  assert.match(formatVoicePlatformResult('getSystemCatalog', [{ id: 'PAY0', status: 'CONNECTED', allowed: true }]), /PAY0 \(CONNECTED\)/);
});
test('superadmin explica READ de root completo sin convertirlo en permiso de ejecucion', () => {
  const text = formatVoicePlatformResult('getAuthorizedCapabilities', { role: 'superadmin', modules: { clientes: { view: true }, pagos: { view: true } } });
  assert.match(text, /toda la información PAY0 dentro del root administrado/);
  assert.match(text, /no autoriza escrituras, ejecuciones financieras ni otros sistemas/);
});
test('el conteo omite clientes inactivos antes de resolver su acceso', async () => {
  const docs = [
    { id: 'inactive', data: () => ({ rootId: 'root-a', active: false }) },
    { id: 'unspecified', data: () => ({ rootId: 'root-a' }) },
    { id: 'active', data: () => ({ rootId: 'root-a', active: true }) },
  ];
  const db = { collection: name => { assert.equal(name, 'clients'); return { where: (field, op, value) => { assert.deepEqual([field, op, value], ['rootId', '==', 'root-a']); return { get: async () => ({ docs }) }; } }; } };
  const user = { role: 'superadmin', active: true };
  const connector = new PlatformReadConnector(db, { uid: 'actor' }, user, { uid: 'actor', rootId: 'root-a', role: 'superadmin' });
  assert.equal((await connector.countClientsForCurrentUser()).data.clientCount, 1);
});
function fixtureDb(rows) {
  const docs = values => values.map(value => ({ id: value.id, data: () => ({ ...value, id: undefined }) }));
  return { collection: name => ({
    where: (field, op, value) => {
      assert.deepEqual([field, op], ['rootId', '==']);
      const selected = (rows[name] || []).filter(row => row.rootId === value);
      return { limit: () => ({ get: async () => ({ docs: docs(selected) }) }), get: async () => ({ docs: docs(selected) }) };
    },
  }) };
}
test('superadmin consulta clientes activos y operaciones de admin y operador solo dentro de su root', async () => {
  const db = fixtureDb({
    users: [
      { id: 'admin-a', rootId: 'root-a', role: 'admin', active: true, displayName: 'Admin Uno' },
      { id: 'operator-a', rootId: 'root-a', role: 'operador', active: true, displayName: 'Operador Uno', parentUserId: 'admin-a' },
      { id: 'operator-b', rootId: 'root-b', role: 'operador', active: true, displayName: 'Operador Externo' },
    ],
    clients: [
      { id: 'client-admin', rootId: 'root-a', active: true, adminId: 'admin-a', operadorId: 'operator-a' },
      { id: 'client-operator', rootId: 'root-a', active: true, adminId: 'admin-a', operadorId: 'operator-a' },
      { id: 'client-inactive', rootId: 'root-a', active: false, adminId: 'admin-a' },
      { id: 'client-foreign', rootId: 'root-b', active: true, operadorId: 'operator-b' },
    ],
    solicitudes: [
      { id: 'request-old', rootId: 'root-a', clientId: 'client-admin', folio: 'S-OLD', createdAt: { toMillis: () => 10 } },
      { id: 'request-new', rootId: 'root-a', clientId: 'client-admin', folio: 'S-NEW', createdAt: { toMillis: () => 20 } },
      { id: 'request-foreign', rootId: 'root-b', clientId: 'client-foreign', folio: 'S-FOREIGN', createdAt: { toMillis: () => 30 } },
    ],
    pagos: [{ id: 'payment-operator', rootId: 'root-a', clientId: 'client-operator', folio: 'P-NEW', createdAt: { toMillis: () => 40 } }],
  });
  const actor = { uid: 'super-a' };
  const user = { role: 'superadmin', active: true };
  const connector = new PlatformReadConnector(db, actor, user, { uid: 'super-a', rootId: 'root-a', role: 'superadmin' });
  assert.equal((await connector.countClientsForUser('Admin Uno')).data.clientCount, 2);
  assert.equal((await connector.countClientsForUser('Operador Uno')).data.clientCount, 2);
  assert.equal((await connector.getLatestOperationForUser('Admin Uno', 'SOLICITUD')).data.item.folio, 'S-NEW');
  assert.equal((await connector.getLatestOperationForUser('Operador Uno', 'PAGO')).data.item.folio, 'P-NEW');
  assert.equal((await connector.countClientsForUser('Operador Externo')).data.matchStatus, 'NOT_FOUND');
});
test('admin y operador no heredan visibilidad global ni cross-root', () => {
  const admin = { uid: 'admin-a', rootId: 'root-a', role: 'admin' };
  const operator = { uid: 'operator-a', rootId: 'root-a', role: 'operador' };
  assert.equal(require('../../functions/lib/modules/agent007/platformReadConnector').isUserVisibleToCaller(admin, 'operator-a', { rootId: 'root-a', parentUserId: 'admin-a' }), true);
  assert.equal(require('../../functions/lib/modules/agent007/platformReadConnector').isUserVisibleToCaller(admin, 'other-admin', { rootId: 'root-a', role: 'admin' }), false);
  assert.equal(require('../../functions/lib/modules/agent007/platformReadConnector').isUserVisibleToCaller(operator, 'operator-a', { rootId: 'root-a' }), true);
  assert.equal(require('../../functions/lib/modules/agent007/platformReadConnector').isUserVisibleToCaller(operator, 'operator-b', { rootId: 'root-a' }), false);
  assert.equal(require('../../functions/lib/modules/agent007/platformReadConnector').isUserVisibleToCaller(admin, 'operator-b', { rootId: 'root-b', parentUserId: 'admin-a' }), false);
});
test('la reanudacion conserva solo contexto reciente y del propietario autenticado', async () => {
  const make = (row) => ({ collection: name => { assert.equal(name, 'agent007Conversations'); return { doc: id => ({ get: async () => ({ exists: true, data: () => ({ rootId: 'root-a', ownerUid: 'actor', resumeContext: row }) }) }) }; } });
  const identity = { uid: 'actor', rootId: 'root-a', role: 'superadmin' };
  const recent = { activeSystem: 'PAY0', activeIntent: 'LATEST_RECEIVED_PAYMENT', language: 'es-MX', lastResolvedEntity: { system: 'PAY0', type: 'PAYMENT', safeId: 'opaque', folio: 'PABCDE' }, updatedAt: new Date().toISOString() };
  const fresh = new PlatformReadConnector(make(recent), { uid: 'actor' }, { role: 'superadmin', active: true }, identity);
  assert.equal((await fresh.getSessionContext()).data.lastResolvedEntity.safeId, 'opaque');
  const stale = new PlatformReadConnector(make({ ...recent, updatedAt: new Date(Date.now() - 31 * 60 * 1000).toISOString() }), { uid: 'actor' }, { role: 'superadmin', active: true }, identity);
  assert.equal((await stale.getSessionContext()).data.lastResolvedEntity, null);
});
test('el estado de conexión se deriva de capacidades registradas, no de la UI', () => {
  const status = Object.fromEntries(HUGO_SYSTEM_CATALOG.map(row => [row.id, row.status]));
  assert.equal(status.PAY0, 'CONNECTED');
  assert.equal(status.HUGO, 'CONNECTED');
  assert.equal(status.ASSETS, 'NOT_CONNECTED');
  assert.equal(status.TTT, 'NOT_CONNECTED');
});
